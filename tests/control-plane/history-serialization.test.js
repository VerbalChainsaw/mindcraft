// TD-HIST-001 -- add() is called from ~13 places without being awaited. It
// mutates turns synchronously, so it looks safe; once the threshold is crossed
// it yields at the summary model call, and a second add can splice and
// summarize a second chunk concurrently.
//
// The damage is specific: the summary prompt interpolates $MEMORY, so a summary
// is f(previous memory, chunk). Two concurrent summaries both read the same old
// memory and whichever resolves last overwrites the other, silently discarding
// a whole chunk of learned facts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { History } from '../../src/agent/history.js';

// Each summary appends its chunk to whatever memory it observed, so a lost
// chunk is directly visible in the final string.
function agentWith({ delayMs = 0, failOn = null } = {}) {
    const calls = [];
    // Mutable so a test can open and then close a failure window; lastError
    // reflects the most recent drain, so a later success clears it.
    const control = { failOn };
    const agent = {
        name: 'HistBot',
        control,
        prompter: {
            async promptMemSaving(chunk) {
                const observed = agent.history.memory;
                const label = chunk.map(turn => turn.content).join('|');
                calls.push({ observed, label });
                if (control.failOn && label.includes(control.failOn)) throw new Error('summary provider failed');
                if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                return `${observed ? `${observed} ` : ''}[${label}]`;
            },
        },
    };
    agent.history = new History(agent);
    // Keep the test off the real bots/ directory.
    const dir = mkdtempSync(path.join(tmpdir(), 'history-test-'));
    agent.history.full_history_fp = path.join(dir, 'transcript.jsonl');
    agent.history._dir = dir;
    return { agent, history: agent.history, calls, control };
}

function cleanup(history) {
    if (history._dir) rmSync(history._dir, { recursive: true, force: true });
}

test('Given concurrent unawaited adds, when summaries run, then each observes the previous memory instead of overwriting it', async () => {
    // Given -- a slow provider widens the window the race needs
    const { history, calls } = agentWith({ delayMs: 25 });
    history.max_messages = 4;
    history.summary_chunk_size = 2;

    // When -- the shape of the real call sites: fired without awaiting
    for (let i = 0; i < 12; i += 1) history.add('system', `m${i}`);
    await history.flush(10_000);

    // Then
    assert.ok(calls.length >= 2, 'the test must actually trigger more than one summary');
    const observedTwice = calls.filter((call, index) =>
        index > 0 && call.observed === calls[index - 1].observed);
    assert.deepEqual(
        observedTwice, [],
        'two summaries reading the same old memory is the exact overwrite this record describes',
    );
    for (const call of calls.slice(1)) {
        assert.notEqual(call.observed, '', 'a later summary must build on the earlier one');
    }
    cleanup(history);
});

test('Given many summarized chunks, when they complete, then every chunk appears in memory exactly once', async () => {
    // Given
    const { history, calls } = agentWith({ delayMs: 5 });
    history.max_messages = 4;
    history.summary_chunk_size = 2;

    // When
    for (let i = 0; i < 16; i += 1) history.add('system', `m${i}`);
    await history.flush(10_000);

    // Then -- memory is truncated at 500 chars, so assert over the chunks fed
    // to the provider rather than the final string.
    const summarized = calls.flatMap(call => call.label.split('|'));
    const unique = new Set(summarized);
    assert.equal(unique.size, summarized.length, 'no turn may be summarized twice');
    cleanup(history);
});

test('Given unawaited adds, when a turn is pushed, then it is visible immediately', () => {
    // Given -- several callers build the next prompt right after add() without
    // awaiting it, so queueing must not defer the push itself.
    const { history } = agentWith();
    history.max_messages = 100;

    // When
    history.add('system', 'first');
    history.add('Player', 'second');

    // Then
    const turns = history.getHistory();
    assert.equal(turns.length, 2);
    assert.equal(turns[0].content, 'first');
    assert.equal(turns[1].content, 'Player: second');
    cleanup(history);
});

test('Given a summary that fails, when later adds arrive, then the queue keeps working and the error is recorded', async () => {
    // Given -- every summary fails while the window is open
    const { history, control } = agentWith({ failOn: 'm' });
    history.max_messages = 4;
    history.summary_chunk_size = 2;

    // When
    for (let i = 0; i < 8; i += 1) history.add('system', `m${i}`);
    await history.flush(10_000);

    // Then -- the failure is recorded rather than thrown
    assert.equal(typeof history.lastError, 'string');
    assert.match(history.lastError, /summary provider failed/);

    // And -- the queue is not wedged: once the provider recovers, later adds
    // summarize normally and the recorded failure clears.
    control.failOn = null;
    for (let i = 0; i < 8; i += 1) history.add('system', `later${i}`);
    await history.flush(10_000);
    assert.equal(history.lastError, null, 'a recovered queue must clear the recorded failure');
    cleanup(history);
});

test('Given an unawaited add whose summary fails, when it settles, then no rejection escapes', async () => {
    // Given
    const rejections = [];
    const onRejection = (error) => rejections.push(error);
    process.on('unhandledRejection', onRejection);
    const { history } = agentWith({ failOn: 'm' });
    history.max_messages = 2;
    history.summary_chunk_size = 2;

    // When -- exactly how agent.js and conversation.js call it
    try {
        history.add('system', 'm0');
        history.add('system', 'm1');
        await history.flush(10_000);
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        process.off('unhandledRejection', onRejection);
    }

    // Then
    assert.deepEqual(rejections, []);
    cleanup(history);
});

test('Given a summary slower than the budget, when flush is called, then it reports the unflushed tail', async () => {
    // Given
    const { history } = agentWith({ delayMs: 400 });
    history.max_messages = 2;
    history.summary_chunk_size = 2;

    // When
    history.add('system', 'a');
    history.add('system', 'b');
    const settled = await history.flush(50);

    // Then -- shutdown must be told, not blocked
    assert.equal(settled, false);
    assert.equal(await history.flush(5_000), true, 'the tail still completes afterwards');
    cleanup(history);
});
