import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JobStateStore } from '../../src/agent/runtime/job-state-store.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Given one active order, JobStateStore atomically roundtrips normalized restart state', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-job-store-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const store = new JobStateStore('Builder_1', { root });
  const order = createWorkOrder({
    id: 'build-1',
    role: 'builder',
    kind: 'stockpile',
    target: { name: 'oak_log' },
    quota: 32,
  });

  store.save(order);
  const loaded = store.load();

  assert.deepEqual(loaded, order);
  const raw = JSON.parse(await readFile(path.join(root, 'Builder_1', 'job-state.json'), 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.activeOrder.id, 'build-1');
});

test('Given corrupt persisted state, load preserves the corrupt file and fails closed', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-job-store-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const store = new JobStateStore('Miner_1', { root });
  await writeFile(store.filePath, '{not-json', 'utf8');

  assert.equal(store.load(), null);
  assert.equal(await readFile(store.filePath, 'utf8'), '{not-json');
  assert.match(store.lastError, /parse|json/i);
});

test('Given unsafe bot names or incompatible versions, store access is rejected or ignored', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-job-store-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  assert.throws(() => new JobStateStore('../escape', { root }), /name/i);

  const store = new JobStateStore('Logger_1', { root });
  await writeFile(store.filePath, JSON.stringify({ version: 99, activeOrder: null }), 'utf8');
  assert.equal(store.load(), null);
  assert.match(store.lastError, /version/i);
});
