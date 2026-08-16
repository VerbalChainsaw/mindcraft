import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyObligationSettlement,
  createMaterialChangeBlocker,
  evaluateMaterialChange,
  receiptShowsMaterialProgress,
} from '../../src/agent/runtime/obligation-settlement.js';

test('obligation settlement requires every retry authority fact explicitly true', () => {
  const base = {
    sampleClass: 'method_failure',
    methodRetryable: true,
    retryAuthority: true,
    materialChanged: true,
    budgetAvailable: true,
  };
  assert.equal(classifyObligationSettlement(base).state, 'retry_authorized');

  for (const field of ['methodRetryable', 'retryAuthority', 'budgetAvailable']) {
    assert.equal(
      classifyObligationSettlement({ ...base, [field]: undefined }).state,
      'waiting',
      `${field} absence must fail closed`,
    );
  }
  assert.equal(
    classifyObligationSettlement({ ...base, materialChanged: undefined }).state,
    'waiting_for_material_change',
  );
});

test('censored work preserves the obligation without charging an attempt', () => {
  assert.deepEqual(
    classifyObligationSettlement({ sampleClass: 'censored' }),
    {
      schemaVersion: 1,
      state: 'censored',
      chargeAttempt: false,
      preserveObligation: true,
      redispatch: false,
      facts: {
        sampleClass: 'censored',
        methodRetryable: null,
        retryAuthority: null,
        materialChanged: null,
        budgetAvailable: null,
      },
    },
  );
});

test('time is not a material change and missing evidence retains a blocker', () => {
  const blocker = createMaterialChangeBlocker({
    owner: 'survival',
    obligationId: 'sleep:bed-a',
    code: 'skill_bed_occupied',
    checkpoint: {
      position: { x: 1, y: 64, z: 1 },
      dimension: 'overworld',
      targetSignature: 'bed-a:occupied',
      cycleSignature: 'night',
    },
    releasePredicates: ['dimension', 'target_signature', 'cycle_signature'],
  });

  assert.equal(evaluateMaterialChange(blocker, {
    position: { x: 1, y: 64, z: 1 },
    dimension: 'overworld',
    targetSignature: 'bed-a:occupied',
    cycleSignature: 'night',
    observedAt: Date.now() + 60_000,
  }).state, 'unchanged');
  assert.equal(evaluateMaterialChange(blocker, {
    position: { x: 1, y: 64, z: 1 },
    dimension: 'overworld',
    cycleSignature: 'night',
  }).state, 'unknown');
  assert.equal(evaluateMaterialChange(blocker, {
    position: { x: 1, y: 64, z: 1 },
    dimension: 'overworld',
    targetSignature: 'bed-a:available',
    cycleSignature: 'night',
  }).state, 'changed');
});

test('position-region release is bounded and requires a real displacement', () => {
  const blocker = createMaterialChangeBlocker({
    owner: 'agenda',
    obligationId: 'goto:dad',
    code: 'segmented_journey_no_progress',
    checkpoint: { position: { x: 0, y: 64, z: 0 } },
    releasePredicates: ['position_region'],
    positionRegionDistance: 8,
  });
  assert.equal(evaluateMaterialChange(blocker, { position: { x: 7.9, y: 64, z: 0 } }).state, 'unchanged');
  assert.equal(evaluateMaterialChange(blocker, { position: { x: 8, y: 64, z: 0 } }).state, 'changed');
  assert.equal(evaluateMaterialChange(blocker, {}).state, 'unknown');
});

test('composed child navigation progress is material while a composed no-progress receipt is not', () => {
  assert.equal(receiptShowsMaterialProgress({
    receiptSchemaVersion: 1,
    source: 'action_context',
    children: {
      navigation: [{ outcome: 'progress_verified', progressed: 12 }],
    },
  }), true);
  assert.equal(receiptShowsMaterialProgress({
    receiptSchemaVersion: 1,
    source: 'action_context',
    children: {
      navigation: [{ outcome: 'route_unproven', progressed: 0 }],
    },
  }), false);
  assert.equal(receiptShowsMaterialProgress({ outcome: 'legacy_failed' }), null);
});

// Regression for the 2026-08-16 live failure. Kevin's flight recorder recorded
// eight consecutive `action:followPlayer` results of
// `skill_waiting_for_material_change` after Pathfinder returned noPath: he
// announced he was following the player and then stood still, because the
// blocker released only on dimension / 8-block movement / target / world
// signature change. An explicit directive must retry on its own.
test('a bounded material-change blocker releases on time even when the world is identical', () => {
  const checkpoint = {
    position: { x: 0, y: 64, z: 0 },
    dimension: 'overworld',
    targetSignature: 'player:phixxation',
    worldSignature: 'solid:grass_block',
  };
  const blocker = createMaterialChangeBlocker({
    owner: 'player_directive',
    obligationId: 'follow:phixxation',
    code: 'directive_route_unchanged',
    checkpoint,
    releasePredicates: ['dimension', 'position_region', 'target_signature', 'world_signature'],
    positionRegionDistance: 8,
    holdMs: 6_000,
    createdAt: 1_000,
  });
  assert.equal(blocker.holdMs, 6_000);
  assert.equal(blocker.createdAt, 1_000);

  // Same world, still inside the hold: the companion waits rather than spinning.
  const parked = evaluateMaterialChange(blocker, checkpoint, { now: 4_000 });
  assert.equal(parked.state, 'unchanged');
  assert.equal(parked.holdExpired, false);
  assert.deepEqual([...parked.changedBy], []);

  // Same world, hold elapsed: it releases and the directive is retried.
  const released = evaluateMaterialChange(blocker, checkpoint, { now: 7_001 });
  assert.equal(released.state, 'changed');
  assert.equal(released.holdExpired, true);
  // The world genuinely did not change, so no world predicate may claim it did.
  assert.deepEqual([...released.changedBy], []);
});

test('an unbounded blocker keeps its original world-only release semantics', () => {
  const checkpoint = { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld' };
  const blocker = createMaterialChangeBlocker({
    owner: 'player_goal',
    obligationId: 'deliver:cobblestone',
    code: 'method_failure',
    checkpoint,
    releasePredicates: ['dimension', 'position_region'],
  });
  assert.equal(blocker.holdMs, 0);
  const later = evaluateMaterialChange(blocker, checkpoint, { now: 9_999_999 });
  assert.equal(later.state, 'unchanged');
  assert.equal(later.holdExpired, false);
});

test('a bounded blocker survives persistence round-trips', async () => {
  const { normalizeMaterialChangeBlocker } = await import(
    '../../src/agent/runtime/obligation-settlement.js'
  );
  const blocker = createMaterialChangeBlocker({
    owner: 'player_directive',
    obligationId: 'follow:phixxation',
    code: 'directive_route_unchanged',
    checkpoint: { position: { x: 1, y: 2, z: 3 }, dimension: 'overworld' },
    releasePredicates: ['dimension'],
    holdMs: 6_000,
    createdAt: 42,
  });
  const restored = normalizeMaterialChangeBlocker(JSON.parse(JSON.stringify(blocker)));
  assert.equal(restored.holdMs, 6_000);
  assert.equal(restored.createdAt, 42);
});
