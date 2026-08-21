import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../tools/a0/aggregate.mjs';
import {
  FAMILIES,
  analyzeVarianceMatrix,
  computeScenarioManifestHash,
  computeVarianceMatrixHash,
  createExecutionPlan,
  createExecutionResult,
  createScenarioList,
  loadScenarioManifest,
  validateScenarioManifest,
  validateVarianceMatrix,
} from '../../tools/scenario-lab.mjs';
import {
  aggregateFollowFieldObservations,
  classifyTerminalProviderFailure,
  createVarianceObservation,
  latestCompleteModelMeasurement,
  observeFollowFieldRun,
} from '../../tools/scenario-lab/adapters/follow-field-evidence.mjs';
import { startRecordedTraceProvider } from '../../tools/scenario-lab/adapters/recorded-trace-provider.mjs';
import {
  fingerprintVarianceValue,
  recordedTraceModelName,
  requestCompletionCase,
  REQUEST_COMPLETION_CASES,
} from '../../tools/scenario-lab/variance-cases.mjs';
import {
  createVarianceAcquisitionPlan,
  selectVariancePlanCells,
} from '../../tools/scenario-lab/run-variance-matrix.mjs';
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

function declaredVarianceCase() {
  return {
    id: '1-give',
    fixtureFingerprint: 'a'.repeat(64),
    inputFingerprint: 'b'.repeat(64),
    recordedTraceFingerprint: 'c'.repeat(64),
    frozenModelFingerprint: 'd'.repeat(64),
  };
}

function varianceMatrix({ trials = [1, 2], alter = () => {} } = {}) {
  const declaredCase = declaredVarianceCase();
  const observations = [];
  for (const trial of trials) {
    for (const executionMode of ['recorded-trace', 'frozen-model']) {
      for (const telemetryMode of ['off', 'on']) {
        for (const preflightMode of ['off', 'on']) {
          const suffix = `${trial}-${executionMode}-${telemetryMode}-${preflightMode}`;
          const observation = {
            runId: `run-${suffix}`,
            caseId: declaredCase.id,
            trial,
            executionMode,
            telemetryMode,
            preflightMode,
            resetId: `reset-${suffix}`,
            fixtureFingerprint: declaredCase.fixtureFingerprint,
            inputFingerprint: declaredCase.inputFingerprint,
            driverFingerprint: executionMode === 'recorded-trace'
              ? declaredCase.recordedTraceFingerprint
              : declaredCase.frozenModelFingerprint,
            modelOutputFingerprint: executionMode === 'frozen-model' ? '0'.repeat(64) : null,
            modelRouteFingerprint: executionMode === 'frozen-model' ? '6'.repeat(64) : null,
            decisionFingerprint: executionMode === 'recorded-trace' ? 'e'.repeat(64) : 'f'.repeat(64),
            preflightFingerprint: preflightMode === 'on' ? '1'.repeat(64) : null,
            lifecycleFingerprint: telemetryMode === 'on' ? '2'.repeat(64) : null,
            outcomeFingerprint: '3'.repeat(64),
            passed: true,
            settledBefore: true,
            settledAfter: true,
            elapsedMs: 1_000,
          };
          alter(observation);
          observations.push(observation);
        }
      }
    }
  }
  const matrix = {
    schemaVersion: 'scenario-lab.variance-matrix.v1',
    matrixRevision: 'phase-5-test.v1',
    matrixHash: '0'.repeat(64),
    candidateCommit: '4'.repeat(40),
    cases: [declaredCase],
    observations,
  };
  matrix.matrixHash = computeVarianceMatrixHash(matrix);
  return matrix;
}

function varianceHarnessReport({
  telemetryMode = 'on',
  executionMode = 'frozen-model',
  identity = 'a',
  issuedAt = 1_000,
  selectedSkill = '!givePlayer',
  terminalCode = 'skill_done',
  lifecycleCode = terminalCode,
  passed = true,
  includeModel = true,
  recordedTraceHost = '127.0.0.1',
  metricOffset = 0,
} = {}) {
  const varianceCase = declaredVarianceCase();
  const actionId = `action-${identity}`;
  const terminal = {
    actionId,
    label: 'action:givePlayer',
    phase: passed ? 'succeeded' : 'failed',
    code: terminalCode,
    retryable: !passed,
    startedAt: issuedAt + 20,
    finishedAt: issuedAt + 60,
    evidence: {
      request: {
        requestId: `request-${identity}`,
        routeOrigin: 'model-selected',
        selectedSkill,
        args: ['FollowTarget', 'dirt', 1],
      },
    },
  };
  const trace = {
    schemaVersion: 1,
    decisionId: `decision-${identity}`,
    wallClockTimestamp: issuedAt + 10,
    activeAction: {
      actionId,
      owner: 'player',
      ownerPriority: 70,
      label: terminal.label,
      intent: 'deliver requested item',
    },
    correlation: {
      actionId,
      requestId: `request-${identity}`,
      routeOrigin: 'model-selected',
      selectedSkill,
      args: ['FollowTarget', 'dirt', 1],
      outcomeLinked: true,
    },
    actionLifecycle: {
      acquisition: {
        actionId,
        owner: 'player',
        ownerPriority: 70,
        acquiredAt: issuedAt + 15,
        startedAt: issuedAt + 20,
        source: 'linked_action_start',
      },
      release: {
        actionId,
        owner: 'player',
        ownerPriority: 70,
        releasedAt: issuedAt + 60,
        phase: passed ? 'succeeded' : 'failed',
        code: lifecycleCode,
      },
    },
    outcome: {
      actionId,
      phase: passed ? 'succeeded' : 'failed',
      code: lifecycleCode,
      finishedAt: issuedAt + 60,
      durationMs: 40,
    },
  };
  const stableSample = {
    sampledAt: issuedAt + 1_000,
    held: true,
    idle: true,
    pathfinding: null,
    stopTimedOutAt: null,
  };
  const modelConfigFingerprint = executionMode === 'recorded-trace'
    ? '9'.repeat(64)
    : varianceCase.frozenModelFingerprint;
  const attempt = {
    attempt: 1,
    runId: `attempt-${identity}`,
    issuedAt,
    activeAt: issuedAt + 20,
    commandAck: { success: true, acceptedAt: issuedAt },
    terminal,
    stop: {
      settledAt: issuedAt + 1_000,
      stableForTenSeconds: true,
      stableSamples: [stableSample],
    },
    performance: {
      durationMs: 1_000 + metricOffset,
      botTrajectoryDistance: 7.25 + metricOffset,
    },
    physicalAcceptance: {
      course: 'variance-case',
      commandCompleted: passed,
      finalWaypointReached: passed,
      finalDistanceToTarget: 1.25 + metricOffset,
      finalPosition: { x: 10 + metricOffset, y: 64, z: 10 },
      observedAt: issuedAt + 500,
    },
    modelMeasurements: includeModel ? [{
      sampledAt: issuedAt + 30,
      modelConfigFingerprint,
      inputFingerprint: varianceCase.inputFingerprint,
      outputFingerprint: 'e'.repeat(64),
      modelRouteFingerprint: 'f'.repeat(64),
      outcome: 'generated',
      attempt: 1,
    }] : [],
    traces: telemetryMode === 'on' ? [trace] : [],
    results: { [terminal.label]: terminal },
    passed,
  };
  const recordedTraceUrl = `http://${recordedTraceHost}:43123/v1`;
  return {
    schema_version: 1,
    status: passed ? 'passed' : 'failed',
    fixture_metadata_sha256: varianceCase.fixtureFingerprint,
    instrumentation: {
      requested_mode: telemetryMode,
      decision_trace_enabled: telemetryMode === 'on',
      observed_decision_trace_present: telemetryMode === 'on',
      observed_schema_version: telemetryMode === 'on' ? 1 : null,
      verified: true,
    },
    verdict: { passed, duration_ms: 1_000 + metricOffset },
    cleanup: {
      configuration_restored: true,
      properties_restored: true,
      pre_run_memory_restored: true,
      remaining_managed_java: [],
      errors: [],
    },
    recorded_trace_profile: executionMode === 'recorded-trace' ? {
      api: 'openai_compatible',
      url: recordedTraceUrl,
    } : null,
    recorded_trace: executionMode === 'recorded-trace' ? {
      schemaVersion: 'scenario-lab.recorded-trace-provider.v1',
      caseId: varianceCase.id,
      driverFingerprint: varianceCase.recordedTraceFingerprint,
      expectedResponseFingerprint: 'e'.repeat(64),
      modelConfigFingerprint,
      modelRouteFingerprint: 'f'.repeat(64),
      endpoint: { host: recordedTraceHost, baseUrl: recordedTraceUrl },
      requests: [{
        accepted: true,
        matchedCaseRequest: true,
        inputFingerprint: varianceCase.inputFingerprint,
        responseFingerprint: 'e'.repeat(64),
      }],
      complete: true,
    } : null,
    harness_evidence: {
      passed,
      attempts: [attempt],
      cleanup: {
        fixtureRestored: true,
        botHeld: true,
        targetDisconnected: true,
        success: true,
      },
      fixture: { mobSpawning: { restored: true } },
    },
  };
}

function varianceObservation({
  executionMode = 'frozen-model',
  telemetryMode = 'on',
  preflightMode = 'on',
  identity = 'a',
  reportOptions = {},
  preflightEvidence = preflightMode === 'on' ? [{
    owner: 'route-consumer',
    operation: 'safe-round-trip',
    status: 'proven',
    code: 'route_found',
    conclusive: true,
    retryable: false,
  }] : null,
} = {}) {
  const varianceCase = declaredVarianceCase();
  const report = varianceHarnessReport({
    executionMode,
    telemetryMode,
    identity,
    ...reportOptions,
  });
  return createVarianceObservation({
    varianceCase,
    runId: `run-${identity}`,
    trial: 1,
    executionMode,
    telemetryMode,
    preflightMode,
    resetId: `reset-${identity}`,
    report,
    observedInputFingerprint: executionMode === 'recorded-trace'
      ? varianceCase.inputFingerprint
      : null,
    observedDriverFingerprint: executionMode === 'recorded-trace'
      ? varianceCase.recordedTraceFingerprint
      : null,
    settledBefore: true,
    preflightEvidence,
  });
}

test('the frozen v1 manifest registers six bounded replays and keeps other families unavailable', async () => {
  const manifest = await loadScenarioManifest();
  assert.equal(manifest.manifestHash, computeScenarioManifestHash(manifest));
  assert.deepEqual(validateScenarioManifest(manifest), []);
  assert.deepEqual(manifest.scenarios.map(({ family }) => family).sort(), [...FAMILIES]);
  // Revision and candidate commit MOVE every time the manifest is re-registered
  // against a new HEAD. Pinning them to literals made re-registration break this
  // test, which is part of why the lab was only ever runnable against one commit.
  // Assert their shape; the frozen fixture hashes and seeds below are the real
  // invariants.
  assert.match(manifest.manifestRevision, /^\S(?:.*\S)?$/);
  assert.match(manifest.candidateCommit, /^[a-f0-9]{40}$/);

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

  // The obstruction course covers what doorway-corridor cannot: following a
  // player when terrain must be broken. doorway-corridor passes identically
  // with digging disabled, so it can never catch a movement regression.
  const obstruction = manifest.scenarios.find(({ id }) => id === 'obstruction-follow');
  assert.equal(obstruction.status, 'not-run');
  assert.equal(obstruction.executor.safe, true);
  assert.equal(obstruction.executor.adapterId, 'follow-field-live-replay-v1');
  assert.equal(obstruction.executor.evidenceAdapterId, 'follow-field-evidence-v1');
  assert.equal(obstruction.world.fixtureHash, follow.world.fixtureHash);
  assert.equal(obstruction.seed, follow.seed);
  assert.ok(obstruction.expectedEvidence.includes('corridor-progress-confirmed'));

  // The deliver course is the only registered scenario that exercises a typed
  // goal rather than !followPlayer, and the only one on a generated world. Its
  // fixture hash is the sha256 of the layer recipe, not of an archive -- pinned
  // here for the same reason the follow archive hash is: an edited recipe is a
  // different world, and a scenario that silently ran on one would be worthless.
  const deliver = manifest.scenarios.find(({ id }) => id === 'deliver-item-goal');
  assert.equal(deliver.status, 'not-run');
  assert.equal(deliver.executor.safe, true);
  assert.equal(deliver.executor.adapterId, 'follow-field-live-replay-v1');
  assert.equal(deliver.executor.evidenceAdapterId, 'follow-field-evidence-v1');
  assert.equal(deliver.world.fixtureId, 'scenario-lab.deliver-item-flat.v1');
  assert.equal(deliver.world.fixtureHash, '5648172f406cd63604db1c8cf4f53923d4e8ec4e18a41ac92dd9fd12ef82489e');
  assert.equal(deliver.seed, '8140427791654321');
  assert.notEqual(deliver.world.fixtureHash, follow.world.fixtureHash);
  assert.equal(deliver.requestForms[0].request, '!requestItemGoal("deliver","dirt",1,"FollowTarget")');
  assert.ok(deliver.expectedEvidence.includes('item-delivered-to-recipient'));
  assert.ok(deliver.expectedEvidence.includes('dry-land-fixture-confirmed'));
  // Follow evidence must NOT be required here: the recipient never moves, so a
  // doorway or corridor requirement would be unsatisfiable by construction --
  // the failure mode that made request-correlation impossible in August.
  assert.ok(!deliver.expectedEvidence.includes('doorway-crossing-confirmed'));
  assert.ok(!deliver.expectedEvidence.includes('corridor-progress-confirmed'));

  // The orchestration course stands deterministic sentence interceptors down
  // so the model can accept one Phase 3 Mission. The Mission, not the model or
  // a reduced test-only command surface, owns later causal Activities.
  const orchestration = manifest.scenarios.find(({ id }) => id === 'orchestration-charcoal');
  assert.equal(orchestration.status, 'not-run');
  assert.equal(orchestration.executor.safe, true);
  assert.equal(orchestration.executor.adapterId, 'follow-field-live-replay-v1');
  assert.equal(orchestration.world.fixtureId, 'scenario-lab.orchestration-forest.v1');
  assert.equal(orchestration.world.fixtureHash.length, 64);
  assert.notEqual(orchestration.world.fixtureHash, deliver.world.fixtureHash);
  // Both request forms carry the same plain-language sentence, through two entry
  // points. Neither may be a command: a !command would route deterministically
  // and prove nothing about orchestration.
  assert.equal(orchestration.requestForms[0].request, orchestration.requestForms[1].request);
  for (const form of orchestration.requestForms) {
    assert.ok(!form.request.startsWith('!'), 'orchestration requests must be plain language');
  }
  assert.ok(orchestration.expectedEvidence.includes('item-delivered-to-recipient'));

  // Phase 4 isolates the strict whole-route preflight itself. Both request
  // forms intentionally carry the same explicit command so neither invocation
  // can spend provider quota or confound navigation truth with interpretation.
  const routeProbe = manifest.scenarios.find(({ id }) => id === 'route-probe-inconclusive');
  assert.ok(routeProbe, 'route-probe-inconclusive must be registered');
  assert.equal(routeProbe.status, 'not-run');
  assert.equal(routeProbe.executor.safe, true);
  assert.equal(routeProbe.executor.adapterId, 'follow-field-live-replay-v1');
  assert.equal(routeProbe.executor.evidenceAdapterId, 'follow-field-evidence-v1');
  assert.equal(routeProbe.world.fixtureId, deliver.world.fixtureId);
  assert.equal(routeProbe.world.fixtureHash, deliver.world.fixtureHash);
  assert.equal(routeProbe.requestForms[0].request, routeProbe.requestForms[1].request);
  assert.match(routeProbe.requestForms[0].request, /^!goToCoordinates\(/);
  assert.ok(routeProbe.expectedEvidence.includes('route-probe-inconclusive-confirmed'));
  assert.ok(routeProbe.expectedEvidence.includes('no-unproven-movement-confirmed'));
  assert.ok(routeProbe.expectedEvidence.includes('terrain-preserved-confirmed'));

  const registered = new Set([
    stone.id,
    follow.id,
    obstruction.id,
    deliver.id,
    orchestration.id,
    routeProbe.id,
  ]);
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
  assert.match(followWorker, /tools\/scenario-lab\/run-variance-matrix\.mjs/);
  assert.match(followWorker, /git -C \$repo ls-tree \$ExpectedCandidateCommit -- \$relativePath/);
  assert.match(followWorker, /candidate_present = \(\$null -ne \$candidateBlob\)/);
  assert.doesNotMatch(followWorker, /rev-parse "\$\{ExpectedCandidateCommit\}:\$relativePath"/);
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
  assert.match(followWorker, /route-probe-inconclusive/);
  assert.match(followRunner, /route-probe-inconclusive/);
  assert.match(followHarness, /route-probe-inconclusive/);
  assert.match(followHarness, /target\.chat\(options\.requestMessage\)/);
  assert.match(followHarness, /sendMessage\(options\.requestMessage\)/);
  assert.match(followHarness, /actuatorVelocityIsSettled/);
  assert.match(followHarness, /settled stop anchor/);
  assert.match(followHarness, /settledAt/);
  assert.match(followHarness, /settlingMs/);
  assert.match(followHarness, /modelMeasurement: state\?\.modelMeasurement\?\.conversation/);
  assert.match(followHarness, /modelMeasurementKeys: new Set\(\)/);
  assert.match(followHarness, /modelMeasurements: activeAttempt\.modelMeasurements/);
  assert.match(followWorker, /\$scenarioProfile\.model = \$configuredConversationModels\[0\]/);
  assert.match(followWorker, /'--max-prompt-turns'/);
  assert.match(followHarness, /completionStatus = 'outcome-timeout'/);
  assert.match(followHarness, /completionStatus = 'provider-failed'/);
});

test('Scenario Lab stops repeated request forms on terminal provider failures', () => {
  assert.deepEqual(classifyTerminalProviderFailure('code: credit_balance_exhausted'), {
    provider: 'openai-api',
    code: 'credit_balance_exhausted',
    detail: 'The configured OpenAI API project has no usable credit or spend allowance.',
  });
  assert.deepEqual(classifyTerminalProviderFailure('Codex quota or rate limit was reached.'), {
    provider: 'codex',
    code: 'codex_quota',
    detail: 'The logged-in ChatGPT account reached its Codex quota or rate limit.',
  });
  assert.deepEqual(
    classifyTerminalProviderFailure('HTTP 429 rate_limit_exceeded', { configuredProvider: 'openai' }),
    {
      provider: 'openai-api',
      code: 'provider_rate_limit',
      detail: 'The configured model provider rejected the request because its rate limit was reached.',
    },
  );
  assert.equal(classifyTerminalProviderFailure('ordinary gameplay failure'), null);
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

  // stone-recovery still uses its own evidence adapter, which was NOT changed by
  // the model-first work. Its declared route contract stands.
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

  // Model-first inverted this. A model-selected route is the intended behaviour
  // now -- the model picks the command, and four registered commands legitimately
  // serve "follow me". Correlation dropped the command NAME and the route, not
  // the request linkage.
  const modelRouted = makeRun('natural-language', 'model-selected');
  assert.equal(modelRouted.success, true);
  assert.ok(!modelRouted.safetyInvariantViolations.includes('deterministic-local-request-route'));

  // The guard that mattered is unchanged and is asserted right below: the deed,
  // not the name. A run that did not cross the doorway still fails, whatever
  // command it claimed to use.
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

test('route-probe evidence requires an inconclusive terminal without movement or terrain mutation', async () => {
  const issuedAt = 1000;
  const start = { x: 1027.5, y: 100, z: 1008.5 };
  const request = '!goToCoordinates(1038,100,1013,0,true)';
  const attempt = {
    attempt: 1,
    issuedAt,
    activeAt: issuedAt + 10,
    commandAck: { success: true },
    terminal: {
      actionId: 'action-route-probe',
      phase: 'failed',
      code: 'skill_route_unproven',
      label: 'action:goToCoordinates',
      detail: 'Pathfinder ended the route probe without a conclusive answer (timeout); no unproven movement was attempted.',
      retryable: true,
      startedAt: issuedAt + 10,
      finishedAt: issuedAt + 5010,
      evidence: {
        request: {
          requestId: 'request-route-probe',
          routeOrigin: 'explicit-command',
          selectedSkill: '!goToCoordinates',
          args: [1038, 100, 1013, 0, true],
        },
      },
    },
    traces: [],
    samples: [{ health: 20, position: start, pathfinding: null }],
    physicalSamples: [{ sampledAt: issuedAt + 20, position: start }],
    performance: { botTrajectoryDistance: 0, targetTrajectoryDistance: 0 },
    physicalAcceptance: {
      course: 'route-probe-inconclusive',
      fixtureVerified: true,
      routeProbeStatus: 'timeout',
      routeProbeConclusive: false,
      routeMovementAttempted: false,
      routeStartPosition: start,
      routeFinalPosition: start,
      routeTerrainIntact: true,
    },
    stop: {
      quiescenceMs: 100,
      stableForTenSeconds: true,
      stableSamples: [{ health: 20, position: start, pathfinding: null }],
    },
    passed: true,
  };
  const observation = observeFollowFieldRun({
    request_form: 'direct',
    instrumentation: {
      requested_mode: 'off',
      decision_trace_enabled: false,
      observed_decision_trace_present: false,
      observed_schema_version: null,
      verified: true,
    },
    fixture_authorized: true,
    endpoints_local_only: true,
    status: 'passed',
    finished_utc: '2026-08-20T00:00:16.000Z',
    harness_evidence: {
      passed: true,
      finishedAt: issuedAt + 16_000,
      durationMs: 16_000,
      attempts: [attempt],
      fixture: {
        courseVariant: 'route-probe-inconclusive',
        mobSpawning: { restored: true },
      },
      cleanup: { fixtureRestored: true, botHeld: true, targetDisconnected: true },
    },
    verdict: { passed: true, duration_ms: 16_000, external_retry_count: 0, false_success_observed: false },
    cleanup: {
      configuration_restored: true,
      properties_restored: true,
      pre_run_memory_restored: true,
      remaining_managed_java: [],
      errors: [],
    },
  }, 180_000, 'off');

  assert.equal(observation.success, true);
  assert.equal(observation.checks['route-probe-lifecycle'], true);
  assert.equal(observation.checks['route-probe-inconclusive-confirmed'], true);
  assert.equal(observation.checks['no-unproven-movement-confirmed'], true);
  assert.equal(observation.checks['terrain-preserved-confirmed'], true);

  const manifest = await loadScenarioManifest();
  const plan = createExecutionPlan(manifest, 'route-probe-inconclusive');
  const aggregate = aggregateFollowFieldObservations(plan, [
    observation,
    { ...observation, form: 'natural-language' },
  ]);
  const result = createExecutionResult(manifest, 'route-probe-inconclusive', aggregate);
  assert.equal(result.status, 'passed');
  assert.equal(result.evidenceCompleteness, 'complete');
  assert.equal(result.liveScenarioPassed, true);

  const falseNoPath = structuredClone(attempt);
  falseNoPath.terminal.code = 'skill_path_not_found';
  falseNoPath.terminal.detail = 'Pathfinder completed the route search without finding a safe route (noPath).';
  falseNoPath.physicalAcceptance.routeProbeStatus = 'noPath';
  falseNoPath.physicalAcceptance.routeProbeConclusive = true;
  const rejected = observeFollowFieldRun({
    request_form: 'direct',
    instrumentation: {
      requested_mode: 'off',
      decision_trace_enabled: false,
      observed_decision_trace_present: false,
      observed_schema_version: null,
      verified: true,
    },
    fixture_authorized: true,
    endpoints_local_only: true,
    status: 'passed',
    finished_utc: '2026-08-20T00:00:16.000Z',
    harness_evidence: {
      passed: true,
      finishedAt: issuedAt + 16_000,
      durationMs: 16_000,
      attempts: [falseNoPath],
      fixture: {
        courseVariant: 'route-probe-inconclusive',
        mobSpawning: { restored: true },
      },
      cleanup: { fixtureRestored: true, botHeld: true, targetDisconnected: true },
    },
    verdict: { passed: true, duration_ms: 16_000, external_retry_count: 0, false_success_observed: false },
    cleanup: {
      configuration_restored: true,
      properties_restored: true,
      pre_run_memory_restored: true,
      remaining_managed_java: [],
      errors: [],
    },
  }, 180_000, 'off');
  assert.equal(rejected.success, false);
  assert.equal(rejected.checks['route-probe-inconclusive-confirmed'], false);
});

test('charcoal Mission evidence requires stable IDs and exact eight-item delivery', async () => {
  const manifest = await loadScenarioManifest();
  const plan = createExecutionPlan(manifest, 'orchestration-charcoal');
  const makeRun = ({ quantity = 8, activityId = 'activity-1' } = {}) => {
    const issuedAt = 1000;
    const attempt = {
      attempt: 1,
      issuedAt,
      activeAt: issuedAt + 25,
      commandAck: { success: true },
      terminal: {
        actionId: 'action-deliver-charcoal',
        phase: 'succeeded',
        code: 'delivered_exact_item',
        label: 'action:givePlayer',
        startedAt: issuedAt + 50,
        finishedAt: issuedAt + 500,
        evidence: {
          request: {
            requestId: 'request-charcoal',
            routeOrigin: 'mission-director',
            selectedSkill: '!givePlayer',
            args: ['FollowTarget', 'charcoal', quantity],
            missionId: 'mission-1',
            activityId,
          },
          activity: {
            missionId: 'mission-1',
            activityId: 'activity-1',
            lifecycle: 'SUCCEEDED',
          },
        },
      },
      traces: [],
      samples: [{ health: 20 }],
      physicalAcceptance: {
        course: 'orchestrate-charcoal',
        fixtureVerified: true,
        deliveryVerified: true,
        deliverySourcePresent: false,
        deliveryGroundPresent: true,
        deliveryDryLandVerified: true,
        deliveryDryLandProbes: Array.from({ length: 4 }, () => ({ verified: true })),
        deliveryBaseline: 0,
        deliveryFinal: 8,
        deliveryObservedAt: issuedAt + 500,
      },
      stop: {
        quiescenceMs: 100,
        stableForTenSeconds: true,
        stableSamples: [{ health: 20 }],
      },
      passed: true,
    };
    return observeFollowFieldRun({
      request_form: 'natural-language',
      instrumentation: {
        requested_mode: plan.instrumentationMode,
        decision_trace_enabled: false,
        observed_decision_trace_present: false,
        observed_schema_version: null,
        verified: true,
      },
      fixture_authorized: true,
      endpoints_local_only: true,
      status: 'passed',
      finished_utc: '2026-08-19T00:00:12.000Z',
      harness_evidence: {
        passed: true,
        finishedAt: issuedAt + 12_000,
        durationMs: 12_000,
        attempts: [attempt],
        fixture: { courseVariant: 'orchestrate-charcoal', mobSpawning: { restored: true } },
        cleanup: { fixtureRestored: true, botHeld: true, targetDisconnected: true },
      },
      verdict: { passed: true, duration_ms: 12_000, external_retry_count: 0, false_success_observed: false },
      cleanup: {
        configuration_restored: true,
        properties_restored: true,
        pre_run_memory_restored: true,
        remaining_managed_java: [],
        errors: [],
      },
    }, plan.timeoutMs, plan.instrumentationMode);
  };

  const exact = makeRun();
  assert.equal(exact.success, true);
  assert.equal(exact.checks['request-correlation'], true);
  assert.equal(exact.checks['goal-action-lifecycle'], true);
  assert.equal(exact.checks['item-delivered-to-recipient'], true);

  const wrongQuantity = makeRun({ quantity: 1 });
  assert.equal(wrongQuantity.success, false);
  assert.equal(wrongQuantity.checks['request-correlation'], false);

  const mismatchedActivity = makeRun({ activityId: 'activity-other' });
  assert.equal(mismatchedActivity.success, false);
  assert.equal(mismatchedActivity.checks['request-correlation'], false);
});

test('follow evidence exposes the latest complete hashed model measurement', () => {
  const hash = character => character.repeat(64);
  const measurement = latestCompleteModelMeasurement({
    issuedAt: 100,
    modelMeasurements: [
      {
        sampledAt: 50,
        modelConfigFingerprint: hash('a'),
        inputFingerprint: hash('b'),
        outputFingerprint: hash('c'),
        modelRouteFingerprint: hash('d'),
        outcome: 'generated',
        attempt: 1,
      },
      {
        sampledAt: 150,
        modelConfigFingerprint: hash('a'),
        inputFingerprint: hash('8'),
        outputFingerprint: hash('c'),
        modelRouteFingerprint: hash('d'),
        outcome: 'generated',
        attempt: 2,
        attempts: [
          {
            attempt: 1,
            inputFingerprint: hash('b'),
            outputFingerprint: hash('7'),
            modelRouteFingerprint: hash('d'),
            outcome: 'generated',
          },
          {
            attempt: 2,
            inputFingerprint: hash('8'),
            outputFingerprint: hash('c'),
            modelRouteFingerprint: hash('d'),
            outcome: 'generated',
          },
        ],
        rawPrompt: 'not evidence',
      },
      {
        sampledAt: 160,
        modelConfigFingerprint: hash('a'),
        inputFingerprint: hash('b'),
        outputFingerprint: null,
        modelRouteFingerprint: hash('d'),
        outcome: 'provider_failed',
        attempt: 2,
      },
    ],
  });

  assert.deepEqual(measurement, {
    modelConfigFingerprint: hash('a'),
    inputFingerprint: hash('8'),
    outputFingerprint: hash('c'),
    modelRouteFingerprint: hash('d'),
    sampledAt: 150,
    outcome: 'generated',
    attempt: 2,
    initialInputFingerprint: hash('b'),
    attempts: [
      {
        attempt: 1,
        inputFingerprint: hash('b'),
        outputFingerprint: hash('7'),
        modelRouteFingerprint: hash('d'),
        outcome: 'generated',
      },
      {
        attempt: 2,
        inputFingerprint: hash('8'),
        outputFingerprint: hash('c'),
        modelRouteFingerprint: hash('d'),
        outcome: 'generated',
      },
    ],
  });
  assert.equal(latestCompleteModelMeasurement({ modelMeasurements: [] }), null);
});

test('Phase 5 request-completion cases have stable isolated fixture and recorded-driver contracts', () => {
  assert.deepEqual(REQUEST_COMPLETION_CASES.map(entry => entry.id), [
    '1-give',
    '2-craft-give',
    '3-chain-give',
    '4-tool-prep',
    '5-mine-exact',
    '6-kit',
    '7-workshop',
  ]);
  for (const varianceCase of REQUEST_COMPLETION_CASES) {
    assert.equal(requestCompletionCase(varianceCase.id), varianceCase);
    assert.match(varianceCase.fixtureFingerprint, /^[a-f0-9]{64}$/);
    assert.match(varianceCase.recordedTraceFingerprint, /^[a-f0-9]{64}$/);
    assert.match(varianceCase.recordedResponseFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(varianceCase.acceptedSegments));
    assert.equal(varianceCase.expectedT0.caseId, varianceCase.id);
    assert.match(varianceCase.recordedResponse, /![A-Za-z]/);
  }
});

test('Phase 5 acquisition plan covers every isolated axis cell and discloses accepted overlap', () => {
  const context = {
    candidateCommit: '4'.repeat(40),
    workspaceSourceFingerprint: '5'.repeat(64),
    workspaceSourceFiles: {},
    fixture: {
      fixtureId: 'scenario-lab.deliver-item-flat.v1',
      fixtureHash: '6'.repeat(64),
      seed: '8140427791654321',
    },
    frozenModel: {
      api: 'openai',
      model: 'gpt-4.1',
      maxPromptTurns: 2,
      routeCount: 1,
    },
  };
  const plan = createVarianceAcquisitionPlan({ trials: 2, context });

  assert.equal(plan.caseCount, 7);
  assert.equal(plan.totalCells, 112);
  assert.equal(plan.localRecordedTraceCells, 56);
  assert.equal(plan.frozenModelCells, 56);
  assert.equal(plan.maximumConfiguredProviderRequests, 112);
  assert.equal(new Set(plan.cells.map(cell => cell.runId)).size, plan.totalCells);
  assert.equal(new Set(plan.cells.map(cell => cell.resetId)).size, plan.totalCells);
  assert.deepEqual(plan.acceptedSegmentsRepeated, [
    'Campaign 28',
    'Campaign 29',
    'Campaign 70',
    'Campaign 68',
    'M2',
  ]);
  assert.match(plan.preflightAxis.off, /advisory\/advisory/);
  assert.match(plan.preflightAxis.on, /strict\/strict/);
  assert.equal(createVarianceAcquisitionPlan({ trials: 3, context }).totalCells, 168);
  assert.throws(() => createVarianceAcquisitionPlan({ trials: 1, context }), /one run cannot measure/);
  assert.equal(
    selectVariancePlanCells(plan, '1-give-trial-1-recorded-trace-telemetry-off-preflight-off').length,
    1,
  );
  assert.equal(selectVariancePlanCells(plan).length, 112);
  assert.throws(() => selectVariancePlanCells(plan, 'missing-cell'), /Unknown Phase 5 cell/);
});

test('recorded trace provider binds one loopback request to the exact case input and response', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scenario-recorded-trace-'));
  const readyFile = path.join(directory, 'ready.json');
  const evidenceFile = path.join(directory, 'evidence.json');
  const varianceCase = requestCompletionCase('1-give');
  const { server, evidence } = await startRecordedTraceProvider({ varianceCase, readyFile, evidenceFile });
  try {
    const prompt = 'fixed system prompt';
    const messages = [{ role: 'user', content: `FollowTarget: ${varianceCase.request}` }];
    const requestBody = {
      model: recordedTraceModelName(varianceCase),
      messages: [{ role: 'system', content: prompt }, ...messages],
    };
    const response = await fetch(`${evidence.endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, varianceCase.recordedResponse);
    const recorded = JSON.parse(await readFile(evidenceFile, 'utf8'));
    assert.equal(recorded.complete, true);
    assert.equal(recorded.requests.length, 1);
    assert.equal(recorded.requests[0].inputFingerprint, fingerprintVarianceValue({ messages, prompt }));
    assert.equal(recorded.requests[0].responseFingerprint, varianceCase.recordedResponseFingerprint);
    assert.deepEqual(recorded.requests[0].requestSize, {
      compatibleBodyUtf8Bytes: Buffer.byteLength(JSON.stringify(requestBody), 'utf8'),
      systemPromptUtf8Bytes: Buffer.byteLength(prompt, 'utf8'),
      conversationContentUtf8Bytes: Buffer.byteLength(messages[0].content, 'utf8'),
      conversationMessageCount: 1,
      recordedResponseUtf8Bytes: Buffer.byteLength(varianceCase.recordedResponse, 'utf8'),
    });
    assert.equal(Object.hasOwn(body, 'usage'), false);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
    await rm(directory, { recursive: true, force: true });
  }
});

test('variance evidence adapter removes generated identities, times, and noisy metrics from fingerprints', () => {
  const first = varianceObservation({
    identity: 'first',
    reportOptions: { issuedAt: 1_000, metricOffset: 0 },
  });
  const second = varianceObservation({
    identity: 'second',
    reportOptions: { issuedAt: 20_000, metricOffset: 7 },
  });

  assert.equal(first.decisionFingerprint, second.decisionFingerprint);
  assert.equal(first.lifecycleFingerprint, second.lifecycleFingerprint);
  assert.equal(first.preflightFingerprint, second.preflightFingerprint);
  assert.equal(first.outcomeFingerprint, second.outcomeFingerprint);
  assert.notEqual(first.elapsedMs, second.elapsedMs);
  assert.equal(Object.values(first).some(value => String(value).includes('action-first')), false);

  const matrix = {
    schemaVersion: 'scenario-lab.variance-matrix.v1',
    matrixRevision: 'adapter-cell.v1',
    matrixHash: '0'.repeat(64),
    candidateCommit: '4'.repeat(40),
    cases: [declaredVarianceCase()],
    observations: [first],
  };
  matrix.matrixHash = computeVarianceMatrixHash(matrix);
  assert.deepEqual(validateVarianceMatrix(matrix), []);
});

test('variance evidence adapter separates decisions, lifecycle, and disabled observer axes', () => {
  const baseline = varianceObservation({ identity: 'baseline' });
  const differentDecision = varianceObservation({
    identity: 'decision',
    reportOptions: { selectedSkill: '!requestItemGoal' },
  });
  const differentLifecycle = varianceObservation({
    identity: 'lifecycle',
    reportOptions: { lifecycleCode: 'released_after_recovery' },
  });
  const observerOff = varianceObservation({
    identity: 'observer-off',
    telemetryMode: 'off',
    preflightMode: 'off',
  });

  assert.notEqual(baseline.decisionFingerprint, differentDecision.decisionFingerprint);
  assert.equal(baseline.outcomeFingerprint, differentDecision.outcomeFingerprint);
  assert.notEqual(baseline.lifecycleFingerprint, differentLifecycle.lifecycleFingerprint);
  assert.equal(baseline.outcomeFingerprint, differentLifecycle.outcomeFingerprint);
  assert.equal(observerOff.lifecycleFingerprint, null);
  assert.equal(observerOff.preflightFingerprint, null);
});

test('variance evidence adapter enforces execution drivers and structured preflight evidence', () => {
  const recorded = varianceObservation({
    identity: 'recorded',
    executionMode: 'recorded-trace',
    telemetryMode: 'off',
    preflightMode: 'off',
  });
  assert.equal(recorded.modelOutputFingerprint, null);
  assert.equal(recorded.modelRouteFingerprint, null);
  assert.equal(recorded.driverFingerprint, declaredVarianceCase().recordedTraceFingerprint);

  assert.throws(() => varianceObservation({
    identity: 'missing-model',
    reportOptions: { includeModel: false },
  }), /no complete post-request model measurement/);
  assert.throws(() => varianceObservation({
    identity: 'recorded-non-loopback',
    executionMode: 'recorded-trace',
    reportOptions: { recordedTraceHost: 'provider.example' },
  }), /not confined to the declared loopback compatible endpoint/);
  assert.throws(() => varianceObservation({
    identity: 'volatile-preflight',
    preflightEvidence: [{
      owner: 'route-consumer',
      operation: 'safe-round-trip',
      status: 'proven',
      sampledAt: 123,
    }],
  }), /volatile or unknown field sampledAt/);
});

test('recorded trace evidence ignores an observed pending snapshot but still requires one complete prompt', () => {
  const varianceCase = declaredVarianceCase();
  const report = varianceHarnessReport({
    identity: 'recorded-pending',
    executionMode: 'recorded-trace',
    telemetryMode: 'off',
  });
  const attempt = report.harness_evidence.attempts[0];
  const complete = attempt.modelMeasurements[0];
  attempt.modelMeasurements.unshift({
    ...complete,
    sampledAt: complete.sampledAt - 1,
    outputFingerprint: null,
    modelRouteFingerprint: null,
    outcome: 'pending',
    attempt: 0,
  });

  const observation = createVarianceObservation({
    varianceCase,
    runId: 'run-recorded-pending',
    trial: 1,
    executionMode: 'recorded-trace',
    telemetryMode: 'off',
    preflightMode: 'off',
    resetId: 'reset-recorded-pending',
    report,
    observedInputFingerprint: varianceCase.inputFingerprint,
    observedDriverFingerprint: varianceCase.recordedTraceFingerprint,
    settledBefore: true,
    preflightEvidence: null,
  });

  assert.equal(observation.passed, true);
  assert.equal(observation.driverFingerprint, varianceCase.recordedTraceFingerprint);
});

test('variance evidence records a settled physical failure instead of discarding it as incomplete', () => {
  const failed = varianceObservation({
    identity: 'settled-failure',
    reportOptions: { passed: false, terminalCode: 'skill_failed' },
  });

  assert.equal(failed.passed, false);
  assert.equal(failed.settledBefore, true);
  assert.equal(failed.settledAfter, true);
  assert.match(failed.outcomeFingerprint, /^[a-f0-9]{64}$/);
});

test('variance matrix proves stable repeated cells only after every controlled arm is present', () => {
  const matrix = varianceMatrix();
  assert.deepEqual(validateVarianceMatrix(matrix), []);

  const report = analyzeVarianceMatrix(matrix);
  assert.equal(report.valid, true);
  assert.equal(report.complete, true);
  assert.equal(report.verdict, 'stable');
  assert.equal(report.variableCells.length, 0);
  assert.equal(report.coverage[0].trialCount, 2);
  assert.ok(report.signals.every(({ status }) => status === 'not-observed'));
});

test('variance matrix identifies model sampling only when frozen outputs and decisions vary', () => {
  const matrix = varianceMatrix({
    alter(observation) {
      if (observation.trial !== 2 || observation.executionMode !== 'frozen-model') return;
      observation.modelOutputFingerprint = '5'.repeat(64);
      observation.decisionFingerprint = '4'.repeat(64);
      observation.outcomeFingerprint = '5'.repeat(64);
      observation.passed = false;
    },
  });
  const report = analyzeVarianceMatrix(matrix);
  const model = report.signals.find(({ source }) => source === 'model-sampling');

  assert.equal(report.complete, true);
  assert.equal(report.verdict, 'source-signals-observed');
  assert.equal(model.status, 'supported');
  assert.equal(model.evidence.length, 4);
  assert.equal(report.signals.find(({ source }) => source === 'preflight').status, 'not-observed');
  assert.equal(report.signals.find(({ source }) => source === 'telemetry-observer-effect').status, 'not-observed');
});

test('variance matrix separates provider routing changes from same-route model sampling', () => {
  const matrix = varianceMatrix({
    alter(observation) {
      if (observation.trial !== 2 || observation.executionMode !== 'frozen-model') return;
      observation.modelRouteFingerprint = '5'.repeat(64);
      observation.modelOutputFingerprint = '5'.repeat(64);
      observation.decisionFingerprint = '4'.repeat(64);
      observation.outcomeFingerprint = '5'.repeat(64);
      observation.passed = false;
    },
  });
  const report = analyzeVarianceMatrix(matrix);

  assert.equal(report.signals.find(({ source }) => source === 'model-routing').status, 'supported');
  assert.equal(report.signals.find(({ source }) => source === 'model-sampling').status, 'not-observed');
});

test('variance matrix separates lifecycle changes from fixed decisions and inputs', () => {
  const matrix = varianceMatrix({
    alter(observation) {
      if (observation.trial !== 2) return;
      observation.outcomeFingerprint = '5'.repeat(64);
      observation.passed = false;
      if (observation.telemetryMode === 'on') {
        observation.lifecycleFingerprint = '5'.repeat(64);
      }
    },
  });
  const report = analyzeVarianceMatrix(matrix);
  const lifecycle = report.signals.find(({ source }) => source === 'lifecycle');

  assert.equal(report.complete, true);
  assert.equal(lifecycle.status, 'supported');
  assert.equal(lifecycle.evidence.length, 4);
  assert.equal(report.signals.find(({ source }) => source === 'model-sampling').status, 'not-observed');
  assert.equal(report.signals.find(({ source }) => source === 'telemetry-observer-effect').status, 'not-observed');
});

test('variance matrix reports a matched preflight effect without miscalling it random variation', () => {
  const matrix = varianceMatrix({
    alter(observation) {
      if (observation.preflightMode !== 'on') return;
      observation.outcomeFingerprint = '5'.repeat(64);
      observation.passed = false;
    },
  });
  const report = analyzeVarianceMatrix(matrix);

  assert.equal(report.complete, true);
  assert.equal(report.variableCells.length, 0);
  assert.equal(report.signals.find(({ source }) => source === 'preflight').status, 'supported');
  assert.equal(report.signals.find(({ source }) => source === 'model-sampling').status, 'not-observed');
});

test('variance matrix fails closed on dirty t0 or an unsettled activity boundary', () => {
  const matrix = varianceMatrix();
  matrix.observations[0].fixtureFingerprint = '5'.repeat(64);
  matrix.observations[0].settledBefore = false;
  matrix.observations[1].resetId = matrix.observations[0].resetId;
  matrix.observations.find(({ executionMode }) => executionMode === 'frozen-model')
    .modelOutputFingerprint = null;
  matrix.observations.find(({ telemetryMode }) => telemetryMode === 'on')
    .lifecycleFingerprint = null;
  matrix.observations.find(({ preflightMode }) => preflightMode === 'on')
    .preflightFingerprint = null;
  matrix.matrixHash = computeVarianceMatrixHash(matrix);

  const diagnostics = validateVarianceMatrix(matrix);
  assert.ok(diagnostics.some(({ code }) => code === 't0-contamination'));
  assert.ok(diagnostics.some(({ code }) => code === 'unsettled-boundary'));
  assert.ok(diagnostics.some(({ code }) => code === 'duplicate-resetId'));
  assert.ok(diagnostics.filter(({ code }) => code === 'relationship').length >= 3);
  assert.equal(analyzeVarianceMatrix(matrix).verdict, 'invalid');
});

test('variance matrix remains incomplete until independent repetitions exist', () => {
  const report = analyzeVarianceMatrix(varianceMatrix({ trials: [1] }));

  assert.equal(report.valid, true);
  assert.equal(report.complete, false);
  assert.equal(report.verdict, 'incomplete');
  assert.ok(report.diagnostics.some(({ code }) => code === 'independent-comparison-missing'));
  assert.ok(report.signals.every(({ status }) => status === 'unmeasured'));
});

test('variance CLI reads one complete matrix and emits a canonical report', async () => {
  await withTempDirectory(async (directory) => {
    const input = path.join(directory, 'variance-matrix.json');
    await writeFile(input, `${canonicalJson(varianceMatrix())}\n`, 'utf8');

    const run = spawnSync(process.execPath, [CLI, 'variance', '--input', input], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.schemaVersion, 'scenario-lab.variance-report.v1');
    assert.equal(report.complete, true);
    assert.equal(report.verdict, 'stable');
    assert.equal(run.stdout.trim(), canonicalJson(report));
  });
});
