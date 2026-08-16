import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  ActionManager,
  currentActionExecutionContext,
  recordActionChild,
  recordActionTerminal,
} from '../../src/agent/action_manager.js';
import {
  ACTION_RECEIPT_LIMITS,
  createActionReceiptLedger,
} from '../../src/agent/runtime/action-receipt-ledger.js';
import {
  actionResultToTelemetry,
  createActionResult,
} from '../../src/agent/runtime/action-result.js';
import { getCommand } from '../../src/agent/commands/index.js';
import { recordCollectionActionTerminal } from '../../src/agent/commands/actions.js';

function createHarness(name = 'ReceiptBot') {
  const bot = new EventEmitter();
  bot.output = '';
  bot.interrupt_code = false;
  bot.lastActionEvidence = null;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  const agent = {
    name,
    bot,
    self_prompter: { isActive: () => false },
    history: { add() {} },
    behavior_arbiter: {
      recordActionStart() {},
      recordActionRelease() {},
      recordOutcome() {},
    },
    isIdle() { return !this.actions.executing; },
    requestInterrupt() { bot.interrupt_code = true; },
    clearBotLogs() {
      bot.output = '';
      bot.interrupt_code = false;
    },
    recordActionResult(result) { this.lastActionResult = result; },
  };
  agent.actions = new ActionManager(agent);
  return agent;
}

function mirrorTerminal(bot, evidence) {
  const recorded = recordActionTerminal(evidence);
  if (recorded.accepted) bot.lastActionEvidence = recorded.snapshot;
  return recorded;
}

test('an action ledger retains ordered child receipts and a distinct terminal reconciliation', () => {
  const ledger = createActionReceiptLedger('action-1', { mode: 'composed' });
  const first = ledger.recordChild('action-1', 'navigation', {
    kind: 'movement',
    outcome: 'path_not_found',
    retryable: true,
  });
  const second = ledger.recordChild('action-1', 'navigation', {
    kind: 'movement',
    outcome: 'arrived',
  });
  const terminal = ledger.recordTerminal('action-1', {
    kind: 'movement',
    outcome: 'arrived',
    target: { name: 'RouteGuide' },
    retryable: false,
  });
  const sealed = ledger.seal({ mirrorEvidence: terminal.snapshot });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.deepEqual(
    sealed.receipt.children.navigation.map(receipt => [receipt.sequence, receipt.outcome]),
    [[1, 'path_not_found'], [2, 'arrived']],
  );
  assert.equal(sealed.receipt.outcome, 'arrived');
  assert.equal(sealed.receipt.target.name, 'RouteGuide');
  assert.equal(sealed.receipt.contract.valid, true);
  assert.equal(Object.isFrozen(sealed.receipt), true);
  assert.equal(Object.isFrozen(sealed.receipt.children), true);
  assert.equal(Object.isFrozen(sealed.receipt.children.navigation), true);
  assert.equal(Object.isFrozen(sealed.receipt.children.navigation[0]), true);
});

test('a handled child failure can coexist with terminal action success', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:goToPlayer', () => {
    const child = recordActionChild('navigation', {
      kind: 'movement',
      outcome: 'path_timeout',
      retryable: true,
    });
    assert.equal(child.accepted, true);
    mirrorTerminal(agent.bot, {
      kind: 'movement',
      outcome: 'arrived',
      target: { name: 'RouteGuide' },
      retryable: false,
    });
    return true;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'skill_arrived');
  assert.equal(outcome.result.evidence.skill.outcome, 'arrived');
  assert.equal(outcome.result.evidence.skill.children.navigation[0].outcome, 'path_timeout');
});

test('composed success without a terminal receipt stays unknown and cannot use the legacy slot', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:missing-terminal', () => {
    const child = recordActionChild('navigation', { kind: 'movement', outcome: 'arrived' });
    agent.bot.lastActionEvidence = { kind: 'movement', outcome: 'arrived', retryable: true };
    assert.equal(child.accepted, true);
    return true;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'action_terminal_receipt_missing');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.source, 'action_context');
  assert.equal(outcome.result.evidence.skill.children.navigation[0].outcome, 'arrived');
});

test('field-absent retry authority remains conservative in composed mode', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:no-retry-field', () => {
    mirrorTerminal(agent.bot, { kind: 'movement', outcome: 'goal_not_reached' });
    return false;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'skill_goal_not_reached');
  assert.equal(outcome.result.retryable, false);
  assert.equal(Object.hasOwn(outcome.result.evidence.skill, 'retryable'), false);
});

test('collection compatibility adapter preserves component transactions in one composed terminal', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:collectWoodInRange', () => {
    agent.bot.lastActionEvidence = {
      kind: 'collect',
      outcome: 'collected',
      target: { name: 'oak_log', x: 4, y: 64, z: 7 },
      count: 4,
      componentTransactions: [{
        kind: 'tree',
        componentId: 'oak_log:4:64:7',
        acquiredQuantity: 4,
        remainingComponentCount: 0,
        temporaryRemaining: 0,
        terrainSettled: true,
      }],
      retryable: false,
    };
    const recorded = recordCollectionActionTerminal(agent.bot, true);
    assert.equal(recorded.accepted, true);
    assert.equal(recorded.valid, true);
    return recorded.valid;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'skill_collected');
  assert.equal(outcome.result.evidence.skill.contract.valid, true);
  assert.equal(outcome.result.evidence.skill.source, 'action_context');
  assert.equal(outcome.result.evidence.skill.componentTransactions[0].componentId, 'oak_log:4:64:7');
});

test('collection compatibility adapter fails closed instead of promoting unrelated evidence', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:collectWoodInRange', () => {
    agent.bot.lastActionEvidence = {
      kind: 'movement',
      outcome: 'arrived',
      target: { name: 'stale-target' },
      retryable: true,
    };
    const recorded = recordCollectionActionTerminal(agent.bot, true);
    assert.equal(recorded.accepted, true);
    assert.equal(recorded.valid, false);
    return recorded.valid;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'skill_collection_terminal_invalid');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.contract.valid, true);
  assert.equal(outcome.result.evidence.skill.observed.kind, 'movement');
});

test('collection compatibility adapter requires positive custody evidence for claimed success', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:collectWoodInRange', () => {
    agent.bot.lastActionEvidence = {
      kind: 'collect',
      outcome: 'collected',
      target: { name: 'oak_log' },
      retryable: false,
    };
    const recorded = recordCollectionActionTerminal(agent.bot, true);
    assert.equal(recorded.accepted, true);
    assert.equal(recorded.valid, false);
    return recorded.valid;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'skill_collection_terminal_invalid');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.observed.count, null);
});

test('collection compatibility adapter retains verified segmented mining progress as a failed action terminal', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:collectBlocksInRange', () => {
    agent.bot.lastActionEvidence = {
      kind: 'mining_search',
      outcome: 'search_advanced',
      target: { name: 'iron_ore', x: 20, y: 40, z: 5 },
      routeSteps: 4,
      returnable: true,
      retryable: false,
    };
    const recorded = recordCollectionActionTerminal(agent.bot, false);
    assert.equal(recorded.accepted, true);
    assert.equal(recorded.valid, true);
    return false;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'skill_search_advanced');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.contract.valid, true);
  assert.equal(outcome.result.evidence.skill.returnable, true);
});

test('the real follow command seals a truthful composed terminal when its player is absent', async () => {
  const agent = createHarness('Kevin');
  agent.bot.username = 'Kevin';
  agent.bot.players = {};

  await getCommand('!followPlayer').perform(agent, 'MissingPlayer', 3);

  assert.equal(agent.lastActionResult.phase, 'failed');
  assert.equal(agent.lastActionResult.code, 'skill_waiting_for_target');
  assert.equal(agent.lastActionResult.evidence.skill.source, 'action_context');
  assert.equal(agent.lastActionResult.evidence.skill.outcome, 'waiting_for_target');
  assert.equal(agent.lastActionResult.evidence.skill.contract.valid, true);
});

test('legacy mode remains compatible but is explicitly marked as unmigrated', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:legacy', () => {
    agent.bot.lastActionEvidence = {
      kind: 'movement',
      outcome: 'arrived',
      target: { name: 'RouteGuide' },
    };
    return true;
  });

  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(outcome.result.code, 'skill_arrived');
  assert.equal(outcome.result.evidence.skill.source, 'legacy_fallback');
  assert.equal(outcome.result.evidence.skill.contract.valid, null);
  assert.deepEqual(outcome.result.evidence.skill.children, {});
});

test('receipt overflow retains bounded first and latest evidence with visible counts', () => {
  const ledger = createActionReceiptLedger('action-overflow', { mode: 'composed' });
  for (let index = 1; index <= 70; index += 1) {
    ledger.recordChild('action-overflow', 'navigation', {
      kind: 'movement',
      outcome: `segment_${index}`,
    });
  }
  const terminal = ledger.recordTerminal('action-overflow', {
    kind: 'movement',
    outcome: 'goal_not_reached',
    retryable: false,
  });
  const receipt = ledger.seal({ mirrorEvidence: terminal.snapshot }).receipt;

  assert.equal(receipt.children.navigation.length, ACTION_RECEIPT_LIMITS.maxRelationshipReceipts);
  assert.deepEqual(receipt.children.navigation.slice(0, 8).map(child => child.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(receipt.children.navigation.slice(-8).map(child => child.sequence), [63, 64, 65, 66, 67, 68, 69, 70]);
  assert.deepEqual(receipt.overflow.global, {
    total: 70,
    retained: 16,
    dropped: 54,
    firstDroppedSequence: 9,
    lastDroppedSequence: 62,
  });
  assert.deepEqual(receipt.overflow.relationships.navigation, receipt.overflow.global);
});

test('global overflow retains the first and latest 24 receipts across relationships', () => {
  const ledger = createActionReceiptLedger('action-global-overflow', { mode: 'composed' });
  const relationships = ['selection', 'navigation', 'interaction', 'collection'];
  for (let index = 1; index <= 60; index += 1) {
    ledger.recordChild(
      'action-global-overflow',
      relationships[(index - 1) % relationships.length],
      { kind: 'stage', outcome: `stage_${index}` },
    );
  }
  const terminal = ledger.recordTerminal('action-global-overflow', {
    kind: 'movement',
    outcome: 'arrived',
    retryable: false,
  });
  const receipt = ledger.seal({ mirrorEvidence: terminal.snapshot }).receipt;
  const retainedSequences = Object.values(receipt.children)
    .flat()
    .map(child => child.sequence)
    .sort((left, right) => left - right);

  assert.equal(retainedSequences.length, 48);
  assert.deepEqual(retainedSequences.slice(0, 24), Array.from({ length: 24 }, (_, index) => index + 1));
  assert.deepEqual(retainedSequences.slice(-24), Array.from({ length: 24 }, (_, index) => index + 37));
  assert.deepEqual(receipt.overflow.global, {
    total: 60,
    retained: 48,
    dropped: 12,
    firstDroppedSequence: 25,
    lastDroppedSequence: 36,
  });
});

test('terminal oversize fails closed while retaining bounded child evidence', () => {
  const ledger = createActionReceiptLedger('action-terminal-oversize', { mode: 'composed' });
  ledger.recordChild('action-terminal-oversize', 'navigation', {
    kind: 'movement',
    outcome: 'path_not_found',
  });
  const repeated = Array.from({ length: 96 }, () => 'x'.repeat(1_200));
  const huge = Object.fromEntries(Array.from({ length: 96 }, (_, index) => [`field_${index}`, repeated]));
  const terminal = ledger.recordTerminal('action-terminal-oversize', {
    kind: 'movement',
    outcome: 'arrived',
    huge,
  });
  const receipt = ledger.seal({ mirrorEvidence: terminal.snapshot }).receipt;

  assert.equal(receipt.contract.code, 'terminal_receipt_oversized');
  assert.equal(receipt.retryable, false);
  assert.equal(receipt.children.navigation[0].outcome, 'path_not_found');
  assert.ok(Buffer.byteLength(JSON.stringify(receipt), 'utf8') <= ACTION_RECEIPT_LIMITS.maxComposedReceiptBytes);
});

test('duplicate terminal and child-after-terminal writes invalidate success without replacing the first terminal', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:duplicate-terminal', () => {
    const first = mirrorTerminal(agent.bot, {
      kind: 'movement',
      outcome: 'arrived',
      retryable: false,
    });
    assert.equal(first.accepted, true);
    assert.equal(recordActionTerminal({ kind: 'movement', outcome: 'second' }).accepted, false);
    assert.equal(recordActionChild('navigation', { kind: 'movement', outcome: 'late' }).accepted, false);
    return true;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'action_receipt_contract_violation');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.outcome, 'arrived');
  assert.deepEqual(outcome.result.evidence.skill.children, {});
});

test('a direct legacy write cannot diverge from a composed terminal and authorize success', async () => {
  const agent = createHarness();
  const outcome = await agent.actions.runAction('action:mirror-mismatch', () => {
    mirrorTerminal(agent.bot, { kind: 'movement', outcome: 'arrived', retryable: false });
    agent.bot.lastActionEvidence = { kind: 'movement', outcome: 'invented_success', retryable: true };
    return true;
  }, { receiptMode: 'composed', timeout: -1 });

  assert.equal(outcome.result.phase, 'failed');
  assert.equal(outcome.result.code, 'action_receipt_contract_violation');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.outcome, 'arrived');
  assert.deepEqual(outcome.result.evidence.skill.contract.violations, ['action_evidence_mirror_mismatch']);
});

test('a floating async writer is rejected after seal and cannot contaminate a replacement action', async () => {
  const agent = createHarness();
  let lateWrite;
  let releaseLateWrite;
  const lateGate = new Promise(resolve => { releaseLateWrite = resolve; });
  const first = await agent.actions.runAction('action:first', () => {
    void lateGate.then(() => { lateWrite = recordActionChild('navigation', { outcome: 'late' }); });
    mirrorTerminal(agent.bot, { kind: 'movement', outcome: 'arrived', retryable: false });
    return true;
  }, { receiptMode: 'composed', timeout: -1 });
  const second = await agent.actions.runAction('action:replacement', () => {
    mirrorTerminal(agent.bot, { kind: 'movement', outcome: 'replacement_arrived', retryable: false });
    return true;
  }, { receiptMode: 'composed', timeout: -1 });
  releaseLateWrite();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(first.result.phase, 'succeeded');
  assert.equal(second.result.phase, 'succeeded');
  assert.equal(lateWrite.code, 'stale_action_receipt_rejected');
  assert.equal(agent.bot.lastActionEvidence.outcome, 'replacement_arrived');
  assert.equal(second.result.evidence.skill.outcome, 'replacement_arrived');
});

test('exception sealing preserves child evidence but rejects later writers', async () => {
  const agent = createHarness();
  let lateWrite;
  let releaseLateWrite;
  const lateGate = new Promise(resolve => { releaseLateWrite = resolve; });
  const outcome = await agent.actions.runAction('action:throws', () => {
    recordActionChild('navigation', { kind: 'movement', outcome: 'path_stalled' });
    void lateGate.then(() => { lateWrite = recordActionChild('cleanup', { outcome: 'late_cleanup' }); });
    throw new Error('receipt exception sentinel');
  }, { receiptMode: 'composed', timeout: -1 });
  releaseLateWrite();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(outcome.result.code, 'runtime_error');
  assert.equal(outcome.result.retryable, false);
  assert.equal(outcome.result.evidence.skill.contract.code, 'action_terminal_receipt_missing');
  assert.equal(outcome.result.evidence.skill.children.navigation[0].outcome, 'path_stalled');
  assert.equal(lateWrite.code, 'stale_action_receipt_rejected');
});

test('cooperative cancellation accepts the action terminal before sealing', async () => {
  const agent = createHarness();
  let actionStarted;
  const started = new Promise(resolve => { actionStarted = resolve; });
  let cancelledWrite;
  const running = agent.actions.runAction('action:cancelled', async () => {
    const signal = currentActionExecutionContext().signal;
    recordActionChild('navigation', { kind: 'movement', outcome: 'in_progress' });
    actionStarted();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    cancelledWrite = mirrorTerminal(agent.bot, {
      kind: 'movement',
      outcome: 'interrupted',
      retryable: false,
    });
    return false;
  }, { receiptMode: 'composed', timeout: -1 });
  await started;
  const stopped = await agent.actions.stop();
  const outcome = await running;

  assert.equal(stopped.stopped, true);
  assert.equal(cancelledWrite.accepted, true);
  assert.equal(cancelledWrite.code, 'action_terminal_receipt_recorded');
  assert.equal(outcome.result.phase, 'interrupted');
  assert.equal(outcome.result.code, 'interrupted');
  assert.equal(outcome.result.evidence.skill.contract.valid, true);
  assert.equal(outcome.result.evidence.skill.outcome, 'interrupted');
  assert.equal(outcome.result.evidence.skill.children.navigation[0].outcome, 'in_progress');
});

test('ActionResult recursively freezes a separately normalized evidence tree', () => {
  const source = { skill: { kind: 'movement', nested: { values: [1, 2] } } };
  const result = createActionResult({ phase: 'succeeded', evidence: source });
  source.skill.nested.values.push(3);

  assert.deepEqual(result.evidence.skill.nested.values, [1, 2]);
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(Object.isFrozen(result.evidence.skill), true);
  assert.equal(Object.isFrozen(result.evidence.skill.nested), true);
  assert.equal(Object.isFrozen(result.evidence.skill.nested.values), true);
  assert.throws(() => result.evidence.skill.nested.values.push(4), TypeError);
});

test('ActionResult telemetry exposes only bounded receipt contract and child summaries', () => {
  const ledger = createActionReceiptLedger('action-telemetry', { mode: 'composed' });
  ledger.recordChild('action-telemetry', 'navigation', {
    kind: 'movement',
    outcome: 'arrived',
    stage: 'live_player_pursuit',
    segments: [{ privateRoute: 'not promoted' }],
  });
  const terminal = ledger.recordTerminal('action-telemetry', {
    kind: 'movement',
    outcome: 'arrived',
    retryable: false,
  });
  const skill = ledger.seal({ mirrorEvidence: terminal.snapshot }).receipt;
  const result = createActionResult({
    actionId: 'action-telemetry',
    phase: 'succeeded',
    code: 'skill_arrived',
    evidence: { skill },
  });
  const telemetry = actionResultToTelemetry(result);

  assert.equal(telemetry.receipt.contract.valid, true);
  assert.equal(telemetry.receipt.children.navigation[0].stage, 'live_player_pursuit');
  assert.equal(telemetry.receipt.children.navigation[0].segmentCount, 1);
  assert.equal(Object.hasOwn(telemetry.receipt.children.navigation[0], 'segments'), false);
});
