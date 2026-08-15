const SELF_ASSIGNED_INTENT = /^(?:well[, ]+)?(?:(?:please\s+)?let\s+me\b|(?:i|we)\s+(?:(?:will|shall)\s+|(?:am|are)\s+(?:(?:going|about|trying)\s+to\s+|(?:(?:not|currently|already|still|just)\s+)*[a-z]+ing\b)|(?:plan|intend|mean|hope|want|need)\s+to\s+))/i;
const CONVERSATIONAL_WISH = /^(?:well[, ]+)?(?:i|we)\s+(?:hope|wish)\b/i;
const SERVER_AUTHORITY_REQUEST = /\b(?:(?:give|grant|make|set|promote)\s+(?:me|us)\s+(?:(?:server|operator)\s+)?(?:admin(?:istrator)?|operator|op)(?:\s+(?:access|permissions?|rights?|privileges?))?|(?:op|deop|ban|kick|whitelist)\s+(?:me|us))\b/i;

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
  return SELF_ASSIGNED_INTENT.test(text)
    || CONVERSATIONAL_WISH.test(text)
    ? 'conversation_only'
    : 'action_eligible';
}
