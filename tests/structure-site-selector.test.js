import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import { selectConstructionSites } from '../src/agent/runtime/jobs/structure-site-selector.js';

function block(name, x, y, z, boundingBox = name === 'air' ? 'empty' : 'block') {
  return { name, boundingBox, position: new Vec3(x, y, z) };
}

test('construction site binding rejects the fixed offset inside stone and selects clear natural ground', () => {
  const bot = {
    entity: { id: 1, position: new Vec3(0.5, 10, 0.5) },
    entities: {},
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
