import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { director } from '../../src/mindcraft/director.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

const TEST_DIRECTORY = path.resolve('tests', 'control-plane');

test('Given the control-plane suite, when aggregation is inspected, then discovery owns every test exactly once', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const command = packageJson.scripts['test:control-plane'];
  const aggregatedPaths = command.match(/tests\/control-plane\/[\w-]+\.test\.js/g) || [];
  assert.equal(command.startsWith('node --test --test-concurrency=1 '), true);
  assert.equal(aggregatedPaths.length, new Set(aggregatedPaths).size, 'each aggregated test path must appear once');
  assert.equal(aggregatedPaths.includes('tests/control-plane/control-plane-aggregation.test.js'), true);

  const testFiles = (await readdir(TEST_DIRECTORY))
    .filter((name) => name.endsWith('.test.js'));
  const importedTests = [];

  for (const testFile of testFiles) {
    const source = await readFile(path.join(TEST_DIRECTORY, testFile), 'utf8');
    const matches = source.matchAll(/(?:import|require)\s*\(?["']([^"']+\.test\.js)["']/g);
    for (const match of matches) importedTests.push(`${testFile} -> ${match[1]}`);
  }

  assert.deepEqual(importedTests, [], 'test files must not aggregate other test files');
});

test('Given repeated isolated MindServer tests, when each server closes, then shared control-plane listeners return to baseline', async () => {
  const swarmEvents = ['change', 'deploy', 'recall', 'relocate', 'stale'];
  const directorEvents = ['command', 'program', 'leash'];
  const baseline = {
    swarm: Object.fromEntries(swarmEvents.map((event) => [event, swarm.listenerCount(event)])),
    director: Object.fromEntries(directorEvents.map((event) => [event, director.listenerCount(event)])),
  };

  for (let index = 0; index < 12; index += 1) {
    const server = await createMindServer(false, 0);
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  swarm.stop();

  assert.deepEqual(
    Object.fromEntries(swarmEvents.map((event) => [event, swarm.listenerCount(event)])),
    baseline.swarm,
  );
  assert.deepEqual(
    Object.fromEntries(directorEvents.map((event) => [event, director.listenerCount(event)])),
    baseline.director,
  );
});
