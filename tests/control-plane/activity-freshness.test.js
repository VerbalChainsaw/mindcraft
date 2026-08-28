import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ACTIVITY_STATE_MAX_AGE_MS,
  isStaleActivityState,
} from '../../src/agent/runtime/activity-freshness.js';
import { CompanionDirectiveStateStore } from '../../src/agent/runtime/companion-directive-state.js';
import { JobStateStore } from '../../src/agent/runtime/job-state-store.js';
import { GoalStateStore } from '../../src/agent/runtime/goal-director.js';
import { createItemGoalContract } from '../../src/agent/runtime/goal-contract.js';
import { AgendaDirector } from '../../src/agent/runtime/agenda-director.js';
import { AgendaStore, normalizeAgendaEntry } from '../../src/agent/runtime/agenda.js';

const BOT = 'FreshnessBot';

/** Writes one persisted store file into a throwaway bots root. */
function seed(filename, document) {
  const root = mkdtempSync(path.join(tmpdir(), 'activity-freshness-'));
  mkdirSync(path.join(root, BOT), { recursive: true });
  writeFileSync(path.join(root, BOT, filename), JSON.stringify(document), 'utf8');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('activity freshness fails closed on a missing or unusable timestamp', () => {
  const now = 1_000_000;
  for (const value of [undefined, null, 'not-a-number', 0, -1, Number.NaN]) {
    assert.equal(
      isStaleActivityState(value, { now }),
      true,
      `${String(value)} must not count as fresh`,
    );
  }
});

test('activity freshness keeps a crash-restart window and drops a previous session', () => {
  const now = 1_000_000_000;
  assert.equal(isStaleActivityState(now - 1_000, { now }), false, 'a one-second-old save resumes');
  assert.equal(
    isStaleActivityState(now - (ACTIVITY_STATE_MAX_AGE_MS - 1), { now }),
    false,
    'just inside the window resumes',
  );
  assert.equal(
    isStaleActivityState(now - (ACTIVITY_STATE_MAX_AGE_MS + 1), { now }),
    true,
    'just outside the window is dropped',
  );
  // The real Kevin directory held a home-state ten days older than its agenda.
  assert.equal(isStaleActivityState(now - 10 * 24 * 60 * 60 * 1000, { now }), true);
});

test('a clock that jumped does not make old activity look fresh', () => {
  const now = 1_000_000_000;
  assert.equal(isStaleActivityState(now + 1_000, { now }), false, 'small skew tolerated');
  assert.equal(
    isStaleActivityState(now + ACTIVITY_STATE_MAX_AGE_MS + 1, { now }),
    true,
    'a far-future stamp is not evidence of fresh work',
  );
});

test('JobStateStore drops an active work order from a previous session', () => {
  const { root, cleanup } = seed('job-state.json', {
    version: 1,
    activeOrder: {
      id: 'builder-1', requester: 'phixxation', role: 'builder',
      kind: 'emergency_shelter', source: 'role', phase: 'execute',
    },
    terminalReceipt: null,
    savedAt: Date.now() - (ACTIVITY_STATE_MAX_AGE_MS + 60_000),
  });
  try {
    const store = new JobStateStore(BOT, { root });
    assert.equal(store.load(), null, 'a work order from a finished session must not revive');
    assert.match(String(store.lastError || ''), /Discarded persisted job state/);
  } finally {
    cleanup();
  }
});

test('JobStateStore still restores a work order after a crash restart', () => {
  const { root, cleanup } = seed('job-state.json', {
    version: 1,
    activeOrder: {
      id: 'builder-2', requester: 'phixxation', role: 'builder',
      kind: 'emergency_shelter', source: 'role', phase: 'execute',
    },
    terminalReceipt: null,
    savedAt: Date.now() - 5_000,
  });
  try {
    const store = new JobStateStore(BOT, { root });
    const restored = store.load();
    assert.ok(restored, 'a five-second-old work order is still live work');
    assert.equal(restored.id, 'builder-2');
    assert.equal(store.lastError, null);
  } finally {
    cleanup();
  }
});

test('GoalStateStore restores one stale active goal only for an explicit lifecycle restart', () => {
  const activeGoal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DirectorOps',
    target: {
      requestedName: 'obsidian',
      canonicalName: 'obsidian',
      inventoryName: 'obsidian',
      acquisitionName: 'obsidian',
      acquisitionKind: 'collect_block',
    },
    quantity: 10,
    quantityMode: 'minimum',
  });
  const { root, cleanup } = seed('goal-state.json', {
    version: 1,
    activeGoal,
    lastGoal: null,
    protectedGoalId: null,
    savedAt: Date.now() - (ACTIVITY_STATE_MAX_AGE_MS + 60_000),
  });
  try {
    const ordinaryStart = new GoalStateStore(BOT, { root });
    assert.equal(ordinaryStart.load().activeGoal, null, 'a fresh session still drops stale work');
    assert.match(String(ordinaryStart.lastError || ''), /Discarded persisted goal state/);

    const explicitRestart = new GoalStateStore(BOT, { root });
    const restored = explicitRestart.load({ allowStaleActiveGoal: true });
    assert.equal(restored.activeGoal?.id, activeGoal.id);
    assert.equal(explicitRestart.lastError, null);
  } finally {
    cleanup();
  }
});

test('explicit Agenda resume rehydrates only the exact stale failed dependency chain', () => {
  const savedAt = Date.now() - (ACTIVITY_STATE_MAX_AGE_MS + 60_000);
  const failed = normalizeAgendaEntry({
    id: 'agenda-1000-1',
    kind: 'inventory_checklist',
    requester: 'DirectorOps',
    inventoryRequirements: [{ target: 'obsidian', quantity: 10 }],
    state: 'failed',
    evidence: { code: 'goal_attempts_exhausted', retryable: false },
  }, { now: () => savedAt });
  const continuation = normalizeAgendaEntry({
    id: 'agenda-1000-2',
    kind: 'portal_build',
    requester: 'DirectorOps',
    radius: 12,
    dependsOnEntryId: failed.id,
    dependencyPolicy: 'requires_success',
    state: 'pending',
  }, { now: () => savedAt });
  const { root, cleanup } = seed('agenda.json', {
    version: 1,
    entries: [failed, continuation],
    savedAt,
  });
  try {
    const store = new AgendaStore(BOT, { root });
    const agent = {
      name: BOT,
      goal_director: { activeGoal: null, lastGoal: null },
      job_director: { activeOrder: null, lastOrder: null },
      behavior_arbiter: { wake() {} },
    };
    const director = new AgendaDirector(agent, { store });
    assert.deepEqual(director.entries, [], 'ordinary startup must still reject stale player work');
    assert.equal(director.status.code, 'agenda_load_failed');

    const resumed = director.resumeFailedChain();
    assert.deepEqual(resumed, { resumed: 2, rootId: failed.id });
    assert.deepEqual(director.entries.map(entry => entry.id), [failed.id, continuation.id]);
    assert.deepEqual(director.entries.map(entry => entry.state), ['pending', 'pending']);
    assert.equal(store.explicitStaleResume, true);
    const persisted = JSON.parse(readFileSync(store.filePath, 'utf8'));
    assert.deepEqual(persisted.entries.map(entry => entry.id), [failed.id, continuation.id]);
    assert.deepEqual(persisted.entries.map(entry => entry.state), ['pending', 'pending']);
    assert.ok(persisted.savedAt > savedAt);
  } finally {
    cleanup();
  }
});

test('explicit Agenda resume cannot resurrect unrelated stale pending work', () => {
  const savedAt = Date.now() - (ACTIVITY_STATE_MAX_AGE_MS + 60_000);
  const failed = normalizeAgendaEntry({
    id: 'agenda-2000-1',
    kind: 'inventory_checklist',
    requester: 'DirectorOps',
    inventoryRequirements: [{ target: 'obsidian', quantity: 10 }],
    state: 'failed',
  }, { now: () => savedAt });
  const unrelated = normalizeAgendaEntry({
    id: 'agenda-2000-2',
    kind: 'goto',
    requester: 'DirectorOps',
    recipient: 'DirectorOps',
    state: 'pending',
  }, { now: () => savedAt });
  const { root, cleanup } = seed('agenda.json', {
    version: 1,
    entries: [failed, unrelated],
    savedAt,
  });
  try {
    const store = new AgendaStore(BOT, { root });
    assert.deepEqual(store.load({ allowStaleFailedChain: true }), []);
    assert.equal(store.explicitStaleResume, false);
    assert.match(String(store.lastError || ''), /Discarded persisted agenda/);
  } finally {
    cleanup();
  }
});

test('CompanionDirectiveStateStore drops a day-old standing directive', () => {
  const stamp = Date.now() - 86_400_000;
  const { root, cleanup } = seed('companion-directive.json', {
    version: 1,
    directive: 'follow',
    requestedName: 'phixxation',
    canonicalUsername: 'phixxation',
    authorizedAt: stamp,
    updatedAt: stamp,
    savedAt: stamp,
  });
  try {
    const store = new CompanionDirectiveStateStore(BOT, { root });
    assert.equal(
      store.snapshot()?.directive ?? null,
      null,
      'a day-old follow order must not resume on its own',
    );
    assert.match(String(store.lastError || ''), /Discarded persisted companion directive/);
  } finally {
    cleanup();
  }
});

test('a fresh standing directive still resumes after a crash restart', () => {
  const stamp = Date.now() - 5_000;
  const { root, cleanup } = seed('companion-directive.json', {
    version: 1,
    directive: 'follow',
    requestedName: 'phixxation',
    canonicalUsername: 'phixxation',
    authorizedAt: stamp,
    updatedAt: stamp,
    savedAt: stamp,
  });
  try {
    const store = new CompanionDirectiveStateStore(BOT, { root });
    assert.equal(store.snapshot()?.directive, 'follow');
    assert.equal(store.lastError, null);
  } finally {
    cleanup();
  }
});
