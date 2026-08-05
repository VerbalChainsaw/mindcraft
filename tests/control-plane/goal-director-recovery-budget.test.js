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
    isIdle: () => true,
    isOperatorHeld: () => false,
    self_prompter: { isStopped: () => true },
    job_director: { activeOrder: null },
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
    ...boundaryGoal([subgoal('recover', 1, 'acting')]),
    attempts: 4,
  });
  director.handleResult('recover', {
    actionId: 'failed-final-relocation',
    phase: 'failed',
    code: 'skill_path_stalled',
    detail: 'Recovery failed after the productive ceiling was already exhausted.',
    retryable: true,
  });
  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.lastGoal.attempts, 4);

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    attempts: 4,
    phase: 'acquire',
  });
  director.update();
  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.evidence.code, 'goal_attempts_exhausted');

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
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
  assert.equal(director.activeGoal.evidence.code, 'verified_partial_progress');
  assert.deepEqual(director.activeGoal.memory.failedTargets, []);

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([{
      ...subgoal('plan', 1, 'acting'),
      targetName: 'raw_iron',
      expectedIncrease: 1,
      targetInventoryBefore: 1,
    }]),
    attempts: 2,
  });
  director.handleResult('plan', {
    actionId: 'verified-corridor-prefix',
    phase: 'failed',
    code: 'skill_search_advanced',
    detail: 'Reached a stable intermediate mining cell under the action deadline.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'search_advanced',
        target: { name: 'iron_ore', x: 4, y: 12, z: 8 },
        observedPosition: { x: 2, y: 24, z: 6 },
        distance: 9,
        routeSteps: 7,
        routeDigging: true,
        returnable: true,
      },
    },
  });
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
  assert.equal(director.activeGoal.evidence.phase, 'succeeded');
  assert.deepEqual(director.activeGoal.memory.failedTargets, []);

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([{
      ...subgoal('plan', 1, 'acting'),
      targetName: 'raw_iron',
      expectedIncrease: 1,
      targetInventoryBefore: 1,
    }]),
  });
  director.handleResult('plan', {
    actionId: 'nested-concrete-target',
    phase: 'failed',
    code: 'skill_unreachable',
    detail: 'The exact ore target had no safe route.',
    retryable: true,
    target: { name: 'raw_iron' },
    evidence: {
      skill: {
        kind: 'collect',
        outcome: 'unreachable',
        target: { name: 'iron_ore', x: 4, y: 12, z: 8 },
      },
    },
  });
  assert.deepEqual(director.activeGoal.memory.failedTargets.map(entry => ({
    kind: entry.kind,
    name: entry.name,
    position: entry.position,
  })), [{
    kind: 'collect',
    name: 'iron_ore',
    position: { x: 4, y: 12, z: 8 },
  }]);

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

test('one no-progress concrete failure relocates before the same regional signature can spend another attempt', async () => {
  const director = createDirector();
  const now = Date.now();
  const commands = [];
  director.executeGoalCommand = async (agent, command) => {
    commands.push(command);
    agent.last_action_result = {
      actionId: 'verified-region-relocation',
      phase: 'succeeded',
      code: 'skill_retreated',
      detail: 'Moved 32 blocks to a different search region.',
      retryable: false,
    };
    return true;
  };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'recover',
    attempts: 2,
    evidence: {
      actionId: 'first-local-failure',
      phase: 'failed',
      code: 'skill_unreachable',
      detail: 'The concrete target in this region had no safe stance.',
      verified: false,
      at: now,
    },
    subgoals: [
      {
        ...subgoal('plan', 1, 'failed'),
        targetName: 'raw_iron',
        startedAt: now - 200,
        finishedAt: now - 150,
      },
    ],
    memory: {
      failedTargets: [
        {
          kind: 'collect',
          name: 'iron_ore',
          position: { x: 4, y: 12, z: 8 },
          code: 'skill_unreachable',
          failures: 1,
          firstFailedAt: now - 145,
          lastFailedAt: now - 145,
          avoidUntil: now + 90_000,
        },
      ],
    },
  });

  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(commands, ['!moveAway(32)']);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).kind, 'recover');
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
});
