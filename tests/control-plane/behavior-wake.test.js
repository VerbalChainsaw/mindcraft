import assert from 'node:assert/strict';
import test from 'node:test';

import { BehaviorArbiter } from '../../src/agent/runtime/behavior-arbiter.js';

function createArbiter() {
  return new BehaviorArbiter({ name: 'wake-probe' }, { trace: { enabled: false } });
}

async function measure(operation) {
  const started = Date.now();
  const reason = await operation();
  return { elapsed: Date.now() - started, reason };
}

test('Given no world edge, a scheduled sleep runs to its own deadline', async () => {
  const arbiter = createArbiter();
  const { elapsed, reason } = await measure(() => arbiter.sleep(200));

  assert.equal(reason, 'scheduled');
  assert.ok(elapsed >= 150, `expected the full period, waited ${elapsed}ms`);
});

test('Given a salient world edge, a parked evaluation resumes before its deadline', async () => {
  const arbiter = createArbiter();
  arbiter.lastTickStartedAt = Date.now() - 1_000;
  setTimeout(() => arbiter.wake('threat_detected'), 40);

  const { elapsed, reason } = await measure(() => arbiter.sleep(1_000));

  assert.equal(reason, 'threat_detected');
  assert.ok(elapsed < 400, `expected an early wake, waited ${elapsed}ms`);
});

test('Given an edge observed mid-evaluation, the next sleep consumes it exactly once', async () => {
  const arbiter = createArbiter();
  arbiter.wake('self_damaged');

  const latched = await measure(() => arbiter.sleep(1_000));
  assert.equal(latched.reason, 'self_damaged');
  assert.ok(latched.elapsed < 200, `latched edge should not wait, waited ${latched.elapsed}ms`);

  const following = await measure(() => arbiter.sleep(150));
  assert.equal(following.reason, 'scheduled', 'a consumed edge must not wake a second evaluation');
});

// Events arrive while update() is awaiting, so a latched edge bypassing the
// floor would drive the loop back to back for as long as the burst lasts. That
// spin costs a full core and produces no other visible symptom.
test('Given a burst of world edges, evaluations still honour the minimum spacing', async () => {
  const arbiter = createArbiter();
  arbiter.lastTickStartedAt = Date.now();
  for (let index = 0; index < 500; index += 1) arbiter.wake('swarm');

  const { elapsed } = await measure(() => arbiter.sleep(1_000));

  assert.ok(elapsed >= 25, `a burst must not collapse the spacing, waited ${elapsed}ms`);
  assert.ok(elapsed < 400, `a burst must not delay past the floor, waited ${elapsed}ms`);
});

test('Given a sooner scheduled evaluation, a world edge never postpones it', async () => {
  const arbiter = createArbiter();
  arbiter.lastTickStartedAt = Date.now();
  setTimeout(() => arbiter.wake('late'), 5);

  const { elapsed } = await measure(() => arbiter.sleep(60));

  assert.ok(elapsed < 300, `a wake must never extend a sooner deadline, waited ${elapsed}ms`);
});

test('Given teardown, a parked evaluation is released instead of waiting out its period', async () => {
  const arbiter = createArbiter();
  setTimeout(() => arbiter.stop(), 30);

  const { elapsed, reason } = await measure(() => arbiter.sleep(5_000));

  assert.equal(reason, 'stopped');
  assert.ok(elapsed < 500, `teardown should not wait out the period, waited ${elapsed}ms`);
});

test('Given an already stopped arbiter, no evaluation parks', async () => {
  const arbiter = createArbiter();
  arbiter.stop();

  const { elapsed, reason } = await measure(() => arbiter.sleep(5_000));

  assert.equal(reason, 'stopped');
  assert.ok(elapsed < 200, `a stopped arbiter must not park, waited ${elapsed}ms`);
});
