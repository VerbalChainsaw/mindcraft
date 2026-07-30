import { createHash } from 'node:crypto';

const TYPE_COOLDOWN_MS = 20_000;
const MAX_WITNESS_DISTANCE = 48;

function titleCase(value) {
  const text = String(value || '').replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Threat';
}

function stableVariant(event, templates) {
  if (!Array.isArray(templates) || templates.length === 0) return '';
  const digest = createHash('sha256').update(String(event?.id || event?.type || '')).digest();
  return templates[digest.readUInt16BE(0) % templates.length];
}

export function electSquadSpeaker(event, witnesses = []) {
  const candidates = [...new Set(witnesses.filter(name => typeof name === 'string' && name.trim()))]
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) return null;
  const digest = createHash('sha256').update(String(event?.id || '')).digest();
  const value = digest.readUInt32BE(0);
  return candidates[value % candidates.length];
}

export function chooseReaction(event, context = {}, policy = {}) {
  if (!event || policy.mode === 'off') return null;
  const occupied = context.actionBusy === true || context.jobActive === true || context.urgentDanger === true;
  const minimumSalience = policy.mode === 'minimal' ? 5 : occupied ? 4 : 2;
  if (event.salience < minimumSalience) return null;
  const urgent = ['threat.detected', 'self.damaged', 'squad.warning'].includes(event.type);
  if (context.inConversation && !urgent) return null;
  if (Number(event.target?.distance) > MAX_WITNESS_DISTANCE) return null;
  if ((Number(context.speechInLastMinute) || 0) >= (Number(policy.maxSpeechPerMinute) || 0)) return null;
  const lastTypeAt = Number(context.lastTypeAt?.[event.type]) || 0;
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  if (lastTypeAt && now - lastTypeAt < TYPE_COOLDOWN_MS) return null;
  const witnesses = event.witnesses?.length ? event.witnesses : context.witnesses;
  if (Array.isArray(witnesses) && witnesses.length > 1 && context.selfName) {
    if (electSquadSpeaker(event, witnesses) !== context.selfName) return null;
  }
  const kind = urgent
    ? 'warning'
    : event.type === 'job.completed' || event.type === 'squad.completion'
      ? 'completion'
      : event.type.startsWith('time.') || event.type === 'weather.changed'
        ? 'observation'
        : 'acknowledgement';
  const canGesture = (
    (Number(context.gesturesInLastMinute) || 0) < (Number(policy.maxGesturesPerMinute) || 0)
    && [event.target?.x, event.target?.y, event.target?.z].every(Number.isFinite)
  );
  return Object.freeze({
    event,
    kind,
    priority: urgent ? 'urgent' : event.salience >= 4 ? 'high' : 'ambient',
    tone: String(context.personality?.attitude || 'steady').slice(0, 32),
    gesture: canGesture ? 'look' : null,
  });
}

export function renderDeterministicReaction(reaction) {
  const { event, kind } = reaction || {};
  if (!event) return '';
  const name = titleCase(event.target?.name || event.target?.type);
  if (event.type === 'self.damaged') {
    return Number.isFinite(event.evidence?.amount)
      ? `Took ${Math.round(event.evidence.amount)} damage!`
      : 'I took damage!';
  }
  if (event.type === 'self.died') return 'I died. Regrouping.';
  if (event.type === 'entity.hurt') return `${name} took a hit.`;
  if (event.type === 'entity.died') return `${name} went down.`;
  if (event.type === 'squad.warning') return `Warning from ${name}.`;
  if (event.type === 'squad.order') return `Copy, ${name}.`;
  if (event.type === 'squad.request') return `${name} needs support.`;
  if (event.type === 'survival.changed') {
    if (['missing_safe_food', 'recovery_missing_food'].includes(event.evidence?.code)) return 'I need safe food.';
    if (event.evidence?.phase === 'failed') return 'Survival action is blocked.';
    return '';
  }
  if (event.type === 'job.changed' && event.evidence?.phase === 'recover') {
    return 'That route is blocked; I am relocating.';
  }
  if (kind === 'warning') {
    return Number.isFinite(event.target?.distance)
      ? `${name}, ${Math.round(event.target.distance)} blocks away!`
      : `${name} nearby!`;
  }
  if (event.type === 'threat.cleared') return `${name} is out of sight.`;
  if (kind === 'completion') {
    if (event.type === 'job.completed') return event.target?.name
      ? `Finished the ${String(event.target.name).replace(/_/g, ' ')} work.`
      : 'Work order complete.';
    return 'Squad task complete.';
  }
  if (event.type === 'time.sunrise') return 'Sunrise.';
  if (event.type === 'time.sunset') return 'Sunset—stay alert.';
  if (event.type === 'weather.changed') return `${name}.`;
  if (event.type === 'player.joined') return `${name} joined us.`;
  if (event.type === 'player.left') return `${name} left.`;
  if (event.type === 'player.approached') {
    return stableVariant(event, [
      `${name} is here.`,
      `Hey, ${name}.`,
      `I see you, ${name}.`,
    ]);
  }
  if (event.type === 'player.returned') {
    return stableVariant(event, [
      `Welcome back, ${name}.`,
      `${name} is back.`,
      `Good to see you again, ${name}.`,
    ]);
  }
  if (event.type === 'player.looked') {
    return stableVariant(event, [
      `${name}?`,
      `Need something, ${name}?`,
      `I'm listening, ${name}.`,
    ]);
  }
  if (event.type === 'player.order') return `Order received from ${name}.`;
  if (event.type === 'observation.item') {
    return stableVariant(event, [
      `I spotted ${name}.`,
      `${name}, over there.`,
      `There's ${name} nearby.`,
    ]);
  }
  if (event.type === 'observation.structure') return `I found ${name}.`;
  if (event.type === 'observation.terrain') return `${name} nearby.`;
  if (event.type === 'action.failed') return event.target?.name
    ? `I couldn't finish ${String(event.target.name).replace(/_/g, ' ')}.`
    : 'That action is blocked.';
  return event.target?.name ? `${name}.` : '';
}

export function shouldRememberEvent(event) {
  return Boolean(
    event
    && (
      Number(event.salience) >= 4
      || ['self.died', 'job.completed', 'squad.completion'].includes(event.type)
    )
  );
}
