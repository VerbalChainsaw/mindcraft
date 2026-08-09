import assert from 'node:assert/strict';
import test from 'node:test';

import { nextExplorerStep } from '../../src/agent/runtime/jobs/explorer-plan.js';
import { createWorkOrder, normalizeWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Explorer composes preparation, cave survey, exposed ore, exact return, and manifest storage', () => {
  let order = createWorkOrder({
    id: 'explore-cave',
    role: 'miner',
    kind: 'explore',
    source: 'player',
    requester: 'Director',
    target: { name: 'ores', x: 10, y: 70, z: 20 },
    quota: 2,
    checkpoint: {
      homeDimension: 'overworld',
      containerName: 'chest',
      containerX: 11,
      containerY: 70,
      containerZ: 20,
      containerDimension: 'overworld',
    },
  });
  const baseline = nextExplorerStep(order, { inventory: { raw_iron: 2 } });
  assert.equal(baseline.phase, 'prepare');
  order = normalizeWorkOrder({ ...order, phase: baseline.phase, checkpoint: baseline.checkpoint });

  const ready = nextExplorerStep(order, { inventory: { raw_iron: 2 } }, null, {
    planItem: () => ({ status: 'complete' }),
  });
  assert.equal(ready.phase, 'execute');
  const recoverSupplies = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'prepare',
  }), { inventory: { raw_iron: 2 } }, null, {
    planItem: ({ target }) => target === 'stone_pickaxe'
      ? { status: 'complete' }
      : {
          status: 'ready',
          nextStep: {
            capability: { id: 'collect_block', arguments: {} },
            learningKey: 'collect:coal_ore->coal',
          },
        },
  });
  assert.equal(recoverSupplies.capability.id, 'collect_block');
  assert.equal(recoverSupplies.code, 'expedition_light_prerequisite');

  const recoverInterruptedSurvey = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
  }), { inventory: { raw_iron: 2 } }, null, {
    planItem: ({ target }) => target === 'stone_pickaxe'
      ? { status: 'complete' }
      : {
          status: 'ready',
          nextStep: {
            capability: { id: 'craft_item', arguments: { item: 'torch', count: 8 } },
            learningKey: 'craft:torch',
          },
        },
  });
  assert.equal(recoverInterruptedSurvey.capability.id, 'craft_item');
  assert.equal(recoverInterruptedSurvey.code, 'expedition_light_prerequisite');

  let mergedToolRequirement = null;
  const replaceExpeditionTool = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: {
      ...order.checkpoint,
      acquisitionStrategy: 'mining_corridor',
      toolRequirement: { name: 'wooden_pickaxe', minimumUsableDurability: 5 },
    },
  }), { inventory: { raw_iron: 2 }, y: 40 }, null, {
    planItem: request => {
      mergedToolRequirement = request.toolRequirement;
      return {
        status: 'ready',
        nextStep: { capability: { id: 'craft_item', arguments: { item: request.target, count: 1 } } },
      };
    },
  });
  assert.equal(replaceExpeditionTool.capability.id, 'craft_item');
  assert.deepEqual(mergedToolRequirement, {
    name: 'stone_pickaxe',
    minimumUsableDurability: 48,
  });

  const relocateSearch = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    evidence: { code: 'source_not_found', detail: 'No cave was observed.', actionId: 'survey-1' },
  }), { inventory: { raw_iron: 2, torch: 8 } });
  assert.equal(relocateSearch.capability.id, 'relocate_search_region');
  assert.deepEqual(relocateSearch.capability.arguments, {
    x: 10,
    y: 70,
    z: 68,
    closeness: 8,
    minimumDisplacement: 16,
    dimension: 'overworld',
  });
  assert.equal(relocateSearch.recoveryAction, true);
  assert.deepEqual(relocateSearch.checkpointOnSuccess.caveSearchRelocations, 1);

  const exhaustedSearch = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: { ...order.checkpoint, caveSearchRelocations: 8 },
    evidence: { code: 'source_not_found', detail: 'No cave was observed.', actionId: 'survey-3' },
  }), { inventory: { raw_iron: 2, torch: 8 } });
  assert.equal(exhaustedSearch.terminal, true);
  assert.equal(exhaustedSearch.code, 'cave_search_exhausted');

  const retainedOrder = normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    quota: 8,
    checkpoint: {
      ...order.checkpoint,
      retainResults: true,
      caveSearchRelocations: 2,
      requiredOutputs: [
        { source: 'iron_ore', item: 'raw_iron', quantity: 1 },
        { source: 'coal_ore', item: 'coal', quantity: 1 },
      ],
    },
    evidence: { code: 'source_not_found', detail: 'No more cave stances were observed.', actionId: 'survey-retained' },
  });
  const switchStrategy = nextExplorerStep(retainedOrder, {
    inventory: { raw_iron: 2 },
    x: 58,
    y: 70,
    z: 20,
  });
  assert.equal(switchStrategy.phase, 'execute');
  assert.equal(switchStrategy.code, 'expedition_strategy_changed');
  assert.equal(switchStrategy.checkpoint.acquisitionStrategy, 'mining_corridor');

  const corridorOrder = normalizeWorkOrder({
    ...retainedOrder,
    phase: 'execute',
    resumePhase: null,
    checkpoint: switchStrategy.checkpoint,
  });
  const reachDepth = nextExplorerStep(corridorOrder, {
    inventory: { raw_iron: 2 },
    y: 70,
  });
  assert.equal(reachDepth.capability.id, 'reach_mining_depth');
  assert.deepEqual(reachDepth.capability.arguments, {
    targetY: 16,
    range: 64,
    preservedReturnRoute: [],
  });

  const advanceCorridor = nextExplorerStep(corridorOrder, {
    inventory: { raw_iron: 2 },
    y: 16,
  });
  assert.equal(advanceCorridor.capability.id, 'advance_mining_corridor');
  assert.deepEqual(advanceCorridor.capability.arguments, {
    source: 'iron_ore',
    output: 'raw_iron',
    length: 8,
    preservedReturnRoute: [],
  });
  assert.equal(advanceCorridor.checkpointOnSuccess.corridorSearchLegs, 1);

  const reuseCurrentDepthForCoal = nextExplorerStep(corridorOrder, {
    inventory: { raw_iron: 3 },
    y: 16,
  });
  assert.equal(reuseCurrentDepthForCoal.capability.id, 'advance_mining_corridor');
  assert.deepEqual(reuseCurrentDepthForCoal.capability.arguments, {
    source: 'coal_ore',
    output: 'coal',
    length: 8,
    preservedReturnRoute: [],
  });

  const corridorComplete = nextExplorerStep(corridorOrder, {
    inventory: { raw_iron: 3, coal: 7 },
    y: 16,
  });
  assert.equal(corridorComplete.phase, 'deliver');
  assert.equal(corridorComplete.code, 'expedition_required_outputs_met');

  const bestEffortCorridor = nextExplorerStep(normalizeWorkOrder({
    ...corridorOrder,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: {
      ...corridorOrder.checkpoint,
      bestEffort: true,
      corridorSearchLegs: 7,
    },
    evidence: {
      code: 'skill_stance_unverified',
      detail: 'The next bounded corridor had no verified safe stance.',
      actionId: 'corridor-partial',
    },
  }), {
    inventory: { raw_iron: 8, coal: 1 },
    y: 16,
  }, null, {
    planItem: () => ({ status: 'complete' }),
  });
  assert.equal(bestEffortCorridor.phase, 'deliver');
  assert.equal(bestEffortCorridor.code, 'expedition_best_effort_corridor_complete');
  assert.deepEqual(bestEffortCorridor.checkpoint.collectedManifest, [
    { item: 'raw_iron', quantity: 6 },
    { item: 'coal', quantity: 1 },
  ]);

  const returningOrder = normalizeWorkOrder({
    ...corridorOrder,
    phase: 'deliver',
    checkpoint: {
      ...corridorOrder.checkpoint,
      miningReturnRoute: [
        { x: 30, y: 40, z: 20 },
        { x: 31, y: 39, z: 20 },
      ],
    },
  });
  const reverseRoute = nextExplorerStep(returningOrder, {
    inventory: { raw_iron: 3, coal: 7 },
    dimension: 'overworld',
    x: 31,
    y: 39,
    z: 20,
  });
  assert.equal(reverseRoute.capability.id, 'traverse_mining_route_cell');
  assert.deepEqual(reverseRoute.capability.arguments, {
    x: 31,
    y: 39,
    z: 20,
    dimension: 'overworld',
  });
  assert.equal(reverseRoute.recoveryAction, true);
  assert.equal(reverseRoute.checkpointOnSuccess.miningReturnIndex, 0);

  const retainedAtRouteExit = nextExplorerStep(normalizeWorkOrder({
    ...returningOrder,
    checkpoint: {
      ...returningOrder.checkpoint,
      miningReturnIndex: -1,
      collectedManifest: [
        { item: 'raw_iron', quantity: 1 },
        { item: 'coal', quantity: 1 },
      ],
    },
  }), {
    inventory: { raw_iron: 3, coal: 7 },
    dimension: 'overworld',
    x: 31,
    y: 39,
    z: 20,
  });
  assert.equal(retainedAtRouteExit.complete, true);
  assert.equal(retainedAtRouteExit.code, 'expedition_results_retained');
  assert.equal(retainedAtRouteExit.checkpoint.collected, 2);

  const boundedPartial = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: {
      ...order.checkpoint,
      bestEffort: true,
      caveSearchRelocations: 8,
    },
    evidence: { code: 'source_not_found', detail: 'No more caves were observed.', actionId: 'survey-4' },
  }), { inventory: { raw_iron: 2, coal: 3 } });
  assert.equal(boundedPartial.phase, 'deliver');
  assert.equal(boundedPartial.code, 'expedition_best_effort_collection_complete');
  assert.deepEqual(boundedPartial.checkpoint.collectedManifest, [{ item: 'coal', quantity: 3 }]);

  order = normalizeWorkOrder({ ...order, phase: 'execute' });

  const survey = nextExplorerStep(order, { inventory: { raw_iron: 2 } }, null, {
    planItem: () => ({ status: 'complete' }),
  });
  assert.equal(survey.capability.id, 'survey_nearby_cave');
  assert.equal(survey.nextPhase, 'execute');
  assert.equal(survey.checkpointOnSuccess.caveLightingComplete, true);
  order = normalizeWorkOrder({
    ...order,
    checkpoint: { ...order.checkpoint, caveLit: true, caveLightingComplete: true },
  });

  const recoverCollection = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
  }), { inventory: { raw_iron: 3 } });
  assert.equal(recoverCollection.capability.id, 'collect_exposed_ore');

  const exhaustedCave = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    evidence: {
      code: 'resource_not_found',
      detail: 'No untried exposed ore was observed in this cave region.',
      actionId: 'collect-1',
    },
  }), { inventory: { raw_iron: 3 } });
  assert.equal(exhaustedCave.phase, 'execute');
  assert.equal(exhaustedCave.code, 'cave_region_exhausted');
  assert.equal(exhaustedCave.checkpoint.caveLit, false);

  const collect = nextExplorerStep(order, { inventory: { raw_iron: 3 } });
  assert.equal(collect.capability.id, 'collect_exposed_ore');
  assert.equal(collect.methodKey, 'collect:exposed_ore->ores');

  const collected = nextExplorerStep(order, { inventory: { raw_iron: 4 } });
  assert.equal(collected.phase, 'deliver');
  assert.deepEqual(collected.checkpoint.collectedManifest, [{ item: 'raw_iron', quantity: 2 }]);
  order = normalizeWorkOrder({ ...order, phase: 'deliver', checkpoint: collected.checkpoint });

  const returnHome = nextExplorerStep(order, {
    inventory: { raw_iron: 4 },
    dimension: 'overworld',
    x: 30,
    y: 50,
    z: 40,
  });
  assert.equal(returnHome.capability.id, 'navigate_exact');
  assert.deepEqual(returnHome.capability.arguments, {
    x: 10,
    y: 70,
    z: 20,
    closeness: 2,
    dimension: 'overworld',
  });

  const store = nextExplorerStep(order, {
    inventory: { raw_iron: 4 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  });
  assert.equal(store.capability.id, 'store_exact_item');
  assert.deepEqual(store.capability.arguments, {
    item: 'raw_iron',
    quantity: 2,
    container: {
      name: 'chest',
      x: 11,
      y: 70,
      z: 20,
      dimension: 'overworld',
    },
  });
  assert.deepEqual(store.checkpointOnVerifiedTransfer, {
    field: 'deliveryOffset',
    baseline: 0,
    maximum: 2,
  });

  const complete = nextExplorerStep(normalizeWorkOrder({
    ...order,
    checkpoint: { ...order.checkpoint, deliveryIndex: 1, deliveryOffset: 0 },
  }), {
    inventory: { raw_iron: 2 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.code, 'expedition_stored_at_home');
});
