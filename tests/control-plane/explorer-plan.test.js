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

  const relocateSearch = nextExplorerStep(normalizeWorkOrder({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    evidence: { code: 'source_not_found', detail: 'No cave was observed.', actionId: 'survey-1' },
  }), { inventory: { raw_iron: 2, torch: 8 } });
  assert.equal(relocateSearch.capability.id, 'navigate_exact');
  assert.deepEqual(relocateSearch.capability.arguments, {
    x: 10,
    y: 70,
    z: 68,
    closeness: 8,
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
