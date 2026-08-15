import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { craftingSafetyBlocker } from '../src/agent/library/skills.js';

function botWith(entity, { interrupted = false } = {}) {
  return {
    interrupt_code: interrupted,
    entity: { position: new Vec3(0, 64, 0) },
    nearestEntity(predicate) {
      return predicate(entity) ? entity : null;
    },
  };
}

test('crafting safety yields before Mineflayer inventory interaction for an immediate hostile', () => {
  const skeleton = { id: 17, name: 'skeleton', type: 'hostile', position: new Vec3(3, 64, 0) };

  assert.deepEqual(craftingSafetyBlocker(botWith(skeleton)), {
    code: 'hostile_nearby',
    threat: { id: 17, name: 'skeleton', distance: 3 },
  });
});

test('crafting safety permits distant hostiles but preserves an existing interrupt', () => {
  const skeleton = { id: 18, name: 'skeleton', type: 'hostile', position: new Vec3(8, 64, 0) };

  assert.equal(craftingSafetyBlocker(botWith(skeleton)), null);
  assert.deepEqual(craftingSafetyBlocker(botWith(skeleton, { interrupted: true })), {
    code: 'interrupted',
    threat: null,
  });
});
