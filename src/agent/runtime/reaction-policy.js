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
  // GoalDirector reports typed-goal terminal outcomes itself. Lifecycle events
  // still reach telemetry and memory, but never create a second speaker.
  if (event.type === 'goal.changed' || event.type === 'goal.completed') return null;
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
  const plain = String(event.target?.name || '').replace(/_/g, ' ');
  // Urgent lines stay exact and unvaried. When a creeper is seven blocks away
  // the message is information, not personality, and it must read the same way
  // every single time.
  if (event.type === 'self.damaged') {
    return Number.isFinite(event.evidence?.amount)
      ? `Took ${Math.round(event.evidence.amount)} damage!`
      : 'I took damage!';
  }
  if (kind === 'warning' && event.type !== 'squad.warning') {
    return Number.isFinite(event.target?.distance)
      ? `${name}, ${Math.round(event.target.distance)} blocks away!`
      : `${name} nearby!`;
  }
  if (event.type === 'self.died') {
    return stableVariant(event, [
      'I died. Regrouping.',
      'Well, that went badly. Heading back.',
      'I died — going to get my things.',
      'That got me. Respawning.',
    ]);
  }
  if (event.type === 'entity.hurt') return `${name} took a hit.`;
  if (event.type === 'entity.died') {
    return stableVariant(event, [
      `${name} went down.`,
      `That's the ${plain} down.`,
      `${name} is finished.`,
      `Got the ${plain}.`,
    ]);
  }
  if (event.type === 'squad.warning') return `Warning from ${name}.`;
  if (event.type === 'squad.order') return `Copy, ${name}.`;
  if (event.type === 'squad.request') return `${name} needs support.`;
  if (event.type === 'survival.changed') {
    if (['missing_safe_food', 'recovery_missing_food'].includes(event.evidence?.code)) {
      return stableVariant(event, [
        'I need safe food.',
        'I am out of anything safe to eat.',
        'Getting hungry and I have nothing good on me.',
      ]);
    }
    if (event.evidence?.phase === 'failed') return 'Survival action is blocked.';
    return '';
  }
  if (event.type === 'job.changed' && event.evidence?.phase === 'recover') {
    return stableVariant(event, [
      'That route is blocked; I am relocating.',
      'No way through here. Trying another way.',
      'Blocked. Moving somewhere better.',
    ]);
  }
  if (event.type === 'threat.cleared') {
    return stableVariant(event, [
      `${name} is out of sight.`,
      `Lost track of the ${plain}.`,
      `${name} wandered off.`,
      `No sign of the ${plain} now.`,
    ]);
  }
  if (kind === 'completion') {
    // Work reports stay exact. A completion is information the player acts on,
    // and the model path already gives it character when one is available.
    if (event.type === 'job.completed') {
      return event.target?.name
        ? `Finished the ${plain} work.`
        : 'Work order complete.';
    }
    return 'Squad task complete.';
  }
  if (event.type === 'time.sunrise') {
    return stableVariant(event, ['Sunrise.', 'Morning.', 'Sun is up.', 'Daylight — better out here.']);
  }
  if (event.type === 'time.sunset') {
    return stableVariant(event, [
      'Sunset—stay alert.',
      'Getting dark. Watch yourself.',
      'Night is coming.',
      'Sun is going down; things will start spawning.',
    ]);
  }
  if (event.type === 'weather.changed') return `${name}.`;
  if (event.type === 'player.joined') {
    return stableVariant(event, [`${name} joined us.`, `${name} is on.`, `Hey, ${name} is here.`]);
  }
  if (event.type === 'player.left') {
    return stableVariant(event, [`${name} left.`, `${name} logged off.`, `And ${name} is gone.`]);
  }
  if (event.type === 'player.approached') {
    return stableVariant(event, [
      `${name} is here.`,
      `Hey, ${name}.`,
      `I see you, ${name}.`,
      `There you are, ${name}.`,
      `Hi, ${name}.`,
      `${name}.`,
    ]);
  }
  if (event.type === 'player.returned') {
    return stableVariant(event, [
      `Welcome back, ${name}.`,
      `${name} is back.`,
      `Good to see you again, ${name}.`,
      `You made it back, ${name}.`,
      `There you are — was starting to wonder.`,
      `Back already, ${name}?`,
    ]);
  }
  if (event.type === 'player.looked') {
    return stableVariant(event, [
      `${name}?`,
      `Need something, ${name}?`,
      `I'm listening, ${name}.`,
      `What is it, ${name}?`,
      `Yeah, ${name}?`,
      `You need me?`,
    ]);
  }
  if (event.type === 'player.order') return `Order received from ${name}.`;
  if (event.type === 'observation.item') {
    return stableVariant(event, [
      `I spotted ${name}.`,
      `${name}, over there.`,
      `There's ${name} nearby.`,
      `Look — ${plain}.`,
      `${plain} on the ground here.`,
      `Found some ${plain}.`,
    ]);
  }
  if (event.type === 'observation.structure') {
    return stableVariant(event, [
      `I found ${name}.`,
      `There's a ${plain} here.`,
      `${name} over here.`,
      `Spotted a ${plain}.`,
    ]);
  }
  if (event.type === 'observation.terrain') {
    return stableVariant(event, [
      `${name} nearby.`,
      `There's ${plain} here.`,
      `${plain}, right here.`,
      `I see ${plain}.`,
    ]);
  }
  if (event.type === 'action.failed') {
    return event.target?.name
      ? stableVariant(event, [
        `I couldn't finish ${plain}.`,
        `${titleCase(plain)} didn't work out.`,
        `No luck with ${plain}.`,
      ])
      : 'That action is blocked.';
  }
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
