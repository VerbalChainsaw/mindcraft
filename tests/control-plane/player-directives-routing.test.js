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
