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
import { GoalDirector, GoalStateStore } from '../../src/agent/runtime/goal-director.js';
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

test('lifecycle restart preserves the exact Goal and Agenda identities after a misclassified surface preemption', () => {
  const now = Date.now();
  const root = mkdtempSync(path.join(tmpdir(), 'surface-preemption-recovery-'));
  mkdirSync(path.join(root, BOT), { recursive: true });
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DirectorOps',
    target: {
      requestedName: 'diamond_pickaxe',
      canonicalName: 'diamond_pickaxe',
      inventoryName: 'diamond_pickaxe',
      acquisitionName: 'diamond_pickaxe',
      acquisitionKind: 'prepare_tool',
    },
    quantity: 1,
    quantityMode: 'minimum',
  });
  const failedGoal = {
    ...goal,
    phase: 'failed',
    attempts: 0,
    subgoals: [{
      id: `${goal.id}:subgoal-1`,
      kind: 'recover',
      state: 'failed',
      commandName: '!goToSurface',
      attempt: 1,
      actionId: 'surface-interrupted',
      code: 'interrupted',
      detail: 'Self-defense briefly took ownership.',
      learningKey: 'mining-region-surface:diamond-expedition',
      startedAt: now - 500,
      finishedAt: now - 100,
    }],
    evidence: {
      actionId: '',
      phase: 'failed',
      code: 'mining_region_surface_staging_failed',
      detail: 'Self-defense briefly took ownership.',
      verified: false,
      retryable: false,
      at: now - 100,
    },
    updatedAt: now - 100,
  };
  const agendaEntry = normalizeAgendaEntry({
    id: 'agenda-surface-preemption',
    kind: 'inventory_checklist',
    executor: 'goal',
    requester: 'DirectorOps',
    inventoryRequirements: [{ target: 'diamond_pickaxe', quantity: 1 }],
    state: 'failed',
    executorId: goal.id,
    startedAt: now - 1_000,
    finishedAt: now - 50,
    attempts: 1,
    evidence: {
      code: 'mining_region_surface_staging_failed',
      detail: 'Self-defense briefly took ownership.',
      retryable: false,
    },
  }, { now: () => now });
  writeFileSync(path.join(root, BOT, 'goal-state.json'), JSON.stringify({
    version: 1,
    activeGoal: null,
    lastGoal: failedGoal,
    protectedGoalId: null,
    savedAt: now,
  }), 'utf8');
  writeFileSync(path.join(root, BOT, 'agenda.json'), JSON.stringify({
    version: 1,
    entries: [agendaEntry],
    savedAt: now,
  }), 'utf8');

  try {
    const agent = {
      name: BOT,
      lifecycle_restart: true,
      job_director: { activeOrder: null, lastOrder: null },
    };
    agent.goal_director = new GoalDirector(agent, {
      store: new GoalStateStore(BOT, { root }),
      procedures: { find() { return null; } },
      now: () => now,
    });
    agent.agenda_director = new AgendaDirector(agent, {
      store: new AgendaStore(BOT, { root }),
      now: () => now,
    });

    assert.equal(agent.goal_director.activeGoal?.id, goal.id);
    assert.equal(agent.goal_director.activeGoal?.phase, 'recover');
    assert.equal(agent.goal_director.activeGoal?.attempts, 0);
    assert.equal(agent.goal_director.lastGoal, null);
    assert.equal(agent.agenda_director.entries[0].state, 'active');
    assert.equal(agent.agenda_director.entries[0].executorId, goal.id);
    assert.equal(agent.agenda_director.entries[0].attempts, 1);
    assert.equal(agent.agenda_director.entries[0].evidence.code, 'agenda_goal_preemption_recovered');

    const persistedGoal = JSON.parse(readFileSync(path.join(root, BOT, 'goal-state.json'), 'utf8'));
    const persistedAgenda = JSON.parse(readFileSync(path.join(root, BOT, 'agenda.json'), 'utf8'));
    assert.equal(persistedGoal.activeGoal.id, goal.id);
    assert.equal(persistedGoal.lastGoal, null);
    assert.equal(persistedAgenda.entries[0].state, 'active');
    assert.equal(persistedAgenda.entries[0].executorId, goal.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Agenda resume reactivates the exact cancelled Goal without minting a fresh budget', () => {
  const now = Date.now();
  const root = mkdtempSync(path.join(tmpdir(), 'cancelled-goal-resume-'));
  mkdirSync(path.join(root, BOT), { recursive: true });
  try {
    const agent = {
      name: BOT,
      lifecycle_restart: true,
      job_director: { activeOrder: null, lastOrder: null, lastReceipt: null },
      behavior_arbiter: { wake() {} },
    };
    agent.goal_director = new GoalDirector(agent, {
      store: new GoalStateStore(BOT, { root }),
      procedures: { find() { return null; } },
      now: () => now,
    });
    const goal = createItemGoalContract({
      kind: 'acquire',
      requester: 'DirectorOps',
      target: {
        requestedName: 'diamond_pickaxe',
        canonicalName: 'diamond_pickaxe',
        inventoryName: 'diamond_pickaxe',
        acquisitionName: 'diamond_pickaxe',
        acquisitionKind: 'prepare_tool',
      },
      quantity: 1,
      quantityMode: 'minimum',
    });
    assert.equal(agent.goal_director.submit(goal).accepted, true);
    agent.goal_director.persist({
      ...agent.goal_director.activeGoal,
      phase: 'recover',
      attempts: 0,
      subgoals: [{
        id: `${goal.id}:subgoal-1`,
        kind: 'recover',
        state: 'acting',
        commandName: '!goToSurface',
        attempt: 1,
        actionId: 'surface-active',
        code: null,
        detail: '',
        learningKey: 'mining-region-surface:diamond-expedition',
        startedAt: now - 500,
        finishedAt: null,
      }],
    });
    assert.equal(
      agent.goal_director.cancel('Superseded by a player-requested command.'),
      true,
    );
    const agendaEntry = normalizeAgendaEntry({
      id: 'agenda-cancelled-goal',
      kind: 'inventory_checklist',
      executor: 'goal',
      requester: 'DirectorOps',
      inventoryRequirements: [{ target: 'diamond_pickaxe', quantity: 1 }],
      state: 'failed',
      executorId: goal.id,
      startedAt: now - 1_000,
      finishedAt: now,
      attempts: 2,
      evidence: {
        code: 'goal_cancelled',
        detail: 'Superseded by a player-requested command.',
        retryable: false,
      },
    }, { now: () => now });
    writeFileSync(path.join(root, BOT, 'agenda.json'), JSON.stringify({
      version: 1,
      entries: [agendaEntry],
      savedAt: now,
    }), 'utf8');
    agent.agenda_director = new AgendaDirector(agent, {
      store: new AgendaStore(BOT, { root }),
      now: () => now,
    });

    const result = agent.agenda_director.resumeFailedChain('The command-routing owner was repaired.');

    assert.deepEqual(result, { resumed: 1, rootId: agendaEntry.id });
    assert.equal(agent.goal_director.activeGoal?.id, goal.id);
    assert.equal(agent.goal_director.activeGoal?.phase, 'recover');
    assert.equal(agent.goal_director.activeGoal?.attempts, 0);
    assert.equal(agent.goal_director.lastGoal, null);
    assert.equal(agent.agenda_director.entries[0].state, 'active');
    assert.equal(agent.agenda_director.entries[0].executorId, goal.id);
    assert.equal(agent.agenda_director.entries[0].attempts, 2);
    assert.equal(agent.agenda_director.entries[0].evidence.code, 'agenda_goal_explicitly_resumed');
  } finally {
    rmSync(root, { recursive: true, force: true });
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
