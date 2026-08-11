// Every provider adapter answers a failed generation by RETURNING a sentence
// rather than throwing, and FallbackRouter decides whether to try the next
// provider by pattern-matching that sentence. So a plain English string is
// load-bearing control flow, which caused two distinct problems.
//
// Divergence: three adapters returned different prose on their failure paths --
// "No response from Claude.", "An unexpected error occurred, please try again."
// (inside gemini's catch), and "No response data." -- none of which the router
// recognised. Those providers never failed over; the error text was handed to
// the player as though it were the bot's answer.
//
// Loss: the real error was only console.log'd, with no provider attribution. On
// a routed profile you could not tell which provider failed or why.
//
// One canonical failure value fixes both. The text is unchanged, so what the
// player sees is exactly what they saw before.

export const PROVIDER_FAILURE_TEXT = 'My brain disconnected, try again.';

const MAX_RECORDED_FAILURES = 32;
const recent = [];

/**
 * Records why a provider failed and returns the canonical failure text.
 * Adapters use the return value directly:
 *   res = recordProviderFailure('gpt', err);
 */
export function recordProviderFailure(provider, error) {
    const detail = String(error?.message || error || 'unknown provider failure').slice(0, 280);
    recent.push({
        provider: String(provider || 'unknown').slice(0, 40),
        detail,
        status: Number.isFinite(error?.status) ? error.status : null,
        at: Date.now(),
    });
    while (recent.length > MAX_RECORDED_FAILURES) recent.shift();
    // Attribution the bare `console.log(err)` never gave: on a routed profile
    // the log could not say which provider produced the error.
    console.warn(`[provider] ${provider} request failed: ${detail}`);
    return PROVIDER_FAILURE_TEXT;
}

/** Most recent failures, newest last. Bounded; intended for diagnosis. */
export function recentProviderFailures() {
    return recent.map(entry => ({ ...entry }));
}

/**
 * Exact match, deliberately. The previous router test was a loose
 * /brain disconnected/i substring, so a model that merely used the phrase in a
 * legitimate reply would have been treated as a dead provider and its answer
 * discarded in favour of shopping for another one.
 */
export function isProviderFailureText(value) {
    return typeof value === 'string' && value.trim() === PROVIDER_FAILURE_TEXT;
}
