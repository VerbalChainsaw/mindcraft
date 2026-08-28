import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import {
  assessShelterInPlace,
  findShelterInPlaceStances,
  occupiesDefensiveShelter,
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

test('overhead cover is not mistaken for a sealed defensive refuge', () => {
  const overrides = new Map([['0,66,0', 'stone']]);
  const { bot } = shelterBot({ material: 'dirt', overrides });

  assert.equal(occupiesDefensiveShelter(bot), false);
  const receipt = assessShelterInPlace(bot);
  assert.equal(receipt.feasible, true);
  assert.equal(receipt.code, 'ready');
});

test('shelter recovery finds nearby sealable standing cells when the current shaft is invalid', () => {
  const overrides = new Map([['0,62,0', 'air']]);
  const { bot } = shelterBot({ material: 'dirt', overrides });

  assert.equal(assessShelterInPlace(bot).feasible, false);
  const stances = findShelterInPlaceStances(bot, { radius: 2, count: 2, maxAssessments: 12 });
  assert.equal(stances.length > 0, true);
  assert.notDeepEqual(
    { x: stances[0].x, y: stances[0].y, z: stances[0].z },
    { x: 0, y: 64, z: 0 },
  );
  assert.equal(assessShelterInPlace(bot, { position: stances[0] }).feasible, true);
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

test('a natural courtyard floor remains protected when nearby build evidence exists', async () => {
  const overrides = new Map([['2,63,0', 'oak_planks']]);
  const { bot, digCalls } = shelterBot({ material: 'cobblestone', overrides });

  const result = await shelterInPlace(bot);

  assert.equal(result, false);
  assert.equal(bot.lastActionEvidence.outcome, 'protected_site');
  assert.equal(bot.lastActionEvidence.feasibility.modificationAuthority.site.evidence[0].name, 'oak_planks');
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
