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
      cells: [
        { x: 0, y: 0, z: 0, material: 'oak_planks' },
        {
          x: 0,
          y: 1,
          z: 0,
          material: 'oak_door',
          function: 'access',
          fixtureId: 'door_1',
          facing: 'east',
        },
      ],
      fixtures: [{
        id: 'door_1',
        kind: 'door',
        material: 'oak_door',
        function: 'access',
        facing: 'east',
        anchor: { x: 0, y: 1, z: 0 },
        occupiedOffsets: [
          { x: 0, y: 0, z: 0, part: 'lower' },
          { x: 0, y: 1, z: 0, part: 'upper' },
        ],
        supportOffsets: [{ x: 0, y: -1, z: 0 }],
      }],
    },
    checkpoint: {
      toolRequirement: { name: 'stone_pickaxe', minimumUsableDurability: 24 },
      workstationRequirement: { name: 'crafting_table', carried: true },
    },
  });

  assert.equal(order.id, 'builder-order-1');
  assert.equal(order.phase, 'assess');
  assert.equal(order.attempts, 0);
  assert.deepEqual(order.target, { name: 'worksite', x: 10, y: 64, z: -4 });
  assert.equal(Object.isFrozen(order), true);
  assert.equal(Object.isFrozen(order.blueprint.fixtures), true);
  assert.equal(order.blueprint.fixtures[0].facing, 'east');
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
  }, {
    previousActionId: 'old',
    failedMethod: 'collect:stone->cobblestone',
  });
  assert.equal(recovery.phase, 'recover');
  assert.equal(recovery.attempts, 1);
  assert.deepEqual(recovery.checkpoint.failedMethods, ['collect:stone->cobblestone']);
  assert.deepEqual(
    normalizeWorkOrder(JSON.parse(JSON.stringify(recovery))).checkpoint.failedMethods,
    ['collect:stone->cobblestone'],
  );

  const advanced = advanceWorkOrder(order, {
    actionId: 'new',
    phase: 'succeeded',
    code: 'skill_checked',
  }, { previousActionId: 'old', nextPhase: 'prepare' });
  assert.equal(advanced.phase, 'prepare');

  const recoveredProgress = advanceWorkOrder(recovery, {
    actionId: 'progress',
    phase: 'succeeded',
    code: 'skill_crafted',
  }, { previousActionId: 'new', nextPhase: 'assess' });
  assert.equal(recoveredProgress.attempts, 0);

  const capacityBlocked = advanceWorkOrder(order, {
    actionId: 'capacity',
    phase: 'failed',
    code: 'skill_no_safe_release',
    detail: 'No protected inventory slot can be released.',
    retryable: true,
  }, { previousActionId: 'old' });
  assert.equal(capacityBlocked.phase, 'failed');
  assert.equal(capacityBlocked.attempts, 0);
  assert.equal(capacityBlocked.evidence.code, 'inventory_capacity_blocked');
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

test('Given a reflex preemption, the work order holds its phase and spends no recovery attempt', () => {
  const order = createWorkOrder({
    id: 'chop-1',
    role: 'lumberjack',
    kind: 'harvest',
    target: { name: 'oak_log' },
    quota: 16,
    phase: 'execute',
  });

  let held = order;
  // Three fights in a row used to exhaust maxAttempts and kill the job, and
  // each one routed the order through `recover`, which walks the bot 32 blocks
  // away from the trees it was cutting.
  for (let fight = 1; fight <= 3; fight += 1) {
    held = advanceWorkOrder(held, {
      actionId: `fight-${fight}`,
      phase: 'interrupted',
      code: 'interrupted',
      retryable: true,
    }, { previousActionId: `fight-${fight - 1}`, nextPhase: 'verify' });
    assert.equal(held.phase, 'execute');
    assert.equal(held.attempts, 0);
    assert.equal(held.preemptions, fight);
    assert.equal(held.evidence.code, 'preempted');
  }

  // Verified progress after the fight clears the preemption budget so a long
  // job is never killed by interruptions it already recovered from.
  const resumed = advanceWorkOrder(held, {
    actionId: 'chopped',
    phase: 'succeeded',
    code: 'skill_checked',
  }, { previousActionId: 'fight-3', nextPhase: 'verify' });
  assert.equal(resumed.phase, 'verify');
  assert.equal(resumed.preemptions, 0);

  // A genuine failure still recovers boundedly; preemption did not weaken it.
  const failed = advanceWorkOrder(held, {
    actionId: 'no-trees',
    phase: 'failed',
    code: 'skill_unreachable',
    retryable: true,
  }, { previousActionId: 'fight-3' });
  assert.equal(failed.phase, 'recover');
  assert.equal(failed.attempts, 1);
});

test('Given endless preemption, the work order still fails instead of retrying forever', () => {
  let order = createWorkOrder({
    id: 'pinned-1',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'execute',
  });
  for (let tick = 1; tick <= 40; tick += 1) {
    order = advanceWorkOrder(order, {
      actionId: `tick-${tick}`,
      phase: 'interrupted',
      code: 'interrupted',
      retryable: true,
    }, { previousActionId: `tick-${tick - 1}` });
    if (order.phase !== 'execute') break;
  }
  assert.notEqual(order.phase, 'execute');
  assert.ok(order.preemptions <= 24);
});

test('Given a work order anchor, only finite coordinates are kept', () => {
  const anchored = createWorkOrder({
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    anchor: { x: 10.9, y: 63.2, z: -4.1 },
  });
  assert.deepEqual(anchored.anchor, { x: 10, y: 63, z: -5 });
  const unanchored = createWorkOrder({
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    anchor: { x: 10, y: Number.NaN, z: 4 },
  });
  assert.equal(unanchored.anchor, null);
});
