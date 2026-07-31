import convoManager from '../conversation.js';
import { executeCommand as executeAgentCommand } from '../commands/index.js';
import {
  chooseReaction,
  renderDeterministicReaction,
  shouldRememberEvent,
} from './reaction-policy.js';

const MAX_REACTION_TEXT = 180;
const MAX_EVENTS_PER_TICK = 8;
// Personality lives in the small, frequent moments, not the dramatic rare ones.
// Greetings and finds are what a player hears all afternoon, so those get real
// phrasing; the deterministic table remains the fallback and still owns every
// urgent line, where exact wording matters more than character.
const MODEL_WORTHY_EVENTS = new Set([
  'player.approached',
  'player.returned',
  'player.looked',
  'player.joined',
  'self.damaged',
  'self.died',
  'entity.died',
  'observation.item',
  'observation.structure',
  'job.completed',
  'squad.completion',
]);

function defaultContext(agent) {
  const urgentDanger = (agent.bot?.modes?.getStatus?.() || []).some(mode => (
    mode?.active === true
    && ['self_preservation', 'self_defense', 'cowardice'].includes(mode.name)
  ));
  const workOrderPhase = agent.job_director?.snapshot?.()?.workOrder?.phase;
  return {
    inConversation: convoManager.inConversation(),
    witnesses: [agent.name],
    actionBusy: agent.isIdle?.() === false,
    jobActive: Boolean(workOrderPhase && !['complete', 'failed', 'cancelled'].includes(workOrderPhase)),
    urgentDanger,
  };
}

function eventNumbers(event) {
  const values = [];
  for (const source of [event?.target, event?.evidence]) {
    if (!source || typeof source !== 'object') continue;
    for (const value of Object.values(source)) {
      if (Number.isFinite(value)) values.push(String(Number(value.toFixed?.(2) ?? value)));
    }
  }
  return new Set(values);
}

export function validateReactionText(text, event) {
  if (typeof text !== 'string') return null;
  const normalized = text
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !normalized
    || normalized.length > MAX_REACTION_TEXT
    // eslint-disable-next-line no-control-regex -- Spoken reactions must not carry terminal/control bytes.
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || /(?:https?:\/\/|www\.|!\w+|api[_ -]?key|token=)/i.test(normalized)
  ) return null;
  const allowedNumbers = eventNumbers(event);
  for (const match of normalized.matchAll(/-?\d+(?:\.\d+)?/g)) {
    if (!allowedNumbers.has(String(Number(match[0])))) return null;
  }
  const requiredName = String(event?.target?.name || event?.target?.type || '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  if (requiredName && !normalized.toLowerCase().includes(requiredName)) return null;
  return normalized;
}

export class ReactionDirector {
  constructor(agent, {
    deliverText = text => agent.openChat(text),
    phraseReaction = reaction => agent.prompter?.phraseReaction?.(reaction),
    executeGesture = executeAgentCommand,
    getContext = defaultContext,
    now = Date.now,
  } = {}) {
    this.agent = agent;
    this.deliverText = deliverText;
    this.phraseReaction = phraseReaction;
    this.executeGesture = executeGesture;
    this.getContext = getContext;
    this.now = now;
    this.processing = false;
    this.speechTimes = [];
    this.gestureTimes = [];
    this.lastTypeAt = {};
    this.remembered = new Set();
    this.status = {
      phase: 'waiting',
      code: 'ready',
      spoken: 0,
      gestures: 0,
      fallbacks: 0,
      lastEventId: null,
      detail: 'Waiting for a salient factual event.',
    };
  }

  pruneBudgets(now) {
    const cutoff = now - 60_000;
    this.speechTimes = this.speechTimes.filter(value => value >= cutoff);
    this.gestureTimes = this.gestureTimes.filter(value => value >= cutoff);
  }

  remember(event) {
    if (!shouldRememberEvent(event) || this.remembered.has(event.id)) return;
    this.remembered.add(event.id);
    if (this.remembered.size > 256) this.remembered.delete(this.remembered.values().next().value);
    const target = event.target?.name ? ` ${event.target.name}` : '';
    this.agent.memory_bank?.personal?.rememberEpisode?.(
      `${event.type}${target}`,
      event.evidence?.code || event.type,
    );
  }

  update() {
    const policy = this.agent.runtime?.reactions;
    if (!policy || policy.mode === 'off' || this.agent.isOperatorHeld?.() || this.processing) return;
    const events = this.agent.behavior_events?.drain?.(MAX_EVENTS_PER_TICK) || [];
    if (events.length === 0) return;
    const ranked = events.slice().sort((left, right) => (
      right.salience - left.salience
      || left.timestamp - right.timestamp
      || left.id.localeCompare(right.id)
    ));
    for (const event of ranked) this.remember(event);
    const now = this.now();
    this.pruneBudgets(now);
    let selected = null;
    for (const event of ranked) {
      const context = {
        ...this.getContext(this.agent, event),
        selfName: this.agent.name,
        personality: this.agent.runtime?.identity || {},
        speechInLastMinute: this.speechTimes.length,
        gesturesInLastMinute: this.gestureTimes.length,
        lastTypeAt: this.lastTypeAt,
        now,
      };
      const reaction = chooseReaction(event, context, policy);
      if (reaction) {
        selected = reaction;
        break;
      }
    }
    if (!selected) {
      this.status = {
        ...this.status,
        phase: 'suppressed',
        code: 'no_eligible_reaction',
        detail: 'Events were remembered or observed without interrupting the current interaction.',
      };
      return;
    }

    this.processing = true;
    this.status = {
      ...this.status,
      phase: 'acting',
      code: `reaction_${selected.kind}`,
      lastEventId: selected.event.id,
      detail: 'Rendering a bounded factual reaction.',
    };
    void this.perform(selected)
      .catch(error => {
        this.status = {
          ...this.status,
          phase: 'failed',
          code: 'reaction_delivery_failed',
          detail: String(error?.message || error).slice(0, 280),
        };
      })
      .finally(() => {
        this.processing = false;
      });
  }

  async perform(reaction) {
    const fallback = renderDeterministicReaction(reaction);
    const useModel = (
      reaction.event.salience >= 4
      || MODEL_WORTHY_EVENTS.has(reaction.event.type)
    );
    let text = fallback;
    if (useModel) {
      try {
        text = validateReactionText(await this.phraseReaction(reaction), reaction.event);
      } catch {
        text = null;
      }
      if (!text) {
        text = fallback;
        this.status.fallbacks += 1;
      }
    }
    if (text) {
      await this.deliverText(text, { priority: reaction.priority });
      const spokenAt = this.now();
      this.speechTimes.push(spokenAt);
      this.lastTypeAt[reaction.event.type] = spokenAt;
      this.status.spoken += 1;
    }

    if (
      reaction.gesture === 'look'
      && this.agent.isIdle?.()
      && !this.agent.isOperatorHeld?.()
    ) {
      const target = reaction.event.target;
      const companion = this.agent.companion_context?.snapshot?.();
      if (
        reaction.event.type.startsWith('player.')
        && companion
        && (companion.lineOfSight !== true || Number(companion.lineOfSightAge) > 2_000)
      ) {
        this.status = {
          ...this.status,
          phase: 'suppressed',
          code: 'attention_not_visible',
          detail: 'Player attention remained advisory because line of sight was not verified.',
        };
        return;
      }
      const previousActionId = this.agent.last_action_result?.actionId || null;
      await this.executeGesture(
        this.agent,
        `!lookAtPosition(${target.x}, ${target.y}, ${target.z})`,
        { owner: 'background' },
      );
      const result = this.agent.last_action_result;
      if (result?.actionId && result.actionId !== previousActionId && result.phase === 'succeeded') {
        this.gestureTimes.push(this.now());
        this.status.gestures += 1;
      }
    }
    this.status = {
      ...this.status,
      phase: 'succeeded',
      code: 'reaction_delivered',
      detail: text ? 'Factual reaction delivered.' : 'Event processed without speech.',
    };
  }

  snapshot() {
    return {
      phase: this.status.phase,
      code: this.status.code,
      spoken: this.status.spoken,
      gestures: this.status.gestures,
      fallbacks: this.status.fallbacks,
      lastEventId: this.status.lastEventId,
      detail: String(this.status.detail || '').slice(0, 280),
      queued: Math.min(256, this.agent.behavior_events?.queue?.length || 0),
    };
  }
}
