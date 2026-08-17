import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../a0/aggregate.mjs';
import {
  createExecutionPlan,
  createExecutionResult,
  loadScenarioManifest,
  validateScenarioManifest,
} from '../../scenario-lab.mjs';
import {
  aggregateFollowFieldObservations,
  observeFollowFieldRun,
} from './follow-field-evidence.mjs';

const DEFAULT_SCENARIO_ID = 'doorway-corridor-follow';
const ADAPTER_ID = 'follow-field-live-replay-v1';
// Which physical course each registered scenario lays. Both are driven by the
// same adapter and worker; they differ only in the geometry provisioned.
const SCENARIO_COURSE = Object.freeze({
  'doorway-corridor-follow': 'doorway-corridor',
  'obstruction-follow': 'obstruction-follow',
  'deliver-item-goal': 'deliver-item',
});
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(SCRIPT_DIRECTORY, 'follow-field-worker.ps1');

function parseOptions(argv) {
  if (argv.length % 2 !== 0) throw new Error('Arguments must be flag/value pairs.');
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--output-dir', '--fixture-root', '--manifest', '--regression-mode', '--scenario'].includes(flag) || Object.hasOwn(options, flag)) {
      throw new Error(`Unsupported or repeated option: ${flag}`);
    }
    options[flag] = argv[index + 1];
  }
  if (!options['--output-dir']) throw new Error('--output-dir is required.');
  return options;
}

function boundedAppend(current, chunk, limit = 131072) {
  const next = current + String(chunk);
  return next.length <= limit ? next : next.slice(next.length - limit);
}

function terminateProcessTree(child) {
  if (globalThis.process.platform !== 'win32' || !Number.isInteger(child.pid)) {
    child.kill('SIGTERM');
    return;
  }
  const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  terminator.once('error', () => child.kill());
  terminator.once('exit', (exitCode) => {
    if (exitCode !== 0) child.kill();
  });
}

function spawnBounded(command, args, { cwd, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = boundedAppend(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: String(error?.message || error),
      });
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, signal, timedOut, stdout, stderr, error: null });
    });
  });
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function executeInvocation({
  invocation,
  plan,
  outputDirectory,
  fixtureRoot,
  repo,
  regressionMode = false,
  course = 'doorway-corridor',
}) {
  const invocationDirectory = path.join(
    outputDirectory,
    'raw',
    invocation.invocationId.replace(/[^a-z0-9._-]+/gi, '_'),
  );
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', WORKER,
    '-RequestForm', invocation.form,
    '-RequestMessage', invocation.request,
    '-OutputDirectory', invocationDirectory,
    '-ExpectedCandidateCommit', plan.candidateCommit,
    '-ExpectedFixtureHash', plan.world.fixtureHash,
    '-ExpectedSeed', String(plan.seed),
    '-TimeoutMs', String(plan.timeoutMs),
    '-InstrumentationMode', plan.instrumentationMode,
  ];
  if (fixtureRoot) args.push('-FixtureRoot', fixtureRoot);
  // Keeps the bound-file and clean-tree hashes as recorded evidence instead of
  // aborting, so this scenario can gate ordinary development rather than
  // certifying exactly one frozen commit.
  if (regressionMode) args.push('-RegressionMode');
  args.push('-Course', course);

  const processResult = await spawnBounded('powershell.exe', args, {
    cwd: repo,
    timeoutMs: plan.timeoutMs + 300000,
  });
  await writeFile(
    path.join(invocationDirectory, 'adapter-process.json'),
    `${canonicalJson(processResult)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  ).catch(async (error) => {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(invocationDirectory, { recursive: true });
    await writeFile(
      path.join(invocationDirectory, 'adapter-process.json'),
      `${canonicalJson(processResult)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  });

  let report;
  try {
    report = await readJson(path.join(invocationDirectory, 'live-report.json'));
  } catch (error) {
    report = {
      request_form: invocation.form,
      status: 'failed',
      error: `Worker did not produce a readable report: ${String(error?.message || error)}`,
      conflict: processResult.error !== null,
      verdict: { duration_ms: 0 },
      cleanup: null,
      finished_utc: null,
      harness_evidence: null,
    };
  }
  if (processResult.timedOut) {
    report.status = 'failed';
    report.error = 'Scenario adapter exceeded its bounded process timeout.';
    report.verdict = { ...(report.verdict || {}), duration_ms: plan.timeoutMs + 1 };
  } else if (
    processResult.error !== null
    || processResult.exitCode !== 0
    || processResult.signal !== null
  ) {
    report.status = 'failed';
    report.error = [
      'Scenario worker process did not complete cleanly',
      'exit=' + String(processResult.exitCode),
      'signal=' + String(processResult.signal),
      'error=' + String(processResult.error),
    ].join('; ');
  }
  const observation = observeFollowFieldRun(report, plan.timeoutMs, plan.instrumentationMode);
  return { invocation, processResult, report, observation };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const manifest = await loadScenarioManifest(options['--manifest']);
  const diagnostics = validateScenarioManifest(manifest);
  if (diagnostics.length) {
    throw new Error(`Scenario manifest is invalid: ${canonicalJson(diagnostics)}`);
  }
  const scenarioId = options['--scenario'] || DEFAULT_SCENARIO_ID;
  if (!Object.hasOwn(SCENARIO_COURSE, scenarioId)) {
    throw new Error(`Unknown scenario '${scenarioId}'. Known: ${Object.keys(SCENARIO_COURSE).join(', ')}`);
  }
  const course = SCENARIO_COURSE[scenarioId];
  const plan = createExecutionPlan(manifest, scenarioId);
  if (
    plan.status !== 'not-run'
    || plan.executor?.safe !== true
    || plan.executor?.adapterId !== ADAPTER_ID
  ) {
    throw new Error(`Scenario '${scenarioId}' is not registered to this safe adapter.`);
  }

  const outputDirectory = path.resolve(options['--output-dir']);
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  await writeFile(
    path.join(outputDirectory, `${scenarioId}.plan.v1.json`),
    `${canonicalJson(plan)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );

  const executions = [];
  for (const invocation of plan.invocations) {
    const execution = await executeInvocation({
      invocation,
      plan,
      outputDirectory,
      fixtureRoot: options['--fixture-root'],
      repo,
      regressionMode: /^(1|true|yes|on)$/i.test(String(options['--regression-mode'] ?? '')),
      course,
    });
    executions.push(execution);
    if (execution.observation.safetyInvariantViolations.includes('runtime-restoration-required')) break;
  }

  const observation = aggregateFollowFieldObservations(
    plan,
    executions.map(({ observation: item }) => item),
  );
  const result = createExecutionResult(manifest, scenarioId, observation);
  const resultFile = `${scenarioId}.result.v1.json`;
  await writeFile(
    path.join(outputDirectory, resultFile),
    `${canonicalJson(result)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  await writeFile(
    path.join(outputDirectory, 'run-summary.v1.json'),
    `${canonicalJson({
      schemaVersion: 'scenario-lab.follow-field-run.v1',
      scenarioId,
      manifest: plan.manifest,
      planHash: plan.planHash,
      instrumentationMode: plan.instrumentationMode,
      resultStatus: result.status,
      invocations: executions.map(({ invocation, processResult, observation: item }) => ({
        invocationId: invocation.invocationId,
        form: invocation.form,
        processExitCode: processResult.exitCode,
        processTimedOut: processResult.timedOut,
        observation: item,
      })),
    })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );

  process.stdout.write(`${canonicalJson({
    schemaVersion: 'scenario-lab.cli-result.v1',
    command: 'follow-field-live-replay',
    ok: result.status === 'passed',
    status: result.status,
    outputDirectory,
    resultFile,
  })}\n`);
  return result.status === 'passed' ? 0 : 4;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stdout.write(`${canonicalJson({
    schemaVersion: 'scenario-lab.cli-result.v1',
    command: 'follow-field-live-replay',
    ok: false,
    status: 'blocked',
    diagnostics: [{
      path: '/adapter',
      code: 'adapter-failed',
      message: String(error?.message || error).slice(0, 1000),
    }],
  })}\n`);
  process.exitCode = 2;
}
