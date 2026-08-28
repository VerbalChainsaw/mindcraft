import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentPlacementFaceFromSupportedBody,
  fixtureOrientationStances,
  interactionStandingStances,
  isClearableWorksiteBlock,
  isNaturalFillBlock,
  navigationRegionBreakWeight,
  placeBlock,
  placementStandingStances,
  selectCurrentPlacementFace,
  selectPlayerRelativePlacementSites,
  selectRedundantExcavationDebrisStack,
} from '../../src/agent/library/skills.js';
import pf from 'mineflayer-pathfinder';
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

test('placement rebinds support geometry after the worksite changes during navigation', () => {
  const target = new Vec3(168, 79, -379);
  const north = new Vec3(0, 0, -1);
  const below = new Vec3(0, -1, 0);
  const northSupport = target.plus(north);
  const belowSupport = target.plus(below);
  let liveSupport = northSupport;
  const solid = position => ({
    name: 'spruce_planks',
    boundingBox: 'block',
    position,
    shapes: [[0, 0, 0, 1, 1, 1]],
  });
  const air = position => ({
    name: 'air',
    boundingBox: 'empty',
    position,
    shapes: [],
  });
  const world = {
    getBlock(position) {
      return position.equals(liveSupport) ? solid(position) : air(position);
    },
    raycast() {
      return {
        ...solid(liveSupport),
        face: liveSupport.equals(belowSupport) ? 1 : 3,
      };
    },
  };
  const staleGoal = new pf.goals.GoalPlaceBlock(target, world, {
    range: 4.5,
    faces: [north],
    LOS: true,
  });

  // Site preparation or a preceding blueprint cell publishes a better support
  // after the route goal has already cached its original face list.
  liveSupport = belowSupport;
  const eye = new Vec3(167.5, 80.6, -379.5);
  assert.equal(staleGoal.getFaceAndRef(eye), null);

  const rebound = selectCurrentPlacementFace({
    world,
    blockAt: position => world.getBlock(position),
  }, target, [below, north], eye);

  assert.ok(rebound);
  assert.deepEqual(rebound.face, below);
  assert.deepEqual(rebound.ref, belowSupport);
});

test('placement uses an exact current face from a supported body without routing', () => {
  const target = new Vec3(164, 81, -382);
  const below = new Vec3(0, -1, 0);
  const targetSupport = target.plus(below);
  const standingCell = new Vec3(163, 78, -380);
  const standingSupport = standingCell.offset(0, -1, 0);
  const solid = position => ({
    name: 'spruce_planks',
    boundingBox: 'block',
    position,
    shapes: [[0, 0, 0, 1, 1, 1]],
  });
  const air = position => ({
    name: 'air',
    boundingBox: 'empty',
    position,
    shapes: [],
  });
  const world = {
    getBlock(position) {
      return position.equals(targetSupport) || position.equals(standingSupport)
        ? solid(position)
        : air(position);
    },
    raycast() {
      return { ...solid(targetSupport), face: 1 };
    },
  };
  const bot = {
    entity: {
      position: new Vec3(163.7, 78, -379.5),
      eyeHeight: 1.6,
    },
    world,
    blockAt: position => world.getBlock(position),
  };

  const currentPlacement = currentPlacementFaceFromSupportedBody(bot, target, [below]);

  assert.ok(currentPlacement);
  assert.deepEqual(currentPlacement.standingCell, standingCell);
  assert.deepEqual(currentPlacement.selectedFace.face, below);
  assert.deepEqual(currentPlacement.selectedFace.ref, targetSupport);
});

test('interaction stance enumeration rejects solid cells distant from the current body', () => {
  const target = { x: 0, y: 2, z: 0 };
  const blocked = new Vec3(0, 0, 0);
  const clear = new Vec3(1, 0, 0);
  const doorSupported = new Vec3(2, 0, 0);
  const solid = position => ({
    name: 'spruce_planks',
    boundingBox: 'block',
    position,
    shapes: [[0, 0, 0, 1, 1, 1]],
  });
  const air = position => ({
    name: 'air',
    boundingBox: 'empty',
    position,
    shapes: [],
  });
  const supportKeys = new Set([
    blocked.offset(0, -1, 0).toString(),
    clear.offset(0, -1, 0).toString(),
  ]);
  const doorSupport = doorSupported.offset(0, -1, 0);
  const bot = {
    entity: {
      position: new Vec3(10.5, 0, 10.5),
      width: 0.6,
      height: 1.8,
    },
    blockAt(position) {
      if (position.equals(blocked)) return solid(position);
      if (supportKeys.has(position.toString())) return solid(position);
      if (position.equals(doorSupport)) {
        return { ...solid(position), name: 'spruce_door', _properties: { open: false } };
      }
      return air(position);
    },
  };
  const goal = {
    isEnd: stance => stance.equals(blocked) || stance.equals(clear) || stance.equals(doorSupported),
  };

  const stances = interactionStandingStances(bot, target, goal);

  assert.equal(stances.some(stance => stance.equals(blocked)), false);
  assert.equal(stances.some(stance => stance.equals(clear)), true);
  assert.equal(stances.some(stance => stance.equals(doorSupported)), false);
});

test('placement stances exclude a body cell overlapping the destination block', () => {
  const target = new Vec3(0, 0, 0);
  const adjacent = new Vec3(1, 0, 0);
  const solid = position => ({
    name: 'stone',
    boundingBox: 'block',
    position,
    shapes: [[0, 0, 0, 1, 1, 1]],
  });
  const air = position => ({
    name: 'air',
    boundingBox: 'empty',
    position,
    shapes: [],
  });
  const supports = new Set([
    target.offset(0, -1, 0).toString(),
    adjacent.offset(0, -1, 0).toString(),
  ]);
  const bot = {
    entity: { position: new Vec3(4.5, 0, 4.5), width: 0.6, height: 1.8 },
    blockAt: position => supports.has(position.toString()) ? solid(position) : air(position),
  };
  const goal = { isEnd: stance => stance.equals(target) || stance.equals(adjacent) };

  const stances = placementStandingStances(bot, target, goal);

  assert.equal(stances.some(stance => stance.equals(target)), false);
  assert.equal(stances.some(stance => stance.equals(adjacent)), true);
});

test('Builder navigation protects only blocks inside the supplied worksite region', () => {
  const region = { minX: 10, maxX: 14, minY: 60, maxY: 64, minZ: -8, maxZ: -4 };

  assert.equal(navigationRegionBreakWeight({ position: new Vec3(12, 62, -6) }, [region]), 100);
  assert.equal(navigationRegionBreakWeight({ position: new Vec3(15, 62, -6) }, [region]), 0);
});
