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
});
