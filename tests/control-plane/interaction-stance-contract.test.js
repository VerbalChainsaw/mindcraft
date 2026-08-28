import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
  INTERACTION_STANCE_FAILURE_STAGES,
  interactionStanceConfirmed,
  interactionStanceFailure,
  interactionStancePostconditionFailed,
  interactionStanceReady,
  interactionStanceRejected,
  normalizeInteractionStanceReceipt,
} from '../../src/agent/runtime/interaction-stance.js';
import { actionResultToTelemetry } from '../../src/agent/runtime/action-result.js';
import {
  isStorageContainerInteractionFeasible,
  reachInteractionStance,
} from '../../src/agent/library/skills.js';

const target = Object.freeze({ name: 'crafting_table', x: 4, y: 64, z: 0 });
const stance = Object.freeze({ x: 3, y: 64, z: 0 });

test('interaction stance receipts are immutable and preserve the four exact failure stages', () => {
  for (const failureStage of Object.values(INTERACTION_STANCE_FAILURE_STAGES)) {
    const receipt = interactionStanceFailure(failureStage, {
      kind: 'workstation',
      target,
      candidateCount: 2,
      selectedStance: stance,
      pathStatus: 'noPath',
      pathLength: 3,
      code: failureStage,
    });
    assert.equal(receipt.failureStage, failureStage);
    assert.equal(receipt.status, 'failed');
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(Object.isFrozen(receipt.path), true);
    assert.equal(Object.isFrozen(receipt.interaction), true);
  }
});

test('ready, rejected, and confirmed receipts do not blur Pathfinder and interaction ownership', () => {
  const ready = interactionStanceReady({
    kind: 'workstation',
    target,
    candidateCount: 2,
    selectedStance: stance,
    pathStatus: 'success',
    pathLength: 4,
    code: 'stance_reached',
  });
  const rejected = interactionStanceRejected(ready, 'server_rejected');
  const confirmed = interactionStanceConfirmed(ready, { code: 'craft_confirmed' });

  assert.equal(ready.failureStage, null);
  assert.equal(rejected.failureStage, 'interaction_rejected');
  assert.equal(rejected.interaction.attempted, true);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.interaction.confirmed, true);
  assert.equal(confirmed.stages.selection.status, 'confirmed');
  assert.equal(confirmed.stages.feasibility.status, 'confirmed');
  assert.equal(confirmed.stages.planning.status, 'confirmed');
  assert.equal(confirmed.stages.execution.status, 'confirmed');
  assert.equal(confirmed.stages.acknowledgement.status, 'confirmed');
  assert.equal(confirmed.stages.functionalPostcondition.status, 'not_evaluated');
});

test('functional access keeps mechanic acknowledgement distinct from the player-valued postcondition', () => {
  const ready = interactionStanceReady({
    kind: 'workstation',
    target,
    candidateCount: 2,
    selectedStance: stance,
    pathStatus: 'success',
    pathLength: 4,
    code: 'stance_reached',
  });
  const confirmed = interactionStanceConfirmed(ready, {
    code: 'craft_confirmed',
    functionalPostcondition: {
      status: 'confirmed',
      code: 'crafted_output_confirmed',
      target: { name: 'iron_axe' },
      expectedCount: 1,
      observedCount: 1,
    },
  });
  const missingOutput = interactionStancePostconditionFailed(ready, {
    code: 'not_crafted',
    functionalPostcondition: {
      status: 'failed',
      code: 'not_crafted',
      target: { name: 'iron_axe' },
      expectedCount: 1,
      observedCount: 0,
    },
  });

  assert.equal(confirmed.stages.acknowledgement.status, 'confirmed');
  assert.equal(confirmed.stages.functionalPostcondition.status, 'confirmed');
  assert.equal(confirmed.functionalPostcondition.observedCount, 1);
  assert.equal(missingOutput.failureStage, null);
  assert.equal(missingOutput.stages.acknowledgement.status, 'confirmed');
  assert.equal(missingOutput.stages.functionalPostcondition.status, 'failed');
  assert.equal(Object.isFrozen(confirmed.stages), true);
  assert.equal(Object.isFrozen(confirmed.functionalPostcondition), true);
});

test('legacy stance receipts remain readable with an unevaluated functional postcondition', () => {
  const legacy = normalizeInteractionStanceReceipt({
    schemaVersion: 1,
    kind: 'container',
    target: { name: 'chest', x: 8, y: 64, z: 2 },
    status: 'failed',
    failureStage: 'path_not_found',
    code: 'noPath',
    candidateCount: 3,
    selectedStance: null,
    path: { status: 'noPath', length: 0 },
    interaction: { attempted: false, confirmed: false },
  });

  assert.equal(legacy.schemaVersion, 2);
  assert.equal(legacy.failureStage, 'path_not_found');
  assert.equal(legacy.stages.planning.status, 'failed');
  assert.equal(legacy.stages.functionalPostcondition.status, 'not_evaluated');
});

test('shared stance execution attributes legality, planning, and physical execution separately', async () => {
  const bot = {
    interrupt_code: false,
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: () => null,
  };
  const goal = { isEnd: position => position.x === stance.x && position.y === stance.y && position.z === stance.z };

  const noLegal = await reachInteractionStance(bot, {
    kind: 'workstation',
    target,
    goal,
    candidates: [],
  });
  assert.equal(noLegal.failureStage, 'no_legal_stance');

  let rejectedRouteExecuted = false;
  const noPlan = await reachInteractionStance(bot, {
    kind: 'workstation',
    target,
    goal,
    candidates: [stance],
    probeStances: () => ({ reachable: false, conclusive: true, status: 'noPath', pathLength: 0 }),
    navigateGoal: () => {
      rejectedRouteExecuted = true;
      return true;
    },
  });
  assert.equal(noPlan.failureStage, 'path_not_found');
  assert.equal(rejectedRouteExecuted, false);

  let executedGoal = null;
  const inconclusive = await reachInteractionStance(bot, {
    kind: 'workstation',
    target,
    goal,
    candidates: [stance],
    probeStances: () => ({ reachable: false, conclusive: false, status: 'timeout', pathLength: 1 }),
    navigateGoal: (candidateBot, candidateGoal) => {
      assert.equal(candidateBot, bot);
      executedGoal = candidateGoal;
      bot.entity.position = new Vec3(stance.x, stance.y, stance.z);
      return true;
    },
  });
  assert.equal(executedGoal, goal);
  assert.equal(inconclusive.status, 'ready');
  assert.equal(inconclusive.failureStage, null);
  assert.equal(inconclusive.path.status, 'timeout');
  bot.entity.position = new Vec3(0, 64, 0);

  bot.preflightPolicy = { interactionStance: 'strict' };
  let strictRouteExecuted = false;
  const strictInconclusive = await reachInteractionStance(bot, {
    kind: 'workstation',
    target,
    goal,
    candidates: [stance],
    probeStances: () => ({ reachable: false, conclusive: false, status: 'timeout', pathLength: 1 }),
    navigateGoal: () => {
      strictRouteExecuted = true;
      return true;
    },
  });
  assert.equal(strictRouteExecuted, false);
  assert.equal(strictInconclusive.status, 'failed');
  assert.equal(strictInconclusive.failureStage, null);
  assert.equal(strictInconclusive.code, 'route_unproven');
  assert.equal(strictInconclusive.stages.planning.status, 'unknown');
  assert.equal(strictInconclusive.stages.execution.status, 'unknown');
  delete bot.preflightPolicy;

  const stalled = await reachInteractionStance(bot, {
    kind: 'workstation',
    target,
    goal,
    candidates: [stance],
    probeStances: () => ({ reachable: true, status: 'success', pathLength: 4, terminalPosition: stance }),
    navigateGoal: () => false,
  });
  assert.equal(stalled.failureStage, 'path_execution_failed');

  const settledPlacement = await reachInteractionStance(bot, {
    kind: 'placement',
    target: { name: 'spruce_planks', x: 4, y: 67, z: 0 },
    goal,
    candidates: [stance],
    probeStances: () => ({ reachable: true, status: 'success', pathLength: 2, terminalPosition: stance }),
    navigateGoal: () => {
      bot.entity.position = new Vec3(stance.x, stance.y, stance.z);
      bot.lastActionEvidence = { outcome: 'path_stopped' };
      return false;
    },
    acceptSelectedStanceSettlement: true,
    settleStandingCell: async () => new Vec3(stance.x, stance.y, stance.z),
  });
  assert.equal(settledPlacement.status, 'ready');
  assert.equal(settledPlacement.code, 'selected_stance_settled_after_stop');
  assert.deepEqual(settledPlacement.selectedStance, stance);

  bot.entity.position = new Vec3(0, 64, 0);
  const alternateStance = Object.freeze({ x: 3, y: 64, z: 1 });
  const settledAlternatePlacement = await reachInteractionStance(bot, {
    kind: 'placement',
    target: { name: 'spruce_planks', x: 4, y: 67, z: 0 },
    goal,
    candidates: [stance, alternateStance],
    probeStances: () => ({ reachable: true, status: 'success', pathLength: 2, terminalPosition: stance }),
    navigateGoal: () => false,
    acceptSelectedStanceSettlement: true,
    settleStandingCell: async () => new Vec3(alternateStance.x, alternateStance.y, alternateStance.z),
  });
  assert.equal(settledAlternatePlacement.status, 'ready');
  assert.equal(settledAlternatePlacement.code, 'legal_stance_settled_after_stop');
  assert.deepEqual(settledAlternatePlacement.selectedStance, alternateStance);

  const reached = await reachInteractionStance(bot, {
    kind: 'workstation',
    target,
    goal,
    candidates: [stance],
    probeStances: () => ({ reachable: true, status: 'success', pathLength: 4, terminalPosition: stance }),
    navigateGoal: () => {
      bot.entity.position = new Vec3(stance.x, stance.y, stance.z);
      return true;
    },
  });
  assert.equal(reached.status, 'ready');
  assert.equal(reached.failureStage, null);
});

test('action telemetry promotes the normalized stance receipt without exposing arbitrary skill evidence', () => {
  const receipt = interactionStanceFailure('path_not_found', {
    kind: 'bed',
    target: { name: 'white_bed', x: 8, y: 64, z: 2 },
    candidateCount: 3,
    pathStatus: 'noPath',
    code: 'noPath',
  });
  const telemetry = actionResultToTelemetry({
    phase: 'failed',
    code: 'unreachable',
    evidence: { skill: { interactionStance: receipt, noisy: 'not promoted' } },
  });

  assert.equal(telemetry.interactionStance.failureStage, 'path_not_found');
  assert.equal(telemetry.interactionStance.candidateCount, 3);
  assert.equal('noisy' in telemetry, false);
});

test('container feasibility rejects a chest with blocked lid space but permits an open chest and a barrel', () => {
  const position = new Vec3(4, 64, 0);
  const chest = { name: 'chest', position };
  const barrel = { name: 'barrel', position };
  const bot = {
    blockAt: point => (
      point.equals(position.offset(0, 1, 0))
        ? { name: 'cobblestone', boundingBox: 'block' }
        : null
    ),
  };

  assert.equal(isStorageContainerInteractionFeasible(bot, chest), false);
  assert.equal(isStorageContainerInteractionFeasible(bot, barrel), true);

  bot.blockAt = point => (
    point.equals(position.offset(0, 1, 0))
      ? { name: 'air', boundingBox: 'empty' }
      : null
  );
  assert.equal(isStorageContainerInteractionFeasible(bot, chest), true);
});
