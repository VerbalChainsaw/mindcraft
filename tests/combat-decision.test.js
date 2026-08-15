import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseTacticalCombatDecision,
  reconcileTacticalRetreatHealth,
} from '../src/agent/runtime/combat-decision.js';

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

test('an unarmed bot fully disengages from a projectile threat', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: { melee: false, shield: false, bow: false, arrows: false },
    hostiles: [{ id: 10, name: 'skeleton', distance: 12, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'unsafe_projectile_engagement');
  assert.equal(decision.selected.desiredRange, 24);
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

test('even an armed bot retreats from a creeper already inside fuse range', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: ready,
    hostiles: [{ id: 11, name: 'creeper', distance: 3, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'immediate_explosive_threat');
  assert.equal(decision.selected.desiredRange, 24);
});

test('critical health overrides equipment and selects retreat', () => {
  const decision = chooseTacticalCombatDecision({
    health: 7,
    equipment: ready,
    hostiles: [{ id: 5, name: 'zombie', distance: 2, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'critical_health');
  assert.equal(decision.selected.desiredRange, 24);
});

test('a self-preservation objective forces disengagement while useful health remains', () => {
  const decision = chooseTacticalCombatDecision({
    health: 13,
    objective: 'disengage',
    equipment: ready,
    hostiles: [{ id: 50, name: 'zombie', distance: 2, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'self_preservation_disengage');
  assert.equal(decision.selected.desiredRange, 24);
  assert.equal(decision.selected.fallbackResponse, 'melee');
});

test('retreat reconciliation rejects spacing success that worsens critical health', () => {
  assert.deepEqual(reconcileTacticalRetreatHealth(14, 1), {
    verified: false,
    outcome: 'retreat_health_deteriorated',
    healthBefore: 14,
    healthAfter: 1,
  });
  assert.equal(reconcileTacticalRetreatHealth(10, 9).verified, true);
  assert.equal(reconcileTacticalRetreatHealth(7, 6).verified, false);
  assert.equal(reconcileTacticalRetreatHealth(7, 7).verified, true);
});

test('a blocked retreat may fall back only against an immediate ordinary melee threat', () => {
  const unarmed = { melee: false, shield: false, bow: false, arrows: false };
  const closeZombie = chooseTacticalCombatDecision({
    health: 9,
    equipment: unarmed,
    hostiles: [{ id: 30, name: 'zombie', distance: 0.7, disposition: 'combat_safe' }],
  });
  assert.equal(closeZombie.response, 'retreat');
  assert.equal(closeZombie.selected.fallbackResponse, 'melee');
  assert.equal(closeZombie.selected.fallbackReason, 'retreat_blocked_immediate_melee');

  const distantZombie = chooseTacticalCombatDecision({
    health: 9,
    equipment: unarmed,
    hostiles: [{ id: 31, name: 'zombie', distance: 4, disposition: 'combat_safe' }],
  });
  assert.equal(distantZombie.selected.fallbackResponse, undefined);

  const closeCreeper = chooseTacticalCombatDecision({
    health: 7,
    equipment: ready,
    hostiles: [{ id: 32, name: 'creeper', distance: 2, disposition: 'combat_safe' }],
  });
  assert.equal(closeCreeper.selected.fallbackResponse, undefined);
});

test('a creeper without a ranged option clears the full pursuit envelope', () => {
  const decision = chooseTacticalCombatDecision({
    health: 20,
    equipment: { melee: true, shield: true, bow: false, arrows: false },
    hostiles: [{ id: 7, name: 'creeper', distance: 7, disposition: 'combat_safe' }],
  });

  assert.equal(decision.response, 'retreat');
  assert.equal(decision.reason, 'explosive_without_ranged_option');
  assert.equal(decision.selected.desiredRange, 24);
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

test('scoped defense ends with its target and never sends melee after an airborne threat', () => {
  const equipment = { melee: true, shield: true, bow: false, arrows: false };
  const hostiles = [
    { id: 20, name: 'husk', distance: 3, localGeometry: { onGround: true } },
    { id: 21, name: 'phantom', distance: 7, localGeometry: { onGround: false } },
    { id: 22, name: 'creeper', distance: 4, localGeometry: { onGround: true } },
  ];

  const attributed = chooseTacticalCombatDecision({
    health: 20,
    equipment,
    targetEntityId: 20,
    hostiles,
  });
  assert.equal(attributed.selected.id, 20);
  assert.equal(attributed.response, 'melee');
  assert.equal(attributed.considered, 1);

  const settled = chooseTacticalCombatDecision({
    health: 20,
    equipment,
    targetEntityId: 20,
    hostiles: hostiles.slice(1),
  });
  assert.equal(settled.selected, null);
  assert.equal(settled.reason, 'no_loaded_hostiles');

  const airborne = chooseTacticalCombatDecision({
    health: 20,
    equipment,
    targetEntityId: 21,
    hostiles,
  });
  assert.equal(airborne.selected.id, 21);
  assert.equal(airborne.response, 'retreat');
  assert.equal(airborne.reason, 'airborne_without_ranged_option');
});
