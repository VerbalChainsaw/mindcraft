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
  isHighValueActionReceipt,
  isHighValueActionSuccess,
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

test('flight recorder classifies bookmarks and high-value action outcomes without treating preemption as failure', () => {
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
  assert.equal(isHighValueActionFailure({
    phase: 'failed',
    code: 'skill_source_access_pending',
    retryable: true,
  }), false);
  assert.equal(isHighValueActionReceipt({
    phase: 'failed',
    code: 'skill_source_access_pending',
    retryable: true,
  }), true);
  assert.equal(isHighValueActionSuccess({
    phase: 'succeeded',
    evidence: {
      request: {
        requestId: 'agenda-1',
        routeOrigin: 'agenda-director',
        selectedSkill: '!goToPlayer',
      },
    },
  }), true);
  assert.equal(isHighValueActionSuccess({
    phase: 'succeeded',
    evidence: {
      request: {
        requestId: 'internal-1',
        routeOrigin: 'internal',
        selectedSkill: '!moveAway',
      },
    },
  }), false);
});

test('flight recorder persists source-wait receipts without labeling them mechanic failures', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-flight-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = fakeAgent('ReceiptBot');
  const recorder = new BehaviorFlightRecorder(agent, {
    root,
    stateSampler: () => ({ _meta: { sampledAt: 123, source: 'live', depth: 'shallow' } }),
  });

  assert.equal(recorder.recordActionResult({
    actionId: 'action-receipt-1',
    phase: 'failed',
    code: 'skill_source_access_pending',
    label: 'harvest spider string',
    detail: 'A qualified spider is loaded, but its current position has no usable pursuit.',
    retryable: true,
    evidence: {
      skill: {
        outcome: 'source_access_pending',
        sourceAccess: {
          source: 'spider',
          entityId: 42,
          stage: 'path_not_found',
          movementOutcome: 'unreachable',
        },
      },
    },
    startedAt: 100,
    finishedAt: 120,
  }), true);
  await recorder.close('test complete');

  const records = telemetryRecords(root, agent.name);
  assert.equal(records[0].kind, 'action.receipt');
  assert.equal(records[0].trigger.actionResult.code, 'skill_source_access_pending');
  assert.equal(records[0].trigger.actionResult.evidence.skill.sourceAccess.stage, 'path_not_found');
});

test('flight recorder persists bounded successful player work without duplicating decision history', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-flight-success-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = fakeAgent('SuccessBot');
  const recorder = new BehaviorFlightRecorder(agent, {
    root,
    stateSampler: () => ({
      _meta: { sampledAt: 123, source: 'live', depth: 'shallow' },
      gameplay: { position: { x: 4, y: 64, z: 8 }, health: 20, hunger: 20 },
      action: {
        behaviorArbiter: {
          decisionTrace: {
            schemaVersion: 1,
            retained: 2,
            retentionLimit: 128,
            recent: [{ decisionId: 'tick-1' }, { decisionId: 'tick-2' }],
            diagnostics: { timing: { totalMs: { samples: 2, p50: 1.2 } } },
          },
        },
      },
    }),
  });

  assert.equal(recorder.recordActionResult({
    actionId: 'action-success-1',
    phase: 'succeeded',
    code: 'skill_arrived',
    label: 'go to DadPlayer',
    detail: 'Reached DadPlayer.',
    retryable: false,
    evidence: {
      request: {
        requestId: 'agenda-1',
        routeOrigin: 'agenda-director',
        selectedSkill: '!goToPlayer',
        args: ['DadPlayer'],
      },
      skill: { outcome: 'arrived', target: { name: 'DadPlayer' } },
    },
    startedAt: 100,
    finishedAt: 120,
  }), true);
  await recorder.close('test complete');

  const records = telemetryRecords(root, agent.name);
  assert.equal(records[0].kind, 'action.success');
  assert.equal(records[0].trigger.actionResult.code, 'skill_arrived');
  assert.equal(records[0].canonicalState.action.behaviorArbiter.decisionTrace.retained, 2);
  assert.deepEqual(records[0].canonicalState.action.behaviorArbiter.decisionTrace.recent, []);
  assert.equal(records[0].canonicalState.action.behaviorArbiter.decisionTrace.compactedFor, 'action.success');
  assert.equal(records[0].capture.code, 'canonical_action_trace_compacted');
  assert.equal(records[1].trigger.code, 'runtime.stopped');
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
    evidence: {
      skill: {
        outcome: 'missing_tool',
        target: 'stone',
        interactionStance: {
          kind: 'workstation',
          target: { name: 'crafting_table', x: 4, y: 64, z: 0 },
          status: 'failed',
          failureStage: 'path_not_found',
          code: 'noPath',
          candidateCount: 3,
          path: { status: 'noPath', length: 0 },
          interaction: { attempted: false, confirmed: false },
        },
      },
    },
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
  assert.equal(records[0].trigger.actionResult.interactionStance.failureStage, 'path_not_found');
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
