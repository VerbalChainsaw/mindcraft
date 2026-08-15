import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
  classifyDisposition,
  compilePlayerIntentLedger,
  detectMaterialPlayerClarification,
  resolvePlayerPlanDisposition,
  resolveMaterialPlayerClarification,
  splitAgendaSegments,
  directiveToAgendaEntry,
  parsePlayerAgenda,
} from '../../src/agent/player-agenda.js';
import { normalizeAgendaEntry } from '../../src/agent/runtime/agenda.js';
import { createAccessRepairWorkOrder } from '../../src/agent/runtime/access-repair.js';
import { resolvePlayerDirective } from '../../src/agent/player-directives.js';

test('classifyDisposition flags interrupt words and defaults to append', () => {
  assert.equal(classifyDisposition('stop and come here'), 'interrupt');
  assert.equal(classifyDisposition('now mine 10 iron'), 'interrupt');
  assert.equal(classifyDisposition('forget that, follow me'), 'interrupt');
  assert.equal(classifyDisposition('mine stone right now'), 'interrupt');
  assert.equal(classifyDisposition('build a shelter instead'), 'interrupt');
  assert.equal(classifyDisposition('get 5 logs then build a shelter'), 'append');
  assert.equal(classifyDisposition('also grab some cobblestone'), 'append');
  assert.equal(classifyDisposition(''), 'append');
});

test('resolvePlayerPlanDisposition replaces held work without mistaking compilation Hold for authority', () => {
  const cleanup = 'clean up your inventory for the day, then come back to me';
  assert.equal(resolvePlayerPlanDisposition(cleanup), 'append');
  assert.equal(resolvePlayerPlanDisposition(cleanup, {
    agendaBusy: true,
    operatorHeld: true,
  }), 'interrupt');
  assert.equal(resolvePlayerPlanDisposition(cleanup, {
    agendaBusy: true,
    operatorHeld: false,
  }), 'append');
  assert.equal(resolvePlayerPlanDisposition(cleanup, {
    agendaBusy: true,
    operatorHeld: true,
    compilingConstruction: true,
  }), 'append');
  assert.equal(resolvePlayerPlanDisposition('actually, clean up your inventory', {
    agendaBusy: true,
    operatorHeld: false,
  }), 'interrupt');
});

test('complete player intent compiles into one immutable effect ledger and unresolved clauses fail closed', () => {
  const completePlan = {
    steps: [
      {
        segment: 'mine four cobblestone without damaging our builds',
        entry: { kind: 'mine', requester: 'DadPlayer', target: 'cobblestone', quantity: 4 },
      },
      {
        segment: 'return to DadPlayer and wait',
        entry: {
          kind: 'goto',
          requester: 'DadPlayer',
          recipient: 'DadPlayer',
          terminalDisposition: 'hold_position',
        },
        dependency: { policy: 'requires_success' },
      },
    ],
    unresolved: [],
  };
  const receipt = compilePlayerIntentLedger(
    'DadPlayer',
    'Mine four cobblestone without damaging our builds, then come back to me and wait.',
    completePlan,
  );
  assert.equal(receipt.status, 'complete');
  assert.equal(receipt.code, 'player_intent_complete');
  assert.deepEqual(receipt.participants, ['DadPlayer']);
  assert.deepEqual(receipt.effects.map(effect => [effect.kind, effect.quantity, effect.recipient]), [
    ['mine', 4, ''],
    ['goto', 0, 'DadPlayer'],
  ]);
  assert.deepEqual(receipt.preservationConstraints, ['mine four cobblestone without damaging our builds']);
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.effects));
  assert.ok(Object.isFrozen(receipt.effects[0]));

  const incomplete = compilePlayerIntentLedger('DadPlayer', 'Mine stone, sing, then return.', {
    ...completePlan,
    unresolved: [{ segment: 'sing our family song' }],
  });
  assert.equal(incomplete.status, 'incomplete');
  assert.deepEqual(incomplete.issues, ['unresolved_clauses']);
  assert.deepEqual(incomplete.unresolved, ['sing our family song']);
});

test('splitAgendaSegments splits on connectives, preserves order, strips filler', () => {
  assert.deepEqual(
    splitAgendaSegments('get 5 logs then build a shelter'),
    ['get 5 logs', 'build a shelter'],
  );
  assert.deepEqual(
    splitAgendaSegments('mine 10 iron and then come here'),
    ['mine 10 iron', 'come here'],
  );
  assert.deepEqual(
    splitAgendaSegments('harvest wood after that stockpile cobblestone; also come here'),
    ['harvest wood', 'stockpile cobblestone', 'come here'],
  );
  assert.deepEqual(
    splitAgendaSegments('mine 5 iron once you are done come to me'),
    ['mine 5 iron', 'come to me'],
  );
  assert.deepEqual(
    splitAgendaSegments('mine 8 fresh raw iron, then come back to me and wait'),
    ['mine 8 fresh raw iron,', 'come back to me', 'wait'],
  );
});

test('splitAgendaSegments does not split on a bare comma', () => {
  assert.deepEqual(
    splitAgendaSegments('get 5 logs, please'),
    ['get 5 logs, please'],
  );
  assert.deepEqual(
    splitAgendaSegments('build an outpost with a bed, a furnace, and a chest, and come here'),
    ['build an outpost with a bed, a furnace, and a chest', 'come here'],
  );
});

test('parsePlayerAgenda preserves named visit, exact container inspection, report, return, and terminal hold', () => {
  const chestPosition = new Vec3(8104, 69, 7940);
  const chest = { name: 'chest', position: chestPosition };
  const bot = {
    username: 'IronSuiteProof',
    game: { dimension: 'minecraft:overworld' },
    players: {
      DadPlayer: { username: 'DadPlayer', entity: { position: new Vec3(8105.5, 68, 7934.5) } },
      KidPlayer: { username: 'KidPlayer', entity: { position: new Vec3(8105.5, 69, 7941.5) } },
      IronSuiteProof: { username: 'IronSuiteProof', entity: { position: new Vec3(8104.5, 68, 7933.5) } },
    },
    findBlocks: ({ matching }) => (matching(chest) ? [chestPosition] : []),
    blockAt: position => (
      position.x === chestPosition.x && position.y === chestPosition.y && position.z === chestPosition.z
        ? chest
        : { name: 'air', position }
    ),
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'IronSuiteProof, come inside to KidPlayer through our doorway, check the chest beside the bed, tell us exactly which iron tools are stored there and how many, then come back to me and wait.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['goto', 'inspect_container', 'goto']);
  assert.equal(plan.steps[0].entry.recipient, 'KidPlayer');
  assert.deepEqual(plan.steps[1].entry.containerConstraint.position, { x: 8104, y: 69, z: 7940 });
  assert.equal(plan.steps[1].entry.containerConstraint.dimension, 'overworld');
  assert.equal(plan.steps[1].dependency.policy, 'requires_success');
  assert.equal(plan.steps[2].entry.recipient, 'DadPlayer');
  assert.equal(plan.steps[2].entry.terminalDisposition, 'hold_position');
  assert.equal(plan.steps[2].dependency.policy, 'requires_success');
  assert.deepEqual(plan.unresolved, []);
  const normalizedInspection = normalizeAgendaEntry(plan.steps[1].entry);
  assert.equal(normalizedInspection.kind, 'inspect_container');
  assert.ok(Object.isFrozen(normalizedInspection.containerConstraint));
  assert.ok(Object.isFrozen(normalizedInspection.containerConstraint.position));
});

test('existing doorway repair binds only the exact gap then verifies the native route before return', () => {
  const key = ({ x, y, z }) => `${x}:${y}:${z}`;
  const blocks = new Map();
  const block = (name, x, y, z, properties = {}) => ({
    name,
    position: new Vec3(x, y, z),
    boundingBox: name === 'air' ? 'empty' : 'block',
    getProperties: () => properties,
  });
  const door = block('spruce_door', 8105, 69, 7937, { half: 'lower', facing: 'north', open: true });
  blocks.set(key(door.position), door);
  blocks.set('8105:68:7937', block('spruce_planks', 8105, 68, 7937));
  blocks.set('8106:68:7938', block('spruce_planks', 8106, 68, 7938));
  blocks.set('8105:67:7934', block('dirt', 8105, 67, 7934));
  const bot = {
    entity: { position: new Vec3(8104.5, 68, 7933.5) },
    game: { dimension: 'minecraft:overworld' },
    registry: {
      blocksByName: { cobblestone: { name: 'cobblestone', boundingBox: 'block' } },
      itemsByName: { cobblestone: { name: 'cobblestone' } },
    },
    findBlocks: ({ matching }) => (matching(door) ? [door.position] : []),
    blockAt(position) {
      return blocks.get(key(position)) || block('air', position.x, position.y, position.z);
    },
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    "fix the dangerous gap at our front door. Use these cobblestone to make a supported walkway from the yard to the open door that we can walk safely. Don't damage the house, then come back to us and wait.",
    { bot, requesterPosition: new Vec3(8105.5, 68, 7934.5) },
  );

  assert.ok(plan);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['repair_access', 'verify_access', 'goto']);
  assert.deepEqual(plan.steps[0].entry.accessRepairConstraint.cells, [
    { x: 8105, y: 68, z: 7936 },
    { x: 8105, y: 68, z: 7935 },
  ]);
  assert.deepEqual(plan.steps[0].entry.accessRepairConstraint.interiorStance, { x: 8106, y: 69, z: 7938 });
  assert.equal(plan.steps[1].dependency.policy, 'requires_success');
  assert.equal(plan.steps[2].dependency.policy, 'requires_success');
  assert.equal(plan.steps[2].entry.terminalDisposition, 'hold_position');

  const normalized = normalizeAgendaEntry(plan.steps[0].entry, { now: () => 100, sequence: 1 });
  assert.ok(Object.isFrozen(normalized.accessRepairConstraint));
  assert.ok(Object.isFrozen(normalized.accessRepairConstraint.cells));
  const order = createAccessRepairWorkOrder(normalized);
  assert.deepEqual(order.target, { name: 'access_repair', x: 8105, y: 68, z: 7935 });
  assert.deepEqual(order.blueprint.cells.map(cell => [cell.x, cell.y, cell.z, cell.material, cell.function]), [
    [0, 0, 1, 'cobblestone', 'supported_surface'],
    [0, 0, 0, 'cobblestone', 'supported_surface'],
  ]);
});

test('directiveToAgendaEntry maps agenda-worthy commands to typed entries', () => {
  assert.deepEqual(
    directiveToAgendaEntry('!assignMiningJob("iron_ore", 32)', { requester: 'Gabriel' }),
    { kind: 'mine', requester: 'Gabriel', target: 'iron_ore', quantity: 32 },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!assignHarvestJob("logs", 16)', { requester: 'Gabriel' }),
    { kind: 'harvest', requester: 'Gabriel', target: 'logs', quantity: 16 },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!assignStockpileJob("cobblestone", 64)', { requester: 'Gabriel' }),
    { kind: 'stockpile', requester: 'Gabriel', target: 'cobblestone', quantity: 64 },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!assignFunctionalShelterJob("cobblestone")', { requester: 'Gabriel' }),
    { kind: 'shelter', requester: 'Gabriel' },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!goToPlayer("Gabriel", 2)', { requester: 'Gabriel' }),
    { kind: 'goto', requester: 'Gabriel', recipient: 'Gabriel' },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!goToBed', { requester: 'Gabriel' }),
    { kind: 'sleep', requester: 'Gabriel' },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!recoverDeathItems', { requester: 'Gabriel' }),
    { kind: 'recover_death', requester: 'Gabriel' },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!requestItemGoal("deliver", "oak_log", 5, "Gabriel")', { requester: 'Gabriel' }),
    { kind: 'deliver', requester: 'Gabriel', target: 'oak_log', quantity: 5, recipient: 'Gabriel' },
  );
  assert.deepEqual(
    directiveToAgendaEntry('!requestItemGoal("acquire", "iron_ingot", 3, "Gabriel")', { requester: 'Gabriel' }),
    { kind: 'acquire', requester: 'Gabriel', target: 'iron_ingot', quantity: 3, recipient: '' },
  );
});

test('directiveToAgendaEntry returns null for standing directives, reflexes, and queries', () => {
  assert.equal(directiveToAgendaEntry('!followPlayer("Gabriel", 3)'), null);
  assert.equal(directiveToAgendaEntry('!guardPlayer("Gabriel", 3)'), null);
  assert.equal(directiveToAgendaEntry('!stay(-1)'), null);
  assert.equal(directiveToAgendaEntry('!stop'), null);
  assert.equal(directiveToAgendaEntry('!attackHostile'), null);
  assert.equal(directiveToAgendaEntry('!stats'), null);
  assert.equal(directiveToAgendaEntry('!consume("")'), null);
  assert.equal(directiveToAgendaEntry('not a command'), null);
});

// A deterministic stand-in for resolvePlayerDirective so the orchestration is
// tested without depending on the resolver's full regex surface.
function stubResolver(_player, segment) {
  const text = segment.toLowerCase();
  if (/\blogs?\b|\bwood\b/.test(text)) return { command: '!assignHarvestJob("logs", 8)', response: 'timber.' };
  if (/\bshelter\b/.test(text)) return { command: '!assignFunctionalShelterJob("cobblestone")', response: 'building.' };
  if (/\bcome\b|\bhere\b/.test(text)) return { command: '!goToPlayer("Gabriel", 2)', response: 'coming.' };
  if (/\bfollow\b/.test(text)) return { command: '!followPlayer("Gabriel", 3)', response: 'following.' };
  return null;
}

test('parsePlayerAgenda sequences a multi-step line into ordered entries', () => {
  const plan = parsePlayerAgenda('Gabriel', 'get 5 logs then build a shelter then come here', {}, { resolveDirective: stubResolver });
  assert.ok(plan);
  assert.equal(plan.disposition, 'append');
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['harvest', 'shelter', 'goto']);
});

test('parsePlayerAgenda preserves an exact gifted-food pickup, consumption, and terminal wait', () => {
  const bot = {
    registry: {
      itemsByName: { bread: { name: 'bread', displayName: 'Bread' } },
      foodsByName: { bread: { foodPoints: 5 } },
    },
    inventory: { slots: [] },
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'I just dropped you one Bread. Pick it up, eat it so you can start healing, then wait here with us.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['pickup_item', 'consume_item']);
  assert.deepEqual(plan.steps[0].entry.acquisitionCheckpoint, {
    baselineInventory: 0,
    targetInventory: 1,
  });
  assert.equal(plan.steps[1].entry.target, 'bread');
  assert.equal(plan.steps[1].entry.terminalDisposition, 'hold_position');
  assert.equal(plan.steps[1].dependency.policy, 'requires_success');
  assert.doesNotThrow(() => plan.steps.map((step, sequence) => normalizeAgendaEntry(step.entry, {
    now: () => 10_000,
    sequence,
  })));
});

test('parsePlayerAgenda preserves offered gear pickup, verified equip, report, and terminal wait', () => {
  const woodenPickaxe = { name: 'wooden_pickaxe', displayName: 'Wooden Pickaxe', count: 1 };
  const bot = {
    registry: {
      itemsByName: {
        wooden_pickaxe: woodenPickaxe,
        stone_pickaxe: { name: 'stone_pickaxe', displayName: 'Stone Pickaxe' },
      },
      foodsByName: {},
    },
    inventory: { slots: [woodenPickaxe] },
  };
  const plan = parsePlayerAgenda(
    'KidPlayer',
    "I just dropped you one Stone Pickaxe. Pick it up, use it, tell DadPlayer what you're using, then wait here with us.",
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['pickup_item', 'equip_item']);
  assert.deepEqual(plan.steps[0].entry.acquisitionCheckpoint, {
    baselineInventory: 0,
    targetInventory: 1,
  });
  assert.equal(plan.steps[1].entry.target, 'stone_pickaxe');
  assert.equal(plan.steps[1].entry.terminalDisposition, 'hold_position');
  assert.equal(plan.steps[1].dependency.policy, 'requires_success');
  assert.doesNotThrow(() => plan.steps.map((step, sequence) => normalizeAgendaEntry(step.entry, {
    now: () => 11_000,
    sequence,
  })));
});

test('material recipient ambiguity asks before action and binds the answer into named delivery plus terminal Hold', () => {
  const bread = { name: 'bread', displayName: 'Bread', count: 1 };
  const bot = {
    username: 'IronSuiteProof',
    registry: { itemsByName: { bread } },
    inventory: { slots: [bread], items: () => [bread] },
    players: {
      IronSuiteProof: { username: 'IronSuiteProof' },
      DadPlayer: { username: 'DadPlayer' },
      KidPlayer: { username: 'KidPlayer' },
    },
  };
  const pending = detectMaterialPlayerClarification(
    'DadPlayer',
    'Give one of us the Bread, then wait here.',
    { bot },
    { now: () => 1_000 },
  );

  assert.ok(pending);
  assert.equal(pending.target, 'bread');
  assert.equal(pending.quantity, 1);
  assert.deepEqual(pending.candidates, ['DadPlayer', 'KidPlayer']);
  assert.equal(pending.terminalDisposition, 'hold_position');
  assert.equal(pending.question, 'Who should receive the bread—DadPlayer or KidPlayer?');

  const resolution = resolveMaterialPlayerClarification(
    pending,
    'DadPlayer',
    'Give it to KidPlayer.',
    { bot },
    { now: () => 2_000 },
  );
  assert.deepEqual(resolution, {
    state: 'resolved',
    recipient: 'KidPlayer',
    message: 'Deliver 1 bread to KidPlayer, then wait here.',
  });

  const plan = parsePlayerAgenda('DadPlayer', resolution.message, { bot });
  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].entry, {
    kind: 'deliver',
    requester: 'DadPlayer',
    target: 'bread',
    quantity: 1,
    recipient: 'KidPlayer',
    terminalDisposition: 'hold_position',
  });
  assert.doesNotThrow(() => normalizeAgendaEntry(plan.steps[0].entry));
});

test('craft split delivery preserves new output, exact recipient custody, retained floor, and terminal Hold', () => {
  const item = { id: 50, name: 'torch', displayName: 'Torch' };
  const bot = {
    username: 'IronSuiteProof',
    registry: { itemsByName: { torch: item } },
    inventory: { slots: [] },
    players: {
      IronSuiteProof: { username: 'IronSuiteProof' },
      DadPlayer: { username: 'DadPlayer' },
      KidPlayer: { username: 'KidPlayer' },
    },
    recipesAll: itemId => itemId === 50 ? [{ result: { count: 4 } }] : [],
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'Craft eight torches, give four to KidPlayer, keep four for yourself, then wait here.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    {
      kind: 'craft',
      requester: 'DadPlayer',
      target: 'torch',
      quantity: 2,
    },
    {
      kind: 'deliver',
      requester: 'DadPlayer',
      target: 'torch',
      quantity: 4,
      recipient: 'KidPlayer',
    },
    {
      kind: 'inventory_checklist',
      requester: 'DadPlayer',
      inventoryRequirements: [{ target: 'torch', quantity: 4 }],
      terminalDisposition: 'hold_position',
    },
  ]);
  assert.deepEqual(plan.steps.slice(1).map(step => step.dependency), [
    { policy: 'requires_success' },
    { policy: 'requires_success' },
  ]);
  for (const step of plan.steps) assert.doesNotThrow(() => normalizeAgendaEntry(step.entry));
});

test('camp workshop request preserves exact craft, named delivery, requester return, and Hold', () => {
  const item = { id: 51, name: 'iron_pickaxe', displayName: 'Iron Pickaxe' };
  const tablePosition = new Vec3(-392, 67, -42);
  const table = { name: 'crafting_table', position: tablePosition };
  const bot = {
    username: 'IronSuiteProof',
    game: { dimension: 'minecraft:overworld' },
    registry: { itemsByName: { iron_pickaxe: item } },
    inventory: { slots: [] },
    players: {
      IronSuiteProof: { username: 'IronSuiteProof' },
      DadPlayer: { username: 'DadPlayer' },
      KidPlayer: { username: 'KidPlayer' },
    },
    recipesAll: itemId => itemId === 51 ? [{ result: { count: 1 } }] : [],
    findBlocks: ({ matching }) => (matching(table) ? [tablePosition] : []),
    blockAt: position => (
      position.x === tablePosition.x && position.y === tablePosition.y && position.z === tablePosition.z
        ? table
        : { name: 'air', position }
    ),
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'IronSuiteProof, use the camp crafting table and these materials to make an iron pickaxe for KidPlayer. Give it to KidPlayer, then come back to me and wait.',
    { bot, requesterPosition: new Vec3(-390.5, 67, -43.5) },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['craft', 'deliver', 'goto']);
  assert.deepEqual(plan.steps[0].entry.workstationConstraint.position, { x: -392, y: 67, z: -42 });
  assert.equal(plan.steps[0].entry.workstationConstraint.dimension, 'overworld');
  assert.equal(plan.steps[1].entry.recipient, 'KidPlayer');
  assert.equal(plan.steps[2].entry.recipient, 'DadPlayer');
  assert.equal(plan.steps[2].entry.terminalDisposition, 'hold_position');
  assert.deepEqual(plan.steps.slice(1).map(step => step.dependency), [
    { policy: 'requires_success' },
    { policy: 'requires_success' },
  ]);
  for (const step of plan.steps) assert.doesNotThrow(() => normalizeAgendaEntry(step.entry));
});

test('explicit carried kit preserves every output and terminal wait in one typed checklist', () => {
  const names = ['oak_boat', 'stone_sword', 'stone_shovel'];
  const bot = {
    registry: {
      itemsByName: Object.fromEntries(names.map((name, index) => [name, {
        id: 100 + index,
        name,
        displayName: name.replaceAll('_', ' '),
      }])),
    },
    inventory: { slots: [] },
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'Before we go exploring, make sure you are carrying one oak boat, one stone sword, and one stone shovel, then wait here.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    ...names.map(name => ({
      kind: 'acquire',
      requester: 'DadPlayer',
      target: name,
      quantity: 1,
      quantityMode: 'minimum',
      completion: 'inventory',
    })),
    {
      kind: 'inventory_checklist',
      requester: 'DadPlayer',
      inventoryRequirements: names.map(target => ({ target, quantity: 1 })),
      terminalDisposition: 'hold_position',
    },
  ]);
  assert.deepEqual(plan.steps.slice(1).map(step => step.dependency), [
    { policy: 'requires_success' },
    { policy: 'requires_success' },
    { policy: 'requires_success' },
  ]);
  for (const step of plan.steps) assert.doesNotThrow(() => normalizeAgendaEntry(step.entry));
});

test('parsePlayerAgenda preserves a family firewood harvest and group return as one chain', () => {
  const message = 'Could you gather six spruce logs from one nearby tree for our campsite, keep the clearing tidy, and come back to us?';
  const plan = parsePlayerAgenda('DadPlayer', message, {}, {
    resolveDirective(player, segment, context) {
      if (/\bgather\b[\s\S]*\blogs?\b/i.test(segment)) {
        return {
          command: `!assignHarvestJob("logs", 6, "${player}")`,
          response: 'I will run a checkpointed timber job.',
        };
      }
      return resolvePlayerDirective(player, segment, context);
    },
  });

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    { kind: 'harvest', requester: 'DadPlayer', target: 'logs', quantity: 6 },
    { kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' },
  ]);
});

test('parsePlayerAgenda preserves every registry-backed output in one collective delivery request', () => {
  const itemsByName = Object.fromEntries([
    'iron_pickaxe',
    'iron_axe',
    'iron_shovel',
    'iron_sword',
  ].map(name => [name, { name }]));
  const plan = parsePlayerAgenda(
    'phixxation',
    'Make me an iron pickaxe, iron axe, iron shovel, and iron sword, then bring them here.',
    { bot: { registry: { itemsByName } } },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    { kind: 'deliver', requester: 'phixxation', target: 'iron_pickaxe', quantity: 1, recipient: 'phixxation' },
    { kind: 'deliver', requester: 'phixxation', target: 'iron_axe', quantity: 1, recipient: 'phixxation' },
    { kind: 'deliver', requester: 'phixxation', target: 'iron_shovel', quantity: 1, recipient: 'phixxation' },
    { kind: 'deliver', requester: 'phixxation', target: 'iron_sword', quantity: 1, recipient: 'phixxation' },
  ]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves a manufactured set and binds every deposit to the selected chest', () => {
  const names = ['iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_hoe', 'iron_sword'];
  const chest = { name: 'chest', position: { x: 8103, y: 69, z: 7937 } };
  const bot = {
    game: { dimension: 'overworld' },
    registry: {
      itemsByName: Object.fromEntries(names.map(name => [name, { name, displayName: name.replaceAll('_', ' ') }])),
    },
    findBlock: ({ matching }) => matching(chest) ? chest : null,
  };
  const plan = parsePlayerAgenda(
    'Gabriel',
    'Use the outpost you are standing in as your base. Make a complete iron tool set—one iron pickaxe, one iron axe, one iron shovel, one iron hoe, and one iron sword—and store all five tools in the chest inside this outpost.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => [step.entry.kind, step.entry.target, step.entry.quantity]), [
    ...names.map(name => ['acquire', name, 1]),
    ...names.map(name => ['deposit', name, 1]),
  ]);
  assert.ok(plan.steps.slice(1).every(step => step.dependency?.policy === 'requires_success'));
  assert.deepEqual(plan.steps.slice(5).map(step => step.entry.containerConstraint), names.map(() => ({
    name: 'chest',
    position: { x: 8103, y: 69, z: 7937 },
    dimension: 'overworld',
    source: 'player_context_here',
    observedAt: plan.steps[5].entry.containerConstraint.observedAt,
  })));
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves the complete cave expedition as one durable work order', () => {
  const chest = { name: 'chest', position: { x: 8104, y: 69, z: 7940 } };
  const bot = {
    entity: { position: { x: 8105.5, y: 69, z: 7938.5 } },
    game: { dimension: 'overworld' },
    findBlock: ({ matching }) => matching(chest) ? chest : null,
  };
  const plan = parsePlayerAgenda(
    'Gabriel',
    'Use this outpost as your home base. Explore and light a nearby cave, collect useful exposed ore without damaging the outpost or any player-built structures, then return here and store what you found in this chest.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].entry, {
    kind: 'explore',
    requester: 'Gabriel',
    target: 'ores',
    quantity: 8,
    bestEffort: true,
    x: 8105,
    y: 69,
    z: 7938,
    homeDimension: 'overworld',
    containerConstraint: {
      name: 'chest',
      position: { x: 8104, y: 69, z: 7940 },
      dimension: 'overworld',
      source: 'player_context_here',
      observedAt: plan.steps[0].entry.containerConstraint.observedAt,
    },
  });
  assert.deepEqual(plan.unresolved, []);

  const exactPlan = parsePlayerAgenda(
    'Gabriel',
    'Use this outpost as your home base. Explore and light a nearby cave, collect 12 useful exposed ores without damaging the outpost or any player-built structures, then return here and store what you found in this chest.',
    { bot },
  );
  assert.equal(exactPlan.steps[0].entry.quantity, 12);
  assert.equal(exactPlan.steps[0].entry.bestEffort, undefined);

  const retainedPlan = parsePlayerAgenda(
    'LandingWitness',
    'Find a useful nearby cave, collect some iron and coal without damaging our work area, then return to me.',
    { bot },
  );
  assert.ok(retainedPlan);
  assert.equal(retainedPlan.multiStep, true);
  assert.deepEqual(retainedPlan.steps.map(step => step.entry.kind), ['explore', 'goto']);
  assert.equal(retainedPlan.steps[0].entry.retainResults, true);
  assert.deepEqual(retainedPlan.steps[0].entry.requiredOutputs, [
    { source: 'iron_ore', item: 'raw_iron', quantity: 1 },
    { source: 'coal_ore', item: 'coal', quantity: 1 },
  ]);
  assert.equal(retainedPlan.steps[0].entry.quantity, 8);
  assert.equal(retainedPlan.steps[1].dependency.policy, 'after_settlement');
  assert.deepEqual(retainedPlan.unresolved, []);

  const retainedWithoutStorage = parsePlayerAgenda(
    'LandingWitness',
    'Find a useful nearby cave, collect some iron and coal without damaging our work area, then return to me.',
    { bot: { ...bot, findBlock: () => null } },
  );
  assert.ok(retainedWithoutStorage);
  assert.equal(retainedWithoutStorage.rejection, undefined);
  assert.equal(retainedWithoutStorage.steps[0].entry.retainResults, true);
  assert.equal(retainedWithoutStorage.steps[0].entry.homeDimension, 'overworld');
  assert.equal(retainedWithoutStorage.steps[0].entry.containerConstraint, undefined);
  const persistedRetainedStep = normalizeAgendaEntry(retainedWithoutStorage.steps[0].entry);
  assert.equal(persistedRetainedStep.retainResults, true);
  assert.equal(persistedRetainedStep.homeDimension, 'overworld');
  assert.equal(persistedRetainedStep.containerConstraint, undefined);
});

test('parsePlayerAgenda composes a broad resource project from generic typed capabilities', () => {
  const chest = { name: 'chest', position: { x: 8104, y: 69, z: 7940 } };
  const names = ['iron_pickaxe', 'bucket'];
  const bot = {
    entity: { position: { x: 8105.5, y: 69, z: 7938.5 } },
    game: { dimension: 'overworld' },
    registry: {
      itemsByName: Object.fromEntries(names.map(name => [name, {
        name,
        displayName: name.replaceAll('_', ' '),
      }])),
    },
    findBlock: ({ matching }) => matching(chest) ? chest : null,
  };
  const plan = parsePlayerAgenda(
    'LandingWitness',
    'Stop, use this outpost as home. Find a cave and gather 8 fresh iron and 8 fresh coal without damaging our buildings or paths. Return, make an iron pickaxe and bucket with our furnace and table, and store both tools in this chest, then come back to me.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.disposition, 'interrupt');
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => [step.entry.kind, step.entry.target]), [
    ['explore', 'ores'],
    ['acquire', 'iron_pickaxe'],
    ['acquire', 'bucket'],
    ['deposit', 'iron_pickaxe'],
    ['deposit', 'bucket'],
    ['goto', undefined],
  ]);
  assert.deepEqual(plan.steps[0].entry.requiredOutputs, [
    { source: 'iron_ore', item: 'raw_iron', quantity: 8 },
    { source: 'coal_ore', item: 'coal', quantity: 8 },
  ]);
  assert.equal(plan.steps[0].entry.quantity, 16);
  assert.ok(plan.steps.slice(1, -1).every(step => step.dependency?.policy === 'requires_success'));
  assert.equal(plan.steps.at(-1).dependency.policy, 'after_settlement');
  assert.ok(plan.steps.slice(3, 5).every(step => (
    step.entry.containerConstraint.position.x === chest.position.x
    && step.entry.containerConstraint.position.y === chest.position.y
    && step.entry.containerConstraint.position.z === chest.position.z
  )));
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves additional food preparation and exact storage as one durable plan', () => {
  const chest = { name: 'chest', position: { x: 8104, y: 69, z: 7940 } };
  const furnace = { name: 'furnace', position: { x: 8102, y: 70, z: 7938 } };
  const bot = {
    game: { dimension: 'overworld' },
    registry: { foodsByName: { bread: { foodPoints: 5 } } },
    inventory: { items: () => [{ name: 'bread', count: 2 }] },
    findBlock: ({ matching }) => [chest, furnace].find(candidate => matching(candidate)) || null,
  };
  const plan = parsePlayerAgenda(
    'Gabriel',
    "Help me stock this outpost for tonight: gather a useful mix of food, cook anything that needs cooking in the furnace already here, put the food in this chest, and don't damage the house, farm, or paths.",
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['prepare_food', 'deposit_family']);
  assert.equal(plan.steps[0].entry.quantity, 24);
  assert.equal(plan.steps[0].entry.baselineFoodPoints, 10);
  assert.equal(plan.steps[0].entry.bestEffort, true);
  assert.deepEqual(plan.steps[0].entry.workstationConstraint, {
    name: 'furnace',
    position: { x: 8102, y: 70, z: 7938 },
    dimension: 'overworld',
    source: 'player_context_here',
    observedAt: plan.steps[0].entry.workstationConstraint.observedAt,
  });
  assert.equal(plan.steps[1].entry.target, 'food');
  assert.deepEqual(plan.steps[1].entry.baselineInventory, [{ name: 'bread', count: 2 }]);
  assert.deepEqual(plan.steps[1].entry.containerConstraint.position, { x: 8104, y: 69, z: 7940 });
  assert.equal(plan.steps[1].dependency.policy, 'requires_success');
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves fishing breakfast as acquire, fresh catch, exact cooking, delivery, and terminal hold', () => {
  const furnace = { name: 'furnace', position: { x: 8102, y: 70, z: 7938 } };
  const bot = {
    game: { dimension: 'minecraft:overworld' },
    inventory: {
      items: () => [
        { name: 'cod', count: 1 },
        { name: 'cooked_cod', count: 2 },
      ],
    },
    findBlock: ({ matching }) => (matching(furnace) ? furnace : null),
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'IronSuiteProof, good morning. The kid and I want a fishing breakfast. Please catch three fish, cook them using the furnace we already have, bring the cooked fish back to me, and wait here when you are done.',
    { bot },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), [
    'acquire',
    'catch_fish',
    'cook_fish',
    'deliver_family',
  ]);
  assert.equal(plan.steps[0].entry.target, 'fishing_rod');
  assert.equal(plan.steps[0].entry.quantityMode, 'minimum');
  assert.deepEqual(plan.steps[1].entry.baselineInventory, [{ name: 'cod', count: 1 }]);
  assert.deepEqual(plan.steps[2].entry.baselineOutputInventory, [{ name: 'cooked_cod', count: 2 }]);
  assert.deepEqual(plan.steps[2].entry.workstationConstraint.position, furnace.position);
  assert.equal(plan.steps[3].entry.target, 'cooked_fish');
  assert.equal(plan.steps[3].entry.recipient, 'DadPlayer');
  assert.equal(plan.steps[3].entry.terminalDisposition, 'hold_position');
  assert.ok(plan.steps.slice(1).every(step => step.dependency.policy === 'requires_success'));
  assert.doesNotThrow(() => plan.steps.map((step, sequence) => normalizeAgendaEntry(step.entry, {
    now: () => 100,
    sequence,
  })));
  assert.deepEqual(plan.unresolved, []);
});

test('fishing breakfast binds the furnace near a remote requester instead of a fixture beside the bot', () => {
  const requesterFurnace = { name: 'furnace', position: new Vec3(8115, 70, 7955) };
  const botSideFurnace = { name: 'furnace', position: new Vec3(8195, 66, 7951) };
  const blocks = new Map([
    ['8115:70:7955', requesterFurnace],
    ['8195:66:7951', botSideFurnace],
  ]);
  const bot = {
    entity: { position: new Vec3(8196.45, 66, 7951.33) },
    game: { dimension: 'minecraft:overworld' },
    inventory: { items: () => [{ name: 'spruce_log', count: 7 }] },
    findBlocks: ({ matching }) => [botSideFurnace, requesterFurnace]
      .filter(matching)
      .map(block => block.position),
    blockAt: position => blocks.get(`${position.x}:${position.y}:${position.z}`) || null,
    findBlock: ({ matching }) => (matching(botSideFurnace) ? botSideFurnace : null),
  };

  const plan = parsePlayerAgenda(
    'DadPlayer',
    'Make yourself a fishing rod, catch three fish, cook them in the existing furnace here, bring the cooked fish back to me, and wait here.',
    {
      bot,
      requesterPosition: { x: 8104.5, y: 69, z: 7939.5 },
    },
  );

  assert.ok(plan);
  assert.equal(plan.rejection, undefined);
  assert.deepEqual(plan.steps[2].entry.workstationConstraint.position, {
    x: 8115,
    y: 70,
    z: 7955,
  });
});

test('parsePlayerAgenda preserves the broad remembered-farm workflow as typed steps', () => {
  const message = 'Go to the farm, harvest only the mature wheat, replant every crop you harvest, put the wheat in the existing chest at the farm, then come back to me.';
  const bot = { registry: { itemsByName: { wheat: { name: 'wheat' } } } };
  const plan = parsePlayerAgenda('WorksitePlayer', message, { bot });

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    { kind: 'farm_visit', requester: 'WorksitePlayer' },
    { kind: 'maintain_farm', requester: 'WorksitePlayer' },
    { kind: 'deposit', requester: 'WorksitePlayer', target: 'wheat', quantity: 64 },
    { kind: 'goto', requester: 'WorksitePlayer', recipient: 'WorksitePlayer' },
  ]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves scout, exact memory, return, and guidance as one durable outcome', () => {
  const message = 'IronSuiteProof, scout a useful area around this outpost. Remember one nearby cave and one useful animal location, come back, then guide me to the cave without damaging buildings or paths.';
  const bot = {
    entity: { position: { x: 8119.5, y: 69, z: 7981.5 } },
    game: { dimension: 'minecraft:overworld' },
  };
  const plan = parsePlayerAgenda('LandingWitness', message, {
    bot,
    requesterPosition: { x: 8105.5, y: 69, z: 7939.5 },
  });

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(normalizeAgendaEntry(plan.steps[0].entry, {
    now: () => 100,
    sequence: 1,
  }), {
    id: 'agenda-100-1',
    kind: 'scout',
    executor: 'job',
    target: '',
    quantity: 0,
    findings: ['cave', 'animal'],
    guideFinding: 'cave',
    completion: '',
    recipient: '',
    requester: 'LandingWitness',
    radius: 64,
    x: 8105,
    y: 69,
    z: 7939,
    homeDimension: 'overworld',
    workstationConstraint: null,
    dependsOnEntryId: '',
    dependencyPolicy: '',
    bindingRequest: null,
    bindingConstraint: null,
    constructionIntent: null,
    assignmentState: '',
    note: '',
    state: 'pending',
    executorId: '',
    createdAt: 100,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    preemptions: 0,
    evidence: { code: '', detail: '' },
  });
});

test('parsePlayerAgenda binds deictic scout guidance to the single requested finding', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'Scout within 64 blocks for useful animals, remember where you find one, come back to me, then guide us there.',
    {
      bot: { game: { dimension: 'minecraft:overworld' } },
      requesterPosition: { x: 8158.5, y: 68, z: 7927.5 },
    },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].entry, {
    kind: 'scout',
    requester: 'DadPlayer',
    findings: ['animal'],
    guideFinding: 'animal',
    radius: 64,
    x: 8158,
    y: 68,
    z: 7927,
    homeDimension: 'overworld',
  });
});

test('parsePlayerAgenda preserves remembered livestock relocation, breeding, pen closure, and return', () => {
  const gate = new Vec3(0, 64, 2);
  const boundary = new Set();
  for (let coordinate = 0; coordinate <= 4; coordinate += 1) {
    boundary.add(`${coordinate},64,0`);
    boundary.add(`${coordinate},64,4`);
    boundary.add(`0,64,${coordinate}`);
    boundary.add(`4,64,${coordinate}`);
  }
  const bot = {
    game: { dimension: 'minecraft:overworld' },
    entities: {},
    findBlocks: () => [gate],
    blockAt: position => {
      const key = `${position.x},${position.y},${position.z}`;
      if (key === '0,64,2') {
        return { name: 'spruce_fence_gate', boundingBox: 'block', position };
      }
      if (boundary.has(key)) return { name: 'spruce_fence', boundingBox: 'block', position };
      if (position.y === 63) return { name: 'grass_block', boundingBox: 'block', position };
      return { name: 'air', boundingBox: 'empty', position };
    },
  };
  const plan = parsePlayerAgenda(
    'LandingWitness',
    'IronSuiteProof, guide me to the useful animals you remembered, bring two sheep back to the outpost pen, feed and breed them, then return to me.',
    {
      bot,
      requesterPosition: { x: -2, y: 64, z: 2 },
      memoryBank: {
        recallUserPlaceDetails: name => name === 'useful_animals'
          ? { x: 20, y: 64, z: 20, dimension: 'overworld' }
          : null,
      },
    },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), [
    'acquire',
    'visit',
    'settle_livestock',
    'goto',
  ]);
  assert.deepEqual(plan.steps.slice(1).map(step => step.dependency?.policy), [
    'requires_success',
    'requires_success',
    'requires_success',
  ]);
  assert.deepEqual(plan.steps[0].entry, {
    kind: 'acquire',
    requester: 'LandingWitness',
    target: 'wheat',
    quantity: 2,
    quantityMode: 'minimum',
  });
  const settlement = normalizeAgendaEntry(plan.steps[2].entry, {
    now: () => 200,
    sequence: 3,
  });
  assert.equal(settlement.target, 'sheep');
  assert.equal(settlement.quantity, 2);
  assert.equal(settlement.breedingPairs, 1);
  assert.deepEqual({ x: settlement.x, y: settlement.y, z: settlement.z }, { x: 20, y: 64, z: 20 });
  assert.deepEqual(settlement.penConstraint, {
    gate: { x: 0, y: 64, z: 2 },
    inside: { x: 2, y: 64, z: 2 },
    outside: { x: -1, y: 64, z: 2 },
    bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4, y: 64 },
    dimension: 'overworld',
    baselineAnimals: 0,
  });
  assert.equal(plan.steps[3].entry.recipient, 'LandingWitness');
});

test('parsePlayerAgenda preserves custom construction as a barrier before sleep', () => {
  const plan = parsePlayerAgenda(
    'Gabriel',
    'Build a small safe overnight outpost with windows and a bed, then go inside and sleep.',
    {},
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    {
      kind: 'construction',
      requester: 'Gabriel',
      constructionIntent: {
        requiredFunctions: ['access', 'daylight', 'enclosure', 'rest', 'weather_cover'],
      },
    },
    { kind: 'sleep', requester: 'Gabriel' },
  ]);
  assert.deepEqual(plan.steps[1].dependency, {
    policy: 'requires_success',
    bindingRequest: { kind: 'structure_fixture', function: 'rest' },
  });
  assert.equal(plan.steps[0].requiresModelAssignment, true);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves a split Minecraft construction continuation through terminal wait', () => {
  const message = "IronSuiteProof, use only the five spruce logs you're already carrying to make a small three-by-three spruce-plank picnic pad on the open grass a few blocks west of us. Don't dig holes, damage trees, or leave scaffolding; keep a clear walking path around it, then come back to me and wait with us.";
  assert.equal(message.length, 296, 'the live Mineflayer client split this request at Minecraft\'s 256-character boundary');

  const constructionFragment = message
    .slice(0, 256)
    .replace(/^IronSuiteProof,\s*/, '');
  const continuationFragment = message.slice(256);
  const construction = parsePlayerAgenda('DadPlayer', constructionFragment, {});
  const continuation = parsePlayerAgenda('DadPlayer', continuationFragment, {});

  assert.ok(construction);
  assert.deepEqual(construction.steps.map(step => step.entry.kind), ['construction']);
  assert.equal(construction.steps[0].requiresModelAssignment, true);
  assert.ok(continuation);
  assert.equal(continuation.multiStep, true);
  assert.deepEqual(continuation.steps.map(step => step.entry), [{
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'DadPlayer',
    terminalDisposition: 'hold_position',
  }]);
});

test('parsePlayerAgenda keeps stair-block picnic seats as custom construction before return and wait', () => {
  const memoryBank = {
    recallUserPlaceDetails(name) {
      return name === 'picnic_pad'
        ? { x: 8155.5, y: 69, z: 7924.5, dimension: 'minecraft:overworld' }
        : null;
    },
  };
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'use the spruce you are carrying to build two little seats from spruce stairs beside our picnic pad, one on each side facing inward. Keep the walking ring clear, do not dig or damage the pad, then come back to me and wait.',
    { memoryBank },
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['construction', 'goto']);
  assert.equal(plan.steps[0].requiresModelAssignment, true);
  assert.match(plan.steps[0].segment, /two little seats from spruce stairs/i);
  assert.match(plan.steps[0].modelInstruction, /put X Y Z spruce_stairs north\|south\|east\|west/);
  assert.match(plan.steps[0].modelInstruction, /fixture-only design.*material "auto".*lock_material false/i);
  assert.match(plan.steps[0].modelInstruction, /translate a symmetric layout instead of writing negative coordinates/i);
  assert.deepEqual(normalizeAgendaEntry(plan.steps[0].entry, {
    now: () => 100,
    sequence: 1,
  }).constructionIntent.siteConstraint, {
    kind: 'remembered_place',
    name: 'picnic_pad',
    relation: 'beside',
    position: { x: 8155, y: 69, z: 7924 },
    dimension: 'overworld',
    radius: 8,
    sourceId: 'picnic_pad',
  });
  assert.deepEqual(normalizeAgendaEntry(plan.steps[0].entry, {
    now: () => 100,
    sequence: 1,
  }).constructionIntent.layoutConstraint, {
    arrangement: 'opposite_sides',
    orientation: 'inward',
    clearance: 1,
  });
  assert.match(plan.steps[0].modelInstruction, /physical binder owns the grounded opposite-side translation/i);
  assert.equal(plan.steps[1].entry.recipient, 'DadPlayer');
  assert.equal(plan.steps[1].entry.terminalDisposition, 'hold_position');
  assert.deepEqual(plan.unresolved, []);

  const unresolved = parsePlayerAgenda(
    'DadPlayer',
    'build two seats beside our picnic pad, then come back to me and wait.',
    {},
  );
  assert.equal(unresolved.rejection, 'I cannot identify the named place picnic pad from verified memory, so I will not build at a guessed site.');
  assert.deepEqual(unresolved.steps, []);
});

test('parsePlayerAgenda preserves a natural family bedtime request and terminal wait', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'It is getting late. Go sleep in one of our beds, then wait at home when you wake up.',
    {},
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [{
    kind: 'sleep',
    requester: 'DadPlayer',
    terminalDisposition: 'hold_position',
  }]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves requested lighting instead of taking an incomplete pen shortcut', () => {
  const homeState = {
    snapshot: () => ({
      farm: {
        water: { x: 20, y: 64, z: 20 },
        dimension: 'overworld',
      },
    }),
  };
  const plan = parsePlayerAgenda(
    'Gabriel',
    'Improve this outpost for us: build a safe fenced animal pen beside the farm with a working gate and lighting, use nearby resources and the workshop already here, and do not damage the house, crops, paths, chest, furnace, or crafting table.',
    { homeState },
  );

  assert.ok(plan);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].entry.kind, 'construction');
  assert.deepEqual(plan.steps[0].entry.constructionIntent.requiredFunctions, [
    'access',
    'containment',
    'interior_light',
  ]);
  assert.equal(plan.steps[0].entry.constructionIntent.siteConstraint.kind, 'remembered_farm');
  assert.match(plan.steps[0].modelInstruction, /produce these functions: access, containment, interior_light/);
  assert.match(plan.steps[0].modelInstruction, /Function names are metadata, never DSL arguments/);
  assert.match(plan.steps[0].modelInstruction, /Start from a provided @template when it already supplies a requested function/);
  assert.doesNotMatch(plan.steps[0].modelInstruction, /lit open pen|@pen\s+\d/);
  assert.equal(plan.steps[0].requiresModelAssignment, true);
  assert.equal(plan.unresolved.length, 1);
  assert.match(plan.unresolved[0].segment, /do not damage the house/i);
});

test('parsePlayerAgenda keeps the complete overnight outpost contract in one construction intent', () => {
  const plan = parsePlayerAgenda(
    'Gabriel',
    'Build a small safe overnight outpost with a clear entrance, windows, lighting, a door, a bed, a crafting table, a furnace, and a chest. Then go inside and sleep in the bed.',
    {},
  );

  assert.ok(plan);
  assert.deepEqual(plan.steps[0].entry.constructionIntent.requiredFunctions, [
    'access',
    'crafting',
    'daylight',
    'enclosure',
    'interior_light',
    'rest',
    'smelting',
    'storage',
    'weather_cover',
  ]);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['construction', 'sleep']);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves an escorted furnace operation as bounded follow then smelt', () => {
  const message = "Come with me across the river to my workshop, use my furnace there to smelt the raw iron you're carrying, then come back with me.";
  const bot = {
    registry: { itemsByName: { raw_iron: { name: 'raw_iron' } } },
    inventory: { items: () => [{ name: 'raw_iron', count: 1 }] },
  };
  const plan = parsePlayerAgenda('WorksiteGuide', message, { bot });

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    {
      kind: 'follow_until',
      requester: 'WorksiteGuide',
      target: 'furnace',
      recipient: 'WorksiteGuide',
      radius: 8,
    },
    { kind: 'smelt', requester: 'WorksiteGuide', target: 'raw_iron', quantity: 1 },
  ]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda carries interrupt disposition and drops non-agenda segments', () => {
  const plan = parsePlayerAgenda('Gabriel', 'stop, follow me then come here', {}, { resolveDirective: stubResolver });
  assert.ok(plan);
  assert.equal(plan.disposition, 'interrupt');
  // "follow me" is a standing directive (no entry); only "come here" is queued.
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['goto']);
  assert.equal(plan.multiStep, false);
  assert.equal(plan.unresolved.length, 1);
});

test('parsePlayerAgenda strips a leading interrupt word so the first step survives', () => {
  const plan = parsePlayerAgenda('Gabriel', 'stop, get some logs then come here', {}, { resolveDirective: stubResolver });
  assert.ok(plan);
  assert.equal(plan.disposition, 'interrupt');
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['harvest', 'goto']);
});

test('parsePlayerAgenda returns null when nothing is agenda-worthy', () => {
  assert.equal(parsePlayerAgenda('Gabriel', 'follow me', {}, { resolveDirective: stubResolver }), null);
  assert.equal(parsePlayerAgenda('Gabriel', 'how are you today', {}, { resolveDirective: stubResolver }), null);
  assert.equal(parsePlayerAgenda('Gabriel', 'I will get 5 logs then build a shelter', {}, { resolveDirective: stubResolver }), null);
  assert.equal(parsePlayerAgenda('Gabriel', 'Let me get 5 logs then build a shelter', {}, { resolveDirective: stubResolver }), null);
  assert.equal(parsePlayerAgenda('Gabriel', 'I am building a shelter then gathering wood', {}, { resolveDirective: stubResolver }), null);
});

test('parsePlayerAgenda does not retype a model-selected item plan as construction', () => {
  const plan = parsePlayerAgenda(
    'Gabriel',
    "Help me establish this landing area. Don't damage what I've already built. Gather a sensible starter supply, make whatever basic tools you need, and return here when you're finished.",
    { bot: {} },
  );
  assert.equal(plan, null);

  assert.equal(
    parsePlayerAgenda(
      'LandingWitness',
      'Build your supplies up to at least 24 logs and 48 cobblestone around the outpost without damaging buildings, paths, farms, pens, or work areas. Finish every natural tree you start, reuse what you already have, then come back to me and wait.',
      { bot: {} },
    ),
    null,
  );
});

test('parsePlayerAgenda does not turn a preservation clause into a construction barrier', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'Come home to KidPlayer at the family base using safe existing terrain. Do not damage any build.',
    {},
  );

  assert.ok(plan);
  assert.deepEqual(plan.steps.map(step => step.entry), [{
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'KidPlayer',
  }]);
  assert.doesNotMatch(plan.steps[0].command, /designStructure|build/i);
});

test('parsePlayerAgenda preserves a model-compiled worksite and its requested return', () => {
  const plan = parsePlayerAgenda(
    'LandingWitness',
    "Set up a small shared work area with a crafting table, furnace, chest, and light. Keep the entrance clear, don't damage the surrounding terrain, and return to me when you’re finished.",
    {},
  );

  assert.ok(plan);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['construction', 'goto']);
  assert.equal(plan.steps[0].requiresModelAssignment, true);
  assert.deepEqual(plan.steps[0].entry.constructionIntent.requiredFunctions, [
    'access',
    'crafting',
    'interior_light',
    'smelting',
    'storage',
  ]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda ignores explicit !command lines and empty input', () => {
  assert.equal(parsePlayerAgenda('Gabriel', '!assignMiningJob("iron_ore", 5)', {}, { resolveDirective: stubResolver }), null);
  assert.equal(parsePlayerAgenda('Gabriel', '', {}, { resolveDirective: stubResolver }), null);
  assert.equal(parsePlayerAgenda('', 'get 5 logs then come here', {}, { resolveDirective: stubResolver }), null);
});

test('parsePlayerAgenda works with the real directive resolver (no bot registry)', () => {
  const plan = parsePlayerAgenda('Gabriel', 'mine 10 diamond then come here', {}, {});
  assert.ok(plan, 'expected a plan from the real resolver');
  assert.equal(plan.steps.length, 2);
  for (const step of plan.steps) {
    assert.ok(['mine', 'acquire', 'goto'].includes(step.entry.kind), `unexpected kind ${step.entry.kind}`);
  }
});

test('parsePlayerAgenda preserves an explicit terminal wait on the return step', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    "let's stock up. Mine 8 fresh raw iron, then come back to me and wait.",
    {},
  );
  assert.ok(plan);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['mine', 'goto']);
  assert.equal(plan.steps.at(-1).entry.terminalDisposition, 'hold_position');
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves a spoken mining quantity in a compound return request', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'Collect four cobblestone without damaging our builds, then come back to me and wait here.',
    {},
  );

  assert.ok(plan);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    {
      kind: 'mine',
      requester: 'DadPlayer',
      target: 'cobblestone',
      quantity: 4,
    },
    {
      kind: 'goto',
      requester: 'DadPlayer',
      recipient: 'DadPlayer',
      terminalDisposition: 'hold_position',
    },
  ]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves mined output delivery and terminal Hold from one natural request', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'please mine exactly eight fresh cobblestone for our repairs, bring all eight back to me, and then wait here with us.',
    {},
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [
    {
      kind: 'mine',
      requester: 'DadPlayer',
      target: 'cobblestone',
      quantity: 8,
    },
    {
      kind: 'deliver',
      requester: 'DadPlayer',
      target: 'cobblestone',
      quantity: 8,
      recipient: 'DadPlayer',
      terminalDisposition: 'hold_position',
    },
  ]);
  assert.equal(plan.steps[1].dependency.policy, 'requires_success');
  assert.deepEqual(plan.unresolved, []);
  for (const step of plan.steps) assert.doesNotThrow(() => normalizeAgendaEntry(step.entry));
});

test('parsePlayerAgenda preserves an indefinite wait clause on a direct return', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'come back to me and wait here until I ask for something else.',
    {},
  );

  assert.ok(plan);
  assert.equal(plan.multiStep, true);
  assert.deepEqual(plan.steps.map(step => step.entry), [{
    kind: 'goto',
    requester: 'DadPlayer',
    recipient: 'DadPlayer',
    terminalDisposition: 'hold_position',
  }]);
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda keeps adjacent tool preparation and fresh mining as separate steps', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'we lost our kit. Get yourself a stone pickaxe, mine 8 fresh raw iron, then come back to me and wait.',
    {},
  );

  assert.ok(plan);
  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['acquire', 'mine', 'goto']);
  assert.equal(plan.steps[0].entry.target, 'stone_pickaxe');
  assert.equal(plan.steps[0].entry.completion, 'main_hand');
  assert.equal(plan.steps[1].entry.target, 'iron_ore');
  assert.equal(plan.steps[1].entry.quantity, 8);
  assert.equal(plan.steps.at(-1).entry.terminalDisposition, 'hold_position');
  assert.deepEqual(plan.unresolved, []);
});

test('parsePlayerAgenda preserves death recovery ahead of requester return and terminal wait', () => {
  const plan = parsePlayerAgenda(
    'DadPlayer',
    'go recover all of your death items, then come back to me and wait.',
    {},
  );

  assert.deepEqual(plan.steps.map(step => step.entry.kind), ['recover_death', 'goto']);
  assert.equal(plan.steps[1].entry.recipient, 'DadPlayer');
  assert.equal(plan.steps[1].entry.terminalDisposition, 'hold_position');
  assert.deepEqual(plan.unresolved, []);
});
