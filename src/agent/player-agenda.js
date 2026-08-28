import {
  constructionRequiredFunctions,
  hasAuthorizedConstructionVerb,
  miningResources,
  resolvePlayerDirective,
} from './player-directives.js';
import { classifyPlayerSpeechAuthority } from './player-speech-authority.js';
import { AGENDA_KINDS } from './runtime/agenda.js';
import { requestedQuantity } from './runtime/goal-contract.js';
import { familyFoodPoints, familyInventoryEntries } from './runtime/item-family.js';
import { selectExistingAccessRepair } from './runtime/access-repair.js';
import { currentAnimalPenConstraint } from './runtime/livestock-contract.js';
import { miningOutputName } from './runtime/jobs/miner-plan.js';
import { breedingFoodForAnimal } from '../utils/mcdata.js';

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
const MAX_INTENT_PARTICIPANTS = 8;
const MAX_INTENT_CONSTRAINTS = 12;
const MAX_CLARIFICATION_AGE_MS = 120_000;
const TERMINAL_WAIT_TAIL = /\b(?:wait|stay)(?:\s+(?:here|there))?(?:\s+with\s+(?:me|us))?(?:\s+until\s+(?:i|we)\b[^.!?]*)?\s*[.!?]*$/i;
const GIFT_TERMINAL_WAIT_TAIL = /\b(?:wait|stay)(?:\s+(?:here|there))?(?:\s+with\s+(?:me|us))?\s*[.!?]*$/i;
const AMBIGUOUS_TRANSFER_RECIPIENT = /\b(?:one of us|either of us|one of you|either of you|someone here)\b/i;
const TRANSFER_VERB = /\b(?:give|deliver|hand|bring)\b/i;
const CLARIFICATION_ANSWER_CUE = /\b(?:give|deliver|hand|bring|to|mean|meant|choose|pick|recipient|him|her|them)\b/i;

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
//
// Known defect, 2026-08-15, proven not fixable at this layer.
//
// The comma before "and" is required, so ordinary unpunctuated speech loses its
// second clause silently: "collect wood and make charcoal" queues only the wood,
// and "get four logs and come back to me" drops the return. Making the comma
// optional was tried and reverted, because "Then go inside and sleep in the bed"
// then splits into "go inside" and "sleep in the bed" and loses the accepted
// construction-barrier sleep step. The same "and" joins two independent clauses
// in one sentence and two halves of a single instruction in the other, and no
// verb list can tell those apart.
//
// The action-verb list is also hand maintained and grew one pattern per reported
// phrasing; fetch, grab, chop, dig, haul, plant, cook, light, and feed are all
// absent, and every gap drops a clause with no receipt. Clause segmentation is a
// language task and belongs with the model proposal step, with this layer
// validating the proposed typed effects against the capability registry rather
// than parsing English. Until that moves, an unmatched conjunction should be
// reported as unresolved instead of silently becoming a single-clause request.
const CONNECTIVE_PATTERNS = [
  /\s+and\s+(?=(?:wait|stay)(?:\s+(?:here|there|with\s+me))?\s*[.!?]*$)/gi,
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
  /,\s+and\s+(?=(?:build|make|craft|prepare|go|walk|head|travel|run|use|smelt|harvest|replant|put|store|stash|deposit|come|return|sleep|follow|mine|collect|bring|deliver|give)\b)/gi,
  /,\s+(?=(?:go|walk|head|travel|run|use|smelt|craft|harvest|replant|put|store|stash|deposit|come|return|mine)\b)/gi,
];

const SEGMENT_DELIMITER = '\u0000';

// One collective delivery sentence names several concrete outputs but only one
// destination: "make me X, Y, and Z, then bring them here." GoalDirector is
// deliberately single-slot, so bind that list into the already durable Agenda
// instead of truncating it to whichever registry item the single-goal parser
// happens to notice first.
const COLLECTIVE_DELIVERY = /^(?:please\s+)?(?:make|craft|prepare)\s+(?:me\s+)?([\s\S]+?)(?:,\s*)?(?:and\s+)?then\s+(?:bring|deliver|give)\s+(?:them|those|all(?:\s+of\s+them)?)\s+(?:here|to\s+me)\s*[.!?]*$/i;
const MANUFACTURE_VERB = /\b(?:make|craft|prepare)\b/i;
const COLLECTIVE_STORAGE_TAIL = /(?:[,;\u2014\u2013-]\s*|\s+)\band\s+((?:store|put|stash|deposit)\b[\s\S]*)$/i;
const RESOURCE_PROJECT_STORAGE_TAIL = /(?:[,;\u2014\u2013-]\s*|\s+)(?:and\s+)?((?:store|put|stash|deposit)\b[\s\S]*)$/i;
const WORKSTATION_QUALIFIER = /\s+(?:using|with)\s+(?:(?:the|our|this|nearby|existing)\s+)*(?:furnace|crafting\s+table|table|workstations?)\b[\s\S]*$/i;
const CONTAINER_NAMES = new Set(['chest', 'trapped_chest', 'barrel']);
const CAVE_EXPEDITION_CUES = Object.freeze([
  /\bexplore\b/i,
  /\bcave\b/i,
  /\b(?:light|torch|illuminate)\b/i,
  /\b(?:collect|gather|mine)\b[\s\S]*\b(?:ore|ores)\b/i,
  /\b(?:return|come back|head back)\b/i,
  /\b(?:store|put|stash|deposit)\b[\s\S]*\b(?:chest|barrel)\b/i,
]);
const SCOUT_REQUEST_CUES = Object.freeze([
  /\b(?:scout|survey|look around|explore|find|locate|search for)\b/i,
  /\b(?:remember|record|mark|note)\b/i,
  /\b(?:return|come back|head back)\b/i,
  /\b(?:guide|lead|show|take)\b/i,
]);
const LIVESTOCK_HOME_CUES = Object.freeze([
  /\b(?:guide|lead|show|take)\b[\s\S]*\b(?:remembered|saved|useful)\b[\s\S]*\b(?:animal|animals|livestock|wildlife)\b/i,
  /\b(?:bring|move|take|lead|lure)\b[\s\S]*\b(?:cow|sheep|pig|chicken|rabbit)s?\b[\s\S]*\b(?:pen|paddock|corral|enclosure)\b/i,
  /\b(?:breed|mate|make more|raise)\b/i,
  /\b(?:return|come back|head back)\b/i,
]);
const FOOD_STOCKING_CUES = Object.freeze([
  /\b(?:stock|gather|collect|prepare|secure)\b[\s\S]*\b(?:food|meals?|provisions?)\b/i,
  /\b(?:cook|smelt)\b/i,
  /\b(?:furnace|stove|smelter)\b/i,
  /\b(?:put|store|stash|deposit)\b[\s\S]*\b(?:chest|barrel)\b/i,
]);
const FISHING_BREAKFAST_CUES = Object.freeze([
  /\b(?:catch|fish(?:ing)?)\b/i,
  /\b(?:cook|smelt)\b/i,
  /\b(?:furnace|stove|smelter)\b/i,
  /\b(?:bring|deliver|give)\b[\s\S]*\b(?:me|us)\b/i,
]);
const NETHER_EXPEDITION_CUES = Object.freeze([
  /\bnether\b/i,
  /\b(?:portal|cross[- ]dimension|another dimension)\b/i,
  /\bquartz\b/i,
  /\b(?:return|come back|head back|round trip|back home)\b/i,
]);

const PRESERVATION_CUE = /\b(?:avoid|do not|don't|dont|keep|leave|only|preserve|protect|reuse|without)\b/i;

function freezeIntentValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeIntentValue(child);
  return Object.freeze(value);
}

function boundedIntentText(value, maximum = 240) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Intent receipts must not carry wire/control bytes.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

/**
 * Compile the complete proposed natural-language plan into one immutable
 * pre-install receipt. The receipt does not interpret or execute mechanics;
 * it makes clause loss fail closed before Agenda publication and gives the
 * control plane one bounded representation of the player's whole promise.
 */
export function compilePlayerIntentLedger(requester, message, plan) {
  const canonicalRequester = boundedIntentText(requester, 16);
  const steps = Array.isArray(plan?.steps) ? plan.steps.slice(0, MAX_SEGMENTS) : [];
  const unresolved = (Array.isArray(plan?.unresolved) ? plan.unresolved : [])
    .map(item => boundedIntentText(item?.segment, 160))
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS);
  const effects = steps.map((step, index) => {
    const entry = step?.entry || {};
    const dependency = step?.dependency || null;
    return {
      index,
      kind: boundedIntentText(entry.kind, 32),
      requester: boundedIntentText(entry.requester, 16),
      target: boundedIntentText(entry.target, 64),
      quantity: Math.max(0, Math.floor(Number(entry.quantity) || 0)),
      quantityMode: boundedIntentText(entry.quantityMode, 24),
      recipient: boundedIntentText(entry.recipient, 16),
      completion: boundedIntentText(entry.completion, 32),
      dependencyPolicy: boundedIntentText(dependency?.policy, 32),
      terminalDisposition: boundedIntentText(entry.terminalDisposition, 32),
      segment: boundedIntentText(step?.segment, 200),
    };
  });
  const participants = [...new Set([
    canonicalRequester,
    ...effects.map(effect => effect.requester),
    ...effects.map(effect => effect.recipient),
  ].filter(Boolean))].slice(0, MAX_INTENT_PARTICIPANTS);
  const preservationConstraints = effects
    .map(effect => effect.segment)
    .filter(segment => PRESERVATION_CUE.test(segment))
    .slice(0, MAX_INTENT_CONSTRAINTS);
  const issues = [];
  if (!/^[A-Za-z0-9_]{1,16}$/.test(canonicalRequester)) issues.push('requester_identity_invalid');
  if (effects.length < 1) issues.push('no_typed_effects');
  if (unresolved.length > 0) issues.push('unresolved_clauses');
  if (effects.some(effect => effect.requester !== canonicalRequester)) issues.push('requester_identity_mismatch');
  if (effects.some(effect => !effect.kind)) issues.push('effect_kind_missing');

  return freezeIntentValue({
    schemaVersion: 1,
    status: issues.length === 0 ? 'complete' : 'incomplete',
    code: issues.length === 0 ? 'player_intent_complete' : 'player_intent_incomplete',
    requester: canonicalRequester,
    source: boundedIntentText(message, MAX_MESSAGE_CHARS),
    participants,
    effects,
    preservationConstraints,
    unresolved,
    issues,
  });
}

function existingAccessRepairPlan(playerName, message, context) {
  const selected = selectExistingAccessRepair(context?.bot, message, context?.requesterPosition);
  if (!selected) return null;
  if (selected.rejection) return { rejection: selected.rejection };
  const repair = selected.constraint;
  const steps = [{
    segment: message,
    command: null,
    response: 'Repairing the exact existing doorway approach.',
    entry: {
      kind: 'repair_access',
      requester: playerName,
      target: selected.material,
      quantity: repair.cells.length,
      accessRepairConstraint: repair,
    },
  }, {
    segment: 'verify the repaired doorway route',
    command: null,
    response: 'Verifying the finished route through the existing doorway.',
    entry: {
      kind: 'verify_access',
      requester: playerName,
      x: repair.interiorStance.x,
      y: repair.interiorStance.y,
      z: repair.interiorStance.z,
      note: 'verify repaired doorway route',
    },
    dependency: { policy: 'requires_success' },
  }];
  if (/\b(?:come|go|head|return)\s+back\b|\bcome\s+(?:to|with)\s+(?:me|us)\b/i.test(message)) {
    steps.push({
      segment: 'return to requester',
      command: null,
      response: `Returning to ${playerName}.`,
      entry: { kind: 'goto', requester: playerName, recipient: playerName },
      dependency: { policy: 'requires_success' },
    });
  }
  if (TERMINAL_WAIT_TAIL.test(message)) {
    steps[steps.length - 1] = {
      ...steps.at(-1),
      entry: { ...steps.at(-1).entry, terminalDisposition: 'hold_position' },
    };
  }
  return { steps };
}

function attachTypedDependencies(steps) {
  return steps.map((step, index) => {
    const predecessor = steps[index - 1];
    if (predecessor?.entry?.kind === 'construction' && step.entry?.kind === 'sleep') {
      return {
        ...step,
        dependency: {
          policy: 'requires_success',
          bindingRequest: { kind: 'structure_fixture', function: 'rest' },
        },
      };
    }
    if (predecessor?.entry?.kind === 'follow_until' && step.entry?.kind === 'smelt') {
      return {
        ...step,
        dependency: {
          policy: 'requires_success',
          bindingRequest: { kind: 'world_block', name: predecessor.entry.target },
        },
      };
    }
    return step;
  });
}

function attachTerminalCompanionWait(steps, standing) {
  const lastStep = steps.at(-1);
  if (!lastStep) return null;
  const terminalWait = standing.find(candidate => (
    candidate.kind === 'wait'
    && candidate.segmentIndex > lastStep.segmentIndex
  ));
  const embeddedTerminalWait = TERMINAL_WAIT_TAIL.test(lastStep.segment);
  if (!terminalWait && !embeddedTerminalWait) return null;
  steps[steps.length - 1] = {
    ...lastStep,
    entry: {
      ...lastStep.entry,
      terminalDisposition: 'hold_position',
    },
  };
  return terminalWait || {
    kind: 'wait',
    segmentIndex: lastStep.segmentIndex,
    embedded: true,
  };
}

function deferredConstructionStep(playerName, segment, directive, segmentIndex) {
  return {
    segment,
    command: null,
    response: '',
    entry: {
      kind: 'construction',
      requester: playerName,
      constructionIntent: {
        requiredFunctions: constructionRequiredFunctions(segment),
        ...(directive.constructionSiteConstraint
          ? { siteConstraint: directive.constructionSiteConstraint }
          : {}),
        ...(directive.constructionLayoutConstraint
          ? { layoutConstraint: directive.constructionLayoutConstraint }
          : {}),
      },
    },
    segmentIndex,
    requiresModelAssignment: true,
    modelInstruction: directive.modelInstruction || '',
  };
}

function normalizeMessage(message) {
  return String(message ?? '')
    .slice(0, MAX_MESSAGE_CHARS)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
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
  const singulars = [
    requested.replace(/s$/, ''),
    requested.replace(/es$/, ''),
    requested.replace(/ies$/, 'y'),
  ];
  const singular = singulars.find(candidate => candidate && registry[candidate]);
  if (singular) return singular;

  // A player may introduce a list with a descriptive prefix, for example
  // "a complete iron tool set - one iron pickaxe". Resolve the concrete
  // registry-backed item named inside that fragment without maintaining a
  // hardcoded catalogue of tools or recipes here.
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\u2014\u2013-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ');
  let best = null;
  for (const [name, item] of Object.entries(registry)) {
    const baseAliases = [
      String(name).replaceAll('_', ' ').toLowerCase(),
      String(item?.displayName || '').toLowerCase(),
    ].filter(Boolean);
    const aliases = new Set(baseAliases.flatMap(alias => {
      const words = alias.split(' ');
      const final = words.at(-1) || '';
      const plural = /(?:s|x|z|ch|sh)$/.test(final)
        ? `${final}es`
        : /[^aeiou]y$/.test(final)
          ? `${final.slice(0, -1)}ies`
          : `${final}s`;
      return [alias, [...words.slice(0, -1), plural].join(' ')];
    }));
    for (const alias of aliases) {
      if (!alias) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(normalized)) continue;
      if (!best || alias.length > best.alias.length) best = { name, alias };
    }
  }
  return best?.name || null;
}

function inventoryItemCount(bot, itemName) {
  return (bot?.inventory?.slots || []).reduce((total, item) => (
    item?.name === itemName ? total + Math.max(0, Number(item.count) || 0) : total
  ), 0);
}

function exactRecipeCraftCount(bot, itemName, requestedOutput) {
  const itemId = bot?.registry?.itemsByName?.[itemName]?.id;
  if (!Number.isInteger(itemId) || typeof bot?.recipesAll !== 'function') return null;
  let recipes;
  try {
    recipes = bot.recipesAll(itemId, null, true);
  } catch {
    return null;
  }
  const outputCounts = [...new Set((Array.isArray(recipes) ? recipes : [])
    .map(recipe => Math.floor(Number(recipe?.result?.count) || 0))
    .filter(count => count > 0))];
  if (outputCounts.length !== 1) return null;
  const outputPerCraft = outputCounts[0];
  const crafts = Math.ceil(requestedOutput / outputPerCraft);
  return crafts * outputPerCraft === requestedOutput ? crafts : null;
}

function loadedPlayerNames(bot) {
  const self = String(bot?.username || '').toLowerCase();
  return Object.values(bot?.players || {})
    .map(player => String(player?.username || '').trim())
    .filter(name => /^[A-Za-z0-9_]{1,16}$/.test(name) && name.toLowerCase() !== self)
    .filter((name, index, names) => names.findIndex(candidate => candidate.toLowerCase() === name.toLowerCase()) === index);
}

function exactLoadedPlayer(bot, requested) {
  const key = String(requested || '').toLowerCase();
  return loadedPlayerNames(bot).find(name => name.toLowerCase() === key) || null;
}

/**
 * Capture only ambiguity whose safe resolution is already typed. This record
 * authorizes no action: it preserves the exact item, quantity, requester,
 * candidate identities, and terminal disposition until the requester answers.
 */
export function detectMaterialPlayerClarification(requester, message, context = {}, { now = Date.now } = {}) {
  const text = normalizeMessage(message).trim();
  const bot = context?.bot;
  if (
    !/^[A-Za-z0-9_]{1,16}$/.test(String(requester || ''))
    || !TRANSFER_VERB.test(text)
    || !AMBIGUOUS_TRANSFER_RECIPIENT.test(text)
  ) return null;
  const target = canonicalListedItem(text, bot);
  const quantity = requestedQuantity(text) || 1;
  if (!target || inventoryItemCount(bot, target) < quantity) return null;
  const candidates = loadedPlayerNames(bot)
    .sort((left, right) => {
      const leftRequester = left.toLowerCase() === String(requester).toLowerCase();
      const rightRequester = right.toLowerCase() === String(requester).toLowerCase();
      if (leftRequester !== rightRequester) return leftRequester ? -1 : 1;
      return left.localeCompare(right);
    })
    .slice(0, 8);
  if (candidates.length < 2) return null;
  const readable = target.replaceAll('_', ' ');
  return Object.freeze({
    kind: 'delivery_recipient',
    requester: String(requester),
    target,
    quantity,
    candidates: Object.freeze(candidates),
    terminalDisposition: TERMINAL_WAIT_TAIL.test(text) ? 'hold_position' : null,
    question: `Who should receive the ${readable}—${candidates.join(' or ')}?`,
    createdAt: now(),
  });
}

export function resolveMaterialPlayerClarification(pending, source, message, context = {}, { now = Date.now } = {}) {
  if (!pending || pending.kind !== 'delivery_recipient') return Object.freeze({ state: 'none' });
  if (now() - Number(pending.createdAt) > MAX_CLARIFICATION_AGE_MS) {
    return Object.freeze({ state: 'expired' });
  }
  if (String(source || '').toLowerCase() !== String(pending.requester || '').toLowerCase()) {
    return Object.freeze({ state: 'other_speaker' });
  }
  const text = normalizeMessage(message).trim();
  const mentioned = pending.candidates
    .map(candidate => exactLoadedPlayer(context?.bot, candidate))
    .filter(Boolean)
    .filter(candidate => new RegExp(`(?:^|[^A-Za-z0-9_])${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9_])`, 'i').test(text));
  if (mentioned.length === 1) {
    const recipient = mentioned[0];
    const waitTail = pending.terminalDisposition === 'hold_position' ? ', then wait here' : '';
    return Object.freeze({
      state: 'resolved',
      recipient,
      message: `Deliver ${pending.quantity} ${pending.target.replaceAll('_', ' ')} to ${recipient}${waitTail}.`,
    });
  }
  if (CLARIFICATION_ANSWER_CUE.test(text) || mentioned.length > 1) {
    return Object.freeze({ state: 'reask', question: pending.question });
  }
  return Object.freeze({ state: 'new_request' });
}

function namedFamilyDeliveryPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const match = /^(?:please\s+)?(?:give|deliver|hand)\s+(.+?)\s+to\s+([A-Za-z0-9_]{1,16})(?:\s*,?\s*(?:then|and\s+then)\s+(?:wait|stay)(?:\s+(?:here|there|with\s+(?:me|us)))?)?\s*[.!?]*$/i.exec(text);
  if (!match) return null;
  const target = canonicalListedItem(match[1], context?.bot);
  const recipient = exactLoadedPlayer(context?.bot, match[2]);
  if (!target || !recipient) return null;
  const quantity = requestedQuantity(match[1]) || 1;
  return {
    steps: [{
      segment: `deliver ${quantity} ${target.replaceAll('_', ' ')} to ${recipient}`,
      command: `!requestItemGoal("deliver", ${JSON.stringify(target)}, ${quantity}, ${JSON.stringify(recipient)}, "delivery")`,
      response: `I will deliver ${quantity} ${target.replaceAll('_', ' ')} to ${recipient}.`,
      entry: {
        kind: 'deliver',
        requester: playerName,
        target,
        quantity,
        recipient,
        ...(TERMINAL_WAIT_TAIL.test(text) ? { terminalDisposition: 'hold_position' } : {}),
      },
    }],
  };
}

function craftSplitDeliveryPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const match = /^(?:please\s+)?(?:craft|make|prepare)\s+(.+?),\s*(?:then\s+)?(?:give|deliver|hand)\s+(.+?)\s+to\s+([A-Za-z0-9_]{1,16}),\s*(?:and\s+)?keep\s+(.+?)\s+for\s+(?:yourself|you)(?:,\s*)?(?:and\s+)?then\s+(?:wait|stay)(?:\s+(?:here|there|with\s+(?:me|us)))?\s*[.!?]*$/i.exec(text);
  if (!match) return null;
  const bot = context?.bot;
  const target = canonicalListedItem(match[1], bot);
  const recipient = exactLoadedPlayer(bot, match[3]);
  const outputQuantity = requestedQuantity(match[1]);
  const deliveredQuantity = requestedQuantity(match[2]);
  const retainedQuantity = requestedQuantity(match[4]);
  if (!target || !recipient || !outputQuantity || !deliveredQuantity || !retainedQuantity) return null;
  const deliveredTarget = canonicalListedItem(match[2], bot);
  const retainedTarget = canonicalListedItem(match[4], bot);
  if (
    (deliveredTarget && deliveredTarget !== target)
    || (retainedTarget && retainedTarget !== target)
    || outputQuantity !== deliveredQuantity + retainedQuantity
  ) return {
    rejection: 'The crafted total must exactly equal the named delivered and retained quantities for one item.',
  };

  const baselineInventory = inventoryItemCount(bot, target);
  const craftCount = exactRecipeCraftCount(bot, target, outputQuantity);
  if (!craftCount) return {
    rejection: `Minecraft recipe metadata cannot produce exactly ${outputQuantity} ${target.replaceAll('_', ' ')} from a bounded number of crafts.`,
  };
  const readable = target.replaceAll('_', ' ');
  return {
    steps: [
      {
        segment: `craft ${outputQuantity} ${readable}`,
        command: `!craftRecipe(${JSON.stringify(target)}, ${craftCount})`,
        response: `I will craft ${outputQuantity} ${readable}.`,
        entry: {
          kind: 'craft',
          requester: playerName,
          target,
          quantity: craftCount,
        },
      },
      {
        segment: `deliver ${deliveredQuantity} ${readable} to ${recipient}`,
        command: `!requestItemGoal("deliver", ${JSON.stringify(target)}, ${deliveredQuantity}, ${JSON.stringify(recipient)}, "delivery")`,
        response: `I will deliver ${deliveredQuantity} ${readable} to ${recipient}.`,
        entry: {
          kind: 'deliver',
          requester: playerName,
          target,
          quantity: deliveredQuantity,
          recipient,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `verify ${retainedQuantity} newly crafted ${readable} remain, then wait here`,
        command: null,
        response: `I will keep ${retainedQuantity} ${readable} and wait here.`,
        entry: {
          kind: 'inventory_checklist',
          requester: playerName,
          inventoryRequirements: [{
            target,
            quantity: baselineInventory + retainedQuantity,
          }],
          terminalDisposition: 'hold_position',
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

// Preserve the common family-workshop transaction as one typed chain. Without
// this whole-utterance guard, "use the crafting table" can be mistaken for a
// request to build a structure before the manufacture and named custody clauses
// are considered.
function namedCraftDeliveryReturnPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  if (!/\bcrafting\s+table\b/i.test(text)) return null;
  const manufacture = /\b(?:make|craft|prepare)\s+(.+?)\s+for\s+([A-Za-z0-9_]{1,16})\b/i.exec(text);
  const transfer = /\b(?:give|deliver|hand)\s+(?:it|them|the\s+(?:item|tool|result))?\s*(?:over\s+)?to\s+([A-Za-z0-9_]{1,16})\b/i.exec(text);
  if (!manufacture || !transfer) return null;
  if (!/\b(?:come|go|head|return)\s+back\s+to\s+me\b/i.test(text)) return null;
  if (!TERMINAL_WAIT_TAIL.test(text)) return null;

  const bot = context?.bot;
  const target = canonicalListedItem(manufacture[1], bot);
  const recipient = exactLoadedPlayer(bot, manufacture[2]);
  const transferRecipient = exactLoadedPlayer(bot, transfer[1]);
  const quantity = requestedQuantity(manufacture[1]) || 1;
  if (!target || !recipient || transferRecipient !== recipient) return null;

  const craftCount = exactRecipeCraftCount(bot, target, quantity);
  if (!craftCount) return {
    rejection: `Minecraft recipe metadata cannot produce exactly ${quantity} ${target.replaceAll('_', ' ')} from a bounded number of crafts.`,
  };
  const workstationConstraint = currentWorkstationConstraint(
    bot,
    'crafting_table',
    context?.requesterPosition,
  );
  if (!workstationConstraint) return {
    rejection: 'I could not bind that workshop request to the loaded camp crafting table, so I did not start only part of it.',
  };

  const readable = target.replaceAll('_', ' ');
  return {
    steps: [
      {
        segment: `craft ${quantity} ${readable} at the selected crafting table`,
        command: `!craftRecipe(${JSON.stringify(target)}, ${craftCount}, ${workstationConstraint.position.x}, ${workstationConstraint.position.y}, ${workstationConstraint.position.z}, ${JSON.stringify(workstationConstraint.dimension)})`,
        response: `I will craft ${quantity} ${readable} at the camp crafting table.`,
        entry: {
          kind: 'craft',
          requester: playerName,
          target,
          quantity: craftCount,
          workstationConstraint,
        },
      },
      {
        segment: `deliver ${quantity} ${readable} to ${recipient}`,
        command: `!requestItemGoal("deliver", ${JSON.stringify(target)}, ${quantity}, ${JSON.stringify(recipient)}, "delivery")`,
        response: `I will give ${quantity} ${readable} to ${recipient}.`,
        entry: {
          kind: 'deliver',
          requester: playerName,
          target,
          quantity,
          recipient,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `return to ${playerName} and wait`,
        command: `!goToPlayer(${JSON.stringify(playerName)}, 3)`,
        response: `I will return to ${playerName} and wait.`,
        entry: {
          kind: 'goto',
          requester: playerName,
          recipient: playerName,
          terminalDisposition: 'hold_position',
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function explicitInventoryKitPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const match = /\b(?:make\s+sure|ensure|check)\s+you(?:'re|\s+are)?\s+carrying\s+(.+?)(?:,\s*)?(?:and\s+)?then\s+(?:wait|stay)(?:\s+(?:here|there|with\s+(?:me|us)))?\s*[.!?]*$/i.exec(text);
  if (!match) return null;
  const outputs = listedManufacturedOutputs(match[1], context?.bot, { minimum: 2 });
  if (!outputs) return null;
  const targets = new Set(outputs.map(output => output.target));
  if (targets.size !== outputs.length) return {
    rejection: 'The exploration kit must name each carried output once with one final quantity.',
  };
  const acquisitions = outputs.map((output, index) => ({
    segment: `carry ${output.quantity} ${output.target.replaceAll('_', ' ')}`,
    command: `!requestItemGoal("acquire", ${JSON.stringify(output.target)}, ${output.quantity}, ${JSON.stringify(playerName)}, "inventory")`,
    response: `I will secure ${output.quantity} ${output.target.replaceAll('_', ' ')} for the kit.`,
    entry: {
      kind: 'acquire',
      requester: playerName,
      target: output.target,
      quantity: output.quantity,
      quantityMode: 'minimum',
      completion: 'inventory',
    },
    ...(index > 0 ? { dependency: { policy: 'requires_success' } } : {}),
  }));
  return {
    steps: [
      ...acquisitions,
      {
        segment: 'verify the complete carried kit, then wait here',
        command: null,
        response: 'I will verify the complete kit and wait here.',
        entry: {
          kind: 'inventory_checklist',
          requester: playerName,
          inventoryRequirements: outputs.map(output => ({
            target: output.target,
            quantity: output.quantity,
          })),
          terminalDisposition: 'hold_position',
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function requestedNetherQuartzCount(message) {
  const match = String(message || '').match(
    /\b(?:at\s+least\s+)?(one|two|three|four|five|six|seven|eight|[1-8])\s+(?:nether\s+)?quartz\b/i,
  );
  if (!match) return 8;
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  return words[match[1].toLowerCase()] || Number(match[1]);
}

/**
 * One cross-dimensional player promise, compiled onto the existing Agenda.
 * The checklist owns live prerequisite reconciliation; the two physical
 * Activities keep portal construction distinct from portal consumption, and
 * every later edge requires the predecessor's verified success.
 */
function netherExpeditionPlan(playerName, message) {
  const text = normalizeMessage(message).trim();
  if (!NETHER_EXPEDITION_CUES.every(pattern => pattern.test(text))) return null;

  const quartzCount = requestedNetherQuartzCount(text);
  // Compile only load-bearing downstream preconditions. "Safe kit" is an
  // outcome constraint, not permission to invent an exact shopping list: the
  // portal builder consumes obsidian plus ignition, the round trip needs the
  // diamond pickaxe that can acquire that obsidian and mine quartz, and
  // survival relies on shield plus food. A bucket and a separate iron sword
  // are useful gear, but neither is required by this chain; gating on them
  // turned the expedition into unrelated serial iron errands.
  const inventoryRequirements = [
    { target: 'shield', quantity: 1 },
    { target: 'diamond_pickaxe', quantity: 1 },
    { target: 'obsidian', quantity: 10 },
    { target: 'flint_and_steel', quantity: 1 },
    { target: 'bread', quantity: 6 },
  ];

  return {
    steps: [
      {
        segment: 'reconcile the complete Nether expedition kit',
        command: null,
        response: 'I will provision the complete expedition kit from live inventory and verified acquisition paths.',
        entry: {
          kind: 'inventory_checklist',
          requester: playerName,
          inventoryRequirements,
          note: 'Nether expedition kit',
        },
      },
      {
        segment: 'construct and ignite the expedition portal',
        command: '!buildNetherPortal(12)',
        response: 'I will construct and verify one active portal near the operating base.',
        entry: {
          kind: 'portal_build',
          requester: playerName,
          radius: 12,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `enter the Nether, secure ${quartzCount} new quartz, and return alive`,
        command: `!completeNetherQuartzRun(${quartzCount})`,
        response: `I will cross dimensions, secure ${quartzCount} new quartz, and return through the paired portal.`,
        entry: {
          kind: 'nether_round_trip',
          requester: playerName,
          quantity: quartzCount,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: 'return to the requester after the expedition',
        command: `!goToPlayer(${JSON.stringify(playerName)}, 3)`,
        response: `I will return to ${playerName} after the expedition settles.`,
        entry: {
          kind: 'goto',
          requester: playerName,
          recipient: playerName,
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function familyGiftCarePlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const handoff = text.match(/\b(?:gave|handed|passed|threw|tossed|dropped)\s+you\s+([^.!?]+)/i);
  if (!handoff || !/\bpick\s+(?:it|that|the\s+\w+)?\s*up\b/i.test(text) || !/\beat\s+(?:it|that|the\s+\w+)?\b/i.test(text)) {
    return null;
  }
  const target = canonicalListedItem(handoff[1], context?.bot);
  if (!target || !context?.bot?.registry?.foodsByName?.[target]) return null;
  const baselineInventory = inventoryItemCount(context.bot, target);
  return {
    steps: [
      {
        segment: `pick up the gifted ${target.replaceAll('_', ' ')}`,
        command: `!pickupItem(${JSON.stringify(target)}, 1, 12, ${baselineInventory})`,
        response: `I will pick up the exact ${target.replaceAll('_', ' ')} you offered.`,
        entry: {
          kind: 'pickup_item',
          requester: playerName,
          target,
          quantity: 1,
          acquisitionCheckpoint: {
            baselineInventory,
            targetInventory: baselineInventory + 1,
          },
        },
      },
      {
        segment: `eat the gifted ${target.replaceAll('_', ' ')} then wait here`,
        command: `!consume(${JSON.stringify(target)})`,
        response: `I will eat the ${target.replaceAll('_', ' ')} and wait here.`,
        entry: {
          kind: 'consume_item',
          requester: playerName,
          target,
          ...(GIFT_TERMINAL_WAIT_TAIL.test(text) ? { terminalDisposition: 'hold_position' } : {}),
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function familyGiftEquipmentPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const handoff = text.match(/\b(?:gave|handed|passed|threw|tossed|dropped)\s+you\s+([^.!?]+)/i);
  const requestsPickup = /\b(?:pick\s+(?:it|that|the\s+\w+)?\s*up|take\s+it|grab\s+it|collect\s+it)\b/i.test(text);
  const requestsEquip = /\b(?:use|equip|wield|wear|hold|switch\s+to|put)\s+(?:it|that|the\s+\w+)(?:\s+on)?\b/i.test(text)
    || /\bput\s+(?:it|that)\s+on\b/i.test(text);
  if (!handoff || !requestsPickup || !requestsEquip) return null;

  const target = canonicalListedItem(handoff[1], context?.bot);
  const equippable = /_(?:pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(target || '')
    || ['bow', 'crossbow', 'trident', 'shield', 'elytra', 'carved_pumpkin', 'totem_of_undying'].includes(target);
  if (!target || !equippable) return null;

  const baselineInventory = inventoryItemCount(context.bot, target);
  return {
    steps: [
      {
        segment: `pick up the offered ${target.replaceAll('_', ' ')}`,
        command: `!pickupItem(${JSON.stringify(target)}, 1, 12, ${baselineInventory})`,
        response: `I will pick up the exact ${target.replaceAll('_', ' ')} you offered.`,
        entry: {
          kind: 'pickup_item',
          requester: playerName,
          target,
          quantity: 1,
          acquisitionCheckpoint: {
            baselineInventory,
            targetInventory: baselineInventory + 1,
          },
        },
      },
      {
        segment: `equip and report the offered ${target.replaceAll('_', ' ')}`,
        command: `!equip(${JSON.stringify(target)})`,
        response: `I will equip the ${target.replaceAll('_', ' ')} and report the verified result.`,
        entry: {
          kind: 'equip_item',
          requester: playerName,
          target,
          ...(GIFT_TERMINAL_WAIT_TAIL.test(text) ? { terminalDisposition: 'hold_position' } : {}),
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function contextBlockNear(bot, matching, requesterPosition = null) {
  const requester = requesterPosition
    && [requesterPosition.x, requesterPosition.y, requesterPosition.z].every(Number.isFinite)
    ? requesterPosition
    : null;
  if (requester && typeof bot?.findBlocks === 'function' && typeof bot?.blockAt === 'function') {
    const positions = bot.findBlocks({ matching, maxDistance: 128, count: 64 });
    const selected = positions
      .map(position => bot.blockAt(position))
      .filter(block => block?.position && matching(block))
      .map(block => ({
        block,
        distance: Math.hypot(
          block.position.x - requester.x,
          block.position.y - requester.y,
          block.position.z - requester.z,
        ),
      }))
      .filter(candidate => candidate.distance <= 32)
      .sort((left, right) => left.distance - right.distance)[0];
    // A named player's "here" is binding. Never replace a missing fixture at
    // their position with an unrelated workstation beside a distant bot.
    return selected?.block || null;
  }
  if (typeof bot?.findBlock !== 'function') return null;
  return bot.findBlock({ matching, maxDistance: 32 });
}

function currentContainerConstraint(bot, requesterPosition = null) {
  const block = contextBlockNear(
    bot,
    candidate => CONTAINER_NAMES.has(candidate?.name),
    requesterPosition,
  );
  const dimension = String(bot?.game?.dimension || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
  if (
    !CONTAINER_NAMES.has(block?.name)
    || !block?.position
    || ![block.position.x, block.position.y, block.position.z].every(Number.isFinite)
    || !dimension
  ) return null;
  return {
    name: block.name,
    position: {
      x: Math.floor(block.position.x),
      y: Math.floor(block.position.y),
      z: Math.floor(block.position.z),
    },
    dimension,
    source: 'player_context_here',
    observedAt: Date.now(),
  };
}

// Preserve one ordinary family observation request as durable, independently
// settling work. The project binds identities and the exact container; native
// navigation and Mineflayer still own reaching and opening it.
function familyContainerInspectionPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  if (
    !/\b(?:check|inspect|look\s+in|look\s+inside|view)\b[\s\S]*\b(?:chest|barrel)\b/i.test(text)
    || !/\b(?:tell|report|say|list)\b[\s\S]*\b(?:what|which|contents?|stored|how\s+many)\b/i.test(text)
    || !/\b(?:come|go|head|return)\s+back\b[\s\S]*\b(?:to\s+me|me)\b/i.test(text)
    || !TERMINAL_WAIT_TAIL.test(text)
  ) return null;

  const namedVisitors = loadedPlayerNames(context?.bot)
    .filter(name => name.toLowerCase() !== String(playerName).toLowerCase())
    .filter(name => new RegExp(`(?:^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9_])`, 'i').test(text));
  if (namedVisitors.length !== 1) return null;
  const visitor = namedVisitors[0];
  const visitorPosition = context?.bot?.players?.[visitor]?.entity?.position;
  if (!visitorPosition) return null;
  const containerConstraint = currentContainerConstraint(context.bot, visitorPosition);
  if (!containerConstraint) return {
    rejection: `I cannot identify one loaded chest or barrel near ${visitor}.`,
  };

  return {
    steps: [
      {
        segment: `go to ${visitor}`,
        command: `!goToPlayer(${JSON.stringify(visitor)}, 3)`,
        response: `I will go to ${visitor}.`,
        entry: { kind: 'goto', requester: playerName, recipient: visitor },
      },
      {
        segment: `inspect the selected ${containerConstraint.name.replaceAll('_', ' ')}`,
        command: `!viewChestAt(${containerConstraint.position.x}, ${containerConstraint.position.y}, ${containerConstraint.position.z}, ${JSON.stringify(containerConstraint.dimension)})`,
        response: `I will inspect and report the selected ${containerConstraint.name.replaceAll('_', ' ')} contents.`,
        entry: { kind: 'inspect_container', requester: playerName, containerConstraint },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `return to ${playerName} and wait`,
        command: `!goToPlayer(${JSON.stringify(playerName)}, 3)`,
        response: `I will return to ${playerName} and wait.`,
        entry: {
          kind: 'goto',
          requester: playerName,
          recipient: playerName,
          terminalDisposition: 'hold_position',
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function currentWorkstationConstraint(bot, name, requesterPosition = null) {
  const block = contextBlockNear(
    bot,
    candidate => candidate?.name === name,
    requesterPosition,
  );
  const dimension = String(bot?.game?.dimension || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
  if (
    block?.name !== name
    || !block?.position
    || ![block.position.x, block.position.y, block.position.z].every(Number.isFinite)
    || !dimension
  ) return null;
  return {
    name,
    position: {
      x: Math.floor(block.position.x),
      y: Math.floor(block.position.y),
      z: Math.floor(block.position.z),
    },
    dimension,
    source: 'player_context_here',
    observedAt: Date.now(),
  };
}

function canonicalDimension(value) {
  return String(value || '').trim().toLowerCase().replace(/^minecraft:/, '');
}

function foodStockingPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  if (!FOOD_STOCKING_CUES.every(pattern => pattern.test(text))) return null;
  const bot = context?.bot;
  const workstationConstraint = currentWorkstationConstraint(bot, 'furnace', context?.requesterPosition);
  const containerConstraint = currentContainerConstraint(bot, context?.requesterPosition);
  if (!workstationConstraint || !containerConstraint) {
    return {
      rejection: 'I could not bind that complete food-stocking plan to both a loaded furnace and a loaded chest or barrel, so I did not start only part of it.',
    };
  }
  const additionalFoodPoints = 24;
  const baselineFoodPoints = familyFoodPoints(bot);
  const baselineInventory = familyInventoryEntries(bot, 'food');
  return {
    steps: [
      {
        segment: text,
        command: null,
        response: `I will prepare an additional safe food reserve with the selected furnace while preserving the farm and nearby structures.`,
        entry: {
          kind: 'prepare_food',
          requester: playerName,
          quantity: additionalFoodPoints,
          baselineFoodPoints,
          bestEffort: true,
          workstationConstraint,
        },
      },
      {
        segment: `store the newly prepared food in the selected ${containerConstraint.name.replaceAll('_', ' ')}`,
        command: null,
        response: `I will store only the newly prepared food in the selected ${containerConstraint.name.replaceAll('_', ' ')}.`,
        entry: {
          kind: 'deposit_family',
          requester: playerName,
          target: 'food',
          quantity: 2304,
          baselineInventory,
          containerConstraint,
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function fishingBreakfastPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  if (!FISHING_BREAKFAST_CUES.every(pattern => pattern.test(text))) return null;
  const bot = context?.bot;
  const workstationConstraint = currentWorkstationConstraint(bot, 'furnace', context?.requesterPosition);
  if (!workstationConstraint) {
    return {
      rejection: 'I could not bind the complete fishing plan to a loaded existing furnace, so I did not start only the first part.',
    };
  }
  const quantity = Math.max(1, Math.min(16, requestedQuantity(text) || 3));
  const baselineRawFish = familyInventoryEntries(bot, 'raw_fish');
  const baselineCookedFish = familyInventoryEntries(bot, 'cooked_fish');
  const waitAtEnd = /\b(?:wait|stay)(?:\s+(?:here|there|with\s+(?:me|us)))?\b/i.test(text);
  const deliveryEntry = {
    kind: 'deliver_family',
    requester: playerName,
    recipient: playerName,
    target: 'cooked_fish',
    quantity,
    baselineInventory: baselineCookedFish,
    ...(waitAtEnd ? { terminalDisposition: 'hold_position' } : {}),
  };
  return {
    steps: [
      {
        segment: `ensure one fishing rod for ${text}`,
        command: `!requestItemGoal("acquire", "fishing_rod", 1, ${JSON.stringify(playerName)}, "inventory")`,
        response: 'I will first ensure I have a fishing rod through the ordinary prerequisite planner.',
        entry: {
          kind: 'acquire',
          requester: playerName,
          target: 'fishing_rod',
          quantity: 1,
          quantityMode: 'minimum',
          completion: 'inventory',
        },
      },
      {
        segment: `catch ${quantity} cookable fish`,
        command: `!fish(${quantity})`,
        response: `I will catch ${quantity} new cod or salmon; junk catches will not count.`,
        entry: {
          kind: 'catch_fish',
          requester: playerName,
          quantity,
          baselineInventory: baselineRawFish,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `cook the ${quantity} newly caught fish in the selected furnace`,
        command: null,
        response: `I will cook only those ${quantity} newly caught fish in the selected existing furnace.`,
        entry: {
          kind: 'cook_fish',
          requester: playerName,
          quantity,
          baselineInventory: baselineRawFish,
          baselineOutputInventory: baselineCookedFish,
          workstationConstraint,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `deliver the ${quantity} newly cooked fish to ${playerName}`,
        command: null,
        response: `I will deliver the ${quantity} newly cooked fish to ${playerName}.`,
        entry: deliveryEntry,
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function caveExpeditionPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const storedExpedition = CAVE_EXPEDITION_CUES.every(pattern => pattern.test(text));
  const resourceMentions = miningResources(text);
  const retainedExpedition = Boolean(
    /\bcave\b/i.test(text)
    && /\b(?:find|explore|look for|search for)\b/i.test(text)
    && /\b(?:collect|gather|mine)\b/i.test(text)
    && /\b(?:return|come back|head back)\b/i.test(text)
    && resourceMentions.length > 0
    && !/\b(?:store|put|stash|deposit)\b[\s\S]*\b(?:chest|barrel)\b/i.test(text)
  );
  if (!storedExpedition && !retainedExpedition) return null;
  const bot = context?.bot;
  const position = bot?.entity?.position;
  const homeDimension = String(bot?.game?.dimension || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
  const containerConstraint = currentContainerConstraint(bot, context?.requesterPosition);
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite) || !homeDimension) {
    return { rejection: 'I could not bind that expedition to my current home-base position, so I did not start only part of it.' };
  }
  if (!containerConstraint && !retainedExpedition) {
    return { rejection: 'I could not bind that expedition to a loaded chest or barrel near the home base, so I did not start only part of it.' };
  }
  const explicitQuantity = text.match(/\b(\d{1,3})\s+(?:useful\s+)?(?:exposed\s+)?ores?\b/i);
  const requiredOutputs = retainedExpedition
    ? miningOutputRequirements(text, resourceMentions)
    : [];
  const namedQuantity = requiredOutputs.reduce((total, requirement) => total + requirement.quantity, 0);
  const bestEffort = !explicitQuantity && requiredOutputs.every(requirement => requirement.quantity === 1);
  const quantity = Math.max(1, Math.min(64, Number(explicitQuantity?.[1]) || Math.max(8, namedQuantity)));
  const exploreStep = {
    segment: text,
    command: null,
    response: retainedExpedition
      ? `I will protect this work area as home, search a nearby cave, collect a useful ore batch containing ${requiredOutputs.map(requirement => requirement.item.replaceAll('_', ' ')).join(' and ')}, retain it, and return.`
      : bestEffort
        ? `I will use this as home base, light nearby caves, collect a useful batch of exposed ore, then return and store what I found in the selected ${containerConstraint.name.replaceAll('_', ' ')}.`
        : `I will use this as home base, light nearby caves, collect at least ${quantity} useful exposed ore drops, then return and store what I found in the selected ${containerConstraint.name.replaceAll('_', ' ')}.`,
    entry: {
      kind: 'explore',
      requester: playerName,
      target: 'ores',
      quantity,
      ...(bestEffort ? { bestEffort: true } : {}),
      ...(retainedExpedition ? { retainResults: true, requiredOutputs } : {}),
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
      homeDimension,
      ...(containerConstraint ? { containerConstraint } : {}),
    },
  };
  return {
    steps: retainedExpedition
      ? [
          exploreStep,
          {
            segment: `return to ${playerName}`,
            command: `!goToPlayer(${JSON.stringify(playerName)}, 2)`,
            response: `I will return to ${playerName}.`,
            entry: { kind: 'goto', requester: playerName, recipient: playerName },
            dependency: { policy: 'after_settlement' },
          },
        ]
      : [exploreStep],
  };
}

// Compile observation, durable memory, return, and guidance as one work order.
// The language layer chooses only the requested finding categories; exact
// coordinates are bound later from verified Minecraft state by the capability
// catalogue and never guessed or replayed from model text.
function scoutMemoryPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const findings = [];
  if (/\b(?:cave|cavern|underground entrance)\b/i.test(text)) findings.push('cave');
  if (/\b(?:animal|animals|livestock|wildlife)\b/i.test(text)) findings.push('animal');
  if (/\b(?:village|settlement|town)\b/i.test(text)) findings.push('village');
  if (findings.length === 0) return null;

  const fullScoutRequest = SCOUT_REQUEST_CUES.every(pattern => pattern.test(text));
  const rememberedContinuation = findings.length === 1
    && /\b(?:return|come back|head back)\b/i.test(text)
    && /\b(?:guide|lead|show|take)\b/i.test(text)
    && /\b(?:found|remembered|saved|recorded|marked)\b/i.test(text);
  if (!fullScoutRequest && !rememberedContinuation) return null;

  const guideClause = text.match(/\b(?:guide|lead|show|take)\b[\s\S]*?\b(cave|cavern|animal|animals|livestock|wildlife|village|settlement|town)\b/i);
  const deicticGuide = findings.length === 1
    && /\b(?:guide|lead|show|take)\b[\s\S]*?\b(?:me|us|the family)?\s*(?:back\s+)?there\b/i.test(text);
  const guideFinding = /^(?:cave|cavern)$/i.test(guideClause?.[1] || '')
    ? 'cave'
    : /^(?:animal|animals|livestock|wildlife)$/i.test(guideClause?.[1] || '')
      ? 'animal'
      : /^(?:village|settlement|town)$/i.test(guideClause?.[1] || '')
        ? 'village'
      : deicticGuide
        ? findings[0]
      : '';
  if (!guideFinding || !findings.includes(guideFinding)) return null;

  const bot = context?.bot;
  // A new search is anchored at the requester's loaded position. A remembered
  // continuation already owns its verified destination, so it may start from
  // Kevin's position even when the requester is connected outside entity-load
  // range; the return capability will reacquire that player through the
  // managed server observation it already owns.
  const position = rememberedContinuation
    ? context?.requesterPosition || bot?.entity?.position
    : context?.requesterPosition;
  const homeDimension = String(bot?.game?.dimension || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite) || !homeDimension) {
    return { rejection: 'I could not bind that scout route to your current loaded position, so I did not start only part of it.' };
  }
  let rememberedFinding = null;
  if (rememberedContinuation) {
    const memoryName = guideFinding === 'village'
      ? 'nearby_village'
      : guideFinding === 'animal'
        ? 'useful_animals'
        : 'nearby_cave';
    const saved = context?.memoryBank?.recallUserPlaceDetails?.(memoryName);
    if (
      !saved
      || ![saved.x, saved.y, saved.z].every(Number.isFinite)
      || canonicalDimension(saved.dimension) !== homeDimension
    ) {
      return { rejection: `I do not have a verified ${guideFinding} saved in this dimension to resume.` };
    }
    rememberedFinding = {
      finding: guideFinding,
      x: Math.floor(saved.x),
      y: Math.floor(saved.y),
      z: Math.floor(saved.z),
      dimension: homeDimension,
    };
  }
  const radiusMatch = text.match(/\b(?:within|radius(?:\s+of)?)\s+(\d+)\s+blocks?\b/i);
  const requestedRadius = radiusMatch ? Number(radiusMatch[1]) : null;
  const searchLimit = Number.isSafeInteger(requestedRadius) && requestedRadius > 0
    ? requestedRadius
    : null;
  // This is the loaded-world observation radius for each region, not an
  // expedition ceiling. Without an explicit player radius, the scout keeps
  // expanding through adjacent observed regions until it finds the target or
  // the player interrupts the mission.
  const radius = Math.max(16, Math.min(128, searchLimit || 64));
  return {
    steps: [{
      segment: text,
      command: null,
      response: rememberedFinding
        ? `I remember the verified ${guideFinding}. I will return to you, then guide you there.`
        : searchLimit
          ? `I will scout within ${searchLimit} blocks, remember one verified ${findings.join(' and one verified ')}, return to you, then guide you to the ${guideFinding}.`
          : `I will search outward for one verified ${findings.join(' and one verified ')}, remember it, return to you, then guide you to the ${guideFinding}.`,
      entry: {
        kind: 'scout',
        requester: playerName,
        findings,
        guideFinding,
        radius,
        ...(rememberedFinding ? { rememberedFinding } : {}),
        ...(searchLimit ? { searchLimit } : {}),
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
        homeDimension,
      },
    }],
  };
}

function requestedConstructionMaterial(text) {
  const wood = text.match(/\b(oak|spruce|birch|jungle|acacia|dark\s+oak|mangrove|cherry|bamboo|crimson|warped)\s+(?:planks?|wood)\b/i)?.[1];
  if (wood) return `${wood.toLowerCase().replaceAll(' ', '_')}_planks`;
  const fullBlock = text.match(/\b(cobblestone|stone|dirt)\b/i)?.[1];
  return fullBlock ? fullBlock.toLowerCase() : 'auto';
}

// Compile a complete livestock project without asking the model to invent
// commands for capabilities the runtime already owns. Inputs which do not
// exist yet remain typed selectors; AgendaDirector resolves and persists their
// exact world identities only after the producing construction/scout steps
// have succeeded.
function livestockProjectPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const animal = ['cow', 'sheep', 'pig', 'chicken', 'rabbit']
    .find(name => new RegExp(`\\b${name}s?\\b`, 'i').test(text));
  const completeProject = Boolean(
    animal
    && /\b(?:build|make|construct|set up)\b[\s\S]*\b(?:pen|paddock|corral|enclosure)\b/i.test(text)
    && /\b(?:scout|find|locate|search for)\b/i.test(text)
    && /\b(?:remember|record|mark|note)\b/i.test(text)
    && /\b(?:bring|move|lead|lure)\b[\s\S]*\b(?:cow|sheep|pig|chicken|rabbit)s?\b/i.test(text)
    && /\b(?:breed|mate|make more|raise)\b/i.test(text)
    && /\b(?:close|shut|secure)\b[\s\S]*\b(?:gate|pen|paddock|corral|enclosure)\b/i.test(text)
    && /\b(?:return|come back|head back)\b/i.test(text)
  );
  if (!completeProject) return null;
  const bot = context?.bot;
  const position = context?.requesterPosition;
  const dimension = canonicalDimension(bot?.game?.dimension);
  const food = breedingFoodForAnimal(animal);
  if (
    !food
    || !position
    || ![position.x, position.y, position.z].every(Number.isFinite)
    || !dimension
  ) {
    return { rejection: 'I could not bind the livestock project to the requester and current dimension, so I did not start only part of it.' };
  }
  const adultCount = Math.max(2, Math.min(8, requestedQuantity(text) || 2));
  const breedingPairs = Math.max(1, Math.floor(adultCount / 2));
  const material = requestedConstructionMaterial(text);
  return {
    steps: [
      {
        segment: `build and secure an animal pen near the functional base using ${material === 'auto' ? 'a feasible primary material' : material.replaceAll('_', ' ')}`,
        command: null,
        response: 'I will bind the catalogue animal pen to one safe loaded site and let Builder finish and verify it.',
        entry: {
          kind: 'construction',
          requester: playerName,
          constructionIntent: {
            requiredFunctions: ['containment', 'access'],
            catalogueStructure: 'animal_pen',
            structuralMaterial: material,
          },
        },
      },
      {
        segment: `scout for and remember at least ${adultCount} ${animal}, return, and guide ${playerName} to them`,
        command: null,
        response: `I will verify at least ${adultCount} ${animal}, remember their source region, return, and guide ${playerName} there.`,
        entry: {
          kind: 'scout',
          requester: playerName,
          findings: ['animal'],
          guideFinding: 'animal',
          animal,
          minimumAnimalCount: adultCount,
          radius: 64,
          x: Math.floor(position.x),
          y: Math.floor(position.y),
          z: Math.floor(position.z),
          homeDimension: dimension,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `prepare ${breedingPairs * 2} ${food.replaceAll('_', ' ')} for the ${animal}`,
        command: null,
        response: `I will prepare the verified attraction food before moving the ${animal}.`,
        entry: {
          kind: 'acquire',
          requester: playerName,
          target: food,
          quantity: breedingPairs * 2,
          quantityMode: 'minimum',
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `bring ${adultCount} ${animal} into the completed pen, breed ${breedingPairs} pair, exit, and close the gate`,
        command: null,
        response: `I will resolve the exact completed pen and remembered ${animal} source, then settle and verify the livestock.`,
        entry: {
          kind: 'settle_livestock',
          requester: playerName,
          target: animal,
          quantity: adultCount,
          breedingPairs,
          sourceSelector: {
            kind: 'remembered_scout',
            memoryName: 'useful_animals',
            dimension,
            animal,
            minimumCount: adultCount,
          },
          penSelector: {
            kind: 'remembered_structure',
            structure: 'animal_pen',
            dimension,
            animal,
          },
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `return to ${playerName}`,
        command: null,
        response: `I will return to ${playerName} after the pen, adults, breeding result, and closed gate are verified.`,
        entry: { kind: 'goto', requester: playerName, recipient: playerName },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

// Preserve guidance, relocation, breeding, pen stewardship, and player return
// as one durable plan. A single !breedAnimals directive is not allowed to
// accept this sentence because it would silently discard most of the outcome.
function livestockHomePlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  if (!LIVESTOCK_HOME_CUES.every(pattern => pattern.test(text))) return null;
  const animal = ['cow', 'sheep', 'pig', 'chicken', 'rabbit']
    .find(name => new RegExp(`\\b${name}s?\\b`, 'i').test(text));
  const food = breedingFoodForAnimal(animal);
  const source = context?.memoryBank?.recallUserPlaceDetails?.('useful_animals');
  const requesterPosition = context?.requesterPosition;
  const penConstraint = currentAnimalPenConstraint(context?.bot, animal, requesterPosition);
  const dimension = canonicalDimension(context?.bot?.game?.dimension);
  if (!animal || !food) {
    return { rejection: 'I could not bind that livestock plan to a supported animal and its real attraction food, so I did not start only part of it.' };
  }
  if (
    !source
    || ![source.x, source.y, source.z].every(Number.isFinite)
    || canonicalDimension(source.dimension) !== dimension
  ) {
    return { rejection: 'I do not have a verified useful-animal location in this dimension, so I did not start only the breeding part.' };
  }
  if (!penConstraint || penConstraint.dimension !== dimension) {
    return { rejection: 'I could not bind the complete livestock plan to a loaded closed fence enclosure near you, so I did not move or breed only part of it.' };
  }
  const adultCount = Math.max(2, Math.min(8, requestedQuantity(text) || 2));
  const breedingPairs = Math.max(1, Math.floor(adultCount / 2));
  const sourcePoint = {
    x: Math.floor(source.x),
    y: Math.floor(source.y),
    z: Math.floor(source.z),
  };
  return {
    steps: [
      {
        segment: `prepare ${breedingPairs * 2} ${food.replaceAll('_', ' ')} for the ${animal}`,
        command: null,
        response: `I will prepare the verified attraction food before leading the livestock route.`,
        entry: {
          kind: 'acquire',
          requester: playerName,
          target: food,
          quantity: breedingPairs * 2,
          quantityMode: 'minimum',
        },
      },
      {
        segment: `guide ${playerName} to the remembered useful animals`,
        command: null,
        response: `I will lead toward the verified useful-animal location.`,
        entry: {
          kind: 'visit',
          requester: playerName,
          ...sourcePoint,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `bring ${adultCount} ${animal} to the selected pen and breed ${breedingPairs} pair`,
        command: null,
        response: `I will lure ${adultCount} ${animal} into the selected enclosure, breed ${breedingPairs} pair, exit, and verify the gate closed.`,
        entry: {
          kind: 'settle_livestock',
          requester: playerName,
          target: animal,
          quantity: adultCount,
          breedingPairs,
          ...sourcePoint,
          penConstraint,
        },
        dependency: { policy: 'requires_success' },
      },
      {
        segment: `return to ${playerName}`,
        command: null,
        response: `I will return to ${playerName} after the livestock outcome is physically verified.`,
        entry: {
          kind: 'goto',
          requester: playerName,
          recipient: playerName,
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

function miningOutputRequirements(text, resourceMentions) {
  return resourceMentions.map((mention, index) => {
    const previousEnd = index > 0
      ? resourceMentions[index - 1].index + resourceMentions[index - 1].label.length
      : Math.max(0, text.search(/\b(?:collect|gather|mine)\b/i));
    const quantityScope = text.slice(previousEnd, mention.index + mention.label.length);
    return {
      source: mention.target,
      item: miningOutputName(mention.target),
      quantity: requestedQuantity(quantityScope) || 1,
    };
  });
}

function listedManufacturedOutputs(value, bot, { minimum = 2 } = {}) {
  const fragments = String(value || '')
    .replace(/[.!?]+$/g, '')
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map(fragment => fragment.trim())
    .filter(Boolean);
  if (fragments.length < minimum || fragments.length * 2 > MAX_SEGMENTS) return null;
  const outputs = fragments.map(fragment => ({
    fragment,
    target: canonicalListedItem(fragment, bot),
    quantity: requestedQuantity(fragment) || 1,
  }));
  return outputs.some(output => !output.target) ? null : outputs;
}

// A resource project is one ordinary player outcome whose phases already have
// durable executors: retain freshly mined inputs, manufacture registry-backed
// outputs, place those exact outputs in one observed container, then return.
// Compile only that typed composition here; recipes and physical policy remain
// owned by GoalDirector, the capability catalogue, and the existing adapters.
function resourceProjectPlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  if (
    !/\bcave\b/i.test(text)
    || !/\b(?:find|explore|look for|search for)\b/i.test(text)
    || !/\b(?:collect|gather|mine)\b/i.test(text)
    || !/\b(?:return|come back|head back)\b/i.test(text)
  ) return null;

  const manufacture = MANUFACTURE_VERB.exec(text);
  if (!manufacture) return null;
  const afterVerb = text.slice(manufacture.index + manufacture[0].length);
  const storage = RESOURCE_PROJECT_STORAGE_TAIL.exec(afterVerb);
  if (!storage || !/\b(?:chest|barrel)\b/i.test(storage[1])) return null;

  const resourceMentions = miningResources(text.slice(0, manufacture.index));
  if (resourceMentions.length === 0) return null;
  const outputClause = afterVerb
    .slice(0, storage.index)
    .replace(WORKSTATION_QUALIFIER, '')
    .trim();
  const outputs = listedManufacturedOutputs(outputClause, context?.bot, { minimum: 1 });
  if (!outputs) return null;

  const bot = context?.bot;
  const position = bot?.entity?.position;
  const homeDimension = String(bot?.game?.dimension || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
  const containerConstraint = currentContainerConstraint(bot, context?.requesterPosition);
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite) || !homeDimension) {
    return { rejection: 'I could not bind that resource project to my current home-base position, so I did not start only part of it.' };
  }
  if (!containerConstraint) {
    return { rejection: 'I could not bind that resource project to a loaded chest or barrel, so I did not start only part of it.' };
  }

  const requiredOutputs = miningOutputRequirements(text, resourceMentions);
  const resourceQuantity = Math.max(1, Math.min(64,
    requiredOutputs.reduce((total, requirement) => total + requirement.quantity, 0),
  ));
  const explore = {
    segment: text.slice(0, manufacture.index).trim(),
    command: null,
    response: `I will protect this work area as home, collect fresh ${requiredOutputs.map(requirement => requirement.item.replaceAll('_', ' ')).join(' and ')}, retain it, and return.`,
    entry: {
      kind: 'explore',
      requester: playerName,
      target: 'ores',
      quantity: resourceQuantity,
      retainResults: true,
      requiredOutputs,
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
      homeDimension,
    },
  };
  const acquisitions = outputs.map(output => ({
    segment: output.fragment,
    command: `!requestItemGoal("acquire", ${JSON.stringify(output.target)}, ${output.quantity}, ${JSON.stringify(playerName)}, "inventory")`,
    response: `I will make ${output.quantity} ${output.target.replaceAll('_', ' ')}.`,
    entry: {
      kind: 'acquire',
      requester: playerName,
      target: output.target,
      quantity: output.quantity,
      completion: 'inventory',
    },
    dependency: { policy: 'requires_success' },
  }));
  const deposits = outputs.map(output => ({
    segment: `store ${output.quantity} ${output.target.replaceAll('_', ' ')}`,
    command: `!putInChestAt(${JSON.stringify(output.target)}, ${output.quantity}, ${containerConstraint.position.x}, ${containerConstraint.position.y}, ${containerConstraint.position.z}, ${JSON.stringify(containerConstraint.dimension)})`,
    response: `I will store ${output.quantity} ${output.target.replaceAll('_', ' ')} in the selected ${containerConstraint.name.replaceAll('_', ' ')}.`,
    entry: {
      kind: 'deposit',
      requester: playerName,
      target: output.target,
      quantity: output.quantity,
      containerConstraint,
    },
    dependency: { policy: 'requires_success' },
  }));
  return {
    steps: [
      explore,
      ...acquisitions,
      ...deposits,
      {
        segment: `return to ${playerName}`,
        command: `!goToPlayer(${JSON.stringify(playerName)}, 2)`,
        response: `I will return to ${playerName}.`,
        entry: { kind: 'goto', requester: playerName, recipient: playerName },
        dependency: { policy: 'after_settlement' },
      },
    ],
  };
}

function collectiveStoragePlan(playerName, message, context) {
  const text = normalizeMessage(message).trim();
  const manufacture = MANUFACTURE_VERB.exec(text);
  if (!manufacture) return null;
  const afterVerb = text.slice(manufacture.index + manufacture[0].length);
  const storage = COLLECTIVE_STORAGE_TAIL.exec(afterVerb);
  if (!storage) return null;
  const storageClause = storage[1];
  if (
    !/\b(?:chest|barrel)\b/i.test(storageClause)
    || !/\b(?:all|them|those|these|set|tools?|items?|everything)\b/i.test(storageClause)
  ) return null;

  const outputs = listedManufacturedOutputs(afterVerb.slice(0, storage.index), context?.bot);
  if (!outputs) return null;
  const containerConstraint = currentContainerConstraint(context?.bot, context?.requesterPosition);
  if (!containerConstraint) {
    return {
      rejection: 'I could not bind that plan to a loaded chest or barrel near me, so I did not start making only part of the requested set.',
    };
  }

  const acquisitions = outputs.map((output, index) => ({
    segment: output.fragment,
    command: `!requestItemGoal("acquire", ${JSON.stringify(output.target)}, ${output.quantity}, ${JSON.stringify(playerName)}, "inventory")`,
    response: `I will make ${output.quantity} ${output.target.replaceAll('_', ' ')}.`,
    entry: {
      kind: 'acquire',
      requester: playerName,
      target: output.target,
      quantity: output.quantity,
      completion: 'inventory',
    },
    ...(index > 0 ? { dependency: { policy: 'requires_success' } } : {}),
  }));
  const deposits = outputs.map(output => ({
    segment: `store ${output.quantity} ${output.target.replaceAll('_', ' ')}`,
    command: `!putInChestAt(${JSON.stringify(output.target)}, ${output.quantity}, ${containerConstraint.position.x}, ${containerConstraint.position.y}, ${containerConstraint.position.z}, ${JSON.stringify(containerConstraint.dimension)})`,
    response: `I will store ${output.quantity} ${output.target.replaceAll('_', ' ')} in the selected ${containerConstraint.name.replaceAll('_', ' ')}.`,
    entry: {
      kind: 'deposit',
      requester: playerName,
      target: output.target,
      quantity: output.quantity,
      containerConstraint,
    },
    dependency: { policy: 'requires_success' },
  }));
  return { steps: [...acquisitions, ...deposits] };
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

// Bind an explicitly requested mining result to the same requester's custody.
// The single-directive resolver intentionally owns only one action, so letting
// it see the whole sentence would accept the mining quota while silently
// discarding "bring it back to me" and a terminal wait. Keep the composition
// here, where typed Agenda dependencies and terminal dispositions are durable.
function minedResourceDeliveryPlan(playerName, message) {
  const text = normalizeMessage(message).trim();
  const transfer = /\b(?:bring|deliver|give|hand)\b[\s\S]*?\b(?:(?:back\s+)?to\s+me|me)\b/i.exec(text);
  if (!transfer || !/\b(?:mine|collect|gather)\b/i.test(text.slice(0, transfer.index))) return null;

  const resources = miningResources(text.slice(0, transfer.index));
  const quantity = requestedQuantity(text.slice(0, transfer.index));
  if (resources.length !== 1 || !quantity) return null;

  const resource = resources[0].target;
  const output = miningOutputName(resource);
  if (!resource || !output) return null;

  const readableResource = resource.replaceAll('_', ' ');
  const readableOutput = output.replaceAll('_', ' ');
  return {
    steps: [
      {
        segment: `mine ${quantity} ${readableResource}`,
        command: `!assignMiningJob(${JSON.stringify(resource)}, ${quantity})`,
        response: `I will mine ${quantity} ${readableResource}.`,
        entry: {
          kind: 'mine',
          requester: playerName,
          target: resource,
          quantity,
        },
      },
      {
        segment: `deliver ${quantity} ${readableOutput} to ${playerName}`,
        command: `!requestItemGoal("deliver", ${JSON.stringify(output)}, ${quantity}, ${JSON.stringify(playerName)}, "delivery")`,
        response: `I will deliver ${quantity} ${readableOutput} to ${playerName}.`,
        entry: {
          kind: 'deliver',
          requester: playerName,
          target: output,
          quantity,
          recipient: playerName,
          ...(TERMINAL_WAIT_TAIL.test(text) ? { terminalDisposition: 'hold_position' } : {}),
        },
        dependency: { policy: 'requires_success' },
      },
    ],
  };
}

/**
 * Decide whether a new player line should replace the queue or extend it.
 * Pure and side-effect free.
 *
 * @returns {'interrupt'|'append'}
 */
// Explicit continuation language. Everything else is a fresh instruction.
const CONTINUATION_LEADING = /^(?:and\s+)?(?:also|then|afterwards?|next|additionally|plus|after\s+that)\b/i;
const CONTINUATION_ANYWHERE = /\b(?:when\s+you(?:'re|\s+are)?\s+(?:done|finished)|after\s+(?:that|you\s+finish)|as\s+well|in\s+addition)\b|\btoo\s*[.!]?$/i;

export function classifyDisposition(message) {
  const text = normalizeMessage(message).trim().toLowerCase();
  if (!text) return 'append';
  if (INTERRUPT_LEADING.test(text) || INTERRUPT_ANYWHERE.test(text)) return 'interrupt';
  // A fresh request replaces current work. Appending by default forced the
  // player to speak the scheduler's language -- "Kevin come here" queued behind
  // whatever he was already doing unless you happened to say "now" or "instead".
  // That is backwards: the player's latest instruction IS the current intent,
  // and ARCHITECTURE.md says a player command replaces it immediately.
  //
  // Appending is still available, but the player has to ask for it in the
  // ordinary way people ask for it: also, then, after that, when you finish.
  if (CONTINUATION_LEADING.test(text) || CONTINUATION_ANYWHERE.test(text)) return 'append';
  return 'interrupt';
}

/**
 * Resolve language plus the durable player-authority state that existed when
 * the request arrived. Stop preserves queued work, but the next fresh player
 * plan replaces that held queue. A temporary compilation Hold must not turn an
 * ordinary append onto actively running work into a replacement.
 *
 * @returns {'interrupt'|'append'}
 */
export function resolvePlayerPlanDisposition(message, {
  agendaBusy = false,
  operatorHeld = false,
  compilingConstruction = false,
} = {}) {
  if (classifyDisposition(message) === 'interrupt') return 'interrupt';
  if (agendaBusy === true && operatorHeld === true && compilingConstruction !== true) {
    return 'interrupt';
  }
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
    .filter(segment => /[\p{L}\p{N}]/u.test(segment))
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
  if (!call) return null;
  if (
    call.name === 'stop'
    || (call.name === 'stay' && Number(unquote(call.args[0])) === -1)
  ) {
    return { command, kind: 'wait', recipient: '', segmentIndex };
  }
  if (!['followPlayer', 'guardPlayer'].includes(call.name)) return null;
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
    case 'recoverDeathItems':
      return entry('recover_death', {});
    case 'buildNetherPortal':
      return entry('portal_build', { radius: asQuantity(args[0]) ?? 12 });
    case 'completeNetherQuartzRun':
      return entry('nether_round_trip', { quantity: asQuantity(args[0]) ?? 1 });
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
/**
 * Does this text stand on its own as real agenda work?
 *
 * The capability registry answers, not a verb list. Deferred construction and
 * site errors deliberately return null so a construction utterance is never
 * torn apart: those must reach the barrier compiler whole.
 */
function resolvedAgendaEntry(playerName, text, context, resolveDirective) {
  let directive = null;
  try {
    directive = resolveDirective(playerName, text, context);
  } catch {
    return null;
  }
  if (!directive || directive.deferToModel === true || directive.constructionSiteError) return null;
  try {
    const entry = directiveToAgendaEntry(directive.command, { requester: playerName });
    if (entry) return entry;
  } catch { /* fall through to the standing-directive check */ }
  // "wait", "stay", "follow me" are real resolved work that lands as a standing
  // companion directive rather than an agenda entry. Ignoring them would report
  // an accepted clause as unsupported and split sentences that must stay whole.
  try {
    return companionDirective(directive.command, 0) || null;
  } catch {
    return null;
  }
}

/**
 * Recover a clause the connective splitter swallowed.
 *
 * "collect wood and make charcoal" carries two clauses but no comma, so the
 * pattern list leaves it whole and the charcoal is lost with no receipt. A
 * bare "and" is genuinely ambiguous — it joins two independent clauses in that
 * sentence and two halves of one instruction in "go inside and sleep in the
 * bed" — so the discriminator is evidence rather than vocabulary: split only
 * when each half independently resolves to real agenda work. A noun
 * conjunction such as "wood and stone" never splits, because "stone" alone
 * resolves to nothing.
 */
function splitResolvableConjunction(playerName, segment, context, resolveDirective, depth = 0) {
  if (depth >= 3 || typeof segment !== 'string') return [segment];
  for (const match of [...segment.matchAll(/\s+and\s+/gi)]) {
    const head = segment.slice(0, match.index).trim();
    const tail = segment.slice(match.index + match[0].length).trim();
    if (!head || !tail) continue;
    if (
      !resolvedAgendaEntry(playerName, head, context, resolveDirective)
      || !resolvedAgendaEntry(playerName, tail, context, resolveDirective)
    ) continue;
    return [
      ...splitResolvableConjunction(playerName, head, context, resolveDirective, depth + 1),
      ...splitResolvableConjunction(playerName, tail, context, resolveDirective, depth + 1),
    ];
  }
  return [segment];
}

/**
 * The tail of a conjunction that the registry cannot satisfy, or null.
 *
 * Only reported when the head is real work on its own, so an ordinary noun
 * conjunction is not mistaken for a lost instruction: in "collect wood and
 * stone" the head "collect wood" resolves and the tail "stone" does not, which
 * is exactly the ambiguity worth surfacing rather than resolving by guess.
 */
function swallowedUnsupportedClause(playerName, segment, context, resolveDirective) {
  if (typeof segment !== 'string') return null;
  for (const match of [...segment.matchAll(/\s+and\s+/gi)]) {
    const head = segment.slice(0, match.index).trim();
    const tail = segment.slice(match.index + match[0].length).trim();
    if (!head || !tail) continue;
    if (!resolvedAgendaEntry(playerName, head, context, resolveDirective)) continue;
    if (resolvedAgendaEntry(playerName, tail, context, resolveDirective)) continue;
    return tail;
  }
  return null;
}

export function parsePlayerAgenda(playerName, message, context = {}, {
  resolveDirective = resolvePlayerDirective,
} = {}) {
  const text = normalizeMessage(message);
  if (!playerName || !text.trim() || text.includes('!')) return null;
  // Authority belongs to the player's whole utterance. Splitting first can
  // strip "I will" from a later clause and turn self-assigned work into a bot
  // order when an existing agenda makes a single surviving step appendable.
  if (classifyPlayerSpeechAuthority(text) !== 'action_eligible') return null;

  const disposition = classifyDisposition(text);
  // Strip a leading interrupt phrase ("stop, …", "now …") so the first step
  // resolves on its own words. "stop, mine 10 iron" must parse as "mine 10 iron"
  // with an interrupt disposition, not as the standalone !stop directive.
  const body = disposition === 'interrupt'
    ? (text.replace(INTERRUPT_LEADING, '').trim() || text)
    : text;
  const netherExpedition = netherExpeditionPlan(playerName, body);
  if (netherExpedition?.steps) {
    return {
      owner: 'nether_expedition',
      disposition,
      multiStep: true,
      steps: netherExpedition.steps,
      unresolved: [],
    };
  }
  const accessRepair = existingAccessRepairPlan(playerName, body, context);
  if (accessRepair?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: accessRepair.rejection,
    };
  }
  if (accessRepair?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: accessRepair.steps,
      unresolved: [],
    };
  }
  const containerInspection = familyContainerInspectionPlan(playerName, body, context);
  if (containerInspection?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: containerInspection.rejection,
    };
  }
  if (containerInspection?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: containerInspection.steps,
      unresolved: [],
    };
  }
  const inventoryKit = explicitInventoryKitPlan(playerName, body, context);
  if (inventoryKit?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: inventoryKit.rejection,
    };
  }
  if (inventoryKit?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: inventoryKit.steps,
      unresolved: [],
    };
  }
  const craftedSplit = craftSplitDeliveryPlan(playerName, body, context);
  if (craftedSplit?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: craftedSplit.rejection,
    };
  }
  if (craftedSplit?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: craftedSplit.steps,
      unresolved: [],
    };
  }
  const namedCraftDelivery = namedCraftDeliveryReturnPlan(playerName, body, context);
  if (namedCraftDelivery?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: namedCraftDelivery.rejection,
    };
  }
  if (namedCraftDelivery?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: namedCraftDelivery.steps,
      unresolved: [],
    };
  }
  const namedDelivery = namedFamilyDeliveryPlan(playerName, body, context);
  if (namedDelivery?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: namedDelivery.steps,
      unresolved: [],
    };
  }
  const giftEquipment = familyGiftEquipmentPlan(playerName, body, context);
  if (giftEquipment?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: giftEquipment.steps,
      unresolved: [],
    };
  }
  const giftCare = familyGiftCarePlan(playerName, body, context);
  if (giftCare?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: giftCare.steps,
      unresolved: [],
    };
  }
  const livestockProject = livestockProjectPlan(playerName, body, context);
  if (livestockProject?.rejection) {
    return {
      owner: 'livestock',
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: livestockProject.rejection,
    };
  }
  if (livestockProject?.steps) {
    return {
      owner: 'livestock',
      disposition,
      multiStep: true,
      steps: livestockProject.steps,
      unresolved: [],
    };
  }
  const livestock = livestockHomePlan(playerName, body, context);
  if (livestock?.rejection) {
    return {
      owner: 'livestock',
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: livestock.rejection,
    };
  }
  if (livestock?.steps) {
    return {
      owner: 'livestock',
      disposition,
      multiStep: true,
      steps: livestock.steps,
      unresolved: [],
    };
  }
  const scout = scoutMemoryPlan(playerName, body, context);
  if (scout?.rejection) {
    return {
      owner: 'scout',
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: scout.rejection,
    };
  }
  if (scout?.steps) {
    return {
      owner: 'scout',
      disposition,
      multiStep: true,
      steps: scout.steps,
      unresolved: [],
    };
  }
  const resourceProject = resourceProjectPlan(playerName, body, context);
  if (resourceProject?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: resourceProject.rejection,
    };
  }
  if (resourceProject?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: resourceProject.steps,
      unresolved: [],
    };
  }
  const expedition = caveExpeditionPlan(playerName, body, context);
  if (expedition?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: expedition.rejection,
    };
  }
  if (expedition?.steps) {
    return {
      disposition,
      // This is one durable work order but several typed physical phases. It
      // must be intercepted instead of falling back to disconnected LLM calls.
      multiStep: true,
      steps: expedition.steps,
      unresolved: [],
    };
  }
  const fishingBreakfast = fishingBreakfastPlan(playerName, body, context);
  if (fishingBreakfast?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: fishingBreakfast.rejection,
    };
  }
  if (fishingBreakfast?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: fishingBreakfast.steps,
      unresolved: [],
    };
  }
  const foodStocking = foodStockingPlan(playerName, body, context);
  if (foodStocking?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: foodStocking.rejection,
    };
  }
  if (foodStocking?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: foodStocking.steps,
      unresolved: [],
    };
  }
  const collectiveStorage = collectiveStoragePlan(playerName, body, context);
  if (collectiveStorage?.rejection) {
    return {
      disposition,
      multiStep: true,
      steps: [],
      unresolved: [],
      rejection: collectiveStorage.rejection,
    };
  }
  if (collectiveStorage?.steps) {
    return {
      disposition,
      multiStep: true,
      steps: collectiveStorage.steps,
      unresolved: [],
    };
  }
  const collectiveSteps = collectiveDeliverySteps(playerName, body, context);
  if (collectiveSteps) {
    return {
      disposition,
      multiStep: true,
      steps: collectiveSteps,
      unresolved: [],
    };
  }
  const minedDelivery = minedResourceDeliveryPlan(playerName, body);
  if (minedDelivery) {
    return {
      disposition,
      multiStep: true,
      steps: minedDelivery.steps,
      unresolved: [],
    };
  }
  const segments = splitAgendaSegments(body);
  if (segments.length === 0) return null;

  const expandedSegments = [];
  for (const segment of segments) {
    expandedSegments.push(...splitResolvableConjunction(playerName, segment, context, resolveDirective));
  }

  const steps = [];
  const unresolved = [];
  const standing = [];
  for (const [segmentIndex, segment] of expandedSegments.entries()) {
    const directive = resolveDirective(playerName, segment, context);
    if (directive?.constructionSiteError) {
      return {
        disposition,
        multiStep: true,
        steps: [],
        unresolved: [],
        rejection: directive.response || 'I cannot identify the named construction site from verified memory.',
      };
    }
    if (directive?.deferToModel === true) {
      // Item-plan cognition compiles one atomic ordered checklist from the
      // player's complete utterance. Turning that deferred assignment into a
      // construction barrier both changes its type and drops the broader
      // inventory contract. Leave the whole line to Agent's correlated
      // item-plan compiler. Construction remains the only deferred assignment
      // represented by a durable Builder barrier here.
      if (['item_plan', 'storage_plan'].includes(directive.assignmentKind)) return null;
      steps.push(deferredConstructionStep(playerName, segment, directive, segmentIndex));
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
      // The segment resolved, but a conjunction inside it may still hide a
      // clause this registry cannot satisfy — "collect wood and make charcoal"
      // resolves as the wood alone and the charcoal disappears with no receipt.
      // Report that tail as unresolved so the ledger asks instead of silently
      // delivering half the request. A tail that resolves on its own was
      // already separated earlier, so anything reaching here is genuinely
      // unsupported rather than merely unpunctuated.
      const swallowed = swallowedUnsupportedClause(playerName, segment, context, resolveDirective);
      if (swallowed) unresolved.push({ segment: swallowed, directive: null });
    } else {
      const companion = directive ? companionDirective(directive.command, segmentIndex) : null;
      if (companion) standing.push({ ...companion, segment, directive });
      else unresolved.push({ segment, directive: directive || null });
    }
  }

  // A preservation clause may be split from the construction verb even though
  // the complete utterance is a valid deferred construction request. Retain
  // that whole semantic unit as the durable barrier before a later Minecraft
  // chat continuation can start a competing model turn. Absorb only unresolved
  // construction/constraint segments up to the next already-typed action.
  if (!steps.some(step => step.entry.kind === 'construction')) {
    const wholeDirective = resolveDirective(playerName, body, context);
    if (wholeDirective?.constructionSiteError) {
      return {
        disposition,
        multiStep: true,
        steps: [],
        unresolved: [],
        rejection: wholeDirective.response || 'I cannot identify the named construction site from verified memory.',
      };
    }
    const wholeConstruction = wholeDirective?.deferToModel === true
      && !['item_plan', 'storage_plan'].includes(wholeDirective.assignmentKind);
    if (wholeConstruction) {
      const constructionIndex = Math.max(0, segments.findIndex(hasAuthorizedConstructionVerb));
      const nextTypedIndex = [...steps, ...standing]
        .map(candidate => candidate.segmentIndex)
        .filter(index => index > constructionIndex)
        .sort((left, right) => left - right)[0] ?? segments.length;
      const absorbedSegments = new Set(segments.slice(constructionIndex, nextTypedIndex));
      const constructionSegment = [...absorbedSegments].join('; ') || body;
      steps.push(deferredConstructionStep(
        playerName,
        constructionSegment,
        wholeDirective,
        constructionIndex,
      ));
      steps.sort((left, right) => left.segmentIndex - right.segmentIndex);
      for (let index = unresolved.length - 1; index >= 0; index -= 1) {
        if (absorbedSegments.has(unresolved[index].segment)) unresolved.splice(index, 1);
      }
    }
  }

  if (steps.length === 0) return null;
  const followedWorkstation = followedWorkstationStep(playerName, standing, steps);
  if (followedWorkstation) steps.unshift(followedWorkstation.step);
  const consumedStanding = new Set(followedWorkstation?.consumed || []);
  const terminalWait = attachTerminalCompanionWait(steps, standing);
  if (terminalWait) consumedStanding.add(terminalWait);
  unresolved.push(...standing
    .filter(candidate => !consumedStanding.has(candidate))
    .map(candidate => ({ segment: candidate.segment, directive: candidate.directive })));
  return {
    disposition,
    multiStep: steps.length > 1 || Boolean(terminalWait),
    steps: attachTypedDependencies(steps),
    unresolved,
  };
}
