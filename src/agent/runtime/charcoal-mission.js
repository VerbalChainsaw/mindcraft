import { randomUUID } from 'node:crypto';
import { executeCommand } from '../commands/index.js';
import {
  capabilityCommandName,
  createCapabilityRequest,
  executeCapabilityAction,
} from './capability-catalogue.js';
import { buildPrerequisitePlan, plannedInventoryCount } from './prerequisite-planner.js';

const ACTIVE_STATUSES = new Set(['OPEN', 'WAITING']);
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const MISSION_MODES = new Set(['active', 'shadow', 'off']);
const MAX_CHARCOAL_QUANTITY = 64;
const MAX_ACTIVITIES = 48;
const RETRY_DELAY_MS = 750;
const PLAYER_WAIT_MS = 5_000;

function boundedText(value, maximum = 280) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, immutable(entry)]),
  ));
}

function normalizeMode(value) {
  const mode = String(value || 'active').trim().toLowerCase();
  return MISSION_MODES.has(mode) ? mode : 'off';
}

function inventoryCount(bot, name) {
  return plannedInventoryCount(bot, name);
}

function terminalEvidence(result, fallbackCode = 'unknown_outcome') {
  return immutable({
    actionId: boundedText(result?.actionId, 96) || null,
    lifecycle: boundedText(result?.evidence?.activity?.lifecycle, 32) || null,
    effect: result?.evidence?.capability?.verification || result?.evidence?.skill || null,
    reasonClass: boundedText(result?.phase, 32) || 'unknown',
    reasonCode: boundedText(result?.code, 96) || fallbackCode,
    retryable: result?.retryable === true,
    detail: boundedText(result?.detail, 360) || 'No structured outcome detail was available.',
    observedAt: Date.now(),
  });
}

export class MissionStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.current = null;
    this.last = null;
  }

  validateCharcoal({ requester, quantity, sourceMessage = '' } = {}) {
    const canonicalRequester = boundedText(requester, 64);
    const exactQuantity = Number(quantity);
    if (!canonicalRequester) throw new TypeError('A charcoal Mission requires an authoritative requester.');
    if (!Number.isInteger(exactQuantity) || exactQuantity < 1 || exactQuantity > MAX_CHARCOAL_QUANTITY) {
      throw new TypeError(`Charcoal quantity must be an integer from 1 to ${MAX_CHARCOAL_QUANTITY}.`);
    }
    return immutable({
      requester: canonicalRequester,
      quantity: exactQuantity,
      sourceMessage: boundedText(sourceMessage, 360),
    });
  }

  acceptCharcoal(request = {}) {
    const {
      requester: canonicalRequester,
      quantity: exactQuantity,
      sourceMessage,
    } = this.validateCharcoal(request);

    if (this.current && ACTIVE_STATUSES.has(this.current.status)) {
      this.terminate(this.current.missionId, 'CANCELLED', {
        reasonCode: 'mission_replaced',
        detail: 'A later model-interpreted physical promise replaced this Mission.',
      });
    }

    const at = this.now();
    const mission = immutable({
      missionId: `charcoal-mission-${randomUUID()}`,
      family: 'charcoal_delivery',
      requester: canonicalRequester,
      promise: {
        item: 'charcoal',
        quantity: exactQuantity,
        custody: 'deliver_to_requester',
      },
      acceptance: {
        kind: 'verified_exact_delivery',
        player: canonicalRequester,
        item: 'charcoal',
        quantity: exactQuantity,
        cleanup: 'no_mission_owned_temporary_voxels',
      },
      permissions: {
        acquirePrerequisites: true,
        craft: true,
        smelt: true,
        mine: true,
        deliver: true,
      },
      constraints: {
        voxelPlanning: 'specialists_only',
        exactQuantity: true,
        maxActivities: MAX_ACTIVITIES,
      },
      clarification: null,
      status: 'OPEN',
      phase: 'acquire',
      sourceMessage,
      activities: [],
      currentActivity: null,
      lastOutcome: null,
      delivered: 0,
      createdAt: at,
      updatedAt: at,
    });
    this.current = mission;
    return mission;
  }

  update(missionId, patch) {
    if (!this.current || this.current.missionId !== missionId) return null;
    this.current = immutable({
      ...this.current,
      ...patch,
      missionId: this.current.missionId,
      updatedAt: this.now(),
    });
    return this.current;
  }

  requestClarification(missionId, activityId, question) {
    const mission = this.current;
    if (!mission || mission.missionId !== missionId || mission.clarification) return null;
    return this.update(missionId, {
      status: 'WAITING',
      clarification: {
        missionId,
        activityId: boundedText(activityId, 96) || null,
        token: `clarification-${randomUUID()}`,
        question: boundedText(question, 220),
        askedAt: this.now(),
        answeredAt: null,
      },
    });
  }

  resolveClarification(token, answer) {
    const mission = this.current;
    if (!mission || mission.status !== 'WAITING' || mission.clarification?.token !== token) return null;
    return this.update(mission.missionId, {
      status: 'OPEN',
      clarification: {
        ...mission.clarification,
        answer: boundedText(answer, 220),
        answeredAt: this.now(),
      },
    });
  }

  terminate(missionId, status, evidence = {}) {
    if (!TERMINAL_STATUSES.has(status)) throw new TypeError(`Unsupported terminal Mission status '${status}'.`);
    if (!this.current || this.current.missionId !== missionId) return null;
    const terminal = immutable({
      ...this.current,
      status,
      phase: status.toLowerCase(),
      currentActivity: null,
      lastOutcome: immutable(evidence),
      updatedAt: this.now(),
    });
    this.current = null;
    this.last = terminal;
    return terminal;
  }

  snapshot() {
    return immutable({ current: this.current, last: this.last });
  }
}

export class CharcoalMissionController {
  constructor(agent, {
    mode = 'active',
    now = () => Date.now(),
    store = null,
    buildPlan = buildPrerequisitePlan,
    executeCapability = executeCapabilityAction,
    commandExecutor = executeCommand,
  } = {}) {
    this.agent = agent;
    this.mode = normalizeMode(mode);
    this.now = now;
    this.store = store || new MissionStore({ now });
    this.buildPlan = buildPlan;
    this.executeCapability = executeCapability;
    this.commandExecutor = commandExecutor;
    this.inFlight = false;
    this.activeDispatch = null;
    this.activeSettlement = null;
    this.admissionTail = Promise.resolve();
    this.nextAttemptAt = 0;
    this.status = immutable({ phase: 'idle', code: 'no_mission', detail: 'No charcoal Mission is active.', retryable: false });
  }

  get activeMission() {
    return this.store.current;
  }

  hasActiveMission() {
    return Boolean(this.activeMission && ACTIVE_STATUSES.has(this.activeMission.status));
  }

  ownsBodyLane() {
    return this.mode === 'active' && this.hasActiveMission();
  }

  accept(request = {}) {
    if (this.mode === 'off') {
      return Promise.resolve({ accepted: false, code: 'charcoal_mission_disabled', detail: 'The charcoal Mission tranche is disabled.' });
    }
    let validated;
    try {
      validated = this.store.validateCharcoal({
        ...request,
        quantity: request?.quantity === undefined ? 8 : request.quantity,
      });
    } catch (error) {
      return Promise.resolve({ accepted: false, code: 'charcoal_mission_invalid', detail: boundedText(error?.message || error) });
    }
    const admission = this.admissionTail.then(() => this.admitValidatedCharcoal(validated));
    this.admissionTail = admission.then(() => undefined, () => undefined);
    return admission;
  }

  rejectAdmission(code, detail) {
    const boundedDetail = boundedText(detail, 360);
    this.setStatus('waiting', code, boundedDetail, true);
    return { accepted: false, code, detail: boundedDetail };
  }

  async admitValidatedCharcoal(validated) {
    if (this.inFlight) {
      const priorDispatch = this.activeDispatch;
      const priorSettlement = this.activeSettlement;
      if (!priorDispatch || !priorSettlement || typeof this.agent.actions?.stop !== 'function') {
        return this.rejectAdmission(
          'mission_replacement_handoff_unavailable',
          'The current Mission Activity has no complete graceful-handoff path, so the replacement was not accepted.',
        );
      }
      let stopOutcome;
      try {
        stopOutcome = await this.agent.actions.stop();
      } catch (error) {
        return this.rejectAdmission(
          'mission_replacement_handoff_failed',
          `The current Mission Activity could not be stopped safely: ${boundedText(error?.message || error)}`,
        );
      }
      if (stopOutcome?.stopped !== true) {
        return this.rejectAdmission(
          'mission_replacement_handoff_failed',
          'The current Mission Activity did not yield and settle, so the replacement was not accepted.',
        );
      }
      const settlement = await priorSettlement;
      if (
        settlement?.settled !== true
        || this.inFlight
        || this.activeDispatch?.activityId === priorDispatch.activityId
      ) {
        return this.rejectAdmission(
          'mission_replacement_settlement_unproven',
          'The current Mission Activity stopped without a correlated terminal settlement, so the replacement was not accepted.',
        );
      }
    }

    const mission = this.store.acceptCharcoal(validated);
    this.nextAttemptAt = 0;
    this.setStatus('accepted', this.mode === 'shadow' ? 'charcoal_mission_shadowed' : 'charcoal_mission_accepted',
      `${mission.requester} requested exactly ${mission.promise.quantity} charcoal.`);
    this.agent.behavior_arbiter?.wake?.('charcoal_mission_accepted');
    return {
      accepted: true,
      code: this.status.code,
      missionId: mission.missionId,
      detail: this.mode === 'shadow'
        ? `Shadowed Mission for exactly ${mission.promise.quantity} charcoal; no Activity will acquire the body.`
        : `Accepted Mission for exactly ${mission.promise.quantity} charcoal and delivery to ${mission.requester}.`,
    };
  }

  cancel(reason = 'Cancelled by player.') {
    const mission = this.activeMission;
    if (!mission) return false;
    this.activeDispatch = null;
    const terminal = this.store.terminate(mission.missionId, 'CANCELLED', {
      reasonClass: 'cancelled',
      reasonCode: 'mission_cancelled',
      detail: boundedText(reason, 320),
      retryable: false,
      observedAt: this.now(),
    });
    this.setStatus('cancelled', 'mission_cancelled', terminal.lastOutcome.detail, false);
    return true;
  }

  setStatus(phase, code, detail, retryable = false) {
    this.status = immutable({ phase, code, detail: boundedText(detail, 360), retryable, at: this.now() });
  }

  snapshot() {
    const state = this.store.snapshot();
    return immutable({
      mode: this.mode,
      phase: this.status.phase,
      code: this.status.code,
      detail: this.status.detail,
      retryable: this.status.retryable,
      inFlight: this.inFlight,
      nextAttemptAt: this.nextAttemptAt || null,
      mission: state.current || state.last || null,
    });
  }

  buildNextActivity(mission) {
    const carried = inventoryCount(this.agent.bot, 'charcoal');
    if (carried >= mission.promise.quantity) {
      return {
        kind: 'deliver',
        requiredEffect: mission.acceptance,
        preconditions: { carriedCharcoal: carried },
        permissions: { deliver: true },
        specialist: 'pathfinder',
        atomicity: 'exact_verified_transfer',
        capability: createCapabilityRequest('deliver_exact_item', {
          player: mission.requester,
          item: 'charcoal',
          quantity: mission.promise.quantity,
        }).capability,
      };
    }

    const plan = this.buildPlan(this.agent.bot, {
      target: 'charcoal',
      quantity: mission.promise.quantity,
      completion: 'inventory',
    });
    if (plan.status === 'complete') return this.buildNextActivity(mission);
    if (plan.status !== 'ready' || !plan.nextStep?.capability) {
      return { blocked: true, code: plan.code || 'causal_plan_blocked', detail: plan.detail || 'No causal charcoal Activity is available.' };
    }
    const step = plan.nextStep;
    return {
      kind: step.kind,
      requiredEffect: {
        item: step.expectedName || step.target || null,
        family: step.expectedFamily || null,
        minimumIncrease: step.expectedIncrease || null,
      },
      preconditions: { trail: step.trail || [], reason: step.reason || '' },
      permissions: mission.permissions,
      specialist: ['collect_block', 'collect_family'].includes(step.capability.id) ? 'collectblock' : null,
      atomicity: 'one_capability_then_observe',
      capability: step.capability,
    };
  }

  update() {
    const mission = this.activeMission;
    if (!mission || this.inFlight) return false;
    if (mission.status === 'WAITING' && mission.clarification?.answeredAt == null) {
      this.setStatus('waiting', 'mission_clarification_waiting', mission.clarification.question, true);
      return false;
    }
    if (this.mode === 'shadow') {
      const activity = this.buildNextActivity(mission);
      this.setStatus('shadow', activity.blocked ? activity.code : 'charcoal_mission_shadow_plan',
        activity.blocked ? activity.detail : `Shadow next Activity: ${activity.kind}.`, activity.blocked);
      return false;
    }
    if (this.mode !== 'active' || this.agent.isOperatorHeld?.()) return false;
    if (this.now() < this.nextAttemptAt) return false;
    if (mission.activities.length >= mission.constraints.maxActivities) {
      this.fail(mission, 'mission_activity_budget_exhausted',
        `Mission exhausted its ${mission.constraints.maxActivities}-Activity budget with ${inventoryCount(this.agent.bot, 'charcoal')} charcoal still in custody.`);
      return false;
    }

    let proposal;
    try {
      proposal = this.buildNextActivity(mission);
    } catch (error) {
      this.fail(mission, 'mission_planner_error', `Charcoal planning failed safely: ${boundedText(error?.message || error)}`);
      return false;
    }
    if (proposal.blocked) {
      this.fail(mission, proposal.code, `${proposal.detail} Current custody: ${inventoryCount(this.agent.bot, 'charcoal')} charcoal.`);
      return false;
    }
    return this.dispatch(mission, proposal);
  }

  dispatch(mission, proposal) {
    if (this.inFlight || this.activeMission?.missionId !== mission.missionId) return false;
    const activityId = `${mission.missionId}:activity:${mission.activities.length + 1}`;
    const activity = immutable({
      missionId: mission.missionId,
      activityId,
      kind: proposal.kind,
      requiredEffect: proposal.requiredEffect,
      preconditions: proposal.preconditions,
      permissions: proposal.permissions,
      specialist: proposal.specialist,
      atomicity: proposal.atomicity,
      capability: proposal.capability,
      state: 'RUNNING',
      startedAt: this.now(),
    });
    this.store.update(mission.missionId, {
      phase: proposal.kind === 'deliver' ? 'deliver' : 'acquire',
      activities: [...mission.activities, activity],
      currentActivity: activity,
    });
    const token = immutable({ missionId: mission.missionId, activityId });
    this.activeDispatch = token;
    this.inFlight = true;
    this.setStatus('acting', `mission_${proposal.kind}`, `Executing ${capabilityCommandName(proposal.capability)} as ${activityId}.`, true);

    let execution;
    try {
      execution = this.executeCapability(proposal.capability, {
        agent: this.agent,
        executeCommand: this.commandExecutor,
        owner: 'player',
        routeOrigin: 'mission-director',
        missionId: mission.missionId,
        activityId,
      });
    } catch (error) {
      execution = Promise.reject(error);
    }
    let settlement;
    settlement = Promise.resolve(execution)
      .then(
        outcome => this.settle(token, proposal, outcome),
        error => this.settle(token, proposal, {
        result: {
          phase: 'failed',
          code: 'mission_dispatch_error',
          detail: boundedText(error?.message || error),
          retryable: true,
        },
        }),
      )
      .then(settled => ({ settled: settled === true }))
      .catch(error => ({ settled: false, error: boundedText(error?.message || error) }))
      .finally(() => {
        if (this.activeSettlement === settlement) {
          if (this.activeDispatch?.activityId === activityId) this.activeDispatch = null;
          this.activeSettlement = null;
          this.inFlight = false;
        }
        this.agent.behavior_arbiter?.wake?.('charcoal_activity_settled');
      });
    this.activeSettlement = settlement;
    void settlement;
    return true;
  }

  settle(token, proposal, outcome) {
    const mission = this.activeMission;
    if (!mission || mission.missionId !== token.missionId || this.activeDispatch?.activityId !== token.activityId) return false;
    const result = outcome?.result || this.agent.last_action_result || {
      phase: 'failed',
      code: 'mission_missing_action_result',
      detail: 'The Activity returned without a structured action result.',
      retryable: true,
    };
    const evidence = terminalEvidence(result);
    const activities = mission.activities.map(activity => activity.activityId === token.activityId
      ? immutable({ ...activity, state: String(result.phase || 'failed').toUpperCase(), finishedAt: this.now(), outcome: evidence })
      : activity);
    this.store.update(mission.missionId, { activities, currentActivity: null, lastOutcome: evidence });

    if (proposal.kind === 'deliver' && outcome?.verification?.ok === true && result.phase === 'succeeded') {
      this.succeed(this.activeMission, evidence);
      return true;
    }
    if (result.phase === 'succeeded' || result.phase === 'interrupted') {
      this.nextAttemptAt = result.phase === 'interrupted' ? this.now() + RETRY_DELAY_MS : 0;
      this.setStatus('planning', result.phase === 'interrupted' ? 'mission_preempted_replan' : 'mission_effect_observed',
        `${evidence.detail} Replanning from current Minecraft state.`, true);
      return true;
    }
    if (result.retryable === true) {
      this.nextAttemptAt = this.now() + (/player|delivery|binding/i.test(result.code || '') ? PLAYER_WAIT_MS : RETRY_DELAY_MS);
      this.setStatus('waiting', evidence.reasonCode, `${evidence.detail} Replanning after the bounded wait.`, true);
      return true;
    }
    this.fail(this.activeMission, evidence.reasonCode, evidence.detail, evidence);
    return true;
  }

  succeed(mission, evidence) {
    const delivered = mission.promise.quantity;
    this.store.update(mission.missionId, { delivered });
    const terminal = this.store.terminate(mission.missionId, 'SUCCEEDED', {
      ...evidence,
      reasonClass: 'success',
      reasonCode: 'charcoal_delivery_verified',
      detail: `Minecraft verified delivery of exactly ${mission.promise.quantity} charcoal to ${mission.requester}; the Mission created no independent temporary voxel plan.`,
      retryable: false,
      delivered,
    });
    this.setStatus('succeeded', 'charcoal_delivery_verified', terminal.lastOutcome.detail, false);
    this.agent.open_player_request = null;
    this.agent.routeResponse?.(mission.requester, terminal.lastOutcome.detail);
  }

  fail(mission, code, detail, evidence = null) {
    if (!mission) return null;
    const carried = inventoryCount(this.agent.bot, 'charcoal');
    const terminal = this.store.terminate(mission.missionId, 'FAILED', {
      ...(evidence || {}),
      reasonClass: evidence?.reasonClass || 'failed',
      reasonCode: boundedText(code || evidence?.reasonCode, 96) || 'mission_failed',
      detail: `${boundedText(detail || evidence?.detail, 300)} Verified partial custody: ${carried} charcoal; delivered: ${mission.delivered || 0}.`,
      retryable: false,
      observedAt: this.now(),
    });
    this.setStatus('failed', terminal.lastOutcome.reasonCode, terminal.lastOutcome.detail, false);
    this.agent.routeResponse?.(mission.requester, terminal.lastOutcome.detail);
    return terminal;
  }
}

export function formatMissionAcceptance(result) {
  return result?.accepted === true
    ? result.detail
    : `Mission not accepted (${result?.code || 'unknown'}): ${result?.detail || 'no detail'}`;
}
