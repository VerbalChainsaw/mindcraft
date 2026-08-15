import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CompanionContext } from '../../src/agent/runtime/companion-context.js';
import { CompanionDirectiveStateStore } from '../../src/agent/runtime/companion-directive-state.js';

function fixture(directiveState) {
  const human = {
    type: 'player',
    username: '.LittleBubby9352',
    id: 7,
    position: { x: 2, y: 64, z: 0 },
  };
  const bot = {
    username: 'PersistBot',
    game: { dimension: 'overworld' },
    players: { '.LittleBubby9352': { username: '.LittleBubby9352', entity: human } },
    entities: { 7: human },
  };
  const agent = {
    name: 'PersistBot',
    bot,
    runtime: { role: 'companion', autonomy: 'command' },
    isOperatorHeld: () => false,
    getKnownAgentNames: () => ['PersistBot'],
  };
  const context = new CompanionContext(agent, { directiveState });
  agent.companion_context = context;
  return { agent, bot, context };
}

test('standing guard survives restart, preserves Floodgate identity, and rebinds an already-loaded player', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-companion-directive-'));
  try {
    const firstStore = new CompanionDirectiveStateStore('PersistBot', { root });
    const first = fixture(firstStore);
    first.context.setDirective('guard', 'LittleBubby9352');
    assert.deepEqual(firstStore.snapshot(), {
      directive: 'guard',
      requestedName: 'LittleBubby9352',
      canonicalUsername: '.LittleBubby9352',
      authorizedAt: firstStore.snapshot().authorizedAt,
      updatedAt: firstStore.snapshot().updatedAt,
      error: null,
    });
    assert.equal(Number.isFinite(first.context.snapshot().directiveAuthorizedAt), true);

    const restartedStore = new CompanionDirectiveStateStore('PersistBot', { root });
    const restarted = fixture(restartedStore);
    assert.equal(restarted.context.snapshot().directive, 'guard');
    assert.equal(restarted.context.snapshot().presence, 'absent');

    restarted.context.reconcileLoadedPlayer({ dimension: 'overworld' });
    assert.equal(restarted.context.snapshot().presence, 'present');
    assert.equal(restarted.context.snapshot().canonicalUsername, '.LittleBubby9352');
    assert.equal(restarted.context.resumeCommand(), '!guardPlayer(".LittleBubby9352", 3)');

    restarted.context.clearControl();
    const cleared = fixture(new CompanionDirectiveStateStore('PersistBot', { root }));
    assert.equal(cleared.context.snapshot().directive, null);
    assert.equal(cleared.context.snapshot().requestedName, null);
    assert.equal(cleared.context.snapshot().canonicalUsername, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('damaged standing-directive state fails closed without guessing authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-companion-directive-corrupt-'));
  try {
    const store = new CompanionDirectiveStateStore('PersistBot', { root });
    await writeFile(store.filePath, '{"version":1,"directive":"guard",', 'utf8');

    const damaged = new CompanionDirectiveStateStore('PersistBot', { root });
    assert.equal(damaged.snapshot().directive, null);
    assert.equal(damaged.snapshot().requestedName, null);
    assert.match(damaged.snapshot().error, /JSON/);
    const context = fixture(damaged).context;
    assert.equal(context.resumeCommand(), null);
    assert.equal(context.snapshot().directivePersistence.status, 'error');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a standing action is not admitted when its durable authority cannot be written', () => {
  const state = {
    snapshot: () => ({
      directive: null,
      requestedName: null,
      canonicalUsername: null,
      authorizedAt: null,
      updatedAt: null,
      error: null,
    }),
    persist: () => { throw new Error('disk unavailable'); },
    clear: () => { throw new Error('disk unavailable'); },
  };
  const { context } = fixture(state);

  assert.throws(() => context.setDirective('follow', 'LittleBubby9352'), /disk unavailable/);
  assert.equal(context.snapshot().directive, null);
  assert.equal(context.snapshot().requestedName, null);
  assert.equal(context.snapshot().canonicalUsername, null);
  assert.equal(context.snapshot().directivePersistence.status, 'error');
});
