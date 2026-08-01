import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyStateUpdate,
  createStateDelta,
  createStateSnapshot,
} from '../../src/mindcraft/public/js/agent-state-protocol.js';

test('state protocol accepts an authoritative snapshot and a contiguous delta', () => {
  const snapshot = createStateSnapshot({
    Scout: { name: 'Scout', health: 20, stale: true },
  }, { Scout: 4 });
  let applied = applyStateUpdate({}, {}, snapshot);
  assert.deepEqual(applied.states, { Scout: { name: 'Scout', health: 20, stale: true } });
  assert.deepEqual(applied.revisions, { Scout: 4 });
  assert.equal(applied.resyncRequired, false);

  applied = applyStateUpdate(
    applied.states,
    applied.revisions,
    createStateDelta('Scout', { health: 18 }, ['stale'], 4, 5),
  );
  assert.deepEqual(applied.states, { Scout: { name: 'Scout', health: 18 } });
  assert.deepEqual(applied.revisions, { Scout: 5 });
  assert.equal(applied.resyncRequired, false);
});

test('state protocol refuses a dropped-delta merge and converges on the next snapshot', () => {
  const initial = applyStateUpdate({}, {}, createStateSnapshot({
    Scout: { name: 'Scout', position: { x: 1 } },
  }, { Scout: 1 }));

  const gap = applyStateUpdate(
    initial.states,
    initial.revisions,
    createStateDelta('Scout', { position: { x: 3 }, health: 14 }, [], 2, 3),
  );
  assert.equal(gap.resyncRequired, true);
  assert.deepEqual(gap.states, initial.states, 'a delta with a missing base must not mutate state');
  assert.deepEqual(gap.revisions, initial.revisions);

  const recovered = applyStateUpdate(gap.states, gap.revisions, createStateSnapshot({
    Scout: { name: 'Scout', position: { x: 3 }, health: 14 },
  }, { Scout: 3 }));
  assert.equal(recovered.resyncRequired, false);
  assert.deepEqual(recovered.states.Scout, { name: 'Scout', position: { x: 3 }, health: 14 });
  assert.deepEqual(recovered.revisions, { Scout: 3 });
});

test('state protocol remains compatible with pre-revision version-two deltas', () => {
  const applied = applyStateUpdate(
    { Scout: { name: 'Scout', health: 20 } },
    {},
    {
      version: 2,
      type: 'delta',
      changes: { Scout: { set: { health: 19 }, unset: [] } },
    },
  );
  assert.equal(applied.resyncRequired, false);
  assert.equal(applied.states.Scout.health, 19);
});
