#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalJson, sha256 } from '../a0/aggregate.mjs';
import {
  analyzeVarianceMatrix,
  computeVarianceMatrixHash,
  MIN_INDEPENDENT_VARIANCE_TRIALS,
  validateVarianceMatrix,
  VARIANCE_EXECUTION_MODES,
  VARIANCE_PREFLIGHT_MODES,
  VARIANCE_TELEMETRY_MODES,
} from '../scenario-lab.mjs';
import {
  classifyTerminalProviderFailure,
  createVarianceObservation,
  latestCompleteModelMeasurement,
} from './adapters/follow-field-evidence.mjs';
import { REQUEST_COMPLETION_CASES } from './variance-cases.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const WORKER = path.join(SCRIPT_DIRECTORY, 'adapters', 'follow-field-worker.ps1');
const DEFAULT_FIXTURE_ROOT = path.join(SCRIPT_DIRECTORY, 'fixtures', 'deliver-item-flat-v1');
const MATRIX_REVISION = 'phase5-request-completion.v1';
const ZERO_FINGERPRINT = '0'.repeat(64);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;

// These files own the measured prompt, routing, action lifecycle, item work,
// physical verifier, and evidence conversion. A resumed matrix is rejected if
// any of them changes between cells, even when the uncommitted workspace still
// points at the same Git commit.
const PHASE5_SOURCE_FILES = Object.freeze([
  'tools/scenario-lab.mjs',
  'tools/scenario-lab/run-variance-matrix.mjs',
  'tools/scenario-lab/variance-cases.mjs',
  'tools/scenario-lab/adapters/follow-field-evidence.mjs',
  'tools/scenario-lab/adapters/follow-field-worker.ps1',
  'tools/scenario-lab/adapters/recorded-trace-provider.mjs',
  'tools/verify-follow-field.mjs',
  'src/models/prompter.js',
  'src/models/codex.js',
  'src/agent/action_manager.js',
  'src/agent/commands/actions.js',
  'src/agent/player-directives.js',
  'src/agent/library/full_state.js',
  'src/agent/library/skills.js',
  'src/agent/npc/item_goal.js',
  'src/agent/runtime/behavior-config.js',
  'src/agent/runtime/goal-director.js',
  'src/agent/runtime/work-order.js',
]);

const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));

function assertPositiveTrials(trials) {
  if (!Number.isSafeInteger(trials) || trials < MIN_INDEPENDENT_VARIANCE_TRIALS) {
    throw new Error(
      `Trials must be an integer of at least ${MIN_INDEPENDENT_VARIANCE_TRIALS}; one run cannot measure run-to-run variation.`,
    );
  }
  return trials;
}

function cellId(caseId, trial, executionMode, telemetryMode, preflightMode) {
  return [caseId, `trial-${trial}`, executionMode, `telemetry-${telemetryMode}`, `preflight-${preflightMode}`].join('-');
}

export function createVarianceAcquisitionPlan({
  trials = MIN_INDEPENDENT_VARIANCE_TRIALS,
  context = null,
} = {}) {
  assertPositiveTrials(trials);
  const cells = [];
  for (const varianceCase of REQUEST_COMPLETION_CASES) {
    for (let trial = 1; trial <= trials; trial += 1) {
      for (const executionMode of VARIANCE_EXECUTION_MODES) {
        for (const telemetryMode of VARIANCE_TELEMETRY_MODES) {
          for (const preflightMode of VARIANCE_PREFLIGHT_MODES) {
            const runId = cellId(
              varianceCase.id,
              trial,
              executionMode,
              telemetryMode,
              preflightMode,
            );
            cells.push({
              runId,
              resetId: `reset-${runId}`,
              caseId: varianceCase.id,
              request: varianceCase.request,
              timeoutMs: varianceCase.timeoutMs,
              acceptedSegments: [...varianceCase.acceptedSegments],
              trial,
              executionMode,
              telemetryMode,
              preflightMode,
            });
          }
        }
      }
    }
  }
  const acceptedSegments = [...new Set(cells.flatMap(cell => cell.acceptedSegments))];
  const frozenModelCells = cells.filter(cell => cell.executionMode === 'frozen-model').length;
  const maxPromptTurns = Number(context?.frozenModel?.maxPromptTurns);
  return {
    schemaVersion: 'scenario-lab.variance-acquisition-plan.v1',
    matrixRevision: MATRIX_REVISION,
    candidateCommit: context?.candidateCommit || null,
    workspaceSourceFingerprint: context?.workspaceSourceFingerprint || null,
    workspaceSourceFiles: context?.workspaceSourceFiles || null,
    fixture: context?.fixture || null,
    frozenModel: context?.frozenModel || null,
    trials,
    caseCount: REQUEST_COMPLETION_CASES.length,
    totalCells: cells.length,
    localRecordedTraceCells: cells.length - frozenModelCells,
    frozenModelCells,
    maximumConfiguredProviderRequests: Number.isSafeInteger(maxPromptTurns) && maxPromptTurns > 0
      ? frozenModelCells * maxPromptTurns
      : null,
    configuredOutcomeWindowMs: cells.reduce((total, cell) => total + cell.timeoutMs, 0),
    preflightAxis: {
      off: 'advisory/advisory; inconclusive route evidence cannot veto the consumer',
      on: 'strict/strict; inconclusive route evidence vetoes the consumer',
    },
    acceptedSegmentsRepeated: acceptedSegments,
    authorizationRequired: true,
    executionPolicy: {
      isolatedProcessPerCell: true,
      cleanT0PerCell: true,
      physicalSettlementRequired: true,
      providerFailure: 'stop immediately; no retry or route fallback in the same authorized run',
      resume: 'reuse every already valid cell; execute only missing cells',
    },
    cells,
  };
}

export function selectVariancePlanCells(plan, requestedCell = null) {
  if (!plan || !Array.isArray(plan.cells)) throw new Error('A variance acquisition plan is required.');
  if (requestedCell === null) return [...plan.cells];
  const selected = plan.cells.filter(cell => cell.runId === requestedCell);
  if (selected.length !== 1) {
    throw new Error(`Unknown Phase 5 cell '${String(requestedCell)}'. Use the read-only plan to list exact cell IDs.`);
  }
  return selected;
}

function spawnForText(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('exit', (exitCode, signal) => {
      if (exitCode !== 0 || signal !== null) {
        rejectPromise(new Error(
          `${command} did not complete cleanly (exit=${String(exitCode)}, signal=${String(signal)}): ${stderr.trim()}`,
        ));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

async function currentCommit() {
  const value = await spawnForText('git', ['-C', REPOSITORY, 'rev-parse', 'HEAD'], REPOSITORY);
  if (!GIT_COMMIT.test(value)) throw new Error(`Git returned an invalid current commit: ${value}`);
  return value;
}

async function sourceContext() {
  const entries = await Promise.all(PHASE5_SOURCE_FILES.map(async relativePath => {
    const bytes = await readFile(path.join(REPOSITORY, relativePath));
    return [relativePath, sha256(bytes)];
  }));
  const workspaceSourceFiles = Object.fromEntries(entries);
  return {
    workspaceSourceFiles,
    workspaceSourceFingerprint: sha256(Buffer.from(canonicalJson(workspaceSourceFiles), 'utf8')),
  };
}

export async function resolveVarianceAcquisitionContext(fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const resolvedFixtureRoot = path.resolve(fixtureRoot);
  const metadataPath = path.join(resolvedFixtureRoot, 'fixture-metadata.json');
  const profilePath = path.join(resolvedFixtureRoot, 'scenario-profile.json');
  const [metadataBytes, profile, candidateCommit, source] = await Promise.all([
    readFile(metadataPath),
    readJson(profilePath),
    currentCommit(),
    sourceContext(),
  ]);
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  if (metadata?.schema_version !== 'scenario-lab.fixture.v1' || metadata?.kind !== 'generated') {
    throw new Error('Phase 5 requires the registered generated Scenario Lab fixture.');
  }
  if (!/^-?\d+$/.test(String(metadata?.source?.seed || ''))) {
    throw new Error('The generated fixture has no valid signed integer seed.');
  }
  const frozenModel = Array.isArray(profile?.model) ? profile.model[0] : profile?.model;
  const maxPromptTurns = Number(profile?.runtime?.limits?.maxPromptTurns);
  if (!frozenModel || typeof frozenModel !== 'object') {
    throw new Error('The generated fixture has no configured primary conversation model.');
  }
  if (!Number.isSafeInteger(maxPromptTurns) || maxPromptTurns < 1) {
    throw new Error('The generated fixture has no positive maxPromptTurns provider boundary.');
  }
  return {
    candidateCommit,
    ...source,
    fixtureRoot: resolvedFixtureRoot,
    fixture: {
      fixtureId: metadata.fixture_id,
      fixtureHash: sha256(metadataBytes),
      seed: String(metadata?.source?.seed || ''),
    },
    frozenModel: {
      api: frozenModel.api || null,
      model: frozenModel.model || null,
      url: frozenModel.url || null,
      params: frozenModel.params || null,
      maxPromptTurns,
      routeCount: 1,
      billingSurface: frozenModel.api === 'codex'
        ? 'ChatGPT subscription through Codex OAuth'
        : 'provider API project; ChatGPT subscription access is separate',
    },
  };
}

function parseOptions(argv) {
  const command = argv[0];
  if (!['plan', 'run'].includes(command)) throw new Error('Command must be plan or run.');
  const options = {
    command,
    trials: MIN_INDEPENDENT_VARIANCE_TRIALS,
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
    outputDirectory: '',
    cell: null,
    authorized: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--authorized-phase5-matrix') options.authorized = true;
    else if (argument === '--trials') options.trials = Number(argv[++index]);
    else if (argument === '--fixture-root') options.fixtureRoot = String(argv[++index] || '');
    else if (argument === '--output-dir') options.outputDirectory = String(argv[++index] || '');
    else if (argument === '--cell') options.cell = String(argv[++index] || '');
    else throw new Error(`Unsupported option: ${argument}`);
  }
  assertPositiveTrials(options.trials);
  if (!options.fixtureRoot) throw new Error('--fixture-root cannot be empty.');
  if (command === 'run' && !options.outputDirectory) throw new Error('run requires --output-dir.');
  if (command === 'run' && !options.authorized) {
    throw new Error('run requires explicit --authorized-phase5-matrix authorization.');
  }
  if (command === 'plan' && (options.authorized || options.outputDirectory || options.cell !== null)) {
    throw new Error('plan is read-only and does not accept run authorization, an output directory, or a cell selector.');
  }
  return options;
}

async function writeJsonExclusive(filename, value) {
  await writeFile(filename, `${canonicalJson(value)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function writeState(outputDirectory, value) {
  const destination = path.join(outputDirectory, 'acquisition-state.v1.json');
  const temporary = path.join(outputDirectory, 'acquisition-state.next.json');
  await writeFile(temporary, `${canonicalJson(value)}\n`, 'utf8');
  await rename(temporary, destination).catch(async error => {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
    await writeFile(destination, `${canonicalJson(value)}\n`, 'utf8');
    await unlink(temporary);
  });
}

function settledBefore(report, attempt) {
  return report?.before?.action_held === true
    && report?.before?.action_idle === true
    && !report?.before?.pathfinding
    && attempt?.physicalAcceptance?.t0Verified === true
    && attempt?.t0?.botHeld === true
    && attempt?.t0?.botIdle === true
    && attempt?.t0?.botPathfinding === false;
}

function reportCellAttempt(report) {
  const attempts = Array.isArray(report?.harness_evidence?.attempts)
    ? report.harness_evidence.attempts
    : [];
  return attempts.length === 1 ? attempts[0] : null;
}

function assertReportIdentity(cell, report) {
  if (
    report?.variance?.case_id !== cell.caseId
    || report?.variance?.execution_mode !== cell.executionMode
    || report?.variance?.preflight_mode !== cell.preflightMode
    || report?.instrumentation?.requested_mode !== cell.telemetryMode
  ) throw new Error(`Report identity drifted for ${cell.runId}.`);
}

function provisionalObservation(cell, report) {
  assertReportIdentity(cell, report);
  const definition = REQUEST_COMPLETION_CASES.find(entry => entry.id === cell.caseId);
  const attempt = reportCellAttempt(report);
  const measurement = latestCompleteModelMeasurement(attempt);
  if (!definition || !attempt || !measurement) {
    throw new Error(`Report ${cell.runId} has no complete Phase 5 attempt and model measurement.`);
  }
  const varianceCase = {
    id: definition.id,
    fixtureFingerprint: definition.fixtureFingerprint,
    inputFingerprint: measurement.initialInputFingerprint,
    recordedTraceFingerprint: definition.recordedTraceFingerprint,
    frozenModelFingerprint: cell.executionMode === 'frozen-model'
      ? measurement.modelConfigFingerprint
      : ZERO_FINGERPRINT,
  };
  return createVarianceObservation({
    varianceCase,
    runId: cell.runId,
    resetId: cell.resetId,
    trial: cell.trial,
    executionMode: cell.executionMode,
    telemetryMode: cell.telemetryMode,
    preflightMode: cell.preflightMode,
    report,
    observedFixtureFingerprint: attempt?.physicalAcceptance?.t0Fingerprint || null,
    observedInputFingerprint: measurement.initialInputFingerprint,
    observedDriverFingerprint: cell.executionMode === 'recorded-trace'
      ? definition.recordedTraceFingerprint
      : measurement.modelConfigFingerprint,
    settledBefore: settledBefore(report, attempt),
    preflightEvidence: attempt?.preflightEvidence,
  });
}

async function readTextIfPresent(filename) {
  try {
    return await readFile(filename, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function providerFailureForAttempt(reportDirectory, report) {
  const values = await Promise.all([
    'stack-stdout.log',
    'stack-stderr.log',
    'harness-stdout.log',
    'harness-stderr.log',
  ].map(name => readTextIfPresent(path.join(reportDirectory, name))));
  return classifyTerminalProviderFailure([
    report?.error || '',
    report?.harness_process?.stdout || '',
    report?.harness_process?.stderr || '',
    ...values,
  ].join('\n'), {
    configuredProvider: report?.frozen_model_profile?.api || null,
  });
}

async function attemptDirectories(cellDirectory) {
  try {
    const entries = await readdir(cellDirectory, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && /^attempt-[1-9]\d*$/.test(entry.name))
      .map(entry => ({
        name: entry.name,
        number: Number(entry.name.slice('attempt-'.length)),
        path: path.join(cellDirectory, entry.name),
      }))
      .sort((left, right) => left.number - right.number);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function existingCellReport(cell, cellDirectory) {
  for (const attempt of await attemptDirectories(cellDirectory)) {
    const reportDirectory = path.join(attempt.path, 'report');
    try {
      const report = await readJson(path.join(reportDirectory, 'live-report.json'));
      if (await providerFailureForAttempt(reportDirectory, report)) continue;
      provisionalObservation(cell, report);
      return { report, reportDirectory, attemptNumber: attempt.number, reused: true };
    } catch {
      // Invalid and interrupted attempts remain preserved evidence. A later
      // explicitly authorized run may create a new attempt beside them.
    }
  }
  return null;
}

async function executeCell(cell, context, outputDirectory) {
  const definition = REQUEST_COMPLETION_CASES.find(entry => entry.id === cell.caseId);
  const cellDirectory = path.join(outputDirectory, 'raw', cell.runId);
  const priorAttempts = await attemptDirectories(cellDirectory);
  const attemptNumber = priorAttempts.reduce((maximum, entry) => Math.max(maximum, entry.number), 0) + 1;
  const attemptRoot = path.join(cellDirectory, `attempt-${attemptNumber}`);
  const reportDirectory = path.join(attemptRoot, 'report');
  await mkdir(attemptRoot, { recursive: true });
  const stdoutHandle = await open(path.join(attemptRoot, 'adapter-stdout.log'), 'wx');
  const stderrHandle = await open(path.join(attemptRoot, 'adapter-stderr.log'), 'wx');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', WORKER,
    '-RequestForm', 'natural-language',
    '-RequestMessage', definition.request,
    '-OutputDirectory', reportDirectory,
    '-ExpectedCandidateCommit', context.candidateCommit,
    '-ExpectedFixtureHash', context.fixture.fixtureHash,
    '-ExpectedSeed', context.fixture.seed,
    '-InstrumentationMode', cell.telemetryMode,
    '-TimeoutMs', String(definition.timeoutMs),
    '-RegressionMode',
    '-Course', 'request-completion',
    '-FixtureRoot', context.fixtureRoot,
    '-VarianceExecutionMode', cell.executionMode,
    '-VarianceCase', cell.caseId,
    '-PreflightMode', cell.preflightMode,
  ];
  const processResult = await new Promise(resolvePromise => {
    const environment = { ...process.env };
    delete environment.PSModulePath;
    const child = spawn('powershell.exe', args, {
      cwd: REPOSITORY,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
    });
    let resolved = false;
    const finish = value => {
      if (resolved) return;
      resolved = true;
      resolvePromise(value);
    };
    child.once('error', error => finish({
      exitCode: null,
      signal: null,
      error: String(error?.message || error),
    }));
    child.once('exit', (exitCode, signal) => finish({ exitCode, signal, error: null }));
  });
  await Promise.all([stdoutHandle.close(), stderrHandle.close()]);
  await writeJsonExclusive(path.join(attemptRoot, 'adapter-process.json'), processResult);
  const report = await readJson(path.join(reportDirectory, 'live-report.json')).catch(error => ({
    status: 'failed',
    error: `Worker did not produce a readable report: ${String(error?.message || error)}`,
  }));
  const providerFailure = await providerFailureForAttempt(reportDirectory, report);
  return { report, reportDirectory, attemptNumber, processResult, providerFailure, reused: false };
}

export function assembleVarianceArtifacts({ plan, reports } = {}) {
  if (!plan || !Array.isArray(plan.cells) || !Array.isArray(reports)) {
    throw new Error('A complete acquisition plan and report list are required.');
  }
  if (reports.length !== plan.cells.length) {
    throw new Error(`Expected ${plan.cells.length} cell reports, received ${reports.length}.`);
  }
  const inputsByCase = new Map();
  const frozenDrivers = new Set();
  for (const { cell, report } of reports) {
    assertReportIdentity(cell, report);
    const measurement = latestCompleteModelMeasurement(reportCellAttempt(report));
    if (!measurement) throw new Error(`${cell.runId} has no complete model measurement.`);
    inputsByCase.set(cell.caseId, new Set([
      ...(inputsByCase.get(cell.caseId) || []),
      measurement.initialInputFingerprint,
    ]));
    if (cell.executionMode === 'frozen-model') {
      frozenDrivers.add(measurement.modelConfigFingerprint);
    }
  }
  for (const [caseId, fingerprints] of inputsByCase) {
    if (fingerprints.size !== 1) {
      throw new Error(`Clean-t0 prompt input drifted across Phase 5 axes for ${caseId}.`);
    }
  }
  if (frozenDrivers.size !== 1) {
    throw new Error('The frozen-model configuration drifted across Phase 5 cells.');
  }
  const frozenModelFingerprint = [...frozenDrivers][0];
  const cases = REQUEST_COMPLETION_CASES.map(definition => ({
    id: definition.id,
    fixtureFingerprint: definition.fixtureFingerprint,
    inputFingerprint: [...inputsByCase.get(definition.id)][0],
    recordedTraceFingerprint: definition.recordedTraceFingerprint,
    frozenModelFingerprint,
  }));
  const casesById = new Map(cases.map(entry => [entry.id, entry]));
  const observations = reports.map(({ cell, report }) => {
    const attempt = reportCellAttempt(report);
    const measurement = latestCompleteModelMeasurement(attempt);
    return createVarianceObservation({
      varianceCase: casesById.get(cell.caseId),
      runId: cell.runId,
      resetId: cell.resetId,
      trial: cell.trial,
      executionMode: cell.executionMode,
      telemetryMode: cell.telemetryMode,
      preflightMode: cell.preflightMode,
      report,
      observedFixtureFingerprint: attempt?.physicalAcceptance?.t0Fingerprint || null,
      observedInputFingerprint: measurement.initialInputFingerprint,
      observedDriverFingerprint: cell.executionMode === 'recorded-trace'
        ? casesById.get(cell.caseId).recordedTraceFingerprint
        : measurement.modelConfigFingerprint,
      settledBefore: settledBefore(report, attempt),
      preflightEvidence: attempt?.preflightEvidence,
    });
  });
  const matrix = {
    schemaVersion: 'scenario-lab.variance-matrix.v1',
    matrixRevision: `${MATRIX_REVISION}.${plan.workspaceSourceFingerprint.slice(0, 16)}`,
    matrixHash: '',
    candidateCommit: plan.candidateCommit,
    cases,
    observations,
  };
  matrix.matrixHash = computeVarianceMatrixHash(matrix);
  const diagnostics = validateVarianceMatrix(matrix);
  if (diagnostics.length) throw new Error(`Assembled variance matrix is invalid: ${canonicalJson(diagnostics)}`);
  const report = analyzeVarianceMatrix(matrix);
  if (!report.valid || !report.complete) {
    throw new Error(`Assembled variance report is incomplete: ${canonicalJson(report.diagnostics)}`);
  }
  return { matrix, report };
}

async function prepareOutput(outputDirectory, plan) {
  const resolved = path.resolve(outputDirectory);
  await mkdir(path.dirname(resolved), { recursive: true });
  await mkdir(resolved, { recursive: true });
  const planPath = path.join(resolved, 'variance-plan.v1.json');
  try {
    const existing = await readJson(planPath);
    if (canonicalJson(existing) !== canonicalJson(plan)) {
      throw new Error('The existing output directory belongs to a different matrix or source snapshot.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeJsonExclusive(planPath, plan);
  }
  return resolved;
}

async function runMatrix(plan, context, outputDirectory, requestedCell = null) {
  const resolvedOutput = await prepareOutput(outputDirectory, plan);
  const selectedCells = selectVariancePlanCells(plan, requestedCell);
  const finalMatrixPath = path.join(resolvedOutput, 'variance-matrix.v1.json');
  try {
    const existingMatrix = await readJson(finalMatrixPath);
    const diagnostics = validateVarianceMatrix(existingMatrix);
    const existingReport = analyzeVarianceMatrix(existingMatrix);
    if (diagnostics.length || !existingReport.valid || !existingReport.complete) {
      throw new Error('The existing final matrix artifact is invalid or incomplete.');
    }
    return {
      outputDirectory: resolvedOutput,
      matrix: existingMatrix,
      report: existingReport,
      completedCells: plan.totalCells,
      reused: true,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let executedCells = 0;
  for (const cell of selectedCells) {
    const cellDirectory = path.join(resolvedOutput, 'raw', cell.runId);
    let execution = await existingCellReport(cell, cellDirectory);
    if (!execution) {
      await writeState(resolvedOutput, {
        schemaVersion: 'scenario-lab.variance-acquisition-state.v1',
        status: 'active',
        completedCells: 0,
        totalCells: plan.totalCells,
        activeCell: cell.runId,
      });
      execution = await executeCell(cell, context, resolvedOutput);
      executedCells += 1;
      if (execution.providerFailure) {
        await writeState(resolvedOutput, {
          schemaVersion: 'scenario-lab.variance-acquisition-state.v1',
          status: 'provider-failure',
          completedCells: 0,
          totalCells: plan.totalCells,
          activeCell: cell.runId,
          providerFailure: execution.providerFailure,
        });
        throw new Error(
          `Terminal provider failure for ${cell.runId}: ${canonicalJson(execution.providerFailure)}. No retry or fallback was attempted.`,
        );
      }
      try {
        provisionalObservation(cell, execution.report);
      } catch (error) {
        await writeState(resolvedOutput, {
          schemaVersion: 'scenario-lab.variance-acquisition-state.v1',
          status: 'cell-evidence-invalid',
          completedCells: 0,
          totalCells: plan.totalCells,
          activeCell: cell.runId,
          error: String(error?.message || error),
        });
        throw error;
      }
    }
  }

  const reports = [];
  for (const cell of plan.cells) {
    const existing = await existingCellReport(cell, path.join(resolvedOutput, 'raw', cell.runId));
    if (existing) reports.push({ cell, report: existing.report });
  }
  if (reports.length !== plan.totalCells) {
    await writeState(resolvedOutput, {
      schemaVersion: 'scenario-lab.variance-acquisition-state.v1',
      status: 'partial',
      completedCells: reports.length,
      totalCells: plan.totalCells,
      selectedCells: selectedCells.map(cell => cell.runId),
    });
    return {
      outputDirectory: resolvedOutput,
      matrix: null,
      report: null,
      completedCells: reports.length,
      reused: executedCells === 0,
    };
  }

  const artifacts = assembleVarianceArtifacts({ plan, reports });
  await writeJsonExclusive(finalMatrixPath, artifacts.matrix);
  await writeJsonExclusive(path.join(resolvedOutput, 'variance-report.v1.json'), artifacts.report);
  await writeState(resolvedOutput, {
    schemaVersion: 'scenario-lab.variance-acquisition-state.v1',
    status: 'complete',
    completedCells: reports.length,
    totalCells: plan.totalCells,
    matrixHash: artifacts.matrix.matrixHash,
  });
  return { outputDirectory: resolvedOutput, ...artifacts, completedCells: reports.length, reused: executedCells === 0 };
}

export async function runVarianceMatrixCli(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const context = await resolveVarianceAcquisitionContext(options.fixtureRoot);
  const plan = createVarianceAcquisitionPlan({ trials: options.trials, context });
  if (options.command === 'plan') {
    process.stdout.write(`${canonicalJson(plan)}\n`);
    return 0;
  }
  const result = await runMatrix(plan, context, options.outputDirectory, options.cell);
  process.stdout.write(`${canonicalJson({
    schemaVersion: 'scenario-lab.variance-acquisition-result.v1',
    ok: true,
    outputDirectory: result.outputDirectory,
    status: result.matrix ? 'complete' : 'partial',
    completedCells: result.completedCells,
    totalCells: plan.totalCells,
    matrixHash: result.matrix?.matrixHash || null,
    verdict: result.report?.verdict || null,
    reused: result.reused,
  })}\n`);
  return 0;
}

const invokedAsCli = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsCli) {
  try {
    process.exitCode = await runVarianceMatrixCli();
  } catch (error) {
    process.stdout.write(`${canonicalJson({
      schemaVersion: 'scenario-lab.variance-acquisition-result.v1',
      ok: false,
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  }
}
