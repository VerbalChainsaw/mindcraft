import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyEntityMotion,
  scoreEntityThreat,
} from '../src/agent/library/full_state.js';
import {
  createItemGoalContract,
  normalizeGoalContract,
} from '../src/agent/runtime/goal-contract.js';
import { PersonalMemory } from '../src/agent/runtime/personal-memory.js';
import { classifyMethodOutcome } from '../src/agent/runtime/action-result.js';
import { buildPrerequisitePlan } from '../src/agent/runtime/prerequisite-planner.js';
import { ProcedureStore } from '../src/agent/runtime/procedure-store.js';

function plannerBot() {
  return {
    inventory: {
      slots: [],
      items: () => [],
    },
    registry: {
      items: {
        1: { id: 1, name: 'test_gem' },
      },
      itemsByName: {
        test_gem: { id: 1, name: 'test_gem' },
      },
      blocks: {
        10: { id: 10, name: 'alpha_ore', diggable: true, drops: [1], harvestTools: {} },
        11: { id: 11, name: 'beta_ore', diggable: true, drops: [1], harvestTools: {} },
      },
      recipes: {},
    },
  };
}

test('Perception classifies closing motion and prioritizes visible approaching explosive threats', () => {
  const bot = {
    entity: {
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
  };
  const motion = classifyEntityMotion(bot, {
    position: { x: 0, y: 64, z: 8 },
    velocity: { x: 0, y: 0, z: -0.2 },
  });
  assert.equal(motion.state, 'approaching');
  assert.ok(motion.closingSpeed > 0);

  const approaching = scoreEntityThreat({
    name: 'creeper',
    distance: 8,
    hostile: true,
    disposition: 'avoid',
    visible: true,
    motion: 'approaching',
  });
  const retreating = scoreEntityThreat({
    name: 'creeper',
    distance: 8,
    hostile: true,
    disposition: 'avoid',
    visible: false,
    motion: 'retreating',
  });
  assert.ok(approaching > retreating);
  assert.equal(scoreEntityThreat({ name: 'cow', distance: 2, hostile: false }), 0);
});

test('Verified outcome history persists and remains a bounded ranking hint', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-learning-'));
  try {
    const memory = new PersonalMemory('TestBot', { rootDir });
    memory.load();
    for (let index = 0; index < 4; index += 1) {
      memory.rememberOutcome('collect:beta_ore->test_gem', {
        success: true,
        durationMs: 1200,
        yieldCount: 1,
        code: 'skill_collected',
      });
      memory.rememberOutcome('collect:alpha_ore->test_gem', {
        success: false,
        durationMs: 3000,
        code: 'skill_path_stalled',
      });
    }

    const restored = new PersonalMemory('TestBot', { rootDir });
    restored.load();
    assert.ok(restored.outcomePreference('collect:beta_ore->test_gem') > 0);
    assert.ok(restored.outcomePreference('collect:alpha_ore->test_gem') < 0);
    assert.equal(restored.getOutcomeSummary(1).length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('ownership preemption is censored and does not poison method learning', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-censored-learning-'));
  try {
    const memory = new PersonalMemory('TestBot', { rootDir });
    memory.load();
    const interrupted = { phase: 'interrupted', code: 'interrupted' };
    const classification = classifyMethodOutcome(interrupted);

    assert.equal(classification, 'censored');
    assert.equal(memory.rememberOutcome('collect:stone->cobblestone', {
      classification,
      success: false,
      durationMs: 500,
      code: interrupted.code,
    }), false);
    assert.deepEqual(memory.getOutcomeSummary(6), []);
    assert.equal(classifyMethodOutcome({ phase: 'failed', code: 'path_stalled' }), 'method_failure');
    assert.equal(classifyMethodOutcome({ phase: 'succeeded', code: 'collected' }), 'success');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('The causal planner uses learned outcomes only to rank otherwise viable methods', () => {
  const baseline = buildPrerequisitePlan(plannerBot(), {
    target: 'test_gem',
    quantity: 1,
  });
  assert.match(baseline.nextStep.command, /alpha_ore/);

  const learned = buildPrerequisitePlan(plannerBot(), {
    target: 'test_gem',
    quantity: 1,
    experience: key => key.includes('beta_ore') ? 8 : key.includes('alpha_ore') ? -8 : 0,
  });
  assert.match(learned.nextStep.command, /beta_ore/);
  assert.equal(learned.nextStep.learningKey, 'collect:beta_ore->test_gem');
  assert.equal(learned.nextStep.learnedPreference, 8);
});

test('A persisted goal preserves the learning identity of its active plan step', () => {
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'Player',
    target: {
      requestedName: 'test_gem',
      canonicalName: 'test_gem',
      inventoryName: 'test_gem',
      acquisitionName: 'test_gem',
      family: null,
      acquisitionKind: 'planned',
    },
    quantity: 1,
  });
  const normalized = normalizeGoalContract({
    ...goal,
    subgoals: [{
      id: `${goal.id}:subgoal-1`,
      kind: 'plan',
      state: 'acting',
      commandName: '!collectBlocksInRange',
      learningKey: 'collect:beta_ore->test_gem',
    }],
  });
  assert.equal(normalized.subgoals[0].learningKey, 'collect:beta_ore->test_gem');
});

test('Verified procedures never cross target identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-procedure-'));
  try {
    const store = new ProcedureStore('TestBot', { root });
    const target = name => ({
      requestedName: name,
      canonicalName: name,
      inventoryName: name,
      acquisitionName: name,
      family: null,
      acquisitionKind: 'planned',
    });
    const completed = normalizeGoalContract({
      ...createItemGoalContract({
        kind: 'acquire',
        requester: 'Player',
        target: target('oak_log'),
        quantity: 1,
      }),
      phase: 'complete',
      evidence: {
        phase: 'succeeded',
        code: 'inventory_goal_verified',
        detail: 'Verified.',
        verified: true,
      },
      subgoals: [{
        kind: 'plan',
        state: 'succeeded',
        commandName: '!collectBlocksInRange',
        code: 'skill_collected',
      }],
    });
    const recorded = store.record(completed);
    assert.equal(recorded.targetKey, 'oak_log');

    const otherTarget = createItemGoalContract({
      kind: 'acquire',
      requester: 'Player',
      target: target('cobblestone'),
      quantity: 1,
    });
    assert.equal(store.find(otherTarget), null);
    assert.equal(store.find(completed)?.id, recorded.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
