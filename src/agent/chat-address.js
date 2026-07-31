// Who is this message for?
//
// With one bot in the world, open chat is obviously meant for it. With several,
// answering everything means five bots talking over each other and over the
// player, so the original rule made every bot deaf to open chat the moment a
// second one joined and required `/msg <name>` for everything. That is correct
// and unusable: whispering every instruction is not playing with someone.
//
// A bot answers open chat when it is addressed -- by its own name, by the squad
// prefix it was spawned under, or by a word meant for everyone. Anything else
// is someone else's conversation.

const BROADCAST_TERMS = Object.freeze([
  'everyone',
  'everybody',
  'all bots',
  'all of you',
  'you all',
  'both of you',
]);

// Minecraft names use letters, digits, and underscore, so a plain `\b` boundary
// is wrong: `\b` treats `_` as a word character, and `Probe_1` would match
// inside `Probe_12`.
const NAME_CHARACTER = /[A-Za-z0-9_]/;

function isNameCharacter(character) {
  return typeof character === 'string' && NAME_CHARACTER.test(character);
}

/** True when `name` appears in `message` as a whole name, not inside another. */
export function mentionsName(message, name) {
  const haystack = String(message || '').toLowerCase();
  const needle = String(name || '').trim().toLowerCase();
  if (!needle || !haystack) return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + needle.length] ?? '';
    if (!isNameCharacter(before) && !isNameCharacter(after)) return true;
    from = at + 1;
  }
}

/**
 * The squad prefix a member name was minted from. `Probe_1` belongs to
 * `Probe`, so "Probe, come here" reaches the whole team rather than nobody.
 * Deliberately conservative: only a trailing separator-and-number is stripped.
 */
export function squadPrefixOf(name) {
  const match = String(name || '').match(/^(.*[A-Za-z])[_-]?\d+$/);
  const prefix = match?.[1]?.replace(/[_-]+$/, '') || '';
  return prefix.length >= 3 ? prefix : '';
}

/**
 * Should this bot treat an open-chat message as spoken to it?
 *
 * `othersPresent` is the whole reason this exists. Alone, a bot answers
 * everything, exactly as it always has. In company, it answers only when
 * addressed, so a squad does not produce five replies to one sentence.
 */
export function addressesAgent(message, name, { othersPresent = true } = {}) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (!othersPresent) return true;
  if (mentionsName(text, name)) return true;
  const prefix = squadPrefixOf(name);
  if (prefix && mentionsName(text, prefix)) return true;
  const lowered = text.toLowerCase();
  return BROADCAST_TERMS.some(term => lowered.includes(term));
}
