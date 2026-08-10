import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BehaviorFlightRecorder,
  isHighValueActionFailure,
  isTelemetryBookmarkMessage,
} from '../../src/agent/runtime/behavior-flight-recorder.js';

function telemetryRecords(root, agentName) {
  const directory = path.join(root, agentName, 'telemetry');
  return readdirSync(directory)
    .filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(path.join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line)));
}

function fakeAgent(name = 'TelemetryBot') {
  return {
    name,
    actions: { executing: false },
    history: {
      getHistory: () => [
        { role: 'user', content: 'Please keep mining.' },
        { role: 'assistant', content: 'I cannot find a tool.' },
      ],
    },
    isOperatorHeld: () => false,
    goal_director: { activeGoal: null },
    job_director: { activeOrder: null },
  };
}

test('flight recorder classifies bookmarks and genuine failures without treating preemption as failure', () => {
  assert.equal(isTelemetryBookmarkMessage('WTF?!'), true);
  assert.equal(isTelemetryBookmarkMessage('what happened'), false);
  assert.equal(isHighValueActionFailure({
    phase: 'failed',
    code: 'skill_unreachable',
  }), true);
  assert.equal(isHighValueActionFailure({
    phase: 'blocked',
    code: 'higher_priority_action_active',
    retryable: true,
  }), false);
  assert.equal(isHighValueActionFailure({
    phase: 'blocked',
    code: 'previous_action_unresponsive',
    retryable: false,
  }), true);
});

test('flight recorder persists bounded canonical context for failures and WTF bookmarks', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-flight-recorder-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = fakeAgent();
  const recorder = new BehaviorFlightRecorder(agent, {
    root,
    stateSampler: () => ({
      _meta: { sampledAt: 123, source: 'live', depth: 'shallow' },
      inventory: {
        tools: [{
          name: 'stone_pickaxe',
          count: 2,
          durability: { remaining: 110, maximum: 131 },
        }],
      },
      action: { current: 'Mining', kind: 'acting' },
    }),
  });

  assert.equal(recorder.recordActionResult({
    actionId: 'action-1',
    phase: 'failed',
    code: 'missing_tool',
    label: 'collect stone',
    detail: 'No usable tool was found.',
    retryable: false,
    evidence: { skill: { outcome: 'missing_tool', target: 'stone' } },
    startedAt: 100,
    finishedAt: 120,
  }), true);
  assert.equal(recorder.bookmark('PlayerOne', 'WTF'), true);
  await recorder.close('test complete');

  const records = telemetryRecords(root, agent.name);
  assert.deepEqual(records.map(record => record.kind), [
    'action.failure',
    'player.bookmark',
    'runtime.event',
  ]);
  assert.equal(records[0].canonicalState._meta.source, 'live');
  assert.equal(records[0].recentDialogue.length, 2);
  assert.equal(records[0].logicFlags[0].code, 'reported_missing_tool_with_carried_tools');
  assert.equal(records[1].trigger.code, 'player_wtf_bookmark');
  assert.equal(recorder.snapshot().recordsWritten, 3);
  assert.equal(recorder.snapshot().recordsDropped, 0);
});

test('flight recorder automatically bookmarks a durable commitment that remains idle', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-flight-stall-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let now = 1_000;
  const agent = fakeAgent('StallBot');
  agent.goal_director = {
    activeGoal: { id: 'goal-1', phase: 'recover' },
    status: { phase: 'recover', code: 'causal_replan', detail: 'Replanning.' },
    inFlight: false,
    nextAttemptAt: 0,
  };
  const recorder = new BehaviorFlightRecorder(agent, {
    root,
    now: () => now,
    stallAfterMs: 5_000,
    stateSampler: () => ({ _meta: { sampledAt: now, source: 'live', depth: 'shallow' } }),
  });

  assert.equal(recorder.observeRuntime(), false);
  now += 5_001;
  assert.equal(recorder.observeRuntime(), true);
  await recorder.close('test complete');

  const records = telemetryRecords(root, agent.name);
  assert.equal(records[0].kind, 'runtime.possible_stall');
  assert.equal(records[0].trigger.commitment.id, 'goal-1');
  assert.equal(records[0].trigger.commitment.idleForMs, 5_001);
});
