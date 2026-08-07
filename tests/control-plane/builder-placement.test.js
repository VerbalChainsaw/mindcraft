import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fixtureOrientationStances,
  placeBlock,
} from '../../src/agent/library/skills.js';
import Vec3 from 'vec3';

test('oriented fixtures use a safe lower stance outside a raised foundation', () => {
  const anchor = new Vec3(10, 65, 10);
  const lowerStance = new Vec3(10, 64, 8);
  const bot = {
    entity: { position: new Vec3(10.5, 64, 7.5) },
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
        return { name: 'stone', boundingBox: 'block', position };
      }
      return { name: 'air', boundingBox: 'empty', position };
    },
    equip(item) { this.heldItem = item; },
    async lookAt() {},
    getControlState: () => false,
    setControlState() {},
    async waitForTicks() {},
    placeBlock() { placed = true; },
  };

  const result = await placeBlock(bot, 'stone', 1, 64, 1, 'bottom', false, false);

  assert.equal(result, true);
  assert.equal(bot.lastActionEvidence.outcome, 'placed');
});
