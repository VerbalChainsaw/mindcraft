import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { ActionManager } from '../../src/agent/action_manager.js';

function createHarness() {
  const bot = new EventEmitter();
  bot.output = '';
  bot.interrupt_code = false;
  bot.lastActionEvidence = null;
  bot.entity = { position: { x: 10, y: 64, z: 10 } };

  const agent = {
    name: 'Phase0Bot',
    bot,
    self_prompter: { isActive: () => false },
    history: { add() {} },
    requestInterrupt() { bot.interrupt_code = true; },
    clearBotLogs() {
      bot.output = '';
      bot.interrupt_code = false;
    },
    recordActionResult(result) {
      this.lastActionResult = result;
      this.behavior_arbiter?.recordOutcome?.(result);
    },
  };
  agent.actions = new ActionManager(agent);
  agent.isIdle = () => !agent.actions.executing;
  return agent;
}

function captureLifecycle(agent) {
  const acquisitions = [];
  const releases = [];
  const outcomes = [];
  agent.behavior_arbiter = {
    recordActionStart(value) { acquisitions.push(value); },
    recordActionRelease(value) { releases.push(value); },
    recordOutcome(value) { outcomes.push(value); },
  };
  return { acquisitions, releases, outcomes };
}

test('Phase 0 follow can enter the resumable action path and a prior timeout does not poison it', async () => {
  const agent = createHarness();
  agent.actions.timedout = true;

  const outcome = await agent.actions.runAction('action:followPlayer', async () => true, {
    resume: true,
    timeout: -1,
  });

  assert.equal(outcome.timedout, false);
  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(agent.actions.resume_name, 'action:followPlayer');
});

test('a resumable player action queues behind a critical reflex without stealing its ownership label', async () => {
  const agent = createHarness();
  const wakes = [];
  let followRuns = 0;
  agent.behavior_arbiter = {
    wake(reason) { wakes.push(reason); },
  };
  agent.actions.executing = true;
  agent.actions.currentActionOwner = 'reflex';
  agent.actions.currentActionLabel = 'mode:self_preservation';

  const deferred = await agent.actions.runAction('action:followPlayer', async () => {
    followRuns += 1;
    return true;
  }, { resume: true, owner: 'player', timeout: -1 });

  assert.equal(deferred.success, true);
  assert.equal(deferred.deferred, true);
  assert.equal(followRuns, 0);
  assert.equal(agent.actions.currentActionOwner, 'reflex');
  assert.equal(agent.actions.currentActionLabel, 'mode:self_preservation');
  assert.equal(agent.actions.resume_name, 'action:followPlayer');
  assert.deepEqual(wakes, ['resumable_action_registered']);

  agent.actions.executing = false;
  agent.actions.currentActionOwner = '';
  agent.actions.currentActionLabel = '';
  const resumed = await agent.actions.resumeAction();

  assert.equal(resumed.result.phase, 'succeeded');
  assert.equal(followRuns, 1);
});

test('Phase 0 action exceptions retain the original Error and stack', async () => {
  const agent = createHarness();
  const lifecycle = captureLifecycle(agent);
  const failure = new Error('phase0 sentinel failure');

  const outcome = await agent.actions.runAction('action:failure', async () => {
    throw failure;
  });

  assert.equal(outcome.error, failure);
  assert.match(outcome.error.stack, /phase0 sentinel failure/);
  assert.equal(outcome.result.code, 'runtime_error');
  assert.equal(lifecycle.acquisitions.length, 1);
  assert.equal(lifecycle.releases.length, 1);
  assert.equal(lifecycle.outcomes.length, 1);
  assert.equal(lifecycle.releases[0].actionId, lifecycle.acquisitions[0].actionId);
  assert.equal(lifecycle.acquisitions[0].ownerPriority, 30);
  assert.equal(lifecycle.releases[0].ownerPriority, 30);
  assert.equal(Number.isFinite(lifecycle.releases[0].releasedAt), true);
});

test('successful acquired actions emit one matched acquisition and release', async () => {
  const agent = createHarness();
  const lifecycle = captureLifecycle(agent);

  const outcome = await agent.actions.runAction('action:build', async () => true, { owner: 'job' });

  assert.equal(outcome.result.phase, 'succeeded');
  assert.equal(lifecycle.acquisitions.length, 1);
  assert.equal(lifecycle.releases.length, 1);
  assert.equal(lifecycle.outcomes.length, 1);
  assert.equal(lifecycle.acquisitions[0].actionId, outcome.result.actionId);
  assert.equal(lifecycle.releases[0].actionId, outcome.result.actionId);
  assert.equal(lifecycle.acquisitions[0].owner, 'job');
  assert.equal(lifecycle.acquisitions[0].ownerPriority, 20);
  assert.equal(lifecycle.releases[0].owner, 'job');
  assert.equal(lifecycle.releases[0].ownerPriority, 20);
  assert.equal(Number.isFinite(lifecycle.acquisitions[0].acquiredAt), true);
  assert.equal(Number.isFinite(lifecycle.acquisitions[0].startedAt), true);
  assert.equal(Number.isFinite(lifecycle.releases[0].releasedAt), true);
});

test('actions blocked before acquisition emit no fake lifecycle', async () => {
  const agent = createHarness();
  const lifecycle = captureLifecycle(agent);
  agent.isOperatorHeld = () => true;

  const outcome = await agent.actions.runAction('action:blocked', async () => true, { owner: 'job' });

  assert.equal(outcome.result.phase, 'blocked');
  assert.equal(outcome.result.code, 'operator_hold');
  assert.equal(lifecycle.acquisitions.length, 0);
  assert.equal(lifecycle.releases.length, 0);
  assert.equal(lifecycle.outcomes.length, 1);
});

test('Verified batch placements at different coordinates do not trip the no-progress guard', async () => {
  const agent = createHarness();
  const outcomes = [];

  for (let x = 20; x < 26; x += 1) {
    outcomes.push(await agent.actions.runAction('action:placeBlockAt', () => {
      agent.bot.lastActionEvidence = {
        outcome: 'placed',
        target: { name: 'stone_bricks', x, y: 64, z: 20 },
      };
      return true;
    }, { owner: 'job' }));
  }

  assert.equal(outcomes.every(outcome => outcome.result.phase === 'succeeded'), true);
  assert.equal(outcomes.some(outcome => outcome.result.code === 'action_pattern_detected'), false);
});

test('Verified primitive progress markers prevent false loop detection across bounded actions', async () => {
  const agent = createHarness();
  const outcomes = [];

  for (let y = 63; y > 57; y -= 1) {
    outcomes.push(await agent.actions.runAction('action:collectBlocksInRange', () => {
      agent.bot.entity.position = { x: 10, y, z: 10 };
      agent.bot.lastActionEvidence = {
        kind: 'mining_search',
        outcome: 'search_advanced',
        progress: {
          verified: true,
          kind: 'mining_route_cell',
          position: { x: 10, y, z: 10 },
        },
      };
      return false;
    }, { owner: 'job' }));
  }

  assert.equal(outcomes.every(outcome => outcome.result.code === 'skill_search_advanced'), true);
  assert.equal(outcomes.some(outcome => outcome.result.code === 'action_pattern_detected'), false);
});

test('Different concrete acquisition failures defer to the bounded target-recovery budget', async () => {
  const agent = createHarness();
  const outcomes = [];

  for (let x = 20; x < 26; x += 1) {
    outcomes.push(await agent.actions.runAction('action:collectBlocksInRange', () => {
      agent.bot.lastActionEvidence = {
        kind: 'collect',
        outcome: 'unreachable',
        target: { name: 'acacia_log', x, y: 64, z: 20 },
        retryable: true,
      };
      return false;
    }, { owner: 'job' }));
  }

  assert.equal(outcomes.every(outcome => outcome.result.code === 'skill_unreachable'), true);
  assert.equal(outcomes.some(outcome => outcome.result.code === 'action_pattern_detected'), false);
});

test('Verified progress in one job action resets no-progress history for another job action', async () => {
  const agent = createHarness();
  const surfaceOutcomes = [];

  for (let x = 20; x < 26; x += 1) {
    surfaceOutcomes.push(await agent.actions.runAction('action:goToSurface', () => {
      agent.bot.lastActionEvidence = {
        kind: 'surface_navigation',
        outcome: 'surface_reached',
        target: { name: 'surface_access', x: 10, y: 64, z: 10 },
      };
      return true;
    }, { owner: 'job' }));

    await agent.actions.runAction('action:placeBlockAt', () => {
      agent.bot.lastActionEvidence = {
        outcome: 'placed',
        target: { name: 'cobblestone', x, y: 64, z: 20 },
      };
      return true;
    }, { owner: 'job' });
  }

  assert.equal(surfaceOutcomes.every(outcome => outcome.result.phase === 'succeeded'), true);
  assert.equal(surfaceOutcomes.some(outcome => outcome.result.code === 'action_pattern_detected'), false);
});

test('Repeated success at one unchanged coordinate still trips the no-progress guard', async () => {
  const agent = createHarness();
  let outcome;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    outcome = await agent.actions.runAction('action:placeBlockAt', () => {
      agent.bot.lastActionEvidence = {
        outcome: 'placed',
        target: { name: 'stone_bricks', x: 20, y: 64, z: 20 },
      };
      return true;
    }, { owner: 'job' });
  }

  assert.equal(outcome.result.phase, 'blocked');
  assert.equal(outcome.result.code, 'action_pattern_detected');
});

test('Reflex interruptions do not turn deterministic job resumption into a false loop', async () => {
  const agent = createHarness();
  const outcomes = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    outcomes.push(await agent.actions.runAction('action:goToCoordinates', () => {
      agent.bot.interrupt_code = true;
      return false;
    }, { owner: 'job' }));
  }

  assert.equal(outcomes.every(outcome => outcome.result.phase === 'interrupted'), true);
  assert.equal(outcomes.some(outcome => outcome.result.code === 'action_pattern_detected'), false);
  assert.equal(agent.actions.recentActionAttempts.length, 0);
});
