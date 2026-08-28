import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { ActionManager } from '../../src/agent/action_manager.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('condition was not observed');
}

function createHarness({ moving = false, collecting = false } = {}) {
  const bot = new EventEmitter();
  const releases = [];
  const starts = [];
  const state = { moving, mining: false, building: false, forcedStops: 0 };
  bot.output = '';
  bot.interrupt_code = false;
  bot.lastActionEvidence = null;
  bot.controlState = {};
  bot.targetDigBlock = null;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  bot.pathfinder = {
    goal: null,
    isMoving: () => state.moving,
    isMining: () => state.mining,
    isBuilding: () => state.building,
    setGoal(goal) { this.goal = goal; bot.emit('goal_updated', goal, false); },
    stop() { state.forcedStops += 1; },
  };
  bot.collectBlock = {
    activeTask: collecting ? { generation: 1 } : null,
    cancelTask() {
      if (this.activeTask == null) return Promise.resolve();
      bot.emit('collectBlock_cancelled', this.activeTask.generation);
      return Promise.resolve();
    },
  };
  bot.stopDigging = async () => {};
  bot.clearControlStates = () => { bot.controlState = {}; };
  bot.moveVehicle = () => {};
  bot.pvp = {
    target: null,
    async stop() {
      this.target = null;
      bot.pathfinder.goal = null;
      state.moving = false;
      bot.emit('stoppedAttacking');
    },
    forceStop() {
      this.target = null;
      bot.pathfinder.goal = null;
      state.moving = false;
      bot.emit('stoppedAttacking');
    },
  };

  const agent = {
    name: 'LifecycleBot',
    bot,
    self_prompter: { isActive: () => false },
    history: { add() {} },
    behavior_arbiter: {
      recordActionStart(value) { starts.push(value); },
      recordActionRelease(value) { releases.push(value); },
    },
    isOperatorHeld: () => false,
    isIdle() { return !this.actions.executing; },
    requestInterrupt() { bot.interrupt_code = true; },
    clearBotLogs() {
      bot.output = '';
      bot.interrupt_code = false;
    },
    recordActionResult() {},
  };
  agent.actions = new ActionManager(agent, {
    stopWaitTimeoutMs: 40,
    gracefulHaltTimeoutMs: 5,
    settlementTimeoutMs: 80,
  });
  return { agent, bot, releases, starts, state };
}

test('Pathfinder retains the body lease until package state proves settlement', async () => {
  const { agent, bot, releases, starts, state } = createHarness({ moving: true });
  const operation = deferred();
  const running = agent.actions.runAction('test:pathfinder', () => operation.promise, {
    timeout: -1,
    specialist: 'pathfinder',
    missionId: 'mission-path',
    activityId: 'activity-path',
  });

  await waitFor(() => agent.actions.executing);
  bot.emit('path_update', { status: 'partial', visitedNodes: 12, generatedNodes: 20 });
  operation.resolve(true);
  await waitFor(() => agent.actions.activitySnapshot()?.lifecycle === 'SETTLING');

  assert.equal(agent.actions.executing, true);
  assert.equal(releases.length, 0);
  assert.equal(agent.actions.activitySnapshot().bodyLeaseOwner, starts[0].actionId);
  assert.equal(agent.actions.activitySnapshot().progress.evidence.status, 'partial');

  state.moving = false;
  bot.emit('path_stop');
  const result = await running;

  assert.equal(result.success, true);
  assert.equal(agent.actions.executing, false);
  assert.equal(releases.length, 1);
  assert.equal(agent.actions.activitySnapshot().lifecycle, 'SUCCEEDED');
  assert.equal(Number.isFinite(agent.actions.activitySnapshot().settledAt), true);
  assert.equal(agent.actions.activitySnapshot().terminalResult.reasonCode, 'completed');
  assert.equal(bot.listenerCount('path_update'), 0);
  assert.equal(bot.listenerCount('path_reset'), 0);
  assert.equal(bot.listenerCount('goal_reached'), 0);
});

test('CollectBlock retains the body lease until its task and Pathfinder both settle', async () => {
  const { agent, bot, releases, state } = createHarness({ moving: true, collecting: true });
  const operation = deferred();
  const running = agent.actions.runAction('test:collectblock', () => operation.promise, {
    timeout: -1,
    specialist: 'collectblock',
    missionId: 'mission-collect',
    activityId: 'activity-collect',
  });

  await waitFor(() => agent.actions.executing);
  operation.resolve(true);
  await waitFor(() => agent.actions.activitySnapshot()?.lifecycle === 'SETTLING');

  assert.equal(agent.actions.executing, true);
  assert.equal(releases.length, 0);

  state.moving = false;
  bot.collectBlock.activeTask = null;
  bot.emit('collectBlock_finished', 1);
  const result = await running;

  assert.equal(result.success, true);
  assert.equal(agent.actions.executing, false);
  assert.equal(releases.length, 1);
  assert.equal(agent.actions.activitySnapshot().specialist, 'collectblock');
  assert.equal(agent.actions.activitySnapshot().lifecycle, 'SUCCEEDED');
  assert.equal(agent.actions.activitySnapshot().settlement.evidence, 'collectBlock_idle');
  assert.equal(bot.listenerCount('collectBlock_targetFailed'), 0);
  assert.equal(bot.listenerCount('collectBlock_cancelled'), 0);
  assert.equal(bot.listenerCount('collectBlock_finished'), 0);
});

test('PvP retains the body lease until both target and pursuit settle', async () => {
  const { agent, bot, releases, state } = createHarness({ moving: true });
  const operation = deferred();
  bot.pvp.target = { id: 42 };
  bot.pathfinder.goal = { kind: 'follow' };
  const running = agent.actions.runAction('test:pvp', () => operation.promise, {
    timeout: -1,
    specialist: 'pvp',
  });

  await waitFor(() => agent.actions.executing);
  bot.emit('startedAttacking');
  operation.resolve(true);
  await waitFor(() => agent.actions.activitySnapshot()?.lifecycle === 'SETTLING');

  assert.equal(agent.actions.executing, true);
  assert.equal(releases.length, 0);

  bot.pvp.target = null;
  bot.pathfinder.goal = null;
  state.moving = false;
  bot.emit('stoppedAttacking');
  const result = await running;

  assert.equal(result.success, true);
  assert.equal(releases.length, 1);
  assert.equal(agent.actions.activitySnapshot().specialist, 'pvp');
  assert.equal(agent.actions.activitySnapshot().settlement.evidence, 'pvp_idle_pathfinder_idle');
  assert.equal(bot.listenerCount('startedAttacking'), 0);
  assert.equal(bot.listenerCount('stoppedAttacking'), 0);
});

test('vehicle control retains the body lease until zero-input settlement', async () => {
  const { agent, bot, releases } = createHarness();
  const operation = deferred();
  const running = agent.actions.runAction('test:vehicle', () => operation.promise, {
    timeout: -1,
    specialist: 'vehicle',
  });

  await waitFor(() => agent.actions.executing);
  bot.emit('vehicle_control_start', { vehicleId: 7 });
  operation.resolve(true);
  await waitFor(() => agent.actions.activitySnapshot()?.lifecycle === 'SETTLING');

  assert.equal(agent.actions.executing, true);
  assert.equal(releases.length, 0);

  bot.emit('vehicle_control_stop', { vehicleId: 7, outcome: 'arrived' });
  const result = await running;

  assert.equal(result.success, true);
  assert.equal(releases.length, 1);
  assert.equal(agent.actions.activitySnapshot().specialist, 'vehicle');
  assert.equal(agent.actions.activitySnapshot().settlement.evidence, 'vehicle_input_idle');
  assert.equal(bot.listenerCount('vehicle_control_start'), 0);
  assert.equal(bot.listenerCount('vehicle_control_stop'), 0);
});

test('non-specialist Mission commands still receive one correlated Activity lifecycle', async () => {
  const { agent, releases, starts } = createHarness();
  const context = {
    requestId: 'request-smelt',
    routeOrigin: 'mission-director',
    selectedSkill: '!smeltItem',
    args: ['oak_log', 4],
    requestedAt: Date.now(),
    missionId: 'mission-charcoal',
    activityId: 'mission-charcoal:activity:7',
  };
  const result = await agent.actions.runWithRequestContext(context, () => (
    agent.actions.runAction('action:smeltItem', async () => true, { timeout: -1 })
  ));

  assert.equal(result.success, true);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].missionId, 'mission-charcoal');
  assert.equal(starts[0].activityId, 'mission-charcoal:activity:7');
  assert.equal(releases.length, 1);
  assert.equal(agent.actions.activitySnapshot().missionId, 'mission-charcoal');
  assert.equal(agent.actions.activitySnapshot().activityId, 'mission-charcoal:activity:7');
  assert.equal(agent.actions.activitySnapshot().lifecycle, 'SUCCEEDED');
  assert.equal(agent.actions.activitySnapshot().settlement.evidence, 'command_promise_settled');
});

test('interleaved command executions retain their exact correlated results', async () => {
  const { agent } = createHarness();
  const firstGate = deferred();
  const secondGate = deferred();
  const firstResult = Object.freeze({ actionId: 'action-first', phase: 'succeeded', code: 'first_done' });
  const secondResult = Object.freeze({ actionId: 'action-second', phase: 'failed', code: 'second_failed' });

  const firstExecution = agent.actions.runWithCommandExecution(async () => {
    await firstGate.promise;
    agent.actions.recordCommandExecutionResult(firstResult);
    return 'first value';
  }, { requestId: 'request-first', selectedSkill: '!first', routeOrigin: 'test' });
  const secondExecution = agent.actions.runWithCommandExecution(async () => {
    await secondGate.promise;
    agent.actions.recordCommandExecutionResult(secondResult);
    return 'second value';
  }, { requestId: 'request-second', selectedSkill: '!second', routeOrigin: 'test' });

  secondGate.resolve();
  const settledSecond = await secondExecution;
  firstGate.resolve();
  const settledFirst = await firstExecution;

  assert.equal(settledFirst.value, 'first value');
  assert.equal(settledFirst.result, firstResult);
  assert.equal(settledFirst.requestContext.requestId, 'request-first');
  assert.equal(settledSecond.value, 'second value');
  assert.equal(settledSecond.result, secondResult);
  assert.equal(settledSecond.requestContext.requestId, 'request-second');
});

test('a stop timeout records cancellation and escalation without releasing ownership', async () => {
  const { agent, releases, starts, state } = createHarness({ moving: true });
  const operation = deferred();
  void agent.actions.runAction('test:unresponsive-pathfinder', () => operation.promise, {
    timeout: -1,
    specialist: 'pathfinder',
  });

  await waitFor(() => agent.actions.executing);
  const stop = await agent.actions.stop({ timeoutMs: 30 });
  const activity = agent.actions.activitySnapshot();

  assert.deepEqual({ stopped: stop.stopped, timedOut: stop.timedOut }, { stopped: false, timedOut: true });
  assert.equal(agent.actions.executing, true);
  assert.equal(releases.length, 0);
  assert.equal(activity.bodyLeaseOwner, starts[0].actionId);
  assert.equal(activity.lifecycle, 'ABORTED_UNSETTLED');
  assert.equal(Number.isFinite(activity.cancelRequestedAt), true);
  assert.equal(Number.isFinite(activity.cancelAcknowledgedAt), true);
  assert.equal(Number.isFinite(activity.forceHaltAt), true);
  assert.equal(activity.terminalResult.reasonCode, 'stop_timeout');
  assert.equal(state.forcedStops > 0, true);
});
