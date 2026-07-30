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
