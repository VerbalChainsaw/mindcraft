import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { History } from '../../src/agent/history.js';
import { writeJsonAtomicSync } from '../../src/utils/atomic-file.js';

test('Given bot memory and history, when state is persisted, then canonical JSON stays complete and history appends without whole-file rewrites', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-bot-data-'));
  const previousDirectory = process.cwd();
  process.chdir(root);
  try {
    const agent = {
      name: 'DataBot',
      last_sender: null,
      self_prompter: {
        state: 0,
        isStopped: () => true,
        prompt: null,
      },
      task: { taskStartTime: null },
      operator_hold_reason: 'operator stop command',
      isOperatorHeld: () => true,
    };
    const history = new History(agent);
    await history.appendFullHistory([{ role: 'user', content: 'first' }]);
    await history.appendFullHistory([{ role: 'assistant', content: 'second' }]);
    await history.save();

    const historyFiles = await readdir(path.join(root, 'bots', 'DataBot', 'histories'));
    assert.equal(historyFiles.length, 1);
    assert.match(historyFiles[0], /\.jsonl$/);
    const records = (await readFile(
      path.join(root, 'bots', 'DataBot', 'histories', historyFiles[0]),
      'utf8',
    )).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(records, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
    const persistedMemory = JSON.parse(await readFile(
      path.join(root, 'bots', 'DataBot', 'memory.json'),
      'utf8',
    ));
    assert.equal(persistedMemory.memory, '');
    assert.equal(persistedMemory.operator_hold, true);
    assert.equal(persistedMemory.operator_hold_reason, 'operator stop command');

    const restoredMemory = history.load();
    assert.equal(restoredMemory.operator_hold, true);
    assert.equal(restoredMemory.operator_hold_reason, 'operator stop command');

    const canonical = path.join(root, 'canonical.json');
    writeJsonAtomicSync(canonical, { version: 1 });
    assert.throws(() => writeJsonAtomicSync(canonical, { invalid: 1n }), /BigInt/);
    assert.deepEqual(JSON.parse(await readFile(canonical, 'utf8')), { version: 1 });
  } finally {
    process.chdir(previousDirectory);
    await rm(root, { recursive: true, force: true });
  }
});

test('Given malformed bot memory, when an agent loads, then the bad file is preserved and the bot can start with clean memory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mindcraft-bot-data-corrupt-'));
  const previousDirectory = process.cwd();
  process.chdir(root);
  try {
    const agent = {
      name: 'RecoveryBot',
      last_sender: null,
      self_prompter: {
        state: 'stopped',
        isStopped: () => true,
        prompt: null,
      },
      task: { taskStartTime: null },
    };
    const history = new History(agent);
    await writeFile(history.memory_fp, '{"turns":[', 'utf8');

    assert.equal(history.load(), null);
    assert.deepEqual(history.turns, []);
    assert.equal(history.memory, '');
    const botFiles = await readdir(path.join(root, 'bots', 'RecoveryBot'));
    assert.equal(botFiles.includes('memory.json'), false);
    assert.equal(botFiles.some((name) => /^memory\.corrupt-\d+\.json$/.test(name)), true);
  } finally {
    process.chdir(previousDirectory);
    await rm(root, { recursive: true, force: true });
  }
});
