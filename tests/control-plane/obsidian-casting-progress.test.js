import assert from 'node:assert/strict';
import test from 'node:test';

import {
  castingBindingsAfterNoFaceFailure,
  castingWaterRecoveryStandingCell,
  settledCastingAccessProgress,
} from '../../src/agent/library/skills.js';

test('settled casting access preserves excavated geometry after an exact-origin retreat', () => {
  const progress = settledCastingAccessProgress({
    success: false,
    outcome: 'route_block_not_broken',
    excavated: 53,
    retreat: {
      success: true,
      retreatedSteps: 33,
      observed: { x: 686.5, y: -51, z: -783.54 },
    },
  });

  assert.deepEqual(progress, {
    advanced: true,
    outcome: 'casting_access_advanced',
    routeSteps: 33,
    excavated: 53,
    returnable: true,
    returnRoute: [],
    observedPosition: { x: 686.5, y: -51, z: -783.54 },
  });
});

test('casting access never claims progress without excavation and safe settlement', () => {
  assert.equal(settledCastingAccessProgress({
    excavated: 0,
    retreat: { success: true, observed: { x: 1, y: 2, z: 3 } },
  }), null);
  assert.equal(settledCastingAccessProgress({
    excavated: 4,
    retreat: { success: false, observed: { x: 1, y: 2, z: 3 } },
  }), null);
});

test('casting drops only the failed stance after a settled no-face rejection', () => {
  const failed = { x: 4, y: -51, z: 8 };
  const alternate = { x: 5, y: -51, z: 8 };
  const remaining = castingBindingsAfterNoFaceFailure(
    [{ stance: failed }, { stance: alternate }],
    { stance: failed },
    {
      failureOutcome: 'route_block_not_broken',
      excavated: 0,
      supportsPlaced: 0,
      retreat: { success: true },
      breakEvidence: { kind: 'break', outcome: 'unreachable' },
    },
  );
  assert.deepEqual(remaining, [{ stance: alternate }]);
});

test('casting does not switch routes after a material effect or unsafe return', () => {
  const bindings = [
    { stance: { x: 4, y: -51, z: 8 } },
    { stance: { x: 5, y: -51, z: 8 } },
  ];
  const plan = { stance: bindings[0].stance };
  const failure = {
    failureOutcome: 'route_block_not_broken',
    excavated: 1,
    supportsPlaced: 0,
    retreat: { success: true },
    breakEvidence: { kind: 'break', outcome: 'unreachable' },
  };
  assert.equal(castingBindingsAfterNoFaceFailure(bindings, plan, failure), null);
  assert.equal(castingBindingsAfterNoFaceFailure(bindings, plan, {
    ...failure,
    excavated: 0,
    retreat: { success: false },
  }), null);
});

test('casting recovers water from the supported cell the body actually occupies', () => {
  const observed = { x: 727, y: -18, z: -773 };
  const bot = { entity: { position: { distanceTo: () => 3.25 } } };
  assert.equal(castingWaterRecoveryStandingCell(bot, {}, observed), observed);
  bot.entity.position.distanceTo = () => 4.51;
  assert.equal(castingWaterRecoveryStandingCell(bot, {}, observed), null);
});
