import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fixtureOrientationStances,
  isClearableWorksiteBlock,
  isNaturalFillBlock,
  placeBlock,
  selectPlayerRelativePlacementSites,
  selectRedundantExcavationDebrisStack,
} from '../../src/agent/library/skills.js';
import Vec3 from 'vec3';

test('processed cobblestone structures are not classified as clearable natural terrain', () => {
  const bot = {};

  assert.equal(isNaturalFillBlock(bot, { name: 'stone' }), true);
  assert.equal(isClearableWorksiteBlock(bot, { name: 'cobblestone' }), false);
  assert.equal(isClearableWorksiteBlock(bot, { name: 'cobbled_deepslate' }), false);
  assert.equal(selectRedundantExcavationDebrisStack([
    { name: 'cobblestone', count: 64, slot: 9 },
    { name: 'cobblestone', count: 24, slot: 10 },
  ], new Set())?.slot, 9);
  assert.equal(selectRedundantExcavationDebrisStack([
    { name: 'cobblestone', count: 64, slot: 9 },
    { name: 'cobblestone', count: 24, slot: 10 },
  ], new Set(['cobblestone'])), null);
});

test('oriented fixtures use a reachable orientation ray down a raised worksite slope', () => {
  const anchor = new Vec3(10, 69, 10);
  const lowerStance = new Vec3(10, 67, 7);
  const bot = {
    entity: { position: new Vec3(10.5, 67, 6.5) },
    blockAt(position) {
      if (position.equals(lowerStance.offset(0, -1, 0))) {
        return { name: 'stone', boundingBox: 'block', position };
      }
      return { name: 'air', boundingBox: 'empty', position };
    },
  };

  assert.deepEqual(
    fixtureOrientationStances(bot, anchor, { x: 0, y: 0, z: 1 }),
    [lowerStance],
  );
});

test('shared player placement selects supported serviceable ground for the loaded family', () => {
  const dad = { id: 1, type: 'player', username: 'DadPlayer', position: new Vec3(0.5, 68, 0.5) };
  const kid = { id: 2, type: 'player', username: 'KidPlayer', position: new Vec3(3.5, 68, 0.5) };
  const self = { id: 3, type: 'player', username: 'IronSuiteProof', position: new Vec3(0.5, 68, 8.5) };
  const bot = {
    username: 'IronSuiteProof',
    entity: self,
    players: {
      DadPlayer: { username: 'DadPlayer', entity: dad },
      KidPlayer: { username: 'KidPlayer', entity: kid },
      IronSuiteProof: { username: 'IronSuiteProof', entity: self },
    },
    entities: { 1: dad, 2: kid, 3: self },
    blockAt(position) {
      if (position.y === 67) return { name: 'grass_block', boundingBox: 'block', position };
      return { name: 'air', boundingBox: 'empty', position };
    },
  };

  const selection = selectPlayerRelativePlacementSites(bot, 'DadPlayer', { shared: true });

  assert.equal(selection.code, 'sites_found');
  assert.deepEqual(selection.participants, ['DadPlayer', 'KidPlayer']);
  assert.ok(selection.sites.length > 0);
  assert.ok(selection.sites[0].maxParticipantDistance <= 6);
  assert.ok(selection.sites[0].serviceStanceCount >= 2);
  assert.notDeepEqual(selection.sites[0].position, self.position.floored());
  assert.ok(Object.isFrozen(selection));
  assert.ok(Object.isFrozen(selection.sites));
});

test('Given a blueprint cell occupied by an unrelated block, strict placement refuses to break it', async () => {
  const material = { name: 'stone', count: 1 };
  const bot = {
    restrict_to_inventory: true,
    modes: { isOn: () => false },
    game: { gameMode: 'survival' },
    inventory: {
      findInventoryItem: name => name === 'stone' ? material : null,
    },
    blockAt: () => ({
      name: 'crafting_table',
      position: { x: 1, y: 64, z: 1 },
    }),
  };

  const result = await placeBlock(bot, 'stone', 1, 64, 1, 'bottom', true, false);

  assert.equal(result, false);
  assert.equal(bot.lastActionEvidence.kind, 'place');
  assert.equal(bot.lastActionEvidence.outcome, 'occupied');
  assert.equal(bot.lastActionEvidence.observed, 'crafting_table');
  assert.equal(bot.lastActionEvidence.retryable, false);
});

test('strict placement uses the shared replaceable-cell contract', async () => {
  const material = { name: 'stone', count: 1, slot: 9 };
  const target = new Vec3(1, 64, 1);
  let placed = false;
  let placementRaycasts = 0;
  const bot = {
    restrict_to_inventory: true,
    modes: { isOn: () => false },
    game: { gameMode: 'survival' },
    registry: {},
    inventory: {
      slots: [],
      findInventoryItem: name => name === 'stone' ? material : null,
    },
    entity: { position: new Vec3(1.5, 64, 4.5) },
    blockAt(position) {
      if (position.equals(target)) {
        return { name: placed ? 'stone' : 'vine', boundingBox: placed ? 'block' : 'empty', position };
      }
      if (position.equals(target.offset(0, -1, 0))) {
        return {
          name: 'stone',
          boundingBox: 'block',
          position,
          shapes: [[0, 0, 0, 1, 1, 1]],
        };
      }
      if (position.equals(new Vec3(1, 63, 4))) {
        return {
          name: 'stone',
          boundingBox: 'block',
          position,
          shapes: [[0, 0, 0, 1, 1, 1]],
        };
      }
      return { name: 'air', boundingBox: 'empty', position };
    },
    pathfinder: {
      setGoal() {},
      stop() {},
    },
    controlState: {},
    clearControlStates() {},
    on() {},
    removeListener() {},
    equip(item) { this.heldItem = item; },
    async lookAt() {},
    getControlState: () => false,
    setControlState() {},
    async waitForTicks() {},
    placeBlock() { placed = true; },
  };
  bot.world = {
    getBlock: position => bot.blockAt(position),
    raycast() {
      placementRaycasts += 1;
      return {
        ...bot.blockAt(target.offset(0, -1, 0)),
        face: 1,
      };
    },
  };

  const result = await placeBlock(bot, 'stone', 1, 64, 1, 'bottom', false, false);

  assert.equal(result, true);
  assert.ok(placementRaycasts > 0, 'native GoalPlaceBlock should verify the exact support face');
  assert.equal(bot.lastActionEvidence.outcome, 'placed');
});
