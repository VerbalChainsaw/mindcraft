import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalLogFamily,
  nextLumberjackStep,
} from '../../src/agent/runtime/jobs/lumberjack-plan.js';
import { capabilityCommand } from '../../src/agent/runtime/capability-catalogue.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Lumberjack recognizes canonical log families and prepares an axe before harvesting', () => {
  assert.equal(canonicalLogFamily('oak_log'), 'oak');
  assert.equal(canonicalLogFamily('warped_stem'), 'warped');
  assert.equal(canonicalLogFamily('oak_planks'), null);
  const order = createWorkOrder({
    id: 'logs-1',
    role: 'lumberjack',
    kind: 'harvest',
    target: { name: 'oak_log' },
    quota: 8,
  });
  const step = nextLumberjackStep(order, {
    inventory: {},
    tools: { axeTier: 0 },
    freeSlots: 10,
    safeTrunks: true,
  });
  assert.equal(step.command, '!prepareTool("stone_axe")');
  assert.equal(step.phase, 'prepare');
});

test('Lumberjack collects only safe reachable trunks and replants only with every verified prerequisite', () => {
  const base = createWorkOrder({
    id: 'logs-2',
    role: 'lumberjack',
    kind: 'harvest',
    target: { name: 'oak_log' },
    quota: 8,
  });
  const blocked = nextLumberjackStep({ ...base, phase: 'execute' }, {
    inventory: {},
    tools: { axeTier: 3 },
    freeSlots: 10,
    safeTrunks: false,
  });
  assert.equal(blocked.code, 'no_safe_reachable_trunk');

  const replant = nextLumberjackStep({ ...base, phase: 'verify' }, {
    inventory: { oak_log: 8, oak_sapling: 1 },
    replant: {
      enabled: true,
      sapling: 'oak_sapling',
      soil: true,
      clearance: true,
      reachable: true,
      x: 5,
      y: 64,
      z: 5,
    },
  });
  assert.equal(replant.command, '!placeBlockAt("oak_sapling", 5, 64, 5)');
  assert.equal(replant.nextPhase, 'deliver');

  const skip = nextLumberjackStep({ ...base, phase: 'verify' }, {
    inventory: { oak_log: 8, oak_sapling: 1 },
    replant: { enabled: true, soil: false, clearance: true, reachable: true },
  });
  assert.equal(skip.phase, 'deliver');
  assert.equal(skip.command, undefined);
});

test('Lumberjack bounds collection by remaining quota and inventory capacity', () => {
  const base = createWorkOrder({
    id: 'logs-3',
    role: 'lumberjack',
    kind: 'harvest',
    target: { name: 'spruce_log' },
    quota: 12,
  });
  const step = nextLumberjackStep({ ...base, phase: 'execute' }, {
    inventory: { spruce_log: 5 },
    tools: { axeTier: 3 },
    freeSlots: 2,
    safeTrunks: true,
  });
  assert.equal(step.command, '!collectBlocksInRange("spruce_log", 7, 64)');
  assert.equal(step.nextPhase, 'verify');

  const full = nextLumberjackStep({ ...base, phase: 'execute' }, {
    inventory: { spruce_log: 5 },
    tools: { axeTier: 3 },
    freeSlots: 1,
    safeTrunks: true,
  });
  assert.equal(full.phase, 'deliver');
  assert.equal(full.code, 'inventory_reserve_reached');

  const deliver = nextLumberjackStep({ ...base, phase: 'deliver' }, {
    inventory: { spruce_log: 12 },
    deposit: { mode: 'leader', leader: 'Director' },
  });
  assert.equal(deliver.capability.id, 'deliver_exact_item');
  assert.equal(capabilityCommand(deliver.capability), '!givePlayer("Director", "spruce_log", 12)');
  assert.equal(deliver.nextPhase, 'complete');

  const familyOrder = createWorkOrder({
    id: 'logs-family',
    role: 'lumberjack',
    kind: 'harvest',
    target: { name: 'logs' },
    quota: 4,
    phase: 'deliver',
  });
  const familyDelivery = nextLumberjackStep(familyOrder, {
    inventory: { oak_log: 4 },
    deposit: { mode: 'leader', leader: 'Director' },
  });
  assert.equal(familyDelivery.capability.id, 'deliver_item_family');
  assert.equal(capabilityCommand(familyDelivery.capability), '!giveFamilyToPlayer("logs", "Director", 4)');
  assert.deepEqual(familyDelivery.checkpointOnVerifiedTransfer, {
    field: 'delivered',
    baseline: 0,
    maximum: 4,
  });
});
