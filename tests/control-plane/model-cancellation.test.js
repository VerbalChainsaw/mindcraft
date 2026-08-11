// TD-MODEL-002 -- Operator Stop reached every provider after TD-MODEL-001, but
// no OpenAI-family adapter could abort an in-flight request, so the call was
// still a no-op. These checks pin the abort itself and the two ways a naive
// implementation would have made a stop worse than doing nothing: restarting
// the generation on the fallback provider, and charging the stop to the
// autonomy error budget.
import assert from 'node:assert/strict';
import test from 'node:test';

import { isCancellation, ModelCancelledError, PendingRequests } from '../../src/models/cancellation.js';
import { FallbackRouter } from '../../src/models/fallback-router.js';
import { OpenAICompatible } from '../../src/models/openai_compatible.js';

// Stands in for the OpenAI SDK: never resolves on its own, rejects with the
// SDK's abort error shape when the passed signal fires.
function hangingClient(onStart) {
  return {
    chat: {
      completions: {
        create: (_pack, options = {}) => new Promise((_resolve, reject) => {
          onStart?.();
          const signal = options.signal;
          if (!signal) return; // no signal wired -> request is uncancellable
          signal.addEventListener('abort', () => {
            const error = new Error('Request was aborted.');
            error.name = 'APIUserAbortError';
            reject(error);
          });
        }),
      },
    },
  };
}

function compatibleModel(client) {
  return new OpenAICompatible('local/model', 'https://example.invalid/v1', {}, {
    readKey: () => 'test-key',
    createClient: () => client,
  });
}

test('Given an in-flight request, when cancelPending is called, then the request aborts and reports one cancellation', async () => {
  // Given
  let started = 0;
  const model = compatibleModel(hangingClient(() => { started += 1; }));
  const pending = model.sendRequest([{ role: 'user', content: 'hi' }], 'system');
  await new Promise(resolve => setImmediate(resolve));

  // When
  const cancelled = model.cancelPending();

  // Then
  assert.equal(cancelled, 1);
  await assert.rejects(pending, (error) => isCancellation(error));
  assert.equal(started, 1, 'exactly one request should have been issued');
});

// The trap: every adapter answers a failure by RETURNING 'My brain
// disconnected, try again.', and FallbackRouter treats that sentinel as a dead
// provider. Reporting an abort that way would penalize the provider and run the
// same generation on the next one -- a stop that starts work.
test('Given a router over two providers, when the active generation is cancelled, then the fallback provider is not started', async () => {
  // Given
  let primaryStarts = 0;
  let secondaryStarts = 0;
  const primary = compatibleModel(hangingClient(() => { primaryStarts += 1; }));
  const secondary = compatibleModel(hangingClient(() => { secondaryStarts += 1; }));
  const router = new FallbackRouter(
    [{ model: primary, label: 'primary' }, { model: secondary, label: 'secondary' }],
    { log: { warn() {} } },
  );
  const pending = router.sendRequest([{ role: 'user', content: 'hi' }], 'system');
  await new Promise(resolve => setImmediate(resolve));

  // When
  const cancelled = router.cancelPending();

  // Then
  assert.equal(cancelled, 1, 'only the in-flight provider had work to cancel');
  await assert.rejects(pending, (error) => isCancellation(error));
  assert.equal(primaryStarts, 1);
  assert.equal(secondaryStarts, 0, 'a stop must not start a generation elsewhere');
});

test('Given no in-flight request, when cancelPending is called, then it reports zero and stays safe to repeat', () => {
  // Given
  const model = compatibleModel(hangingClient());

  // When / Then
  assert.equal(model.cancelPending(), 0);
  assert.equal(model.cancelPending(), 0);
});

test('Given a settled request, when it completes, then its controller is released', async () => {
  // Given
  const client = {
    chat: {
      completions: {
        create: () => Promise.resolve({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }),
      },
    },
  };
  const model = compatibleModel(client);

  // When
  const answer = await model.sendRequest([{ role: 'user', content: 'hi' }], 'system');

  // Then
  assert.equal(answer, 'ok');
  assert.equal(model._pending.size, 0, 'a completed request must not leak its controller');
  assert.equal(model.cancelPending(), 0);
});

// This check originally built the SDK error by hand with `name =
// 'APIUserAbortError'` and passed, while a live black-holed endpoint proved the
// predicate missed the real thing: APIUserAbortError extends APIError extends
// Error and never assigns `this.name`, so the instance name is 'Error' and only
// the CONSTRUCTOR is named APIUserAbortError. Use the real class, not a
// hand-built stand-in, so the test cannot re-encode the same wrong assumption.
test('Given the real SDK abort error, when the predicate inspects it, then it is recognized as cancellation', async () => {
  const { APIUserAbortError } = await import('openai');
  const realAbort = new APIUserAbortError();

  assert.equal(realAbort.name, 'Error', 'guards the assumption this test exists to pin');
  assert.equal(realAbort.constructor.name, 'APIUserAbortError');
  assert.equal(isCancellation(realAbort), true);
});

test('Given each provider family error shape, when the predicate inspects them, then only cancellations match', () => {
  const codexCancel = Object.assign(new Error('Codex request was cancelled.'), { code: 'CANCELLED' });
  const domAbort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

  assert.equal(isCancellation(new ModelCancelledError()), true);
  assert.equal(isCancellation(codexCancel), true);
  assert.equal(isCancellation(domAbort), true);
  assert.equal(isCancellation(new Error('rate limit exceeded')), false);
  assert.equal(isCancellation(new Error('the model aborted its own generation')), false);
  assert.equal(isCancellation(null), false);
});

test('Given a configured timeout, when the client is built, then SDK retries do not multiply the bound', () => {
  // A live black-holed endpoint settled a configured 3s bound in 10.4s, because
  // the SDK retries a timed-out request twice by default.
  let seen = {};
  new OpenAICompatible('m', 'https://example.invalid/v1', { timeout_seconds: 3 }, {
    readKey: () => 'k',
    createClient: (config) => { seen = config; return { chat: { completions: { create() {} } } }; },
  });
  assert.equal(seen.timeout, 3000);
  assert.equal(seen.maxRetries, 0);

  let explicit = {};
  new OpenAICompatible('m', 'https://example.invalid/v1', { timeout_seconds: 3, max_retries: 2 }, {
    readKey: () => 'k',
    createClient: (config) => { explicit = config; return { chat: { completions: { create() {} } } }; },
  });
  assert.equal(explicit.maxRetries, 2, 'an explicit retry count must still win');
});

test('Given many in-flight requests, when cancelAll runs, then each is aborted once and the set is cleared', () => {
  // Given
  const pending = new PendingRequests();
  const first = pending.begin();
  const second = pending.begin();

  // When
  const cancelled = pending.cancelAll();

  // Then
  assert.equal(cancelled, 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(pending.size, 0);
  assert.equal(pending.cancelAll(), 0);
});
