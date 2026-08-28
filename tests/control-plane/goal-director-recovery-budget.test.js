import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import minecraftData from 'minecraft-data';
import Vec3 from 'vec3';

import {
  failedPlannerMethodExclusions,
  GoalDirector,
} from '../../src/agent/runtime/goal-director.js';
import { MemoryBank } from '../../src/agent/memory_bank.js';
import { capabilityCommand } from '../../src/agent/runtime/capability-catalogue.js';
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

test('a terminal Goal no longer masks a live durable commitment during an ownership gap', () => {
  const director = createDirector();
  director.activeGoal = { id: 'old-failed-goal', phase: 'failed' };

  assert.equal(director.currentControlCommitment({ owner: null }), null);

  director.activeGoal = { id: 'live-goal', phase: 'execute' };
  assert.deepEqual(director.currentControlCommitment({ owner: 'player' }), {
    owner: 'player_goal',
    obligationId: 'live-goal',
    phase: 'execute',
    ownsCurrentAction: true,
  });
});

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

test('daylight spider prerequisite returns to a distant live requester before waiting', () => {
  const director = createDirector();
  const commands = [];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  const registry = minecraftData('1.21.11');
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
  ];
  const position = { x: 8106.5, y: 68, z: 7944.5 };
  director.agent.bot = {
    registry,
    health: 20,
    entities: {},
    players: {
      DadPlayer: {
        entity: {
          type: 'player',
          username: 'DadPlayer',
          // The former 16-block delivery-reacquire radius left an interrupted
          // return visibly remote from the companion. A 12-block separation
          // must still finish the player-relative return before waiting.
          position: { x: 8118.5, y: 68, z: 7944.5 },
        },
      },
    },
    time: { timeOfDay: 8_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  director.now = () => 100_000;
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'acquire' });

  director.update();

  assert.equal(director.status.phase, 'acting');
  assert.equal(director.status.code, 'goal_recover');
  assert.equal(director.lastPlan.nextStep.capability.id, 'harvest_entity_drop');
  assert.deepEqual(commands, ['!goToPlayer("DadPlayer", 3)']);
  assert.equal(director.activeGoal.subgoals.length, 1);
  assert.equal(director.activeGoal.subgoals[0].kind, 'recover');
  assert.equal(director.activeGoal.evidence.code, 'environmental_wait_returning_to_requester');
  assert.deepEqual(director.agent.bot.entity.position, position);
});

test('daylight requester return waits after damage while the requester region remains hostile', () => {
  const director = createDirector();
  const commands = [];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  const registry = minecraftData('1.21.11');
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
  ];
  director.agent.bot = {
    registry,
    health: 18,
    entities: {
      4: {
        id: 4,
        name: 'skeleton',
        type: 'hostile',
        position: new Vec3(8101.1, 56, 7940.6),
      },
    },
    players: {
      DadPlayer: {
        entity: {
          id: 2,
          type: 'player',
          username: 'DadPlayer',
          position: new Vec3(8104.5, 69, 7939.5),
        },
      },
    },
    time: { timeOfDay: 8_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(8119.5, 70, 7939.5) },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  director.now = () => 100_000;
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'acquire' });

  director.update();

  assert.equal(director.status.phase, 'waiting');
  assert.equal(director.status.code, 'waiting_for_safe_requester_return');
  assert.deepEqual(commands, []);
  assert.equal(director.activeGoal.subgoals.length, 0);
  assert.ok(director.nextAttemptAt > 100_000);
});

test('daylight spider prerequisite waits in place when the requester is not physically resolved', () => {
  const director = createDirector();
  const registry = minecraftData('1.21.11');
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
  ];
  director.agent.bot = {
    registry,
    health: 20,
    entities: {},
    players: {},
    time: { timeOfDay: 8_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position: { x: 8106.5, y: 68, z: 7944.5 } },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  director.now = () => 100_000;
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'acquire' });

  director.update();

  assert.equal(director.status.phase, 'waiting');
  assert.equal(director.status.code, 'waiting_for_hostile_spawn_window');
  assert.equal(director.activeGoal.subgoals.length, 0);
  assert.ok(director.nextAttemptAt > 100_000);
});

test('night source-search exhaustion returns to a distant requester before waiting', () => {
  const director = createDirector();
  const registry = minecraftData('1.21.11');
  const commands = [];
  director.now = () => 105_001;
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
    { name: 'wooden_sword', type: registry.itemsByName.wooden_sword.id, count: 1 },
  ];
  director.agent.bot = {
    registry,
    health: 20,
    heldItem: carried[2],
    entities: {},
    players: {
      DadPlayer: {
        entity: {
          type: 'player',
          username: 'DadPlayer',
          position: new Vec3(8104.5, 69, 7939.5),
        },
      },
    },
    time: { timeOfDay: 14_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(8146.5, 72, 7984.33) },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'acquire',
    memory: {
      ...goal.memory,
      sourceSearchPending: {
        outcome: 'source_search_advanced',
        observedAt: 100_000,
        replay: {
          source: 'spider',
          output: 'string',
          method: 'kill',
          count: 2,
          range: 64,
          allowAlternative: false,
          expectedIncrease: 2,
          learningKey: 'harvest:kill:spider->string',
          reason: 'A spider is the verified String source.',
        },
      },
    },
    subgoals: [{
      id: `${goal.id}:subgoal-1`,
      kind: 'recover',
      state: 'succeeded',
      commandName: '!goToSurface',
      attempt: 1,
      actionId: 'surface-staging',
      code: 'skill_surface_reached',
      detail: 'A supported surface stance was verified.',
      targetName: null,
      targetFamily: null,
      expectedIncrease: 0,
      targetInventoryBefore: 0,
      targetInventoryAfter: 0,
      learningKey: null,
      reason: '',
      inventoryBefore: 0,
      inventoryAfter: 0,
      startedAt: 100_001,
      finishedAt: 100_100,
    }],
  });

  director.update();

  assert.equal(director.status.phase, 'acting');
  assert.equal(director.status.code, 'goal_recover');
  assert.deepEqual(commands, ['!goToPlayer("DadPlayer", 3)']);
  assert.equal(director.activeGoal.subgoals.at(-1).commandName, '!goToPlayer');
  assert.equal(director.activeGoal.evidence.code, 'environmental_wait_returning_to_requester');
});

test('night source pending preserves the productive budget and waits for new loaded evidence', () => {
  const director = createDirector();
  const registry = minecraftData('1.21.11');
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
    { name: 'wooden_sword', type: registry.itemsByName.wooden_sword.id, count: 1 },
  ];
  let now = 100_000;
  const commands = [];
  const learned = [];
  director.now = () => now;
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  director.agent.memory_bank = {
    outcomePreference: () => 0,
    rememberOutcome: (learningKey, outcome) => learned.push({ learningKey, outcome }),
  };
  director.agent.bot = {
    registry,
    health: 20,
    heldItem: carried[2],
    entities: {},
    players: {},
    time: { timeOfDay: 14_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(8102.5, 68, 7939.5) },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'acquire' });
  director.appendActingSubgoal(
    'plan',
    '!harvestEntityDrop("spider", "string", "kill", 2, 64, false)',
    {
      expectedName: 'string',
      expectedIncrease: 2,
      learningKey: 'harvest:kill:spider->string',
      reason: 'A spider is the verified String source.',
    },
  );

  director.handleResult('plan', {
    actionId: 'night-source-pending',
    phase: 'failed',
    code: 'skill_source_spawn_pending',
    detail: 'No usable spider appeared after the bounded night settlement and search.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'entity_harvest',
        outcome: 'source_spawn_pending',
        target: { source: 'spider', output: 'string', method: 'kill' },
        searchAdvanced: false,
        relocationDistance: 0,
        spawnWaits: 1,
        spawnWaitMs: 10_000,
        retryable: true,
      },
    },
  });

  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'skill_source_spawn_pending');
  assert.equal(director.status.code, 'waiting_for_hostile_source_change');
  assert.equal(learned[0].outcome.classification, 'censored');

  // This test isolates replay-budget behavior after the shared staging edge;
  // the production-path test below proves that the Director dispatches this
  // recovery exactly once when the edge is absent.
  director.appendActingSubgoal('recover', '!goToSurface');
  director.handleResult('recover', {
    actionId: 'already-verified-source-wait-stance',
    phase: 'succeeded',
    code: 'skill_surface_reached',
    detail: 'The bot already occupies a supported surface wait stance.',
    retryable: false,
    evidence: {
      skill: {
        kind: 'surface_navigation',
        outcome: 'surface_reached',
        target: { x: 8102, y: 68, z: 7939 },
        observed: { x: 8102.5, y: 68, z: 7939.5 },
        verticalProgress: 0,
        supported: true,
        retryable: false,
      },
    },
  });

  now += 5_001;
  director.update();
  assert.equal(director.status.code, 'waiting_for_hostile_source_change');
  assert.equal(director.activeGoal.attempts, 0);
  assert.deepEqual(commands, []);

  director.agent.bot.entities = {
    12: { id: 12, name: 'spider', position: new Vec3(8110.5, 68, 7939.5) },
  };
  now += 5_001;
  director.update();
  assert.equal(director.status.phase, 'acting');
  assert.equal(director.activeGoal.subgoals.at(-1).commandName, '!harvestEntityDrop');
  assert.equal(commands.length, 1);
});

test('live source access pending persists and reopens only after material source movement', () => {
  const director = createDirector();
  const registry = minecraftData('1.21.11');
  let now = 120_000;
  director.now = () => now;
  const commands = [];
  const learned = [];
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
    { name: 'wooden_sword', type: registry.itemsByName.wooden_sword.id, count: 1 },
  ];
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  director.agent.memory_bank = {
    outcomePreference: learningKey => (
      learningKey === 'harvest:kill:spider->string' ? -12
        : learningKey === 'collect:tripwire->string' ? 12
          : 0
    ),
    rememberOutcome: (learningKey, outcome) => learned.push({ learningKey, outcome }),
  };
  director.agent.bot = {
    registry,
    health: 20,
    heldItem: carried[2],
    entities: {
      12: { id: 12, name: 'spider', position: new Vec3(8122.5, 68, 7939.5) },
    },
    players: {},
    time: { timeOfDay: 14_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(8102.5, 68, 7939.5) },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({ ...goal, phase: 'acquire' });
  director.appendActingSubgoal(
    'plan',
    '!harvestEntityDrop("spider", "string", "kill", 2, 64, false)',
    {
      expectedName: 'string',
      expectedIncrease: 2,
      learningKey: 'harvest:kill:spider->string',
      reason: 'A spider is the verified String source.',
    },
  );

  // A prior runtime already persisted one censored access receipt. The live
  // regression appeared only after the restored goal recorded a second one:
  // generic repeated-method filtering then treated both as method failures.
  director.finishLatestSubgoal({
    actionId: 'prior-source-access-pending',
    phase: 'failed',
    code: 'skill_source_access_pending',
    detail: 'The prior runtime also saw this loaded Spider without a usable path.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'entity_harvest',
        outcome: 'source_access_pending',
        target: { source: 'spider', output: 'string', method: 'kill', entityId: 12 },
      },
    },
  });
  director.appendActingSubgoal(
    'plan',
    '!harvestEntityDrop("spider", "string", "kill", 2, 64, false)',
    {
      expectedName: 'string',
      expectedIncrease: 2,
      learningKey: 'harvest:kill:spider->string',
      reason: 'A spider is the verified String source.',
    },
  );

  director.handleResult('plan', {
    actionId: 'live-source-access-pending',
    phase: 'failed',
    code: 'skill_source_access_pending',
    detail: 'The selected Spider is loaded but its current pursuit has no usable path.',
    retryable: true,
    evidence: {
      request: {
        routeOrigin: 'goal-director',
        selectedSkill: '!harvestEntityDrop',
        args: ['spider', 'string', 'kill', 2, 64],
      },
      skill: {
        kind: 'entity_harvest',
        outcome: 'source_access_pending',
        target: { source: 'spider', output: 'string', method: 'kill', entityId: 12 },
        sourceAccess: {
          source: 'spider',
          entityId: 12,
          position: { x: 8122.5, y: 68, z: 7939.5 },
          stage: 'path_not_found',
          movementOutcome: 'unreachable',
          observedAt: now,
        },
        retryable: true,
      },
    },
  });

  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.deepEqual(director.activeGoal.memory.sourceAccessPending, {
    source: 'spider',
    entityId: 12,
    position: { x: 8122, y: 68, z: 7939 },
    stage: 'path_not_found',
    movementOutcome: 'unreachable',
    observedAt: now,
    replay: {
      source: 'spider',
      output: 'string',
      method: 'kill',
      count: 2,
      range: 64,
      allowAlternative: false,
      expectedIncrease: 2,
      learningKey: 'harvest:kill:spider->string',
      reason: 'A spider is the verified String source.',
    },
  });
  assert.equal(director.status.code, 'waiting_for_hostile_source_access_change');
  assert.equal(learned[0].outcome.classification, 'censored');

  director.activeGoal = normalizeGoalContract(JSON.parse(JSON.stringify(director.activeGoal)));
  assert.equal(
    director.activeGoal.memory.sourceAccessPending.replay.learningKey,
    'harvest:kill:spider->string',
  );

  now += 5_001;
  director.update();
  assert.equal(director.status.code, 'waiting_for_hostile_source_access_change');
  assert.equal(director.activeGoal.attempts, 0);
  assert.deepEqual(commands, []);

  director.agent.bot.entities[13] = {
    id: 13,
    name: 'spider',
    position: new Vec3(8119.5, 68, 7939.5),
  };
  now += 5_001;
  director.update();
  assert.equal(director.status.phase, 'acting');
  assert.equal(director.activeGoal.subgoals.at(-1).commandName, '!harvestEntityDrop');
  assert.deepEqual(commands, [
    '!harvestEntityDrop("spider", "string", "kill", 2, 64, false, 13)',
  ]);
});

test('a settled source search persists exact replay authority and waits for a new qualified source', async () => {
  const director = createDirector();
  const registry = minecraftData('1.21.11');
  let now = 150_000;
  const carried = [
    { name: 'stick', type: registry.itemsByName.stick.id, count: 3 },
    { name: 'crafting_table', type: registry.itemsByName.crafting_table.id, count: 1 },
    { name: 'wooden_sword', type: registry.itemsByName.wooden_sword.id, count: 1 },
  ];
  const commands = [];
  director.now = () => now;
  director.executeGoalCommand = (agent, command) => {
    commands.push(command);
    if (commands.length === 1) {
      agent.bot.entity.position = new Vec3(8134.5, 68, 7939.5);
      agent.last_action_result = {
        actionId: 'bounded-source-search-advanced',
        phase: 'failed',
        code: 'skill_source_search_advanced',
        detail: 'The bounded search reached one distinct region without finding a usable Spider.',
        retryable: true,
        evidence: {
          request: {
            routeOrigin: 'goal-director',
            selectedSkill: '!harvestEntityDrop',
            args: ['spider', 'string', 'kill', 2, 64],
          },
          skill: {
            kind: 'entity_harvest',
            outcome: 'source_search_advanced',
            target: { source: 'spider', output: 'string', method: 'kill' },
            searchAdvanced: true,
            origin: { x: 8102.5, y: 68, z: 7939.5 },
            observedPosition: { x: 8134.5, y: 68, z: 7939.5 },
            relocationDistance: 32,
            spawnWaits: 2,
            spawnWaitMs: 20_000,
            retryable: true,
          },
        },
      };
      return false;
    }
    if (command === '!goToSurface') {
      agent.bot.entity.position = new Vec3(8134.5, 69, 7939.5);
      agent.last_action_result = {
        actionId: 'verified-hostile-source-surface-staging',
        phase: 'succeeded',
        code: 'skill_surface_reached',
        detail: 'Reached a supported surface stance before waiting for a new Spider.',
        retryable: false,
        evidence: {
          skill: {
            kind: 'surface_navigation',
            outcome: 'surface_reached',
            target: { x: 8134, y: 69, z: 7939 },
            observed: { x: 8134.5, y: 69, z: 7939.5 },
            verticalProgress: 1,
            supported: true,
            retryable: false,
          },
        },
      };
      return true;
    }
    return new Promise(() => {});
  };
  director.agent.bot = {
    registry,
    health: 20,
    heldItem: carried[2],
    entities: {},
    players: {},
    time: { timeOfDay: 14_000 },
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(8102.5, 68, 7939.5) },
    inventory: { slots: carried, items: () => carried },
    findBlock: () => null,
  };
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'DadPlayer',
    target: {
      requestedName: 'fishing_rod',
      canonicalName: 'fishing_rod',
      inventoryName: 'fishing_rod',
      acquisitionName: 'fishing_rod',
      family: null,
      acquisitionKind: 'craft',
    },
    quantity: 1,
  });
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'acquire',
    attempts: 1,
    memory: {
      ...goal.memory,
      sourceAccessPending: {
        source: 'spider',
        entityId: 12,
        position: { x: 8122, y: 68, z: 7939 },
        stage: 'path_not_found',
        movementOutcome: 'unreachable',
        observedAt: 140_000,
        replay: {
          source: 'spider',
          output: 'string',
          method: 'kill',
          count: 2,
          range: 64,
          allowAlternative: false,
          expectedIncrease: 2,
          learningKey: 'harvest:kill:spider->string',
          reason: 'A spider is the verified String source.',
        },
      },
    },
  });

  director.update();

  assert.equal(director.status.phase, 'acting');
  assert.equal(director.activeGoal.attempts, 1);
  assert.equal(director.activeGoal.memory.sourceAccessPending.entityId, 12);
  assert.equal(director.activeGoal.subgoals.at(-1).commandName, '!harvestEntityDrop');
  assert.deepEqual(commands, [
    '!harvestEntityDrop("spider", "string", "kill", 2, 64)',
  ]);

  await settle();
  await settle();

  assert.equal(director.status.code, 'waiting_for_hostile_source_change');
  assert.equal(director.activeGoal.attempts, 1);
  assert.equal(director.activeGoal.memory.sourceAccessPending, undefined);
  assert.equal(director.activeGoal.memory.sourceSearchPending.outcome, 'source_search_advanced');
  assert.equal(
    director.activeGoal.memory.sourceSearchPending.replay.learningKey,
    'harvest:kill:spider->string',
  );
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'capability_verified_partial_progress');

  director.activeGoal = normalizeGoalContract(JSON.parse(JSON.stringify(director.activeGoal)));
  assert.equal(
    director.activeGoal.memory.sourceSearchPending.replay.output,
    'string',
  );

  now += 5_001;
  director.update();
  assert.equal(director.status.code, 'goal_recover');
  assert.deepEqual(commands, [
    '!harvestEntityDrop("spider", "string", "kill", 2, 64)',
    '!goToSurface',
  ]);

  await settle();
  await settle();

  now += 101;
  director.update();
  assert.equal(director.status.code, 'waiting_for_hostile_source_change');
  assert.equal(director.activeGoal.attempts, 1);
  assert.equal(commands.length, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).commandName, '!goToSurface');
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'skill_surface_reached');

  director.agent.bot.entities[13] = {
    id: 13,
    name: 'spider',
    position: new Vec3(8118.5, 68, 7939.5),
  };
  now += 5_001;
  director.update();
  assert.equal(director.status.phase, 'acting');
  assert.equal(director.activeGoal.attempts, 1);
  assert.deepEqual(commands, [
    '!harvestEntityDrop("spider", "string", "kill", 2, 64)',
    '!goToSurface',
    '!harvestEntityDrop("spider", "string", "kill", 2, 64, false, 13)',
  ]);
});

test('death defers the productive charge, recovers recorded items, and ignores the late interruption', async () => {
  const director = createDirector();
  let now = 100_000;
  const deathRecordedAt = 99_999;
  director.now = () => now;
  const originalAction = deferred();
  const commands = [];
  director.agent.memory_bank = {
    recallDeath: recordedAt => recordedAt === deathRecordedAt ? ({
      position: { x: 8144, y: 67, z: 7929 },
      dimension: 'overworld',
      inventory: { spruce_log: 5, stick: 4, string: 1 },
      recordedAt: deathRecordedAt,
      recoveredAt: null,
    }) : null,
  };
  director.executeGoalCommand = async (agent, command) => {
    commands.push(command);
    if (command.startsWith('!collectBlocksInRange')) {
      await originalAction.promise;
      const result = {
        actionId: 'late-interrupted-action',
        phase: 'interrupted',
        code: 'interrupted',
        detail: 'Death cleanup stopped the old action.',
        retryable: true,
      };
      agent.last_action_result = result;
      return { value: false, result };
    }
    const result = {
      actionId: 'death-items-recovered',
      phase: 'succeeded',
      code: 'skill_items_recovered',
      detail: 'Recovered the recorded dropped inventory.',
      retryable: false,
      evidence: { skill: { kind: 'death_recovery', outcome: 'items_recovered' } },
    };
    agent.last_action_result = result;
    return { value: true, result };
  };
  const censoredGoal = boundaryGoal([]);
  const miningRoute = [
    { x: 2, y: 32, z: 8 },
    { x: 3, y: 31, z: 8 },
  ];
  director.agent.bot.entity = { position: new Vec3(8144, 67, 7929) };
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  director.activeGoal = normalizeGoalContract({
    ...censoredGoal,
    attempts: censoredGoal.maxAttempts - 1,
    checkpoint: {
      ...censoredGoal.checkpoint,
      miningReturnRoute: miningRoute,
      miningReturnIndex: 1,
      miningReturnDimension: 'overworld',
    },
  });

  assert.equal(director.dispatch('plan', '!collectBlocksInRange("stone", 1, 64)'), true);
  assert.equal(director.reconcileDeath({
    position: { x: 8144, y: 67, z: 7929 },
    dimension: 'overworld',
    recoverableItems: 10,
    deathRecord: director.agent.memory_bank.recallDeath(deathRecordedAt),
    deathPersistenceCode: 'death_recorded',
  }), true);
  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, censoredGoal.maxAttempts - 1);
  assert.equal(director.activeGoal.evidence.code, 'goal_owner_died');
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'goal_owner_died');
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute, miningRoute);

  director.activeGoal = normalizeGoalContract({
    ...director.activeGoal,
    phase: 'assess',
    evidence: {
      actionId: '',
      phase: 'assess',
      code: 'restart_revalidation',
      detail: 'Fresh process must revalidate the persisted death identity.',
      verified: false,
      at: now,
    },
  });

  now += 750;
  director.update();
  await settle();
  await settle();
  assert.deepEqual(commands, [
    '!collectBlocksInRange("stone", 1, 64)',
    `!recoverDeathItems(${deathRecordedAt})`,
  ]);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, censoredGoal.maxAttempts - 1);
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'skill_items_recovered');
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute, miningRoute);

  originalAction.resolve();
  await settle();
  await settle();
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, censoredGoal.maxAttempts - 1);
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'skill_items_recovered');
});

test('death without an acting subgoal defers its charge until recorded inventory recovery settles', () => {
  const director = createDirector();
  const deathRecordedAt = 119_999;
  const goal = boundaryGoal([]);
  director.activeGoal = normalizeGoalContract({
    ...goal,
    attempts: goal.maxAttempts - 1,
  });

  assert.equal(director.reconcileDeath({
    position: { x: 8144, y: 67, z: 7929 },
    dimension: 'overworld',
    recoverableItems: 10,
    deathRecord: {
      position: { x: 8144, y: 67, z: 7929 },
      dimension: 'overworld',
      inventory: { spruce_log: 5, stick: 4, string: 1 },
      recordedAt: deathRecordedAt,
      recoveredAt: null,
    },
    deathPersistenceCode: 'death_recorded',
  }), true);
  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, goal.maxAttempts - 1);
  assert.equal(director.activeGoal.evidence.code, 'goal_owner_died');
  assert.deepEqual(director.activeGoal.memory.deathRecovery, { recordedAt: deathRecordedAt });
});

test('an unrecovered death spends the bounded attempt and terminalizes only when exhausted', async () => {
  const director = createDirector();
  const goal = boundaryGoal([]);
  director.activeGoal = normalizeGoalContract({
    ...goal,
    attempts: goal.maxAttempts - 1,
    phase: 'recover',
    memory: {
      ...goal.memory,
      deathRecovery: { recordedAt: 129_999 },
    },
  });
  director.executeGoalCommand = async agent => {
    const result = {
      actionId: 'death-items-unrecovered',
      phase: 'failed',
      code: 'skill_death_items_unrecovered',
      detail: 'The recorded drops were not recovered.',
      retryable: true,
      evidence: { skill: { kind: 'death_recovery', outcome: 'items_unrecovered' } },
    };
    agent.last_action_result = result;
    return { value: false, result };
  };

  assert.equal(director.dispatch('recover', '!recoverDeathItems(129999)'), true);
  await settle();
  await settle();

  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.lastGoal.attempts, goal.maxAttempts);
  assert.equal(director.lastGoal.evidence.code, 'goal_attempts_exhausted');
});

test('partial death-manifest progress preserves the attempt while an unchanged retry still exhausts it', () => {
  const director = createDirector();
  const goal = boundaryGoal([{
    ...subgoal('recover', 1, 'acting'),
    commandName: '!recoverDeathItems',
  }]);
  director.activeGoal = normalizeGoalContract({
    ...goal,
    attempts: goal.maxAttempts - 1,
    phase: 'recover',
    memory: {
      ...goal.memory,
      deathRecovery: { recordedAt: 139_999 },
    },
  });
  const partialResult = actionId => ({
    actionId,
    phase: 'failed',
    code: 'skill_items_partially_recovered',
    detail: 'Most of the bound death manifest was recovered.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'death_recovery',
        outcome: 'items_partially_recovered',
        recovered: 725,
        missing: 2,
      },
    },
  });

  director.handleResult('recover', partialResult('death-progress'));

  assert.equal(director.activeGoal.attempts, goal.maxAttempts - 1);
  assert.equal(director.activeGoal.phase, 'recover');
  assert.deepEqual(director.activeGoal.memory.deathRecovery, {
    recordedAt: 139_999,
    recovered: 725,
    missing: 2,
  });
  assert.equal(director.status.code, 'death_recovery_progress');

  director.activeGoal = normalizeGoalContract({
    ...director.activeGoal,
    phase: 'recover',
    subgoals: [
      ...director.activeGoal.subgoals,
      {
        ...subgoal('recover', 2, 'acting'),
        commandName: '!recoverDeathItems',
      },
    ],
  });
  director.handleResult('recover', partialResult('death-unchanged'));

  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.attempts, goal.maxAttempts);
  assert.equal(director.lastGoal.evidence.code, 'goal_attempts_exhausted');
});

test('a full death ledger admits the current death and Goal binds its exact identity', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-death-binding-'));
  try {
    const memory = new MemoryBank('BudgetBot', { rootDir });
    memory.load();
    for (let index = 0; index < 8; index += 1) {
      const stored = memory.recordDeath(
        { x: index + 0.5, y: 64, z: index + 0.5 },
        'overworld',
        { spruce_log: index + 1 },
      );
      assert.equal(stored.stored, true);
    }
    const staleHead = memory.recallDeath();
    const current = memory.recordDeath(
      { x: 8098.37, y: 58, z: 7943.45 },
      'overworld',
      { spruce_log: 4, stick: 3, crafting_table: 1, wooden_sword: 1 },
    );
    assert.equal(current.stored, true);
    assert.equal(current.code, 'death_recorded_after_capacity_displacement');
    assert.equal(current.pending, 8);
    assert.equal(current.displacedRecordedAt, staleHead.recordedAt);
    assert.equal(current.record.position.x, 8098.37);

    let staleRecallCount = 0;
    const director = createDirector();
    director.agent.memory_bank = {
      recallDeath(recordedAt) {
        if (recordedAt == null) staleRecallCount += 1;
        return memory.recallDeath(recordedAt);
      },
    };
    director.activeGoal = boundaryGoal([subgoal('plan', 1, 'acting')]);

    assert.equal(director.reconcileDeath({
      position: { x: 8098.37, y: 58, z: 7943.45 },
      dimension: 'overworld',
      recoverableItems: 9,
      deathRecord: current.record,
      deathPersistenceCode: current.code,
    }), true);
    assert.equal(staleRecallCount, 0);
    assert.equal(director.activeGoal.phase, 'recover');
    assert.equal(director.activeGoal.evidence.code, 'goal_owner_died');
    assert.equal(
      director.activeGoal.memory.deathRecovery.recordedAt,
      current.record.recordedAt,
    );
    assert.equal(director.activeGoal.attempts, 0);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

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
    ...boundaryGoal([subgoal('plan', 1, 'acting')]),
    attempts: 2,
  });
  director.handleResult('plan', {
    actionId: 'capacity-precondition',
    phase: 'failed',
    code: 'skill_inventory_full',
    detail: 'Inventory cannot reserve three working slots safely.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'collect',
        outcome: 'inventory_full',
        requiredFreeSlots: 3,
        observedFreeSlots: 1,
        retryable: true,
      },
    },
  });
  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.lastGoal.attempts, 2);
  assert.equal(director.lastGoal.evidence.code, 'inventory_capacity_blocked');

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

  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([subgoal('plan', 1, 'acting')]),
    attempts: 2,
    checkpoint: {
      baselineInventory: 0,
      targetInventory: 1,
      delivered: 0,
      miningReturnRoute: [
        { x: 783, y: 53, z: -737 },
        { x: 788, y: 50, z: -737 },
      ],
      miningReturnIndex: 1,
      miningReturnDimension: 'overworld',
    },
  });
  director.handleResult('plan', {
    actionId: 'safe-depth-geometry-change',
    phase: 'failed',
    code: 'skill_no_safe_depth_corridor',
    detail: 'Cleared falling gravel from alternate headings and returned to the exact route endpoint.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_relocation',
        outcome: 'no_safe_depth_corridor',
        routeDigging: true,
        geometryChanged: true,
        returnable: true,
        excavated: 4,
      },
    },
  });
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
  assert.equal(director.activeGoal.evidence.phase, 'succeeded');
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute, [
    { x: 783, y: 53, z: -737 },
    { x: 788, y: 50, z: -737 },
  ]);

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

test('a verified mining route survives a partially productive failure and must be retraced before inventory-goal completion', () => {
  const director = createDirector();
  const base = createItemGoalContract({
    kind: 'acquire',
    requester: 'Director',
    target: {
      requestedName: 'cobblestone',
      canonicalName: 'cobblestone',
      inventoryName: 'cobblestone',
      acquisitionName: 'stone',
      family: null,
      acquisitionKind: 'collect_block',
    },
    quantity: 1,
  });
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  director.agent.bot.inventory.slots = [{ name: 'cobblestone', count: 1 }];
  director.activeGoal = normalizeGoalContract({
    ...base,
    subgoals: [{
      ...subgoal('plan', 1, 'acting'),
      targetName: 'cobblestone',
      expectedIncrease: 1,
      targetInventoryBefore: 0,
    }],
  });

  director.handleResult('plan', {
    actionId: 'cobble-through-corridor',
    phase: 'failed',
    code: 'skill_unreachable',
    detail: 'Collected cobblestone through a verified two-cell route before the next target was unreachable.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_search',
        outcome: 'resource_collected',
        target: { name: 'stone', x: 4, y: 30, z: 8 },
        returnRoute: [
          { x: 2, y: 32, z: 8 },
          { x: 3, y: 31, z: 8 },
        ],
        routeDigging: true,
        returnable: true,
      },
    },
  });

  assert.equal(director.activeGoal.phase, 'verify_complete');
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute, [
    { x: 2, y: 32, z: 8 },
    { x: 3, y: 31, z: 8 },
  ]);
  assert.equal(director.activeGoal.checkpoint.miningReturnIndex, 1);
  assert.equal(director.activeGoal.checkpoint.miningReturnDimension, 'overworld');
  assert.equal(director.verify().code, 'mining_return_pending');

  const dispatched = [];
  director.dispatch = (kind, command, step) => {
    dispatched.push({ kind, command, step });
    return true;
  };
  director.nextAttemptAt = 0;
  director.update();
  assert.equal(dispatched[0].kind, 'recover');
  assert.equal(
    capabilityCommand(dispatched[0].step.capability),
    '!traverseMiningRouteCell(2, 32, 8)',
  );
  assert.equal(dispatched[0].step.capability.id, 'traverse_mining_route_cell');
  assert.deepEqual(dispatched[0].step.capability.arguments, {
    x: 2,
    y: 32,
    z: 8,
    dimension: 'overworld',
  });

  director.appendActingSubgoal('recover', '!traverseMiningRouteCell(2, 32, 8)');
  director.handleResult('recover', {
    actionId: 'return-route-segment',
    phase: 'succeeded',
    code: 'skill_route_cell_returned',
    detail: 'Returned through the verified route segment to its origin.',
    retryable: false,
    evidence: {
      skill: {
        kind: 'mining_return',
        outcome: 'route_cell_returned',
        target: { name: 'mining_return_cell', x: 2, y: 32, z: 8 },
        returnable: true,
      },
    },
  });
  assert.equal(director.activeGoal.checkpoint.miningReturnIndex, -1);
  assert.equal(director.verify().code, 'inventory_goal_verified');
});

test('an acquisition rejoin keeps the verified forward mining spine', () => {
  const director = createDirector();
  const route = [
    { x: 2, y: 32, z: 8 },
    { x: 3, y: 31, z: 8 },
    { x: 4, y: 30, z: 8 },
  ];
  director.activeGoal = normalizeGoalContract({
    ...createItemGoalContract({
      kind: 'acquire',
      requester: 'Director',
      target: {
        requestedName: 'iron_ore',
        canonicalName: 'iron_ore',
        inventoryName: 'iron_ore',
        acquisitionName: 'iron_ore',
        family: null,
        acquisitionKind: 'collect_block',
      },
      quantity: 1,
    }),
    phase: 'recover',
    checkpoint: {
      baselineInventory: 0,
      targetInventory: 1,
      delivered: 0,
      miningReturnRoute: route,
      miningReturnIndex: 2,
      miningReturnDimension: 'overworld',
    },
    subgoals: [{
      ...subgoal('recover', 1, 'acting'),
      commandName: '!goToCoordinates',
      learningKey: 'mining-route-rejoin:0',
    }],
  });

  director.handleResult('recover', {
    actionId: 'rejoin-route-origin',
    phase: 'succeeded',
    code: 'skill_arrived',
    detail: 'Reached the earlier preserved route cell.',
    retryable: false,
    evidence: {
      skill: {
        kind: 'movement',
        outcome: 'arrived',
      },
    },
  });

  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute, route);
  assert.equal(director.activeGoal.checkpoint.miningReturnIndex, 2);
  assert.equal(director.activeGoal.phase, 'assess');
});

test('an invalid underground return cell hands the same productive goal to surface recovery', () => {
  const director = createDirector();
  const route = [
    { x: 835, y: 51, z: -619 },
    { x: 841, y: 51, z: -615 },
  ];
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  director.agent.bot.entity = { position: new Vec3(841.5, 50, -614.49) };
  director.activeGoal = normalizeGoalContract({
    ...createItemGoalContract({
      kind: 'acquire',
      requester: 'Director',
      target: {
        requestedName: 'diamond_pickaxe',
        canonicalName: 'diamond_pickaxe',
        inventoryName: 'diamond_pickaxe',
        acquisitionName: 'diamond_pickaxe',
        family: null,
        acquisitionKind: 'craft',
      },
      quantity: 1,
    }),
    phase: 'recover',
    checkpoint: {
      baselineInventory: 0,
      targetInventory: 1,
      delivered: 0,
      miningReturnRoute: route,
      miningReturnIndex: 1,
      miningReturnDimension: 'overworld',
    },
    subgoals: [{
      ...subgoal('recover', 1, 'acting'),
      commandName: '!traverseMiningRouteCell',
    }],
  });

  director.handleResult('recover', {
    actionId: 'broken-return-support',
    phase: 'failed',
    code: 'skill_return_route_support_repair_failed',
    detail: 'The saved route cell lost its floor and could not be restored.',
    retryable: false,
    evidence: {
      skill: {
        kind: 'mining_return',
        outcome: 'return_route_support_repair_failed',
        target: route[1],
        supportRepairNeeded: true,
        supportRepaired: false,
        returnable: false,
      },
    },
  });

  assert.equal(director.activeGoal.id.startsWith('goal-'), true);
  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, 0);
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute || [], []);
  assert.equal(director.activeGoal.evidence.code, 'mining_return_route_invalidated');

  const dispatched = [];
  director.dispatch = (kind, command, step) => {
    dispatched.push({ kind, command, step });
    return true;
  };
  director.nextAttemptAt = 0;
  director.update();

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].kind, 'recover');
  assert.equal(dispatched[0].command, '!goToSurface');
  assert.equal(director.activeGoal.id.startsWith('goal-'), true);
  assert.equal(director.activeGoal.attempts, 0);
});

test('a partial return segment keeps its protected-cell cause and retires the stale spine', () => {
  const director = createDirector();
  const route = [
    { x: 835, y: 50, z: -619 },
    { x: 841, y: 50, z: -615 },
  ];
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  // The body occupies an earlier preserved cell after partial progress. The
  // protected later cell still invalidates the spine; replaying it would loop.
  director.agent.bot.entity = { position: new Vec3(835.5, 50, -618.5) };
  director.activeGoal = normalizeGoalContract({
    ...createItemGoalContract({
      kind: 'acquire',
      requester: 'Director',
      target: {
        requestedName: 'diamond_pickaxe',
        canonicalName: 'diamond_pickaxe',
        inventoryName: 'diamond_pickaxe',
        acquisitionName: 'diamond_pickaxe',
        family: null,
        acquisitionKind: 'craft',
      },
      quantity: 1,
    }),
    phase: 'recover',
    checkpoint: {
      baselineInventory: 0,
      targetInventory: 1,
      delivered: 0,
      miningReturnRoute: route,
      miningReturnIndex: 1,
      miningReturnDimension: 'overworld',
    },
    subgoals: [{
      ...subgoal('recover', 1, 'acting'),
      commandName: '!traverseMiningRouteCell',
    }],
  });

  director.handleResult('recover', {
    actionId: 'partial-protected-return',
    phase: 'failed',
    code: 'skill_route_segment_partial',
    detail: 'Returned through one preserved cell; the next contains a protected block.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'mining_return',
        outcome: 'route_segment_partial',
        failureOutcome: 'protected_block_in_route',
        target: route[1],
        cellsTraversed: 1,
        returnable: false,
      },
    },
  });

  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, 0);
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute || [], []);
  assert.equal(director.activeGoal.evidence.code, 'mining_return_route_invalidated');
  assert.equal(director.status.code, 'mining_return_route_invalidated');
});

test('rejoin failures from a retired mining spine do not exhaust a new route', () => {
  const director = createDirector();
  const route = Array.from({ length: 10 }, (_, index) => ({
    x: index,
    y: 32 - index,
    z: 8,
  }));
  director.agent.bot.entity = { position: new Vec3(0, 32, 28) };
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  director.activeGoal = normalizeGoalContract({
    ...createItemGoalContract({
      kind: 'acquire',
      requester: 'Director',
      target: {
        requestedName: 'iron_ore',
        canonicalName: 'iron_ore',
        inventoryName: 'iron_ore',
        acquisitionName: 'iron_ore',
        family: null,
        acquisitionKind: 'collect_block',
      },
      quantity: 1,
    }),
    phase: 'assess',
    checkpoint: {
      baselineInventory: 0,
      targetInventory: 1,
      delivered: 0,
      miningReturnRoute: route,
      miningReturnIndex: route.length - 1,
      miningReturnDimension: 'overworld',
    },
    subgoals: [
      { ...subgoal('recover', 1, 'failed'), commandName: '!goToCoordinates', learningKey: 'mining-route-rejoin:0' },
      { ...subgoal('recover', 2, 'failed'), commandName: '!goToCoordinates', learningKey: 'mining-route-rejoin:8' },
    ],
  });
  const dispatched = [];
  director.dispatch = (kind, command, step) => {
    dispatched.push({ kind, command, step });
    return true;
  };

  director.update();

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].kind, 'recover');
  assert.match(dispatched[0].step.learningKey, /^mining-route-rejoin:10@0,32,8@9,23,8:\d+$/);
  assert.deepEqual(director.activeGoal.checkpoint.miningReturnRoute, route);
  assert.equal(director.activeGoal.evidence.code, 'mining_route_rejoin_pending');
});

test('an Agenda-owned goal failure settles upward without activating Hold or announcing a false terminal outcome', async () => {
  const director = createDirector();
  const reports = [];
  director.agent.openChat = message => reports.push(message);
  director.activeGoal = boundaryGoal([
    subgoal('plan', 1),
    subgoal('plan', 2),
    subgoal('plan', 3),
    subgoal('plan', 4),
  ]);
  const goalId = director.activeGoal.id;
  director.agent.agenda_director = {
    ownsGoalExecutor: candidateId => candidateId === goalId,
  };

  director.fail('skill_unreachable', 'The bounded acquisition exhausted its regions.');
  await settle();

  assert.equal(director.lastGoal.id, goalId);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.agent.operator_hold_reason, undefined);
  assert.deepEqual(reports, []);
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

test('failed delivery relocation is terminal and cannot clone the unchanged handoff through Agenda', () => {
  const director = createDirector();
  const terminalBoundaries = [];
  director.recordTerminalBoundary = (boundary, evidence) => {
    terminalBoundaries.push({ boundary, evidence });
    return true;
  };
  const goal = createItemGoalContract({
    kind: 'deliver',
    requester: 'DadPlayer',
    destinationPlayer: 'DadPlayer',
    target: {
      requestedName: 'raw_iron',
      canonicalName: 'raw_iron',
      inventoryName: 'raw_iron',
      acquisitionName: 'raw_iron',
      family: null,
      acquisitionKind: 'planned',
    },
    quantity: 8,
    completion: 'delivery',
  });
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'recover',
    attempts: 1,
    subgoals: [
      {
        ...subgoal('deliver', 1, 'failed'),
        commandName: '!givePlayer',
        actionId: 'delivery-no-path',
        code: 'skill_path_not_found',
      },
      subgoal('recover', 2, 'acting'),
    ],
  });

  director.handleResult('recover', {
    actionId: 'delivery-relocation-no-region',
    phase: 'failed',
    code: 'skill_no_safe_region',
    detail: 'No safe relocation region was reachable from the current stance.',
    retryable: true,
  });

  assert.equal(director.activeGoal, null);
  assert.equal(director.lastGoal.phase, 'failed');
  assert.equal(director.lastGoal.evidence.code, 'no_deterministic_recovery');
  assert.equal(director.lastGoal.evidence.retryable, false);
  assert.equal(director.lastGoal.attempts, 1);
  assert.equal(director.lastGoal.subgoals.at(-1).code, 'skill_no_safe_region');
  assert.deepEqual(terminalBoundaries, [{
    boundary: 'no_deterministic_recovery',
    evidence: {
      code: 'no_deterministic_recovery',
      detail: 'No safe relocation region was reachable from the current stance.',
    },
  }]);
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

  assert.deepEqual(commands, ['!moveAway(32, true)']);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).kind, 'recover');
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'succeeded');
});

test('target-local collection failures do not blacklist the whole block-drop method', () => {
  const director = createDirector();
  const now = Date.now();
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    maxSubgoals: 8,
    subgoals: [
      {
        ...subgoal('plan', 1, 'failed'),
        learningKey: 'collect:iron_ore->raw_iron',
        targetName: 'raw_iron',
        code: 'skill_unreachable',
        failureScope: 'target',
        startedAt: now - 400,
        finishedAt: now - 350,
      },
      {
        ...subgoal('plan', 2, 'failed'),
        learningKey: 'collect:iron_ore->raw_iron',
        targetName: 'raw_iron',
        code: 'skill_unreachable',
        failureScope: 'target',
        startedAt: now - 300,
        finishedAt: now - 250,
      },
      {
        ...subgoal('plan', 3, 'failed'),
        learningKey: 'collect:iron_ore->raw_iron',
        targetName: 'raw_iron',
        code: 'skill_unreachable',
        failureScope: 'target',
        startedAt: now - 200,
        finishedAt: now - 150,
      },
      {
        ...subgoal('plan', 4, 'failed'),
        learningKey: 'collect:iron_ore->raw_iron',
        targetName: 'raw_iron',
        code: 'skill_unreachable',
        failureScope: 'target',
        startedAt: now - 100,
        finishedAt: now - 50,
      },
    ],
  });

  assert.deepEqual(failedPlannerMethodExclusions(director.activeGoal), []);
  const dispatched = [];
  director.dispatch = (kind, command, step) => {
    dispatched.push({ kind, command, step });
    return true;
  };
  director.update();
  assert.equal(dispatched[0].command, '!goToSurface');
  assert.match(dispatched[0].step.learningKey, /^mining-region-surface:/);
});

test('a target-scoped plan failure spends target memory instead of the productive Goal budget', () => {
  const director = createDirector();
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'acquire',
    attempts: 2,
    maxSubgoals: 8,
  });
  director.appendActingSubgoal(
    'plan',
    '!collectBlocksInRange("iron_ore", 2, 64)',
    {
      expectedName: 'raw_iron',
      expectedIncrease: 2,
      learningKey: 'collect:iron_ore->raw_iron',
    },
  );

  director.handleResult('plan', {
    actionId: 'different-local-iron-face',
    phase: 'failed',
    code: 'skill_unreachable',
    detail: 'This exact iron face has no safe interaction stance.',
    retryable: true,
    evidence: {
      skill: {
        kind: 'collect',
        outcome: 'unreachable',
        target: { name: 'iron_ore', x: 12, y: 20, z: 8 },
      },
    },
  });

  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).failureScope, 'target');
  assert.equal(director.activeGoal.phase, 'recover');
});

test('tree terrain settlement hands the unfinished Goal to surface recovery without weakening cleanup', () => {
  const director = createDirector();
  const commands = [];
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  director.agent.bot.entity = { position: new Vec3(12, 31, 8) };
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'acquire',
    attempts: 2,
    maxSubgoals: 8,
  });
  director.appendActingSubgoal(
    'plan',
    '!collectWoodInRange(1, 64, false, true)',
    {
      expectedName: 'logs',
      expectedFamily: 'logs',
      expectedIncrease: 1,
      learningKey: 'collect:logs->logs',
    },
  );

  director.handleResult('plan', {
    actionId: 'tree-body-unsettled',
    phase: 'failed',
    code: 'skill_tree_terrain_settlement_unverified',
    detail: 'The completed tree transaction did not settle on verified nearby terrain.',
    retryable: false,
    evidence: {
      skill: {
        kind: 'collect',
        outcome: 'tree_terrain_settlement_unverified',
        completionBlocked: true,
      },
    },
  });

  assert.equal(director.activeGoal.phase, 'recover');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).failureScope, 'region');
  assert.equal(director.activeGoal.evidence.completionBlocked, true);

  director.update();
  assert.deepEqual(commands, ['!goToSurface']);
  assert.equal(director.activeGoal.subgoals.at(-1).commandName, '!goToSurface');
});

test('a true repeated method failure remains excluded from causal replanning', () => {
  const director = createDirector();
  const now = Date.now();
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    maxSubgoals: 8,
    subgoals: [
      {
        ...subgoal('plan', 1, 'failed'),
        learningKey: 'craft:stone_pickaxe<-2xstick+3xcobblestone',
        code: 'skill_recipe_unavailable',
        failureScope: 'method',
        startedAt: now - 400,
        finishedAt: now - 350,
      },
      {
        ...subgoal('plan', 2, 'failed'),
        learningKey: 'craft:stone_pickaxe<-2xstick+3xcobblestone',
        code: 'skill_recipe_unavailable',
        failureScope: 'method',
        startedAt: now - 300,
        finishedAt: now - 250,
      },
    ],
  });

  assert.deepEqual(failedPlannerMethodExclusions(director.activeGoal), [
    'craft:stone_pickaxe<-2xstick+3xcobblestone',
  ]);

  const prerequisiteGoal = normalizeGoalContract({
    ...director.activeGoal,
    subgoals: director.activeGoal.subgoals.map(subgoal => ({
      ...subgoal,
      failureScope: 'prerequisite',
    })),
  });
  assert.deepEqual(failedPlannerMethodExclusions(prerequisiteGoal), []);
});

test('a region-scoped depth failure unwinds its return spine and relocates before retrying', async () => {
  const director = createDirector();
  const now = Date.now();
  const route = [
    { x: 10, y: 62, z: 10 },
    { x: 12, y: 58, z: 10 },
  ];
  director.agent.bot.game = { dimension: 'minecraft:overworld' };
  director.agent.bot.entity = { position: new Vec3(12, 58, 10) };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'recover',
    attempts: 1,
    maxSubgoals: 8,
    checkpoint: {
      baselineInventory: 0,
      targetInventory: 1,
      delivered: 0,
      miningReturnRoute: route,
      miningReturnIndex: 1,
      miningReturnDimension: 'overworld',
    },
    subgoals: [{
      ...subgoal('plan', 1, 'failed'),
      commandName: '!goToMiningDepth',
      learningKey: 'collect:deepslate_iron_ore->raw_iron',
      code: 'skill_no_safe_depth_corridor',
      failureScope: 'region',
      startedAt: now - 200,
      finishedAt: now - 150,
    }],
  });
  const dispatched = [];
  director.dispatch = (kind, command, step) => {
    dispatched.push({ kind, command, step });
    return true;
  };

  director.update();
  assert.equal(dispatched[0].step.capability.id, 'traverse_mining_route_cell');
  assert.equal(director.activeGoal.evidence.code, 'mining_region_return_pending');

  director.activeGoal = normalizeGoalContract({
    ...director.activeGoal,
    phase: 'assess',
    checkpoint: {
      ...director.activeGoal.checkpoint,
      miningReturnIndex: -1,
    },
  });
  director.update();
  assert.equal(dispatched[1].command, '!goToSurface');
  assert.match(dispatched[1].step.learningKey, /^mining-region-surface:/);
  assert.equal(director.activeGoal.evidence.code, 'mining_region_surface_pending');
});

test('a bot below an unreachable surface resource recovers before retrying it', async () => {
  const director = createDirector();
  const now = Date.now();
  const commands = [];
  director.agent.bot.game = { dimension: 'overworld' };
  // This is the live corridor shape that exposed the old 12-block cutoff:
  // the bot stood at y=60 while the known tree base was at y=71.
  director.agent.bot.entity = { position: { y: 60 } };
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
        position: { x: -763, y: 71, z: -398 },
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

test('an interrupted mining-region surface staging resumes instead of terminalizing the goal', () => {
  const director = createDirector();
  const commands = [];
  director.agent.bot.game = { dimension: 'overworld' };
  director.agent.bot.entity = { position: { y: -5 } };
  director.executeGoalCommand = (_agent, command) => {
    commands.push(command);
    return new Promise(() => {});
  };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'recover',
    attempts: 0,
    evidence: {
      actionId: 'surface-reflex-preemption',
      phase: 'interrupted',
      code: 'interrupted',
      detail: 'Self-defense briefly took ownership.',
      verified: false,
      at: Date.now(),
    },
    subgoals: [{
      ...subgoal('recover', 1, 'failed'),
      commandName: '!goToSurface',
      learningKey: 'mining-region-surface:diamond-pickaxe-expedition',
      code: 'interrupted',
      detail: 'Self-defense briefly took ownership.',
    }],
  });

  director.update();

  assert.deepEqual(commands, ['!goToSurface']);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'acting');
  assert.equal(director.status.code, 'goal_recover');
});

test('a safety-owned interruption suspends the goal without spending or learning a failure', () => {
  const director = createDirector();
  let learned = 0;
  director.agent.memory_bank = {
    rememberOutcome() { learned += 1; },
  };
  director.agent.behavior_arbiter = {
    matchesControlSuspension(commitment) {
      assert.deepEqual(commitment, {
        owner: 'player_goal',
        obligationId: director.activeGoal.id,
        actionId: 'goal-action-1',
      });
      return true;
    },
  };
  director.activeGoal = normalizeGoalContract({
    ...boundaryGoal([]),
    phase: 'acquire',
    attempts: 2,
    subgoals: [{
      ...subgoal('plan', 1, 'acting'),
      commandName: '!collectBlocksInRange',
      learningKey: 'collect:oak_log->oak_log',
      targetName: 'oak_log',
      targetInventoryBefore: 0,
      targetInventoryAfter: 0,
      inventoryBefore: {},
      inventoryAfter: {},
      startedAt: 90_000,
      finishedAt: null,
    }],
  });
  director.now = () => 100_000;

  director.handleResult('plan', {
    actionId: 'goal-action-1',
    phase: 'interrupted',
    code: 'interrupted',
    detail: 'A zombie took control of the encounter.',
    retryable: true,
    continuation: { kind: 'resume_same' },
  });

  assert.equal(director.activeGoal.phase, 'acquire');
  assert.equal(director.activeGoal.attempts, 2);
  assert.equal(director.activeGoal.subgoals.at(-1).state, 'cancelled');
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'safety_suspended');
  assert.equal(director.activeGoal.evidence.code, 'safety_suspended');
  assert.equal(director.status.phase, 'waiting');
  assert.equal(director.status.code, 'safety_suspended');
  assert.equal(director.nextAttemptAt, 0);
  assert.equal(learned, 0);
});

test('a safety suspension during regional recovery returns the same goal to live assessment', () => {
  const director = createDirector();
  const goal = boundaryGoal([]);
  director.activeGoal = normalizeGoalContract({
    ...goal,
    phase: 'recover',
    attempts: 0,
    subgoals: [{
      ...subgoal('recover', 1, 'cancelled'),
      commandName: '!moveAway',
      code: 'safety_suspended',
      detail: 'Survival took exclusive control during regional relocation.',
    }],
    evidence: {
      actionId: 'regional-relocation',
      phase: 'interrupted',
      code: 'safety_suspended',
      detail: 'Survival took exclusive control during regional relocation.',
      verified: false,
      at: 100_000,
    },
  });
  const goalId = director.activeGoal.id;

  director.update();

  assert.equal(director.activeGoal.id, goalId);
  assert.equal(director.activeGoal.phase, 'assess');
  assert.equal(director.activeGoal.attempts, 0);
  assert.equal(director.activeGoal.subgoals.at(-1).code, 'safety_suspended');
  assert.equal(director.status.code, 'preemption_cleared');
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
