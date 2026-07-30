import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceWorkOrder,
  createWorkOrder,
  normalizeWorkOrder,
  reconcileWorkOrder,
} from '../../src/agent/runtime/work-order.js';

test('Given a valid construction request, work-order normalization preserves bounded authoritative fields', () => {
  const order = createWorkOrder({
    id: 'builder-order-1',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    target: { name: 'worksite', x: 10, y: 64, z: -4 },
    quota: 23,
    blueprint: {
      id: 'hut_1',
      width: 3,
      depth: 3,
      height: 3,
      cells: [{ x: 0, y: 0, z: 0, material: 'oak_planks' }],
    },
  });

  assert.equal(order.id, 'builder-order-1');
  assert.equal(order.phase, 'assess');
  assert.equal(order.attempts, 0);
  assert.deepEqual(order.target, { name: 'worksite', x: 10, y: 64, z: -4 });
  assert.equal(Object.isFrozen(order), true);
  assert.deepEqual(normalizeWorkOrder(JSON.parse(JSON.stringify(order))), order);
});

test('Given malformed or unsafe work orders, normalization rejects them before persistence or execution', () => {
  assert.throws(
    () => normalizeWorkOrder({ role: 'builder', kind: 'build', requester: 'bad\nname' }),
    /requester/i,
  );
  assert.throws(
    () => createWorkOrder({
      role: 'builder',
      kind: 'build',
      blueprint: {
        id: 'dup',
        width: 3,
        depth: 3,
        height: 3,
        cells: [
          { x: 0, y: 0, z: 0, material: 'stone' },
          { x: 0, y: 0, z: 0, material: 'stone' },
        ],
      },
    }),
    /duplicate/i,
  );
  assert.throws(
    () => createWorkOrder({ role: 'miner', kind: 'mine', target: { name: '../diamond_ore' } }),
    /canonical/i,
  );
});

test('Given action results, a phase advances only on a new verified success and retryable failures recover boundedly', () => {
  const order = createWorkOrder({
    id: 'mine-1',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  });
  const unchanged = advanceWorkOrder(order, {
    actionId: 'old',
    phase: 'failed',
    retryable: true,
  }, { previousActionId: 'old' });
  assert.equal(unchanged.phase, 'assess');

  const recovery = advanceWorkOrder(order, {
    actionId: 'new',
    phase: 'failed',
    code: 'skill_unreachable',
    retryable: true,
  }, { previousActionId: 'old' });
  assert.equal(recovery.phase, 'recover');
  assert.equal(recovery.attempts, 1);

  const advanced = advanceWorkOrder(order, {
    actionId: 'new',
    phase: 'succeeded',
    code: 'skill_checked',
  }, { previousActionId: 'old', nextPhase: 'prepare' });
  assert.equal(advanced.phase, 'prepare');
});

test('Given a persisted in-flight order after restart, reconciliation forces world revalidation before resuming', () => {
  const order = {
    ...createWorkOrder({
      id: 'log-1',
      role: 'lumberjack',
      kind: 'harvest',
      target: { name: 'oak_log' },
      quota: 8,
    }),
    phase: 'execute',
    checkpoint: { verifiedCount: 3 },
  };

  const reconciled = reconcileWorkOrder(order, {
    inventory: { oak_log: 3 },
    position: { x: 1, y: 64, z: 1 },
  });

  assert.equal(reconciled.phase, 'assess');
  assert.equal(reconciled.resumePhase, 'execute');
  assert.deepEqual(reconciled.checkpoint, { verifiedCount: 3 });
  assert.equal(reconciled.evidence.code, 'restart_revalidation');
});
