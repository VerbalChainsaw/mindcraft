import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../tools/a0/aggregate.mjs';
import {
  FAMILIES,
  computeScenarioManifestHash,
  createExecutionPlan,
  createExecutionResult,
  createScenarioList,
  loadScenarioManifest,
  validateScenarioManifest,
} from '../../tools/scenario-lab.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = path.join(ROOT, 'tools', 'scenario-lab.mjs');

const clone = (value) => structuredClone(value);
const rehash = (manifest) => {
  manifest.manifestHash = computeScenarioManifestHash(manifest);
  return manifest;
};

async function withTempDirectory(fn) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scenario-lab-'));
  try {
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readyManifest(manifest) {
  const ready = clone(manifest);
  const scenario = ready.scenarios.find(({ id }) => id === 'doorway-corridor-follow');
  scenario.status = 'not-run';
  scenario.world.fixtureHash = 'a'.repeat(64);
  scenario.executor = {
    adapterId: 'synthetic-safe-adapter',
    safe: true,
    command: ['node', 'synthetic-safe-adapter.mjs'],
    evidenceAdapterId: 'a0-canonical-outcome-v1',
  };
  scenario.blockers = [];
  return rehash(ready);
}

test('the frozen v1 manifest validates with exactly the requested unavailable families', async () => {
  const manifest = await loadScenarioManifest();
  assert.equal(manifest.manifestHash, computeScenarioManifestHash(manifest));
  assert.deepEqual(validateScenarioManifest(manifest), []);
  assert.deepEqual(manifest.scenarios.map(({ family }) => family).sort(), [...FAMILIES]);
  assert.ok(manifest.scenarios.every(({ status, executor }) => (
    status === 'unavailable' && executor.safe === false && executor.adapterId === null
  )));
});

test('list ordering and canonical CLI JSON are stable', async () => {
  const listed = createScenarioList(await loadScenarioManifest());
  assert.deepEqual(listed.scenarios.map(({ id }) => id), listed.scenarios.map(({ id }) => id).sort());

  const first = spawnSync(globalThis.process.execPath, [CLI, 'list'], { cwd: ROOT, encoding: 'utf8' });
  const second = spawnSync(globalThis.process.execPath, [CLI, 'list'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout, `${canonicalJson(JSON.parse(first.stdout))}\n`);
});

test('plan emits stable unavailable plan/result artifacts and refuses overwrite', async () => {
  const scenarioId = 'doorway-corridor-follow';
  await withTempDirectory(async (firstDirectory) => {
    await withTempDirectory(async (secondDirectory) => {
      const args = (directory) => [
        CLI, 'plan', '--scenario', scenarioId, '--output-dir', directory,
      ];
      const first = spawnSync(globalThis.process.execPath, args(firstDirectory), { cwd: ROOT, encoding: 'utf8' });
      const second = spawnSync(globalThis.process.execPath, args(secondDirectory), { cwd: ROOT, encoding: 'utf8' });
      assert.equal(first.status, 3, first.stderr);
      assert.equal(second.status, 3, second.stderr);
      assert.equal(first.stdout, second.stdout);

      const planFile = `${scenarioId}.plan.v1.json`;
      const resultFile = `${scenarioId}.result.v1.json`;
      const [firstPlan, secondPlan, firstResult, secondResult] = await Promise.all([
        readFile(path.join(firstDirectory, planFile), 'utf8'),
        readFile(path.join(secondDirectory, planFile), 'utf8'),
        readFile(path.join(firstDirectory, resultFile), 'utf8'),
        readFile(path.join(secondDirectory, resultFile), 'utf8'),
      ]);
      assert.equal(firstPlan, secondPlan);
      assert.equal(firstResult, secondResult);
      assert.equal(firstPlan, `${canonicalJson(JSON.parse(firstPlan))}\n`);
      assert.equal(firstResult, `${canonicalJson(JSON.parse(firstResult))}\n`);
      const result = JSON.parse(firstResult);
      assert.equal(result.status, 'unavailable');
      assert.equal(result.success, null);
      assert.equal(result.liveScenarioPassed, false);
      assert.equal(result.labComplete, false);

      const repeated = spawnSync(globalThis.process.execPath, args(firstDirectory), { cwd: ROOT, encoding: 'utf8' });
      assert.equal(repeated.status, 2);
      assert.equal(JSON.parse(repeated.stdout).diagnostics[0].code, 'artifact-exists');
    });
  });
});

test('schema version and closed object violations are rejected', async () => {
  const manifest = await loadScenarioManifest();
  const version = rehash({ ...clone(manifest), schemaVersion: 'scenario-lab.manifest.v2' });
  assert.ok(validateScenarioManifest(version).some(({ path: itemPath, code }) => (
    itemPath === '/schemaVersion' && code === 'const'
  )));
  const additional = rehash({ ...clone(manifest), unexpected: true });
  assert.ok(validateScenarioManifest(additional).some(({ path: itemPath, code }) => (
    itemPath === '/unexpected' && code === 'additional-property'
  )));
});

test('duplicate scenario IDs are rejected', async () => {
  const duplicate = clone(await loadScenarioManifest());
  duplicate.scenarios[1].id = duplicate.scenarios[0].id;
  rehash(duplicate);
  assert.ok(validateScenarioManifest(duplicate).some(({ code }) => code === 'duplicate-id'));
});

test('invalid seed, timeout, and repetitions are rejected', async (t) => {
  const manifest = await loadScenarioManifest();
  for (const [name, mutate, expectedPath, expectedCode] of [
    ['seed', (value) => { value.scenarios[0].seed = '104729'; }, '/scenarios/0/seed', 'type'],
    ['timeout', (value) => { value.scenarios[0].timeoutMs = 0; }, '/scenarios/0/timeoutMs', 'bounds'],
    ['repetitions', (value) => { value.scenarios[0].requestForms[0].repetitions = 0; }, '/scenarios/0/requestForms/0/repetitions', 'bounds'],
  ]) {
    await t.test(name, () => {
      const invalid = clone(manifest);
      mutate(invalid);
      rehash(invalid);
      assert.ok(validateScenarioManifest(invalid).some(({ path: itemPath, code }) => (
        itemPath === expectedPath && code === expectedCode
      )));
    });
  }
});

test('an unavailable adapter cannot be declared ready', async () => {
  const invalid = clone(await loadScenarioManifest());
  invalid.scenarios[0].status = 'not-run';
  rehash(invalid);
  const diagnostics = validateScenarioManifest(invalid);
  assert.ok(diagnostics.some(({ path: itemPath, code }) => itemPath.endsWith('/executor/adapterId') && code === 'relationship'));
  assert.ok(diagnostics.some(({ path: itemPath, code }) => itemPath.endsWith('/world/fixtureHash') && code === 'relationship'));
});

test('missing evidence, safety reporting, or outcome facts have zero false-pass paths', async () => {
  const manifest = readyManifest(await loadScenarioManifest());
  assert.deepEqual(validateScenarioManifest(manifest), []);
  const scenarioId = 'doorway-corridor-follow';
  const plan = createExecutionPlan(manifest, scenarioId);
  const complete = {
    executed: true,
    completedInvocationCount: plan.invocations.length,
    observedEvidence: plan.expectedEvidence,
    safetyInvariantViolations: [],
    success: true,
    unsafe: false,
    death: false,
    conflict: false,
    timeout: false,
    retryCount: 0,
    terminalReason: 'completed',
    elapsedMs: 10,
  };

  for (const observation of [
    { ...complete, observedEvidence: plan.expectedEvidence.slice(1) },
    { ...complete, safetyInvariantViolations: undefined },
    { ...complete, unsafe: undefined },
  ]) {
    const result = createExecutionResult(manifest, scenarioId, observation);
    assert.equal(result.status, 'failed');
    assert.equal(result.liveScenarioPassed, false);
  }

  const unavailable = await loadScenarioManifest();
  const forged = createExecutionResult(unavailable, scenarioId, complete);
  assert.equal(forged.status, 'unavailable');
  assert.equal(forged.success, null);
  assert.equal(forged.liveScenarioPassed, false);
});
