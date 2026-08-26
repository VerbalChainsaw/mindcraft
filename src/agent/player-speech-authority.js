const SELF_ASSIGNED_INTENT = /^(?:well[, ]+)?(?:(?:please\s+)?let\s+me\b|(?:i|we)\s+(?:(?:will|shall)\s+|(?:am|are)\s+(?:(?:going|about|trying)\s+to\s+|(?:(?:not|currently|already|still|just)\s+)*[a-z]+ing\b)|(?:plan|intend|mean|hope|want|need)\s+to\s+))/i;
const CONVERSATIONAL_WISH = /^(?:well[, ]+)?(?:i|we)\s+(?:hope|wish)\b/i;
const SERVER_AUTHORITY_REQUEST = /\b(?:(?:give|grant|make|set|promote)\s+(?:me|us)\s+(?:(?:server|operator)\s+)?(?:admin(?:istrator)?|operator|op)(?:\s+(?:access|permissions?|rights?|privileges?))?|(?:op|deop|ban|kick|whitelist)\s+(?:me|us))\b/i;
const SPOKEN_RESPONSE_REQUEST = /^(?:please\s+)?(?:confirm\b|say\b|repeat\b|(?:reply|respond)\b|tell\s+(?:me|us)\b|report\s+(?:your|the|current)\b|(?:describe|explain|answer)\b)/i;

export const PLAYER_PHYSICAL_ACTION_PATTERN = /\b(?:attack|break|brew|build|chop|collect|come|craft|dig|drop|eat|equip|explore|fight|find|follow|gather|give|go|harvest|jump|kill|look|mine|move|place|plant|recover|retrieve|run|search|stay|stop|turn|use|walk|wait)\b/i;

const FOLLOW_ON_PHYSICAL_ACTION = new RegExp(
  String.raw`(?:[.!?]\s*|\b(?:and(?:\s+then)?|then|after(?:wards|\s+that))[, ]+)(?!(?:do\s+not|don't|dont)\b)(?:please\s+)?${PLAYER_PHYSICAL_ACTION_PATTERN.source}`,
  'i',
);

/**
 * Distinguish an order to the companion from the player describing work they
 * assigned to themselves. Ambiguous self-assignment remains conversation: it
 * may be discussed, but it cannot authorize a physical command.
 */
export function classifyPlayerSpeechAuthority(message) {
  const text = String(message || '')
    .trim()
    .replace(/^(well[, ]+)?i['’]ll\b/i, '$1i will')
    .replace(/^(well[, ]+)?i['’]m\b/i, '$1i am')
    .replace(/^(well[, ]+)?we['’]ll\b/i, '$1we will')
    .replace(/^(well[, ]+)?we['’]re\b/i, '$1we are');
  if (!text) return 'none';
  if (SERVER_AUTHORITY_REQUEST.test(text)) return 'response_only';
  // A request to speak is not authority to move merely because the requested
  // words or a safety clause name a gameplay verb. Preserve a genuine compound
  // order such as "confirm, then follow me" as action-eligible.
  if (SPOKEN_RESPONSE_REQUEST.test(text) && !FOLLOW_ON_PHYSICAL_ACTION.test(text)) {
    return 'response_only';
  }
  return SELF_ASSIGNED_INTENT.test(text)
    || CONVERSATIONAL_WISH.test(text)
    ? 'conversation_only'
    : 'action_eligible';
}
