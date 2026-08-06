import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import { selectFarmSites } from '../src/agent/runtime/farm-site-selector.js';

function block(name, x, y, z, boundingBox = name === 'air' ? 'empty' : 'block') {
  return { name, position: new Vec3(x, y, z), boundingBox };
}

test('farm binding skips nearer underground water and selects a coherent surface plot', () => {
  const planted = new Set();
  const bot = {
    entity: { id: 1, position: new Vec3(0, 64, 0) },
    entities: {},
    blockAt(position) {
      if (
        (position.x === 1 && position.y === 56 && position.z === 0)
        || (position.x === 8 && position.y === 63 && position.z === 0)
      ) return block('water', position.x, position.y, position.z, 'empty');
      const plantedKey = `${position.x},${position.y},${position.z}`;
      if (planted.has(plantedKey)) return block('farmland', position.x, position.y, position.z);
      if (planted.has(`${position.x},${position.y - 1},${position.z}`)) {
        return block('wheat', position.x, position.y, position.z, 'empty');
      }
      if (position.y === 63) return block('grass_block', position.x, position.y, position.z);
      if (position.y === 64 || position.y === 65) return block('air', position.x, position.y, position.z);
      return block('stone', position.x, position.y, position.z);
    },
  };
  const waters = [
    block('water', 1, 56, 0, 'empty'),
    block('water', 8, 63, 0, 'empty'),
  ];

  const selection = selectFarmSites(bot, waters, { crop: 'wheat', width: 3, depth: 3 });

  assert.ok(selection.sites.length > 0);
  assert.deepEqual(selection.sites[0].water, { x: 8, y: 63, z: 0 });
  assert.equal(selection.sites[0].cells.length, 9);
  assert.equal(selection.sites[0].cells.every(cell => cell.y === 63), true);
  assert.ok(selection.sites[0].stances.length > 0);

  for (const cell of selection.sites[0].cells) planted.add(`${cell.x},${cell.y},${cell.z}`);
  const repeated = selectFarmSites(bot, waters, { crop: 'wheat', width: 3, depth: 3 });
  assert.deepEqual(repeated.sites[0].origin, selection.sites[0].origin);
  assert.equal(repeated.sites[0].existingPlots, 9);
});
