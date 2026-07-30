import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HomeStateStore } from '../../src/agent/runtime/home-state-store.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Given verified home gameplay state, HomeStateStore persists and restores it without expanding telemetry', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-home-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new HomeStateStore('HomeBot', { root });
  store.rememberHome({ x: 4.8, y: 64, z: -3.2 }, 'minecraft:overworld');
  store.rememberFarm({
    dimension: 'overworld',
    crop: 'wheat',
    seed: 'wheat_seeds',
    water: { x: 8, y: 63, z: 8 },
    cells: [{ x: 7, y: 63, z: 8 }, { x: 7, y: 63, z: 9 }],
  });
  store.rememberStructure(createWorkOrder({
    id: 'remembered-room',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'player',
    target: { name: 'worksite', x: 10, y: 64, z: 10 },
    quota: 1,
    blueprint: {
      id: 'one_block',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'stone' }],
    },
  }));

  const restored = new HomeStateStore('HomeBot', { root });
  assert.deepEqual(restored.snapshot().home, {
    x: 4,
    y: 64,
    z: -4,
    dimension: 'overworld',
    updatedAt: restored.snapshot().home.updatedAt,
  });
  assert.equal(restored.snapshot().farm.cells.length, 2);
  assert.equal(restored.snapshot().structureOrder.id, 'remembered-room');
  assert.deepEqual(restored.telemetry().farm, {
    dimension: 'overworld',
    crop: 'wheat',
    seed: 'wheat_seeds',
    water: { x: 8, y: 63, z: 8 },
    cellCount: 2,
    updatedAt: restored.snapshot().farm.updatedAt,
  });
  assert.deepEqual(restored.telemetry().structure.blueprint, {
    id: 'one_block',
    cellCount: 1,
  });
});

test('Given corrupt home state, HomeStateStore reports the handoff error and preserves the file', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-home-state-corrupt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new HomeStateStore('HomeBot', { root });
  writeFileSync(store.filePath, '{broken', 'utf8');

  store.load();

  assert.match(store.lastError, /JSON/);
  assert.equal(readFileSync(store.filePath, 'utf8'), '{broken');
});
