import { resolvePlayerDirective } from './player-directives.js';
import { classifyPlayerSpeechAuthority } from './player-speech-authority.js';
import { AGENDA_KINDS } from './runtime/agenda.js';

// Deterministic natural-language front door to the existing Agenda queue.
//
// The Agenda (`agenda.js` / `agenda-director.js`) already provides serial,
// one-step-at-a-time execution over the single-slot goal/job executors, with
// persistence, retry budgets, and restart recovery. What it lacked was a way
// to populate it from plain chat WITHOUT a language-model round trip: today a
// player line reaches either `resolvePlayerDirective` (one command, the rest of
// the sentence dropped) or the LLM (slow, and the only path that can emit
// several `!addToAgenda` calls).
//
// This module closes that gap. It splits a single line into ordered segments on
// natural connectives, resolves each segment through the EXISTING directive
// resolver (no new intent vocabulary), and maps the recognized ones to typed
// agenda entries. It never invents a command string of its own and never mutates
// the resolver — it only reads its output — so it can front the agenda without
// touching any in-progress runtime file.
//
// It deliberately does NOT act, dispatch, or persist. It is a pure parser: the
// caller decides whether to append (`agenda_director.add`) or replace
// (`agenda_director.clear` then add) based on the returned disposition.

const MAX_MESSAGE_CHARS = 512;
const MAX_SEGMENTS = 24;

// Words that mean "drop what you were doing." A match sets the disposition to
// `interrupt`; the caller clears the queue and preempts before dispatching.
// Anchored to the start, or a whole-word "instead/right now/immediately"
// anywhere, so "mine stone right now" interrupts but "get redstone" does not.
const INTERRUPT_LEADING = /^(?:stop|now|wait|hold on|hold up|forget (?:that|it|everything)|cancel that|never ?mind|belay that|drop everything|scratch that|actually,?)\b/;
const INTERRUPT_ANYWHERE = /\b(?:right now|instead|immediately)\b/;

// Leading filler stripped from a segment before it reaches the resolver, so
// "now come here" and "and then mine 5 iron" resolve as "come here" / "mine 5
// iron". Kept separate from the connective splitter because these lead a
// segment rather than joining two.
const LEADING_FILLER = /^(?:and\s+|then\s+|also\s+|next\s+|please\s+|now\s+|so\s+|,\s*)+/;

// Connective phrases that separate one step from the next. Multi-word phrases
// are listed before bare "then"/"next" so the longer match wins. Each becomes a
// split point; order within the sentence is preserved.
const CONNECTIVE_PATTERNS = [
  /\band\s+then\b/gi,
  /\bafter\s+that\b/gi,
  /\bonce\s+you(?:'re|\s+are)?\s+(?:done|finished)\b/gi,
  /\bwhen\s+you(?:'re|\s+are)?\s+(?:done|finished)\b/gi,
  /\bwhen\s+you\s+finish(?:ed)?\b/gi,
  /\bafterwards?\b/gi,
  /\bthen\b/gi,
  /\bnext\b/gi,
  /\balso\b/gi,
  /\s*;\s*/g,
  /,\s+and\b/gi,
  /,\s+(?=(?:go|walk|head|travel|run|use|smelt|craft|harvest|replant|put|store|stash|deposit|come|return)\b)/gi,
];

const SEGMENT_DELIMITER = '\u0000';

// One collective delivery sentence names several concrete outputs but only one
// destination: "make me X, Y, and Z, then bring them here." GoalDirector is
// deliberately single-slot, so bind that list into the already durable Agenda
// instead of truncating it to whichever registry item the single-goal parser
// happens to notice first.
const COLLECTIVE_DELIVERY = /^(?:please\s+)?(?:make|craft|prepare)\s+(?:me\s+)?([\s\S]+?)(?:,\s*)?(?:and\s+)?then\s+(?:bring|deliver|give)\s+(?:them|those|all(?:\s+of\s+them)?)\s+(?:here|to\s+me)\s*[.!?]*$/i;

function normalizeMessage(message) {
  return String(message ?? '').slice(0, MAX_MESSAGE_CHARS);
}

function canonicalListedItem(value, bot) {
  const requested = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an|one)\s+/, '')
    .replace(/[.!?]+$/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 64);
  if (!requested) return null;
  const registry = bot?.registry?.itemsByName;
  if (!registry) return null;
  if (registry[requested]) return requested;
  const singular = requested.replace(/s$/, '');
  return singular && registry[singular] ? singular : null;
}

function collectiveDeliverySteps(playerName, message, context) {
  const match = COLLECTIVE_DELIVERY.exec(normalizeMessage(message).trim());
  if (!match) return null;
  const listed = match[1]
    .replace(/,\s*$/g, '')
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map(item => item.trim())
    .filter(Boolean);
  if (listed.length < 2 || listed.length > MAX_SEGMENTS) return null;

  const targets = listed.map(item => canonicalListedItem(item, context?.bot));
  // All-or-nothing is important: a durable player request may not silently
  // forget one output because only the other names resolved.
  if (targets.some(target => !target)) return null;
  return targets.map((target, index) => ({
    segment: listed[index],
    command: `!requestItemGoal("deliver", ${JSON.stringify(target)}, 1, ${JSON.stringify(playerName)}, "delivery")`,
    response: `I will make and deliver one ${target.replaceAll('_', ' ')}.`,
    entry: {
      kind: 'deliver',
      requester: playerName,
      target,
      quantity: 1,
      recipient: playerName,
    },
  }));
}

/**
 * Decide whether a new player line should replace the queue or extend it.
 * Pure and side-effect free.
 *
 * @returns {'interrupt'|'append'}
 */
export function classifyDisposition(message) {
  const text = normalizeMessage(message).trim().toLowerCase();
  if (!text) return 'append';
  if (INTERRUPT_LEADING.test(text) || INTERRUPT_ANYWHERE.test(text)) return 'interrupt';
  return 'append';
}

/**
 * Split a line into ordered step segments on natural connectives. Bare commas
 * are intentionally NOT split points (they appear inside ordinary clauses); a
 * ", and" is. Empty and filler-only fragments are dropped.
 *
 * @returns {string[]}
 */
export function splitAgendaSegments(message) {
  let text = normalizeMessage(message);
  for (const pattern of CONNECTIVE_PATTERNS) {
    text = text.replace(pattern, SEGMENT_DELIMITER);
  }
  return text
    .split(SEGMENT_DELIMITER)
    .map(segment => segment.replace(LEADING_FILLER, '').trim())
    .filter(segment => segment.length > 0)
    .slice(0, MAX_SEGMENTS);
}

function unquote(token) {
  const text = String(token ?? '').trim();
  const match = text.match(/^"([\s\S]*)"$/) || text.match(/^'([\s\S]*)'$/);
  return match ? match[1] : text;
}

function asQuantity(token) {
  const number = Number(unquote(token));
  return Number.isFinite(number) ? Math.floor(number) : null;
}

/**
 * Parse a generated `!command("arg", 5)` string into `{ name, args }`. The
 * directive resolver only ever emits machine-formatted commands whose string
 * arguments contain no commas, so a top-level comma split is sufficient and
 * avoids a brittle quote-aware tokenizer.
 */
function parseCommandCall(command) {
  const text = String(command ?? '').trim();
  const match = text.match(/^!([A-Za-z]\w*)\s*(?:\(([\s\S]*)\))?\s*$/);
  if (!match) return null;
  const argsText = match[2];
  const args = argsText === undefined
    ? []
    : argsText.split(',').map(part => part.trim()).filter(part => part.length > 0);
  return { name: match[1], args };
}

function companionDirective(command, segmentIndex) {
  const call = parseCommandCall(command);
  if (!call || !['followPlayer', 'guardPlayer'].includes(call.name)) return null;
  const recipient = unquote(call.args[0]);
  if (!recipient) return null;
  return {
    command,
    kind: call.name === 'guardPlayer' ? 'guard' : 'follow',
    recipient,
    segmentIndex,
  };
}

function followedWorkstationStep(playerName, standing, steps) {
  const first = steps[0];
  const lead = standing.find(candidate => (
    candidate.kind === 'follow'
    && candidate.recipient === playerName
    && candidate.segmentIndex < first?.segmentIndex
  ));
  if (!lead || first?.entry?.kind !== 'smelt' || !/\bfurnace\b/i.test(first.segment)) return null;
  return {
    consumed: standing.filter(candidate => (
      candidate.kind === 'follow' && candidate.recipient === playerName
    )),
    step: {
      segment: 'follow the player to the requested furnace',
      command: `!followPlayerUntilNearBlock(${JSON.stringify(playerName)}, "furnace", 8)`,
      response: 'I will follow you until we are both settled beside the furnace.',
      segmentIndex: lead.segmentIndex,
      entry: {
        kind: 'follow_until',
        requester: playerName,
        target: 'furnace',
        recipient: playerName,
        radius: 8,
      },
    },
  };
}

/**
 * Map a resolved directive command to a typed agenda entry, or null when the
 * command is not agenda-worthy. Standing directives (follow/guard/stay), one-off
 * reflexes (attack/eat), and pure queries (stats/inventory) return null: they
 * are the backdrop or immediate replies, not sequenced work.
 */
export function directiveToAgendaEntry(command, { requester = '' } = {}) {
  const call = parseCommandCall(command);
  if (!call) return null;
  const { name, args } = call;
  const entry = (kind, extra) => (
    AGENDA_KINDS[kind] ? { kind, requester, ...extra } : null
  );
  switch (name) {
    case 'goToPlayer':
      return unquote(args[0]) ? entry('goto', { recipient: unquote(args[0]) }) : null;
    case 'goToFarm':
      return entry('farm_visit', {});
    case 'maintainFarm':
      return entry('maintain_farm', {});
    case 'putInChest':
      return entry('deposit', { target: unquote(args[0]), quantity: asQuantity(args[1]) ?? 64 });
    case 'assignMiningJob':
      return entry('mine', { target: unquote(args[0]), quantity: asQuantity(args[1]) ?? 1 });
    case 'assignHarvestJob':
      return entry('harvest', { target: unquote(args[0]) || 'logs', quantity: asQuantity(args[1]) ?? 1 });
    case 'assignStockpileJob':
      return entry('stockpile', { target: unquote(args[0]), quantity: asQuantity(args[1]) ?? 1 });
    case 'assignFunctionalShelterJob':
      return entry('shelter', {});
    case 'goToBed':
      return entry('sleep', {});
    case 'craftRecipe':
      return entry('craft', { target: unquote(args[0]), quantity: asQuantity(args[1]) ?? 1 });
    case 'smeltItem':
      return entry('smelt', { target: unquote(args[0]), quantity: asQuantity(args[1]) ?? 1 });
    case 'requestItemGoal': {
      const kind = unquote(args[0]);
      if (kind !== 'acquire' && kind !== 'deliver') return null;
      return entry(kind, {
        target: unquote(args[1]),
        quantity: asQuantity(args[2]) ?? 1,
        recipient: kind === 'deliver' ? unquote(args[3]) : '',
        ...(kind === 'acquire' && unquote(args[4])
          ? { completion: unquote(args[4]) }
          : {}),
      });
    }
    default:
      return null;
  }
}

/**
 * Turn one player line into an ordered agenda plan.
 *
 * Returns null when the line yields no agenda-worthy steps, so the caller can
 * fall through to the existing single-directive / LLM path unchanged. When it
 * returns a plan, `steps` are in spoken order and `unresolved` records segments
 * that produced no queued work (so the caller can hand them onward or report
 * them). `multiStep` is true only when the queue genuinely sequences more than
 * one step — the signal a caller uses to decide whether interception beats the
 * fast single-command path.
 *
 * @param {string} playerName canonical requester, used for goto/deliver recipients
 * @param {string} message raw chat line
 * @param {object} context passed through to the resolver (e.g. { bot, role })
 * @param {object} [deps] injectable resolver for testing
 */
export function parsePlayerAgenda(playerName, message, context = {}, {
  resolveDirective = resolvePlayerDirective,
} = {}) {
  const text = normalizeMessage(message);
  if (!playerName || !text.trim() || text.includes('!')) return null;
  // Authority belongs to the player's whole utterance. Splitting first can
  // strip "I will" from a later clause and turn self-assigned work into a bot
  // order when an existing agenda makes a single surviving step appendable.
  if (classifyPlayerSpeechAuthority(text) === 'conversation_only') return null;

  const disposition = classifyDisposition(text);
  // Strip a leading interrupt phrase ("stop, …", "now …") so the first step
  // resolves on its own words. "stop, mine 10 iron" must parse as "mine 10 iron"
  // with an interrupt disposition, not as the standalone !stop directive.
  const body = disposition === 'interrupt'
    ? (text.replace(INTERRUPT_LEADING, '').trim() || text)
    : text;
  const collectiveSteps = collectiveDeliverySteps(playerName, body, context);
  if (collectiveSteps) {
    return {
      disposition,
      multiStep: true,
      steps: collectiveSteps,
      unresolved: [],
    };
  }
  const segments = splitAgendaSegments(body);
  if (segments.length === 0) return null;

  const steps = [];
  const unresolved = [];
  const standing = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    const directive = resolveDirective(playerName, segment, context);
    if (directive?.deferToModel === true) {
      steps.push({
        segment,
        command: null,
        response: '',
        entry: { kind: 'construction', requester: playerName },
        segmentIndex,
        requiresModelAssignment: true,
        modelInstruction: directive.modelInstruction || '',
      });
      continue;
    }
    const agendaEntry = directive ? directiveToAgendaEntry(directive.command, { requester: playerName }) : null;
    if (agendaEntry) {
      const previous = steps.at(-1)?.entry;
      const duplicate = previous
        && previous.kind === agendaEntry.kind
        && previous.target === agendaEntry.target
        && previous.recipient === agendaEntry.recipient;
      if (!duplicate) {
        steps.push({ segment, command: directive.command, response: directive.response, entry: agendaEntry, segmentIndex });
      }
    } else {
      const companion = directive ? companionDirective(directive.command, segmentIndex) : null;
      if (companion) standing.push({ ...companion, segment, directive });
      else unresolved.push({ segment, directive: directive || null });
    }
  }

  if (steps.length === 0) return null;
  const followedWorkstation = followedWorkstationStep(playerName, standing, steps);
  if (followedWorkstation) steps.unshift(followedWorkstation.step);
  const consumedStanding = new Set(followedWorkstation?.consumed || []);
  unresolved.push(...standing
    .filter(candidate => !consumedStanding.has(candidate))
    .map(candidate => ({ segment: candidate.segment, directive: candidate.directive })));
  return {
    disposition,
    multiStep: steps.length > 1,
    steps,
    unresolved,
  };
}
