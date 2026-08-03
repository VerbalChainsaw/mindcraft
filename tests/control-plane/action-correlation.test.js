import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { ActionManager } from '../../src/agent/action_manager.js';
import {
  createCommandRequestContext,
  executeCommand,
  normalizeCommandRouteOrigin,
} from '../../src/agent/commands/index.js';
import { DecisionTraceRecorder } from '../../src/agent/runtime/decision-trace.js';

function createHarness() {
  const acquisitions = [];
  const bot = new EventEmitter();
  bot.output = '';
  bot.interrupt_code = false;
  bot.lastActionEvidence = null;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  const agent = {
    name: 'CorrelationBot',
    bot,
    self_prompter: { isActive: () => false },
    history: { add() {} },
    behavior_arbiter: {
      recordActionStart(value) { acquisitions.push(value); },
      recordActionRelease() {},
      recordOutcome() {},
    },
    isIdle() { return !this.actions.executing; },
    requestInterrupt() { bot.interrupt_code = true; },
    clearBotLogs() {
      bot.output = '';
      bot.interrupt_code = false;
    },
    recordActionResult() {},
  };
  agent.actions = new ActionManager(agent);
  return { agent, acquisitions };
}

function selectedTrace(recorder) {
  recorder.begin({ tick: 1, trigger: { code: 'scheduled_tick' } });
  recorder.startLane('player_goal');
  recorder.select({ lane: 'player_goal', reasonCode: 'selected', lowerLanesSuppressed: true });
  recorder.finalize();
}

test('executeCommand creates unique immutable request contexts after command validation', async () => {
  const contexts = [];
  const agent = {
    getPersona: () => 'builder',
    actions: {
      runWithOwner(_owner, operation) { return operation(); },
      runWithRequestContext(context, operation) {
        contexts.push(context);
        return operation();
      },
    },
  };

  await executeCommand(agent, '!persona', { routeOrigin: 'explicit-command' });
  await executeCommand(agent, '!persona', { routeOrigin: 'explicit-command' });

  assert.equal(contexts.length, 2);
  assert.notEqual(contexts[0].requestId, contexts[1].requestId);
  assert.match(contexts[0].requestId, /^command-request-[0-9a-f-]+$/);
  assert.equal(contexts[0].requestId.length <= 80, true);
  assert.equal(contexts[0].selectedSkill, '!persona');
  assert.equal(contexts[0].routeOrigin, 'explicit-command');
  assert.equal(Number.isFinite(contexts[0].requestedAt), true);
  assert.equal(Object.isFrozen(contexts[0]), true);
  assert.equal(Object.isFrozen(contexts[0].args), true);
});

test('request context bounds, sanitizes, clones, and permits only scalar or null arguments', () => {
  const sourceArgs = [
    '  hello\u0000\n world  ',
    12.5,
    true,
    null,
    { raw: 'forbidden' },
    Number.POSITIVE_INFINITY,
    undefined,
    'x'.repeat(300),
    'discarded ninth value',
  ];
  const context = createCommandRequestContext({
    routeOrigin: 'deterministic-nl',
    selectedSkill: `!${'skill\u0007 '.repeat(30)}`,
    args: sourceArgs,
    requestedAt: 1234.9,
  });
  sourceArgs[0] = 'mutated';

  assert.equal(context.args.length, 8);
  assert.deepEqual(context.args.slice(0, 7), ['hello world', 12.5, true, null, null, null, null]);
  assert.equal(context.args[7].length, 160);
  assert.equal(context.args[0], 'hello world');
  assert.equal(context.selectedSkill.length <= 80, true);
  assert.equal(/[\u0000-\u001f\u007f]/.test(context.selectedSkill), false);
  assert.equal(context.requestedAt, 1234);
});

test('route origins remain distinct and unknown values fall back to internal', () => {
  const allowed = [
    'explicit-command',
    'deterministic-nl',
    'model-selected',
    'directive-resume',
    'internal',
  ];
  for (const route of allowed) assert.equal(normalizeCommandRouteOrigin(route), route);
  assert.equal(normalizeCommandRouteOrigin('MODEL-SELECTED'), 'model-selected');
  assert.equal(normalizeCommandRouteOrigin('untrusted-route'), 'internal');
  assert.equal(normalizeCommandRouteOrigin({ raw: true }), 'internal');
});

test('ActionManager propagates the bounded request context to the exact action start', async () => {
  const { agent, acquisitions } = createHarness();
  const context = createCommandRequestContext({
    routeOrigin: 'model-selected',
    selectedSkill: '!build',
    args: ['oak_planks', 4],
    requestedAt: 2000,
  });

  const outcome = await agent.actions.runWithRequestContext(context, () => (
    agent.actions.runAction('action:build', async () => true, { owner: 'player' })
  ));

  assert.equal(outcome.result.phase, 'succeeded');
  assert.deepEqual(outcome.result.evidence.request, context);
  assert.equal(acquisitions.length, 1);
  assert.equal(acquisitions[0].actionId, outcome.result.actionId);
  assert.equal(acquisitions[0].requestId, context.requestId);
  assert.equal(acquisitions[0].routeOrigin, 'model-selected');
  assert.equal(acquisitions[0].selectedSkill, '!build');
  assert.deepEqual(acquisitions[0].args, ['oak_planks', 4]);
  assert.equal(acquisitions[0].requestedAt, 2000);
});

test('nested and overlapping nonphysical async request scopes do not bleed', async () => {
  const { agent } = createHarness();
  const outer = createCommandRequestContext({ selectedSkill: '!outer' });
  const nested = createCommandRequestContext({ selectedSkill: '!nested' });
  const concurrent = createCommandRequestContext({ selectedSkill: '!concurrent' });
  const seen = [];
  let releaseOuter;
  const outerGate = new Promise(resolve => { releaseOuter = resolve; });

  const outerRun = agent.actions.runWithRequestContext(outer, async () => {
    seen.push(['outer-before', agent.actions.requestContext.getStore()?.requestId]);
    await outerGate;
    await agent.actions.runWithRequestContext(nested, async () => {
      await Promise.resolve();
      seen.push(['nested', agent.actions.requestContext.getStore()?.requestId]);
    });
    seen.push(['outer-after', agent.actions.requestContext.getStore()?.requestId]);
  });
  const concurrentRun = agent.actions.runWithRequestContext(concurrent, async () => {
    seen.push(['concurrent-before', agent.actions.requestContext.getStore()?.requestId]);
    releaseOuter();
    await Promise.resolve();
    seen.push(['concurrent-after', agent.actions.requestContext.getStore()?.requestId]);
  });

  await Promise.all([outerRun, concurrentRun]);
  assert.deepEqual(Object.fromEntries(seen), {
    'outer-before': outer.requestId,
    'concurrent-before': concurrent.requestId,
    nested: nested.requestId,
    'concurrent-after': concurrent.requestId,
    'outer-after': outer.requestId,
  });
  const labels = seen.map(([label]) => label);
  assert.equal(labels.indexOf('outer-before') < labels.indexOf('nested'), true);
  assert.equal(labels.indexOf('nested') < labels.indexOf('outer-after'), true);
  assert.equal(labels.indexOf('concurrent-before') < labels.indexOf('concurrent-after'), true);
  assert.equal(agent.actions.requestContext.getStore(), undefined);
});

test('DecisionTrace linkAction retains bounded request attribution through linkOutcome', () => {
  const recorder = new DecisionTraceRecorder({ now: () => 3000, monotonicNow: () => 10 });
  selectedTrace(recorder);
  const args = ['  oak\u0000 planks  ', { raw: true }, 3, ...Array(8).fill('extra')];

  assert.equal(recorder.linkAction({
    actionId: 'CorrelationBot-1-3000',
    owner: 'player',
    label: 'action:build',
    requestId: 'request-1',
    routeOrigin: 'deterministic-nl',
    selectedSkill: '!build',
    args,
    requestedAt: 2999,
  }), true);
  args[0] = 'mutated';
  assert.equal(recorder.linkOutcome({
    actionId: 'CorrelationBot-1-3000',
    phase: 'succeeded',
    code: 'completed',
    startedAt: 3000,
    finishedAt: 3010,
  }), true);

  const trace = recorder.snapshot(1).recent[0];
  assert.deepEqual(trace.correlation, {
    actionId: 'CorrelationBot-1-3000',
    requestId: 'request-1',
    routeOrigin: 'deterministic-nl',
    selectedSkill: '!build',
    args: ['oak planks', null, 3, 'extra', 'extra', 'extra', 'extra', 'extra'],
    requestedAt: 2999,
    outcomeLinked: true,
  });
  assert.equal(trace.activeAction.requestId, 'request-1');
  assert.equal(trace.outcome.actionId, trace.correlation.actionId);
});

test('actions and traces preserve existing behavior when no request context exists', async () => {
  const { agent, acquisitions } = createHarness();
  const outcome = await agent.actions.runAction('action:internal', async () => true, { owner: 'job' });

  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(acquisitions.length, 1);
  assert.equal(outcome.result.evidence.request, null);
  assert.equal(Object.hasOwn(acquisitions[0], 'requestId'), false);

  const recorder = new DecisionTraceRecorder({ now: () => 4000, monotonicNow: () => 20 });
  selectedTrace(recorder);
  assert.equal(recorder.linkAction({ actionId: 'internal-action', owner: 'job' }), true);
  assert.equal(recorder.linkOutcome({ actionId: 'internal-action', phase: 'succeeded', code: 'completed' }), true);
  const trace = recorder.snapshot(1).recent[0];
  assert.equal(trace.correlation.requestId, null);
  assert.equal(trace.correlation.routeOrigin, null);
  assert.deepEqual(trace.correlation.args, []);
});
