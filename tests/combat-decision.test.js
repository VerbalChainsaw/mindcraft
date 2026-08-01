import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseTacticalCombatDecision } from '../src/agent/runtime/combat-decision.js';

const ready = Object.freeze({
  melee: true,
  shield: true,
  bow: true,
  arrows: true,
});

test('an armed healthy bot uses melee against a close zombie', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: ready,
    hostiles: [{ id: 1, name: 'zombie', distance: 3, disposition: 'combat_safe' }],
  });

  assert.equal(decision.selected.name, 'zombie');
  assert.equal(decision.response, 'melee');
});

test('a projectile threat selects shielded closing when shield and melee are ready', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: ready,
    hostiles: [{ id: 2, name: 'skeleton', distance: 9, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'shield_melee');
  assert.equal(decision.reason, 'projectile_block_and_close');
});

test('an explosive threat outranks a nearer zombie and preserves bow distance', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: ready,
    hostiles: [
      { id: 3, name: 'zombie', distance: 2, disposition: 'combat_safe' },
      { id: 4, name: 'creeper', distance: 7, disposition: 'combat_safe' },
    ],
  });

  assert.equal(decision.selected.name, 'creeper');
  assert.equal(decision.response, 'ranged');
  assert.equal(decision.selected.desiredRange, 8);
});

test('critical health overrides equipment and selects retreat', () => {
  const decision = chooseTacticalCombatDecision({
    health: 7,
    equipment: ready,
    hostiles: [{ id: 5, name: 'zombie', distance: 2, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'critical_health');
});

test('a creeper without a ranged option selects a ten-block disengagement', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: { melee: true, shield: true, bow: false, arrows: false },
    hostiles: [{ id: 7, name: 'creeper', distance: 5, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'explosive_without_ranged_option');
  assert.equal(decision.selected.desiredRange, 10);
});

test('an avoid-only hostile is never selected for autonomous attack', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: ready,
    hostiles: [{ id: 6, name: 'warden', distance: 12, disposition: 'avoid_only' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'avoid_only_threat');
});

test('an obscured nearest hostile does not suppress a more urgent loaded threat', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: ready,
    hostiles: [
      {
        id: 8,
        name: 'zombie',
        distance: 2,
        disposition: 'combat_safe',
        lineOfSight: false,
        localGeometry: { feet: 'stone', head: 'stone', onGround: true },
        motion: { state: 'stationary', closingSpeed: 0 },
      },
      {
        id: 9,
        name: 'creeper',
        distance: 6,
        disposition: 'combat_safe',
        lineOfSight: true,
        localGeometry: { feet: 'air', head: 'air', onGround: true },
        motion: { state: 'approaching', closingSpeed: 0.12 },
      },
    ],
  });

  assert.equal(decision.considered, 2);
  assert.equal(decision.selected.id, 9);
  assert.equal(decision.selected.classification, 'explosive');
  assert.equal(decision.selected.lineOfSight, true);
  assert.deepEqual(decision.ranked[1].localGeometry, { feet: 'stone', head: 'stone', onGround: true });
});
