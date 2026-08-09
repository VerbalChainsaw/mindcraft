import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePlayerDirective } from '../../src/agent/player-directives.js';
import { classifyPlayerSpeechAuthority } from '../../src/agent/player-speech-authority.js';

function commandFor(message) {
  const directive = resolvePlayerDirective('Gabriel', message, {});
  return directive?.command ?? null;
}

test('player self-assignment stays conversation instead of authorizing bot work', () => {
  const selfAssignments = [
    'I will build us some shelter for now',
    "I'll gather wood while you wait",
    'we are going to build a house',
    'Let me build us a shelter',
    'I am about to build us a shelter',
    'I am trying to gather wood',
    'I am building us a shelter',
    "I'm gathering wood",
  ];
  for (const message of selfAssignments) {
    assert.equal(classifyPlayerSpeechAuthority(message), 'conversation_only', message);
    assert.equal(commandFor(message), null, message);
  }

  for (const message of [
    'build us a shelter',
    'please build us a shelter',
    'I want you to build us a shelter',
    'I need you to build us a shelter',
  ]) {
    assert.equal(classifyPlayerSpeechAuthority(message), 'action_eligible', message);
    assert.equal(commandFor(message), '!assignFunctionalShelterJob("cobblestone")', message);
  }
});

test('digTunnel is reachable deterministically (the reported gap)', () => {
  assert.equal(commandFor('dig a straight tunnel forward for 8 blocks'), '!digTunnel("forward", 8)');
  assert.equal(commandFor('cut a tunnel north 20'), '!digTunnel("north", 20)');
  assert.equal(commandFor('dig forward 12'), '!digTunnel("forward", 12)');
  // Length clamps to the skill domain [1, 64].
  assert.equal(commandFor('bore a tunnel east 500'), '!digTunnel("east", 64)');
});

test('digDown and digTunnel do not collide', () => {
  assert.equal(commandFor('dig down 5'), '!digDown(5)');
  assert.equal(commandFor('dig straight down 30'), '!digDown(30)');
  // "dig forward" is a tunnel, not a down-dig.
  assert.equal(commandFor('dig forward 6'), '!digTunnel("forward", 6)');
});

test('surface, coordinates, move-away, bed, fish, and death recovery route directly', () => {
  assert.equal(commandFor('get back to the surface'), '!goToSurface');
  assert.equal(commandFor('go to 100 64 -200'), '!goToCoordinates(100, 64, -200, 2)');
  assert.equal(commandFor('go to coordinates 10, 70, 5'), '!goToCoordinates(10, 70, 5, 2)');
  assert.equal(commandFor('back off 3'), '!moveAway(3)');
  assert.equal(commandFor('give me some space'), '!moveAway(5)');
  assert.equal(commandFor('go to sleep'), '!goToBed');
  assert.equal(commandFor('go inside and sleep'), '!goToBed');
  assert.equal(commandFor('sleep inside'), '!goToBed');
  assert.equal(commandFor('go in and get some sleep'), '!goToBed');
  assert.equal(commandFor('go catch some fish'), '!fish(8)');
  assert.equal(commandFor('go get your dropped items'), '!recoverDeathItems');
});

test('new branches do not shadow existing follow/come/stay/stop directives', () => {
  assert.equal(commandFor('follow me'), '!followPlayer("Gabriel", 3)');
  assert.equal(commandFor('Follow me through the doorway and down the corridor.'), '!followPlayer("Gabriel", 3)');
  assert.equal(commandFor('come here'), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor("return to me when you're finished"), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor('head back to me'), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor('stay here'), '!stay(-1)');
  assert.equal(commandFor('stop'), '!stop');
  // "go to sleep" must resolve to bed, not be swallowed by the coordinate branch.
  assert.equal(commandFor('go to sleep'), '!goToBed');
  // "go to the surface" must resolve to surface, not coordinates.
  assert.equal(commandFor('head to the surface'), '!goToSurface');
});

test('compound pickaxe upgrade requests route through the resumable typed goal', () => {
  assert.equal(
    commandFor('Please upgrade to a stone pickaxe.'),
    '!requestItemGoal("acquire", "stone_pickaxe", 1, "Gabriel", "main_hand")',
  );
  assert.equal(
    commandFor('Please upgrade to an iron pickaxe.'),
    '!requestItemGoal("acquire", "iron_pickaxe", 1, "Gabriel", "main_hand")',
  );
  assert.equal(
    commandFor('Please upgrade to a diamond axe.'),
    '!requestItemGoal("acquire", "diamond_axe", 1, "Gabriel", "main_hand")',
  );
  assert.equal(
    commandFor('Please gather 16 logs and keep them in your inventory.'),
    '!requestItemGoal("acquire", "logs", 16, "Gabriel", "inventory")',
  );
});

test('non-directive chatter still returns null (falls through to the model)', () => {
  assert.equal(commandFor('what a lovely day it is'), null);
  assert.equal(commandFor('go to the store and buy milk'), null);
});

test('an explicit continuation resumes remembered construction without model redesign', () => {
  const directive = resolvePlayerDirective('Gabriel', 'Resume the last construction');
  assert.equal(directive.command, '!resumeStructureJob');
  assert.equal(directive.releasesHold, true);
});

test('compound construction keeps ownership instead of becoming a material quota', () => {
  const request = 'Build a powered loop, gather the redstone yourself, and keep working until it is complete.';
  const directive = resolvePlayerDirective('Gabriel', request, {});
  assert.equal(commandFor(request), null);
  assert.equal(directive?.deferToModel, true);
  assert.equal(directive?.releasesHold, true);
  assert.match(directive?.modelInstruction || '', /complete bounded blueprint/i);
});

test('known manufactured outputs outrank the generic make-as-construction fallback', () => {
  const manufactured = resolvePlayerDirective('Gabriel', 'Make planks', {});
  assert.equal(
    manufactured?.command,
    '!requestItemGoal("acquire", "planks", 1, "Gabriel", "inventory")',
  );
  assert.equal(manufactured?.deferToModel, undefined);

  const structure = resolvePlayerDirective('Gabriel', 'Make a windmill', {});
  assert.equal(structure?.command, null);
  assert.equal(structure?.deferToModel, true);
});

test('vague tool preparation cannot authorize construction without a multi-block object', () => {
  const tools = resolvePlayerDirective('Gabriel', 'make whatever basic tools you need');
  const gazebo = resolvePlayerDirective('Gabriel', 'make a small gazebo here');

  assert.equal(tools?.assignmentKind, 'item_plan');
  assert.equal(tools?.deferToModel, true);
  assert.match(tools?.modelInstruction || '', /!queueItemPlan/);
  assert.equal(gazebo?.deferToModel, true);
  assert.notEqual(gazebo?.assignmentKind, 'item_plan');
});

test('ordinary setup language compiles one functional worksite through the durable Builder boundary', () => {
  const directive = resolvePlayerDirective(
    'Gabriel',
    "Set up a small shared work area with a crafting table, furnace, chest, and light. Keep the entrance clear and don't damage the surrounding terrain.",
  );

  assert.equal(directive?.command, null);
  assert.equal(directive?.deferToModel, true);
  assert.match(directive?.modelInstruction || '', /one player-authorized multi-block construction outcome/i);
  assert.match(directive?.modelInstruction || '', /crafting, interior_light, smelting, storage/);
  assert.match(directive?.modelInstruction || '', /one complete !buildStructure or !designStructure/);
  assert.match(directive?.modelInstruction || '', /access uses put door, gate, or ladder/i);
  assert.match(directive?.modelInstruction || '', /do not issue .*individual placement commands first/i);
});

test('typed item routing binds verb, quantity, and target inside one primary item request', () => {
  const bot = {
    registry: {
      itemsByName: {
        chest: { displayName: 'Chest' },
        crafting_table: { displayName: 'Crafting Table' },
      },
      blocksByName: {
        chest: { displayName: 'Chest' },
        light: { displayName: 'Light' },
        crafting_table: { displayName: 'Crafting Table' },
      },
    },
  };
  const broadRequest = 'Use this outpost as your home base. Explore and light a nearby cave, collect useful exposed ore without damaging the outpost or any player-built structures, then return here and store what you found in this chest.';

  assert.equal(resolvePlayerDirective('Gabriel', broadRequest, { bot }), null);
  assert.equal(
    resolvePlayerDirective('Gabriel', 'Please gather 16 logs and keep them in your inventory.', { bot })?.command,
    '!requestItemGoal("acquire", "logs", 16, "Gabriel", "inventory")',
  );
  assert.equal(
    resolvePlayerDirective('Gabriel', 'Please collect 3 logs using this crafting table.', { bot })?.command,
    '!requestItemGoal("acquire", "logs", 3, "Gabriel", "inventory")',
  );
});
