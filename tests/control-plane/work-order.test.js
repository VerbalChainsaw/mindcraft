import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceWorkOrder,
  checkpointAfterControlHazard,
  createWorkOrder,
  normalizeWorkOrder,
  reconcileWorkOrder,
  resumeFailedWorkOrder,
  workOrderCollectionExclusions,
} from '../../src/agent/runtime/work-order.js';

test('a settled drowning handoff adapts only an active Miner worksite return to dry routing', () => {
  const miner = createWorkOrder({
    role: 'miner',
    kind: 'explore',
    checkpoint: { worksiteReturnPending: true },
  });

  assert.deepEqual(checkpointAfterControlHazard(miner, {
    kind: 'drowning',
    outcome: 'drowning_escape_stable',
  }), {
    worksiteReturnPending: true,
    worksiteReturnDryOnly: true,
  });
  assert.deepEqual(checkpointAfterControlHazard({
    ...miner,
    role: 'builder',
  }, {
    kind: 'drowning',
    outcome: 'drowning_escape_stable',
  }), miner.checkpoint);
});

test('collection exclusions retain failed deepslate variants for the requested ore family', () => {
  const order = createWorkOrder({
    role: 'miner',
    kind: 'explore',
    target: { name: 'ores' },
    checkpoint: {
      failedTargets: [
        { name: 'deepslate_iron_ore', x: 779, y: 0, z: -512 },
        { name: 'coal_ore', x: 770, y: 2, z: -500 },
      ],
    },
  });

  assert.deepEqual(workOrderCollectionExclusions(order, 'iron_ore'), [{
    name: 'deepslate_iron_ore',
    x: 779,
    y: 0,
    z: -512,
    radius: 4,
  }]);
});

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
      acquisitionRequirement: { target: 'oak_planks', quantity: 12 },
      acquisitionVariantCommitted: true,
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
  assert.equal(recovery.resumePhase, 'assess');
  assert.equal(recovery.attempts, 1);
  assert.deepEqual(recovery.checkpoint.failedMethods, ['collect:stone->cobblestone']);
  assert.deepEqual(
    normalizeWorkOrder(JSON.parse(JSON.stringify(recovery))).checkpoint.failedMethods,
    ['collect:stone->cobblestone'],
  );

  const nestedRecovery = advanceWorkOrder(normalizeWorkOrder({
    ...recovery,
    resumePhase: 'prepare',
  }), {
    actionId: 'nested-failure',
    phase: 'failed',
    code: 'skill_unreachable',
    retryable: true,
  }, {
    previousActionId: 'new',
    failedTarget: { name: 'coal_ore', x: 4, y: 40, z: 8 },
  });
  assert.equal(nestedRecovery.phase, 'recover');
  assert.equal(nestedRecovery.resumePhase, 'prepare');

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

  const boundedRecovery = advanceWorkOrder(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
  }), {
    actionId: 'blocked-relocation',
    phase: 'failed',
    code: 'skill_unreachable',
    retryable: true,
  }, { previousActionId: 'old', recoveryAction: true });
  assert.equal(boundedRecovery.phase, 'recover');
  assert.equal(boundedRecovery.resumePhase, 'execute');
  assert.equal(boundedRecovery.attempts, 0);
  assert.equal(boundedRecovery.recoveries, 1);
});

test('Verified mining progress checkpoints the reverse-route cursor before replanning', () => {
  const order = createWorkOrder({
    id: 'mine-route-checkpoint',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'execute',
  });
  const progressed = advanceWorkOrder(order, {
    actionId: 'mining-prefix',
    phase: 'succeeded',
    code: 'capability_verified_partial_progress',
    retryable: false,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'search_advanced',
        routeDigging: true,
        returnable: true,
        returnRoute: [
          { x: 8, y: 53, z: 12 },
          { x: 8, y: 52, z: 11 },
        ],
      },
    },
  }, { nextPhase: 'verify' });

  assert.deepEqual(progressed.checkpoint.miningReturnRoute, [
    { x: 8, y: 53, z: 12 },
    { x: 8, y: 52, z: 11 },
  ]);
  assert.equal(progressed.checkpoint.miningReturnIndex, 1);

  const rebound = advanceWorkOrder(normalizeWorkOrder({
    ...progressed,
    phase: 'execute',
  }), {
    actionId: 'mining-rebound',
    phase: 'succeeded',
    code: 'capability_verified_partial_progress',
    retryable: false,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'search_advanced',
        routeDigging: true,
        returnable: true,
        returnRoute: [
          { x: 8, y: 52, z: 11 },
          { x: 9, y: 51, z: 11 },
        ],
      },
    },
  }, { nextPhase: 'verify' });

  assert.deepEqual(rebound.checkpoint.miningReturnRoute, [
    { x: 8, y: 53, z: 12 },
    { x: 8, y: 52, z: 11 },
    { x: 9, y: 51, z: 11 },
  ]);
  assert.equal(rebound.checkpoint.miningReturnIndex, 2);
});

test('work-order normalization stores one loop-erased mining spine and clamps its cursor', () => {
  const order = createWorkOrder({
    id: 'mine-route-loop-erasure',
    role: 'miner',
    kind: 'explore',
    source: 'player',
    requester: 'Director',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    quota: 11,
    checkpoint: {
      miningReturnRoute: [
        { x: 207, y: 69, z: -359 },
        { x: 208, y: 69, z: -359 },
        { x: 209, y: 68, z: -359 },
        { x: 208, y: 69, z: -359 },
        { x: 210, y: 68, z: -359 },
      ],
      miningReturnIndex: 4,
    },
  });

  assert.deepEqual(order.checkpoint.miningReturnRoute, [
    { x: 207, y: 69, z: -359 },
    { x: 208, y: 69, z: -359 },
    { x: 210, y: 68, z: -359 },
  ]);
  assert.equal(order.checkpoint.miningReturnIndex, 2);
});

test('Verified mining fragments retain the surface route across an open traversable gap', () => {
  const order = createWorkOrder({
    id: 'mine-route-open-gap',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'execute',
    checkpoint: {
      miningReturnRoute: [
        { x: 8103, y: 69, z: 7936 },
        { x: 8116, y: 58, z: 7947 },
      ],
      miningReturnIndex: 1,
    },
  });

  const progressed = advanceWorkOrder(order, {
    actionId: 'mining-open-gap',
    phase: 'succeeded',
    code: 'capability_verified_partial_progress',
    retryable: false,
    evidence: {
      skill: {
        kind: 'collect',
        outcome: 'resource_collected',
        routeDigging: true,
        returnable: true,
        returnRoute: [
          { x: 8123, y: 56, z: 7948 },
          { x: 8124, y: 56, z: 7948 },
        ],
      },
    },
  }, { nextPhase: 'verify' });

  assert.deepEqual(progressed.checkpoint.miningReturnRoute, [
    { x: 8103, y: 69, z: 7936 },
    { x: 8116, y: 58, z: 7947 },
    { x: 8123, y: 56, z: 7948 },
    { x: 8124, y: 56, z: 7948 },
  ]);
  assert.equal(progressed.checkpoint.miningReturnIndex, 3);
});

test('A newly discovered acquisition prerequisite is persisted without spending or blacklisting a productive attempt', () => {
  const order = createWorkOrder({
    id: 'build-tool-recovery',
    role: 'builder',
    kind: 'build',
    target: { name: 'worksite', x: 0, y: 64, z: 0 },
    blueprint: {
      id: 'tool_recovery',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'cobblestone' }],
    },
    phase: 'acquire',
  });
  const failure = {
    actionId: 'worn-pickaxe',
    phase: 'failed',
    code: 'skill_unreachable',
    detail: 'The selected stone route requires a replacement tool.',
    retryable: true,
    evidence: {
      skill: {
        toolRequirement: {
          name: 'wooden_pickaxe',
          minimumUsableDurability: 12,
        },
      },
    },
  };

  const recovery = advanceWorkOrder(order, failure, {
    failedMethod: 'collect:stone->cobblestone',
  });

  assert.equal(recovery.phase, 'recover');
  assert.equal(recovery.attempts, 0);
  assert.equal(recovery.checkpoint.failedMethods, undefined);
  assert.deepEqual(recovery.checkpoint.toolRequirement, {
    name: 'wooden_pickaxe',
    minimumUsableDurability: 12,
  });
  assert.deepEqual(
    normalizeWorkOrder(JSON.parse(JSON.stringify(recovery))).checkpoint.toolRequirement,
    recovery.checkpoint.toolRequirement,
  );

  const repeated = advanceWorkOrder(recovery, {
    ...failure,
    actionId: 'same-worn-pickaxe-again',
  }, {
    previousActionId: 'worn-pickaxe',
    failedMethod: 'collect:stone->cobblestone',
  });
  assert.equal(repeated.attempts, 1);
  assert.deepEqual(repeated.checkpoint.failedMethods, ['collect:stone->cobblestone']);
});

test('Surface access uses the bounded recovery budget without spending productive attempts', () => {
  const order = createWorkOrder({
    id: 'surface-budget',
    role: 'builder',
    kind: 'build',
    target: { name: 'worksite', x: 0, y: 64, z: 0 },
    blueprint: {
      id: 'surface_budget',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'cobblestone' }],
    },
    phase: 'recover',
    attempts: 2,
    recoveries: 3,
    checkpoint: { accessRequirement: { kind: 'surface' } },
  });
  const progressed = advanceWorkOrder(order, {
    actionId: 'surface-progress',
    phase: 'failed',
    code: 'skill_route_step_not_reached',
    retryable: true,
    evidence: {
      skill: {
        kind: 'surface_navigation',
        outcome: 'route_step_not_reached',
        supported: true,
        verticalProgress: 5,
      },
    },
  });
  assert.equal(progressed.phase, 'recover');
  assert.equal(progressed.attempts, 2);
  assert.equal(progressed.recoveries, 3);
  assert.equal(progressed.evidence.code, 'capability_verified_partial_progress');

  const stalled = advanceWorkOrder(progressed, {
    actionId: 'surface-stalled',
    phase: 'failed',
    code: 'skill_return_route_failed',
    retryable: true,
    evidence: {
      skill: {
        kind: 'surface_navigation',
        outcome: 'return_route_failed',
        supported: true,
        verticalProgress: 0,
      },
    },
  });
  assert.equal(stalled.phase, 'recover');
  assert.equal(stalled.attempts, 2);
  assert.equal(stalled.recoveries, 4);

  const reached = advanceWorkOrder(stalled, {
    actionId: 'surface-reached',
    phase: 'succeeded',
    code: 'skill_surface_reached',
    retryable: false,
    evidence: {
      skill: {
        kind: 'surface_navigation',
        outcome: 'surface_reached',
        supported: true,
        verticalProgress: 9,
      },
    },
  }, { nextPhase: 'recover' });
  assert.equal(reached.phase, 'recover');
  assert.equal(reached.attempts, 2);
  assert.equal(reached.recoveries, 4);
  assert.equal(reached.evidence.code, 'skill_surface_reached');
});

test('verified movement during a retryable recovery refreshes the bounded segment without spending a productive attempt', () => {
  const order = createWorkOrder({
    id: 'progressive-relocation',
    role: 'miner',
    kind: 'explore',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    quota: 11,
    phase: 'recover',
    resumePhase: 'execute',
    attempts: 2,
    recoveries: 8,
  });
  const progressiveTimeout = advanceWorkOrder(order, {
    actionId: 'progressive-path-timeout',
    phase: 'failed',
    code: 'skill_path_timeout',
    detail: 'Pathfinder timed out after physically converging.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'path_timeout',
        progress: {
          startMetric: 70,
          lastMetric: 24,
          distance: 46,
          supported: true,
          progressed: true,
          startPosition: { x: 214.9, y: 64, z: -358.5 },
          lastPosition: { x: 191, y: 62, z: -354 },
        },
      },
    },
  }, { recoveryAction: true });

  assert.equal(progressiveTimeout.phase, 'recover');
  assert.equal(progressiveTimeout.resumePhase, 'execute');
  assert.equal(progressiveTimeout.attempts, 2);
  assert.equal(progressiveTimeout.recoveries, 0);
  assert.equal(progressiveTimeout.evidence.code, 'capability_verified_partial_progress');

  const unchangedTimeout = advanceWorkOrder(progressiveTimeout, {
    actionId: 'unchanged-path-timeout',
    phase: 'failed',
    code: 'skill_path_timeout',
    retryable: true,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'path_timeout',
        progress: {
          startMetric: 24,
          lastMetric: 24,
          distance: 0,
          supported: true,
          progressed: false,
          startPosition: { x: 191, y: 62, z: -354 },
          lastPosition: { x: 191, y: 62, z: -354 },
        },
      },
    },
  }, { recoveryAction: true });

  assert.equal(unchangedTimeout.phase, 'recover');
  assert.equal(unchangedTimeout.attempts, 2);
  assert.equal(unchangedTimeout.recoveries, 1);
});

test('a proven dry-route dead end hands the same worksite return to Safety-supervised progressive travel', () => {
  const order = createWorkOrder({
    id: 'open-ocean-return',
    role: 'miner',
    kind: 'explore',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    phase: 'recover',
    resumePhase: 'acquire',
    attempts: 2,
    recoveries: 7,
    checkpoint: {
      worksiteReturnPending: true,
      worksiteReturnDryOnly: true,
    },
  });

  const adapted = advanceWorkOrder(order, {
    actionId: 'dry-waypoint-rejected',
    phase: 'failed',
    code: 'skill_segmented_journey_no_safe_waypoint',
    retryable: false,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'segmented_journey_no_safe_waypoint',
      },
    },
  }, { recoveryAction: true });

  assert.equal(adapted.phase, 'recover');
  assert.equal(adapted.resumePhase, 'acquire');
  assert.equal(adapted.attempts, 2);
  assert.equal(adapted.recoveries, 0);
  assert.equal(adapted.checkpoint.worksiteReturnPending, true);
  assert.equal(adapted.checkpoint.worksiteReturnDryOnly, undefined);
  assert.equal(adapted.evidence.code, 'dry_route_method_rejected');

  const ordinaryRouteStall = advanceWorkOrder(adapted, {
    actionId: 'ordinary-route-stalled',
    phase: 'failed',
    code: 'skill_path_timeout',
    retryable: true,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'path_timeout',
        progress: {
          startMetric: 343,
          lastMetric: 343,
          distance: 0,
          supported: true,
          progressed: false,
          startPosition: { x: 546.5, y: 69, z: -408.5 },
          lastPosition: { x: 546.5, y: 69, z: -408.5 },
        },
      },
    },
  }, { recoveryAction: true });
  assert.equal(ordinaryRouteStall.phase, 'recover');
  assert.equal(ordinaryRouteStall.recoveries, 1);
});

test('a failed recovery persists the exact stalled Pathfinder step without spending productive attempts', () => {
  const order = createWorkOrder({
    id: 'learned-worksite-route',
    role: 'miner',
    kind: 'explore',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    phase: 'recover',
    resumePhase: 'acquire',
    anchor: { x: 207, y: 69, z: -359 },
    checkpoint: { worksiteReturnPending: true },
  });

  const recovery = advanceWorkOrder(order, {
    actionId: 'stalled-edge-1',
    phase: 'failed',
    code: 'skill_path_stalled',
    retryable: true,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'path_stalled',
        recovery: {
          excludedStep: {
            x: 820,
            y: 63,
            z: -544,
            source: { x: 819, y: 63, z: -543 },
            locomotion: 'walk',
          },
        },
      },
    },
  }, { recoveryAction: true, nextPhase: 'acquire' });

  assert.equal(recovery.phase, 'recover');
  assert.equal(recovery.attempts, 0);
  assert.equal(recovery.recoveries, 1);
  assert.deepEqual(recovery.checkpoint.navigationStepExclusions, [{
    x: 820,
    y: 63,
    z: -544,
    source: { x: 819, y: 63, z: -543 },
    locomotion: 'walk',
  }]);
  assert.deepEqual(
    normalizeWorkOrder(JSON.parse(JSON.stringify(recovery))).checkpoint.navigationStepExclusions,
    recovery.checkpoint.navigationStepExclusions,
  );
});

test('verified segmented journey progress refreshes the bounded recovery segment', () => {
  const order = createWorkOrder({
    id: 'segmented-worksite-return',
    role: 'miner',
    kind: 'explore',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    quota: 11,
    phase: 'recover',
    resumePhase: 'assess',
    attempts: 2,
    recoveries: 7,
  });
  const advanced = advanceWorkOrder(order, {
    actionId: 'segmented-return-1',
    phase: 'failed',
    code: 'skill_segmented_journey_incomplete',
    retryable: true,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'segmented_journey_incomplete',
        progressed: 18,
        segments: [{
          executed: true,
          outcome: 'progress_verified',
          terminal: { x: 812, y: 66, z: -501 },
          safety: { supported: true, nonHazardous: true },
        }],
      },
    },
  }, { recoveryAction: true });

  assert.equal(advanced.phase, 'recover');
  assert.equal(advanced.resumePhase, 'assess');
  assert.equal(advanced.attempts, 2);
  assert.equal(advanced.recoveries, 0);
  assert.equal(advanced.evidence.code, 'capability_verified_partial_progress');
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

test('a named safety suspension holds the work order without spending any budget', () => {
  const order = createWorkOrder({
    id: 'suspended-mining-1',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'execute',
    attempts: 2,
    recoveries: 1,
    preemptions: 4,
  });

  const suspended = advanceWorkOrder(order, {
    actionId: 'mine-action-1',
    phase: 'interrupted',
    code: 'interrupted',
    detail: 'A skeleton started the safety incident.',
    retryable: true,
    continuation: { kind: 'resume_same' },
  }, {
    previousActionId: 'mine-action-0',
    nextPhase: 'verify',
    safetySuspended: true,
    now: 12_000,
  });

  assert.equal(suspended.phase, 'execute');
  assert.equal(suspended.attempts, 2);
  assert.equal(suspended.recoveries, 1);
  assert.equal(suspended.preemptions, 4);
  assert.equal(suspended.evidence.code, 'safety_suspended');
  assert.equal(suspended.evidence.actionId, 'mine-action-1');
});

test('an explicit player resume re-arms the same failed order and preserves its verified checkpoint', () => {
  const failed = createWorkOrder({
    id: 'builder-resume-1',
    role: 'builder',
    kind: 'build',
    source: 'player',
    target: { name: 'worksite', x: 4, y: 64, z: 8 },
    quota: 12,
    phase: 'failed',
    attempts: 3,
    recoveries: 4,
    preemptions: 7,
    checkpoint: {
      verifiedCount: 5,
      nextCell: 5,
      failedMethods: ['collect:acacia_log->acacia_log'],
      failedTargets: [{ name: 'acacia_log', x: 9, y: 70, z: 12 }],
    },
    evidence: { code: 'action_pattern_detected', detail: 'old failure', actionId: 'old-action' },
  });

  const resumed = resumeFailedWorkOrder(failed, 12_345);

  assert.equal(resumed.id, failed.id);
  assert.equal(resumed.phase, 'assess');
  assert.equal(resumed.attempts, 0);
  assert.equal(resumed.recoveries, 0);
  assert.equal(resumed.preemptions, 0);
  assert.equal(resumed.checkpoint.verifiedCount, 5);
  assert.equal(resumed.checkpoint.nextCell, 5);
  assert.equal(resumed.checkpoint.failedMethods, undefined);
  assert.deepEqual(resumed.checkpoint.failedTargets, failed.checkpoint.failedTargets);
  assert.equal(resumed.evidence.code, 'player_resume_requested');

  const completed = normalizeWorkOrder({ ...failed, phase: 'complete' });
  assert.equal(resumeFailedWorkOrder(completed).phase, 'complete');
});

test('an explicit mining resume clears exhausted strategy counters but preserves physical progress', () => {
  const failed = createWorkOrder({
    id: 'miner-resume-1',
    role: 'miner',
    kind: 'explore',
    source: 'player',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    quota: 11,
    phase: 'failed',
    attempts: 1,
    recoveries: 2,
    checkpoint: {
      acquisitionStrategy: 'mining_corridor',
      baselineFamilyCounts: { coal: 5, raw_iron: 5 },
      requiredOutputs: [
        { source: 'iron_ore', item: 'raw_iron', quantity: 8 },
        { source: 'coal_ore', item: 'coal', quantity: 3 },
      ],
      corridorRequirementItem: 'coal',
      corridorRequirementProgress: 0,
      caveSearchRelocations: 4,
      miningRegionRelocations: 2,
      corridorSearchLegs: 8,
      miningRelocationPending: true,
      lastFailedTargetActionId: 'failed-coal-leg',
      miningReturnRoute: [{ x: 755, y: 7, z: -520 }],
      failedTargets: [{ name: 'coal_ore', x: 747, y: 14, z: -508 }],
    },
    evidence: {
      code: 'mining_strategy_exhausted',
      detail: 'Partial relocations exhausted the old strategy counters.',
      actionId: 'failed-coal-leg',
    },
  });

  const resumed = resumeFailedWorkOrder(failed, 12_345);

  assert.equal(resumed.checkpoint.caveSearchRelocations, undefined);
  assert.equal(resumed.checkpoint.miningRegionRelocations, undefined);
  assert.equal(resumed.checkpoint.corridorSearchLegs, undefined);
  assert.equal(resumed.checkpoint.miningRelocationPending, undefined);
  assert.equal(resumed.checkpoint.lastFailedTargetActionId, undefined);
  assert.deepEqual(resumed.checkpoint.baselineFamilyCounts, failed.checkpoint.baselineFamilyCounts);
  assert.deepEqual(resumed.checkpoint.requiredOutputs, failed.checkpoint.requiredOutputs);
  assert.equal(resumed.checkpoint.corridorRequirementItem, 'coal');
  assert.equal(resumed.checkpoint.corridorRequirementProgress, 0);
  assert.deepEqual(resumed.checkpoint.miningReturnRoute, failed.checkpoint.miningReturnRoute);
  assert.deepEqual(resumed.checkpoint.failedTargets, failed.checkpoint.failedTargets);
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
