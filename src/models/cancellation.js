// Operator Stop must be able to stop a generation that is already in flight.
//
// The subtlety is that a cancelled request must not look like a failed one.
// Every OpenAI-shaped adapter swallows errors and RETURNS 'My brain
// disconnected, try again.', and FallbackRouter treats that sentinel as a dead
// provider -- so an abort reported that way would penalize the provider and
// start a fresh generation on the next one, which is the exact opposite of
// stopping. Cancellation therefore throws a typed error that the router
// recognizes and refuses to route past.

export const MODEL_CANCELLED_CODE = 'MODEL_CANCELLED';

export class ModelCancelledError extends Error {
    constructor(message = 'Model request was cancelled.') {
        super(message);
        this.name = 'ModelCancelledError';
        this.code = MODEL_CANCELLED_CODE;
        this.cancelled = true;
    }
}

/**
 * True for our own cancellation, the OpenAI SDK's abort error, a raw
 * DOMException from an AbortController, and the Codex provider's CANCELLED
 * error -- so one predicate covers every provider family in the repo.
 */
export function isCancellation(error) {
    if (!error) return false;
    if (error.cancelled === true) return true;
    const code = error.code;
    if (code === MODEL_CANCELLED_CODE || code === 'CANCELLED' || code === 'ABORT_ERR') return true;
    // The OpenAI SDK's APIUserAbortError extends APIError extends Error and
    // never assigns `this.name`, so the INSTANCE name is 'Error' even though the
    // class is called APIUserAbortError. Checking `.name` alone silently missed
    // every real SDK abort -- a live black-holed endpoint proved it, after a
    // unit test that built the error by hand had said otherwise. Check the
    // constructor name too, and fall back to the abort message.
    const names = [error.name, error.constructor?.name];
    if (names.includes('ModelCancelledError')) return true;
    if (names.includes('APIUserAbortError') || names.includes('AbortError')) return true;
    return /\b(?:request|operation) was aborted\b/i.test(String(error.message || ''));
}

/**
 * Tracks the AbortControllers for one adapter's in-flight requests. Kept
 * separate from the adapters so each provider file stays a thin transport
 * wrapper rather than growing its own bookkeeping.
 */
export class PendingRequests {
    constructor() {
        this.controllers = new Set();
    }

    begin() {
        const controller = new AbortController();
        this.controllers.add(controller);
        return controller;
    }

    end(controller) {
        this.controllers.delete(controller);
    }

    /** Aborts every in-flight request and returns how many were actually stopped. */
    cancelAll() {
        let cancelled = 0;
        for (const controller of this.controllers) {
            if (!controller.signal.aborted) {
                controller.abort();
                cancelled += 1;
            }
        }
        this.controllers.clear();
        return cancelled;
    }

    get size() {
        return this.controllers.size;
    }
}
