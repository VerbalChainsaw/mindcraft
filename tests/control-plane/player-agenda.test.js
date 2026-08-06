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
