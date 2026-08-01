import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePlayerDirective } from '../../src/agent/player-directives.js';

function commandFor(message) {
  const directive = resolvePlayerDirective('Gabriel', message, {});
  return directive?.command ?? null;
}

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
  assert.equal(commandFor('go catch some fish'), '!fish(8)');
  assert.equal(commandFor('go get your dropped items'), '!recoverDeathItems');
});

test('new branches do not shadow existing follow/come/stay/stop directives', () => {
  assert.equal(commandFor('follow me'), '!followPlayer("Gabriel", 3)');
  assert.equal(commandFor('come here'), '!goToPlayer("Gabriel", 2)');
  assert.equal(commandFor('stay here'), '!stay(-1)');
  assert.equal(commandFor('stop'), '!stop');
  // "go to sleep" must resolve to bed, not be swallowed by the coordinate branch.
  assert.equal(commandFor('go to sleep'), '!goToBed');
  // "go to the surface" must resolve to surface, not coordinates.
  assert.equal(commandFor('head to the surface'), '!goToSurface');
});

test('non-directive chatter still returns null (falls through to the model)', () => {
  assert.equal(commandFor('what a lovely day it is'), null);
  assert.equal(commandFor('go to the store and buy milk'), null);
});
