import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MemoryBank } from '../src/agent/memory_bank.js';

test('death position and pre-death inventory survive reload until verified recovery', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-death-memory-'));
  try {
    const memory = new MemoryBank('RecoveryBot', { rootDir });
    memory.load();
    assert.equal(memory.rememberDeath(
      { x: 12.5, y: 64, z: -8.5 },
      'overworld',
      { echo_shard: 1, gold_ingot: 5 },
    ), true);

    const reloaded = new MemoryBank('RecoveryBot', { rootDir });
    reloaded.load();
    assert.deepEqual(reloaded.recallDeath(), {
      position: { x: 12.5, y: 64, z: -8.5 },
      dimension: 'overworld',
      inventory: { echo_shard: 1, gold_ingot: 5 },
      recordedAt: reloaded.recallDeath().recordedAt,
      recoveredAt: null,
    });

    assert.equal(reloaded.markDeathRecovered({ recovered: 6 }), true);
    const recovered = new MemoryBank('RecoveryBot', { rootDir });
    recovered.load();
    assert.equal(Number.isFinite(recovered.recallDeath().recoveredAt), true);
    assert.match(recovered.recallFact('death_recovery_verified'), /"recovered":6/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('an empty second death does not erase an unresolved non-empty recovery site', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-death-memory-'));
  try {
    const memory = new MemoryBank('RecoveryBot', { rootDir });
    memory.load();
    assert.equal(memory.rememberDeath(
      { x: 12.5, y: 64, z: -8.5 },
      'overworld',
      { raw_iron: 5, stone_pickaxe: 2 },
    ), true);

    assert.equal(memory.rememberDeath(
      { x: 30.5, y: 70, z: 4.5 },
      'overworld',
      {},
    ), true);

    const reloaded = new MemoryBank('RecoveryBot', { rootDir });
    reloaded.load();
    assert.deepEqual(reloaded.recallDeath(), {
      position: { x: 12.5, y: 64, z: -8.5 },
      dimension: 'overworld',
      inventory: { raw_iron: 5, stone_pickaxe: 2 },
      recordedAt: reloaded.recallDeath().recordedAt,
      recoveredAt: null,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('distinct non-empty deaths remain queued until each site is verified', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-death-memory-'));
  try {
    const memory = new MemoryBank('RecoveryBot', { rootDir });
    memory.load();
    assert.equal(memory.rememberDeath(
      { x: 12.5, y: 64, z: -8.5 },
      'overworld',
      { raw_iron: 5, stone_pickaxe: 2 },
    ), true);
    assert.equal(memory.rememberDeath(
      { x: 30.5, y: 70, z: 4.5 },
      'overworld',
      { spruce_log: 1 },
    ), true);

    const firstReload = new MemoryBank('RecoveryBot', { rootDir });
    firstReload.load();
    assert.deepEqual(firstReload.recallDeath(), {
      position: { x: 12.5, y: 64, z: -8.5 },
      dimension: 'overworld',
      inventory: { raw_iron: 5, stone_pickaxe: 2 },
      recordedAt: firstReload.recallDeath().recordedAt,
      recoveredAt: null,
    });
    assert.equal(firstReload.markDeathRecovered({ recovered: 7 }), true);

    const secondReload = new MemoryBank('RecoveryBot', { rootDir });
    secondReload.load();
    assert.deepEqual(secondReload.recallDeath(), {
      position: { x: 30.5, y: 70, z: 4.5 },
      dimension: 'overworld',
      inventory: { spruce_log: 1 },
      recordedAt: secondReload.recallDeath().recordedAt,
      recoveredAt: null,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('a full ledger admits the newest death and durably receipts the displaced oldest obligation', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-death-memory-'));
  try {
    const memory = new MemoryBank('RecoveryBot', { rootDir });
    memory.load();
    const recorded = [];
    for (let index = 0; index < 8; index += 1) {
      const result = memory.recordDeath(
        { x: index + 0.5, y: 64, z: index + 0.5 },
        'overworld',
        { spruce_log: index + 1 },
      );
      assert.equal(result.stored, true);
      recorded.push(result.record);
    }

    const current = memory.recordDeath(
      { x: 8098.37, y: 58, z: 7943.45 },
      'overworld',
      { stone_pickaxe: 1, wooden_sword: 1 },
    );
    assert.equal(current.stored, true);
    assert.equal(current.code, 'death_recorded_after_capacity_displacement');
    assert.equal(current.pending, 8);
    assert.equal(current.displacedRecordedAt, recorded[0].recordedAt);
    assert.equal(current.displacementCode, 'death_recovery_capacity_displaced');
    assert.deepEqual(memory.recallLatestDeath(), current.record);
    assert.equal(memory.recallDeath().recordedAt, recorded[1].recordedAt);

    const ledger = memory.personal.recallDeathRecoveryLedger();
    assert.equal(ledger.lastDisplaced.recordedAt, recorded[0].recordedAt);
    assert.equal(ledger.lastDisplaced.displacementCode, 'death_recovery_capacity_displaced');

    const reloaded = new MemoryBank('RecoveryBot', { rootDir });
    reloaded.load();
    assert.deepEqual(reloaded.recallLatestDeath(), current.record);
    assert.equal(reloaded.markDeathRecovered({ recovered: 2 }, current.record.recordedAt), true);
    assert.equal(reloaded.recallLatestDeath().recordedAt, recorded[7].recordedAt);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('a legacy unresolved manifest seeds the ledger before a later death', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-death-memory-'));
  try {
    const memory = new MemoryBank('RecoveryBot', { rootDir });
    memory.load();
    assert.equal(memory.rememberPlace(
      'last_death_position',
      12.5,
      64,
      -8.5,
      'overworld',
    ), true);
    assert.equal(memory.rememberFact('last_death_manifest', JSON.stringify({
      dimension: 'overworld',
      inventory: { raw_iron: 5, stone_pickaxe: 2 },
      recordedAt: 12345,
      recoveredAt: null,
    })), true);

    assert.equal(memory.rememberDeath(
      { x: 30.5, y: 70, z: 4.5 },
      'overworld',
      { spruce_log: 1 },
    ), true);
    assert.deepEqual(memory.recallDeath(), {
      position: { x: 12.5, y: 64, z: -8.5 },
      dimension: 'overworld',
      inventory: { raw_iron: 5, stone_pickaxe: 2 },
      recordedAt: 12345,
      recoveredAt: null,
    });
    assert.equal(memory.markDeathRecovered({ recovered: 7 }), true);

    const reloaded = new MemoryBank('RecoveryBot', { rootDir });
    reloaded.load();
    assert.deepEqual(reloaded.recallDeath(), {
      position: { x: 30.5, y: 70, z: 4.5 },
      dimension: 'overworld',
      inventory: { spruce_log: 1 },
      recordedAt: reloaded.recallDeath().recordedAt,
      recoveredAt: null,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
