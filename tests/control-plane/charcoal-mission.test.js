import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CharcoalMissionController,
  MissionStore,
} from '../../src/agent/runtime/charcoal-mission.js';
import {
  createCommandRequestContext,
  executeCommand,
} from '../../src/agent/commands/index.js';

function settleMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

function fakeAgent() {
  const responses = [];
  return {
    bot: {
      inventory: {
        slots: [],
        items() { return this.slots.filter(Boolean); },
      },
    },
    last_action_result: null,
    open_player_request: { source: 'Director', message: 'Make me some charcoal.' },
    isOperatorHeld: () => false,
    behavior_arbiter: { wake() {} },
    routeResponse(target, message) { responses.push({ target, message }); },
    responses,
  };
}

test('MissionStore keeps one exact in-memory promise and binds one clarification token', () => {
  let now = 100;
  const store = new MissionStore({ now: () => now });
  const first = store.acceptCharcoal({ requester: 'Director', quantity: 8, sourceMessage: 'some charcoal' });

  assert.equal(first.status, 'OPEN');
  assert.deepEqual(first.promise, {
    item: 'charcoal',
    quantity: 8,
    custody: 'deliver_to_requester',
  });

  now = 110;
  const waiting = store.requestClarification(first.missionId, `${first.missionId}:activity:1`, 'Which player?');
  assert.equal(waiting.status, 'WAITING');
  assert.match(waiting.clarification.token, /^clarification-/);
  assert.equal(store.resolveClarification('wrong-token', 'Alex'), null);

  now = 120;
  const resumed = store.resolveClarification(waiting.clarification.token, 'Director');
  assert.equal(resumed.status, 'OPEN');
  assert.equal(resumed.clarification.answer, 'Director');

  now = 130;
  const replacement = store.acceptCharcoal({ requester: 'Director', quantity: 4 });
  assert.notEqual(replacement.missionId, first.missionId);
  assert.equal(store.last.status, 'CANCELLED');
  assert.equal(store.last.lastOutcome.reasonCode, 'mission_replaced');
});

test('charcoal Mission dispatches one causal Activity at a time with stable correlation and measured delivery', async () => {
  const agent = fakeAgent();
  const calls = [];
  const buildPlanCalls = [];
  const controller = new CharcoalMissionController(agent, {
    mode: 'active',
    buildPlan(_bot, options) {
      buildPlanCalls.push(options);
      return {
        status: 'ready',
        nextStep: {
          kind: 'collect',
          target: 'oak_log',
          expectedName: 'oak_log',
          expectedIncrease: 1,
          trail: ['charcoal', 'oak_log'],
          reason: 'Acquire smelting input.',
          capability: { id: 'collect_block', arguments: { source: 'oak_log', output: 'oak_log', count: 1, expectedIncrease: 1, range: 64 } },
        },
      };
    },
    executeCapability(capability, options) {
      calls.push({ capability, options });
      return Promise.resolve({
        verification: { ok: true },
        result: {
          actionId: `action-${calls.length}`,
          phase: 'succeeded',
          code: 'capability_effects_verified',
          detail: 'Minecraft verified the bounded effect.',
          retryable: false,
          evidence: { activity: { lifecycle: 'SUCCEEDED' } },
        },
      });
    },
  });
  agent.charcoal_mission = controller;

  const accepted = await controller.accept({ requester: 'Director', quantity: 4, sourceMessage: 'Make four charcoal.' });
  const missionId = accepted.missionId;
  assert.equal(controller.update(), true);
  assert.equal(controller.inFlight, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.missionId, missionId);
  assert.equal(calls[0].options.activityId, `${missionId}:activity:1`);
  assert.equal(buildPlanCalls[0].target, 'charcoal');
  assert.equal(buildPlanCalls[0].quantity, 4);

  await settleMicrotasks();
  assert.equal(controller.inFlight, false);
  assert.equal(controller.activeMission.status, 'OPEN');
  assert.equal(controller.activeMission.activities.length, 1);

  agent.bot.inventory.slots = [{ name: 'charcoal', count: 4 }];
  assert.equal(controller.update(), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].capability.id, 'deliver_exact_item');
  assert.deepEqual(calls[1].capability.arguments, {
    player: 'Director',
    item: 'charcoal',
    quantity: 4,
  });
  assert.equal(calls[1].options.missionId, missionId);
  assert.equal(calls[1].options.activityId, `${missionId}:activity:2`);

  await settleMicrotasks();
  const snapshot = controller.snapshot();
  assert.equal(snapshot.mission.status, 'SUCCEEDED');
  assert.equal(snapshot.code, 'charcoal_delivery_verified');
  assert.equal(snapshot.mission.lastOutcome.delivered, 4);
  assert.equal(agent.open_player_request, null);
  assert.match(agent.responses[0].message, /exactly 4 charcoal/);
});

test('replacement Mission waits for graceful halt and correlated Activity settlement before admission', async () => {
  const agent = fakeAgent();
  let resolveExecution;
  let resolveStop;
  let stopCalls = 0;
  const execution = new Promise(resolve => { resolveExecution = resolve; });
  const stop = new Promise(resolve => { resolveStop = resolve; });
  agent.actions = {
    stop() {
      stopCalls += 1;
      return stop;
    },
  };
  const controller = new CharcoalMissionController(agent, {
    mode: 'active',
    buildPlan() {
      return {
        status: 'ready',
        nextStep: {
          kind: 'collect',
          target: 'oak_log',
          capability: { id: 'collect_block', arguments: {} },
        },
      };
    },
    executeCapability() { return execution; },
  });

  const first = await controller.accept({ requester: 'Director', quantity: 8 });
  assert.equal(controller.update(), true);
  const replacement = controller.accept({ requester: 'Director', quantity: 4 });
  await settleMicrotasks();

  assert.equal(stopCalls, 1);
  assert.equal(controller.activeMission.missionId, first.missionId);

  resolveExecution({
    result: {
      phase: 'interrupted',
      code: 'interrupted',
      detail: 'The old Activity acknowledged cancellation and settled.',
      retryable: true,
      evidence: { activity: { lifecycle: 'CANCELLED' } },
    },
  });
  await settleMicrotasks();
  assert.equal(controller.activeMission.missionId, first.missionId);
  assert.equal(controller.activeMission.activities[0].state, 'INTERRUPTED');

  resolveStop({ stopped: true, timedOut: false });
  const accepted = await replacement;
  assert.equal(controller.activeMission.missionId, accepted.missionId);
  assert.notEqual(accepted.missionId, first.missionId);
  assert.equal(controller.store.last.status, 'CANCELLED');
  assert.equal(controller.store.last.activities[0].state, 'INTERRUPTED');
  assert.equal(controller.store.last.lastOutcome.reasonCode, 'mission_replaced');
});

test('a safety-owned interruption suspends a Mission Activity without spending its activity budget', async () => {
  const agent = fakeAgent();
  let dispatches = 0;
  agent.behavior_arbiter = {
    wake() {},
    matchesControlSuspension(commitment) {
      assert.equal(commitment.owner, 'player_mission');
      assert.equal(commitment.actionId, 'mission-action-1');
      return true;
    },
  };
  const controller = new CharcoalMissionController(agent, {
    mode: 'active',
    buildPlan: () => ({
      status: 'ready',
      nextStep: {
        kind: 'collect',
        target: 'oak_log',
        capability: { id: 'collect_block', arguments: {} },
      },
    }),
    executeCapability() {
      dispatches += 1;
      if (dispatches > 1) return new Promise(() => {});
      return Promise.resolve({
        result: {
          actionId: 'mission-action-1',
          phase: 'interrupted',
          code: 'interrupted',
          detail: 'A hostile started the safety incident.',
          retryable: true,
        },
      });
    },
  });
  agent.charcoal_mission = controller;
  const accepted = await controller.accept({ requester: 'Director', quantity: 4 });

  assert.equal(controller.update(), true);
  await settleMicrotasks();
  assert.equal(controller.activeMission.missionId, accepted.missionId);
  assert.equal(controller.activeMission.activities[0].state, 'SUSPENDED');
  assert.equal(controller.status.code, 'safety_suspended');
  assert.equal(controller.nextAttemptAt, 0);

  assert.equal(controller.update(), true, 'the arbiter can release the same Mission back to planning');
  assert.equal(dispatches, 2);
  assert.equal(
    controller.activeMission.activities.filter(activity => activity.state !== 'SUSPENDED').length,
    1,
  );
});

test('invalid replacement is rejected before halt and leaves the active Mission untouched', async () => {
  const agent = fakeAgent();
  let stopCalls = 0;
  agent.actions = {
    async stop() {
      stopCalls += 1;
      return { stopped: true, timedOut: false };
    },
  };
  const controller = new CharcoalMissionController(agent, {
    buildPlan: () => ({
      status: 'ready',
      nextStep: { kind: 'collect', target: 'oak_log', capability: { id: 'collect_block', arguments: {} } },
    }),
    executeCapability: () => new Promise(() => {}),
  });
  const first = await controller.accept({ requester: 'Director', quantity: 8 });
  assert.equal(controller.update(), true);

  const rejected = await controller.accept({ requester: 'Director', quantity: 0 });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, 'charcoal_mission_invalid');
  assert.equal(stopCalls, 0);
  assert.equal(controller.activeMission.missionId, first.missionId);
  assert.equal(controller.activeMission.activities[0].state, 'RUNNING');
});

test('replacement is rejected when graceful halt fails and the old Mission remains current', async () => {
  const agent = fakeAgent();
  let stopCalls = 0;
  agent.actions = {
    async stop() {
      stopCalls += 1;
      return { stopped: false, timedOut: true };
    },
  };
  const controller = new CharcoalMissionController(agent, {
    buildPlan: () => ({
      status: 'ready',
      nextStep: { kind: 'collect', target: 'oak_log', capability: { id: 'collect_block', arguments: {} } },
    }),
    executeCapability: () => new Promise(() => {}),
  });
  const first = await controller.accept({ requester: 'Director', quantity: 8 });
  assert.equal(controller.update(), true);

  const rejected = await controller.accept({ requester: 'Director', quantity: 4 });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, 'mission_replacement_handoff_failed');
  assert.equal(stopCalls, 1);
  assert.equal(controller.activeMission.missionId, first.missionId);
  assert.equal(controller.activeMission.activities[0].state, 'RUNNING');
  assert.equal(controller.store.last, null);
});

test('shadow Mission plans but never dispatches or claims the body lane', async () => {
  const agent = fakeAgent();
  let executions = 0;
  const controller = new CharcoalMissionController(agent, {
    mode: 'shadow',
    buildPlan() {
      return {
        status: 'ready',
        nextStep: {
          kind: 'collect',
          target: 'oak_log',
          capability: { id: 'collect_block', arguments: {} },
        },
      };
    },
    executeCapability() {
      executions += 1;
      return Promise.resolve({});
    },
  });

  await controller.accept({ requester: 'Director', quantity: 8 });
  assert.equal(controller.ownsBodyLane(), false);
  assert.equal(controller.update(), false);
  assert.equal(controller.status.code, 'charcoal_mission_shadow_plan');
  assert.equal(executions, 0);
});

test('model-selected proposal binds requester outside model arguments and request context preserves Mission IDs', async () => {
  let activeContext = null;
  let accepted = null;
  const agent = {
    open_player_request: { source: 'Director', message: 'Please make four charcoal.' },
    last_sender: 'NotTheRequester',
    charcoal_mission: {
      accept(value) {
        accepted = value;
        return { accepted: true, detail: 'accepted' };
      },
    },
    actions: {
      currentRequestContext() { return activeContext; },
      runWithRequestContext(context, operation) {
        activeContext = context;
        try { return operation(); } finally { activeContext = null; }
      },
      runWithOwner(_owner, operation) { return operation(); },
    },
  };

  const result = await executeCommand(agent, '!acceptCharcoalMission(4)', {
    owner: 'player',
    routeOrigin: 'model-selected',
  });
  assert.equal(result, 'accepted');
  assert.deepEqual(accepted, {
    requester: 'Director',
    quantity: 4,
    sourceMessage: 'Please make four charcoal.',
  });

  const context = createCommandRequestContext({
    routeOrigin: 'mission-director',
    selectedSkill: '!smeltItem',
    missionId: 'mission-1',
    activityId: 'mission-1:activity:3',
  });
  assert.equal(context.routeOrigin, 'mission-director');
  assert.equal(context.missionId, 'mission-1');
  assert.equal(context.activityId, 'mission-1:activity:3');
});
