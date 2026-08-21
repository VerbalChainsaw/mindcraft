// Provider adapters signal a failed generation by RETURNING a sentence, and
// FallbackRouter decides whether to try the next provider by matching that
// sentence. Plain English was therefore load-bearing control flow, with two
// consequences these checks pin down:
//
//   Divergence -- claude, gemini and ollama returned different prose on their
//   failure paths, which the router did not recognise, so those providers never
//   failed over and the error text reached the player as the bot's answer.
//
//   False positives -- the router matched /brain disconnected/i as a substring,
//   so a legitimate reply using the phrase would have been discarded.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FallbackRouter, isFailedResponse } from '../../src/models/fallback-router.js';
import {
    PROVIDER_FAILURE_TEXT,
    isProviderFailureText,
    recentProviderFailures,
    recordProviderFailure,
} from '../../src/models/provider-failure.js';

const MODELS_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'models',
);

test('Given the canonical failure text, when the router inspects it, then it is treated as a failed response', () => {
    assert.equal(isFailedResponse(PROVIDER_FAILURE_TEXT), true);
    assert.equal(isFailedResponse(`  ${PROVIDER_FAILURE_TEXT}  `), true, 'whitespace must not defeat the match');
    assert.equal(isFailedResponse(''), true, 'an empty generation is still a failure');
});

test('Given a real answer that merely mentions the phrase, when the router inspects it, then it is kept', () => {
    // The old substring test would have thrown this away and re-asked another
    // provider -- losing the answer the player actually wanted.
    const genuine = 'You asked what "my brain disconnected" means: it is what I say when a provider call fails.';
    assert.equal(isFailedResponse(genuine), false);
    assert.equal(isProviderFailureText(genuine), false);
});

test('Given a provider failure, when it is recorded, then the cause is preserved and the canonical text returned', () => {
    // Given
    const before = recentProviderFailures().length;

    // When
    const returned = recordProviderFailure('unit-test', Object.assign(new Error('rate limited'), { status: 429 }));

    // Then
    assert.equal(returned, PROVIDER_FAILURE_TEXT, 'what the player sees is unchanged');
    const recorded = recentProviderFailures();
    assert.equal(recorded.length, before + 1);
    const last = recorded[recorded.length - 1];
    assert.equal(last.provider, 'unit-test');
    assert.match(last.detail, /rate limited/);
    assert.equal(last.status, 429, 'the cause must survive, not just the apology');
});

test('Given many recorded failures, when the bound is exceeded, then the log stays bounded', () => {
    for (let i = 0; i < 80; i += 1) recordProviderFailure('flood', new Error(`e${i}`));
    assert.ok(recentProviderFailures().length <= 32);
});

test('Given a failing primary, when it returns the canonical text, then the router tries the next provider', async () => {
    // Given
    const primary = { sendRequest: () => Promise.resolve(PROVIDER_FAILURE_TEXT) };
    const secondary = { sendRequest: () => Promise.resolve('a real answer') };
    const router = new FallbackRouter(
        [{ model: primary, label: 'primary' }, { model: secondary, label: 'secondary' }],
        { log: { warn() {} } },
    );

    // When / Then
    assert.equal(await router.sendRequest([], 'system'), 'a real answer');
});

// The contract only holds if every adapter uses the shared value. A typo'd copy
// would silently opt that provider out of failover, which is exactly how
// claude, gemini and ollama drifted.
test('Given every provider adapter, when it signals failure, then it uses the shared constant rather than its own prose', () => {
    const offenders = [];
    for (const file of readdirSync(MODELS_DIR).filter(name => name.endsWith('.js'))) {
        if (file === 'provider-failure.js') continue;
        const text = readFileSync(path.join(MODELS_DIR, file), 'utf8');
        const lines = text.split('\n');
        lines.forEach((line, index) => {
            // A hardcoded copy of the failure sentence anywhere but the module
            // that defines it.
            if (/["'][^"']*brain disconnected[^"']*["']/i.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
                offenders.push(`${file}:${index + 1} hardcodes the failure text`);
            }
        });
    }
    assert.deepEqual(offenders, []);
});

// Swapping the literals for a helper call introduced two adapters that used
// recordProviderFailure without importing it -- a ReferenceError that only
// fires on the failure path, which is the least likely path to be exercised.
// node --check cannot see it, so assert the symbol actually resolves.
test('Given an adapter that calls the failure helper, when its imports are read, then the symbol is actually imported', () => {
    const offenders = [];
    for (const file of readdirSync(MODELS_DIR).filter(name => name.endsWith('.js'))) {
        if (file === 'provider-failure.js') continue;
        const text = readFileSync(path.join(MODELS_DIR, file), 'utf8');
        const uses = /\brecordProviderFailure\s*\(/.test(text);
        const imports = /import\s*\{[^}]*\brecordProviderFailure\b[^}]*\}\s*from\s*['"]\.\/provider-failure\.js['"]/.test(text);
        if (uses && !imports) offenders.push(`${file} calls recordProviderFailure without importing it`);
    }
    assert.deepEqual(offenders, []);
});

test('Given the known divergent adapters, when their failure paths are read, then they route through the shared helper', () => {
    for (const file of ['claude.js', 'gemini.js', 'ollama.js']) {
        const text = readFileSync(path.join(MODELS_DIR, file), 'utf8');
        assert.match(
            text, /recordProviderFailure\(/,
            `${file} previously returned prose the router could not recognise`,
        );
    }
});

test('Given the model router exhausted its route, when conversation handles the failure, then it does not spend another prompt turn', () => {
    const text = readFileSync(path.join(MODELS_DIR, 'prompter.js'), 'utf8');
    assert.match(
        text,
        /if \(outcome === 'provider_failed'\) return PROVIDER_FAILURE_TEXT;/,
        'provider failure must return immediately; later turns are only for correcting generated answers',
    );
});
