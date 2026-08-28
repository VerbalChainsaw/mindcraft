import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';

import { ActionManager } from '../../src/agent/action_manager.js';
import { AgendaDirector } from '../../src/agent/runtime/agenda-director.js';
import {
  authoritativePlayerRefreshMs,
  BehaviorArbiter,
  isDirectiveHazardSettlementEvidence,
  onlineHumanPlayerNames,
} from '../../src/agent/runtime/behavior-arbiter.js';
import {
  DecisionTraceRecorder,
  extractDecisionTraces,
  formatDecisionTrace,
} from '../../src/agent/runtime/decision-trace.js';
import { getModeSuppressionReason } from '../../src/agent/modes.js';
import { chooseCompanionAction } from '../../src/agent/runtime/companion-action-policy.js';

function fakeAgent({ emergency = false, held = false, survival = null, job = null } = {}) {
  const calls = [];
  const modes = {
    beginUpdateCycle() { calls.push('modes:begin'); },
    endUpdateCycle() { calls.push('modes:end'); },
    updateBand(names) {
      calls.push(`modes:${names.join(',')}`);
      if (emergency && names.includes('self_preservation')) {
        return { active: true, mode: 'self_preservation', code: 'danger_detected' };
      }
      return { active: false, scheduled: false, code: 'inactive' };
    },
  };
  return {
    agent: {
      name: 'TraceBot',
      runtime: { autonomy: 'balanced' },
      bot: { health: 20, food: 20, oxygenLevel: 20, modes },
      actions: { executing: false, currentActionLabel: '', currentActionOwner: '' },
      environment_observer: {
        nextSampleAt: 0,
        update() { calls.push('perception:update'); },
      },
      ...(survival ? { survival_director: survival } : {}),
      ...(job ? { job_director: job } : {}),
      isOperatorHeld() { calls.push('operator:check'); return held; },
      checkTaskDone() { calls.push('task:check'); },
    },
    calls,
  };
}

test('authoritative player polling is held-safe, owner-responsive, and idle-backed-off', () => {
  assert.equal(authoritativePlayerRefreshMs({ isOperatorHeld: () => true }, {}), null);
  assert.equal(authoritativePlayerRefreshMs({
    isOperatorHeld: () => false,
    goal_director: { activeGoal: { phase: 'deliver', destination: { kind: 'player' } } },
  }, {}), 5_000);
  assert.equal(authoritativePlayerRefreshMs({ isOperatorHeld: () => false }, { directive: 'follow' }), 5_000);
  assert.equal(authoritativePlayerRefreshMs({ isOperatorHeld: () => false }, {}), 30_000);
});

test('a safety incident suspends and releases the exact durable player commitment once', () => {
  let now = 1_000;
  const agent = {
    name: 'SuspensionBot',
    runtime: { autonomy: 'command' },
    bot: { modes: {} },
    actions: {
      executing: true,
      currentActionId: 'goal-action-1',
      currentActionOwner: 'player',
      currentActionLabel: 'action:collectBlocksInRange',
      currentActionStartedAt: 900,
      ownerPriority: () => 40,
    },
    goal_director: { activeGoal: { id: 'goal-1', phase: 'acquire' } },
  };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => now,
    trace: { enabled: false },
    commitmentProviders: [action => ({
      owner: 'player_goal',
      obligationId: agent.goal_director.activeGoal.id,
      phase: agent.goal_director.activeGoal.phase,
      ownsCurrentAction: action.owner === 'player',
    })],
  });
  agent.behavior_arbiter = arbiter;
  const incident = { id: 'safety-1-zombie', active: true, stage: 'threat_response' };

  const suspension = arbiter.beginSafetySuspension(incident);
  assert.deepEqual(suspension, {
    id: 'suspension:safety-1-zombie',
    incidentId: 'safety-1-zombie',
    owner: 'player_goal',
    obligationId: 'goal-1',
    phase: 'acquire',
    actionId: 'goal-action-1',
    actionLabel: 'action:collectBlocksInRange',
    state: 'suspended',
    startedAt: 1_000,
  });
  assert.equal(arbiter.matchesControlSuspension({
    owner: 'player_goal',
    obligationId: 'goal-1',
    actionId: 'goal-action-1',
  }), true);
  assert.equal(arbiter.matchesControlSuspension({
    owner: 'player_goal',
    obligationId: 'another-goal',
    actionId: 'goal-action-1',
  }), false);

  now = 1_200;
  assert.equal(arbiter.releaseSafetySuspension({
    id: incident.id,
    resolutionCode: 'threat_destroyed',
  }), true);
  assert.equal(arbiter.currentControlSuspension(), null);
  assert.equal(arbiter.lastControlSuspension.state, 'released');
  assert.equal(arbiter.lastControlSuspension.releaseCode, 'threat_destroyed');
  assert.equal(arbiter.matchesControlSuspension({
    owner: 'player_goal',
    obligationId: 'goal-1',
    actionId: 'goal-action-1',
  }), true, 'the exact interrupted settlement remains correlated across the release edge');
  assert.equal(arbiter.matchesControlSuspension({
    owner: 'player_goal',
    obligationId: 'goal-1',
    actionId: 'goal-action-2',
  }), false, 'a later resumed action cannot inherit the old suspension');
  assert.equal(arbiter.releaseSafetySuspension(incident), false, 'release is idempotent');
});

test('a durable player commitment excludes ambient defense during idle handoff without suppressing fresh damage', async () => {
  const { agent, calls } = fakeAgent();
  let freshDamage = false;
  let defenseRuns = 0;
  let goalUpdates = 0;
  const protectionOptions = [];
  agent.goal_director = {
    activeGoal: { id: 'goal-idle-handoff', phase: 'recover' },
    status: { code: 'goal_recovery_ready' },
    update() { goalUpdates += 1; },
  };
  agent.bot.modes.updateBand = (names, options = {}) => {
    calls.push(`modes:${names.join(',')}`);
    if (!names.includes('self_defense')) {
      return { active: false, scheduled: false, code: 'inactive' };
    }
    protectionOptions.push(options);
    if (!freshDamage && options.suppressAmbientSelfDefense === true) {
      return { active: false, scheduled: false, code: 'ambient_defense_suppressed' };
    }
    defenseRuns += 1;
    return {
      active: true,
      scheduled: true,
      mode: 'self_defense',
      code: freshDamage ? 'fresh_damage_defense' : 'ambient_defense',
    };
  };
  const arbiter = new BehaviorArbiter(agent, {
    trace: { enabled: true, retention: 4 },
    commitmentProviders: [action => ({
      owner: 'player_goal',
      obligationId: agent.goal_director.activeGoal.id,
      phase: agent.goal_director.activeGoal.phase,
      ownsCurrentAction: action.owner === 'player',
    })],
  });
  agent.behavior_arbiter = arbiter;

  const resumed = await arbiter.update(25);
  assert.equal(resumed.selectedLane, 'player_goal');
  assert.equal(goalUpdates, 1, 'the exact durable goal owns its idle executor handoff');
  assert.equal(defenseRuns, 0, 'ambient hostile proximity cannot steal the durable commitment');
  assert.equal(protectionOptions.at(-1)?.suppressAmbientSelfDefense, true);

  freshDamage = true;
  const defended = await arbiter.update(25);
  assert.equal(defended.selectedLane, 'attributed_protection');
  assert.equal(defended.code, 'fresh_damage_defense');
  assert.equal(defenseRuns, 1, 'fresh damage remains valid preemption authority');
});

test('durable player work is suspended even when Survival already owns the transient lease', () => {
  const agent = {
    name: 'LeaseTransferBot',
    runtime: { autonomy: 'command' },
    bot: { modes: {} },
    actions: {
      executing: true,
      currentActionId: 'survival-action-1',
      currentActionOwner: 'survival',
      currentActionLabel: 'action:prepareFood',
      currentActionStartedAt: 900,
      ownerPriority: () => 40,
    },
    goal_director: { activeGoal: { id: 'goal-while-unsafe', phase: 'assess' } },
  };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => 1_000,
    trace: { enabled: false },
    commitmentProviders: [action => ({
      owner: 'player_goal',
      obligationId: agent.goal_director.activeGoal.id,
      phase: agent.goal_director.activeGoal.phase,
      ownsCurrentAction: action.owner === 'player',
    })],
  });

  const suspension = arbiter.beginSafetySuspension({
    id: 'safety-after-transfer',
    active: true,
  });
  assert.equal(suspension.owner, 'player_goal');
  assert.equal(suspension.obligationId, 'goal-while-unsafe');
  assert.equal(suspension.actionId, null, 'the transient Survival action is not misbound to the Goal');
  assert.equal(arbiter.matchesControlSuspension({
    owner: 'player_goal',
    obligationId: 'goal-while-unsafe',
    actionId: 'late-goal-interruption',
  }), true);
});

test('registered Agenda commitments suspend without arbiter knowledge of Agenda internals', () => {
  const agent = {
    name: 'AgendaCommitmentBot',
    runtime: { autonomy: 'command' },
    bot: { modes: {} },
    actions: {
      executing: true,
      currentActionId: 'agenda-action-1',
      currentActionOwner: 'player',
      currentActionLabel: 'action:rideToCoordinates',
      currentActionStartedAt: 900,
      ownerPriority: () => 30,
    },
  };
  const agendaProvider = {
    currentControlCommitment(action) {
      return {
        owner: 'player_agenda',
        obligationId: 'agenda-nether-entry-1',
        phase: 'active',
        ownsCurrentAction: action.owner === 'player',
      };
    },
  };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => 1_000,
    trace: { enabled: false },
    commitmentProviders: [agendaProvider],
  });

  const suspension = arbiter.beginSafetySuspension({ id: 'safety-agenda', active: true });

  assert.equal(suspension.owner, 'player_agenda');
  assert.equal(suspension.obligationId, 'agenda-nether-entry-1');
  assert.equal(suspension.actionId, 'agenda-action-1');
});

test('an active Safety suspension hard-gates every lower body owner even if a leaf yields incorrectly', async () => {
  let survivalUpdates = 0;
  let goalUpdates = 0;
  const survival = {
    inFlight: false,
    status: { code: 'safety_recovery_pending' },
    safetyIncident: { id: 'safety-hard-gate', active: true, stage: 'disengaged' },
    update() { survivalUpdates += 1; },
    blocksLowerPriority() { return false; },
    snapshot() { return { safetyIncident: this.safetyIncident }; },
  };
  const { agent } = fakeAgent({ survival });
  agent.isIdle = () => true;
  agent.goal_director = {
    activeGoal: { id: 'goal-hard-gated', phase: 'recover' },
    currentControlCommitment(action) {
      return {
        owner: 'player_goal',
        obligationId: this.activeGoal.id,
        phase: this.activeGoal.phase,
        ownsCurrentAction: action.owner === 'player',
      };
    },
    update() { goalUpdates += 1; },
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });
  arbiter.registerControlCommitmentProvider(agent.goal_director);
  agent.behavior_arbiter = arbiter;
  arbiter.beginSafetySuspension(survival.safetyIncident);

  const selected = await arbiter.update(25);

  assert.equal(selected.selectedLane, 'basic_survival');
  assert.equal(selected.code, 'safety_recovery_pending');
  assert.equal(survivalUpdates, 1);
  assert.equal(goalUpdates, 0, 'an active Safety suspension cannot leak into Goal execution');
  assert.equal(arbiter.currentControlSuspension()?.incidentId, 'safety-hard-gate');
});

test('internal assignment control blocks lower lanes without becoming Operator Hold', async () => {
  let goalUpdates = 0;
  const { agent } = fakeAgent();
  agent.isIdle = () => true;
  agent.goal_director = {
    activeGoal: { id: 'goal-behind-compilation', phase: 'assess' },
    update() { goalUpdates += 1; },
  };
  agent.currentInternalControlBlock = () => ({
    generation: 4,
    kind: 'assignment_compilation',
    reason: 'item plan assignment pending',
    blocksBody: true,
  });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const selected = await arbiter.update(25);

  assert.equal(agent.isOperatorHeld(), false);
  assert.equal(selected.selectedLane, 'internal_control');
  assert.equal(selected.code, 'internal_assignment_wait');
  assert.equal(goalUpdates, 0);
});

test('trace enablement preserves the emergency selection and side-effect order', async () => {
  const traced = fakeAgent({ emergency: true });
  const untraced = fakeAgent({ emergency: true });
  const tracedArbiter = new BehaviorArbiter(traced.agent, { trace: { enabled: true, retention: 8 } });
  const untracedArbiter = new BehaviorArbiter(untraced.agent, { trace: { enabled: false } });

  const tracedStatus = await tracedArbiter.update(25);
  const untracedStatus = await untracedArbiter.update(25);

  assert.equal(tracedStatus.selectedLane, 'emergency_self_preservation');
  assert.equal(untracedStatus.selectedLane, tracedStatus.selectedLane);
  assert.equal(untracedStatus.code, tracedStatus.code);
  assert.deepEqual(untraced.calls, traced.calls);
  assert.equal(untracedArbiter.snapshot().decisionTrace, null);

  const trace = tracedArbiter.snapshot().decisionTrace.recent[0];
  assert.equal(trace.winner.lane, 'emergency_self_preservation');
  assert.equal(trace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'operator_hold').status, 'not_evaluated');
  assert.equal(trace.lanes.find(lane => lane.lane === 'attributed_protection').status, 'not_evaluated');
});

test('a material-change wait keeps the emergency band selected without inventing an action', async () => {
  const { agent, calls } = fakeAgent();
  agent.bot.modes.updateBand = names => {
    calls.push(`modes:${names.join(',')}`);
    if (names.includes('self_preservation')) {
      return {
        active: false,
        scheduled: false,
        blocking: true,
        mode: 'self_preservation',
        code: 'open_water_escape_waiting_for_material_change',
      };
    }
    return { active: false, scheduled: false, code: 'inactive' };
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'emergency_self_preservation');
  assert.equal(status.code, 'open_water_escape_waiting_for_material_change');
  assert.equal(agent.actions.executing, false);
  assert.equal(calls.some(call => call === 'modes:self_defense,cowardice'), false);
  const trace = arbiter.snapshot().decisionTrace.recent[0];
  assert.equal(trace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'attributed_protection').status, 'not_evaluated');
});

test('a safe operator-held bot selects the hold gate after checking bounded mortal reflexes', async () => {
  const { agent, calls } = fakeAgent({ held: true });
  agent.operator_hold_reason = 'Operator stop is active.';
  agent.bot.players = { DadPlayer: { username: 'DadPlayer', entity: null } };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'operator_hold');
  assert.equal(status.code, 'operator_hold_safe');
  assert.match(status.reason, /No immediate self-preservation response is required/);
  assert.equal(calls.indexOf('modes:self_preservation') < calls.indexOf('operator:check'), true);
  assert.equal(calls.indexOf('modes:self_preservation') < calls.indexOf('modes:self_defense,cowardice'), true);
  assert.equal(calls.indexOf('modes:self_defense,cowardice') < calls.indexOf('operator:check'), true);
  const trace = arbiter.snapshot().decisionTrace.recent[0];
  assert.equal(trace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'ineligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'attributed_protection').status, 'ineligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'operator_hold').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'basic_survival').status, 'not_evaluated');
});

test('a human-attended open-water Hold maintains and releases one native surface control', async () => {
  const controls = [];
  const { agent } = fakeAgent({ held: true });
  agent.operator_hold_reason = 'operator stop command';
  agent.bot.players = { DadPlayer: { username: 'DadPlayer', entity: null } };
  agent.bot.entity = {
    isInWater: true,
    onGround: false,
    position: { floored: () => ({ x: 12, y: 62, z: 20 }) },
  };
  agent.bot.blockAt = () => ({ name: 'water' });
  agent.bot.setControlState = (name, value) => controls.push({ name, value });
  const arbiter = new BehaviorArbiter(agent, {
    heldNoHumanUnloadGraceMs: 1_000,
    trace: { enabled: true, retention: 4 },
  });

  const attended = await arbiter.update(25);
  assert.equal(attended.selectedLane, 'operator_hold');
  assert.equal(attended.code, 'operator_hold_surface_stance');
  assert.equal(attended.heldSurfaceStance.active, true);
  assert.deepEqual(controls.at(-1), { name: 'jump', value: true });
  assert.equal(agent.actions.executing, false, 'surface posture must not invent a serialized action');

  delete agent.bot.players.DadPlayer;
  const unattended = await arbiter.update(25);
  assert.equal(unattended.code, 'operator_hold_unload_grace');
  assert.equal(unattended.heldSurfaceStance.active, false);
  assert.deepEqual(controls.at(-1), { name: 'jump', value: false });
});

test('releasing Operator Hold synchronously releases an owned open-water surface control', () => {
  const controls = [];
  const { agent } = fakeAgent({ held: true });
  agent.bot.setControlState = (name, value) => controls.push({ name, value });
  const arbiter = new BehaviorArbiter(agent);
  arbiter.heldSurfaceStance = {
    active: true,
    code: 'maintaining_breathable_surface',
    updatedAt: Date.now(),
  };

  assert.equal(arbiter.releaseHeldSurfaceStance('operator_hold_released'), true);
  assert.deepEqual(controls, [{ name: 'jump', value: false }]);
  assert.equal(arbiter.snapshot().heldSurfaceStance.active, false);
});

test('missing player-roster evidence never authorizes an open-water surface posture', async () => {
  const controls = [];
  const { agent } = fakeAgent({ held: true });
  agent.operator_hold_reason = 'operator stop command';
  agent.bot.entity = {
    isInWater: true,
    onGround: false,
    position: { floored: () => ({ x: 12, y: 62, z: 20 }) },
  };
  agent.bot.blockAt = () => ({ name: 'water' });
  agent.bot.setControlState = (name, value) => controls.push({ name, value });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.code, 'operator_hold_roster_unknown');
  assert.equal(status.heldSurfaceStance.active, false);
  assert.deepEqual(controls, []);
});

test('the arbiter resumes one deferred finite player action after mortal reflexes clear', async () => {
  const { agent } = fakeAgent();
  let resumed = 0;
  agent.actions = {
    executing: false,
    currentActionLabel: '',
    currentActionOwner: '',
    hasDeferredPlayerAction: () => true,
    resumeDeferredPlayerAction() {
      resumed += 1;
      return Promise.resolve({ success: true });
    },
  };
  agent.isIdle = () => true;
  agent.self_prompter = { isActive: () => false };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'player_directive');
  assert.equal(status.code, 'deferred_player_action_resumed');
  assert.equal(resumed, 1);
});

test('the pure companion policy selects retreat, recovery, and exact resume from authoritative state', () => {
  const directive = {
    directive: 'follow',
    canonicalUsername: 'DadPlayer',
    authorizedAt: 900,
    presence: 'present',
  };
  const threat = {
    entityId: 44,
    attribution: 'self_damage',
  };

  assert.equal(chooseCompanionAction({
    directive,
    threat,
    retreatRequired: true,
    tacticalEligible: true,
  }).intent, 'retreat');

  assert.equal(chooseCompanionAction({
    directive,
    threat,
    retreatRequired: false,
    tacticalEligible: true,
    recoveryOwnsThreat: true,
  }).intent, 'yield_safety_recovery');

  const resumed = chooseCompanionAction({
    directive,
    resumeRequested: true,
    resumeRequest: { ...directive },
    bodyIdle: true,
    safetyIncidentActive: false,
  });
  assert.equal(resumed.intent, 'resume_directive');
  assert.equal(resumed.code, 'exact_directive_resume');
});

test('the pure companion policy rejects unchanged tactics and stale, held, or dead continuation', () => {
  const directive = {
    directive: 'follow',
    canonicalUsername: 'DadPlayer',
    authorizedAt: 900,
    presence: 'present',
  };
  const unchanged = chooseCompanionAction({
    directive,
    threat: { entityId: 44, attribution: 'self_damage' },
    retreatRequired: true,
    tacticalEligible: false,
    tacticalCode: 'unchanged_failed_tactical_suppressed',
  });
  assert.equal(unchanged.intent, 'wait_material_change');
  assert.equal(unchanged.rejected.some(item => item.intent === 'resume_directive'), true);

  const replacement = chooseCompanionAction({
    directive: { ...directive, authorizedAt: 901 },
    resumeRequested: true,
    resumeRequest: directive,
    bodyIdle: true,
  });
  assert.equal(replacement.intent, 'cancel_stale_resume');

  assert.equal(chooseCompanionAction({
    directive,
    resumeRequested: true,
    resumeRequest: directive,
    bodyIdle: true,
    operatorHeld: true,
  }).intent, 'hold');
  assert.equal(chooseCompanionAction({
    directive,
    resumeRequested: true,
    resumeRequest: directive,
    bodyIdle: true,
    dead: true,
  }).code, 'body_unavailable');

  assert.equal(chooseCompanionAction({
    directive,
    threat: { entityId: null, attribution: 'self_damage' },
    tacticalEligible: true,
  }).intent, 'continue_existing_policy', 'missing target identity cannot authorize combat');
  assert.equal(chooseCompanionAction({
    directive: { ...directive, canonicalUsername: '' },
    resumeRequested: true,
    resumeRequest: { ...directive, canonicalUsername: '' },
    bodyIdle: true,
  }).intent, 'cancel_stale_resume', 'missing player identity cannot authorize continuation');

  assert.equal(chooseCompanionAction({
    directive,
    resumeRequested: true,
    resumeRequest: directive,
    bodyIdle: true,
    directiveSettlement: { active: true, state: 'unchanged', code: 'directive_route_unchanged' },
  }).intent, 'wait_material_change');
  assert.equal(chooseCompanionAction({
    directive,
    resumeRequested: true,
    resumeRequest: directive,
    bodyIdle: true,
    directiveSettlement: { active: true, state: 'unknown', code: 'directive_route_unchanged' },
  }).intent, 'wait_material_change', 'unknown blocker evidence cannot authorize continuation');
  assert.equal(chooseCompanionAction({
    directive,
    resumeRequested: true,
    resumeRequest: directive,
    bodyIdle: true,
    directiveSettlement: { active: true, state: 'changed', code: 'directive_route_unchanged' },
  }).intent, 'resume_directive');
});

test('standing directives share one material-change gate for hazard and existing-action resumes', async () => {
  let targetPosition = { x: 8, y: 62, z: 0 };
  let targetLiquid = true;
  let botLocalBlock = 'dirt';
  let explicitResumes = 0;
  let existingResumes = 0;
  const targetEntity = {
    id: 44,
    username: 'DadPlayer',
    get position() {
      return {
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z,
        floored() {
          const origin = { x: Math.floor(this.x), y: Math.floor(this.y), z: Math.floor(this.z) };
          return {
            ...origin,
            offset(x, y, z) { return { x: origin.x + x, y: origin.y + y, z: origin.z + z }; },
          };
        },
      };
    },
    get isInWater() { return targetLiquid; },
    isInLava: false,
  };
  const directive = () => ({
    directive: 'follow',
    canonicalUsername: 'DadPlayer',
    directiveAuthorizedAt: 900,
    presence: 'present',
    entityId: 44,
    entityEpoch: 2,
    position: { ...targetPosition },
    dimension: 'overworld',
  });
  const modes = {
    beginUpdateCycle() {},
    endUpdateCycle() {},
    updateBand() { return { active: false, scheduled: false, code: 'inactive' }; },
  };
  const actions = {
    executing: false,
    currentActionLabel: '',
    currentActionOwner: '',
    resume_func: () => true,
    resume_name: 'action:followPlayer',
    hasDeferredPlayerAction: () => false,
    resumeAction() { existingResumes += 1; return true; },
  };
  const agent = {
    name: 'DirectiveSettlementBot',
    runtime: { autonomy: 'command' },
    bot: {
      health: 20,
      food: 20,
      oxygenLevel: 20,
      entity: {
        position: {
          x: 0,
          y: 64,
          z: 0,
          floored() {
            return {
              x: 0,
              y: 64,
              z: 0,
              offset(x, y, z) { return { x, y: 64 + y, z }; },
            };
          },
        },
      },
      entities: { 44: targetEntity },
      players: { DadPlayer: { username: 'DadPlayer', entity: targetEntity } },
      modes,
      blockAt(position) {
        if (Number(position?.x) < 4) return { name: botLocalBlock };
        return { name: targetLiquid ? 'water' : 'air' };
      },
    },
    actions,
    companion_context: { snapshot: directive },
    environment_observer: { nextSampleAt: 0, update() {} },
    self_prompter: { isActive: () => false, update() {} },
    isOperatorHeld: () => false,
    isIdle: () => true,
    checkTaskDone() {},
    resumeCompanionDirective() { explicitResumes += 1; return true; },
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 8 } });
  agent.behavior_arbiter = arbiter;

  arbiter.recordOutcome({
    label: 'mode:self_preservation',
    phase: 'failed',
    code: 'skill_drowning_escape_unconfirmed',
    evidence: { skill: { outcome: 'drowning_escape_unconfirmed' } },
  });
  arbiter.requestDirectiveResume(directive());
  const hazardWait = await arbiter.update(25);
  assert.equal(hazardWait.selectedLane, 'player_directive');
  assert.equal(hazardWait.code, 'directive_hazard_unchanged');
  assert.equal(explicitResumes, 0);

  targetLiquid = false;
  const hazardReleased = await arbiter.update(25);
  assert.equal(hazardReleased.code, 'exact_directive_resumed');
  assert.equal(explicitResumes, 1);

  arbiter.recordOutcome({
    label: 'action:followPlayer',
    phase: 'failed',
    code: 'skill_waiting_for_material_change',
    evidence: { skill: { outcome: 'waiting_for_material_change' } },
  });
  assert.equal(arbiter.directiveMaterialChangeBlocker?.code, 'directive_route_unchanged');
  assert.equal(arbiter.directiveSettlement(directive()).state, 'unchanged');
  const routeWait = await arbiter.update(25);
  assert.equal(routeWait.code, 'directive_route_unchanged');
  assert.equal(existingResumes, 0);

  botLocalBlock = 'air';
  const routeReleased = await arbiter.update(25);
  assert.equal(routeReleased.code, 'continuation_resumed');
  assert.equal(existingResumes, 1);
});

test('every completed drowning receipt is a standing-directive settlement but interruption is censored', () => {
  for (const [phase, outcome] of [
    ['succeeded', 'drowning_escape_stable'],
    ['failed', 'drowning_escape_open_water'],
    ['failed', 'drowning_escape_unconfirmed'],
  ]) {
    assert.equal(isDirectiveHazardSettlementEvidence({
      label: 'mode:self_preservation',
      phase,
      evidence: { skill: { outcome } },
    }), true, outcome);
  }
  assert.equal(isDirectiveHazardSettlementEvidence({
    label: 'mode:self_preservation',
    phase: 'interrupted',
    evidence: { skill: { outcome: 'interrupted' } },
  }), false);
  assert.equal(isDirectiveHazardSettlementEvidence({
    label: 'action:followPlayer',
    phase: 'failed',
    evidence: { skill: { outcome: 'drowning_escape_unconfirmed' } },
  }), false);
});

test('attributed danger interrupts follow, yields to recovery, and resumes the exact directive once', async () => {
  const bot = new EventEmitter();
  bot.health = 7;
  bot.food = 20;
  bot.oxygenLevel = 20;
  bot.interrupt_code = false;
  bot.output = '';
  bot.lastActionEvidence = null;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  const directive = {
    directive: 'follow',
    canonicalUsername: 'DadPlayer',
    directiveAuthorizedAt: 900,
    presence: 'present',
  };
  let threatPresent = true;
  let recoveryPending = false;
  let recoverySelected = false;
  let tacticalDispatches = 0;
  let resumes = 0;
  let legacyAttributedSelections = 0;
  let reflexSettled = Promise.resolve();
  let followRuns = 0;
  const agent = {
    name: 'ContinuityBot',
    runtime: { autonomy: 'command' },
    bot,
    companion_context: {
      snapshot: () => ({ ...directive }),
    },
    environment_observer: { nextSampleAt: 0, update() {} },
    self_prompter: { isActive: () => false, stopLoop() {} },
    isOperatorHeld: () => false,
    checkTaskDone() {},
    requestInterrupt() { bot.interrupt_code = true; },
    clearBotLogs() {
      bot.output = '';
      bot.interrupt_code = false;
    },
    recordActionResult(result) {
      this.survival_director?.observeActionResult?.(result);
      this.behavior_arbiter?.recordOutcome?.(result);
    },
    resumeCompanionDirective() {
      resumes += 1;
      this.actions.cancelResume();
      return true;
    },
  };
  agent.actions = new ActionManager(agent);
  agent.isIdle = () => !agent.actions.executing;
  agent.survival_director = {
    inFlight: false,
    status: { code: 'idle' },
    safetyIncident: null,
    blocksLowerPriority() { return this.inFlight; },
    snapshot() { return { safetyIncident: this.safetyIncident }; },
    observeAttributedThreat(receipt) {
      assert.equal(receipt.entityId, 44);
      recoveryPending = true;
      this.safetyIncident = {
        active: true,
        stage: 'threat_response',
        source: { kind: 'hostile', id: receipt.entityId },
      };
      return true;
    },
    observeActionResult(result) {
      if (result.evidence?.skill?.outcome !== 'retreated') return false;
      assert.equal(this.safetyIncident?.stage, 'threat_response');
      this.safetyIncident = { ...this.safetyIncident, stage: 'disengaged' };
      return true;
    },
    update() {
      if (!recoveryPending) return;
      recoverySelected = true;
      this.inFlight = true;
      this.status = { code: 'return_to_player' };
    },
  };
  bot.modes = {
    beginUpdateCycle() {},
    endUpdateCycle() {},
    proposeAttributedAccompaniment() {
      if (!threatPresent) return { applicable: false, code: 'attributed_threat_absent' };
      return {
        applicable: true,
        directive: {
          directive: directive.directive,
          canonicalUsername: directive.canonicalUsername,
          authorizedAt: directive.directiveAuthorizedAt,
          presence: directive.presence,
        },
        threat: { entityId: 44, attribution: 'self_damage', name: 'skeleton' },
        retreatRequired: true,
        recoveryOwnsThreat: recoveryPending,
        tacticalEligible: true,
        tacticalCode: 'self_defense_evidence_changed',
      };
    },
    updateBand(names, options = {}) {
      if (names.includes('self_defense') || names.includes('cowardice')) {
        legacyAttributedSelections += 1;
      }
      if (options.skipAttributedAccompaniment === true) {
        return { active: false, scheduled: false, code: 'shared_accompaniment_policy_owns_threat' };
      }
      return { active: false, scheduled: false, code: 'inactive' };
    },
    dispatchAttributedAccompaniment(intent, proposal) {
      assert.equal(intent, 'retreat');
      assert.equal(agent.survival_director.observeAttributedThreat(proposal.threat), true);
      assert.equal(agent.survival_director.safetyIncident.stage, 'threat_response');
      tacticalDispatches += 1;
      reflexSettled = agent.actions.runAction('mode:self_preservation', () => {
          bot.lastActionEvidence = { outcome: 'retreated' };
          return true;
        }, { owner: 'reflex' })
        .then(outcome => {
          agent.behavior_arbiter.requestDirectiveResume(proposal.directive);
          return outcome;
        });
      return {
        active: true,
        scheduled: true,
        mode: 'self_preservation',
        code: 'shared_accompaniment_intent_scheduled',
      };
    },
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 8 } });
  agent.behavior_arbiter = arbiter;

  const followStarted = new Promise(resolve => {
    const poll = () => {
      if (agent.actions.currentActionLabel === 'action:followPlayer') resolve();
      else setImmediate(poll);
    };
    poll();
  });
  const follow = agent.actions.runAction('action:followPlayer', async () => {
    followRuns += 1;
    if (followRuns > 1) return true;
    while (!bot.interrupt_code) await new Promise(resolve => setImmediate(resolve));
    return false;
  }, { owner: 'player', resume: true, timeout: -1 });
  await followStarted;

  const interrupted = await arbiter.update(25);
  await follow;
  await reflexSettled;
  assert.equal(interrupted.selectedLane, 'attributed_protection');
  assert.equal(interrupted.code, 'critical_self_preservation');
  assert.equal(tacticalDispatches, 1);
  assert.equal(legacyAttributedSelections, 0, 'the migrated edge cannot also run the legacy protection band');
  assert.equal(arbiter.directiveResumeRequested, true);

  const recovering = await arbiter.update(25);
  assert.equal(recovering.selectedLane, 'basic_survival');
  assert.equal(recoverySelected, true);
  assert.equal(resumes, 0, 'disengagement is not yet safe settlement');
  assert.equal(arbiter.directiveResumeRequested, true);

  threatPresent = false;
  recoveryPending = false;
  agent.survival_director.inFlight = false;
  agent.survival_director.safetyIncident = null;
  agent.survival_director.status = { code: 'safe' };
  const resumed = await arbiter.update(25);
  assert.equal(resumed.selectedLane, 'player_directive');
  assert.equal(resumed.code, 'exact_directive_resumed');
  assert.equal(resumes, 1);

  await arbiter.update(25);
  assert.equal(resumes, 1, 'the exact standing directive resumes at most once');
});

test('held lifecycle classifies distant tab-listed humans and excludes known bot profiles', () => {
  const agent = {
    name: 'HeldBot',
    getKnownAgentNames: () => ['HeldBot', 'HelperBot'],
    bot: {
      players: {
        HeldBot: { username: 'HeldBot', entity: null },
        HelperBot: { username: 'HelperBot', entity: null },
        DadPlayer: { username: 'DadPlayer', entity: null },
      },
    },
  };

  assert.deepEqual(onlineHumanPlayerNames(agent), ['DadPlayer']);
  assert.equal(onlineHumanPlayerNames({ name: 'HeldBot', bot: {} }), null);
});

test('a continuously human-empty Hold unloads once after grace and presence resets the clock', async () => {
  let now = 1_000;
  let held = true;
  const unloads = [];
  const { agent } = fakeAgent({ held: true });
  agent.bot.players = {
    HeldBot: { username: 'HeldBot', entity: null },
    HelperBot: { username: 'HelperBot', entity: null },
  };
  agent.name = 'HeldBot';
  agent.operator_hold_reason = 'operator stop command';
  agent.getKnownAgentNames = () => ['HeldBot', 'HelperBot'];
  agent.isOperatorHeld = () => held;
  agent.teardownAndExit = async (reason, code) => {
    unloads.push({ reason, code });
  };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => now,
    heldNoHumanUnloadGraceMs: 1_000,
    trace: { enabled: true, retention: 8 },
  });

  assert.equal((await arbiter.update(25)).code, 'operator_hold_unload_grace');
  now += 900;
  assert.equal((await arbiter.update(25)).code, 'operator_hold_unload_grace');
  agent.bot.players.DadPlayer = { username: 'DadPlayer', entity: null };
  now += 200;
  assert.equal((await arbiter.update(25)).code, 'operator_hold_safe');

  delete agent.bot.players.DadPlayer;
  assert.equal((await arbiter.update(25)).code, 'operator_hold_unload_grace');
  now += 1_000;
  assert.equal((await arbiter.update(25)).code, 'operator_hold_unloading');
  await Promise.resolve();
  assert.equal(unloads.length, 1);
  assert.equal(unloads[0].code, 0);
  assert.match(unloads[0].reason, /no human players online/);

  now += 1_000;
  assert.equal((await arbiter.update(25)).code, 'operator_hold_unloading');
  await Promise.resolve();
  assert.equal(unloads.length, 1);

  held = false;
});

test('human absence does not unload a temporary assignment-compilation Hold', async () => {
  let now = 1_000;
  let unloads = 0;
  const { agent } = fakeAgent({ held: true });
  agent.name = 'HeldBot';
  agent.operator_hold_reason = 'construction assignment pending';
  agent.bot.players = { HeldBot: { username: 'HeldBot', entity: null } };
  agent.getKnownAgentNames = () => ['HeldBot'];
  agent.teardownAndExit = async () => { unloads += 1; };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => now,
    heldNoHumanUnloadGraceMs: 1_000,
    trace: { enabled: true, retention: 4 },
  });

  assert.equal((await arbiter.update(25)).code, 'operator_hold_safe');
  now += 10_000;
  assert.equal((await arbiter.update(25)).code, 'operator_hold_safe');
  await Promise.resolve();
  assert.equal(unloads, 0);
});

test('an operator-held bot admits bounded mortal reflexes and returns to hold', async () => {
  let danger = true;
  let recentDamageThreat = false;
  let held = true;
  let reflexRuns = 0;
  let defenseRuns = 0;
  const recorded = [];
  const zombie = {
    id: 12,
    type: 'hostile',
    name: 'zombie',
    position: { x: 2, y: 64, z: 0 },
  };
  const agent = {
    name: 'HeldBot',
    runtime: { autonomy: 'command' },
    operator_hold_reason: 'Operator stop is active.',
    bot: {
      health: 8,
      food: 20,
      oxygenLevel: 20,
      players: { DadPlayer: { username: 'DadPlayer', entity: null } },
      interrupt_code: false,
      output: '',
      lastActionEvidence: null,
      lastDamageTime: 0,
      lastDamageSource: null,
      entities: { 12: zombie },
      entity: {
        position: {
          x: 0,
          y: 64,
          z: 0,
          distanceTo(position) {
            return Math.hypot(position.x - this.x, position.y - this.y, position.z - this.z);
          },
        },
      },
      nearestEntity(predicate) {
        return recentDamageThreat && predicate(zombie) ? zombie : null;
      },
      emit() {},
    },
    clearBotLogs() { this.bot.output = ''; },
    isOperatorHeld() { return held; },
    checkTaskDone() {},
    recordActionResult(result) {
      recorded.push(result);
      this.behavior_arbiter?.recordOutcome?.(result);
    },
    environment_observer: { nextSampleAt: 0, update() {} },
  };
  agent.actions = new ActionManager(agent);
  agent.bot.modes = {
    beginUpdateCycle() {},
    endUpdateCycle() {},
    async updateBand(names) {
      if (names.includes('self_preservation') && danger) {
        const outcome = await agent.actions.runAction('mode:self_preservation', () => {
          reflexRuns += 1;
          assert.equal(held, true);
          agent.bot.lastActionEvidence = { outcome: 'retreated' };
          return true;
        }, { owner: 'reflex' });
        return {
          active: false,
          scheduled: outcome.success,
          mode: 'self_preservation',
          code: outcome.success ? 'mode_scheduled' : outcome.result?.code,
        };
      }
      if (names.includes('self_defense') && recentDamageThreat) {
        const suppression = getModeSuppressionReason(agent, { name: 'self_defense' });
        if (suppression) return { active: false, scheduled: false, code: suppression };
        const outcome = await agent.actions.runAction('mode:self_defense', () => {
          defenseRuns += 1;
          assert.equal(held, true);
          agent.bot.lastActionEvidence = { outcome: 'threat_resolved' };
          return true;
        }, { owner: 'reflex' });
        return {
          active: false,
          scheduled: outcome.success,
          mode: 'self_defense',
          code: outcome.success ? 'mode_scheduled' : outcome.result?.code,
        };
      }
      return { active: false, scheduled: false, code: 'inactive' };
    },
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });
  agent.behavior_arbiter = arbiter;

  const ordinary = await agent.actions.runAction('action:consume', () => true, { owner: 'survival' });
  assert.equal(ordinary.result.code, 'operator_hold');
  assert.equal(reflexRuns, 0);

  const dangerStatus = await arbiter.update(25);
  assert.equal(dangerStatus.selectedLane, 'emergency_self_preservation');
  assert.equal(reflexRuns, 1);
  assert.equal(held, true);
  assert.equal(agent.actions.executing, false);
  assert.equal(recorded.at(-1).code, 'skill_retreated');

  danger = false;
  recentDamageThreat = true;
  agent.bot.lastDamageTime = Date.now();
  agent.bot.lastDamageSource = {
    matchesSelf: true,
    kind: 'hostile',
    observedAt: Date.now(),
    source: { id: 12, name: 'zombie', username: null },
  };
  const defenseStatus = await arbiter.update(25);
  assert.equal(defenseStatus.selectedLane, 'attributed_protection');
  assert.equal(defenseRuns, 1);
  assert.equal(held, true);
  assert.equal(agent.actions.executing, false);

  recentDamageThreat = false;
  agent.bot.lastDamageTime = 0;
  agent.bot.lastDamageSource = null;
  const heldStatus = await arbiter.update(25);
  assert.equal(heldStatus.selectedLane, 'operator_hold');
  assert.equal(heldStatus.code, 'operator_hold_safe');
  assert.equal(held, true);
  const heldTrace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(heldTrace.lanes.find(lane => lane.lane === 'emergency_self_preservation').status, 'ineligible');
  assert.equal(heldTrace.lanes.find(lane => lane.lane === 'operator_hold').status, 'eligible');

  held = false;
});

test('hunger survival ownership hands off to the persisted survival-job lane', async () => {
  let hungerPending = true;
  const survival = {
    inFlight: false,
    status: { code: 'idle' },
    update() {
      if (!hungerPending) return;
      this.inFlight = true;
      this.status = { code: 'skill_consuming' };
    },
    blocksLowerPriority() { return this.inFlight; },
  };
  const job = {
    activeOrder: { id: 'survival-shelter', source: 'survival', phase: 'assess' },
    status: { code: 'job_accepted' },
    updates: 0,
    update() {
      this.updates += 1;
      this.status = { code: 'job_assess' };
    },
  };
  const { agent } = fakeAgent({ survival, job });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const hungerStatus = await arbiter.update(25);
  assert.equal(hungerStatus.selectedLane, 'basic_survival');
  assert.equal(job.updates, 0);

  hungerPending = false;
  survival.inFlight = false;
  survival.status = { code: 'skill_consumed' };
  const jobStatus = await arbiter.update(25);
  assert.equal(jobStatus.selectedLane, 'basic_survival');
  assert.equal(jobStatus.code, 'job_assess');
  assert.equal(job.updates, 1);
  const trace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(trace.lanes.find(lane => lane.lane === 'basic_survival').status, 'ineligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'survival_job').status, 'eligible');
});

test('critical bodily survival gets a chance to preempt an active player goal', async () => {
  let survivalUpdates = 0;
  const survival = {
    inFlight: false,
    status: { code: 'idle' },
    update() {
      survivalUpdates += 1;
      this.inFlight = true;
      this.status = { code: 'acquire_food' };
    },
    blocksLowerPriority() { return this.inFlight; },
  };
  const { agent } = fakeAgent({ survival });
  agent.bot.health = 20;
  agent.bot.food = 6;
  agent.goal_director = { activeGoal: { id: 'family-breakfast' } };
  agent.actions = {
    executing: true,
    currentActionId: 'player-action-1',
    currentActionLabel: 'action:collectWoodInRange',
    currentActionOwner: 'player',
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'basic_survival');
  assert.equal(status.code, 'acquire_food');
  assert.equal(survivalUpdates, 1);
  const trace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(trace.lanes.find(lane => lane.lane === 'basic_survival').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'active_action_retention').status, 'not_evaluated');
  assert.deepEqual(trace.winner.preemption, {
    involved: true,
    fromOwner: 'player',
    fromAction: 'action:collectWoodInRange',
    toLane: 'basic_survival',
  });
});

test('a settled survival help wait permits eye tracking without releasing movement autonomy', async () => {
  const survival = {
    inFlight: false,
    status: { phase: 'waiting', code: 'safety_cover_unavailable' },
    update() {},
    blocksLowerPriority: () => true,
    permitsIdleEmbodiment: () => true,
  };
  const { agent } = fakeAgent({ survival });
  agent.isIdle = () => true;
  agent.bot.modes.updateBand = names => (
    names.includes('idle_staring')
      ? { active: true, scheduled: true, mode: 'idle_staring', code: 'tracking_player' }
      : { active: false, scheduled: false, code: 'inactive' }
  );
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'idle_embodiment');
  assert.equal(status.code, 'tracking_player');
});

test('decision trace retention remains bounded and later short-circuited lanes stay explicit', async () => {
  const { agent } = fakeAgent({ emergency: true });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 2 } });

  await arbiter.update(25);
  await arbiter.update(25);
  await arbiter.update(25);

  const snapshot = arbiter.snapshot().decisionTrace;
  assert.equal(snapshot.retained, 2);
  assert.equal(snapshot.retentionLimit, 2);
  assert.equal(snapshot.recent.every(trace => (
    trace.lanes.find(lane => lane.lane === 'player_goal').status === 'not_evaluated'
  )), true);
});

test('a typed goal terminal transition retains the player-goal lane for the whole arbiter tick', async () => {
  const { agent } = fakeAgent();
  let progressionUpdates = 0;
  let protectedCompletion = false;
  agent.goal_director = {
    activeGoal: { id: 'goal-terminal-handoff' },
    inFlight: false,
    status: { code: 'goal_acting' },
    update() {
      this.activeGoal = null;
      this.status = { code: 'inventory_goal_verified' };
      protectedCompletion = true;
    },
    hasProtectedCompletion: () => protectedCompletion,
  };
  agent.progression_director = {
    permitted: () => true,
    update() {
      progressionUpdates += 1;
      this.inFlight = true;
    },
    inFlight: false,
  };
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  const status = await arbiter.update(25);

  assert.equal(status.selectedLane, 'player_goal');
  assert.equal(status.code, 'inventory_goal_verified');
  assert.equal(progressionUpdates, 0);
  const trace = arbiter.snapshot().decisionTrace.recent.at(-1);
  assert.equal(trace.lanes.find(lane => lane.lane === 'player_goal').status, 'eligible');
  assert.equal(trace.lanes.find(lane => lane.lane === 'self_progression').status, 'not_evaluated');

  const protectedStatus = await arbiter.update(25);
  assert.equal(protectedStatus.selectedLane, 'player_goal');
  assert.equal(protectedStatus.code, 'player_goal_output_reserved');
  assert.equal(progressionUpdates, 0);

  protectedCompletion = false;
  arbiter.releaseTerminalHandoff('The protected completion was released.', false);
  const releasedStatus = await arbiter.update(25);
  assert.equal(releasedStatus.selectedLane, 'self_progression');
  assert.equal(progressionUpdates, 1);
});

test('a matching active agenda step consumes protected goal completion before queued handoff', async () => {
  let now = 20_000;
  let protectedCompletion = true;
  let progressionUpdates = 0;
  const persisted = [];
  const store = {
    lastError: null,
    load: () => [],
    save(entries) { persisted.push(entries.map(entry => ({ ...entry }))); },
  };
  const { agent } = fakeAgent();
  agent.bot.inventory = { slots: [] };
  agent.job_director = { activeOrder: null };
  agent.openChat = () => Promise.resolve();
  agent.progression_director = {
    permitted: () => true,
    update() { progressionUpdates += 1; },
    inFlight: false,
  };
  agent.goal_director = {
    activeGoal: null,
    inFlight: false,
    protectedGoalId: 'goal-pickaxe',
    lastGoal: {
      id: 'goal-pickaxe',
      kind: 'deliver',
      requester: 'phixxation',
      target: { requestedName: 'iron_pickaxe' },
      quantity: 1,
      completion: { kind: 'delivery' },
      destination: { player: 'phixxation' },
      phase: 'complete',
      evidence: { code: 'delivery_verified', detail: 'Minecraft verified delivery.' },
    },
    status: { code: 'goal_idle' },
    hasProtectedCompletion: () => protectedCompletion,
    releaseProtectedCompletion(_reason, options) {
      assert.deepEqual(options, { preserveTerminalHandoff: true });
      protectedCompletion = false;
      this.protectedGoalId = null;
      return true;
    },
    submit(goal) {
      this.activeGoal = goal;
      this.lastGoal = null;
      this.status = { code: 'goal_accepted' };
      return { accepted: true, id: 'goal-axe' };
    },
    update() {},
  };
  const agenda = new AgendaDirector(agent, {
    store,
    now: () => now,
    resolveTarget: (_bot, name) => ({
      requestedName: name,
      canonicalName: name,
      inventoryName: name,
      acquisitionName: name,
      family: null,
      acquisitionKind: 'prepare_tool',
    }),
  });
  const pickaxe = agenda.add({
    kind: 'deliver', requester: 'phixxation', recipient: 'phixxation', target: 'iron_pickaxe', quantity: 1,
  });
  const axe = agenda.add({
    kind: 'deliver', requester: 'phixxation', recipient: 'phixxation', target: 'iron_axe', quantity: 1,
  });
  agenda.replace(pickaxe.id, { state: 'active', startedAt: now - 1_000, executorId: 'goal-pickaxe' });
  agent.agenda_director = agenda;
  const arbiter = new BehaviorArbiter(agent, { now: () => now, trace: { enabled: true, retention: 6 } });
  agent.behavior_arbiter = arbiter;

  const settled = await arbiter.update(25);
  assert.equal(settled.selectedLane, 'player_goal');
  assert.equal(settled.code, 'agenda_goal_completion_consumed');
  assert.equal(protectedCompletion, false);
  assert.equal(agenda.entries.find(entry => entry.id === pickaxe.id)?.state, 'complete');
  assert.equal(agenda.entries.find(entry => entry.id === axe.id)?.state, 'pending');
  assert.equal(persisted.at(-1).find(entry => entry.id === pickaxe.id)?.state, 'complete');
  assert.equal(progressionUpdates, 0);

  now += 200;
  const coolingDown = await arbiter.update(25);
  assert.equal(coolingDown.code, 'agenda_handoff_pending');
  assert.equal(progressionUpdates, 0, 'lower autonomy must not run between agenda steps');

  now += 800;
  const continued = await arbiter.update(25);
  assert.equal(continued.selectedLane, 'player_goal');
  assert.equal(agent.goal_director.activeGoal?.target?.canonicalName, 'iron_axe');
  const activeAxe = agenda.entries.find(entry => entry.id === axe.id);
  assert.equal(activeAxe?.state, 'active');
  assert.equal(activeAxe?.executorId, 'goal-axe');
  assert.equal(progressionUpdates, 0);
});

test('bounded terminal handoff suppresses autonomy but yields to every higher companion owner', async () => {
  let now = 10_000;
  let progressionUpdates = 0;
  let standingOrderUpdates = 0;
  let agendaUpdates = 0;
  let settleReport;
  const report = new Promise(resolve => { settleReport = resolve; });
  const { agent } = fakeAgent();
  agent.rule_engine = { update() { standingOrderUpdates += 1; } };
  agent.agenda_director = { update() { agendaUpdates += 1; } };
  agent.progression_director = {
    permitted: () => true,
    update() {
      progressionUpdates += 1;
      this.inFlight = true;
    },
    inFlight: false,
  };
  agent.goal_director = {
    activeGoal: { id: 'goal-failed-handoff' },
    lastGoal: null,
    inFlight: false,
    status: { code: 'goal_acting' },
    update() {
      this.activeGoal = null;
      this.lastGoal = { id: 'goal-failed-handoff', phase: 'failed' };
      this.status = { code: 'skill_target_unreachable' };
      agent.behavior_arbiter.beginTerminalHandoff({
        goalId: this.lastGoal.id,
        phase: this.lastGoal.phase,
        code: this.status.code,
        reportPromise: report,
      });
    },
    hasProtectedCompletion: () => false,
  };
  const arbiter = new BehaviorArbiter(agent, {
    now: () => now,
    trace: { enabled: true, retention: 16 },
  });
  agent.behavior_arbiter = arbiter;

  const terminal = await arbiter.update(25);
  assert.equal(terminal.selectedLane, 'player_goal');
  assert.equal(progressionUpdates, 0);
  const standingOrdersAtTerminal = standingOrderUpdates;
  const agendaAtTerminal = agendaUpdates;

  now += 500;
  const pending = await arbiter.update(25);
  assert.equal(pending.code, 'player_goal_terminal_handoff');
  assert.equal(pending.terminalHandoff.reportPending, true);
  assert.equal(standingOrderUpdates, standingOrdersAtTerminal);
  assert.equal(agendaUpdates, agendaAtTerminal);
  assert.equal(progressionUpdates, 0);

  settleReport(true);
  await Promise.resolve();
  now += 400;
  assert.equal((await arbiter.update(25)).code, 'player_goal_terminal_handoff');
  now += 200;
  const released = await arbiter.update(25);
  assert.equal(released.selectedLane, 'self_progression');
  assert.equal(progressionUpdates, 1);

  progressionUpdates = 0;
  agent.progression_director.inFlight = false;
  const neverSettles = new Promise(() => {});
  arbiter.beginTerminalHandoff({
    goalId: 'goal-priority-handoff',
    phase: 'failed',
    code: 'failed',
    reportPromise: neverSettles,
  });

  agent.isOperatorHeld = () => true;
  assert.equal((await arbiter.update(25)).selectedLane, 'operator_hold');
  assert.equal(progressionUpdates, 0);
  agent.isOperatorHeld = () => false;

  agent.survival_director = {
    inFlight: false,
    update() { this.inFlight = true; },
    blocksLowerPriority() { return this.inFlight; },
  };
  assert.equal((await arbiter.update(25)).selectedLane, 'basic_survival');
  assert.equal(progressionUpdates, 0);
  agent.survival_director = null;

  agent.companion_context = { snapshot: () => ({ directive: { kind: 'follow' } }) };
  agent.actions = {
    executing: true,
    currentActionId: 'follow-action',
    currentActionLabel: 'action:follow',
    currentActionOwner: 'player',
  };
  assert.equal((await arbiter.update(25)).selectedLane, 'player_directive');
  assert.equal(arbiter.snapshot().terminalHandoff, null);
  assert.equal(progressionUpdates, 0);

  agent.actions = { executing: false, currentActionLabel: '', currentActionOwner: '' };
  agent.companion_context = null;
  arbiter.beginTerminalHandoff({
    goalId: 'goal-before-new-command',
    phase: 'failed',
    code: 'failed',
    reportPromise: neverSettles,
  });
  agent.goal_director.activeGoal = { id: 'goal-new-player-command' };
  agent.goal_director.update = function update() {
    this.status = { code: 'goal_assess' };
  };
  assert.equal((await arbiter.update(25)).selectedLane, 'player_goal');
  assert.equal(arbiter.snapshot().terminalHandoff, null);
  assert.equal(progressionUpdates, 0);

  agent.goal_director.activeGoal = null;
  arbiter.beginTerminalHandoff({
    outcomeId: 'job-complete-handoff',
    owner: 'player_job',
    phase: 'complete',
    code: 'delivery_verified',
  });
  const playerJobHandoff = await arbiter.update(25);
  assert.equal(playerJobHandoff.selectedLane, 'player_job');
  assert.equal(playerJobHandoff.code, 'player_job_terminal_handoff');
  assert.equal(playerJobHandoff.terminalHandoff.outcomeId, 'job-complete-handoff');
  assert.equal(progressionUpdates, 0);
});

test('scheduled wakes record prior-period overrun while event-driven early wakes do not', async () => {
  const { agent } = fakeAgent({ emergency: true });
  const arbiter = new BehaviorArbiter(agent, { trace: { enabled: true, retention: 4 } });

  await arbiter.update(350);
  arbiter.lastWakeReason = 'entity_hurt';
  await arbiter.update(900);
  assert.equal(
    arbiter.snapshot().decisionTrace.recent.at(-1).trigger.code,
    'entity_hurt',
  );
  await arbiter.update(100);

  const delay = arbiter.snapshot().decisionTrace.diagnostics.scheduledLoopDelayMs;
  assert.deepEqual(delay, {
    samples: 2,
    retentionLimit: 4,
    p50: 20,
    p95: 50,
    p99: 50,
    max: 50,
  });
});

test('nearest-rank timing summaries are deterministic, bounded, and null when empty', () => {
  let monotonic = 0;
  const recorder = new DecisionTraceRecorder({
    retention: 4,
    now: () => 1_000,
    monotonicNow: () => monotonic,
  });
  for (const [evaluation, cleanup] of [[1, 9], [2, 8], [3, 7], [4, 6], [100, 5]]) {
    const started = monotonic;
    recorder.begin();
    monotonic += evaluation + cleanup;
    recorder.finalize({ evaluationFinishedMs: started + evaluation });
  }
  for (const overrun of [1, 2, 3, 4, 100]) {
    recorder.recordScheduledLoopDelay(300 + overrun, 300);
  }

  const diagnostics = recorder.snapshot().diagnostics;
  assert.deepEqual(diagnostics.timing.evaluationMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 3,
    p95: 100,
    p99: 100,
    max: 100,
  });
  assert.deepEqual(diagnostics.timing.cleanupMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 6,
    p95: 8,
    p99: 8,
    max: 8,
  });
  assert.deepEqual(diagnostics.timing.totalMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 10,
    p95: 105,
    p99: 105,
    max: 105,
  });
  assert.deepEqual(diagnostics.scheduledLoopDelayMs, {
    samples: 4,
    retentionLimit: 4,
    p50: 3,
    p95: 100,
    p99: 100,
    max: 100,
  });

  const empty = new DecisionTraceRecorder({ retention: 4 }).snapshot().diagnostics;
  const emptySummary = {
    samples: 0,
    retentionLimit: 4,
    p50: null,
    p95: null,
    p99: null,
    max: null,
  };
  for (const summary of [
    empty.timing.evaluationMs,
    empty.timing.cleanupMs,
    empty.timing.totalMs,
    empty.scheduledLoopDelayMs,
  ]) assert.deepEqual(summary, emptySummary);
  assert.equal(empty.actionLifecycles.durationMs.samples, 0);
  assert.equal(empty.actionLifecycles.durationMs.p50, null);
  assert.equal(empty.actionLifecycles.durationMs.p95, null);
  assert.equal(empty.actionLifecycles.durationMs.p99, null);
  assert.equal(empty.actionLifecycles.durationMs.max, null);
});

test('action acquisition, release, and outcome link exactly once to the selecting decision', () => {
  let monotonic = 10;
  const recorder = new DecisionTraceRecorder({
    agent: 'TraceBot',
    now: () => 1_000,
    monotonicNow: () => monotonic += 1,
  });
  recorder.begin({ tick: 1, trigger: { code: 'scheduled_tick', deltaMs: 25 } });
  recorder.startLane('player_goal');
  recorder.select({ lane: 'player_goal', reasonCode: 'player_goal_selected', lowerLanesSuppressed: true });
  recorder.finalize({ evaluationFinishedMs: monotonic });
  assert.equal(recorder.linkAction({
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    label: '!collect',
    acquiredAt: 1_001,
    startedAt: 1_000,
  }), true);
  assert.equal(recorder.linkRelease({
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    releasedAt: 1_024,
  }), true);
  assert.equal(recorder.linkRelease({
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    releasedAt: 1_999,
  }), false);
  assert.equal(recorder.linkOutcome({
    actionId: 'TraceBot-1-1000',
    phase: 'succeeded',
    code: 'skill_collected',
    startedAt: 1_000,
    finishedAt: 1_025,
  }), true);
  assert.equal(recorder.linkAction({
    actionId: 'TraceBot-1-1000',
    acquiredAt: 2_000,
    startedAt: 2_000,
  }), false);
  assert.equal(recorder.linkOutcome({
    actionId: 'TraceBot-1-1000',
    phase: 'failed',
    code: 'duplicate',
    startedAt: 1_000,
    finishedAt: 1_999,
  }), false);

  const trace = recorder.snapshot(1).recent[0];
  assert.deepEqual(trace.actionLifecycle.acquisition, {
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    acquiredAt: 1_001,
    startedAt: 1_000,
    source: 'linked_action_start',
  });
  assert.deepEqual(trace.actionLifecycle.release, {
    actionId: 'TraceBot-1-1000',
    owner: 'player',
    ownerPriority: 30,
    releasedAt: 1_024,
    phase: 'succeeded',
    code: 'skill_collected',
  });
  assert.equal(trace.correlation.outcomeLinked, true);
  assert.equal(trace.outcome.code, 'skill_collected');
  assert.equal(trace.outcome.durationMs, 25);
  const lifecycle = recorder.snapshot(1).diagnostics.actionLifecycles.recent[0];
  assert.equal(lifecycle.durationMs, 24);
  assert.equal(lifecycle.outcome.code, 'skill_collected');
  assert.equal(recorder.snapshot(1).diagnostics.actionLifecycles.retained, 1);

  trace.actionLifecycle.release.code = 'mutated';
  assert.equal(recorder.snapshot(1).recent[0].actionLifecycle.release.code, 'skill_collected');

  const fallback = new DecisionTraceRecorder();
  assert.equal(fallback.linkAction({
    actionId: 'fallback-action',
    acquiredAt: 2_000,
  }), true);
  assert.equal(fallback.linkRelease({
    actionId: 'fallback-action',
    releasedAt: 2_010,
  }), true);
  assert.equal(
    fallback.snapshot(1).diagnostics.actionLifecycles.recent[0].durationMs,
    10,
  );
});

test('action lifecycle survives selecting trace eviction and records release once', () => {
  const recorder = new DecisionTraceRecorder({ retention: 1, now: () => 1_000 });
  recorder.begin({ tick: 1 });
  recorder.select({ lane: 'player_goal', reasonCode: 'selected', lowerLanesSuppressed: true });
  recorder.finalize();
  recorder.linkAction({ actionId: 'evicted-action', owner: 'player', acquiredAt: 10, startedAt: 10 });

  recorder.begin({ tick: 2 });
  recorder.finalize();
  assert.equal(recorder.snapshot().recent[0].correlation.actionId, null);
  assert.equal(recorder.linkRelease({ actionId: 'evicted-action', owner: 'player', releasedAt: 35 }), true);
  assert.equal(recorder.linkRelease({ actionId: 'evicted-action', owner: 'player', releasedAt: 99 }), false);
  assert.equal(recorder.linkOutcome({
    actionId: 'evicted-action',
    phase: 'succeeded',
    code: 'completed',
    startedAt: 10,
    finishedAt: 36,
  }), true);

  const lifecycles = recorder.snapshot().diagnostics.actionLifecycles;
  assert.equal(lifecycles.retained, 1);
  assert.equal(lifecycles.recent[0].durationMs, 25);
  assert.equal(lifecycles.recent[0].release.code, 'completed');
  assert.equal(lifecycles.recent[0].outcome.code, 'completed');
});

test('action lifecycle retention is bounded independently of trace retention', () => {
  const recorder = new DecisionTraceRecorder({ retention: 1 });
  const lifecycleRetention = recorder.snapshot().diagnostics.actionLifecycles.retentionLimit;
  assert.equal(lifecycleRetention > recorder.retention, true);

  for (let index = 0; index <= lifecycleRetention; index += 1) {
    const actionId = `bounded-${index}`;
    assert.equal(recorder.linkAction({
      actionId,
      startedAt: index * 10,
    }), true);
    assert.equal(recorder.linkRelease({
      actionId,
      releasedAt: index * 10 + 5,
    }), true);
  }

  const diagnostics = recorder.snapshot().diagnostics.actionLifecycles;
  assert.equal(recorder.snapshot().retained, 0);
  assert.equal(diagnostics.retained, lifecycleRetention);
  assert.equal(diagnostics.durationMs.samples, lifecycleRetention);
  assert.equal(diagnostics.durationMs.p50, 5);
  assert.equal(diagnostics.durationMs.p95, 5);
  assert.equal(diagnostics.durationMs.p99, 5);
  assert.equal(diagnostics.durationMs.max, 5);
  assert.equal(diagnostics.recent.at(-1).actionId, `bounded-${lifecycleRetention}`);
});

test('active action snapshots carry bounded provenance and owner priority', async () => {
  const { agent } = fakeAgent({ emergency: true });
  agent.actions = {
    executing: true,
    currentActionId: `active-${'x'.repeat(100)}`,
    currentActionOwner: 'job',
    currentActionLabel: '!build',
    currentActionStartedAt: 900,
    ownerPriority: () => 20,
  };
  const arbiter = new BehaviorArbiter(agent, {
    trace: { enabled: true, retention: 1 },
    now: () => 1_000,
  });

  await arbiter.update(25);

  const acquisition = arbiter.snapshot().decisionTrace.recent[0].actionLifecycle.acquisition;
  assert.equal(acquisition.actionId.length, 80);
  assert.equal(acquisition.owner, 'job');
  assert.equal(acquisition.ownerPriority, 20);
  assert.equal(acquisition.acquiredAt, 900);
  assert.equal(acquisition.startedAt, 900);
  assert.equal(acquisition.source, 'active_snapshot');
});

test('disabled lifecycle recorder methods are no-ops', () => {
  const recorder = new DecisionTraceRecorder({ enabled: false });
  assert.equal(recorder.recordScheduledLoopDelay(500, 300, true), false);
  assert.equal(recorder.linkAction({ actionId: 'disabled' }), false);
  assert.equal(recorder.linkRelease({ actionId: 'disabled', releasedAt: 1 }), false);
  assert.equal(recorder.linkOutcome({ actionId: 'disabled', phase: 'succeeded', code: 'completed' }), false);
  assert.equal(recorder.snapshot(), null);
});

test('the compact reporter formats the representative v1 fixture', () => {
  const fixtureUrl = new URL('../fixtures/decision-trace.v1.json', import.meta.url);
  const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
  const traces = extractDecisionTraces(fixture);
  const report = formatDecisionTrace(traces[0]);

  assert.equal(traces.length, 1);
  assert.match(report, /winner=attributed_protection reason=damage_attributed control=acquired/);
  assert.match(report, /attributed_protection: eligible/);
  assert.match(report, /preemption=player:!collect->attributed_protection/);
  assert.match(report, /outcome=interrupted:interrupted action=TraceBot-41-1785520800000/);
});

test('a throw in the update preamble degrades the tick and leaves the arbiter able to tick again', async () => {
  // Regression guard. update() once set this.updating = true before opening its
  // try, so a preamble throw left the guard set for the lifetime of the agent
  // and every later tick short-circuited. The agent loop could not see it: a
  // wedged arbiter returns a snapshot rather than throwing, so its consecutive
  // failure counter reset each tick and the restart never fired.
  const { agent } = fakeAgent();
  let nowCalls = 0;
  const arbiter = new BehaviorArbiter(agent, {
    now: () => {
      nowCalls += 1;
      if (nowCalls === 1) throw new Error('simulated preamble failure');
      return 0;
    },
  });

  const first = await arbiter.update(0);

  assert.equal(arbiter.updating, false);
  assert.equal(first.code, 'arbiter_tick_failed');

  // The tick after the failure must still be evaluated, not short-circuited.
  const second = await arbiter.update(0);

  assert.equal(arbiter.updating, false);
  assert.notEqual(second.code, undefined);
});

// A persona hesitation is evaluated ABOVE the player-directive lane, so a
// casual comportment could delay an explicit "follow me" by its full pause.
// Waiting on someone who just spoke to you is the opposite of a companion.
test('a waiting player outranks the persona comportment pause', async () => {
  const { playerAwaitsResponse } = await import(
    '../../src/agent/runtime/behavior-arbiter.js'
  );

  const withDirective = {
    companion_context: { snapshot: () => ({ directive: 'follow' }) },
    actions: { hasDeferredPlayerAction: () => false },
  };
  const withDeferredAction = {
    companion_context: { snapshot: () => ({ directive: null }) },
    actions: { hasDeferredPlayerAction: () => true },
  };
  const idle = {
    companion_context: { snapshot: () => ({ directive: null }) },
    actions: { hasDeferredPlayerAction: () => false },
  };

  assert.equal(playerAwaitsResponse(withDirective), true, 'a standing directive is waiting');
  assert.equal(playerAwaitsResponse(withDeferredAction), true, 'a deferred player action is waiting');
  assert.equal(playerAwaitsResponse(idle), false, 'an idle companion may pace itself');
  assert.equal(
    playerAwaitsResponse(idle, { directiveResumeRequested: true }),
    true,
    'an explicit resume request is waiting',
  );

  // Absent structure must not be read as "someone is waiting" -- that would
  // disable persona pacing everywhere rather than only for the player.
  assert.equal(playerAwaitsResponse(null), false);
  assert.equal(playerAwaitsResponse({}), false);
  assert.equal(playerAwaitsResponse({ companion_context: {} }), false);
  assert.equal(playerAwaitsResponse({ actions: {} }), false);
});
