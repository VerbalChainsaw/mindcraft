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

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    holdPosition(reason) { this.operator_hold_reason = reason; },
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
  assert.equal(director.agent.operator_hold_reason, 'Player goal failed; awaiting explicit player direction.');

  director.activeGoal = boundaryGoal([subgoal('plan', 1, 'acting')]);
  assert.equal(director.cancel('Operator Stop.'), true);
  assert.equal(director.lastGoal.phase, 'cancelled');
  assert.equal(director.lastGoal.subgoals.at(-1).state, 'cancelled');
  assert.equal(director.lastGoal.subgoals.at(-1).code, 'goal_cancelled');
  assert.equal(Number.isFinite(director.lastGoal.subgoals.at(-1).finishedAt), true);

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
    memory: {
      failedTargets: [],
      toolRequirement: {
        name: 'wooden_pickaxe',
        minimumUsableDurability: 17,
        observedAt: Date.now(),
      },
    },
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
        // Occupying the next block center from an off-center start can be
        // less than one floating-point block despite a verified route step.
        distance: 0.75,
        routeSteps: 7,
        routeDigging: true,
        returnable: true,
        boundary: { remainingRouteLowerBound: 19 },
      },
    },
  });
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
  assert.equal(director.activeGoal.evidence.phase, 'succeeded');
  assert.deepEqual(director.activeGoal.memory.failedTargets, []);
  assert.deepEqual(director.activeGoal.memory.activeCollectionTarget, {
    name: 'iron_ore',
    position: { x: 4, y: 12, z: 8 },
    remainingRouteLowerBound: 19,
    observedAt: director.activeGoal.memory.activeCollectionTarget.observedAt,
  });
  assert.equal(director.activeGoal.memory.toolRequirement, null);
  assert.deepEqual(director.collectionPreferredTarget('deepslate_iron_ore'), {
    x: 4,
    y: 12,
    z: 8,
  });

  const redstoneTarget = {
    name: 'redstone_ore',
    position: { x: 40, y: -22, z: 18 },
  };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([{
      ...subgoal('plan', 1, 'acting'),
      targetName: 'raw_iron',
      expectedIncrease: 2,
      targetInventoryBefore: 1,
    }]),
    memory: {
      failedTargets: [],
      toolRequirement: {
        name: 'iron_pickaxe',
        minimumUsableDurability: 37,
        observedAt: Date.now(),
        target: redstoneTarget,
      },
      activeCollectionTarget: {
        ...redstoneTarget,
        remainingRouteLowerBound: 24,
        observedAt: Date.now(),
      },
    },
  });
  director.handleResult('plan', {
    actionId: 'nested-iron-corridor-prefix',
    phase: 'failed',
    code: 'skill_search_advanced',
    detail: 'Advanced toward prerequisite iron while replacing the redstone tool.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'search_advanced',
        target: { name: 'iron_ore', x: 7, y: 8, z: 9 },
        distance: 1,
        routeSteps: 5,
        routeDigging: true,
        returnable: true,
        boundary: { remainingRouteLowerBound: 6 },
      },
    },
  });
  assert.equal(director.activeGoal.memory.toolRequirement.name, 'iron_pickaxe');
  assert.deepEqual(director.activeGoal.memory.toolRequirement.target, redstoneTarget);
  assert.deepEqual(director.activeGoal.memory.activeCollectionTarget.position, redstoneTarget.position);
  assert.deepEqual(director.collectionPreferredTarget('redstone_ore'), redstoneTarget.position);

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([{
      ...subgoal('plan', 1, 'acting'),
      targetName: 'redstone',
      expectedIncrease: 1,
      targetInventoryBefore: 0,
    }]),
    memory: director.activeGoal.memory,
  });
  director.handleResult('plan', {
    actionId: 'causal-redstone-corridor-prefix',
    phase: 'failed',
    code: 'skill_search_advanced',
    detail: 'The replacement tool admitted the retained redstone corridor.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'search_advanced',
        target: { name: 'deepslate_redstone_ore', x: 40, y: -22, z: 18 },
        observedPosition: { x: 35, y: -12, z: 18 },
        distance: 1,
        routeSteps: 5,
        routeDigging: true,
        returnable: true,
        boundary: { remainingRouteLowerBound: 19 },
      },
    },
  });
  assert.equal(director.activeGoal.memory.toolRequirement, null);
  assert.equal(director.activeGoal.memory.activeCollectionTarget.remainingRouteLowerBound, 19);

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

test('delivery preserves attempts, resolves an unloaded player, and returns through owned navigation', async () => {
  const director = createDirector();
  director.agent.bot.players = {};
  director.agent.bot.entities = {};
  director.agent.bot.entity = { position: { x: 0, y: 64, z: 0 } };
  director.agent.bot.game = { dimension: 'overworld' };
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'phixxation',
    destinationPlayer: 'phixxation',
    target: {
      requestedName: 'iron_axe',
      canonicalName: 'iron_axe',
      inventoryName: 'iron_axe',
      acquisitionName: 'iron_axe',
      family: null,
      acquisitionKind: 'prepare_tool',
    },
    quantity: 1,
    completion: 'delivery',
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'deliver', attempts: 2 });

  for (let check = 0; check < goal.maxAttempts + 2; check += 1) {
    assert.equal(director.waitForPlayer(director.activeGoal), false);
    assert.equal(director.activeGoal.phase, 'deliver');
    assert.equal(director.activeGoal.attempts, 2);
    assert.equal(director.activeGoal.evidence.code, 'delivery_player_absent');
    assert.equal(director.lastGoal, null);
  }

  const commands = [];
  director.agent.locatePlayerPosition = async () => ({
    success: true,
    found: true,
    player: 'phixxation',
    position: { x: 100, y: 70, z: 100 },
    dimension: 'minecraft:overworld',
    source: 'managed_paper',
    observedAt: Date.now(),
  });
  director.executeGoalCommand = async (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };

  assert.equal(director.waitForPlayer(director.activeGoal), false);
  assert.equal(director.activeGoal.evidence.code, 'delivery_player_locating');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(director.activeGoal.memory.deliveryTarget.position, { x: 100, y: 70, z: 100 });
  assert.equal(director.activeGoal.memory.deliveryTarget.source, 'managed_paper');

  assert.equal(director.waitForPlayer(director.activeGoal), false);
  assert.deepEqual(commands, ['!goToCoordinates(100, 70, 100, 16)']);
  assert.equal(director.activeGoal.subgoals.at(-1).kind, 'recover');
  assert.equal(director.activeGoal.attempts, 2);

  const player = { type: 'player', username: 'phixxation', position: { x: 99, y: 70, z: 99 } };
  director.agent.bot.players.phixxation = { username: 'phixxation', entity: player };
  director.agent.bot.entities[42] = player;
  assert.equal(director.waitForPlayer(director.activeGoal), true);
  assert.equal(director.activeGoal.attempts, 2);
});

test('delivery routes to the newest complete shared player observation', () => {
  const director = createDirector();
  director.now = () => 100_000;
  director.agent.bot.players = {};
  director.agent.bot.entities = {};
  director.agent.bot.entity = { position: { x: 0, y: 64, z: 0 } };
  director.agent.bot.game = { dimension: 'overworld' };
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'phixxation',
    destinationPlayer: 'phixxation',
    target: {
      requestedName: 'iron_axe',
      canonicalName: 'iron_axe',
      inventoryName: 'iron_axe',
      acquisitionName: 'iron_axe',
      family: null,
      acquisitionKind: 'prepare_tool',
    },
    quantity: 1,
    completion: 'delivery',
  });
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'deliver',
    memory: {
      deliveryTarget: {
        player: 'phixxation',
        position: { x: 30, y: 64, z: 30 },
        dimension: 'minecraft:overworld',
        source: 'managed_paper',
        observedAt: 96_000,
      },
    },
  });
  director.agent.companion_context = {
    snapshot: () => ({
      canonicalUsername: 'phixxation',
      requestedName: 'phixxation',
      lastSeenPosition: { x: 100, y: 70, z: 100 },
      lastSeenDimension: 'minecraft:overworld',
      lastSeenSource: 'managed_paper',
      lastSeenAt: 99_000,
      authoritativePlayer: 'phixxation',
      authoritativeFound: true,
      authoritativeCheckedAt: 99_000,
      authoritativeCheckAge: 1_000,
    }),
  };
  const commands = [];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };

  assert.equal(director.waitForPlayer(director.activeGoal), false);
  assert.deepEqual(commands, ['!goToCoordinates(100, 70, 100, 16)']);
  assert.deepEqual(director.activeGoal.memory.deliveryTarget.position, { x: 100, y: 70, z: 100 });
});

test('technical player-locator failure never authorizes movement to an old anchor', () => {
  const director = createDirector();
  director.now = () => 100_000;
  director.agent.bot.players = {};
  director.agent.bot.entities = {};
  director.agent.bot.entity = { position: { x: 0, y: 64, z: 0 } };
  director.agent.bot.game = { dimension: 'overworld' };
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'phixxation',
    destinationPlayer: 'phixxation',
    target: {
      requestedName: 'iron_axe',
      canonicalName: 'iron_axe',
      inventoryName: 'iron_axe',
      acquisitionName: 'iron_axe',
      family: null,
      acquisitionKind: 'prepare_tool',
    },
    quantity: 1,
    completion: 'delivery',
  });
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'deliver',
    attempts: 2,
    memory: {
      deliveryTarget: {
        player: 'phixxation',
        position: { x: 100, y: 70, z: 100 },
        dimension: 'minecraft:overworld',
        source: 'managed_paper',
        observedAt: 90_000,
      },
    },
  });
  director.agent.companion_context = {
    snapshot: () => ({
      requestedName: 'phixxation',
      authoritativePlayer: 'phixxation',
      authoritativeFound: null,
      authoritativeCheckedAt: 100_000,
      authoritativeCheckAge: 0,
      lastSeenPosition: { x: 100, y: 70, z: 100 },
      lastSeenDimension: 'minecraft:overworld',
      lastSeenSource: 'managed_paper',
      lastSeenAt: 90_000,
    }),
  };
  const commands = [];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };

  assert.equal(director.waitForPlayer(director.activeGoal), false);
  assert.deepEqual(commands, []);
  assert.equal(director.activeGoal.phase, 'deliver');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.evidence.code, 'delivery_locator_unavailable');
});

test('dimensionless player observations are never movement authority', () => {
  const director = createDirector();
  director.now = () => 100_000;
  director.agent.bot.players = {};
  director.agent.bot.entities = {};
  director.agent.bot.entity = { position: { x: 0, y: 64, z: 0 } };
  director.agent.bot.game = { dimension: 'overworld' };
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'phixxation',
    destinationPlayer: 'phixxation',
    target: {
      requestedName: 'iron_axe',
      canonicalName: 'iron_axe',
      inventoryName: 'iron_axe',
      acquisitionName: 'iron_axe',
      family: null,
      acquisitionKind: 'prepare_tool',
    },
    quantity: 1,
    completion: 'delivery',
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'deliver' });
  director.agent.companion_context = {
    snapshot: () => ({
      requestedName: 'phixxation',
      canonicalUsername: 'phixxation',
      lastSeenPosition: { x: 100, y: 70, z: 100 },
      lastSeenDimension: null,
      lastSeenSource: 'managed_paper',
      lastSeenAt: 99_000,
      authoritativePlayer: 'phixxation',
      authoritativeFound: true,
      authoritativeCheckedAt: 99_000,
      authoritativeCheckAge: 1_000,
    }),
  };
  const commands = [];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };

  assert.equal(director.waitForPlayer(director.activeGoal), false);
  assert.deepEqual(commands, []);
  assert.equal(director.activeGoal.phase, 'deliver');
  assert.equal(director.activeGoal.evidence.code, 'delivery_player_absent');
});

test('a local drop-stance failure rebinds the recipient without acquisition relocation', () => {
  const director = createDirector();
  let now = 100_000;
  director.now = () => now;
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'phixxation',
    destinationPlayer: 'phixxation',
    target: {
      requestedName: 'clock',
      canonicalName: 'clock',
      inventoryName: 'clock',
      acquisitionName: 'clock',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
    completion: 'delivery',
  });
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'deliver',
    memory: {
      deliveryTarget: {
        player: 'phixxation',
        position: { x: 10, y: 64, z: 10 },
        dimension: 'minecraft:overworld',
        source: 'mineflayer_entity',
        observedAt: now,
      },
    },
  });
  director.appendActingSubgoal('deliver', '!givePlayer("phixxation", "clock", 1)');
  director.handleResult('deliver', {
    actionId: 'failed-local-delivery',
    phase: 'failed',
    code: 'skill_drop_stance_unreachable',
    detail: 'The moving recipient invalidated the selected drop stance.',
    retryable: true,
  });
  const memoryAfterFailure = structuredClone(director.activeGoal.memory);
  const commands = [];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };

  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, 1);
  now = director.nextAttemptAt;
  director.update();

  assert.deepEqual(commands, []);
  assert.equal(director.activeGoal.phase, 'deliver');
  assert.equal(director.activeGoal.attempts, 1);
  assert.equal(director.activeGoal.subgoals.at(-1).kind, 'deliver');
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'skill_drop_stance_unreachable');
  assert.deepEqual(director.activeGoal.memory, memoryAfterFailure);
  assert.ok(director.nextAttemptAt > now);

  for (let attempt = 2; attempt <= goal.maxAttempts; attempt += 1) {
    director.appendActingSubgoal('deliver', '!givePlayer("phixxation", "clock", 1)');
    director.handleResult('deliver', {
      actionId: `failed-local-delivery-${attempt}`,
      phase: 'failed',
      code: 'skill_drop_stance_unreachable',
      detail: 'The moving recipient invalidated the selected drop stance.',
      retryable: true,
    });
    if (attempt < goal.maxAttempts) {
      assert.equal(director.activeGoal.phase, 'recover');
      assert.equal(director.activeGoal.attempts, attempt);
      now = director.nextAttemptAt;
      director.update();
      assert.equal(director.activeGoal.phase, 'deliver');
      assert.deepEqual(commands, []);
    }
  }

  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.lastGoal.attempts, goal.maxAttempts);
  assert.equal(director.lastGoal.subgoals.length, goal.maxAttempts);
  assert.deepEqual(director.lastGoal.memory, memoryAfterFailure);
  assert.deepEqual(commands, []);
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

  assert.deepEqual(commands, ['!moveAway(64)']);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).kind, 'recover');
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
});

test('a deep bot surfaces before retrying a concrete target materially above it', async () => {
  const director = createDirector();
  const now = Date.now();
  const commands = [];
  director.agent.bot.game = { dimension: 'overworld' };
  director.agent.bot.entity = { position: { y: 31 } };
  director.executeGoalCommand = async (agent, command) => {
    commands.push(command);
    agent.last_action_result = {
      actionId: 'verified-surface-arrival',
      phase: 'succeeded',
      code: 'skill_surface_reached',
      detail: 'Reached a supported surface stance.',
      retryable: false,
    };
    return true;
  };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'recover',
    attempts: 1,
    evidence: {
      actionId: 'failed-surface-target',
      phase: 'failed',
      code: 'skill_unreachable',
      detail: 'The known target above the bot had no route from the mine.',
      verified: false,
      at: now,
    },
    subgoals: [
      {
        ...subgoal('plan', 1, 'failed'),
        targetName: 'jungle_log',
        code: 'skill_unreachable',
        startedAt: now - 200,
        finishedAt: now - 150,
      },
      {
        ...subgoal('recover', 2, 'acting'),
        commandName: '!goToSurface',
        startedAt: now - 100,
        finishedAt: null,
      },
    ],
    memory: {
      failedTargets: [{
        kind: 'collect',
        name: 'jungle_log',
        position: { x: -763, y: 64, z: -398 },
        code: 'skill_unreachable',
        failures: 1,
        firstFailedAt: now - 145,
        lastFailedAt: now - 145,
        avoidUntil: now + 90_000,
      }],
    },
  });

  director.handleResult('recover', {
    actionId: 'surface-reflex-preemption',
    phase: 'interrupted',
    code: 'interrupted',
    detail: 'Self-preservation briefly took ownership.',
    retryable: true,
  });
  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, 1);

  director.update();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(commands, ['!goToSurface'], JSON.stringify({
    phase: director.activeGoal?.phase,
    evidence: director.activeGoal?.evidence,
    subgoals: director.activeGoal?.subgoals,
    memory: director.activeGoal?.memory,
    status: director.status,
  }));
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 1);
});

test('verified supported ascent stays latched below the old target-gap threshold', () => {
  const director = createDirector();
  const now = Date.now();
  director.agent.bot.game = { dimension: 'overworld' };
  director.agent.bot.entity = { position: { y: 55 } };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'recover',
    attempts: 2,
    evidence: {
      actionId: 'surface-progress',
      phase: 'failed',
      code: 'skill_route_step_not_reached',
      detail: 'The bounded ascent made progress but did not reach the surface.',
      verified: false,
      at: now,
    },
    subgoals: [
      {
        ...subgoal('plan', 1, 'failed'),
        targetName: 'oak_log',
        code: 'skill_unreachable',
        startedAt: now - 200,
        finishedAt: now - 150,
      },
      {
        ...subgoal('recover', 2, 'acting'),
        commandName: '!goToSurface',
        startedAt: now - 100,
        finishedAt: null,
      },
    ],
    memory: {
      failedTargets: [{
        kind: 'collect',
        name: 'oak_log',
        position: { x: -518, y: 65, z: -388 },
        code: 'skill_unreachable',
        failures: 1,
        firstFailedAt: now - 145,
        lastFailedAt: now - 145,
        avoidUntil: now + 90_000,
      }],
    },
  });

  director.handleResult('recover', {
    actionId: 'surface-progress',
    phase: 'failed',
    code: 'skill_route_step_not_reached',
    detail: 'The bounded ascent advanced on safe support.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'surface_navigation',
        outcome: 'route_step_not_reached',
        verticalProgress: 1,
        supported: true,
        retryable: true,
      },
    },
  });

  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.status.code, 'verified_surface_progress');
});

test('late settlement cannot reopen or mutate a cancelled typed goal', async () => {
  const director = createDirector();
  const execution = deferred();
  director.executeGoalCommand = () => execution.promise;
  assert.equal(director.submit(boundaryGoal([])).accepted, true);

  assert.equal(director.dispatch('recover', '!moveAway(4)'), true);
  assert.equal(director.inFlight, true);
  assert.equal(director.cancel('Operator Stop.'), true);
  const cancelled = director.lastGoal;

  director.agent.last_action_result = {
    actionId: 'late-goal-a',
    phase: 'succeeded',
    code: 'skill_retreated',
    detail: 'This result arrived after cancellation.',
    retryable: false,
  };
  execution.resolve(true);
  await settle();
  await settle();

  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal, cancelled);
  assert.equal(director.lastGoal.phase, 'cancelled');
  assert.equal(director.status.code, 'goal_cancelled');
  assert.equal(director.inFlight, false);
  assert.equal(director.activeDispatch, null);
});

test('late Goal A settlement cannot mutate or release replacement Goal B', async () => {
  const director = createDirector();
  const executionA = deferred();
  const executionB = deferred();
  let dispatchCount = 0;
  director.executeGoalCommand = () => {
    dispatchCount += 1;
    return dispatchCount === 1 ? executionA.promise : executionB.promise;
  };

  assert.equal(director.submit(boundaryGoal([])).accepted, true);
  assert.equal(director.dispatch('recover', '!moveAway(4)'), true);
  director.cancel('Replace Goal A.');

  assert.equal(director.submit(boundaryGoal([])).accepted, true);
  assert.equal(director.dispatch('recover', '!moveAway(4)'), true);
  const dispatchB = director.activeDispatch;
  const goalBId = director.activeGoal.id;
  const goalBSubgoals = director.activeGoal.subgoals;

  director.agent.last_action_result = {
    actionId: 'late-goal-a',
    phase: 'failed',
    code: 'skill_path_stalled',
    detail: 'Goal A settled after Goal B started.',
    retryable: true,
  };
  executionA.resolve(false);
  await settle();
  await settle();

  assert.equal(director.activeGoal.id, goalBId);
  assert.equal(director.activeGoal.subgoals, goalBSubgoals);
  assert.equal(director.activeDispatch, dispatchB);
  assert.equal(director.inFlight, true);

  director.agent.last_action_result = {
    actionId: 'goal-b',
    phase: 'succeeded',
    code: 'skill_retreated',
    detail: 'Goal B settled normally.',
    retryable: false,
  };
  executionB.resolve(true);
  await settle();
  await settle();

  assert.equal(director.activeGoal.id, goalBId);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.inFlight, false);
  assert.equal(director.activeDispatch, null);
});
