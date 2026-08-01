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
    recordActionResult(result) { this.lastActionResult = result; },
  };
  agent.actions = new ActionManager(agent);
  agent.isIdle = () => !agent.actions.executing;
  return agent;
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

test('Phase 0 action exceptions retain the original Error and stack', async () => {
  const agent = createHarness();
  const failure = new Error('phase0 sentinel failure');

  const outcome = await agent.actions.runAction('action:failure', async () => {
    throw failure;
  });

  assert.equal(outcome.error, failure);
  assert.match(outcome.error.stack, /phase0 sentinel failure/);
  assert.equal(outcome.result.code, 'runtime_error');
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
