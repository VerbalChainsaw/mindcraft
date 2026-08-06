const SELF_ASSIGNED_INTENT = /^(?:well[, ]+)?(?:i|we)\s+(?:(?:will|shall|'ll)\s+|(?:(?:am|'m)|are|'re)\s+going\s+to\s+|(?:plan|intend|mean|hope|want|need)\s+to\s+)/i;

/**
 * Distinguish an order to the companion from the player describing work they
 * assigned to themselves. Ambiguous self-assignment remains conversation: it
 * may be discussed, but it cannot authorize a physical command.
 */
export function classifyPlayerSpeechAuthority(message) {
  const text = String(message || '')
    .trim()
    .replace(/^(well[, ]+)?i['’]ll\b/i, '$1i will')
    .replace(/^(well[, ]+)?i['’]m\s+going\s+to\b/i, '$1i am going to')
    .replace(/^(well[, ]+)?we['’]ll\b/i, '$1we will')
    .replace(/^(well[, ]+)?we['’]re\s+going\s+to\b/i, '$1we are going to');
  if (!text) return 'none';
  return SELF_ASSIGNED_INTENT.test(text) ? 'conversation_only' : 'action_eligible';
}
