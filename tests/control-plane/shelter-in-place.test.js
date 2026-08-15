import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import {
  assessShelterInPlace,
  shelterInPlace,
} from '../../src/agent/library/skills.js';

function block(name, position) {
  return {
    name,
    position,
    boundingBox: name === 'air' ? 'empty' : 'block',
  };
}

function shelterBot({ material = null, floor = 'grass_block', overrides = new Map() } = {}) {
  const position = new Vec3(0, 64, 0);
  let digCalls = 0;
  const item = material ? { name: material, count: 1 } : null;
  const bot = {
    entity: { position, onGround: true },
    interrupt_code: false,
    inventory: {
      items: () => item ? [item] : [],
      findInventoryItem: name => item?.name === name ? item : null,
    },
    blockAt(target) {
      const at = target.floored ? target.floored() : target;
      const key = `${at.x},${at.y},${at.z}`;
      if (overrides.has(key)) return block(overrides.get(key), at);
      if (at.x === 0 && at.y === 63 && at.z === 0) return block(floor, at);
      return block(at.y <= 63 ? 'dirt' : 'air', at);
    },
    dig() {
      digCalls += 1;
      return Promise.resolve();
    },
  };
  return { bot, digCalls: () => digCalls };
}

test('shelter admission proves a three-deep natural shaft, carried cap, and supported seal cell', () => {
  const { bot } = shelterBot({ material: 'dirt' });

  const receipt = assessShelterInPlace(bot);

  assert.equal(receipt.feasible, true);
  assert.equal(receipt.code, 'ready');
  assert.equal(receipt.depth, 3);
  assert.equal(receipt.material, 'dirt');
  assert.deepEqual(receipt.sealPosition, { x: 0, y: 63, z: 0 });
});

test('missing sealing material fails before shelter execution mutates terrain', async () => {
  const { bot, digCalls } = shelterBot();

  const result = await shelterInPlace(bot);

  assert.equal(result, false);
  assert.equal(bot.lastActionEvidence.outcome, 'no_sealing_material');
  assert.equal(digCalls(), 0);
  assert.deepEqual(bot.entity.position, new Vec3(0, 64, 0));
});

test('crafted floor fails before shelter execution digs or reports a canopy as a sealed pocket', async () => {
  const { bot, digCalls } = shelterBot({ material: 'cobblestone', floor: 'oak_planks' });

  const result = await shelterInPlace(bot);

  assert.equal(result, false);
  assert.equal(bot.lastActionEvidence.outcome, 'crafted_floor');
  assert.equal(digCalls(), 0);
});

test('adjacent liquid in the loaded shaft is terminal fixture evidence, not permission to try digging', () => {
  const overrides = new Map([['1,62,0', 'water']]);
  const { bot } = shelterBot({ material: 'dirt', overrides });

  const receipt = assessShelterInPlace(bot);

  assert.equal(receipt.feasible, false);
  assert.equal(receipt.code, 'adjacent_liquid');
  assert.equal(receipt.completed, 1);
});

test('two-block descent is rejected because the cap would be above the old ground support', () => {
  const { bot } = shelterBot({ material: 'dirt' });

  const receipt = assessShelterInPlace(bot, { depth: 2 });

  assert.equal(receipt.feasible, false);
  assert.equal(receipt.code, 'unsupported_enclosure_depth');
});
