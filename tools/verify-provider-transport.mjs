// Live transport proof for TD-PROV-001 and TD-MODEL-002. Runs against a REAL
// black-holed TCP endpoint and the REAL OpenAI SDK -- no mocked client, no live
// credential, no Paper world required. Run with: node tools/verify-provider-transport.mjs
//
// This exists because the mocked unit tests were not sufficient: they built the
// SDK's abort error by hand and so encoded an assumption about it that was
// wrong. Both defects below were found by running this, not by the unit tests.
//
//   TD-PROV-001: "A black-holed local endpoint rejects within the configured bound."
//   TD-MODEL-002: "A stop during a real generation aborts the HTTP request."
import net from 'node:net';
import process from 'node:process';

import { OpenAICompatible } from '../src/models/openai_compatible.js';
import { isCancellation } from '../src/models/cancellation.js';

let socketsOpened = 0;
let socketsClosed = 0;

// Accepts the TCP connection, reads the request, then never answers -- the
// stalled-provider shape seen with self-hosted Ollama, NVIDIA, and DashScope.
const server = net.createServer((socket) => {
    socketsOpened += 1;
    socket.on('close', () => { socketsClosed += 1; });
    socket.on('error', () => { /* client aborted; expected */ });
    socket.resume();
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/v1`;
console.log(`black-hole endpoint listening on ${url}\n`);

const build = (params) => new OpenAICompatible('stalled/model', url, params, {
    readKey: () => 'not-a-real-key',
});

let failures = 0;
const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
    if (!ok) failures += 1;
};

// ---------------------------------------------------------------- TD-PROV-001
{
    const TIMEOUT_SECONDS = 3;
    const model = build({ timeout_seconds: TIMEOUT_SECONDS });
    const startedAt = Date.now();
    try {
        await model.sendRequest([{ role: 'user', content: 'hello' }], 'system');
    } catch { /* the adapter returns a sentinel for non-cancellation failures */ }
    const elapsed = Date.now() - startedAt;

    // Regression guard: the SDK retries a timed-out request twice by default,
    // which made a configured 3s bound settle in 10.4s before maxRetries was
    // pinned. Allow one second of slack, not one retry's worth.
    check(
        'TD-PROV-001 stalled endpoint gives up at the configured bound',
        elapsed < (TIMEOUT_SECONDS * 1000) + 1_500,
        `configured ${TIMEOUT_SECONDS}s, settled in ${elapsed}ms (SDK default would be 600000ms; pre-fix was ~10400ms)`,
    );
    check('TD-PROV-001 a real request was attempted', elapsed > 1_000, `${elapsed}ms`);
}

// --------------------------------------------------------------- TD-MODEL-002
{
    const openedBefore = socketsOpened;
    const closedBefore = socketsClosed;
    const model = build({}); // no timeout: only the abort can end this
    const startedAt = Date.now();
    const pending = model.sendRequest([{ role: 'user', content: 'hello' }], 'system');

    await new Promise(resolve => setTimeout(resolve, 750)); // reach the socket
    const connectedMidFlight = socketsOpened > openedBefore;

    const cancelled = model.cancelPending();
    let outcome;
    try {
        outcome = { value: await pending };
    } catch (error) {
        outcome = { error };
    }
    const elapsed = Date.now() - startedAt;
    await new Promise(resolve => setTimeout(resolve, 250)); // let close events land

    check('TD-MODEL-002 a real connection was in flight when the stop arrived', connectedMidFlight);
    check('TD-MODEL-002 cancelPending reported exactly one aborted request', cancelled === 1, `got ${cancelled}`);
    check(
        'TD-MODEL-002 the request rejected as a cancellation, not a provider failure',
        Boolean(outcome.error) && isCancellation(outcome.error),
        outcome.error ? outcome.error.message : `resolved with ${JSON.stringify(outcome.value)}`,
    );
    check('TD-MODEL-002 the stop was immediate', elapsed < 3_000, `${elapsed}ms`);
    check(
        'TD-MODEL-002 the underlying TCP socket was actually torn down',
        socketsClosed > closedBefore,
        `closed ${socketsClosed - closedBefore} socket(s) -- the difference between aborting a request and discarding its answer`,
    );
}

server.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
