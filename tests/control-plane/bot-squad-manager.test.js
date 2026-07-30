import assert from 'node:assert/strict';
import test from 'node:test';

const squadModule = await import('../../src/mindcraft/bot-squad-manager.js')
  .catch((loadError) => ({ loadError }));

function managerClass() {
  assert.ifError(squadModule.loadError);
  assert.equal(typeof squadModule.BotSquadManager, 'function');
  return squadModule.BotSquadManager;
}

function templateSettings(name = 'MindcraftBot') {
  return {
    profile: { name, model: 'ollama/qwen2.5:3b' },
    host: '127.0.0.1',
    port: 25578,
    minecraft_version: 'auto',
    load_memory: false,
  };
}

function createHarness(overrides = {}) {
  const BotSquadManager = managerClass();
  const created = [];
  const started = [];
  const stopped = [];
  const destroyed = [];
  const existing = new Set(['MindcraftBot']);
  const updates = [];
  const manager = new BotSquadManager({
    getAgentSettings: (name) => (name === 'MindcraftBot' ? templateSettings() : null),
    hasAgent: (name) => existing.has(name),
    normalizeSettings: (settings) => structuredClone(settings),
    createAgent: (settings) => {
      created.push(settings.profile.name);
      existing.add(settings.profile.name);
      return { success: true };
    },
    startAgent: (name) => {
      started.push(name);
      return { success: true };
    },
    stopAgent: (name) => {
      stopped.push(name);
      return { success: true };
    },
    destroyAgent: (name) => {
      destroyed.push(name);
      existing.delete(name);
      return { success: true };
    },
    sleep: () => Promise.resolve(),
    onUpdate: (squad) => updates.push(squad),
    ...overrides,
  });
  return {
    manager,
    created,
    started,
    stopped,
    destroyed,
    existing,
    updates,
  };
}

test('Given a valid template and size, when a squad launches, then names are reserved and members start with bounded staggering', async () => {
  const sleeps = [];
  const harness = createHarness({
    sleep: (milliseconds) => { sleeps.push(milliseconds); return Promise.resolve(); },
  });

  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Scout_',
    size: 3,
    staggerMs: 750,
  });
  assert.equal(launched.success, true);
  await harness.manager.waitForIdle(launched.squad.id);

  assert.deepEqual(harness.created, ['Scout_1', 'Scout_2', 'Scout_3']);
  assert.deepEqual(sleeps, [750, 750]);
  const squad = harness.manager.get(launched.squad.id);
  assert.equal(squad.state, 'running');
  assert.equal(squad.startedCount, 3);
  assert.equal(squad.failedCount, 0);
  assert.equal(JSON.stringify(squad).includes('ollama/qwen2.5:3b'), false);
});

test('Given invalid size, prefix, duplicate names, or total capacity, when launch is planned, then no bot starts', () => {
  const harness = createHarness({ maxSessionAgents: 2 });
  harness.existing.add('Taken_1');

  for (const spec of [
    { templateName: 'MindcraftBot', prefix: 'Scout_', size: 0, staggerMs: 500 },
    { templateName: 'MindcraftBot', prefix: '../bad', size: 2, staggerMs: 500 },
    { templateName: 'MindcraftBot', prefix: 'Taken_', size: 1, staggerMs: 500 },
    { templateName: 'MindcraftBot', prefix: 'Large_', size: 3, staggerMs: 500 },
  ]) {
    const result = harness.manager.launch(spec);
    assert.equal(result.success, false, JSON.stringify(spec));
  }
  assert.deepEqual(harness.created, []);
  assert.equal(harness.manager.list().length, 0);
});

test('Given stopped squads are retained as presets, when another squad launches or an old squad restarts, then only live bots count toward capacity', async () => {
  const harness = createHarness({ maxSessionAgents: 2 });
  const first = harness.manager.launch({ templateName: 'MindcraftBot', prefix: 'First_', size: 2, staggerMs: 500 });
  assert.equal(first.success, true);
  await harness.manager.waitForIdle(first.squad.id);
  assert.equal((await harness.manager.stop(first.squad.id)).success, true);

  const second = harness.manager.launch({ templateName: 'MindcraftBot', prefix: 'Second_', size: 2, staggerMs: 500 });
  assert.equal(second.success, true);
  await harness.manager.waitForIdle(second.squad.id);

  const restart = harness.manager.start(first.squad.id);
  assert.equal(restart.success, false);
  assert.match(restart.error, /live session limit/i);
});

test('Given one member fails, when the remaining launch is viable, then the squad continues and reports a partial result', async () => {
  const harness = createHarness({
    createAgent: (settings) => {
      harness.created.push(settings.profile.name);
      if (settings.profile.name === 'Build_2') return { success: false, error: 'spawn failed' };
      harness.existing.add(settings.profile.name);
      return { success: true };
    },
  });

  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Build_',
    size: 3,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);

  const squad = harness.manager.get(launched.squad.id);
  assert.deepEqual(harness.created, ['Build_1', 'Build_2', 'Build_3']);
  assert.equal(squad.state, 'partial');
  assert.equal(squad.startedCount, 2);
  assert.equal(squad.failedCount, 1);
  assert.equal(squad.members[1].error, 'spawn failed');
});

test('Given stop arrives during a stagger, when the launch loop resumes, then later members never start and only squad members are stopped', async () => {
  let releaseSleep;
  const sleepGate = new Promise((resolve) => { releaseSleep = resolve; });
  const harness = createHarness({
    sleep: () => sleepGate,
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Guard_',
    size: 3,
    staggerMs: 500,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const stopped = await harness.manager.stop(launched.squad.id);
  releaseSleep();
  await harness.manager.waitForIdle(launched.squad.id);

  assert.equal(stopped.success, true);
  assert.deepEqual(harness.created, ['Guard_1']);
  assert.deepEqual(harness.stopped, ['Guard_1']);
  assert.equal(harness.stopped.includes('MindcraftBot'), false);
  assert.equal(harness.manager.get(launched.squad.id).state, 'stopped');
});

test('Given stop arrives while one member is still being created, when creation settles, then that late member is contained and no later member starts', async () => {
  let releaseCreate;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  const harness = createHarness({
    createAgent: async (settings) => {
      harness.created.push(settings.profile.name);
      await createGate;
      harness.existing.add(settings.profile.name);
      return { success: true };
    },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Late_',
    size: 2,
    staggerMs: 500,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const stopping = harness.manager.stop(launched.squad.id);
  releaseCreate();
  await stopping;
  await harness.manager.waitForIdle(launched.squad.id);

  assert.deepEqual(harness.created, ['Late_1']);
  assert.deepEqual(harness.stopped, ['Late_1']);
  assert.equal(harness.manager.get(launched.squad.id).state, 'stopped');
});

test('Given a running squad, when removal is requested before an explicit stop, then live bots and reservations are preserved', async () => {
  const harness = createHarness();
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Live_',
    size: 2,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);

  const removed = await harness.manager.remove(launched.squad.id);

  assert.equal(removed.success, false);
  assert.match(removed.error, /stop/i);
  assert.deepEqual(harness.destroyed, []);
  assert.ok(harness.manager.get(launched.squad.id));
});

test('Given a stopped squad, when it is removed, then only recorded members are destroyed and capacity is released', async () => {
  const harness = createHarness({ maxSessionAgents: 2 });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Mine_',
    size: 2,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);
  await harness.manager.stop(launched.squad.id);

  const removed = await harness.manager.remove(launched.squad.id);
  const replacement = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Next_',
    size: 2,
    staggerMs: 500,
  });

  assert.equal(removed.success, true);
  assert.deepEqual(harness.destroyed, ['Mine_1', 'Mine_2']);
  assert.equal(harness.destroyed.includes('MindcraftBot'), false);
  assert.equal(harness.manager.get(launched.squad.id), null);
  assert.equal(replacement.success, true);
  await harness.manager.waitForIdle(replacement.squad.id);
});

test('Given a stopped squad, when it is started again, then only its existing members restart with bounded staggering', async () => {
  const sleeps = [];
  const harness = createHarness({
    sleep: (milliseconds) => { sleeps.push(milliseconds); return Promise.resolve(); },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Patrol_',
    size: 3,
    staggerMs: 650,
  });
  await harness.manager.waitForIdle(launched.squad.id);
  await harness.manager.stop(launched.squad.id);

  const restarted = harness.manager.start(launched.squad.id);
  assert.equal(restarted.success, true);
  await harness.manager.waitForIdle(launched.squad.id);

  assert.deepEqual(harness.started, ['Patrol_1', 'Patrol_2', 'Patrol_3']);
  assert.deepEqual(sleeps, [650, 650, 650, 650]);
  assert.equal(harness.manager.get(launched.squad.id).state, 'running');
  assert.equal(harness.started.includes('MindcraftBot'), false);
});

test('Given a settled failed squad retains one owner and loses another, when it retries, then retained and recreated members remain safe through stop, start, and removal', async () => {
  let initialLaunch = true;
  const recreatedSettings = [];
  const harness = createHarness({
    createAgent: (settings) => {
      const name = settings.profile.name;
      harness.created.push(name);
      if (initialLaunch) {
        if (name === 'Retry_1') harness.existing.add(name);
        return { success: false, error: `${name} readiness timeout` };
      }
      recreatedSettings.push(structuredClone(settings));
      harness.existing.add(name);
      return { success: true };
    },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Retry_',
    size: 2,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);
  assert.equal(harness.manager.get(launched.squad.id).state, 'failed');

  initialLaunch = false;
  const retried = harness.manager.start(launched.squad.id);
  assert.equal(retried.success, true);
  await harness.manager.waitForIdle(launched.squad.id);

  assert.deepEqual(harness.started, ['Retry_1']);
  assert.deepEqual(harness.created, ['Retry_1', 'Retry_2', 'Retry_2']);
  assert.equal(recreatedSettings[0].profile.name, 'Retry_2');
  assert.equal(recreatedSettings[0].profile.model, 'ollama/qwen2.5:3b');
  assert.equal(harness.manager.get(launched.squad.id).state, 'running');

  assert.equal((await harness.manager.stop(launched.squad.id)).success, true);
  assert.equal(harness.manager.start(launched.squad.id).success, true);
  await harness.manager.waitForIdle(launched.squad.id);
  assert.deepEqual(harness.started, ['Retry_1', 'Retry_1', 'Retry_2']);
  assert.equal((await harness.manager.stop(launched.squad.id)).success, true);
  assert.equal((await harness.manager.remove(launched.squad.id)).success, true);
  assert.deepEqual(harness.destroyed, ['Retry_1', 'Retry_2']);
  assert.equal(harness.manager.get(launched.squad.id), null);
  const replacement = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Retry_',
    size: 2,
    staggerMs: 500,
  });
  assert.equal(replacement.success, true);
  await harness.manager.waitForIdle(replacement.squad.id);
  await harness.manager.stop(replacement.squad.id);
  await harness.manager.remove(replacement.squad.id);
});

test('Given one member refuses to stop, when squad stop completes, then the group stays actionable and reports the exact cleanup failure', async () => {
  let failStop = true;
  const harness = createHarness({
    stopAgent: (name) => {
      harness.stopped.push(name);
      if (failStop && name === 'Sticky_2') return { success: false, error: 'still running' };
      return { success: true };
    },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Sticky_',
    size: 2,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);

  const firstStop = await harness.manager.stop(launched.squad.id);
  assert.equal(firstStop.success, false);
  assert.equal(harness.manager.get(launched.squad.id).state, 'partial');
  assert.match(firstStop.error, /Sticky_2/);

  failStop = false;
  const retry = await harness.manager.stop(launched.squad.id);
  assert.equal(retry.success, true);
  assert.equal(harness.manager.get(launched.squad.id).state, 'stopped');
});

test('Given one recorded member cannot be destroyed, when removal is requested, then the squad and its name reservations survive for a safe retry', async () => {
  let failDestroy = true;
  const harness = createHarness({
    destroyAgent: (name) => {
      harness.destroyed.push(name);
      if (failDestroy && name === 'Keep_2') return { success: false, error: 'finalization pending' };
      harness.existing.delete(name);
      return { success: true };
    },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Keep_',
    size: 2,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);
  await harness.manager.stop(launched.squad.id);

  const firstRemoval = await harness.manager.remove(launched.squad.id);
  assert.equal(firstRemoval.success, false);
  assert.ok(harness.manager.get(launched.squad.id));
  assert.equal(harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Keep_',
    size: 2,
    staggerMs: 500,
  }).success, false);

  failDestroy = false;
  const retry = await harness.manager.remove(launched.squad.id);
  assert.equal(retry.success, true);
  assert.equal(harness.manager.get(launched.squad.id), null);
});

test('Given agent destruction is accepted but finalization is pending, when a stopped squad is removed, then cleanup waits for the agent to disappear', async () => {
  let harness;
  let polls = 0;
  harness = createHarness({
    destroyAgent: () => ({
      success: false,
      pending: true,
      retryable: true,
      error: 'finalization pending',
    }),
    sleep: () => {
      polls += 1;
      harness.existing.delete('Wait_1');
      return Promise.resolve();
    },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Wait_',
    size: 1,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);
  await harness.manager.stop(launched.squad.id);

  const removal = await harness.manager.remove(launched.squad.id);

  assert.equal(removal.success, true);
  assert.equal(polls, 1);
  assert.equal(harness.manager.get(launched.squad.id), null);
});

test('Given several stopped members still need finalization, when a squad is removed, then every destruction is queued before the bounded wait begins', async () => {
  let harness;
  const destroyRequests = [];
  let requestsAtFirstPoll = null;
  let removing = false;
  harness = createHarness({
    destroyAgent: (name) => {
      destroyRequests.push(name);
      return {
        success: false,
        pending: true,
        retryable: true,
        error: 'finalization pending',
      };
    },
    sleep: () => {
      if (!removing) return Promise.resolve();
      requestsAtFirstPoll ??= [...destroyRequests];
      harness.existing.delete('Batch_1');
      harness.existing.delete('Batch_2');
      return Promise.resolve();
    },
  });
  const launched = harness.manager.launch({
    templateName: 'MindcraftBot',
    prefix: 'Batch_',
    size: 2,
    staggerMs: 500,
  });
  await harness.manager.waitForIdle(launched.squad.id);
  await harness.manager.stop(launched.squad.id);
  removing = true;

  const removal = await harness.manager.remove(launched.squad.id);

  assert.equal(removal.success, true);
  assert.deepEqual(requestsAtFirstPoll, ['Batch_1', 'Batch_2']);
  assert.equal(harness.manager.get(launched.squad.id), null);
});
