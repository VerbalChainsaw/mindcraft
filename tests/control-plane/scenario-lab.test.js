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
import {
  aggregateFollowFieldObservations,
  observeFollowFieldRun,
} from '../../tools/scenario-lab/adapters/follow-field-evidence.mjs';
import {
  aggregateStoneRecoveryObservations,
  observeStoneRecoveryRun,
} from '../../tools/scenario-lab/adapters/stone-recovery-evidence.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = path.join(ROOT, 'tools', 'scenario-lab.mjs');
const STONE_WORKER = path.join(ROOT, 'tools', 'scenario-lab', 'adapters', 'stone-recovery-worker.ps1');
const FOLLOW_WORKER = path.join(ROOT, 'tools', 'scenario-lab', 'adapters', 'follow-field-worker.ps1');
const FOLLOW_RUNNER = path.join(ROOT, 'tools', 'scenario-lab', 'adapters', 'run-follow-field.mjs');
const FOLLOW_HARNESS = path.join(ROOT, 'tools', 'verify-follow-field.mjs');

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

test('the frozen v1 manifest registers two bounded replays and keeps other families unavailable', async () => {
  const manifest = await loadScenarioManifest();
  assert.equal(manifest.manifestHash, computeScenarioManifestHash(manifest));
  assert.deepEqual(validateScenarioManifest(manifest), []);
  assert.deepEqual(manifest.scenarios.map(({ family }) => family).sort(), [...FAMILIES]);
  assert.equal(manifest.manifestRevision, 'release-0.1.v7');
  assert.equal(manifest.candidateCommit, 'b47117b373a36d894e8ca9df740ae2ced0493913');

  const stone = manifest.scenarios.find(({ id }) => (
    id === 'autonomous-wood-to-stone-no-safe-stance-recovery'
  ));
  assert.equal(stone.status, 'not-run');
  assert.equal(stone.executor.safe, true);
  assert.equal(stone.world.fixtureHash.length, 64);
  assert.equal(stone.seed, '8781215452871762684');

  const follow = manifest.scenarios.find(({ id }) => id === 'doorway-corridor-follow');
  assert.equal(follow.status, 'not-run');
  assert.equal(follow.executor.safe, true);
  assert.equal(follow.executor.adapterId, 'follow-field-live-replay-v1');
  assert.equal(follow.executor.evidenceAdapterId, 'follow-field-evidence-v1');
  assert.equal(follow.world.fixtureHash, 'be49ccbd9115e34ccd3ea6b0958302fa7c794709dfdcc6b379d06fba31a026b8');
  assert.equal(follow.seed, '3579780610592225162');
  assert.equal(follow.requestForms[0].request, '!followPlayer("FollowTarget", 3)');
  assert.equal(follow.requestForms[1].request, 'Follow me through the doorway and down the corridor.');

  const registered = new Set([stone.id, follow.id]);
  assert.ok(manifest.scenarios
    .filter(({ id }) => !registered.has(id))
    .every(({ status, executor }) => (
      status === 'unavailable' && executor.safe === false && executor.adapterId === null
    )));
});

test('live workers require portable provenance and one managed-runtime lock', async () => {
  const [stoneWorker, followWorker, followRunner, followHarness] = await Promise.all([
    readFile(STONE_WORKER, 'utf8'),
    readFile(FOLLOW_WORKER, 'utf8'),
    readFile(FOLLOW_RUNNER, 'utf8'),
    readFile(FOLLOW_HARNESS, 'utf8'),
  ]);
  const userDirectoryPattern = new RegExp('[A-Za-z]:\\\\Users\\\\', 'i');
  assert.doesNotMatch(stoneWorker, userDirectoryPattern);
  assert.doesNotMatch(followWorker, userDirectoryPattern);
  assert.match(stoneWorker, /SCENARIO_LAB_STONE_FIXTURE_ROOT/);
  assert.match(followWorker, /SCENARIO_LAB_FOLLOW_FIXTURE_ROOT/);
  assert.match(stoneWorker, /scenario-lab-managed-runtime\.active/);
  assert.match(followWorker, /scenario-lab-managed-runtime\.active/);
  assert.match(followWorker, /candidate_blob_checks/);
  assert.match(followWorker, /src\/agent\/player-directives\.js/);
  assert.match(followWorker, /tools\/scenario-lab\/adapters\/follow-field-evidence\.mjs/);
  assert.match(followWorker, /"--path=\$relativePath"/);
  assert.match(followRunner, /taskkill\.exe/);
  assert.match(followRunner, /'-InstrumentationMode', plan\.instrumentationMode/);
  assert.match(followWorker, /\[ValidateSet\('off', 'on'\)\]/);
  assert.match(followWorker, /decision_trace = \[ordered\]@\{/);
  assert.match(followWorker, /observed_decision_trace_present/);
  assert.match(followRunner, /processResult\.exitCode !== 0/);
  assert.match(followWorker, /function ConvertTo-ProcessArgument/);
  assert.match(followWorker, /System\.Diagnostics\.ProcessStartInfo/);
  assert.match(followWorker, /ReadToEndAsync\(\)/);
  assert.match(followWorker, /WaitForExit\(\$TimeoutMs\)/);
  assert.match(followWorker, /\$harnessExitCode = \$harnessProcess\.ExitCode/);
  assert.doesNotMatch(followWorker, /Start-Process -FilePath \$nodePath -ArgumentList \$harnessArgs/);
  assert.match(followHarness, /--request-file/);
  assert.match(followHarness, /doorway-corridor/);
  assert.match(followHarness, /target\.chat\(options\.requestMessage\)/);
  assert.match(followHarness, /sendMessage\(options\.requestMessage\)/);
  assert.match(followHarness, /actuatorVelocityIsSettled/);
  assert.match(followHarness, /settled stop anchor/);
  assert.match(followHarness, /settledAt/);
  assert.match(followHarness, /settlingMs/);
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
  const scenarioId = 'elevation-follow';
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
    ['seed', (value) => { value.scenarios[0].seed = 'not-a-seed'; }, '/scenarios/0/seed', 'type'],
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
  const scenario = invalid.scenarios.find(({ status }) => status === 'unavailable');
  scenario.status = 'not-run';
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

  const unavailable = clone(manifest);
  const unavailableScenario = unavailable.scenarios.find(({ id }) => id === scenarioId);
  unavailableScenario.status = 'unavailable';
  unavailableScenario.world.fixtureHash = null;
  unavailableScenario.executor = {
    adapterId: null,
    safe: false,
    command: null,
    evidenceAdapterId: null,
  };
  unavailableScenario.blockers = [{
    code: 'safe-executor-unavailable',
    detail: 'Synthetic negative fixture has no executor.',
  }];
  rehash(unavailable);
  assert.deepEqual(validateScenarioManifest(unavailable), []);
  const forged = createExecutionResult(unavailable, scenarioId, complete);
  assert.equal(forged.status, 'unavailable');
  assert.equal(forged.success, null);
  assert.equal(forged.liveScenarioPassed, false);
});

test('signed 64-bit Minecraft seed strings are accepted without precision loss', async () => {
  const manifest = clone(await loadScenarioManifest());
  manifest.scenarios[1].seed = '-9223372036854775808';
  rehash(manifest);
  assert.ok(!validateScenarioManifest(manifest).some(({ path: itemPath }) => (
    itemPath === '/scenarios/1/seed'
  )));

  manifest.scenarios[1].seed = '9223372036854775808';
  rehash(manifest);
  assert.ok(validateScenarioManifest(manifest).some(({ path: itemPath, code }) => (
    itemPath === '/scenarios/1/seed' && code === 'bounds'
  )));
});

test('stone-recovery evidence requires physical success and the declared request route', async () => {
  const manifest = await loadScenarioManifest();
  const scenarioId = 'autonomous-wood-to-stone-no-safe-stance-recovery';
  const plan = createExecutionPlan(manifest, scenarioId);

  const makeRun = (form, routeOrigin) => {
    const actionId = `action-${form}`;
    const report = {
      request_form: form,
      fixture_authorized: true,
      status: 'passed',
      finished_utc: '2026-08-03T00:00:01.000Z',
      before: {
        inventory: { wooden_pickaxe: 1 },
        health: 20,
      },
      final: {
        inventory: { wooden_pickaxe: 1, stone_pickaxe: 1 },
        main_hand: 'stone_pickaxe',
        health: 20,
      },
      verdict: {
        passed: true,
        duration_ms: 35000,
        external_retry_count: 0,
        false_success_observed: false,
        terminal_result: {
          actionId,
          phase: 'succeeded',
          code: 'skill_prepared',
          label: 'action:prepareTool',
          detail: 'no_safe_stance:12; opening a bounded mining route (attempt 1/3).',
        },
      },
      cleanup: {
        configuration_restored: true,
        properties_restored: true,
        pre_run_memory_restored: true,
        remaining_managed_java: [],
        errors: [],
      },
    };
    const samples = [{
      action: {
        behaviorArbiter: {
          decisionTrace: {
            recent: [{
              correlation: {
                actionId,
                requestId: `request-${form}`,
                routeOrigin,
                selectedSkill: '!prepareTool',
                args: ['stone_pickaxe'],
              },
            }],
          },
        },
      },
    }];
    return observeStoneRecoveryRun(report, samples, plan.timeoutMs);
  };

  const direct = makeRun('direct', 'explicit-command');
  const naturalLanguage = makeRun('natural-language', 'deterministic-nl');
  assert.equal(direct.success, true);
  assert.equal(naturalLanguage.success, true);

  const observation = aggregateStoneRecoveryObservations(plan, [direct, naturalLanguage]);
  const result = createExecutionResult(manifest, scenarioId, observation);
  assert.equal(result.status, 'passed');
  assert.equal(result.evidenceCompleteness, 'complete');
  assert.equal(result.liveScenarioPassed, true);

  const modelRouted = makeRun('natural-language', 'model-selected');
  assert.equal(modelRouted.success, false);
  assert.ok(modelRouted.safetyInvariantViolations.includes('deterministic-local-request-route'));
});

test('follow-field evidence requires correlated physical completion and quiescence', async () => {
  const manifest = readyManifest(await loadScenarioManifest());
  const scenarioId = 'doorway-corridor-follow';
  const plan = createExecutionPlan(manifest, scenarioId);

  const makeRun = (form, routeOrigin, {
    doorwayCrossed = true,
    healthObserved = true,
    terminalFinishedAt = 26000,
    botTrajectoryDistance = 12,
    quiescenceMs = 100,
    observedDecisionTracePresent = false,
    instrumentationVerified = true,
  } = {}) => {
    const actionId = 'action-' + form;
    const issuedAt = 1000;
    const attempt = {
      attempt: 1,
      issuedAt,
      activeAt: issuedAt + 25,
      commandAck: { success: true },
      terminal: {
        actionId,
        phase: 'interrupted',
        code: 'interrupted',
        label: 'action:followPlayer',
        startedAt: issuedAt + 5,
        finishedAt: terminalFinishedAt,
        evidence: {
          request: {
            requestId: 'request-' + form,
            routeOrigin,
            selectedSkill: '!followPlayer',
            args: ['FollowTarget', 3],
            requestedAt: issuedAt,
          },
        },
      },
      traces: [],
      samples: healthObserved ? [{ health: 20 }] : [],
      performance: {
        botTrajectoryDistance,
        targetTrajectoryDistance: 16,
      },
      physicalAcceptance: {
        course: 'doorway-corridor',
        fixtureVerified: true,
        doorwayCrossed,
        doorwayObservation: {
          position: doorwayCrossed ? { x: 1033, y: 100, z: 1008.5 } : null,
        },
        corridorCompleted: true,
        finalWaypointReached: true,
        finalDistanceToTarget: 3,
      },
      stop: {
        quiescenceMs,
        stableForTenSeconds: true,
        stableSamples: healthObserved ? [{ health: 20 }] : [],
      },
      passed: doorwayCrossed,
    };
    const harness = {
      passed: true,
      finishedAt: issuedAt + 26000,
      durationMs: 26000,
      attempts: [attempt],
      fixture: { mobSpawning: { restored: true } },
      cleanup: {
        fixtureRestored: true,
        botHeld: true,
        targetDisconnected: true,
      },
    };
    const report = {
      request_form: form,
      instrumentation: {
        requested_mode: plan.instrumentationMode,
        decision_trace_enabled: plan.instrumentationMode === 'on',
        observed_decision_trace_present: observedDecisionTracePresent,
        observed_schema_version: observedDecisionTracePresent ? 1 : null,
        verified: instrumentationVerified,
      },
      fixture_authorized: true,
      endpoints_local_only: true,
      status: 'passed',
      finished_utc: '2026-08-03T00:00:26.000Z',
      harness_evidence: harness,
      verdict: {
        passed: true,
        duration_ms: 26000,
        external_retry_count: 0,
        false_success_observed: false,
      },
      cleanup: {
        configuration_restored: true,
        properties_restored: true,
        pre_run_memory_restored: true,
        remaining_managed_java: [],
        errors: [],
      },
    };
    return observeFollowFieldRun(report, plan.timeoutMs, plan.instrumentationMode);
  };

  const direct = makeRun('direct', 'explicit-command');
  const naturalLanguage = makeRun('natural-language', 'deterministic-nl');
  assert.equal(direct.success, true);
  assert.equal(naturalLanguage.success, true);

  const observation = aggregateFollowFieldObservations(plan, [direct, naturalLanguage]);
  const result = createExecutionResult(manifest, scenarioId, observation);
  assert.equal(result.status, 'passed');
  assert.equal(result.evidenceCompleteness, 'complete');
  assert.equal(result.liveScenarioPassed, true);

  const modelRouted = makeRun('natural-language', 'model-selected');
  assert.equal(modelRouted.success, false);
  assert.ok(modelRouted.safetyInvariantViolations.includes('deterministic-local-request-route'));

  const falseSuccess = makeRun('direct', 'explicit-command', { doorwayCrossed: false });
  assert.equal(falseSuccess.success, false);
  assert.ok(falseSuccess.safetyInvariantViolations.includes('no-false-success'));

  const missingHealth = makeRun('direct', 'explicit-command', { healthObserved: false });
  assert.equal(missingHealth.success, false);
  assert.ok(missingHealth.safetyInvariantViolations.includes('no-false-success'));

  const invalidLifecycle = makeRun('direct', 'explicit-command', {
    terminalFinishedAt: Number.NaN,
  });
  assert.equal(invalidLifecycle.success, false);
  assert.equal(invalidLifecycle.checks['follow-action-lifecycle'], false);

  const invalidMovement = makeRun('direct', 'explicit-command', {
    botTrajectoryDistance: Number.NaN,
  });
  assert.equal(invalidMovement.success, false);
  assert.equal(invalidMovement.checks['corridor-progress-confirmed'], false);

  const missingQuiescence = makeRun('direct', 'explicit-command', { quiescenceMs: null });
  assert.equal(missingQuiescence.success, false);
  assert.equal(missingQuiescence.checks['terminal-quiescence-confirmed'], false);

  const instrumentationMismatch = makeRun('direct', 'explicit-command', {
    observedDecisionTracePresent: true,
  });
  assert.equal(instrumentationMismatch.success, false);
  assert.equal(instrumentationMismatch.checks['instrumentation-mode-confirmed'], false);
  assert.ok(instrumentationMismatch.safetyInvariantViolations.includes('declared-instrumentation-mode-required'));
});
