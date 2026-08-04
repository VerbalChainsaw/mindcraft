import assert from 'node:assert/strict';
import test from 'node:test';

import { GoalDirector } from '../../src/agent/runtime/goal-director.js';
import { createItemGoalContract, normalizeGoalContract } from '../../src/agent/runtime/goal-contract.js';

function subgoal(kind, index, state = 'succeeded') {
  return {
    id: `boundary-${index}`,
    kind,
    state,
    commandName: kind === 'recover' ? '!moveAway' : '!collectBlocksInRange',
    attempt: index,
  };
}

function createDirector() {
  const store = { load: () => ({ activeGoal: null, lastGoal: null }), save() {} };
  const procedures = { find: () => null, record: () => null };
  const agent = {
    name: 'BudgetBot',
    bot: { inventory: { slots: [] } },
    blocked_actions: [],
    publishBehaviorEvent() {},
    openChat() {},
  };
  return new GoalDirector(agent, { store, procedures });
}

function boundaryGoal(subgoals) {
  const base = createItemGoalContract({
    kind: 'acquire',
    requester: 'Director',
    target: {
      requestedName: 'stone_pickaxe',
      canonicalName: 'stone_pickaxe',
      inventoryName: 'stone_pickaxe',
      acquisitionName: 'stone_pickaxe',
      family: null,
      acquisitionKind: 'prepare_tool',
    },
    quantity: 1,
  });
  return normalizeGoalContract({ ...base, maxSubgoals: 4, subgoals });
}

test('recovery history does not spend the productive-step ceiling, which still fails closed', () => {
  const director = createDirector();
  director.activeGoal = boundaryGoal([
    subgoal('recover', 1),
    subgoal('recover', 2),
    subgoal('recover', 3),
    subgoal('plan', 4, 'acting'),
  ]);

  director.handleResult('plan', {
    actionId: 'failed-plan',
    phase: 'failed',
    code: 'skill_unreachable',
    detail: 'No safe stance at this target.',
    retryable: true,
  });
  assert.equal(director.activeGoal.phase, 'recover');

  director.appendActingSubgoal('recover', '!moveAway(4)');
  assert.equal(director.activeGoal.subgoals.length, 4);
  assert.equal(director.activeGoal.subgoals.at(-1).kind, 'recover');

  director.activeGoal = boundaryGoal([
    subgoal('plan', 1),
    subgoal('plan', 2),
    subgoal('plan', 3),
    subgoal('plan', 4),
  ]);
  assert.equal(director.dispatch('recover', '!moveAway(4)'), false);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.lastGoal.evidence.code, 'subgoal_budget_exhausted');

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([subgoal('recover', 1, 'acting')]),
    attempts: 2,
  });
  director.handleResult('recover', {
    actionId: 'successful-relocation',
    phase: 'succeeded',
    code: 'skill_retreated',
    detail: 'Moved to a fresh search area.',
    retryable: false,
  });
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 2);

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([subgoal('recover', 1, 'acting')]),
    attempts: 2,
  });
  director.handleResult('recover', {
    actionId: 'failed-relocation',
    phase: 'failed',
    code: 'skill_path_stalled',
    detail: 'The bounded relocation made no physical progress.',
    retryable: true,
  });
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.status.code, 'relocation_failed_replan');

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([{
      ...subgoal('plan', 1, 'acting'),
      targetName: 'raw_iron',
      expectedIncrease: 3,
      targetInventoryBefore: 0,
    }]),
    attempts: 2,
  });
  director.agent.bot.inventory.slots = [{ name: 'raw_iron', count: 1 }];
  director.handleResult('plan', {
    actionId: 'partial-ore-progress',
    phase: 'failed',
    code: 'skill_path_timeout',
    detail: 'Collected one ore before the remaining route timed out.',
    retryable: true,
    target: { name: 'iron_ore', x: 4, y: 12, z: 8 },
  });
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.deepEqual(director.activeGoal.memory.failedTargets, []);

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([subgoal('plan', 1, 'acting')]),
    memory: {
      failedTargets: [{
        kind: 'collect',
        name: 'iron_ore',
        position: { x: 4, y: 12, z: 8 },
        code: 'skill_unreachable',
        failures: 1,
        firstFailedAt: Date.now(),
        lastFailedAt: Date.now(),
        avoidUntil: Date.now() + 90_000,
      }],
    },
  });
  assert.deepEqual(director.collectionExclusions(), [
    { x: 4, y: 12, z: 8, radius: 4 },
  ]);
});
