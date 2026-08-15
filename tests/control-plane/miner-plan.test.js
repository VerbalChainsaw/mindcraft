import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalMiningTarget,
  miningOutputName,
  nextMinerStep,
} from '../../src/agent/runtime/jobs/miner-plan.js';
import { capabilityCommand } from '../../src/agent/runtime/capability-catalogue.js';
import { advanceWorkOrder, createWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Miner preserves cobblestone to natural-stone collection mapping and requires a usable pickaxe', () => {
  assert.equal(canonicalMiningTarget('cobblestone'), 'stone');
  const order = createWorkOrder({
    id: 'mine-stone',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  });
  const step = nextMinerStep(order, {
    inventory: {},
    tools: { pickaxeTier: 0 },
    foodPoints: 20,
    lightCount: 8,
    freeSlots: 20,
    escapeRoute: true,
  });
  assert.equal(step.phase, 'prepare');
  assert.equal(step.command, '!prepareTool("wooden_pickaxe")');
  assert.equal(miningOutputName('iron_ore'), 'raw_iron');
});

test('Miner blocks unsafe collection snapshots before selecting a resource action', () => {
  const order = createWorkOrder({
    id: 'mine-ore',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
  });
  for (const [field, code] of [
    ['escapeRoute', 'no_escape_route'],
    ['safeSelectedBlocks', 'unsafe_selected_blocks'],
  ]) {
    const snapshot = {
      inventory: {},
      tools: { pickaxeTier: 4 },
      foodPoints: 20,
      lightCount: 8,
      freeSlots: 20,
      escapeRoute: true,
      safeSelectedBlocks: true,
      [field]: false,
    };
    const step = nextMinerStep(order, snapshot);
    assert.equal(step.blocked, true);
    assert.equal(step.code, code);
  }
});

test('Miner bounds quota collection, verifies inventory, then returns or deposits', () => {
  const base = createWorkOrder({
    id: 'mine-cycle',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  });
  const execute = nextMinerStep({ ...base, phase: 'execute' }, {
    inventory: { cobblestone: 2 },
    tools: { pickaxeTier: 1 },
    foodPoints: 20,
    lightCount: 8,
    freeSlots: 20,
    escapeRoute: true,
    safeSelectedBlocks: true,
  });
  assert.equal(execute.capability.id, 'collect_block');
  assert.equal(execute.capability.arguments.source, 'cobblestone');
  assert.equal(execute.capability.arguments.count, 4);
  assert.equal(execute.capability.arguments.range, 64);
  assert.equal(execute.capability.arguments.output, 'cobblestone');
  assert.equal(execute.capability.arguments.expectedIncrease, 4);
  assert.equal(execute.nextPhase, 'verify');

  const verify = nextMinerStep({ ...base, phase: 'verify' }, {
    inventory: { cobblestone: 6 },
    deposit: { mode: 'leader', leader: 'Director' },
  });
  assert.equal(verify.phase, 'deliver');
  const deliver = nextMinerStep({ ...base, phase: 'deliver' }, {
    inventory: { cobblestone: 6 },
    deposit: { mode: 'leader', leader: 'Director' },
  });
  assert.equal(deliver.capability.id, 'deliver_exact_item');
  assert.equal(capabilityCommand(deliver.capability), '!givePlayer("Director", "cobblestone", 6)');
  assert.equal(deliver.nextPhase, 'complete');
});

test('Miner revalidates a retained quota instead of completing from a stale deliver phase', () => {
  const base = createWorkOrder({
    id: 'mine-retained',
    role: 'miner',
    kind: 'mine',
    target: { name: 'coal_ore' },
    quota: 96,
  });

  assert.deepEqual(nextMinerStep({ ...base, phase: 'deliver' }, {
    inventory: { coal: 64 },
    deposit: { mode: 'inventory' },
  }), {
    phase: 'assess',
    code: 'mining_quota_revalidation_required',
  });
  assert.deepEqual(nextMinerStep({ ...base, phase: 'deliver' }, {
    inventory: { coal: 96 },
    deposit: { mode: 'inventory' },
  }), {
    complete: true,
    code: 'mining_quota_retained',
  });
});

test('Miner exits its verified corridor before completing a retained quota', () => {
  const base = createWorkOrder({
    id: 'mine-retained-return',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'deliver',
    checkpoint: {
      miningReturnRoute: [
        { x: 4, y: 53, z: 8 },
        { x: 4, y: 52, z: 7 },
      ],
      miningReturnIndex: 1,
    },
  });

  const step = nextMinerStep(base, {
    inventory: { raw_iron: 8 },
    deposit: { mode: 'inventory' },
    dimension: 'overworld',
  });
  assert.equal(step.capability.id, 'traverse_mining_route_cell');
  assert.deepEqual(step.capability.arguments, {
    x: 4,
    y: 52,
    z: 7,
    dimension: 'overworld',
  });
  assert.equal(step.nextPhase, 'deliver');
  assert.equal(step.checkpointOnSuccess.miningReturnIndex, 0);
});

test('Miner delegates full retained inventory to bounded collection capacity recovery', () => {
  const base = createWorkOrder({
    id: 'mine-full-retained',
    role: 'miner',
    kind: 'mine',
    target: { name: 'coal_ore' },
    quota: 96,
  });
  const step = nextMinerStep({ ...base, phase: 'execute' }, {
    inventory: { coal: 64 },
    tools: { pickaxeTier: 3 },
    foodPoints: 20,
    hunger: 20,
    lightCount: 40,
    freeSlots: 0,
    escapeRoute: true,
    safeSelectedBlocks: true,
    deposit: { mode: 'inventory' },
  });

  assert.equal(step.capability.id, 'collect_block');
  assert.equal(step.capability.arguments.source, 'coal_ore');
  assert.equal(step.capability.arguments.count, 32);
  assert.equal(step.nextPhase, 'verify');
});

test('Miner manufactures light supplies before an ore job instead of waiting indefinitely', () => {
  const order = createWorkOrder({
    id: 'mine-lit',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
  });
  const step = nextMinerStep(order, {
    inventory: {},
    tools: { pickaxeTier: 4 },
    foodPoints: 20,
    hunger: 20,
    lightCount: 0,
    freeSlots: 20,
    escapeRoute: true,
    safeSelectedBlocks: true,
  });
  assert.equal(step.command, '!prepareMaterial("torch", 16, 64)');
  assert.equal(step.nextPhase, 'assess');
});

test('Miner retry recovery advances a bounded natural-fill search tunnel before rescanning', () => {
  const base = createWorkOrder({
    id: 'mine-recover',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 6,
  });
  const step = nextMinerStep({ ...base, phase: 'recover' }, {});
  assert.equal(step.command, '!mineSearchTunnel("stone", 12)');
  assert.equal(step.nextPhase, 'assess');
});

test('Miner settles after any mining search proves zero physical progress and persists that convergence latch', () => {
  const base = createWorkOrder({
    id: 'mine-search-no-progress',
    role: 'miner',
    kind: 'mine',
    target: { name: 'cobblestone' },
    quota: 8,
  });
  const result = {
    actionId: 'tunnel-1',
    phase: 'failed',
    code: 'skill_no_safe_route',
    label: 'action:mineSearchTunnel',
    detail: 'No preflighted corridor could advance.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'corridor_search_exhausted',
        target: { name: 'stone' },
        routeDigging: true,
        progress: {
          kind: 'mining_search_physical',
          verified: true,
          changed: false,
          distance: 0,
          excavated: 0,
          position: { x: 4, y: 63, z: -7 },
        },
      },
    },
  };
  const recovering = { ...base, phase: 'recover' };
  const step = nextMinerStep(recovering, { x: 4, y: 63, z: -7 }, result);
  assert.deepEqual(step, {
    terminal: true,
    code: 'mining_search_no_progress',
    detail: 'No preflighted corridor could advance.',
    retryable: false,
  });

  const persisted = advanceWorkOrder(recovering, result);
  assert.deepEqual(persisted.checkpoint.miningSearchNoProgress, {
    method: 'action:mineSearchTunnel',
    target: 'stone',
    x: 4,
    y: 63,
    z: -7,
    code: 'skill_no_safe_route',
  });
  assert.equal(
    nextMinerStep(persisted, { x: 4.8, y: 63, z: -6.2 }).code,
    'mining_search_no_progress',
  );
  assert.equal(
    nextMinerStep(persisted, { x: 5, y: 63, z: -7 }).command,
    '!mineSearchTunnel("stone", 12)',
  );

  const progressed = advanceWorkOrder(persisted, {
    actionId: 'tunnel-2',
    phase: 'succeeded',
    code: 'skill_search_advanced',
    label: 'action:mineSearchTunnel',
    retryable: false,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'search_advanced',
        routeDigging: true,
        returnable: true,
        returnRoute: [
          { x: 4, y: 63, z: -7 },
          { x: 5, y: 63, z: -7 },
        ],
      },
    },
  }, { nextPhase: 'assess' });
  assert.equal(progressed.checkpoint.miningSearchNoProgress, undefined);
});

test('Miner retraces a verified mining route before selecting another recovery region', () => {
  const base = createWorkOrder({
    id: 'mine-return-route',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 4,
    phase: 'recover',
    checkpoint: {
      miningReturnRoute: [
        { x: 4, y: 53, z: 8 },
        { x: 4, y: 52, z: 7 },
      ],
      miningReturnIndex: 1,
    },
  });

  const step = nextMinerStep(base, { dimension: 'overworld', y: 50 });
  assert.equal(step.capability.id, 'traverse_mining_route_cell');
  assert.deepEqual(step.capability.arguments, {
    x: 4,
    y: 52,
    z: 7,
    dimension: 'overworld',
  });
  assert.equal(step.nextPhase, 'recover');
  assert.equal(step.recoveryAction, true);
  assert.equal(step.checkpointOnSuccess.miningReturnIndex, 0);
});

test('Miner consumes a persisted tool replacement before retrying the failed mining leg', () => {
  const order = createWorkOrder({
    id: 'mine-tool-replacement',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'recover',
    resumePhase: 'assess',
    checkpoint: {
      toolRequirement: { name: 'stone_pickaxe', minimumUsableDurability: 5 },
      miningReturnRoute: [],
      miningReturnIndex: -1,
    },
  });
  let request = null;
  const capability = Object.freeze({ id: 'craft', arguments: Object.freeze({ item: 'stone_pickaxe', count: 1 }) });
  const step = nextMinerStep(order, { dimension: 'overworld', y: 43 }, null, {
    planItem(value) {
      request = value;
      return {
        status: 'ready',
        nextStep: { capability, learningKey: 'craft:stone_pickaxe', reason: 'A fresh pickaxe is required.' },
      };
    },
  });

  assert.deepEqual(request.toolRequirement, {
    name: 'stone_pickaxe',
    minimumUsableDurability: 5,
  });
  assert.equal(step.capability, capability);
  assert.equal(step.nextPhase, 'recover');
  assert.equal(step.code, 'tool_prerequisite_planned');
});

test('Miner clears a satisfied tool replacement and resumes the productive phase', () => {
  const order = createWorkOrder({
    id: 'mine-tool-ready',
    role: 'miner',
    kind: 'mine',
    target: { name: 'iron_ore' },
    quota: 8,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: {
      toolRequirement: { name: 'stone_pickaxe', minimumUsableDurability: 5 },
    },
  });
  const step = nextMinerStep(order, { dimension: 'overworld', y: 43 }, null, {
    planItem: () => ({ status: 'complete' }),
  });

  assert.equal(step.phase, 'execute');
  assert.equal(step.code, 'tool_prerequisite_ready');
  assert.equal(step.checkpoint.toolRequirement, null);
});
