import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  ambientSelfDefensePermitted,
  durablePlayerAccompanimentActive,
  explosiveReflexEligibility,
  executeModeAction,
  initModes,
  runBoundedUnstuckRecovery,
  selfDefenseFailedTacticalReceipt,
  selfDefenseRecoveryOwnsSameThreat,
  selfDefenseReflexEligibility,
} from '../../src/agent/modes.js';
import {
  Agent,
  boundedChatSegments,
  configureSurvivalOwnership,
  correlatedPersistentGoalAssignmentAccepted,
  correlatedPersistentJobSubmissionAccepted,
  emitStartupMilestone,
  hasPendingDeathRecovery,
  modelCommandAwaitsPlayerConfirmation,
  shouldSeedLegacyDefaultGoal,
} from '../../src/agent/agent.js';
import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { AgendaDirector } from '../../src/agent/runtime/agenda-director.js';
import { Prompter } from '../../src/models/prompter.js';
import { AgentProcess, sanitizeAgentDiagnostic } from '../../src/process/agent_process.js';
class FakeChildProcess extends EventEmitter {
  constructor(killResults = [true]) {
    super();
    this.killed = false;
    this.killCalls = [];
    this.killResults = killResults;
  }

  kill(signal) {
    this.killCalls.push(signal);
    const accepted = this.killResults.shift() ?? false;
    if (accepted) this.killed = true;
    return accepted;
  }

  emit(eventName, ...args) {
    if (eventName === 'spawn' && !this.pid) this.pid = 1000;
    return super.emit(eventName, ...args);
  }
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

test('long companion replies become complete ordered Minecraft chat segments', () => {
  const response = [
    '1. Restore health and secure food before leaving the outpost.',
    '2. Replace the lost tools and carry only the equipment the family needs.',
    '3. Confirm the nearby area is safe so preparation is not interrupted.',
    'The final sentence must remain visible to the player instead of becoming an ellipsis.',
  ].join(' '.repeat(45));
  const normalized = response.replace(/\s+/g, ' ').trim();

  const segments = boundedChatSegments(response);

  assert.ok(segments.length > 1);
  assert.ok(segments.every(segment => segment.length <= 240));
  assert.deepEqual(
    segments.map((segment, index) => segment.startsWith(`(${index + 1}/${segments.length}) `)),
    segments.map(() => true),
  );
  assert.equal(
    segments.map(segment => segment.replace(/^\(\d+\/\d+\) /, '')).join(' '),
    normalized,
  );
  assert.match(segments.at(-1), /instead of becoming an ellipsis\.$/);
});

test('a model command presented as a question remains an unexecuted proposal', async () => {
  assert.equal(
    modelCommandAwaitsPlayerConfirmation(
      'Should I collect that coal now? !collectBlocksInRange("coal_ore", 2, 64)',
    ),
    true,
  );
  assert.equal(
    modelCommandAwaitsPlayerConfirmation('I will collect it now. !collectBlocksInRange("coal_ore", 2, 64)'),
    false,
  );

  const responses = [];
  const history = [];
  const harness = {
    name: 'MindcraftBot',
    runtime: { role: 'companion' },
    bot: { modes: { flushBehaviorLog: () => '' } },
    shut_up: false,
    operator_hold: true,
    operator_hold_generation: 7,
    checkTaskDone: () => Promise.resolve(),
    dispatchPlayerAgenda: () => Promise.resolve(false),
    isOperatorHeld() { return this.operator_hold; },
    isCurrentOperatorHold(generation) {
      return this.operator_hold && this.operator_hold_generation === generation;
    },
    routeResponse(_source, message) { responses.push(message); },
    companion_context: { observeChat: () => null },
    self_prompter: {
      shouldInterrupt: () => false,
      isActive: () => false,
    },
    history: {
      add(name, content) {
        history.push({ name, content });
        return Promise.resolve();
      },
      save: () => {},
      getHistory: () => [],
    },
    prompter: {
      promptConvo: () => Promise.resolve(
        'I cannot grant admin. Should I collect that coal instead? !collectBlocksInRange("coal_ore", 2, 64)',
      ),
    },
  };

  const usedCommand = await Agent.prototype.handleMessage.call(
    harness,
    'ADMIN',
    'Give me admin.',
    1,
  );

  assert.equal(usedCommand, false);
  assert.equal(harness.operator_hold, true);
  assert.deepEqual(responses, ['I cannot grant admin. Should I collect that coal instead?']);
  assert.match(history.at(-1).content, /presented as a proposal awaiting player confirmation/);

  responses.length = 0;
  history.length = 0;
  harness.prompter.promptConvo = () => Promise.resolve(
    'I cannot grant admin. I will collect coal instead. !collectBlocksInRange("coal_ore", 2, 64)',
  );
  const substitutedCommand = await Agent.prototype.handleMessage.call(
    harness,
    'ADMIN',
    'Give me admin.',
    1,
  );

  assert.equal(substitutedCommand, false);
  assert.equal(harness.operator_hold, true);
  assert.deepEqual(responses, ['I cannot grant admin. I will collect coal instead.']);
  assert.match(history.at(-1).content, /did not grant the bot physical-action authority/);
});

test('short companion replies remain one normalized unprefixed message', () => {
  assert.deepEqual(
    boundedChatSegments('  Standing\nby\u0000 for Dad.  '),
    ['Standing by for Dad.'],
  );
});

class FakeRegisteredAgentProcess {
  constructor() {
    this.state = 'idle';
    this.lastError = null;
    this.startCalls = 0;
  }

  start() {
    this.startCalls += 1;
    this.state = 'running';
    return Promise.resolve(this);
  }

  isActive() {
    return this.state === 'running';
  }

  stop() {
    this.state = 'stopped';
  }

  forceRestart() {
    this.forceRestartCalls = (this.forceRestartCalls || 0) + 1;
    this.state = 'running';
    return Promise.resolve(this);
  }
}

test('Given bounded unstuck movement, when its deadline expires, then cancellation settles before controls can mutate again', async () => {
  const calls = {
    clearControlStates: 0,
    cleanKill: 0,
    requestInterrupt: 0,
    delayedControlMutation: 0,
  };
  const agent = {
    bot: {
      clearControlStates() {
        calls.clearControlStates += 1;
      },
    },
    cleanKill() {
      calls.cleanKill += 1;
    },
    requestInterrupt() {
      calls.requestInterrupt += 1;
    },
  };

  const result = await runBoundedUnstuckRecovery(agent, {
    moveAway: (_bot, _distance, { signal }) => new Promise(resolve => {
      const delayedMutation = setTimeout(() => {
        calls.delayedControlMutation += 1;
        resolve(true);
      }, 25);
      signal.addEventListener('abort', () => {
        clearTimeout(delayedMutation);
        resolve(false);
      }, { once: true });
    }),
    timeoutMs: 5,
  });

  await new Promise(resolve => setTimeout(resolve, 30));

  assert.deepEqual(result, { success: false, reason: 'timed-out' });
  assert.equal(calls.requestInterrupt, 1);
  assert.equal(calls.clearControlStates, 1);
  assert.equal(calls.cleanKill, 0);
  assert.equal(calls.delayedControlMutation, 0);
});

test('Given a fire-and-forget mode action rejects, when it settles, then the rejection is contained and active state is cleared', async () => {
  const originalConsoleError = console.error;
  const reportedErrors = [];
  console.error = message => reportedErrors.push(String(message));
  const mode = { name: 'test-mode', active: false };
  const agent = {
    actions: {
      currentActionLabel: '',
      resume_func: null,
      runAction: () => {
        const error = new Error('expected test rejection');
        error.name = 'PathStopped';
        return Promise.reject(error);
      },
    },
    self_prompter: {
      isActive: () => false,
      stopLoop() {},
    },
  };

  try {
    const result = await executeModeAction(mode, agent, async () => {});
    assert.equal(result.success, false);
    assert.equal(mode.active, false);
    assert.match(reportedErrors.join('\n'), /expected test rejection/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('a stale warning-range Creeper handoff cannot repeatedly steal unchanged player work', () => {
  const threat = {
    id: 11723,
    uuid: 'creeper-11723',
    position: { x: 9, y: 64, z: 0 },
  };
  const agent = {
    bot: {
      lastDamageTime: 1_000,
      entity: {
        position: {
          distanceTo(position) {
            return Math.hypot(position.x, position.y - 64, position.z);
          },
        },
      },
    },
    actions: { currentActionLabel: 'action:harvestEntityDrop' },
    goal_director: { activeGoal: { id: 'goal-fishing-breakfast' } },
  };

  const first = explosiveReflexEligibility(agent, threat);
  assert.equal(first.eligible, true);
  assert.equal(first.receipt.rangeBand, 'warning');

  const repeated = explosiveReflexEligibility(agent, threat, first.receipt);
  assert.equal(repeated.eligible, false);
  assert.equal(repeated.code, 'stale_explosive_trigger_suppressed');

  threat.position.x = 5.5;
  assert.equal(explosiveReflexEligibility(agent, threat, first.receipt).eligible, true);

  threat.position.x = 9;
  agent.bot.lastDamageTime += 1;
  assert.equal(explosiveReflexEligibility(agent, threat, first.receipt).eligible, true);

  agent.bot.lastDamageTime = 1_000;
  agent.actions.currentActionLabel = 'action:craftRecipe';
  assert.equal(explosiveReflexEligibility(agent, threat, first.receipt).eligible, true);
});

test('an unreachable critical retreat waits for feasibility-bearing Minecraft evidence', () => {
  const agent = {
    bot: {
      health: 3.333332,
      lastDamageTime: 1_000,
      game: { dimension: 'overworld' },
      entity: { position: { x: 8104.56, y: 64, z: 7941.5 } },
    },
  };
  const threat = {
    id: 76186,
    uuid: 'pillager-76186',
    name: 'phantom',
    onGround: false,
    position: { x: 8104.9, y: 65, z: 7943.5 },
  };
  const failedExecution = {
    success: false,
    interrupted: false,
    result: {
      phase: 'failed',
      code: 'skill_unreachable',
      evidence: {
        skill: {
          kind: 'tactical_combat',
          outcome: 'unreachable',
          decisions: [{ target: { id: 76186 }, response: 'retreat', reason: 'critical_health' }],
          retreatDistanceBefore: 2.3,
          retreatDistanceAfter: 2.5,
        },
      },
    },
  };

  const failedReceipt = selfDefenseFailedTacticalReceipt(agent, threat, failedExecution);
  assert.ok(failedReceipt);
  assert.equal(failedReceipt.failureCode, 'skill_unreachable');
  assert.equal(failedReceipt.failureStage, 'route_unavailable');
  assert.equal(failedReceipt.responseReason, 'critical_health');
  assert.equal(selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible, false);
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).code,
    'unchanged_failed_tactical_suppressed',
  );

  threat.position.x += 1;
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    false,
    'ambient hostile wandering is not new retry authority for a settled failure',
  );
  agent.bot.entity.position.x += 1;
  assert.equal(selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible, true);
  agent.bot.entity.position.x -= 1;
  agent.bot.health = 2;
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    false,
    'worsening health increases urgency but does not make the failed route feasible',
  );
  agent.bot.health = 3.333332;
  agent.bot.lastDamageTime += 1;
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    false,
    'another hit is not route-feasibility evidence',
  );
  agent.bot.lastDamageTime = 1_000;
  agent.bot.game.dimension = 'the_nether';
  assert.equal(selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible, true);
  agent.bot.game.dimension = 'overworld';
  agent.bot.health = 9;
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    true,
    'leaving the critical-health band can select a physically different tactic',
  );
  agent.bot.health = 3.333332;
  threat.uuid = 'replacement-pillager';
  threat.id += 1;
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    false,
    'equivalent airborne entity churn cannot bypass the route latch',
  );
  threat.onGround = true;
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    true,
    'a grounded target can expose a different last-resort response',
  );
  threat.onGround = false;
  threat.name = 'spider';
  assert.equal(
    selfDefenseReflexEligibility(agent, threat, failedReceipt).eligible,
    true,
    'a different threat class is not silently suppressed',
  );

  const failedMelee = selfDefenseFailedTacticalReceipt(agent, threat, {
    success: false,
    interrupted: false,
    result: {
      phase: 'failed',
      code: 'skill_combat_timeout',
      evidence: {
        skill: {
          kind: 'tactical_combat',
          outcome: 'combat_timeout',
          retryable: true,
          decisions: [{ target: { id: 76186 }, response: 'melee', reason: 'close_safe_hostile' }],
        },
      },
    },
  });
  assert.ok(failedMelee);
  assert.equal(failedMelee.failureOutcome, 'combat_timeout');
  assert.equal(failedMelee.response, 'melee');
  assert.equal(selfDefenseReflexEligibility(agent, threat, failedMelee).eligible, false);

  assert.equal(selfDefenseFailedTacticalReceipt(agent, threat, {
    ...failedExecution,
    interrupted: true,
    result: { ...failedExecution.result, phase: 'interrupted' },
  }), null);
  assert.equal(selfDefenseFailedTacticalReceipt(agent, threat, {
    ...failedExecution,
    result: {
      ...failedExecution.result,
      evidence: {
        skill: {
          ...failedExecution.result.evidence.skill,
          retryable: false,
        },
      },
    },
  }), null);
});

test('the self-defense mode does not redispatch an unchanged critical airborne route failure', async () => {
  const position = (x, y, z) => ({
    x,
    y,
    z,
    distanceTo(other) {
      return Math.hypot(x - other.x, y - other.y, z - other.z);
    },
  });
  const botPosition = position(-378.56, 63, 18.5);
  let threat = {
    id: 31393,
    uuid: 'phantom-31393',
    name: 'phantom',
    type: 'hostile',
    onGround: false,
    position: position(-375, 67, 20),
  };
  let actionRuns = 0;
  const bot = {
    health: 3,
    lastDamageTime: Date.now(),
    lastDamageSource: {
      matchesSelf: true,
      observedAt: Date.now(),
      kind: 'hostile',
      source: { id: threat.id, name: threat.name },
    },
    game: { dimension: 'overworld' },
    entity: { position: botPosition },
    entities: { [threat.id]: threat },
    nearestEntity(predicate) {
      return predicate(threat) ? threat : null;
    },
  };
  const agent = {
    bot,
    runtime: { autonomy: 'command' },
    prompter: { getInitModes: () => null },
    actions: {
      executing: false,
      currentActionLabel: '',
      currentActionOwner: '',
      async runAction() {
        actionRuns += 1;
        return { success: false, interrupted: false };
      },
    },
    isIdle: () => true,
  };
  initModes(agent);

  const failedReceipt = selfDefenseFailedTacticalReceipt(agent, threat, {
    success: false,
    interrupted: false,
    result: {
      phase: 'failed',
      code: 'skill_unreachable',
      evidence: {
        skill: {
          kind: 'tactical_combat',
          outcome: 'unreachable',
          retryable: true,
          decisions: [{ target: { id: threat.id }, response: 'retreat', reason: 'critical_health' }],
        },
      },
    },
  });
  bot.modes.modeMap.self_defense.failed_tactical_trigger = failedReceipt;

  bot.modes.beginUpdateCycle();
  const sameThreat = await bot.modes.updateBand(['self_defense']);
  bot.modes.endUpdateCycle();
  assert.equal(sameThreat.code, 'unchanged_failed_tactical_suppressed');
  assert.equal(actionRuns, 0);

  bot.health = 1;
  bot.lastDamageTime += 1;
  bot.lastDamageSource.observedAt = Date.now();
  threat = {
    ...threat,
    id: 31394,
    uuid: 'phantom-31394',
    position: position(-374, 66, 19),
  };
  bot.entities = { [threat.id]: threat };
  bot.lastDamageSource.source = { id: threat.id, name: threat.name };

  bot.modes.beginUpdateCycle();
  const replacementThreat = await bot.modes.updateBand(['self_defense']);
  bot.modes.endUpdateCycle();
  assert.equal(replacementThreat.code, 'unchanged_failed_tactical_suppressed');
  assert.equal(actionRuns, 0, 'damage and equivalent Phantom churn cannot create another action');
});

test('a standing follow gets one immutable attributed-threat proposal and bypasses legacy reflex choice', async () => {
  const threat = {
    id: 442,
    uuid: 'skeleton-442',
    name: 'skeleton',
    type: 'hostile',
    position: { x: 3, y: 64, z: 0 },
  };
  let actionRuns = 0;
  const bot = {
    health: 7,
    lastDamageTaken: 4,
    lastDamageTime: Date.now(),
    lastDamageSource: {
      matchesSelf: true,
      observedAt: Date.now(),
      kind: 'hostile',
      source: { id: threat.id, name: threat.name },
    },
    game: { dimension: 'overworld' },
    entity: { position: { x: 0, y: 64, z: 0 } },
    entities: { [threat.id]: threat },
    nearestEntity(predicate) { return predicate(threat) ? threat : null; },
  };
  const agent = {
    bot,
    runtime: { autonomy: 'command' },
    prompter: { getInitModes: () => null },
    companion_context: {
      directive: 'follow',
      canonicalUsername: 'DadPlayer',
      directiveAuthorizedAt: 700,
      presence: 'present',
      protection: null,
    },
    actions: {
      executing: false,
      currentActionLabel: '',
      currentActionOwner: '',
      runAction() { actionRuns += 1; },
    },
    isIdle: () => true,
  };
  initModes(agent);

  const proposal = bot.modes.proposeAttributedAccompaniment();
  assert.equal(Object.isFrozen(proposal), true);
  assert.equal(Object.isFrozen(proposal.threat), true);
  assert.deepEqual({
    applicable: proposal.applicable,
    directive: proposal.directive.directive,
    player: proposal.directive.canonicalUsername,
    threatId: proposal.threat.entityId,
    attribution: proposal.threat.attribution,
    retreatRequired: proposal.retreatRequired,
  }, {
    applicable: true,
    directive: 'follow',
    player: 'DadPlayer',
    threatId: 442,
    attribution: 'self_damage',
    retreatRequired: true,
  });

  bot.modes.beginUpdateCycle();
  const legacy = await bot.modes.updateBand(
    ['self_defense', 'cowardice'],
    { skipAttributedAccompaniment: true },
  );
  bot.modes.endUpdateCycle();
  assert.equal(legacy.code, 'shared_accompaniment_policy_owns_threat');
  assert.equal(actionRuns, 0);
});

test('an attributed tactical dispatch fails closed unless survival accepts the same live threat first', async () => {
  const threat = {
    id: 443,
    uuid: 'skeleton-443',
    name: 'skeleton',
    type: 'hostile',
    position: { x: 3, y: 64, z: 0 },
  };
  let actionRuns = 0;
  let acceptIncident = false;
  const observed = [];
  const bot = {
    health: 7,
    lastDamageTaken: 4,
    lastDamageTime: Date.now(),
    lastDamageSource: {
      matchesSelf: true,
      observedAt: Date.now(),
      kind: 'hostile',
      source: { id: threat.id, name: threat.name },
    },
    game: { dimension: 'overworld' },
    entity: { position: { x: 0, y: 64, z: 0 } },
    entities: { [threat.id]: threat },
    nearestEntity(predicate) { return predicate(threat) ? threat : null; },
  };
  const agent = {
    bot,
    runtime: { autonomy: 'command' },
    prompter: { getInitModes: () => null },
    companion_context: {
      directive: 'follow',
      canonicalUsername: 'DadPlayer',
      directiveAuthorizedAt: 701,
      presence: 'present',
      protection: null,
    },
    survival_director: {
      observeAttributedThreat(receipt) {
        observed.push(receipt);
        return acceptIncident;
      },
    },
    self_prompter: { isActive: () => false, stopLoop() {} },
    actions: {
      executing: false,
      currentActionLabel: '',
      currentActionOwner: '',
      runAction() {
        actionRuns += 1;
        return Promise.resolve({ success: false, interrupted: false });
      },
    },
    isIdle: () => true,
    openChat() {},
  };
  initModes(agent);

  const proposal = bot.modes.proposeAttributedAccompaniment();
  const dispatch = bot.modes.dispatchAttributedAccompaniment('retreat', proposal);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(observed, [proposal.threat]);
  assert.deepEqual(dispatch, {
    active: false,
    scheduled: false,
    mode: 'self_preservation',
    code: 'safety_incident_unavailable',
  });
  assert.equal(actionRuns, 0, 'combat cannot take the body without a durable recovery obligation');

  acceptIncident = true;
  const accepted = bot.modes.dispatchAttributedAccompaniment('retreat', proposal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observed.length, 2);
  assert.equal(observed[1], proposal.threat);
  assert.equal(accepted.scheduled, true);
  assert.equal(accepted.code, 'shared_accompaniment_intent_scheduled');
  assert.equal(actionRuns, 1, 'accepted survival ownership permits exactly one tactical action');
});

test('player movement excludes ambient combat while fresh damage remains separate reflex authority', () => {
  const agent = {
    actions: {
      executing: true,
      currentActionOwner: 'player',
      currentActionLabel: 'action:goToPlayer',
    },
  };

  assert.equal(ambientSelfDefensePermitted(agent), false);
  agent.actions.currentActionOwner = 'survival';
  assert.equal(ambientSelfDefensePermitted(agent), true);
  agent.actions.executing = false;
  agent.actions.currentActionOwner = 'player';
  assert.equal(ambientSelfDefensePermitted(agent), true);

  agent.companion_context = { snapshot: () => ({ directive: 'follow' }) };
  assert.equal(durablePlayerAccompanimentActive(agent), true);
  assert.equal(
    ambientSelfDefensePermitted(agent),
    false,
    'the standing follow commitment survives the idle reflex handoff gap',
  );
  agent.companion_context.snapshot = () => ({ directive: 'guard' });
  assert.equal(ambientSelfDefensePermitted(agent), false);
  agent.companion_context.snapshot = () => ({ directive: null });
  assert.equal(durablePlayerAccompanimentActive(agent), false);
  assert.equal(ambientSelfDefensePermitted(agent), true);
});

test('a protection reflex names the attacked player and resumes a standing follow commitment', async () => {
  const chat = [];
  let resumes = 0;
  let result = { success: true, interrupted: false };
  const mode = { name: 'self_defense', active: false };
  const agent = {
    bot: {},
    actions: {
      currentActionLabel: '',
      async runAction(_label, action) {
        await action();
        return result;
      },
    },
    companion_context: { snapshot: () => ({ directive: 'follow' }) },
    self_prompter: { isActive: () => false, stopLoop() {} },
    openChat(message) { chat.push(message); },
    behavior_arbiter: { requestDirectiveResume() { resumes += 1; } },
  };

  await executeModeAction(mode, agent, () => true, -1, {
    handoffMessage: 'FarmGuide was attacked by husk. I am stepping in, then I will resume your order.',
  });
  await Promise.resolve();

  assert.deepEqual(chat, [
    'FarmGuide was attacked by husk. I am stepping in, then I will resume your order.',
    'I am clear. Resuming your order now.',
  ]);
  assert.equal(resumes, 1);

  result = { success: false, interrupted: false, message: 'The bot died.' };
  await executeModeAction(mode, agent, () => false, -1, {
    handoffMessage: 'FarmGuide was attacked by husk. I am stepping in, then I will resume your order.',
  });
  await Promise.resolve();
  assert.equal(resumes, 1, 'failed safety settlement cannot resume a standing directive');
});

test('pending death inventory blocks stale companion continuation after respawn', () => {
  let resumeReads = 0;
  const pending = {
    recallDeath: () => ({ inventory: { stone_pickaxe: 1, bread: 2 }, recoveredAt: null }),
  };
  assert.equal(hasPendingDeathRecovery(pending), true);
  assert.equal(hasPendingDeathRecovery({ recallDeath: () => ({ inventory: {}, recoveredAt: null }) }), false);
  assert.equal(hasPendingDeathRecovery({ recallDeath: () => ({ inventory: { bread: 2 }, recoveredAt: 123 }) }), false);
  assert.equal(hasPendingDeathRecovery({
    recallLatestDeath: () => ({
      inventory: { bread: 2 },
      recoveredAt: null,
      recordedAt: 100,
    }),
  }, { after: 200 }), false, 'later explicit player authority supersedes an older recovery obligation');
  assert.equal(hasPendingDeathRecovery({
    recallLatestDeath: () => ({
      inventory: { bread: 2 },
      recoveredAt: null,
      recordedAt: 300,
    }),
  }, { after: 200 }), true, 'a death newer than the standing order still censors automatic resume');

  const resumed = Agent.prototype.resumeCompanionDirective.call({
    _runtimeStopped: false,
    isOperatorHeld: () => false,
    isIdle: () => true,
    memory_bank: pending,
    companion_context: {
      resumeCommand() {
        resumeReads += 1;
        return '!followPlayer("KidPlayer", 3)';
      },
    },
  });

  assert.equal(resumed, false);
  assert.equal(resumeReads, 0);
});

test('a disengaged incident keeps its same-hostile recovery action from combat reentry', () => {
  const incident = {
    active: true,
    stage: 'disengaged',
    source: { kind: 'hostile', id: 2055, name: 'skeleton' },
  };
  const agent = {
    actions: {
      executing: true,
      currentActionOwner: 'survival',
      currentActionLabel: 'action:goToPlayer',
    },
    survival_director: {
      safetyIncident: incident,
      status: { code: 'return_to_player' },
      snapshot: () => ({ safetyIncident: incident, code: 'return_to_player' }),
    },
  };

  assert.equal(selfDefenseRecoveryOwnsSameThreat(agent, { id: 2055 }), true);
  assert.equal(selfDefenseRecoveryOwnsSameThreat(agent, { id: 2056 }), false);

  incident.stage = 'threat_response';
  assert.equal(
    selfDefenseRecoveryOwnsSameThreat(agent, { id: 2055 }),
    false,
    'a fresh damage receipt reopens immediate self-defense authority',
  );
  incident.stage = 'disengaged';
  agent.actions.currentActionOwner = 'player';
  assert.equal(selfDefenseRecoveryOwnsSameThreat(agent, { id: 2055 }), false);
});

function createChildFactory(children) {
  const calls = [];
  return {
    calls,
    spawnChild: () => {
      const child = children.shift();
      calls.push(child);
      return child;
    },
  };
}

async function startFakeAgent(agentProcess, child) {
  const startup = agentProcess.start();
  child.emit('spawn');
  agentProcess.markReady();
  await startup;
}

test('Given an injected child factory, when an AgentProcess is constructed, then lifecycle startup uses that factory', () => {
  // Given
  const spawnChild = () => {
    throw new Error('test child factory should not start during construction');
  };

  // When
  const agentProcess = new AgentProcess('lifecycle-test', 8080, { spawnChild });

  // Then
  assert.equal(agentProcess.spawnChild, spawnChild);
});

test('Given an agent process capability, when the child is spawned, then the capability is passed privately through the child environment', async () => {
  const child = new FakeChildProcess();
  child.stdout = new PassThrough();
  let spawnOptions;
  const agentProcess = new AgentProcess('BridgeBot', 8080, {
    connectionToken: 'test-bridge-capability',
    spawnChild: (_executable, _args, options) => {
      spawnOptions = options;
      return child;
    },
  });

  const startup = agentProcess.start();
  child.emit('spawn');
  agentProcess.markReady();
  await startup;

  assert.equal(agentProcess.connectionToken, 'test-bridge-capability');
  assert.equal(spawnOptions.env.MINDCRAFT_AGENT_TOKEN, 'test-bridge-capability');
  assert.equal(spawnOptions.windowsHide, true);
  assert.deepEqual(spawnOptions.stdio, ['ignore', 'inherit', 'pipe']);
  assert.equal(child.stdout.listenerCount('data'), 0);
});

test('Given parent, fixed child milestones, and ordinary stderr, when startup fails, then diagnostics retain sanitized errors and ordered stage evidence', async () => {
  const child = new FakeChildProcess();
  child.stderr = new PassThrough();
  let now = 1_000;
  const agentProcess = new AgentProcess('DiagnosticBot', 8080, {
    maxAutoRestarts: 0,
    now: () => now,
    spawnChild: () => child,
  });

  const startup = agentProcess.start();
  now = 1_004;
  child.emit('spawn');
  now = 1_006;
  child.stderr.write('[mindcraft-startup] settings_profile_ready\n');
  child.stderr.write('api_key=super-secret-value\n');
  child.stderr.write('Error: Ollama model unavailable\n');
  child.stderr.write('[mindcraft-startup] login_callback arbitrary-value\n');
  now = 1_007;
  child.stderr.write('[mindcraft-startup] mineflayer_created\n');
  now = 1_009;
  agentProcess.markReadinessStage('bridge_connected');
  now = 1_012;
  agentProcess.markReadinessStage('minecraft_login');
  child.stderr.write('[mindcraft-startup] login_callback\n');
  now = 1_014;
  child.stderr.write('[mindcraft-startup] spawn_callback\n');
  now = 1_016;
  child.stderr.write('[mindcraft-startup] handlers_ready\n');
  now = 1_018;
  agentProcess.markReady();
  await startup;
  now = 1_025;
  child.emit('exit', 1, null);

  assert.equal(agentProcess.state, 'failed');
  assert.equal(agentProcess.lastError, 'Error: Ollama model unavailable');
  assert.deepEqual(agentProcess.getDiagnostics(40), [
    'startup +0ms: process_starting',
    'startup +4ms: process_spawned',
    'startup +6ms: child.settings_profile_ready',
    'api_key=[redacted]',
    'Error: Ollama model unavailable',
    'startup +7ms: child.mineflayer_created',
    'startup +9ms: bridge_connected',
    'startup +12ms: minecraft_login',
    'startup +12ms: child.login_callback',
    'startup +14ms: child.spawn_callback',
    'startup +16ms: child.handlers_ready',
    'startup +18ms: world_ready',
    'startup +25ms: failure',
  ]);
  const evidence = agentProcess.getDiagnostics(40).filter((line) => line.startsWith('startup +'));
  const elapsed = evidence.map((line) => Number(/\+(\d+)ms/.exec(line)[1]));
  assert.deepEqual(elapsed, [...elapsed].sort((first, second) => first - second));
  assert.doesNotMatch(agentProcess.getDiagnostics(40).join('\n'), /arbitrary-value/i);
  assert.equal(sanitizeAgentDiagnostic('Bearer abc123'), 'Bearer [redacted]');
});

test('Given repeated fixed startup markers, when evidence exceeds its limit, then only the newest bounded fixed-vocabulary entries remain', () => {
  const child = new FakeChildProcess();
  child.stderr = new PassThrough();
  let now = 2_000;
  const agentProcess = new AgentProcess('BoundedEvidence', 8080, {
    now: () => now,
    spawnChild: () => child,
  });
  agentProcess.start().catch(() => {});
  child.emit('spawn');

  for (let index = 0; index < 55; index += 1) {
    now += 1;
    const marker = index % 2 === 0 ? 'spawn_callback' : 'handlers_ready';
    child.stderr.write(`[mindcraft-startup] ${marker}\n`);
  }

  const diagnostics = agentProcess.getDiagnostics(100);
  assert.equal(diagnostics.length, 40);
  assert.ok(diagnostics.every((line) => /^startup \+\d+ms: child\.(?:spawn_callback|handlers_ready)$/.test(line)));
  const elapsed = diagnostics.map((line) => Number(/\+(\d+)ms/.exec(line)[1]));
  assert.deepEqual(elapsed, [...elapsed].sort((first, second) => first - second));
  agentProcess.stop();
  child.emit('exit', null, 'SIGINT');
});

test('Given the child milestone writer, when arbitrary or secret-bearing values are requested, then only exact fixed vocabulary is emitted', () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    assert.equal(emitStartupMilestone('mineflayer_created'), true);
    assert.equal(emitStartupMilestone('mineflayer_created token=do-not-emit'), false);
    assert.equal(emitStartupMilestone('bot chat or model output'), false);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.deepEqual(writes, ['[mindcraft-startup] mineflayer_created\n']);
});

test('Given stale stderr from a handled gameplay warning, when the child later exits, then the warning is not misreported as the crash cause', async () => {
  const child = new FakeChildProcess();
  child.stderr = new PassThrough();
  let now = 1_000;
  const agentProcess = new AgentProcess('StaleDiagnostic', 8080, {
    maxAutoRestarts: 0,
    now: () => now,
    spawnChild: () => child,
  });

  const startup = agentProcess.start();
  child.emit('spawn');
  agentProcess.markReady();
  await startup;
  child.stderr.write('PathStopped: expected navigation cancellation\n');
  now += 31_000;
  child.emit('exit', 1, null);

  assert.equal(agentProcess.lastError, 'Agent process exited with code 1 and signal none');
});

test('Given a child spawn error, when agent startup is awaited, then the agent is failed with a usable error', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('spawn-error', 8080, {
    spawnChild: () => child,
  });

  // When
  const startup = agentProcess.start();
  assert.equal(typeof startup?.then, 'function');
  child.emit('error', new Error('ENOENT: test spawn failure'));

  // Then
  await assert.rejects(() => startup, /ENOENT: test spawn failure/);
  assert.equal(agentProcess.state, 'failed');
  assert.equal(agentProcess.running, false);
  assert.match(agentProcess.lastError, /ENOENT: test spawn failure/);
});

test('Given an accepted stop signal without child exit, when multiple exit waiters are registered, then none settle until the owned child exits', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('wait-for-exit', 8080, { spawnChild: () => child });
  const startup = agentProcess.start();
  const firstWaiter = agentProcess.waitForExit();
  const secondWaiter = agentProcess.waitForExit();
  let settled = false;
  firstWaiter.then(() => { settled = true; });
  child.emit('spawn');
  agentProcess.markReady();
  await startup;

  // When
  assert.equal(agentProcess.stop(), true);
  child.emit('error', new Error('post-spawn error'));
  await Promise.resolve();

  // Then
  assert.equal(firstWaiter, secondWaiter);
  assert.equal(settled, false);
  assert.equal(agentProcess.process, child);
  child.emit('exit', null, 'SIGINT');
  await Promise.all([firstWaiter, secondWaiter]);
  assert.equal(agentProcess.process, null);
});

test('Given a definitive spawn failure, when waiting for exit, then the child-scoped wait resolves after ownership clears', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('wait-spawn-failure', 8080, { spawnChild: () => child });
  const startup = agentProcess.start();
  const exitWait = agentProcess.waitForExit();

  // When
  child.emit('error', new Error('ENOENT: test spawn failure'));

  // Then
  await assert.rejects(startup, /ENOENT: test spawn failure/);
  await exitWait;
  assert.equal(agentProcess.process, null);
});

test('Given a stop before a delayed child spawn, when startup settles, then it rejects without becoming ready', async () => {
  // Given
  const child = new FakeChildProcess();
  const agentProcess = new AgentProcess('stop-before-spawn', 8080, {
    spawnChild: () => child,
  });
  const startup = agentProcess.start();

  // When
  const stopped = agentProcess.stop();
  child.emit('spawn');

  // Then
  assert.equal(stopped, true);
  await assert.rejects(startup, /startup stopped by operator request/);
  assert.deepEqual(child.killCalls, ['SIGINT']);
  assert.equal(agentProcess.running, false);
  assert.equal(agentProcess.state, 'stopping');
  child.emit('exit', null, 'SIGINT');
  assert.equal(agentProcess.state, 'stopped');
});

test('Given an intentional stop, when the child exits with SIGINT, then the agent stops without an automatic restart', async () => {
  // Given
  const child = new FakeChildProcess();
  const factory = createChildFactory([child]);
  const agentProcess = new AgentProcess('manual-stop', 8080, factory);
  await startFakeAgent(agentProcess, child);

  // When
  agentProcess.stop();
  child.emit('exit', null, 'SIGINT');

  // Then
  assert.deepEqual(child.killCalls, ['SIGINT']);
  assert.equal(factory.calls.length, 1);
  assert.equal(agentProcess.state, 'stopped');
});

test('Given a graceful code-zero self-exit, when no stop was requested, then the lifecycle stays stopped', async () => {
  // Given
  const child = new FakeChildProcess();
  const factory = createChildFactory([child]);
  const agentProcess = new AgentProcess('safe-held-unload', 8080, factory);
  await startFakeAgent(agentProcess, child);

  // When
  child.emit('exit', 0, null);

  // Then
  assert.equal(factory.calls.length, 1);
  assert.equal(agentProcess.running, false);
  assert.equal(agentProcess.state, 'stopped');
  assert.equal(agentProcess.readinessStage, 'stopped');
  assert.equal(agentProcess.process, null);
});

test('Given repeated unexpected exits, when automatic restart is bounded, then no launcher exit or unbounded respawn occurs', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, restartedChild]);
  const agentProcess = new AgentProcess('bounded-restart', 8080, {
    ...factory,
    minAutoRestartUptimeMs: 0,
    maxAutoRestarts: 1,
  });
  await startFakeAgent(agentProcess, firstChild);

  // When
  firstChild.emit('exit', 1, null);
  restartedChild.emit('spawn');
  restartedChild.emit('exit', 1, null);

  // Then
  assert.equal(factory.calls.length, 2);
  assert.equal(agentProcess.state, 'failed');
  assert.match(agentProcess.lastError, /exited with code 1/);
});

test('Given an unexpected Windows control event after stable uptime, when no stop was requested, then bounded recovery restarts the bot', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, restartedChild]);
  let now = 0;
  const agentProcess = new AgentProcess('windows-control-recovery', 8080, {
    ...factory,
    now: () => now,
    platform: 'win32',
    minAutoRestartUptimeMs: 10000,
    maxAutoRestarts: 1,
  });
  await startFakeAgent(agentProcess, firstChild);

  // When
  now = 15000;
  firstChild.emit('exit', 0xC000013A, null);
  restartedChild.emit('spawn');
  agentProcess.markReady();

  // Then
  assert.equal(factory.calls.length, 2);
  assert.equal(agentProcess.state, 'running');
  assert.equal(agentProcess.lastError, null);
});

test('Given one explicit restart request, when the current child exits, then exactly one stop-to-start transition occurs', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, restartedChild]);
  const agentProcess = new AgentProcess('explicit-restart', 8080, factory);
  await startFakeAgent(agentProcess, firstChild);

  // When
  const restart = agentProcess.forceRestart();
  firstChild.emit('exit', null, 'SIGINT');
  restartedChild.emit('spawn');
  agentProcess.markReady();
  await restart;

  // Then
  assert.deepEqual(firstChild.killCalls, ['SIGINT']);
  assert.equal(factory.calls.length, 2);
  assert.equal(agentProcess.state, 'running');
});

test('Given a post-spawn child error during an explicit restart, when the old child has not exited, then restart ownership remains with that child', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const recoveredChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, recoveredChild]);
  const agentProcess = new AgentProcess('restart-error', 8080, factory);
  await startFakeAgent(agentProcess, firstChild);
  const restart = agentProcess.forceRestart();
  const killError = new Error('SIGINT delivery failed');
  let restartSettled = false;
  restart.then(
    () => { restartSettled = true; },
    () => { restartSettled = true; },
  );

  // When
  firstChild.emit('error', killError);
  await Promise.resolve();

  // Then
  assert.equal(restartSettled, true);
  await assert.rejects(restart, /SIGINT delivery failed/);
  assert.equal(agentProcess.state, 'failed');
  assert.equal(agentProcess.running, false);
  assert.match(agentProcess.lastError, /SIGINT delivery failed/);
  assert.equal(agentProcess.process, firstChild);
  assert.equal(agentProcess.isActive(), true);

  const blockedRestart = agentProcess.forceRestart();
  let blockedRestartSettled = false;
  blockedRestart.then(
    () => { blockedRestartSettled = true; },
    () => { blockedRestartSettled = true; },
  );
  await Promise.resolve();
  assert.equal(blockedRestartSettled, false);
  assert.equal(factory.calls.length, 1);

  firstChild.emit('exit', null, 'SIGINT');
  assert.equal(factory.calls.length, 2);
  recoveredChild.emit('spawn');
  agentProcess.markReady();
  await blockedRestart;
  assert.equal(agentProcess.state, 'running');
});

test('Given a failed restart signal delivery, when restart is retried before child exit, then no replacement child is spawned', async () => {
  // Given
  const firstChild = new FakeChildProcess([false, false]);
  const replacementChild = new FakeChildProcess();
  const factory = createChildFactory([firstChild, replacementChild]);
  const agentProcess = new AgentProcess('restart-kill-failure', 8080, {
    ...factory,
    terminateProcessTree: () => Promise.resolve({
      success: false,
      error: 'Unable to terminate owned test process tree.',
    }),
  });
  await startFakeAgent(agentProcess, firstChild);

  // When
  const firstRestart = agentProcess.forceRestart();
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Then
  await assert.rejects(firstRestart, /Unable to terminate owned test process tree/);
  assert.equal(agentProcess.process, firstChild);
  assert.equal(agentProcess.isActive(), true);

  const retry = agentProcess.forceRestart();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(retry, /Unable to terminate owned test process tree/);
  assert.deepEqual(firstChild.killCalls, ['SIGINT', 'SIGINT']);
  assert.equal(factory.calls.length, 1);
  assert.equal(agentProcess.process, firstChild);
});

test('Given an automatic restart, when lifecycle state changes asynchronously, then status reports finalized restart transitions', async () => {
  // Given
  const firstChild = new FakeChildProcess();
  const restartedChild = new FakeChildProcess();
  const statusReports = [];
  const factory = createChildFactory([firstChild, restartedChild]);
  const agentProcess = new AgentProcess('status-restart', 8080, {
    ...factory,
    minAutoRestartUptimeMs: 0,
    notifyStatus: () => {
      statusReports.push({
        state: agentProcess.state,
        lastError: agentProcess.lastError,
      });
    },
  });
  await startFakeAgent(agentProcess, firstChild);
  statusReports.length = 0;

  // When
  firstChild.emit('exit', 1, null);
  restartedChild.emit('spawn');
  agentProcess.markReady();

  // Then
  assert.deepEqual(statusReports.map((report) => report.state), ['restarting', 'starting', 'starting', 'running']);
  assert.match(statusReports[0].lastError, /exited with code 1/);
  assert.equal(statusReports.at(-1).lastError, null);
});

test('Given lifecycle dependencies, when creating an agent, then Mindcraft accepts an injected runtime seam', () => {
  // Then
  assert.equal(Mindcraft.createAgent.length, 2);
});

test('Given plugin auto-eat, when survival ownership is configured, then unsupervised eating is disabled', () => {
  const calls = [];
  const bot = {
    autoEat: {
      options: null,
      disable() {
        calls.push('disable');
      },
    },
  };

  configureSurvivalOwnership(bot);

  assert.deepEqual(calls, ['disable']);
  assert.equal(bot.autoEat.options.startAt, 14);
  assert.equal(bot.autoEat.options.bannedFood.includes('rotten_flesh'), true);
});

test('Given an agent update, when the coordinated arbiter exists, then Agent delegates the tick once', async () => {
  const calls = [];
  const fakeAgent = {
    behavior_arbiter: {
      update(delta) {
        calls.push(`arbiter:${delta}`);
        return { selectedLane: 'idle' };
      },
    },
  };

  const result = await Agent.prototype.update.call(fakeAgent, 25);

  assert.deepEqual(calls, ['arbiter:25']);
  assert.equal(result.selectedLane, 'idle');
});

test('Given the arbiter suppresses lower lanes, when Agent updates, then that decision is preserved', async () => {
  const calls = [];
  const fakeAgent = {
    behavior_arbiter: {
      update() {
        calls.push('arbiter');
        return { selectedLane: 'basic_survival', lowerLanesSuppressed: true };
      },
    },
  };

  const result = await Agent.prototype.update.call(fakeAgent, 25);

  assert.deepEqual(calls, ['arbiter']);
  assert.equal(result.lowerLanesSuppressed, true);
});

test('Given runtime-configured role bots, when legacy default-goal seeding is evaluated, then role autonomy keeps control and self-prompt bootstrap stays off', () => {
  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { runtime: { role: 'companion', autonomy: 'balanced' } },
      { role: 'companion', autonomy: 'balanced' },
      { default_goal: 'Gather and explore.' },
    ),
    false,
  );

  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { runtime: { role: 'builder', autonomy: 'autonomous' } },
      { role: 'builder', autonomy: 'autonomous' },
      { default_goal: 'Gather and build.' },
    ),
    false,
  );
});

test('Given a legacy profile without runtime behavior, when default-goal seeding is evaluated, then the old self-prompt bootstrap still works', () => {
  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { name: 'andy' },
      { role: 'companion', autonomy: 'balanced' },
      { default_goal: 'Gather and explore.' },
    ),
    true,
  );

  assert.equal(
    shouldSeedLegacyDefaultGoal(
      { name: 'andy' },
      { role: 'companion', autonomy: 'command' },
      { default_goal: 'Gather and explore.' },
    ),
    false,
  );
});

test('Given autonomy output containing think tags, when the autonomy generator strips them, then the command survives without throwing', async () => {
  const sentPrompts = [];
  const response = await Prompter.prototype._generateAutonomy.call({
    agent: { name: 'RoleBot', runtime: { limits: { maxPromptTurns: 1 } } },
    chat_model: {
      sendRequest(_messages, prompt) {
        sentPrompts.push(prompt);
        return '</think>!followPlayer("Director", 3)';
      },
    },
    async checkCooldown() {},
  }, 'Autonomy prompt');

  assert.equal(sentPrompts.length, 1);
  assert.equal(response, '!followPlayer("Director", 3)');
});

test('Given an existing live agent, when duplicate creation is requested, then Mindcraft preserves the registered process', async () => {
  // Given
  const agentName = 'DuplicateBot';
  const createdProcesses = [];
  const runtime = {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => {
      const agentProcess = new FakeRegisteredAgentProcess();
      createdProcesses.push(agentProcess);
      return agentProcess;
    },
  };
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName },
  };

  try {
    // When
    const first = await Mindcraft.createAgent(settings, runtime);
    const second = await Mindcraft.createAgent(settings, runtime);

    // Then
    assert.equal(first.success, true);
    assert.equal(second.success, false);
    assert.equal(createdProcesses.length, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), createdProcesses[0]);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given an inactive blocked placeholder, when a normal create replaces it, then an ordinary restart follows the live agent path', async () => {
  // Given
  const agentName = 'ManualBot';
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  };
  const liveProcess = new FakeRegisteredAgentProcess();
  Mindcraft.registerBlockedAgent(settings, {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: 'Duplicate agent name.',
  });

  try {
    // When
    const createResult = await Mindcraft.createAgent(settings, {
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => liveProcess,
    });
    const restartResult = await Mindcraft.startAgent(agentName);

    // Then
    assert.deepEqual(createResult, { success: true, error: null });
    assert.deepEqual(restartResult, { success: true, error: null });
    assert.equal(liveProcess.forceRestartCalls, 1);
    assert.equal(Mindcraft.getAgentProcess(agentName), liveProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a configured profile with auto-start disabled, when it is registered, then the dashboard can start it on demand', async () => {
  const agentName = 'ReadyManualBot';
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  };
  const liveProcess = new FakeRegisteredAgentProcess();
  const configured = Mindcraft.registerConfiguredAgent(settings, {
    name: agentName,
    state: 'ready',
    running: false,
    retryable: false,
    lastError: null,
  });

  try {
    assert.equal(configured.state, 'stopped');

    const startResult = await Mindcraft.startAgent(agentName, {
      hasKey: () => true,
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => liveProcess,
    });

    assert.deepEqual(startResult, { success: true, error: null });
    assert.equal(liveProcess.state, 'running');
    assert.equal(Mindcraft.getAgentProcess(agentName), liveProcess);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a delayed normal create for an old blocked placeholder, when a newer blocked generation replaces it, then the stale create leaves the newer placeholder current', async () => {
  // Given
  const agentName = 'StaleManualBot';
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName, model: 'ollama/local' },
  };
  let releaseServer;
  let createdProcesses = 0;
  Mindcraft.registerBlockedAgent(settings, {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: 'Old placeholder.',
  });

  try {
    const staleCreate = Mindcraft.createAgent(settings, {
      resolveServer: () => new Promise((resolve) => {
        releaseServer = () => resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' });
      }),
      createAgentProcess: () => {
        createdProcesses += 1;
        return new FakeRegisteredAgentProcess();
      },
    });
    const newerPlaceholder = Mindcraft.registerBlockedAgent(settings, {
      name: agentName,
      state: 'blocked',
      running: false,
      retryable: false,
      lastError: 'New placeholder.',
    });

    // When
    releaseServer();
    const staleResult = await staleCreate;
    const currentStart = await Mindcraft.startAgent(agentName);

    // Then
    assert.equal(staleResult.success, false);
    assert.equal(createdProcesses, 0);
    assert.equal(Mindcraft.getAgentProcess(agentName), newerPlaceholder);
    assert.deepEqual(currentStart, { success: false, error: 'New placeholder.' });
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given an ordinary agent whose restart rejects, when it is started, then Mindcraft returns a failure without changing lifecycle state', async () => {
  // Given
  const agentName = 'RestartFailBot';
  const restartError = new Error('SIGINT delivery failed');
  const restartFailedProcess = {
    state: 'failed',
    lastError: restartError.message,
    start: () => Promise.resolve(),
    forceRestart: () => Promise.reject(restartError),
    isActive: () => false,
    stop: () => {},
  };
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName },
  };

  try {
    await Mindcraft.createAgent(settings, {
      resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
      createAgentProcess: () => restartFailedProcess,
    });

    // When
    const result = await Mindcraft.startAgent(agentName);

    // Then
    assert.deepEqual(result, { success: false, error: restartError.message });
    assert.equal(Mindcraft.getAgentProcess(agentName), restartFailedProcess);
    assert.equal(restartFailedProcess.state, 'failed');
    assert.equal(restartFailedProcess.lastError, restartError.message);
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('Given a failed child startup, when Mindcraft creates the agent, then it reports failure and retains failed lifecycle state', async () => {
  // Given
  const agentName = 'FailedLifeBot';
  const failedProcess = {
    state: 'failed',
    lastError: 'ENOENT: test spawn failure',
    start: () => Promise.reject(new Error('ENOENT: test spawn failure')),
    isActive: () => false,
    stop: () => {},
  };
  const runtime = {
    resolveServer: () => Promise.resolve({ host: '127.0.0.1', port: 25565, version: '1.21.8' }),
    createAgentProcess: () => failedProcess,
  };
  const settings = {
    host: '127.0.0.1',
    port: 25565,
    minecraft_version: 'auto',
    profile: { name: agentName },
  };

  try {
    // When
    const result = await Mindcraft.createAgent(settings, runtime);

    // Then
    assert.equal(result.success, false);
    assert.match(result.error, /ENOENT: test spawn failure/);
    assert.equal(Mindcraft.getAgentProcess(agentName), failedProcess);
    assert.equal(Mindcraft.getAgentProcess(agentName).state, 'failed');
  } finally {
    Mindcraft.destroyAgent(agentName);
  }
});

test('a delayed player-A lookup cannot overwrite the newer authorized player-B observation', async () => {
  const requestA = deferred();
  const requestB = deferred();
  const observed = [];
  const harness = {
    _playerPositionLookup: null,
    _playerPositionLookupGeneration: 0,
    _requestPlayerPosition(name) {
      return name === 'PlayerA' ? requestA.promise : requestB.promise;
    },
    companion_context: {
      observeAuthoritativePosition(name, observation) {
        observed.push({ name, observation });
      },
    },
  };

  const lookupA = Agent.prototype.locatePlayerPosition.call(harness, 'PlayerA');
  const lookupB = Agent.prototype.locatePlayerPosition.call(harness, 'PlayerB');
  requestB.resolve({
    success: true,
    found: true,
    player: 'PlayerB',
    position: { x: 20, y: 70, z: 20 },
    dimension: 'minecraft:overworld',
  });
  await lookupB;
  requestA.resolve({
    success: true,
    found: true,
    player: 'PlayerA',
    position: { x: -20, y: 70, z: -20 },
    dimension: 'minecraft:overworld',
  });
  await lookupA;

  assert.deepEqual(observed.map(entry => entry.name), ['PlayerB']);
  assert.equal(harness._playerPositionLookup, null);
});

test('dashboard commands cannot replace the tracked Minecraft companion', async () => {
  const observed = [];
  const harness = {
    name: 'MindcraftBot',
    checkTaskDone: async () => {},
    companion_context: {
      observeChat(name) {
        observed.push(name);
        return { canonical: name };
      },
    },
    routeResponse: () => {},
  };

  await Agent.prototype.handleMessage.call(harness, 'ADMIN', '!unavailableDashboardCommand', 1);
  await Agent.prototype.handleMessage.call(harness, 'phixxation', '!unavailablePlayerCommand', 1);

  assert.deepEqual(observed, ['phixxation']);
});

test('clearing a durable agenda does not release an existing operator Hold', async () => {
  const responses = [];
  let cleared = 0;
  let released = 0;
  const harness = {
    name: 'MindcraftBot',
    checkTaskDone: async () => {},
    companion_context: { observeChat: () => null },
    agenda_director: {
      clear() {
        cleared += 1;
        return { cleared: 2 };
      },
    },
    releaseOperatorHold() { released += 1; },
    recordPlayerOrder() {},
    routeResponse(_source, message) { responses.push(message); },
  };

  const handled = await Agent.prototype.handleMessage.call(
    harness,
    'DadPlayer',
    '!clearAgenda',
    1,
  );

  assert.equal(handled, true);
  assert.equal(cleared, 1);
  assert.equal(released, 0);
  assert.deepEqual(responses, ['Cleared 2 agenda step(s).']);
});

test('fresh direct authority durably cancels a stopped Agenda before releasing Hold', () => {
  let persisted = [];
  const store = {
    lastError: null,
    load: () => persisted.map(entry => ({ ...entry, evidence: { ...entry.evidence } })),
    save(entries) {
      persisted = entries.map(entry => ({ ...entry, evidence: { ...entry.evidence } }));
      this.lastError = null;
      return true;
    },
  };
  let releases = 0;
  const agent = {
    name: 'MindcraftBot',
    operator_hold: true,
    operator_hold_reason: 'operator stop command',
    isOperatorHeld() { return this.operator_hold; },
    releaseOperatorHold() {
      releases += 1;
      this.operator_hold = false;
      return true;
    },
  };
  const director = new AgendaDirector(agent, { store, now: () => 12_000 });
  agent.agenda_director = director;
  director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });

  const authority = Agent.prototype.claimFreshPlayerActionAuthority.call(
    agent,
    '!lookAtPlayer',
    'player directive',
  );

  assert.deepEqual(authority, { ready: true, released: true });
  assert.equal(releases, 1);
  assert.equal(agent.operator_hold, false);
  assert.equal(director.hasUnfinished(), false);
  assert.equal(persisted[0].state, 'cancelled');
  assert.equal(persisted[0].evidence.code, 'agenda_cleared');

  const restored = new AgendaDirector({ name: 'MindcraftBot' }, { store, now: () => 13_000 });
  assert.equal(restored.hasUnfinished(), false);
  assert.equal(restored.entries[0].state, 'cancelled');
});

test('fresh direct authority fails closed when stopped Agenda cancellation is not durable', () => {
  let rejectWrites = false;
  const store = {
    lastError: null,
    load: () => [],
    save() {
      if (rejectWrites) {
        this.lastError = 'fixture write rejected';
        return false;
      }
      return true;
    },
  };
  let releases = 0;
  const agent = {
    name: 'MindcraftBot',
    operator_hold: true,
    operator_hold_reason: 'operator stop command',
    isOperatorHeld() { return this.operator_hold; },
    releaseOperatorHold() {
      releases += 1;
      this.operator_hold = false;
      return true;
    },
  };
  const director = new AgendaDirector(agent, { store, now: () => 14_000 });
  agent.agenda_director = director;
  director.add({ kind: 'goto', requester: 'DadPlayer', recipient: 'DadPlayer' });
  rejectWrites = true;

  const authority = Agent.prototype.claimFreshPlayerActionAuthority.call(
    agent,
    '!lookAtPlayer',
    'player directive',
  );

  assert.equal(authority.ready, false);
  assert.equal(authority.code, 'fresh_player_authority_persist_failed');
  assert.equal(releases, 0);
  assert.equal(agent.operator_hold, true);
  assert.equal(director.status.code, 'agenda_clear_persist_failed');
});

test('explicit held-work resume preserves the paused Agenda', () => {
  let clears = 0;
  let releases = 0;
  const agent = {
    operator_hold: true,
    operator_hold_reason: 'operator stop command',
    isOperatorHeld() { return this.operator_hold; },
    agenda_director: {
      hasUnfinished: () => true,
      clear() { clears += 1; return { cleared: 1, persisted: true }; },
    },
    releaseOperatorHold() {
      releases += 1;
      this.operator_hold = false;
      return true;
    },
  };

  const authority = Agent.prototype.claimFreshPlayerActionAuthority.call(
    agent,
    '!resumeStructureJob',
    'player command',
  );

  assert.deepEqual(authority, { ready: true, released: true });
  assert.equal(clears, 0);
  assert.equal(releases, 1);
});

test('a failed construction compiler releases only its exact temporary Hold for queued continuation', () => {
  const makeHarness = ({ holdGeneration = 7, currentGeneration = 7, unfinished = true } = {}) => {
    let releases = 0;
    const harness = {
      operator_hold: true,
      operator_hold_generation: currentGeneration,
      isCurrentOperatorHold(generation) {
        return this.operator_hold && this.operator_hold_generation === generation;
      },
      releaseOperatorHold() {
        releases += 1;
        this.operator_hold = false;
        return true;
      },
      agenda_director: { hasUnfinished: () => unfinished },
    };
    const released = Agent.prototype.releaseFailedConstructionCompilationHold.call(
      harness,
      { kind: 'construction', holdGeneration },
      { settled: true, state: 'failed', retryable: false },
    );
    return { harness, released, releases };
  };

  const exact = makeHarness();
  assert.equal(exact.released, true);
  assert.equal(exact.releases, 1);
  assert.equal(exact.harness.operator_hold, false);

  const newerStop = makeHarness({ currentGeneration: 8 });
  assert.equal(newerStop.released, false);
  assert.equal(newerStop.releases, 0, 'a newer player Stop must remain authoritative');
  assert.equal(newerStop.harness.operator_hold, true);

  const noContinuation = makeHarness({ unfinished: false });
  assert.equal(noContinuation.released, false);
  assert.equal(noContinuation.releases, 0, 'without later work the failed compiler stays safely held');
});

test('a held construction request keeps physical Stop until a valid work order exists', async () => {
  const history = [];
  const responses = [];
  const holds = [];
  let released = 0;
  let promptCalls = 0;
  const harness = {
    name: 'MindcraftBot',
    runtime: { role: 'companion' },
    bot: { modes: { flushBehaviorLog: () => '' } },
    shut_up: false,
    operator_hold: true,
    operator_hold_generation: 7,
    checkTaskDone: () => Promise.resolve(),
    dispatchPlayerAgenda: () => Promise.resolve(false),
    isOperatorHeld() { return this.operator_hold; },
    isCurrentOperatorHold(generation) {
      return this.operator_hold && this.operator_hold_generation === generation;
    },
    releaseOperatorHold() {
      released += 1;
      this.operator_hold = false;
    },
    holdPosition(reason) {
      holds.push(reason);
      this.operator_hold = true;
      this.operator_hold_generation += 1;
    },
    routeResponse(_source, message) { responses.push(message); },
    companion_context: { observeChat: () => null },
    self_prompter: {
      interruptForManualCommand: () => {},
      shouldInterrupt: () => false,
      isActive: () => false,
    },
    role_director: { deferForManualCommand: () => {} },
    history: {
      add(name, content) {
        history.push({ name, content });
        return Promise.resolve();
      },
      save: () => {},
      getHistory: () => [],
    },
    prompter: {
      promptConvo() {
        promptCalls += 1;
        return Promise.resolve('The workshop is already registered and underway.');
      },
    },
  };

  const usedCommand = await Agent.prototype.handleMessage.call(
    harness,
    'ADMIN',
    'Build a small functional workshop with a clear entrance, lighting, a crafting table, a furnace, and a chest.',
    1,
  );

  assert.equal(usedCommand, false);
  assert.equal(promptCalls, 1);
  assert.equal(released, 0);
  assert.deepEqual(holds, ['player design request was not compiled']);
  assert.equal(responses.at(-1), 'I did not produce a valid bounded construction command, so no work order was created. I am holding position.');
  assert.equal(history.some(entry => entry.content.includes('already registered and underway')), false);
});

test('a held unfamiliar player order may be interpreted without releasing the body, and a newer Stop still wins', async () => {
  const makeHarness = ({ supersedeHold = false } = {}) => {
    let promptCalls = 0;
    let released = 0;
    const responses = [];
    const harness = {
      name: 'MindcraftBot',
      runtime: { role: 'companion' },
      bot: { modes: { flushBehaviorLog: () => '' } },
      shut_up: false,
      operator_hold: true,
      operator_hold_generation: 7,
      checkTaskDone: () => Promise.resolve(),
      dispatchPlayerAgenda: () => Promise.resolve(false),
      isOperatorHeld() { return this.operator_hold; },
      isCurrentOperatorHold(generation) {
        return this.operator_hold && this.operator_hold_generation === generation;
      },
      releaseOperatorHold() {
        released += 1;
        this.operator_hold = false;
      },
      routeResponse(_source, message) { responses.push(message); },
      companion_context: { observeChat: () => null },
      self_prompter: {
        interruptForManualCommand: () => {},
        shouldInterrupt: () => false,
        isActive: () => false,
      },
      role_director: { deferForManualCommand: () => {} },
      history: {
        add: () => Promise.resolve(),
        save: () => {},
        getHistory: () => [],
      },
      prompter: {
        promptConvo() {
          promptCalls += 1;
          if (supersedeHold) {
            harness.operator_hold_generation += 1;
            return Promise.resolve('I will check. !stats');
          }
          return Promise.resolve('I need to choose a safe cave route before moving.');
        },
      },
    };
    return { harness, responses, promptCalls: () => promptCalls, released: () => released };
  };

  const interpreted = makeHarness();
  const usedCommand = await Agent.prototype.handleMessage.call(
    interpreted.harness,
    'ADMIN',
    'Explore and light a nearby cave, collect useful exposed ore, then return home.',
    1,
  );
  assert.equal(usedCommand, false);
  assert.equal(interpreted.promptCalls(), 1);
  assert.equal(interpreted.released(), 0);
  assert.equal(interpreted.harness.operator_hold, true);
  assert.deepEqual(interpreted.responses, ['I need to choose a safe cave route before moving.']);

  const interrupted = makeHarness({ supersedeHold: true });
  const interruptedCommand = await Agent.prototype.handleMessage.call(
    interrupted.harness,
    'ADMIN',
    'Explore and light a nearby cave, collect useful exposed ore, then return home.',
    1,
  );
  assert.equal(interruptedCommand, false);
  assert.equal(interrupted.promptCalls(), 1);
  assert.equal(interrupted.released(), 0);
  assert.equal(interrupted.harness.operator_hold, true);
  assert.deepEqual(interrupted.responses, []);
});

test('deferred construction accepts only a new exact correlated job submission', () => {
  const deferredAssignment = { holdGeneration: 7 };
  const activeOrder = { id: 'builder-new-outpost' };
  const base = {
    deferredAssignment,
    commandName: '!designStructure',
    previousGeneration: 4,
    activeOrder,
  };

  assert.equal(correlatedPersistentJobSubmissionAccepted({
    ...base,
    submission: {
      generation: 4,
      selectedSkill: '!designStructure',
      submittedOrderId: 'builder-old-job',
      activeOrderId: 'builder-old-job',
      accepted: true,
    },
  }), false, 'an older successful receipt cannot accept the new request');

  assert.equal(correlatedPersistentJobSubmissionAccepted({
    ...base,
    submission: {
      generation: 5,
      selectedSkill: '!designStructure',
      submittedOrderId: 'builder-new-outpost',
      activeOrderId: 'builder-old-job',
      accepted: false,
      code: 'job_busy',
    },
  }), false, 'job_busy cannot be mistaken for acceptance because some job is active');

  assert.equal(correlatedPersistentJobSubmissionAccepted({
    ...base,
    submission: {
      generation: 5,
      selectedSkill: '!designStructure',
      submittedOrderId: 'builder-new-outpost',
      activeOrderId: 'builder-new-outpost',
      accepted: true,
    },
  }), true);
});

test('a model-selected typed goal ends its command loop only after a new durable goal is accepted', () => {
  const previousGoalIds = ['goal-existing', 'goal-previous'];

  assert.equal(correlatedPersistentGoalAssignmentAccepted({
    commandName: '!requestItemGoal',
    previousGoalIds,
    activeGoal: { id: 'goal-existing' },
    lastGoal: null,
  }), false, 'an unchanged busy goal is not a new accepted assignment');

  assert.equal(correlatedPersistentGoalAssignmentAccepted({
    commandName: '!requestItemGoal',
    previousGoalIds,
    activeGoal: { id: 'goal-new' },
    lastGoal: null,
  }), true, 'a newly active goal owns the physical continuation');

  assert.equal(correlatedPersistentGoalAssignmentAccepted({
    commandName: '!requestItemGoal',
    previousGoalIds,
    activeGoal: null,
    lastGoal: { id: 'goal-new', phase: 'complete' },
  }), true, 'a goal that completed quickly still owns the terminal handoff');

  assert.equal(correlatedPersistentGoalAssignmentAccepted({
    commandName: '!stats',
    previousGoalIds,
    activeGoal: { id: 'goal-new' },
    lastGoal: null,
  }), false, 'an unrelated command cannot inherit a concurrent goal transition');
});
