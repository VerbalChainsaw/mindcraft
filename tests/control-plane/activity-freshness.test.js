import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ACTIVITY_STATE_MAX_AGE_MS,
  isStaleActivityState,
} from '../../src/agent/runtime/activity-freshness.js';
import { CompanionDirectiveStateStore } from '../../src/agent/runtime/companion-directive-state.js';
import { JobStateStore } from '../../src/agent/runtime/job-state-store.js';

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
