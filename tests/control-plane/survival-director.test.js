import assert from 'node:assert/strict';
import test from 'node:test';
import prismarineWorld from 'prismarine-world';
import Vec3 from 'vec3';

import {
  SurvivalDirector,
  summarizeSurvivalSituation,
} from '../../src/agent/runtime/survival-director.js';
import { getSurvivalDirectorState } from '../../src/agent/library/full_state.js';

const POLICY = Object.freeze({
  mode: 'full',
  eatAt: 14,
  criticalFood: 6,
  reserveFoodPoints: 12,
  sleep: 'safe',
  shelter: 'seek',
});

function createAgent() {
  return {
    bot: { entity: { id: 1 } },
    runtime: { survival: POLICY },
    last_action_result: null,
    isIdle: () => true,
    isOperatorHeld: () => false,
  };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

test('Given low hunger, SurvivalDirector dispatches one verified consume action and publishes its result', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 18,
      hunger: 8,
      urgentDanger: false,
      food: [{ name: 'bread', count: 4, foodPoints: 5, saturation: 6 }],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'survival-1',
        phase: 'succeeded',
        code: 'skill_consumed',
        detail: 'Consumed bread.',
        target: { name: 'bread' },
        retryable: false,
      };
    },
  });

  director.update();
  director.update();
  await settle();

  assert.deepEqual(commands, ['!consume("bread")']);
  const status = director.snapshot();
  const { decision, safetyIncident, ...statusWithoutDecision } = status;
  assert.equal(safetyIncident, null);
  assert.deepEqual({
    ...statusWithoutDecision,
    nextEligibleAt: '<bounded cooldown>',
  }, {
    name: 'survival',
    phase: 'succeeded',
    code: 'skill_consumed',
    target: { name: 'bread' },
    detail: 'Consumed bread.',
    retryable: false,
    nextEligibleAt: '<bounded cooldown>',
  });
  assert.equal(decision.outcomeCode, 'schedule_in_flight');
  assert.equal(decision.gate.inFlight, true);
  assert.equal(Number.isFinite(status.nextEligibleAt), true);
});

test('SurvivalDirector publishes the exact schedule gate and critical intent through canonical state', async () => {
  const agent = createAgent();
  agent.bot.health = 8;
  agent.bot.food = 9;
  agent.isIdle = () => false;
  agent.goal_director = { activeGoal: { id: 'family-iron' } };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: false,
      health: 8,
      hunger: 9,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'critical-health-food-1',
        phase: 'failed',
        code: 'skill_no_food_sources',
        detail: 'No safe food source was found.',
        target: { name: 'safe_food' },
        retryable: true,
      };
    },
  });
  agent.survival_director = director;

  director.nextEligibleAt = Date.now() + 10_000;
  director.update();
  let canonical = getSurvivalDirectorState(agent).decision;
  assert.equal(canonical.gate.allowed, false);
  assert.equal(canonical.gate.code, 'cooldown');
  assert.equal(canonical.outcomeCode, 'schedule_cooldown');
  assert.deepEqual(canonical.situation, {
    health: 8,
    hunger: 9,
    held: false,
    urgentDanger: null,
    idle: false,
  });

  director.nextEligibleAt = 0;
  director.update();
  canonical = getSurvivalDirectorState(agent).decision;
  assert.equal(Object.isFrozen(director.snapshot().decision), true);
  assert.equal(Object.isFrozen(director.snapshot().decision.gate), true);
  assert.equal(canonical.gate.allowed, true);
  assert.deepEqual(canonical.selectedIntent, {
    kind: 'acquire_food',
    reason: 'missing_safe_food',
    preempt: true,
  });
  assert.equal(canonical.durablePlayerWorkActive, true);
  assert.equal(canonical.outcomeCode, 'action_dispatched');
  assert.equal(canonical.scheduled, true);
  await settle();
  assert.deepEqual(commands, ['!prepareFood(1, 24)']);
});

test('SurvivalDirector adopts a released ActionManager result when the command Promise stalls', () => {
  const agent = createAgent();
  agent.bot.health = 6;
  agent.bot.food = 12;
  agent.actions = {
    executing: false,
    currentActionLabel: '',
    currentActivity: null,
    lastActivity: null,
    lastResult: null,
  };
  let dispatches = 0;
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 6,
      hunger: 12,
      urgentDanger: false,
      food: [{ name: 'bread', count: 1, foodPoints: 5, saturation: 6 }],
      healingConsumables: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
    executeCommand: () => {
      dispatches += 1;
      return new Promise(() => {});
    },
  });
  agent.survival_director = director;

  director.update();
  const lease = director.dispatchLease;
  assert.equal(director.inFlight, true);
  assert.equal(lease.activityId, 'eat');
  agent.actions.lastActivity = {
    missionId: lease.missionId,
    activityId: lease.activityId,
    actionId: 'consume-1',
    startedAt: lease.startedAt + 1,
  };
  agent.actions.lastResult = {
    actionId: 'consume-1',
    phase: 'succeeded',
    code: 'skill_consumed',
    detail: 'Consumed bread.',
    target: { name: 'bread' },
    retryable: false,
  };

  director.update();

  assert.equal(dispatches, 1);
  assert.equal(director.inFlight, false);
  assert.equal(director.dispatchLease, null);
  assert.equal(director.snapshot().code, 'skill_consumed');
});

test('Given a critical body and an exact queued gift-food remedy, survival yields pickup and consumption to Agenda', () => {
  const agent = createAgent();
  agent.bot.registry = { foodsByName: { bread: { foodPoints: 5, saturation: 6 } } };
  const pickup = {
    id: 'gift-pickup',
    kind: 'pickup_item',
    target: 'bread',
    requester: 'DadPlayer',
  };
  const consume = {
    id: 'gift-consume',
    kind: 'consume_item',
    target: 'bread',
    requester: 'DadPlayer',
    dependsOnEntryId: pickup.id,
    dependencyPolicy: 'requires_success',
  };
  let active = null;
  let pending = [pickup, consume];
  let carriedFood = [];
  agent.agenda_director = {
    hasUnfinished: () => true,
    activeEntry: () => active,
    pending: () => pending,
  };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 7,
      hunger: 15,
      urgentDanger: false,
      food: carriedFood,
      healingConsumables: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => commands.push(command),
  });

  director.update();
  assert.deepEqual(commands, []);
  assert.equal(director.snapshot().decision.outcomeCode, 'durable_agenda_food_remedy');
  assert.equal(director.blocksLowerPriority(), false);

  active = pickup;
  pending = [consume];
  director.finish({ phase: 'failed', code: 'skill_no_food_sources', retryable: true });
  director.nextEligibleAt = Date.now() + 10_000;
  assert.equal(director.blocksLowerPriority(), false);

  active = consume;
  pending = [];
  carriedFood = [{ name: 'bread', count: 1, foodPoints: 5, saturation: 6 }];
  director.nextEligibleAt = 0;
  director.update();
  assert.deepEqual(commands, []);
  assert.equal(director.snapshot().decision.outcomeCode, 'durable_agenda_food_remedy');
});

test('SurvivalDirector honors a correlated durable-job food upkeep request without critical hunger', async () => {
  const agent = createAgent();
  agent.agenda_director = { hasUnfinished: () => true };
  agent.job_director = { activeOrder: { id: 'family-scout', source: 'player' } };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 15,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'job-food-1',
        phase: 'succeeded',
        code: 'skill_prepared_food',
        detail: 'Prepared a safe food reserve.',
        target: { name: 'safe_food' },
        retryable: false,
      };
    },
  });
  agent.survival_director = director;

  assert.equal(director.requestJobFoodUpkeep({
    workOrderId: 'family-scout',
    requester: 'DadPlayer',
    targetFoodPoints: 24,
  }), true);
  director.update();
  await settle();

  assert.deepEqual(commands, ['!prepareFood(24, 64)']);
  assert.equal(director.snapshot().code, 'skill_prepared_food');
  assert.deepEqual(director.snapshot().decision.jobFoodUpkeep, {
    workOrderId: 'family-scout',
    requester: 'DadPlayer',
    targetFoodPoints: 24,
  });
  assert.equal(Object.isFrozen(director.snapshot().decision.jobFoodUpkeep), true);
});

test('Given critical health and a verified healing potion, SurvivalDirector dispatches semantic healing consumption', async () => {
  const agent = createAgent();
  agent.isIdle = () => false;
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: false,
      health: 4,
      hunger: 20,
      urgentDanger: false,
      healingConsumables: [
        { item: 'healing_potion', effect: 'healing', count: 1, potency: 1 },
      ],
      food: [],
      timeOfDay: 18_000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'survival-heal-1',
        phase: 'succeeded',
        code: 'skill_consumed',
        detail: 'Consumed a healing potion.',
        target: { name: 'healing_potion' },
        retryable: false,
      };
    },
  });

  director.update();
  await settle();

  assert.deepEqual(commands, ['!consume("healing_potion")']);
  assert.equal(director.snapshot().code, 'skill_consumed');
});

test('Given operator hold, SurvivalDirector does not schedule hunger, sleep, or shelter upkeep', async () => {
  const agent = createAgent();
  agent.isOperatorHeld = () => true;
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: true,
      idle: true,
      health: 10,
      hunger: 2,
      urgentDanger: false,
      food: [{ name: 'bread', count: 2, foodPoints: 5, saturation: 6 }],
      timeOfDay: 14000,
      weather: 'Thunderstorm',
    }),
    executeCommand: (_agent, command) => commands.push(command),
  });

  director.update();
  await settle();

  assert.deepEqual(commands, []);
  assert.equal(director.snapshot().phase, 'waiting');
});

test('Given durable player work, routine survival upkeep cannot seize its idle transition gaps', async () => {
  const agent = createAgent();
  agent.agenda_director = { hasUnfinished: () => true };
  agent.job_director = { activeOrder: { id: 'job-player-1', source: 'player', phase: 'recover' } };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 20,
      urgentDanger: false,
      food: [],
      armor: [],
      timeOfDay: 14000,
      dimension: 'overworld',
      weather: 'Clear',
      sheltered: true,
      beds: [{ name: 'red_bed', x: 1, y: 64, z: 1, distance: 2, reachable: true, safe: true }],
    }),
    executeCommand: (_agent, command) => commands.push(command),
  });

  director.update();
  await settle();

  assert.deepEqual(commands, []);
  assert.equal(director.snapshot().phase, 'waiting');
});

test('Given command autonomy, optional drop collection and shelter building stay idle while bodily survival remains available', async () => {
  const agent = createAgent();
  agent.runtime = {
    autonomy: 'command',
    survival: { ...POLICY, usefulDrops: 'collect', shelter: 'emergency' },
  };
  const commands = [];
  const workOrders = [];
  let situation = {
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    urgentDanger: false,
    food: [],
    armor: [],
    usefulDrops: [{ name: 'coal', id: 7, distance: 3 }],
    timeOfDay: 6000,
    weather: 'Clear',
  };
  const director = new SurvivalDirector(agent, {
    getSituation: () => situation,
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'survival-command-policy-1',
        phase: 'succeeded',
        code: 'skill_consumed',
        target: { name: 'bread' },
        retryable: false,
      };
    },
    requestWorkOrder: order => {
      workOrders.push(order);
      return { accepted: true, id: 'unexpected-shelter' };
    },
  });

  director.update();
  await settle();
  assert.deepEqual(commands, []);
  assert.deepEqual(workOrders, []);

  situation = {
    ...situation,
    timeOfDay: 14000,
    dimension: 'overworld',
    weather: 'Clear',
    sheltered: false,
    shelters: [],
  };
  director.update();
  await settle();
  assert.deepEqual(workOrders, [], 'command-only idle must not invent a shelter at ordinary night');

  situation = {
    ...situation,
    hunger: 5,
    food: [{ name: 'bread', count: 2, foodPoints: 5, saturation: 6 }],
  };
  const bodilyDirector = new SurvivalDirector(agent, {
    getSituation: () => situation,
    executeCommand: director.executeCommand,
  });
  bodilyDirector.update();
  await settle();
  assert.deepEqual(commands, ['!consume("bread")']);
});

test('Given an unresolved critical bodily need, SurvivalDirector acquires food and blocks lower-priority jobs', () => {
  const agent = createAgent();
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 9,
      hunger: 3,
      urgentDanger: false,
      food: [],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
  });

  director.update();

  assert.equal(director.snapshot().code, 'acquire_food');
  assert.equal(director.blocksLowerPriority(), true);
});

test('Given a still-critical body, survival settlement cooldowns do not lease it back to player work', () => {
  const agent = createAgent();
  let hunger = 3;
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger,
      urgentDanger: false,
      food: [],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
  });
  director.finish({
    phase: 'interrupted',
    code: 'interrupted',
    detail: 'Critical food acquisition yielded during an ownership handoff.',
    retryable: true,
  });
  director.nextEligibleAt = Date.now() + 10_000;

  assert.equal(director.blocksLowerPriority(), true);

  director.finish({
    phase: 'succeeded',
    code: 'skill_prepared',
    detail: 'One immediately edible item was acquired.',
    retryable: false,
  });
  director.nextEligibleAt = Date.now() + 2_000;

  assert.equal(director.blocksLowerPriority(), true);

  hunger = 12;
  assert.equal(director.blocksLowerPriority(), false);
});

test('Given critical hunger before a typed goal starts, no-source recovery inherits the durable Agenda requester', async () => {
  const agent = createAgent();
  agent.name = 'IronSuiteProof';
  agent.bot.username = 'IronSuiteProof';
  agent.bot.entity.position = { x: 100, y: 68, z: 100 };
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.goal_director = { activeGoal: null };
  agent.agenda_director = {
    activeEntry: () => null,
    pending: () => [{ requester: 'DadPlayer' }],
  };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 3,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      timeOfDay: 6_000,
      dimension: 'overworld',
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = command.startsWith('!prepareFood')
        ? {
            actionId: `critical-hunger-food-${commands.length}`,
            phase: 'failed',
            code: 'skill_no_food_sources',
            target: { name: 'safe_food' },
            retryable: true,
          }
        : {
            actionId: `critical-hunger-return-${commands.length}`,
            phase: 'succeeded',
            code: 'skill_arrived',
            target: { name: 'DadPlayer' },
            retryable: false,
          };
    },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    director.nextEligibleAt = 0;
    director.update();
    await settle();
  }

  assert.deepEqual(commands, [
    '!prepareFood(1, 24)',
    '!goToPlayer("DadPlayer", 3, true)',
  ]);
  assert.equal(director.snapshot().code, 'recovery_food_sources_exhausted');
});

test('food recovery adopts a present non-attacking companion and keeps an interrupted return pending', () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.entity.position = { x: 10, y: 64, z: 10 };
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.companion_context = {
    snapshot: () => ({ presence: 'present', canonicalUsername: 'DadPlayer' }),
  };
  const director = new SurvivalDirector(agent);
  director.foodSourceBlocker = {
    position: { x: 10, y: 64, z: 10 },
    dimension: 'overworld',
    requester: null,
    returnAttempted: false,
    returnSucceeded: false,
    homeAttempted: false,
    homeSucceeded: false,
  };

  const intent = director.foodRecoveryIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 8,
    food: [],
    healingConsumables: [],
  }, POLICY);
  assert.deepEqual(intent, {
    kind: 'return_to_player',
    target: { name: 'DadPlayer' },
    reason: 'food_sources_exhausted_returning_to_requester',
  });

  director.settleFoodRecovery(intent, { phase: 'interrupted', code: 'interrupted' });
  assert.equal(director.foodSourceBlocker.returnAttempted, false);
});

test('food recovery establishes surface access before attempting a distant home route', () => {
  const agent = createAgent();
  agent.bot.entity.position = { x: 10, y: 31, z: 10 };
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.home_state = {
    snapshot: () => ({ home: { x: 400, y: 64, z: 400, dimension: 'overworld' } }),
  };
  const director = new SurvivalDirector(agent, {
    isAtSurface: () => false,
  });
  director.foodSourceBlocker = {
    position: { x: 10, y: 31, z: 10 },
    dimension: 'overworld',
    requester: null,
    returnAttempted: false,
    returnSucceeded: false,
    surfaceAttempted: false,
    surfaceSucceeded: false,
    homeAttempted: false,
    homeSucceeded: false,
  };
  const situation = {
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 8,
    food: [],
    healingConsumables: [],
  };

  const surface = director.foodRecoveryIntent(situation, POLICY);
  assert.deepEqual(surface, {
    kind: 'return_to_surface',
    target: { name: 'usable_surface' },
    reason: 'food_sources_exhausted_returning_to_surface',
  });
  director.settleFoodRecovery(surface, {
    actionId: 'surface-failed',
    phase: 'failed',
    code: 'skill_surface_route_unproven',
  });
  const home = director.foodRecoveryIntent(situation, POLICY);
  assert.equal(home.kind, 'return_home');
  assert.equal(director.foodSourceBlocker.surfaceAttempted, true);
});

test('protective shelter outranks stale food-route memory at critical health', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 6,
      hunger: 12,
      recentDamage: false,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      timeOfDay: 18_000,
      dimension: 'overworld',
      difficulty: 'normal',
      weather: 'Clear',
      sheltered: false,
      shelters: [],
      canShelterInPlace: true,
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      const result = {
        actionId: 'critical-shelter',
        phase: 'succeeded',
        code: 'skill_sheltered',
        retryable: false,
      };
      agent.last_action_result = result;
      return { value: true, result };
    },
  });
  director.foodSourceBlocker = {
    position: { x: 0, y: 64, z: 0 },
    dimension: 'overworld',
    requester: null,
    returnAttempted: true,
    returnSucceeded: false,
    surfaceAttempted: true,
    surfaceSucceeded: false,
    homeAttempted: true,
    homeSucceeded: false,
    huntableFoodSourceSignature: '',
  };

  director.update();
  await settle();

  assert.deepEqual(commands, ['!shelterInPlace']);
  assert.equal(director.snapshot().code, 'skill_sheltered');
});

test('new live passive food evidence releases an exhausted food route exactly once', () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(0, 64, 0);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.bot.entities = {};
  const director = new SurvivalDirector(agent);
  director.captureFoodSourceBlocker({ kind: 'acquire_food' });
  assert.equal(director.foodSourceBlocker.huntableFoodSourceSignature, '');
  agent.bot.entities = {
    44: {
      id: 44,
      name: 'pig',
      position: new Vec3(4, 64, 0),
      metadata: {},
    },
  };

  const released = director.foodRecoveryIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 12,
    food: [],
    healingConsumables: [],
  }, POLICY);

  assert.equal(released, null);
  assert.equal(director.foodSourceBlocker, null);
});

test('exhausted food recovery expands its world question without replaying settled routes', () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(10, 64, 10);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  const director = new SurvivalDirector(agent, { isAtSurface: () => true });
  director.foodSourceBlocker = {
    position: { x: 10, y: 64, z: 10 },
    dimension: 'overworld',
    requester: 'DadPlayer',
    targetFoodPoints: 1,
    searchRadius: 24,
    returnAttempted: true,
    returnSucceeded: false,
    surfaceAttempted: true,
    surfaceSucceeded: true,
    homeAttempted: true,
    homeSucceeded: false,
    huntableFoodSourceSignature: '',
  };
  const situation = {
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 7,
    food: [],
    healingConsumables: [],
  };

  const expanded = director.foodRecoveryIntent(situation, POLICY);
  assert.deepEqual(expanded, {
    kind: 'acquire_food',
    targetFoodPoints: 1,
    searchRadius: 48,
    reason: 'food_search_expanded',
    preempt: true,
  });
  director.settleFoodRecovery(expanded, {
    actionId: 'expanded-food-failed',
    phase: 'failed',
    code: 'skill_no_food_sources',
  });

  assert.equal(director.foodSourceBlocker.searchRadius, 48);
  assert.equal(director.foodSourceBlocker.returnAttempted, true);
  assert.equal(director.foodSourceBlocker.surfaceAttempted, true);
  assert.equal(director.foodSourceBlocker.homeAttempted, true);
  assert.equal(director.foodRecoveryIntent(situation, POLICY).searchRadius, 96);
});

test('a concrete elevated hunt failure forces surface recovery despite generic egress', () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(0, 56, 0);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  const director = new SurvivalDirector(agent, { isAtSurface: () => true });
  director.captureFoodSourceBlocker({
    kind: 'acquire_food',
    targetFoodPoints: 1,
    searchRadius: 24,
  }, {
    code: 'skill_no_food_sources',
    evidence: {
      skill: {
        accessRequirement: {
          kind: 'surface',
          reason: 'elevated_hunt_target_outside_returnable_pursuit',
        },
      },
    },
  });

  const recovery = director.foodRecoveryIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 7,
    food: [],
    healingConsumables: [],
  }, POLICY);

  assert.equal(recovery.kind, 'return_to_surface');
  assert.equal(director.foodSourceBlocker.surfaceAccessRequired, true);
});

test('exact source-access result routes through Survival instead of becoming generic exhaustion', () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(765, 62, -790);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  const director = new SurvivalDirector(agent, { isAtSurface: () => false });

  director.settleFoodRecovery({
    kind: 'acquire_food',
    targetFoodPoints: 1,
    searchRadius: 128,
  }, {
    actionId: 'crop-access-result',
    phase: 'failed',
    code: 'skill_source_access_required',
    evidence: {
      skill: {
        accessRequirement: {
          kind: 'food_region',
          reason: 'loaded_food_crop_region_unreached',
          target: { name: 'potatoes', x: 770, y: 67, z: -792 },
        },
      },
    },
  });

  assert.equal(director.foodSourceBlocker.surfaceAccessRequired, true);
  assert.equal(director.foodRecoveryIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 0,
    food: [],
    healingConsumables: [],
  }, POLICY).kind, 'return_to_surface');
});

test('restored food access is a single-use continuation rather than a retry loop', () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(765, 67, -790);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  const director = new SurvivalDirector(agent, { isAtSurface: () => true });
  director.foodSourceBlocker = {
    position: { x: 765, y: 62, z: -790 },
    dimension: 'overworld',
    requester: null,
    targetFoodPoints: 1,
    searchRadius: 128,
    returnAttempted: true,
    returnSucceeded: false,
    surfaceAttempted: true,
    surfaceSucceeded: true,
    surfaceAccessRequired: true,
    surfaceAccessResolved: true,
    homeAttempted: true,
    homeSucceeded: false,
    huntableFoodSourceSignature: '',
  };

  director.settleFoodRecovery({
    kind: 'acquire_food',
    reason: 'food_access_restored',
    targetFoodPoints: 1,
    searchRadius: 128,
  }, {
    actionId: 'restored-crop-access-failed',
    phase: 'failed',
    code: 'skill_source_access_required',
    evidence: {
      skill: {
        accessRequirement: {
          kind: 'food_region',
          target: { name: 'potatoes', x: 770, y: 67, z: -792 },
        },
      },
    },
  });

  assert.equal(director.foodSourceBlocker.surfaceAttempted, true);
  assert.equal(director.foodSourceBlocker.surfaceAccessResolved, false);
  assert.equal(director.foodRecoveryIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 0,
    food: [],
    healingConsumables: [],
  }, POLICY).kind, 'wait');
});

test('concrete food access reopens one open-surface recovery after generic surface success', () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(12, 62, -4);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  const director = new SurvivalDirector(agent, { isAtSurface: () => true });
  director.foodSourceBlocker = {
    position: { x: 12, y: 62, z: -4 },
    dimension: 'overworld',
    requester: null,
    targetFoodPoints: 1,
    searchRadius: 48,
    returnAttempted: true,
    returnSucceeded: false,
    surfaceAttempted: true,
    surfaceSucceeded: true,
    homeAttempted: true,
    homeSucceeded: false,
    surfaceAccessRequired: false,
    huntableFoodSourceSignature: '',
  };

  director.captureFoodSourceBlocker({
    kind: 'acquire_food',
    targetFoodPoints: 1,
    searchRadius: 96,
    reason: 'food_search_expanded',
  }, {
    code: 'skill_no_food_sources',
    evidence: {
      skill: {
        accessRequirement: {
          kind: 'surface',
          reason: 'loaded_food_crop_outside_open_surface_access',
        },
      },
    },
  });

  assert.equal(director.foodSourceBlocker.surfaceAttempted, false);
  assert.equal(director.foodSourceBlocker.surfaceSucceeded, false);
  assert.equal(director.foodSourceBlocker.surfaceAccessRequired, true);
  assert.equal(director.foodRecoveryIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 0,
    food: [],
    healingConsumables: [],
  }, POLICY).kind, 'return_to_surface');
});

test('restored open-surface food access continues before generic critical shelter', async () => {
  const agent = createAgent();
  agent.bot.entity.position = new Vec3(20, 65, -8);
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.bot.entities = {};
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 6,
      hunger: 0,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      timeOfDay: 6_000,
      weather: 'Clear',
      sheltered: false,
      shelters: [],
      canShelterInPlace: true,
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      const result = {
        actionId: 'food-after-open-surface',
        phase: 'succeeded',
        code: 'skill_food_prepared',
        retryable: false,
      };
      return { value: true, result };
    },
  });
  director.foodSourceBlocker = {
    position: { x: 20, y: 59, z: -8 },
    dimension: 'overworld',
    requester: null,
    targetFoodPoints: 1,
    searchRadius: 48,
    returnAttempted: true,
    returnSucceeded: false,
    surfaceAttempted: true,
    surfaceSucceeded: true,
    surfaceAccessRequired: true,
    surfaceAccessResolved: true,
    homeAttempted: false,
    homeSucceeded: false,
    huntableFoodSourceSignature: '',
  };

  director.update();
  await settle();

  assert.deepEqual(commands, ['!prepareFood(1, 48)']);
  assert.equal(director.snapshot().code, 'skill_food_prepared');
});

test('food recovery never selects a companion who caused the fresh damage as safety', () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.entity.position = { x: 10, y: 64, z: 10 };
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.bot.lastDamageSource = {
    matchesSelf: true,
    kind: 'requester_player',
    observedAt: Date.now(),
  };
  agent.companion_context = {
    snapshot: () => ({ presence: 'present', canonicalUsername: 'DadPlayer' }),
  };
  const director = new SurvivalDirector(agent);

  director.captureFoodSourceBlocker({ kind: 'acquire_food' });

  assert.equal(director.foodSourceBlocker.requester, null);
});

test('terminal food recovery permits eye contact without releasing unsafe autonomous work', () => {
  const agent = createAgent();
  const director = new SurvivalDirector(agent);
  director.finish({
    phase: 'waiting',
    code: 'recovery_food_sources_exhausted',
    retryable: true,
  });

  assert.equal(director.permitsIdleEmbodiment(), true);
  assert.equal(director.blocksLowerPriority(), false, 'noncritical fixture does not seize lower work');
  agent.bot.health = 6;
  agent.bot.food = 8;
  director.getSituation = () => ({ health: 6, hunger: 8 });
  assert.equal(director.blocksLowerPriority(), true);
  assert.equal(director.permitsIdleEmbodiment(), true);
});

test('a tactical retreat remains an unresolved survival incident until Kevin reaches a non-attacking companion', async () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.health = 6;
  agent.bot.food = 20;
  agent.bot.entity.position = new Vec3(0, 64, 0);
  agent.bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' });
  agent.bot.entities = {
    44: { id: 44, name: 'skeleton', position: new Vec3(18, 64, 0) },
  };
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.companion_context = {
    snapshot: () => ({
      presence: 'present',
      canonicalUsername: 'DadPlayer',
      position: { x: 30, y: 64, z: 0 },
    }),
  };
  agent.behavior_arbiter = { wake() {} };
  agent.openChat = () => {};
  const commands = [];
  let attempt = 0;
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 6,
      hunger: 20,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      shelters: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      attempt += 1;
      const result = attempt === 1
        ? {
            actionId: 'safety-return-1',
            phase: 'interrupted',
            code: 'interrupted',
            retryable: true,
          }
        : {
            actionId: 'safety-return-2',
            phase: 'succeeded',
            code: 'skill_arrived',
            target: { name: 'DadPlayer' },
            retryable: false,
          };
      agent.last_action_result = result;
      return { value: true, result };
    },
  });
  agent.survival_director = director;
  const damageReceipt = {
    matchesSelf: true,
    kind: 'hostile',
    source: { id: 44, name: 'skeleton', type: 'mob' },
    observedAt: Date.now(),
  };
  agent.bot.lastDamageSource = damageReceipt;

  director.observeDamageSource(damageReceipt);
  director.observeActionResult({
    actionId: 'reflex-1',
    label: 'mode:self_preservation',
    phase: 'succeeded',
    code: 'skill_retreated',
    finishedAt: Date.now(),
    evidence: { skill: { kind: 'tactical_combat', outcome: 'retreated' } },
  });

  assert.equal(director.snapshot().safetyIncident.active, true);
  assert.equal(director.snapshot().safetyIncident.stage, 'disengaged');
  assert.equal(director.blocksLowerPriority(), true);
  assert.deepEqual(getSurvivalDirectorState(agent).safetyIncident.source, {
    kind: 'hostile',
    id: 44,
    name: 'skeleton',
    username: null,
  });

  director.update();
  await settle();
  assert.equal(director.snapshot().safetyIncident.active, true, 'preemption is censored');

  director.nextEligibleAt = 0;
  director.update();
  await settle();

  assert.deepEqual(commands, [
    '!goToPlayer("DadPlayer", 3, true)',
    '!goToPlayer("DadPlayer", 3, true)',
  ]);
  assert.equal(director.snapshot().safetyIncident.active, false);
  assert.equal(director.snapshot().safetyIncident.resolutionCode, 'safety_rendezvous_reached');
});

test('a future Agenda rendezvous cannot release an active Safety incident to unrelated player work', async () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.health = 6;
  agent.bot.food = 20;
  agent.bot.entity.position = { x: 0, y: 64, z: 0 };
  agent.bot.entities = {};
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.goal_director = { activeGoal: { id: 'goal-mining', requester: 'DadPlayer' } };
  agent.agenda_director = {
    activeEntry: () => ({ id: 'mine-now', kind: 'inventory_checklist', requester: 'DadPlayer' }),
    pending: () => [{ id: 'goto-later', kind: 'goto', requester: 'DadPlayer' }],
  };
  agent.companion_context = {
    snapshot: () => ({
      presence: 'present',
      canonicalUsername: 'DadPlayer',
      position: { x: 30, y: 64, z: 0 },
    }),
  };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 6,
      hunger: 20,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      shelters: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'safety-return',
        phase: 'interrupted',
        code: 'interrupted',
        retryable: true,
      };
    },
  });
  director.safetyIncident = {
    id: 'safety-agenda-gate',
    active: true,
    stage: 'disengaged',
    source: { kind: 'hostile', id: 44, name: 'drowned', username: null },
    openedAt: Date.now(),
    lastDamageAt: Date.now(),
  };

  assert.equal(director.blocksLowerPriority(), true);
  director.update();
  await settle();

  assert.deepEqual(commands, ['!goToPlayer("DadPlayer", 3, true)']);
  assert.equal(director.snapshot().safetyIncident.active, true);
});

test('Safety carries an authoritative offline-helper failure across death until presence returns', () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.health = 6;
  agent.bot.food = 20;
  agent.bot.entity.position = { x: 0, y: 64, z: 0 };
  agent.bot.entities = {};
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.goal_director = { activeGoal: { id: 'goal-mining', requester: 'DirectorOps' } };
  let presence = 'absent';
  let playerPosition = null;
  agent.companion_context = {
    snapshot: () => ({
      presence,
      canonicalUsername: 'DirectorOps',
      position: playerPosition,
    }),
  };
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    wake: () => {},
  };
  const director = new SurvivalDirector(agent);
  director.observeSafetySource({
    kind: 'hostile',
    id: 45,
    name: 'skeleton',
    observedAt: Date.now(),
  });
  director.replaceSafetyIncident({ stage: 'disengaged' });

  const situation = {
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 20,
    shelters: [],
    canShelterInPlace: true,
    shelterInPlaceStances: [],
    food: [],
    healingConsumables: [],
  };
  const firstIntent = director.safetyIncidentIntent(situation);

  assert.equal(firstIntent.kind, 'return_to_player');
  director.settleSafetyIncident(firstIntent, {
    actionId: 'offline-helper',
    phase: 'failed',
    code: 'skill_target_offline',
    retryable: false,
  });
  director.reconcileDeath();
  director.observeSafetySource({
    kind: 'hostile',
    id: 46,
    name: 'zombie',
    observedAt: Date.now() + 1,
  });
  director.replaceSafetyIncident({ stage: 'disengaged' });

  const afterDeathIntent = director.safetyIncidentIntent(situation);
  assert.equal(afterDeathIntent.kind, 'shelter_in_place');
  assert.equal(afterDeathIntent.incidentId, director.safetyIncident.id);

  presence = 'present';
  playerPosition = { x: 30, y: 64, z: 0 };
  const restoredIntent = director.safetyIncidentIntent(situation);

  assert.equal(restoredIntent.kind, 'return_to_player');
  assert.equal(restoredIntent.target.name, 'DirectorOps');
});

test('a player-caused hit waits for clarification and a fresh explicit order resolves it', () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.health = 7;
  agent.bot.food = 20;
  agent.bot.entity.position = { x: 0, y: 64, z: 0 };
  agent.bot.entities = {};
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.companion_context = {
    snapshot: () => ({
      presence: 'present',
      canonicalUsername: 'DadPlayer',
      position: { x: 10, y: 64, z: 0 },
    }),
  };
  const messages = [];
  agent.openChat = message => messages.push(message);
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 7,
      hunger: 20,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      shelters: [],
      timeOfDay: 6_000,
      weather: 'Clear',
    }),
  });
  const receipt = {
    matchesSelf: true,
    kind: 'requester_player',
    source: { id: 8, username: 'DadPlayer', type: 'player' },
    observedAt: Date.now(),
  };

  director.observeDamageSource(receipt);
  director.update();

  assert.equal(director.snapshot().code, 'safety_waiting_for_intent_clarification');
  assert.equal(director.permitsIdleEmbodiment(), true);
  assert.equal(director.blocksLowerPriority(), true);
  assert.equal(messages.length, 1);

  assert.equal(director.observePlayerOrder('DadPlayer', 'goToPlayer'), true);
  assert.equal(director.snapshot().safetyIncident.active, false);
  assert.equal(director.snapshot().safetyIncident.resolutionCode, 'player_intent_clarified');
});

test('an attributed live hostile opens the safety incident before tactical execution and rejects identity drift', () => {
  const agent = createAgent();
  const threat = {
    id: 442,
    uuid: 'skeleton-442',
    name: 'skeleton',
    type: 'hostile',
    position: { x: 3, y: 64, z: 0 },
  };
  agent.bot.health = 7;
  agent.bot.entity.position = { x: 0, y: 64, z: 0 };
  agent.bot.entities = { [threat.id]: threat };
  const wakes = [];
  const suspensions = [];
  const releases = [];
  agent.behavior_arbiter = {
    wake: reason => wakes.push(reason),
    beginSafetySuspension: incident => suspensions.push(incident.id),
    releaseSafetySuspension: (incident, code) => releases.push({ id: incident.id, code }),
  };
  const director = new SurvivalDirector(agent);

  assert.equal(director.observeAttributedThreat({
    entityId: threat.id,
    entityUuid: threat.uuid,
    name: threat.name,
    attribution: 'self_damage',
  }), true);
  const incident = director.snapshot().safetyIncident;
  assert.equal(incident.active, true);
  assert.equal(incident.stage, 'threat_response');
  assert.deepEqual({
    kind: incident.source.kind,
    id: incident.source.id,
    name: incident.source.name,
    username: incident.source.username,
    type: incident.source.type,
  }, {
    kind: 'hostile',
    id: threat.id,
    name: threat.name,
    username: null,
    type: 'hostile',
  });
  assert.equal(Number.isFinite(incident.source.observedAt), true);
  assert.deepEqual(wakes, ['survival_incident_observed']);
  assert.deepEqual(suspensions, [incident.id]);

  assert.equal(director.observeAttributedThreat({
    entityId: threat.id,
    entityUuid: 'replacement-entity',
    name: threat.name,
    attribution: 'self_damage',
  }), false);
  assert.equal(director.snapshot().safetyIncident, incident, 'identity drift cannot mutate the incident');

  delete agent.bot.entities[threat.id];
  assert.equal(director.observeAttributedThreat({
    entityId: threat.id,
    entityUuid: threat.uuid,
    name: threat.name,
    attribution: 'self_damage',
  }), false, 'an unloaded threat cannot create tactical authority');

  assert.equal(director.closeSafetyIncident({
    phase: 'succeeded',
    code: 'threat_destroyed',
    detail: 'The hostile is gone.',
  }), true);
  assert.deepEqual(releases, [{ id: incident.id, code: 'threat_destroyed' }]);
});

test('a settled failed help route is not retried unchanged and unproven cover is rejected', async () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.health = 6;
  agent.bot.food = 20;
  agent.bot.entity.position = new Vec3(0, 64, 0);
  agent.bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' });
  agent.bot.entities = {
    45: { id: 45, name: 'skeleton', position: new Vec3(12, 64, 0) },
  };
  agent.companion_context = {
    snapshot: () => ({
      presence: 'present',
      canonicalUsername: 'DadPlayer',
      position: { x: 30, y: 64, z: 0 },
    }),
  };
  agent.openChat = () => {};
  const commands = [];
  const situation = {
    held: false,
    idle: true,
    health: 6,
    hunger: 20,
    urgentDanger: false,
    food: [],
    healingConsumables: [],
    shelters: [{
      name: 'roof_only_guess',
      x: 4,
      y: 64,
      z: 4,
      distance: 6,
      reachable: true,
      safe: true,
    }],
    timeOfDay: 6_000,
    weather: 'Clear',
  };
  const director = new SurvivalDirector(agent, {
    getSituation: () => situation,
    executeCommand: (_agent, command) => {
      commands.push(command);
      const result = {
        actionId: 'failed-help-route',
        phase: 'failed',
        code: 'skill_unreachable',
        retryable: true,
      };
      agent.last_action_result = result;
      return { value: true, result };
    },
  });
  const receipt = {
    matchesSelf: true,
    kind: 'hostile',
    source: { id: 45, name: 'skeleton', type: 'mob' },
    observedAt: Date.now(),
  };

  director.observeDamageSource(receipt);
  director.update();
  await settle();
  director.nextEligibleAt = 0;
  director.update();

  assert.deepEqual(commands, ['!goToPlayer("DadPlayer", 3, true)']);
  assert.equal(director.snapshot().code, 'safety_cover_unavailable');
  assert.equal(director.snapshot().safetyIncident.active, true);

  situation.shelters = [{
    name: 'verified_cover',
    x: 5,
    y: 64,
    z: 5,
    distance: 7,
    reachable: true,
    safe: true,
    pathStatus: 'success',
    coverStatus: 'blocked_threat_line_of_sight',
  }];
  assert.equal(director.safetyIncidentIntent(situation).kind, 'seek_shelter');
});

test('stable sealed containment releases suspended work while guarding loaded threats', () => {
  const agent = createAgent();
  const releases = [];
  let now = 10_000;
  agent.bot.health = 6;
  agent.bot.food = 8;
  agent.bot.entity.position = new Vec3(0, 64, 0);
  agent.bot.entity.eyeHeight = 1.62;
  agent.bot.entities = {
    47: {
      id: 47,
      uuid: 'persistent-spider',
      name: 'spider',
      position: new Vec3(8, 64, 0),
      height: 0.9,
    },
    48: {
      id: 48,
      uuid: 'persistent-zombie',
      name: 'zombie',
      position: new Vec3(-8, 64, 0),
      height: 1.8,
    },
  };
  agent.bot.blockAt = position => {
    const enclosed = (
      (position.x === 0 && position.z === 0 && position.y === 66)
      || (
        Math.abs(position.x) + Math.abs(position.z) === 1
        && [64, 65].includes(position.y)
      )
      || (position.x === 0 && position.z === 0 && position.y === 63)
    );
    return {
      name: enclosed ? 'stone' : 'air',
      boundingBox: enclosed ? 'block' : 'empty',
      position,
    };
  };
  agent.bot.world = { raycast: () => ({ name: 'stone' }) };
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    releaseSafetySuspension: (incident, code) => releases.push({ id: incident.id, code }),
    wake: () => {},
  };
  const director = new SurvivalDirector(agent, { now: () => now });
  director.observeDamageSource({
    matchesSelf: true,
    kind: 'hostile',
    source: { id: 47, name: 'spider', type: 'mob' },
    observedAt: now,
  });
  const incidentId = director.snapshot().safetyIncident.id;
  director.observeSafetySource({
    kind: 'hostile',
    id: 48,
    name: 'zombie',
    observedAt: now + 1,
  });

  assert.equal(director.settleSafetyIncident({
    kind: 'seek_shelter',
    incidentId,
    target: { x: 0, y: 64, z: 0 },
  }, {
    phase: 'succeeded',
    code: 'skill_arrived',
  }), false);
  assert.equal(director.snapshot().safetyIncident.stage, 'under_cover');

  const contained = director.safetyIncidentIntent({
    held: false,
    urgentDanger: false,
    shelters: [],
    food: [],
    healingConsumables: [],
  });
  assert.equal(contained.kind, 'wait');
  assert.equal(contained.reason, 'safety_containment_stabilizing');
  assert.equal(director.snapshot().safetyIncident.active, true);
  assert.deepEqual(releases, []);

  now += 2_001;
  assert.equal(director.safetyIncidentIntent({
    held: false,
    urgentDanger: false,
    shelters: [],
    food: [],
    healingConsumables: [],
  }), null);
  assert.equal(director.safetyIncident, null);
  assert.equal(director.snapshot().containedThreatGuard.incidentId, incidentId);
  assert.deepEqual(director.snapshot().containedThreatGuard.sources.map(source => source.id), [47, 48]);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[47]), true);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[48]), true);
  assert.deepEqual(releases, [{ id: incidentId, code: 'safety_structurally_contained' }]);
});

test('stable no-line-of-sight disengagement resumes work and guards every loaded source', () => {
  const agent = createAgent();
  const releases = [];
  let now = 10_000;
  agent.bot.entity.position = new Vec3(0, 52, 0);
  agent.bot.entity.eyeHeight = 1.62;
  agent.bot.entities = {
    51: {
      id: 51,
      uuid: 'distant-zombie',
      name: 'zombie',
      position: new Vec3(0, 52, 6),
      height: 1.8,
    },
    52: {
      id: 52,
      uuid: 'distant-skeleton',
      name: 'skeleton',
      position: new Vec3(8, 52, 0),
      height: 1.8,
    },
    53: {
      id: 53,
      uuid: 'new-creeper-during-recovery',
      name: 'creeper',
      position: new Vec3(-18, 50, 0),
      height: 1.7,
    },
  };
  agent.bot.blockAt = position => ({
    name: 'air',
    boundingBox: 'empty',
    position,
  });
  agent.bot.world = { raycast: () => ({ name: 'stone' }) };
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    releaseSafetySuspension: (incident, code) => releases.push({ id: incident.id, code }),
    wake: () => {},
  };
  const director = new SurvivalDirector(agent, { now: () => now });
  director.observeDamageSource({
    matchesSelf: true,
    kind: 'hostile',
    source: { id: 51, name: 'zombie', type: 'mob' },
    observedAt: now,
  });
  const incidentId = director.snapshot().safetyIncident.id;
  director.observeSafetySource({
    kind: 'hostile',
    id: 52,
    name: 'skeleton',
    observedAt: now + 1,
  });
  director.replaceSafetyIncident({ stage: 'response_blocked' });
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[51]), true);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[52]), true);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[53]), true);
  assert.deepEqual(director.snapshot().safetyIncident.sources.map(source => source.id), [51, 52, 53]);

  now += 5_000;
  const stabilizing = director.safetyIncidentIntent({
    held: false,
    urgentDanger: false,
    shelters: [],
    food: [],
    healingConsumables: [],
  });
  assert.equal(stabilizing.kind, 'wait');
  assert.equal(stabilizing.reason, 'safety_disengagement_stabilizing');

  now += 2_001;
  assert.equal(director.safetyIncidentIntent({
    held: false,
    urgentDanger: false,
    shelters: [],
    food: [],
    healingConsumables: [],
  }), null);
  assert.equal(director.safetyIncident, null);
  assert.equal(director.snapshot().containedThreatGuard.kind, 'stable_disengagement');
  assert.deepEqual(director.snapshot().containedThreatGuard.sources.map(source => source.id), [51, 52, 53]);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[51]), true);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[52]), true);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[53]), true);
  assert.deepEqual(releases, [{ id: incidentId, code: 'safety_stably_disengaged' }]);

  agent.bot.entities[52].position = new Vec3(5, 52, 0);
  assert.equal(director.ownsSafetyRecoveryForThreat(agent.bot.entities[52]), false);
  assert.equal(director.snapshot().containedThreatGuard, null);
});

test('a critical body escalates from one settled retreat to owned shelter recovery across attackers', () => {
  const agent = createAgent();
  agent.bot.health = 6;
  agent.bot.entities = {};
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    wake: () => {},
  };
  let shelterAssessments = 0;
  const director = new SurvivalDirector(agent, {
    assessDefensiveShelter: () => {
      shelterAssessments += 1;
      return { feasible: true, code: 'ready' };
    },
  });
  director.observeDamageSource({
    matchesSelf: true,
    kind: 'hostile',
    source: { id: 50, name: 'spider', type: 'mob' },
    observedAt: Date.now(),
  });
  director.replaceSafetyIncident({ stage: 'disengaged' });

  assert.equal(director.ownsSafetyRecoveryForThreat({ id: 51, name: 'zombie' }), true);
  assert.equal(shelterAssessments, 0);
  agent.bot.health = 12;
  assert.equal(director.ownsSafetyRecoveryForThreat({ id: 52, name: 'creeper' }), true);
  assert.equal(director.ownsSafetyRecoveryForThreat({ id: 50, name: 'spider' }), true);
  director.replaceSafetyIncident({ stage: 'under_cover' });
  assert.equal(
    director.ownsSafetyRecoveryForThreat({ id: 53, name: 'skeleton' }),
    true,
    'a verified refuge excludes every combat reflex, not just its first attacker',
  );
});

test('one Safety episode preserves failed recovery state across multiple attackers', () => {
  const agent = createAgent();
  agent.bot.health = 6;
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    wake: () => {},
  };
  const director = new SurvivalDirector(agent);
  director.observeSafetySource({
    kind: 'hostile',
    id: 60,
    name: 'spider',
    observedAt: Date.now(),
  });
  const episodeId = director.snapshot().safetyIncident.id;
  director.replaceSafetyIncident({
    stage: 'recovery_blocked',
    failedPlayerTarget: 'DirectorOps',
  });

  director.observeSafetySource({
    kind: 'hostile',
    id: 61,
    name: 'zombie',
    observedAt: Date.now() + 1,
  });
  const episode = director.snapshot().safetyIncident;
  assert.equal(episode.id, episodeId);
  assert.equal(episode.stage, 'threat_response');
  assert.equal(episode.source.id, 61);
  assert.deepEqual(episode.sources.map(source => source.id), [60, 61]);
  assert.equal(episode.encounterCount, 2);
  assert.equal(episode.failedPlayerTarget, 'DirectorOps');
});

test('an active Safety episode keeps refuge recovery eligible after recent-damage time expires', () => {
  const position = new Vec3(0, 64, 0);
  const cobblestone = { name: 'cobblestone', count: 8 };
  const bot = {
    entity: { position, onGround: true },
    health: 6,
    food: 0,
    lastDamageTime: Date.now() - 10_000,
    game: { dimension: 'minecraft:overworld', difficulty: 'normal' },
    time: { timeOfDay: 6_000 },
    rainState: 0,
    thunderState: 0,
    entities: {},
    inventory: {
      slots: [cobblestone],
      items: () => [cobblestone],
      findInventoryItem: name => name === 'cobblestone' ? cobblestone : null,
    },
    registry: { foodsByName: {} },
    modes: { getStatus: () => [] },
    findBlocks: () => [],
    nearestEntity: () => null,
    blockAt(target) {
      const at = target.floored ? target.floored() : target;
      return {
        name: at.y <= 63 ? 'stone' : 'air',
        boundingBox: at.y <= 63 ? 'block' : 'empty',
        position: at,
      };
    },
  };
  const agent = {
    bot,
    runtime: { survival: POLICY },
    survival_director: { safetyIncident: { active: true } },
    isIdle: () => true,
    isOperatorHeld: () => false,
  };

  const situation = summarizeSurvivalSituation(agent);
  assert.equal(situation.recentDamage, false);
  assert.equal(situation.shelterInPlaceFeasibility.code, 'ready');
  assert.equal(situation.canShelterInPlace, true);
});

test('Safety relocates to a sealable stance instead of waiting on the current cell', () => {
  const agent = createAgent();
  agent.bot.health = 6;
  agent.bot.entities = {};
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    wake: () => {},
  };
  const director = new SurvivalDirector(agent);
  director.observeSafetySource({
    kind: 'hostile',
    id: 70,
    name: 'creeper',
    observedAt: Date.now(),
  });
  director.replaceSafetyIncident({
    stage: 'disengaged',
    failedPlayerTarget: 'DirectorOps',
  });

  const intent = director.safetyIncidentIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 0,
    shelters: [],
    shelterInPlaceStances: [{ x: 8, y: 64, z: 2, distance: 8.2 }],
    food: [],
    healingConsumables: [],
  });
  assert.equal(intent.kind, 'relocate_for_shelter');
  assert.deepEqual(intent.target, { x: 8, y: 64, z: 2, distance: 8.2 });
});

test('Safety seals a ready current cell before exposed food acquisition', () => {
  const agent = createAgent();
  agent.bot.health = 6;
  agent.bot.entities = {};
  agent.behavior_arbiter = {
    beginSafetySuspension: () => {},
    wake: () => {},
  };
  const director = new SurvivalDirector(agent);
  director.observeSafetySource({
    kind: 'hostile',
    id: 71,
    name: 'spider',
    observedAt: Date.now(),
  });
  director.replaceSafetyIncident({ stage: 'disengaged' });

  const intent = director.safetyIncidentIntent({
    held: false,
    urgentDanger: false,
    health: 6,
    hunger: 0,
    shelters: [],
    canShelterInPlace: true,
    shelterInPlaceStances: [],
    food: [],
    healingConsumables: [],
  });
  assert.equal(intent.kind, 'shelter_in_place');
  assert.equal(intent.reason, 'survival_incident_seal_ready');
});

test('a blocked safety incident consumes carried emergency food instead of starving behind help-unavailable', async () => {
  const agent = createAgent();
  agent.name = 'Kevin';
  agent.bot.username = 'Kevin';
  agent.bot.health = 1;
  agent.bot.food = 0;
  agent.bot.entity.position = new Vec3(0, 64, 0);
  agent.bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' });
  agent.bot.entities = {
    46: { id: 46, name: 'zombie', position: new Vec3(20, 64, 0) },
  };
  agent.companion_context = { snapshot: () => ({ presence: 'absent' }) };
  agent.openChat = () => {};
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 1,
      hunger: 0,
      urgentDanger: false,
      food: [{ name: 'rotten_flesh', count: 4, foodPoints: 4, saturation: 0.8 }],
      healingConsumables: [],
      shelters: [],
      canShelterInPlace: false,
      timeOfDay: 18_000,
      difficulty: 'normal',
      weather: 'Rain',
      sheltered: false,
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      const result = {
        actionId: 'incident-food-1',
        phase: 'succeeded',
        code: 'skill_consumed',
        target: { name: 'rotten_flesh' },
        retryable: false,
      };
      agent.last_action_result = result;
      return { value: true, result };
    },
  });
  agent.survival_director = director;
  const receipt = {
    matchesSelf: true,
    kind: 'hostile',
    source: { id: 46, name: 'zombie', type: 'mob' },
    observedAt: Date.now(),
  };

  director.observeDamageSource(receipt);
  director.update();
  await settle();

  assert.deepEqual(commands, ['!consume("rotten_flesh")']);
  assert.equal(director.snapshot().code, 'skill_consumed');
  assert.equal(director.snapshot().safetyIncident.active, true);
});

test('Given exhausted food sources and a failed requester return, survival routes once to remembered home', async () => {
  const agent = createAgent();
  agent.name = 'IronSuiteProof';
  agent.bot.username = 'IronSuiteProof';
  agent.bot.entity.position = { x: 100, y: 58, z: 100 };
  agent.bot.game = { dimension: 'minecraft:overworld' };
  agent.goal_director = { activeGoal: { requester: 'DadPlayer' } };
  agent.home_state = {
    snapshot: () => ({
      home: { x: 80, y: 64, z: 80, dimension: 'overworld' },
    }),
  };
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 3,
      hunger: 16,
      urgentDanger: false,
      food: [],
      healingConsumables: [],
      timeOfDay: 18_000,
      dimension: 'overworld',
      weather: 'Clear',
      sheltered: true,
      shelters: [],
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = command.startsWith('!prepareFood')
        ? {
            actionId: `survival-food-${commands.length}`,
            phase: 'failed',
            code: 'skill_no_food_sources',
            target: { name: 'safe_food' },
            retryable: true,
          }
        : command.startsWith('!goToPlayer')
          ? {
            actionId: `survival-return-${commands.length}`,
            phase: 'failed',
            code: 'skill_path_not_found',
            target: { name: 'DadPlayer' },
            retryable: true,
          }
          : {
            actionId: `survival-home-${commands.length}`,
            phase: 'succeeded',
            code: 'skill_arrived',
            target: { name: 'remembered_home', x: 80, y: 64, z: 80 },
            retryable: false,
          };
    },
  });

  director.update();
  await settle();
  director.nextEligibleAt = 0;
  director.update();
  await settle();
  director.nextEligibleAt = 0;
  director.update();
  await settle();

  assert.deepEqual(commands, [
    '!prepareFood(1, 24)',
    '!goToPlayer("DadPlayer", 3, true)',
    '!goToCoordinates(80, 64, 80, 2, true)',
  ]);
  assert.equal(director.snapshot().phase, 'succeeded');
  assert.equal(director.snapshot().code, 'skill_arrived');
  assert.equal(director.blocksLowerPriority(), true);
});

test('Given live inventory and cover, survival situation reports armor upgrades and verified shelter state', () => {
  const leatherBoots = { name: 'leather_boots', count: 1 };
  const ironBoots = { name: 'iron_boots', count: 1 };
  const slots = Array(9).fill(null);
  slots[8] = leatherBoots;
  const origin = {
    x: 0,
    y: 64,
    z: 0,
    distanceTo(other) {
      return Math.hypot(other.x, other.y - 64, other.z);
    },
  };
  const situation = summarizeSurvivalSituation({
    bot: {
      entity: { position: origin },
      health: 20,
      food: 20,
      lastDamageTime: 0,
      inventory: { slots, items: () => [ironBoots] },
      registry: { foodsByName: {} },
      modes: { getStatus: () => [] },
      time: { timeOfDay: 6000 },
      game: { dimension: 'minecraft:overworld', difficulty: 'peaceful' },
      rainState: 0,
      thunderState: 0,
      findBlocks: () => [],
      blockAt(position) {
        return position.y === 66
          ? { name: 'stone', boundingBox: 'block', position }
          : { name: 'air', boundingBox: 'empty', position };
      },
      nearestEntity: () => null,
    },
    isOperatorHeld: () => false,
    isIdle: () => true,
  });

  assert.deepEqual(situation.armor, [
    {
      name: 'leather_boots',
      slot: 'feet',
      score: 1,
      durabilityRemaining: null,
      durabilityMax: null,
      worn: false,
      equipped: true,
    },
    {
      name: 'iron_boots',
      slot: 'feet',
      score: 4,
      durabilityRemaining: null,
      durabilityMax: null,
      worn: false,
      equipped: false,
    },
  ]);
  assert.equal(situation.sheltered, true);
  assert.equal(situation.difficulty, 'peaceful');
});

test('Given a bed inside 24 blocks but outside Mineflayer\'s narrow section envelope, survival selection retains it', () => {
  const origin = new Vec3(-368.5, 70, -166.69);
  const blocks = new Map();
  const addBed = (x, y, z, part, occupied = false) => {
    const block = {
      name: 'orange_bed',
      boundingBox: 'block',
      position: new Vec3(x, y, z),
      part,
      occupied,
    };
    blocks.set(`${x}:${y}:${z}`, block);
    return block.position;
  };
  const locations = [
    addBed(-370, 70, -162, 'foot', true),
    addBed(-371, 70, -162, 'head', true),
    addBed(-370, 70, -169, 'foot', true),
    addBed(-371, 70, -169, 'head', true),
    addBed(-351, 71, -159, 'foot'),
    addBed(-352, 71, -159, 'head'),
    addBed(-340, 70, -166, 'foot'),
    addBed(-341, 70, -166, 'head'),
  ];
  let searchOptions = null;
  const bot = {
    entity: { position: origin },
    entities: {},
    health: 20,
    food: 20,
    lastDamageTime: 0,
    inventory: { slots: [], items: () => [] },
    registry: { foodsByName: {} },
    modes: { getStatus: () => [] },
    time: { timeOfDay: 13_000 },
    game: { dimension: 'minecraft:overworld', difficulty: 'normal' },
    rainState: 0,
    thunderState: 0,
    findBlocks(options) {
      searchOptions = options;
      const point = (options.point || this.entity.position).floored();
      const start = new Vec3(
        Math.floor(point.x / 16),
        Math.floor(point.y / 16),
        Math.floor(point.z / 16),
      );
      const iterator = new prismarineWorld.iterators.OctahedronIterator(
        start,
        Math.ceil((options.maxDistance + 8) / 16),
      );
      const visitedSections = new Set();
      let next = start;
      while (next) {
        visitedSections.add(next.toString());
        next = iterator.next();
      }
      return locations
        .filter(location => visitedSections.has(new Vec3(
          Math.floor(location.x / 16),
          Math.floor(location.y / 16),
          Math.floor(location.z / 16),
        ).toString()))
        .filter(location => location.distanceTo(point) <= options.maxDistance)
        .sort((left, right) => left.distanceTo(point) - right.distanceTo(point))
        .slice(0, options.count);
    },
    blockAt(position) {
      assert.equal(typeof position?.floored, 'function');
      return blocks.get(`${position.x}:${position.y}:${position.z}`)
        || { name: 'air', boundingBox: 'empty', position };
    },
    parseBedMetadata(block) {
      return {
        part: block.part === 'head',
        headOffset: { x: -1, y: 0, z: 0 },
        occupied: block.occupied,
      };
    },
    nearestEntity: () => null,
  };
  const situation = summarizeSurvivalSituation({
    bot,
    runtime: { survival: { ...POLICY, shelter: 'off' } },
    isOperatorHeld: () => false,
    isIdle: () => true,
  });

  assert.deepEqual(situation.beds.map(({ x, y, z }) => ({ x, y, z })), [
    { x: -370, y: 70, z: -169 },
    { x: -370, y: 70, z: -162 },
    { x: -351, y: 71, z: -159 },
  ]);
  assert.equal(searchOptions.maxDistance, 48);
  assert.equal(searchOptions.count, 64);
  assert.deepEqual(situation.beds.map(bed => bed.occupied), [true, true, false]);
  assert.ok(origin.distanceTo(new Vec3(-351, 71, -159)) < 24);
  assert.ok(origin.distanceTo(new Vec3(-340, 70, -166)) > 24);
});

test('Given a bed head without a native vector, survival bed selection fails closed', () => {
  const origin = new Vec3(0, 64, 0);
  const headLocation = new Vec3(3, 64, 0);
  const situation = summarizeSurvivalSituation({
    bot: {
      entity: { position: origin },
      entities: {},
      health: 20,
      food: 20,
      lastDamageTime: 0,
      inventory: { slots: [], items: () => [] },
      registry: { foodsByName: {} },
      modes: { getStatus: () => [] },
      time: { timeOfDay: 13_000 },
      game: { dimension: 'minecraft:overworld', difficulty: 'normal' },
      rainState: 0,
      thunderState: 0,
      findBlocks: () => [headLocation],
      blockAt(position) {
        assert.equal(typeof position?.floored, 'function');
        if (position.equals(headLocation)) {
          return {
            name: 'orange_bed',
            boundingBox: 'block',
            position: { x: 3, y: 64, z: 0 },
            part: 'head',
          };
        }
        return { name: 'air', boundingBox: 'empty', position };
      },
      parseBedMetadata: () => ({
        part: true,
        headOffset: { x: -1, y: 0, z: 0 },
      }),
      nearestEntity: () => null,
    },
    runtime: { survival: { ...POLICY, shelter: 'off' } },
    isOperatorHeld: () => false,
    isIdle: () => true,
  });

  assert.deepEqual(situation.beds, []);
});

test('Given nearly broken high-tier armor and a healthy replacement, survival situation makes the replacement actionable', () => {
  const wornDiamondBoots = { name: 'diamond_boots', type: 1, count: 1, durabilityUsed: 420 };
  const ironBoots = { name: 'iron_boots', type: 2, count: 1, durabilityUsed: 0 };
  const slots = Array(9).fill(null);
  slots[8] = wornDiamondBoots;
  const situation = summarizeSurvivalSituation({
    bot: {
      entity: {
        position: {
          x: 0,
          y: 64,
          z: 0,
          distanceTo: () => 0,
        },
      },
      health: 20,
      food: 20,
      lastDamageTime: 0,
      inventory: { slots, items: () => [ironBoots] },
      registry: {
        foodsByName: {},
        items: {
          1: { maxDurability: 429 },
          2: { maxDurability: 195 },
        },
      },
      modes: { getStatus: () => [] },
      time: { timeOfDay: 6000 },
      game: { dimension: 'minecraft:overworld' },
      rainState: 0,
      thunderState: 0,
      findBlocks: () => [],
      blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
      nearestEntity: () => null,
    },
    isOperatorHeld: () => false,
    isIdle: () => true,
  });

  assert.equal(situation.armor.find(item => item.equipped).score, 0);
  assert.equal(situation.armor.find(item => !item.equipped).score, 4);
});

test('Given a verified armor upgrade, SurvivalDirector dispatches it through ActionManager command ownership', async () => {
  const agent = createAgent();
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 20,
      urgentDanger: false,
      food: [],
      armor: [{ name: 'iron_chestplate', slot: 'torso', score: 4, equipped: false }],
      timeOfDay: 6000,
      weather: 'Clear',
    }),
    executeCommand: (_agent, command) => {
      commands.push(command);
      agent.last_action_result = {
        actionId: 'survival-equip-1',
        phase: 'succeeded',
        code: 'skill_equipped',
        target: { name: 'iron_chestplate' },
        retryable: false,
      };
    },
  });

  director.update();
  await settle();

  assert.deepEqual(commands, ['!equip("iron_chestplate")']);
  assert.equal(director.snapshot().code, 'skill_equipped');
});

test('Given emergency shelter policy, SurvivalDirector requests exactly one validated work order', () => {
  const agent = createAgent();
  agent.runtime.survival = { ...POLICY, shelter: 'emergency' };
  const requests = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => ({
      held: false,
      idle: true,
      health: 20,
      hunger: 20,
      urgentDanger: false,
      food: [],
      armor: [],
      timeOfDay: 6000,
      dimension: 'overworld',
      weather: 'Thunderstorm',
      sheltered: false,
      shelters: [],
    }),
    requestWorkOrder: order => {
      requests.push(order);
      return { accepted: true, id: 'shelter-1' };
    },
  });

  director.update();
  director.update();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'emergency_shelter');
  assert.equal(requests[0].blueprint.id, 'emergency_3x3');
  assert.equal(requests[0].blueprint.cells.length > 0, true);
  assert.equal(director.snapshot().phase, 'requested');
});

// Reproduces the 2026-08-14 night: 35 identical `skill_bed_occupied` attempts
// against one bed, zero displacement, at the 10s failure cooldown. Sleep is not
// optional comfort — insomnia is what spawns the phantoms that later killed the
// bot — so the loop must stop without suppressing sleep itself.
//
// These assert the exact dispatched command. An earlier version only counted
// generic `!goToBed` strings, which cannot observe which bed was attempted and
// so could not see the executor re-searching and substituting a nearer bed.
function createSleeperAgent(position = { x: 0, y: 64, z: 0 }) {
  return {
    bot: {
      entity: { id: 1, position },
      game: { dimension: 'overworld' },
      time: { timeOfDay: 14_000 },
    },
    runtime: { survival: POLICY },
    last_action_result: null,
    isIdle: () => true,
    isOperatorHeld: () => false,
  };
}

function sleeperSituation(beds, overrides = {}) {
  return {
    held: false,
    idle: true,
    health: 20,
    hunger: 20,
    recentDamage: false,
    urgentDanger: false,
    food: [],
    armor: [],
    timeOfDay: 14_000,
    dimension: 'overworld',
    difficulty: 'normal',
    weather: 'Clear',
    sheltered: false,
    shelters: [],
    beds,
    ...overrides,
  };
}

// A is nearer and occupied; B is farther and available. This is the exact shape
// that defeated the coordinate filter when dispatch was generic.
const BED_A = Object.freeze({
  name: 'orange_bed', x: -370, y: 70, z: -162, distance: 3, reachable: true, safe: true,
});
const BED_B = Object.freeze({
  name: 'red_bed', x: -352, y: 70, z: -160, distance: 19, reachable: true, safe: true,
});

const BED_A_COMMAND = '!goToBedAt(-370, 70, -162, "overworld")';
const BED_B_COMMAND = '!goToBedAt(-352, 70, -160, "overworld")';

// The executor answers as the real skill does: it reports the bed it actually
// attempted, taken from the exact coordinates in the dispatched command.
function bedDirector(agent, situationRef, { occupied }) {
  const commands = [];
  const director = new SurvivalDirector(agent, {
    getSituation: () => situationRef.value,
    executeCommand: (_agent, command) => {
      commands.push(command);
      const match = /^!goToBedAt\((-?\d+), (-?\d+), (-?\d+)/.exec(command);
      const attempted = match
        ? { name: 'bed', x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
        : { name: 'bed' };
      const blocked = occupied.some(bed => (
        bed.x === attempted.x && bed.y === attempted.y && bed.z === attempted.z
      ));
      agent.last_action_result = blocked
        ? {
            actionId: `sleep-${commands.length}`,
            phase: 'failed',
            code: 'skill_bed_occupied',
            detail: 'The bed is occupied.',
            target: attempted,
            retryable: true,
          }
        : {
            actionId: `sleep-${commands.length}`,
            phase: 'succeeded',
            code: 'skill_slept',
            detail: 'Slept through the night.',
            target: attempted,
            retryable: false,
          };
    },
  });
  return { director, commands };
}

test('Given an occupied bed and unchanged evidence, SurvivalDirector refuses a second identical sleep attempt', async () => {
  const agent = createSleeperAgent();
  const situationRef = { value: sleeperSituation([BED_A]) };
  const { director, commands } = bedDirector(agent, situationRef, { occupied: [BED_A] });

  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);

  // Bypass the cooldown deliberately: unchanged evidence, not elapsed time, is
  // what must stop the retry.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    director.nextEligibleAt = 0;
    director.update();
    await settle();
  }
  assert.deepEqual(commands, [BED_A_COMMAND]);
});

test('Given a nearer occupied bed and a farther available bed, the farther bed is the one actually attempted', async () => {
  const agent = createSleeperAgent();
  const situationRef = { value: sleeperSituation([BED_A, BED_B]) };
  const { director, commands } = bedDirector(agent, situationRef, { occupied: [BED_A] });

  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);

  director.nextEligibleAt = 0;
  director.update();
  await settle();

  // The decisive assertion: the second dispatch must bind bed B by coordinate.
  // Generic `!goToBed` would re-search and take nearer bed A again.
  assert.deepEqual(commands, [BED_A_COMMAND, BED_B_COMMAND]);
  assert.equal(agent.last_action_result.phase, 'succeeded');
  assert.equal(director.sleepBlocker, null);
});

test('Given same-night displacement to another fallback, the blocked bed remains ineligible', async () => {
  const agent = createSleeperAgent();
  const situationRef = { value: sleeperSituation([BED_A]) };
  const { director, commands } = bedDirector(agent, situationRef, { occupied: [BED_A] });

  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);

  agent.bot.entity.position = { x: 40, y: 64, z: 40 };
  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);
});

test('Given two occupied beds and a third available bed, same-night fallback visits each physical bed at most once', async () => {
  const agent = createSleeperAgent();
  const bedC = Object.freeze({
    name: 'orange_bed', x: -370, y: 70, z: -169, distance: 10, reachable: true, safe: true,
  });
  const situationRef = { value: sleeperSituation([BED_A, bedC, BED_B]) };
  const { director, commands } = bedDirector(agent, situationRef, { occupied: [BED_A, bedC] });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    director.nextEligibleAt = 0;
    director.update();
    await settle();
    if (attempt === 0) agent.bot.entity.position = { x: -369, y: 70, z: -167 };
  }

  assert.deepEqual(commands, [
    BED_A_COMMAND,
    '!goToBedAt(-370, 70, -169, "overworld")',
    BED_B_COMMAND,
  ]);
  assert.equal(agent.last_action_result.phase, 'succeeded');
  assert.equal(director.sleepBlockers.size, 0);
});

test('Given authoritative occupied-state change, a blocked bed becomes eligible again', async () => {
  const agent = createSleeperAgent();
  const situationRef = { value: sleeperSituation([{ ...BED_A, occupied: true }]) };
  const { director, commands } = bedDirector(agent, situationRef, { occupied: [BED_A] });

  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);

  situationRef.value = sleeperSituation([{ ...BED_A, occupied: false }]);
  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND, BED_A_COMMAND]);
});

test('Given missing position evidence, the sleep blocker is retained rather than released', async () => {
  const agent = createSleeperAgent();
  const situationRef = { value: sleeperSituation([BED_A]) };
  const { director, commands } = bedDirector(agent, situationRef, { occupied: [BED_A] });

  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);

  // Unknown is not material change.
  agent.bot.entity.position = null;
  director.nextEligibleAt = 0;
  director.update();
  await settle();
  assert.deepEqual(commands, [BED_A_COMMAND]);
  assert.notEqual(director.sleepBlocker, null);
});

// Live seam campaign 2026-08-15: with every reachable bed occupied, Kevin
// correctly stopped after one attempt each but reported "I couldn't finish
// orange bed" — one arbitrary bed name rather than "there is nowhere here to
// sleep". The fallback contract requires one concise receipt-grounded statement
// when a rung is exhausted, said once.
function exhaustionAgent(position = { x: 0, y: 64, z: 0 }) {
  const said = [];
  const agent = {
    bot: { entity: { id: 1, position }, game: { dimension: 'overworld' }, time: { timeOfDay: 14_000 } },
    runtime: { survival: POLICY },
    last_action_result: null,
    isIdle: () => true,
    isOperatorHeld: () => false,
    openChat: message => { said.push(String(message)); return Promise.resolve(); },
  };
  return { agent, said };
}

test('Given every reachable bed blocked, survival explains the whole rung once instead of naming one bed', async () => {
  const { agent, said } = exhaustionAgent();
  const beds = [
    { name: 'orange_bed', x: -370, y: 70, z: -162, distance: 3, reachable: true, safe: true },
    { name: 'red_bed', x: -370, y: 70, z: -169, distance: 9, reachable: true, safe: true },
  ];
  const director = new SurvivalDirector(agent, {
    getSituation: () => sleeperSituation(beds),
    executeCommand: () => {},
  });

  for (const bed of beds) {
    director.captureSleepBlocker(
      { kind: 'sleep', target: bed },
      { phase: 'failed', code: 'skill_bed_occupied', target: bed },
    );
  }
  director.eligibleSleepBeds(sleeperSituation(beds));
  await settle();

  assert.equal(said.length, 1);
  assert.match(said[0], /all 2 beds/);
  assert.match(said[0], /occupied/);
  // Naming a single bed was the reporting defect; the statement must be about
  // the exhausted rung.
  assert.doesNotMatch(said[0], /couldn't finish/);

  // Repeating the evaluation must not repeat the announcement.
  director.eligibleSleepBeds(sleeperSituation(beds));
  await settle();
  assert.equal(said.length, 1);
});

test('Given one blocked bed and another still free, survival stays quiet and keeps trying', async () => {
  const { agent, said } = exhaustionAgent();
  const blocked = { name: 'orange_bed', x: -370, y: 70, z: -162, distance: 3, reachable: true, safe: true };
  const free = { name: 'red_bed', x: -370, y: 70, z: -169, distance: 9, reachable: true, safe: true };
  const director = new SurvivalDirector(agent, {
    getSituation: () => sleeperSituation([blocked, free]),
    executeCommand: () => {},
  });

  director.captureSleepBlocker(
    { kind: 'sleep', target: blocked },
    { phase: 'failed', code: 'skill_bed_occupied', target: blocked },
  );
  const eligible = director.eligibleSleepBeds(sleeperSituation([blocked, free]));
  await settle();

  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].z, -169);
  assert.equal(said.length, 0);
});
