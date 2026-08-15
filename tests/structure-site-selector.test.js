import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import {
  selectConstructionSites,
  selectOppositeLandmarkLayoutSites,
} from '../src/agent/runtime/jobs/structure-site-selector.js';

function block(name, x, y, z, boundingBox = name === 'air' ? 'empty' : 'block') {
  return { name, boundingBox, position: new Vec3(x, y, z) };
}

const registry = {
  blocksByName: {
    cobblestone: { name: 'cobblestone', boundingBox: 'block' },
    oak_planks: { name: 'oak_planks', boundingBox: 'block' },
    torch: { name: 'torch', boundingBox: 'empty' },
  },
};

test('opposite-side landmark binding widens and faces two stair fixtures across the loaded footprint', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y === 10 && x >= 9 && x <= 11 && z >= 9 && z <= 11) {
        return block('spruce_planks', x, y, z);
      }
      if (y === 9) return block('stone', x, y, z);
      return block('air', x, y, z, 'empty');
    },
  };
  const fixture = (id, x, facing) => ({
    id,
    kind: 'stair',
    material: 'spruce_stairs',
    function: 'seating',
    facing,
    anchor: { x, y: 0, z: 0 },
    occupiedOffsets: [{ x: 0, y: 0, z: 0 }],
    supportOffsets: [],
  });
  const blueprint = {
    id: 'picnic_seats',
    width: 3,
    height: 1,
    depth: 1,
    cells: [
      { x: 0, y: 0, z: 0, material: 'spruce_stairs', fixtureId: 'stair_1', facing: 'west' },
      { x: 2, y: 0, z: 0, material: 'spruce_stairs', fixtureId: 'stair_2', facing: 'east' },
    ],
    fixtures: [fixture('stair_1', 0, 'west'), fixture('stair_2', 2, 'east')],
  };

  const selection = selectOppositeLandmarkLayoutSites(bot, blueprint, {
    landmark: { x: 10, y: 11, z: 10 },
    clearance: 1,
    isNaturalTerrain: candidate => candidate?.name === 'stone',
  });

  assert.equal(selection.code, 'layout_sites_found');
  assert.equal(selection.sites.length, 2);
  const eastWest = selection.sites.find(site => site.axis === 'x');
  assert.deepEqual(eastWest.origin, { x: 7, y: 10, z: 10 });
  assert.equal(eastWest.blueprint.width, 7);
  assert.deepEqual(eastWest.blueprint.cells.map(cell => ({ x: cell.x, z: cell.z, facing: cell.facing })), [
    { x: 0, z: 0, facing: 'west' },
    { x: 6, z: 0, facing: 'east' },
  ]);
  assert.deepEqual(eastWest.fixturePositions, [
    { x: 7, y: 10, z: 10 },
    { x: 13, y: 10, z: 10 },
  ]);
});

test('construction site binding rejects the fixed offset inside stone and selects clear natural ground', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y < 10) return block('stone', x, y, z);
      if (x >= 2 && x <= 4 && z >= 2 && z <= 4 && y <= 11) {
        return block('stone', x, y, z);
      }
      return block('air', x, y, z, 'empty');
    },
  };
  const blueprint = {
    width: 3,
    height: 1,
    depth: 3,
    cells: Array.from({ length: 9 }, (_, index) => ({
      x: index % 3,
      y: 0,
      z: Math.floor(index / 3),
      material: 'cobblestone',
    })),
  };

  const selection = selectConstructionSites(bot, blueprint, {
    origin: bot.entity.position,
    radius: 8,
    verticalRadius: 3,
    isNaturalTerrain: candidate => candidate?.name === 'stone',
  });

  assert.equal(selection.sites.length > 0, true);
  assert.notDeepEqual(selection.sites[0].origin, { x: 2, y: 10, z: 2 });
  assert.equal(selection.sites[0].supportRatio, 1);
  for (const cell of blueprint.cells) {
    const site = selection.sites[0].origin;
    assert.equal(bot.blockAt(new Vec3(site.x + cell.x, site.y, site.z + cell.z)).name, 'air');
  }
});

test('construction site binding admits exact natural clearing already authorized to Builder', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y === 9 && x >= 1 && x <= 5 && z >= 1 && z <= 5) {
        return block('stone', x, y, z);
      }
      if (x === 3 && y === 10 && z === 3) return block('oak_log', x, y, z);
      return block('air', x, y, z, 'empty');
    },
  };
  const blueprint = {
    width: 3,
    height: 1,
    depth: 3,
    cells: Array.from({ length: 9 }, (_, index) => ({
      x: index % 3,
      y: 0,
      z: Math.floor(index / 3),
      material: 'cobblestone',
    })),
  };

  const selection = selectConstructionSites(bot, blueprint, {
    origin: bot.entity.position,
    radius: 6,
    verticalRadius: 2,
    isNaturalTerrain: candidate => ['stone', 'oak_log'].includes(candidate?.name),
  });

  assert.equal(selection.sites.length > 0, true);
  assert.equal(selection.sites[0].clearanceCount, 1);
});

test('construction site binding rejects a fully buried volume in favor of surface terrain', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y <= 9) return block('stone', x, y, z);
      return block('air', x, y, z, 'empty');
    },
  };
  const blueprint = {
    width: 3,
    height: 1,
    depth: 3,
    cells: Array.from({ length: 9 }, (_, index) => ({
      x: index % 3,
      y: 0,
      z: Math.floor(index / 3),
      material: 'cobblestone',
    })),
  };

  const selection = selectConstructionSites(bot, blueprint, {
    origin: bot.entity.position,
    radius: 6,
    verticalRadius: 3,
    isNaturalTerrain: candidate => candidate?.name === 'stone',
  });

  assert.equal(selection.sites.length > 0, true);
  assert.equal(selection.sites.every(site => site.origin.y === 10), true);
});

test('construction site binding rejects an unsupported isolated base cell before Builder ownership', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y === 9 && !(x === 5 && z === 5)) return block('stone', x, y, z);
      return block('air', x, y, z, 'empty');
    },
  };
  const blueprint = {
    width: 5,
    height: 2,
    depth: 5,
    cells: [
      { x: 0, y: 0, z: 0, material: 'oak_planks' },
      { x: 1, y: 0, z: 0, material: 'oak_planks' },
      { x: 3, y: 0, z: 3, material: 'oak_planks' },
      { x: 3, y: 1, z: 3, material: 'torch' },
    ],
  };

  const selection = selectConstructionSites(bot, blueprint, {
    origin: bot.entity.position,
    radius: 6,
    verticalRadius: 2,
    isNaturalTerrain: candidate => candidate?.name === 'stone',
  });

  assert.equal(selection.sites.length > 0, true);
  assert.equal(selection.sites.some(site => site.origin.x === 2 && site.origin.z === 2), false);
  assert.equal(selection.sites.every(site => (
    bot.blockAt(new Vec3(site.origin.x + 3, site.origin.y - 1, site.origin.z + 3)).name === 'stone'
  )), true, 'the connected edge may bridge, but every isolated light post must have real ground');
});

test('construction site binding rejects a door whose exterior approach is inside a tree', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y === 9) return block('stone', x, y, z);
      // The otherwise attractive (0, 10, 2) anchor puts its west-facing
      // exterior approach at x=-1/-2, z=3. The footprint itself is clear.
      if ([-1, -2].includes(x) && [10, 11].includes(y) && z === 3) {
        return block(y === 10 ? 'spruce_log' : 'spruce_leaves', x, y, z);
      }
      return block('air', x, y, z, 'empty');
    },
  };
  const blueprint = {
    width: 3,
    height: 3,
    depth: 3,
    cells: [
      ...Array.from({ length: 9 }, (_, index) => ({
        x: index % 3,
        y: 0,
        z: Math.floor(index / 3),
        material: 'cobblestone',
      })),
      { x: 0, y: 1, z: 1, material: 'oak_door', fixtureId: 'door_1' },
    ],
    fixtures: [{
      id: 'door_1',
      kind: 'door',
      function: 'access',
      material: 'oak_door',
      facing: 'east',
      anchor: { x: 0, y: 1, z: 1 },
    }],
  };

  const selection = selectConstructionSites(bot, blueprint, {
    origin: bot.entity.position,
    radius: 6,
    verticalRadius: 2,
    isNaturalTerrain: candidate => ['stone', 'spruce_log', 'spruce_leaves'].includes(candidate?.name),
  });

  assert.equal(selection.sites.length > 0, true);
  assert.equal(selection.sites.some(site => (
    site.origin.x === 0 && site.origin.y === 10 && site.origin.z === 2
  )), false, 'a clear footprint is not usable when the promised entrance opens into a tree');
});

test('construction site binding rejects a footprint without a continuous exterior work ring', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
    registry,
    blockAt(position) {
      const { x, y, z } = position;
      if (y === 9) {
        // The (0, 10, 2) footprint is supported, as are its north and west
        // approaches, but its east/south service edge hangs over a drop.
        if ((x === 3 && z >= 2 && z <= 5) || (z === 5 && x >= -1 && x <= 3)) {
          return block('air', x, y, z, 'empty');
        }
        return block('stone', x, y, z);
      }
      return block('air', x, y, z, 'empty');
    },
  };
  const blueprint = {
    width: 3,
    height: 3,
    depth: 3,
    cells: [
      ...Array.from({ length: 9 }, (_, index) => ({
        x: index % 3,
        y: 0,
        z: Math.floor(index / 3),
        material: 'cobblestone',
      })),
      { x: 0, y: 1, z: 1, material: 'oak_door', fixtureId: 'door_1' },
    ],
    fixtures: [{
      id: 'door_1',
      kind: 'door',
      function: 'access',
      material: 'oak_door',
      facing: 'east',
      anchor: { x: 0, y: 1, z: 1 },
    }],
  };

  const selection = selectConstructionSites(bot, blueprint, {
    origin: bot.entity.position,
    radius: 6,
    verticalRadius: 2,
    isNaturalTerrain: candidate => candidate?.name === 'stone',
  });

  assert.equal(selection.sites.length > 0, true);
  assert.equal(selection.sites.some(site => (
    site.origin.x === 0 && site.origin.y === 10 && site.origin.z === 2
  )), false, 'Builder has no scaffold authority, so every exterior service cell must be walkable');
});
