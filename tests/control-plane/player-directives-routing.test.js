import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePlayerDirective } from '../../src/agent/player-directives.js';
import { classifyPlayerSpeechAuthority } from '../../src/agent/player-speech-authority.js';
import { stripLeadingAgentAddress } from '../../src/agent/chat-address.js';

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

test('a family member expressing a wish does not authorize resource work', () => {
  const message = 'I hope we find enough iron for a bucket and some shears.';
  assert.equal(classifyPlayerSpeechAuthority(message), 'conversation_only');
  assert.equal(commandFor(message), null);
});

test('a server-authority request cannot authorize substitute physical work', () => {
  for (const message of [
    'Kevin give me admin',
    'you gotta grant me operator permissions',
    'op me',
  ]) {
    assert.equal(classifyPlayerSpeechAuthority(message), 'response_only', message);
    assert.equal(commandFor(message), null, message);
  }
});

test('a spoken status request cannot authorize movement named only in its words or safety clause', () => {
  for (const message of [
    'Confirm you are online by saying DeepSeek Flash online. Do not move or start a task.',
    'Say "follow me". Do not move.',
    'Tell me your current status.',
    'Status only: keep the existing expedition and keep moving. When you finish getting to safety, continue the exact plan. Do not start over.',
    'Kevin, status only: keep the existing expedition and keep moving. When you finish getting to safety, continue the exact plan. Do not start over.',
  ]) {
    assert.equal(classifyPlayerSpeechAuthority(message), 'response_only', message);
    assert.equal(commandFor(message), null, message);
  }

  assert.equal(
    classifyPlayerSpeechAuthority('Confirm you are ready, then follow me.'),
    'action_eligible',
    'an explicit follow-on physical instruction must retain action authority',
  );
});

test('a preservation clause naming a build cannot grant construction authority', () => {
  const message = 'Come home to KidPlayer at the family base using safe existing terrain. Do not damage any build.';
  const directive = resolvePlayerDirective('DadPlayer', message, {});

  assert.equal(directive?.deferToModel, undefined);
  assert.equal(directive?.assignmentKind, undefined);
  assert.notEqual(directive?.command, '!designStructure');

  const authorized = resolvePlayerDirective(
    'DadPlayer',
    'Build a small shelter without damaging any existing build.',
    {},
  );
  assert.ok(authorized, 'an affirmative construction clause must remain authorized');
});

test('a named-player home request binds the explicit player and preserves identity', () => {
  const directive = resolvePlayerDirective(
    'DadPlayer',
    'come home to KidPlayer at the family base using safe existing terrain. Do not damage any build.',
  );

  assert.equal(directive.command, '!goToPlayer("KidPlayer", 2)');
  assert.equal(directive.releasesHold, true);
});

test('a family return pronoun binds the exact requesting player', () => {
  const directive = resolvePlayerDirective('DadPlayer', 'come back to us');

  assert.equal(directive.command, '!goToPlayer("DadPlayer", 2)');
  assert.equal(directive.releasesHold, true);
});

test('a same-player rendezvous reasserts rather than downgrades a standing companion directive', () => {
  const companion = {
    directive: 'follow',
    requestedName: 'DadPlayer',
    canonicalUsername: 'DadPlayer',
    alias: 'DadPlayer',
  };
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'come to me', { companion }).command,
    '!followPlayer("DadPlayer", 3)',
  );

  companion.directive = 'guard';
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'come here', { companion }).command,
    '!guardPlayer("DadPlayer", 3)',
  );

  assert.equal(
    resolvePlayerDirective('KidPlayer', 'come to me', { companion }).command,
    '!goToPlayer("KidPlayer", 2)',
    'a different speaker cannot inherit DadPlayer standing authority',
  );
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
  assert.equal(commandFor('mine straight down until you cannot mine anymore'), '!digDown(384)');
  // "dig forward" is a tunnel, not a down-dig.
  assert.equal(commandFor('dig forward 6'), '!digTunnel("forward", 6)');
});

test('player item handoffs inspect authoritative carried and dropped state', () => {
  assert.equal(commandFor('I threw you a new one'), '!awareness');
  assert.equal(commandFor('I just gavae you my pickaxe'), '!awareness');
  assert.equal(commandFor('I handed you another tool'), '!awareness');
});

test('natural cancellation of an old plan routes to durable agenda control', () => {
  assert.equal(
    commandFor('Forget the rest of your old plan. We are done with it.'),
    '!clearAgenda',
  );
  assert.equal(commandFor('Clear your old plan.'), '!clearAgenda');
});

test('surface, coordinates, move-away, bed, fish, and death recovery route directly', () => {
  assert.equal(commandFor('get back to the surface'), '!goToSurface');
  assert.equal(commandFor('go to 100 64 -200'), '!goToCoordinates(100, 64, -200, 2)');
  assert.equal(commandFor('go to coordinates 10, 70, 5'), '!goToCoordinates(10, 70, 5, 2)');
  assert.equal(commandFor('back off 3'), '!moveAway(3)');
  assert.equal(commandFor('Give us a little room—step back four blocks.'), '!moveAway(4, false, "Gabriel")');
  assert.equal(commandFor('give us some space'), '!moveAway(5, false, "Gabriel")');
  assert.equal(commandFor('give me some space'), '!moveAway(5)');
  assert.equal(commandFor('go to sleep'), '!goToBed');
  assert.equal(commandFor('go sleep in one of our beds'), '!goToBed');
  assert.equal(commandFor('go inside and sleep'), '!goToBed');
  assert.equal(commandFor('sleep inside'), '!goToBed');
  assert.equal(commandFor('go in and get some sleep'), '!goToBed');
  assert.equal(commandFor('go catch some fish'), '!fish(8)');
  assert.equal(commandFor('go get your dropped items'), '!recoverDeathItems');
});

test('a conversational boat ride noun does not become another mount action', () => {
  assert.equal(commandFor('Are you ready for our boat ride?'), null);
  assert.equal(commandFor('That boat ride was fun.'), null);
  assert.equal(commandFor('Ride the boat.'), '!mountEntity("boat", 32)');
  assert.equal(commandFor('Hop on the boat.'), '!mountEntity("boat", 32)');
});

test('new branches do not shadow existing follow/come/stay/stop directives', () => {
  assert.equal(commandFor('follow me'), '!followPlayer("Gabriel", 3)');
  assert.equal(commandFor('Follow me through the doorway and down the corridor.'), '!followPlayer("Gabriel", 3)');
  assert.equal(commandFor('come here'), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor("return to me when you're finished"), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor('head back to me'), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor('stay here'), '!stop');
  assert.equal(commandFor('wait'), '!stop');
  assert.equal(
    commandFor('wait here while we step away. Stay put until one of us comes back.'),
    '!stop',
  );
  assert.equal(commandFor('stop'), '!stop');
  // "go to sleep" must resolve to bed, not be swallowed by the coordinate branch.
  assert.equal(commandFor('go to sleep'), '!goToBed');
  // "go to the surface" must resolve to surface, not coordinates.
  assert.equal(commandFor('head to the surface'), '!goToSurface');
});

test('generic eat requests use the validated best-food selector', () => {
  assert.equal(commandFor('eat the watermelon'), '!consume("best_food")');
  assert.equal(commandFor('have something to eat'), '!consume("best_food")');
});

test('deictic gaze commands bind the exact speaking player', () => {
  assert.equal(
    resolvePlayerDirective('KidPlayer', 'Simon says, look at me.')?.command,
    '!lookAtPlayer("KidPlayer", "at")',
  );
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'Now look at me.')?.command,
    '!lookAtPlayer("DadPlayer", "at")',
  );
  assert.equal(commandFor('Are you looking at me?'), null);
});

test('qualified equipment requests bind the registry item before trailing prose', () => {
  const bot = {
    registry: {
      itemsByName: {
        iron_helmet: { displayName: 'Iron Helmet' },
        shield: { displayName: 'Shield' },
      },
    },
  };

  assert.equal(
    resolvePlayerDirective('DadPlayer', 'Put on the iron helmet I set out for you.', { bot })?.command,
    '!equip("iron_helmet")',
  );
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'Wear the iron helmet now.', { bot })?.command,
    '!equip("iron_helmet")',
  );
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'Hold the shield for me.', { bot })?.command,
    '!equip("shield")',
  );
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'Put on the moon helmet I found.', { bot }),
    null,
  );
});

test('shared single-block placement binds the requester and existing placement capability', () => {
  const bot = {
    registry: {
      itemsByName: {
        crafting_table: { displayName: 'Crafting Table' },
        chest: { displayName: 'Chest' },
      },
    },
  };
  const directive = resolvePlayerDirective(
    'DadPlayer',
    'Please set your crafting table beside us where all three of us can reach it.',
    { bot },
  );

  assert.equal(directive?.command, '!place("DadPlayer", "crafting_table", 1, true)');
  assert.equal(directive?.releasesHold, true);
  assert.match(directive?.response || '', /nearby family can share/i);
  assert.equal(
    resolvePlayerDirective('DadPlayer', 'Put the crafting table in the chest.', { bot })?.command,
    '!putInChest("crafting_table", 64)',
  );
});

test('a leading bot address does not hide the deterministic Follow directive', () => {
  const message = stripLeadingAgentAddress(
    'IronSuiteProof, follow me while we look around the base.',
    'IronSuiteProof',
  );
  assert.equal(message, 'follow me while we look around the base.');
  assert.equal(commandFor(message), '!followPlayer("Gabriel", 3)');
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
