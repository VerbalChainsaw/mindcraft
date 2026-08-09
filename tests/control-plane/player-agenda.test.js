import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDisposition,
  splitAgendaSegments,
  directiveToAgendaEntry,
  parsePlayerAgenda,
} from '../../src/agent/player-agenda.js';

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

test('parsePlayerAgenda preserves requested lighting instead of taking an incomplete pen shortcut', () => {
  const plan = parsePlayerAgenda(
    'Gabriel',
    'Improve this outpost for us: build a safe fenced animal pen beside the farm with a working gate and lighting, use nearby resources and the workshop already here, and do not damage the house, crops, paths, chest, furnace, or crafting table.',
    {},
  );

  assert.ok(plan);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].entry.kind, 'construction');
  assert.deepEqual(plan.steps[0].entry.constructionIntent.requiredFunctions, [
    'access',
    'containment',
    'interior_light',
  ]);
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
