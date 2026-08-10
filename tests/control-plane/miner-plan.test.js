import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalMiningTarget,
  miningOutputName,
  nextMinerStep,
} from '../../src/agent/runtime/jobs/miner-plan.js';
import { capabilityCommand } from '../../src/agent/runtime/capability-catalogue.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

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
