import { mkdir, open as openFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, computeManifestHash, sha256 } from './a0/aggregate.mjs';

export const MANIFEST_VERSION = 'scenario-lab.manifest.v1';
export const STATUSES = Object.freeze(['unavailable', 'not-run', 'blocked', 'failed', 'passed']);
export const FAMILIES = Object.freeze([
  'autonomous-wood-to-stone-no-safe-stance-recovery',
  'chunk-unloaded-confirmed-air-semantics',
  // A typed goal end to end: acquire an item and physically hand it to the
  // player. Both follow families issue !followPlayer, so nothing runnable
  // exercised goal-director at all -- which is what blocked the lane collapse.
  // Runs on a generated flat world; the captured follow world is an island and
  // acquisition drowns in it. See tools/scenario-lab/fixtures/.
  'deliver-item-goal',
  'doorway-corridor-follow',
  'elevation-follow',
  // Following a player when terrain is in the way. The doorway-corridor family
  // runs on open ground and passes identically with digging disabled, so it
  // cannot catch a companion that has lost the ability to break a block to
  // reach its player. This family exists to cover that.
  'obstruction-follow',
  'operator-stop-quiescence',
  // Plain language against a reduced command surface. The only scenario that
  // tests whether the LLM orchestrates primitives or routes to a procedure.
  'orchestration-charcoal',
]);
export const DEFAULT_MANIFEST_PATH = fileURLToPath(
  new URL('./scenario-lab/scenarios.v1.json', import.meta.url),
);

const DECLARATION_STATUSES = ['unavailable', 'not-run', 'blocked'];
const FORMS = ['direct', 'natural-language'];
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]*$/;
const TEXT = /^\S(?:[\s\S]*\S)?$/;
const SIGNED_SEED = /^-?(?:0|[1-9]\d*)$/;
const MIN_SIGNED_64 = -(1n << 63n);
const MAX_SIGNED_64 = (1n << 63n) - 1n;

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checker() {
  const errors = [];
  const add = (pathname, code, message) => errors.push({ path: pathname, code, message });
  const object = (value, pathname, keys) => {
    if (!plain(value)) {
      add(pathname, 'type', 'must be an object');
      return false;
    }
    for (const key of keys) if (!Object.hasOwn(value, key)) add(`${pathname}/${key}`, 'required', 'is required');
    for (const key of Object.keys(value)) if (!keys.includes(key)) add(`${pathname}/${key}`, 'additional-property', 'is not allowed');
    return true;
  };
  const string = (value, pathname, { min = 1, max = 512, pattern = null } = {}) => {
    if (typeof value !== 'string') {
      add(pathname, 'type', 'must be a string');
      return false;
    }
    if (value.length < min || value.length > max) add(pathname, 'bounds', `length must be ${min}..${max}`);
    if (pattern && !pattern.test(value)) add(pathname, 'pattern', 'has an invalid format');
    return true;
  };
  const integer = (value, pathname, min, max, safe = false) => {
    if (!Number.isInteger(value) || (safe && !Number.isSafeInteger(value))) {
      add(pathname, 'type', `must be a${safe ? ' safe' : 'n'} integer`);
      return false;
    }
    if (value < min || value > max) add(pathname, 'bounds', `must be ${min}..${max}`);
    return true;
  };
  const array = (value, pathname, min, max) => {
    if (!Array.isArray(value)) {
      add(pathname, 'type', 'must be an array');
      return false;
    }
    if (value.length < min || value.length > max) add(pathname, 'bounds', `item count must be ${min}..${max}`);
    return true;
  };
  const enumeration = (value, pathname, values) => {
    if (!values.includes(value)) {
      add(pathname, 'enum', `must be one of ${values.join(', ')}`);
      return false;
    }
    return true;
  };
  return { errors, add, object, string, integer, array, enumeration };
}

function validateIdList(value, pathname, c) {
  if (!c.array(value, pathname, 1, 64)) return;
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${pathname}/${index}`;
    if (c.string(item, itemPath, { max: 96, pattern: ID })) {
      if (seen.has(item)) c.add(itemPath, 'duplicate-id', 'must not duplicate another item');
      seen.add(item);
    }
  });
}

function validateBlockers(value, pathname, c) {
  if (!c.array(value, pathname, 0, 16)) return;
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${pathname}/${index}`;
    if (!c.object(item, itemPath, ['code', 'detail'])) return;
    if (c.string(item.code, `${itemPath}/code`, { max: 96, pattern: ID })) {
      if (seen.has(item.code)) c.add(`${itemPath}/code`, 'duplicate-id', 'must not duplicate another blocker');
      seen.add(item.code);
    }
    c.string(item.detail, `${itemPath}/detail`, { max: 512, pattern: TEXT });
  });
}

function validateServer(value, pathname, c) {
  if (!c.object(value, pathname, ['implementation', 'version', 'protocolVersion'])) return;
  if (value.implementation !== 'paper') c.add(`${pathname}/implementation`, 'const', 'must equal paper');
  c.string(value.version, `${pathname}/version`, { max: 96, pattern: /^\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?$/ });
  c.integer(value.protocolVersion, `${pathname}/protocolVersion`, 1, 100000);
}

function validateSeed(value, pathname, c) {
  if (Number.isSafeInteger(value)) return;
  if (typeof value !== 'string' || !SIGNED_SEED.test(value)) {
    c.add(pathname, 'type', 'must be a safe integer or signed 64-bit decimal string');
    return;
  }
  try {
    const seed = BigInt(value);
    if (seed < MIN_SIGNED_64 || seed > MAX_SIGNED_64) {
      c.add(pathname, 'bounds', 'must fit a signed 64-bit Minecraft seed');
    }
  } catch {
    c.add(pathname, 'type', 'must be a safe integer or signed 64-bit decimal string');
  }
}

function validateWorld(value, pathname, c) {
  if (!c.object(value, pathname, ['worldId', 'fixtureId', 'fixtureVersion', 'fixtureHash', 'dimension'])) return;
  if (value.worldId !== null) c.string(value.worldId, `${pathname}/worldId`, { max: 96, pattern: ID });
  if (value.fixtureId !== null) c.string(value.fixtureId, `${pathname}/fixtureId`, { max: 96, pattern: ID });
  c.integer(value.fixtureVersion, `${pathname}/fixtureVersion`, 1, 10000);
  if (value.fixtureHash !== null) c.string(value.fixtureHash, `${pathname}/fixtureHash`, { min: 64, max: 64, pattern: HEX64 });
  c.enumeration(value.dimension, `${pathname}/dimension`, ['overworld', 'the_nether', 'the_end']);
  if (value.worldId === null && value.fixtureId === null) c.add(pathname, 'relationship', 'must identify a world or fixture');
}

function validateRequests(value, pathname, c) {
  if (!c.array(value, pathname, 2, 2)) return;
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${pathname}/${index}`;
    if (!c.object(item, itemPath, ['form', 'request', 'repetitions'])) return;
    if (c.enumeration(item.form, `${itemPath}/form`, FORMS)) {
      if (seen.has(item.form)) c.add(`${itemPath}/form`, 'duplicate-id', 'must not duplicate another request form');
      seen.add(item.form);
    }
    c.string(item.request, `${itemPath}/request`, { max: 512, pattern: TEXT });
    c.integer(item.repetitions, `${itemPath}/repetitions`, 1, 100);
  });
  for (const form of FORMS) if (!seen.has(form)) c.add(pathname, 'required-form', `must include ${form}`);
}

function validateExecutor(value, pathname, c) {
  if (!c.object(value, pathname, ['adapterId', 'safe', 'command', 'evidenceAdapterId'])) return;
  if (value.adapterId !== null) c.string(value.adapterId, `${pathname}/adapterId`, { max: 96, pattern: ID });
  if (typeof value.safe !== 'boolean') c.add(`${pathname}/safe`, 'type', 'must be a boolean');
  if (value.command !== null && c.array(value.command, `${pathname}/command`, 1, 32)) {
    value.command.forEach((item, index) => c.string(item, `${pathname}/command/${index}`, { max: 240, pattern: TEXT }));
  }
  if (value.evidenceAdapterId !== null) {
    c.string(value.evidenceAdapterId, `${pathname}/evidenceAdapterId`, { max: 96, pattern: ID });
  }
}

function validateScenario(value, pathname, c) {
  const keys = [
    'id', 'family', 'title', 'status', 'seed', 'world', 'timeoutMs', 'requestForms',
    'expectedEvidence', 'safetyInvariants', 'executor', 'blockers',
  ];
  if (!c.object(value, pathname, keys)) return;
  c.string(value.id, `${pathname}/id`, { max: 96, pattern: ID });
  c.enumeration(value.family, `${pathname}/family`, FAMILIES);
  c.string(value.title, `${pathname}/title`, { max: 160, pattern: TEXT });
  c.enumeration(value.status, `${pathname}/status`, DECLARATION_STATUSES);
  validateSeed(value.seed, `${pathname}/seed`, c);
  validateWorld(value.world, `${pathname}/world`, c);
  c.integer(value.timeoutMs, `${pathname}/timeoutMs`, 1000, 3600000);
  validateRequests(value.requestForms, `${pathname}/requestForms`, c);
  validateIdList(value.expectedEvidence, `${pathname}/expectedEvidence`, c);
  validateIdList(value.safetyInvariants, `${pathname}/safetyInvariants`, c);
  validateExecutor(value.executor, `${pathname}/executor`, c);
  validateBlockers(value.blockers, `${pathname}/blockers`, c);

  if (value.status === 'unavailable' && plain(value.executor)) {
    if (value.executor.safe !== false) c.add(`${pathname}/executor/safe`, 'relationship', 'must be false when unavailable');
    for (const field of ['adapterId', 'command', 'evidenceAdapterId']) {
      if (value.executor[field] !== null) c.add(`${pathname}/executor/${field}`, 'relationship', 'must be null when unavailable');
    }
  }
  if (['unavailable', 'blocked'].includes(value.status) && Array.isArray(value.blockers) && value.blockers.length === 0) {
    c.add(`${pathname}/blockers`, 'relationship', `must be non-empty when ${value.status}`);
  }
  if (value.status === 'not-run') {
    if (!plain(value.executor) || value.executor.safe !== true) c.add(`${pathname}/executor/safe`, 'relationship', 'must identify a safe executor when not-run');
    if (!plain(value.executor) || typeof value.executor.adapterId !== 'string') c.add(`${pathname}/executor/adapterId`, 'relationship', 'must identify an adapter when not-run');
    if (!plain(value.executor) || !Array.isArray(value.executor.command)) c.add(`${pathname}/executor/command`, 'relationship', 'must be an argv array when not-run');
    if (!plain(value.executor) || typeof value.executor.evidenceAdapterId !== 'string') c.add(`${pathname}/executor/evidenceAdapterId`, 'relationship', 'must identify an evidence adapter when not-run');
    if (!plain(value.world) || !HEX64.test(value.world.fixtureHash ?? '')) c.add(`${pathname}/world/fixtureHash`, 'relationship', 'must freeze the fixture when not-run');
    if (Array.isArray(value.blockers) && value.blockers.length !== 0) c.add(`${pathname}/blockers`, 'relationship', 'must be empty when not-run');
  }
}

export function computeScenarioManifestHash(manifest) {
  return computeManifestHash(manifest);
}

export function validateScenarioManifest(manifest) {
  const c = checker();
  const keys = [
    'schemaVersion', 'manifestRevision', 'manifestHash', 'title', 'candidateCommit',
    'server', 'instrumentationMode', 'statusVocabulary', 'scenarios',
  ];
  if (!c.object(manifest, '', keys)) return c.errors;
  if (manifest.schemaVersion !== MANIFEST_VERSION) c.add('/schemaVersion', 'const', `must equal ${MANIFEST_VERSION}`);
  c.string(manifest.manifestRevision, '/manifestRevision', { max: 96, pattern: ID });
  c.string(manifest.manifestHash, '/manifestHash', { min: 64, max: 64, pattern: HEX64 });
  c.string(manifest.title, '/title', { max: 512, pattern: TEXT });
  c.string(manifest.candidateCommit, '/candidateCommit', { min: 40, max: 40, pattern: HEX40 });
  validateServer(manifest.server, '/server', c);
  c.enumeration(manifest.instrumentationMode, '/instrumentationMode', ['off', 'on']);
  if (c.array(manifest.statusVocabulary, '/statusVocabulary', STATUSES.length, STATUSES.length)) {
    STATUSES.forEach((status, index) => {
      if (manifest.statusVocabulary[index] !== status) c.add(`/statusVocabulary/${index}`, 'const', `must equal ${status}`);
    });
  }

  if (c.array(manifest.scenarios, '/scenarios', FAMILIES.length, FAMILIES.length)) {
    const ids = new Set();
    const families = new Set();
    manifest.scenarios.forEach((scenario, index) => {
      const pathname = `/scenarios/${index}`;
      validateScenario(scenario, pathname, c);
      if (!plain(scenario)) return;
      if (ids.has(scenario.id)) c.add(`${pathname}/id`, 'duplicate-id', 'must not duplicate another scenario id');
      ids.add(scenario.id);
      if (families.has(scenario.family)) c.add(`${pathname}/family`, 'duplicate-family', 'must not duplicate another family');
      families.add(scenario.family);
    });
    for (const family of FAMILIES) if (!families.has(family)) c.add('/scenarios', 'missing-family', `must include ${family}`);
  }

  if (HEX64.test(manifest.manifestHash ?? '')) {
    let computed = null;
    try {
      computed = computeScenarioManifestHash(manifest);
    } catch {
      computed = null;
    }
    if (computed !== manifest.manifestHash) c.add('/manifestHash', 'hash-mismatch', `must equal ${computed ?? 'the canonical manifest SHA-256'}`);
  }
  return c.errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

export async function loadScenarioManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'));
}

function assertValid(manifest) {
  const diagnostics = validateScenarioManifest(manifest);
  if (diagnostics.length) {
    const error = new Error('Scenario manifest validation failed');
    error.code = 'SCENARIO_MANIFEST_INVALID';
    error.diagnostics = diagnostics;
    throw error;
  }
}

function scenarioById(manifest, scenarioId) {
  const scenario = manifest.scenarios.find(({ id }) => id === scenarioId);
  if (!scenario) {
    const error = new Error(`Unknown scenario: ${scenarioId}`);
    error.code = 'SCENARIO_NOT_FOUND';
    throw error;
  }
  return scenario;
}

const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b));
const identity = (manifest) => ({
  schemaVersion: manifest.schemaVersion,
  manifestRevision: manifest.manifestRevision,
  manifestHash: manifest.manifestHash,
});

export function createScenarioList(manifest) {
  assertValid(manifest);
  return {
    schemaVersion: 'scenario-lab.list.v1',
    manifest: identity(manifest),
    candidateCommit: manifest.candidateCommit,
    statuses: [...STATUSES],
    scenarios: [...manifest.scenarios]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, family, status, requestForms }) => ({
        id,
        family,
        status,
        requestForms: requestForms
          .map(({ form, repetitions }) => ({ form, repetitions }))
          .sort((a, b) => a.form.localeCompare(b.form)),
      })),
  };
}

export function createExecutionPlan(manifest, scenarioId) {
  assertValid(manifest);
  const scenario = scenarioById(manifest, scenarioId);
  const invocations = [...scenario.requestForms]
    .sort((a, b) => a.form.localeCompare(b.form))
    .flatMap((requestForm) => Array.from({ length: requestForm.repetitions }, (_, index) => ({
      invocationId: `${scenario.id}:${requestForm.form}:${index + 1}`,
      form: requestForm.form,
      request: requestForm.request,
      repetition: index + 1,
    })));
  const plan = {
    schemaVersion: 'scenario-lab.execution-plan.v1',
    manifest: identity(manifest),
    scenarioId: scenario.id,
    family: scenario.family,
    candidateCommit: manifest.candidateCommit,
    status: scenario.status,
    seed: scenario.seed,
    server: structuredClone(manifest.server),
    world: structuredClone(scenario.world),
    timeoutMs: scenario.timeoutMs,
    instrumentationMode: manifest.instrumentationMode,
    invocations,
    expectedEvidence: sorted(scenario.expectedEvidence),
    safetyInvariants: sorted(scenario.safetyInvariants),
    executor: structuredClone(scenario.executor),
    blockers: structuredClone(scenario.blockers),
  };
  return { ...plan, planHash: sha256(canonicalJson(plan)) };
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return sorted([...new Set(value.filter((item) => typeof item === 'string' && ID.test(item)))]);
}

function outcome(observation, accepted) {
  const boolean = (field) => (accepted && typeof observation[field] === 'boolean' ? observation[field] : null);
  return {
    success: boolean('success'),
    unsafe: boolean('unsafe'),
    death: boolean('death'),
    conflict: boolean('conflict'),
    timeout: boolean('timeout'),
    retryCount: accepted && Number.isInteger(observation.retryCount) && observation.retryCount >= 0 ? observation.retryCount : null,
    terminalReason: accepted && typeof observation.terminalReason === 'string' && TEXT.test(observation.terminalReason) ? observation.terminalReason : null,
    elapsedMs: accepted && Number.isFinite(observation.elapsedMs) && observation.elapsedMs >= 0 ? observation.elapsedMs : null,
  };
}

export function createExecutionResult(manifest, scenarioId, observation = {}) {
  const plan = createExecutionPlan(manifest, scenarioId);
  const scenario = scenarioById(manifest, scenarioId);
  const adapterReady = scenario.executor.safe === true
    && typeof scenario.executor.adapterId === 'string'
    && Array.isArray(scenario.executor.command)
    && typeof scenario.executor.evidenceAdapterId === 'string';
  const executed = scenario.status === 'not-run' && adapterReady && observation.executed === true;
  const observedEvidence = executed ? normalizeIds(observation.observedEvidence) : [];
  const missingEvidence = plan.expectedEvidence.filter((item) => !observedEvidence.includes(item));
  const safetyReported = executed && Array.isArray(observation.safetyInvariantViolations);
  const safetyViolations = safetyReported ? normalizeIds(observation.safetyInvariantViolations) : [];
  const completedInvocationCount = executed && Number.isInteger(observation.completedInvocationCount)
    ? observation.completedInvocationCount
    : 0;
  const facts = outcome(observation, executed);
  const missingFields = [];
  if (!adapterReady) missingFields.push('/executor');
  if (completedInvocationCount !== plan.invocations.length) missingFields.push('/completedInvocationCount');
  if (!safetyReported) missingFields.push('/safetyInvariantViolations');
  for (const [field, value] of Object.entries(facts)) if (value === null) missingFields.push(`/${field}`);
  for (const evidenceId of missingEvidence) missingFields.push(`/expectedEvidence/${evidenceId}`);

  const complete = executed
    && completedInvocationCount === plan.invocations.length
    && missingEvidence.length === 0
    && safetyReported
    && Object.values(facts).every((value) => value !== null);
  let status;
  if (scenario.status === 'unavailable') status = 'unavailable';
  else if (scenario.status === 'blocked') status = 'blocked';
  else if (!adapterReady) status = 'unavailable';
  else if (!executed) status = 'not-run';
  else {
    status = complete
      && safetyViolations.length === 0
      && facts.success === true
      && facts.unsafe === false
      && facts.death === false
      && facts.conflict === false
      && facts.timeout === false
      ? 'passed'
      : 'failed';
  }

  return {
    schemaVersion: 'scenario-lab.result.v1',
    manifest: identity(manifest),
    scenarioId: scenario.id,
    family: scenario.family,
    candidateCommit: manifest.candidateCommit,
    planHash: plan.planHash,
    status,
    classificationReason: ['unavailable', 'not-run', 'blocked'].includes(status)
      ? status
      : (status === 'passed' ? 'verified-complete' : (missingEvidence.length ? 'required-evidence-missing' : 'execution-failed')),
    plannedInvocationCount: plan.invocations.length,
    completedInvocationCount,
    evidenceCompleteness: complete ? 'complete' : 'incomplete',
    missingFields: sorted([...new Set(missingFields)]),
    expectedEvidence: plan.expectedEvidence,
    observedEvidence,
    missingEvidence,
    safetyInvariants: plan.safetyInvariants,
    safetyInvariantViolations: safetyViolations,
    ...facts,
    blockers: structuredClone(scenario.blockers),
    liveScenarioPassed: status === 'passed',
    labComplete: false,
  };
}

async function writeExclusivePair(entries) {
  const opened = [];
  try {
    for (const entry of entries) opened.push({ ...entry, handle: await openFile(entry.path, 'wx') });
    for (const entry of opened) await entry.handle.writeFile(entry.contents, 'utf8');
    for (const entry of opened) await entry.handle.close();
  } catch (error) {
    for (const entry of opened) {
      try {
        await entry.handle.close();
      } catch {
        // Preserve the original error.
      }
      try {
        await unlink(entry.path);
      } catch {
        // Only files exclusively created here are eligible for rollback.
      }
    }
    throw error;
  }
}

export async function writeExecutionArtifacts(manifest, scenarioId, outputDirectory) {
  const plan = createExecutionPlan(manifest, scenarioId);
  const result = createExecutionResult(manifest, scenarioId);
  const planFile = `${scenarioId}.plan.v1.json`;
  const resultFile = `${scenarioId}.result.v1.json`;
  const directory = path.resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  await writeExclusivePair([
    { path: path.join(directory, planFile), contents: `${canonicalJson(plan)}\n` },
    { path: path.join(directory, resultFile), contents: `${canonicalJson(result)}\n` },
  ]);
  return { planFile, resultFile, status: result.status };
}

function failure(command, code, message, pathname = '/cli') {
  return {
    schemaVersion: 'scenario-lab.cli-result.v1',
    command: command ?? null,
    ok: false,
    diagnostics: [{ path: pathname, code, message }],
  };
}

function parseOptions(argv, allowed) {
  if (argv.length % 2) return { error: 'arguments must be flag/value pairs' };
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.includes(argv[index]) || Object.hasOwn(options, argv[index])) {
      return { error: 'arguments must be unique supported flag/value pairs' };
    }
    options[argv[index]] = argv[index + 1];
  }
  return { options };
}

async function loadForCli(manifestPath) {
  try {
    return { manifest: await loadScenarioManifest(manifestPath) };
  } catch (error) {
    return {
      error: failure(
        null,
        error instanceof SyntaxError ? 'malformed-json' : 'read-failed',
        error instanceof SyntaxError ? 'manifest must contain valid JSON' : 'manifest could not be read',
        '/manifest',
      ),
    };
  }
}

export async function runScenarioLabCli(
  argv = globalThis.process.argv.slice(2),
  stdout = globalThis.process.stdout,
) {
  const command = argv[0];
  const allowed = {
    list: ['--manifest'],
    validate: ['--manifest'],
    plan: ['--manifest', '--scenario', '--output-dir'],
  };
  if (!Object.hasOwn(allowed, command)) {
    stdout.write(`${canonicalJson(failure(command, 'usage', 'command must be list, validate, or plan'))}\n`);
    return 2;
  }
  const parsed = parseOptions(argv.slice(1), allowed[command]);
  if (parsed.error) {
    stdout.write(`${canonicalJson(failure(command, 'usage', parsed.error))}\n`);
    return 2;
  }
  if (command === 'plan' && (!parsed.options['--scenario'] || !parsed.options['--output-dir'])) {
    stdout.write(`${canonicalJson(failure(command, 'usage', 'plan requires --scenario and --output-dir'))}\n`);
    return 2;
  }

  const loaded = await loadForCli(parsed.options['--manifest'] ?? DEFAULT_MANIFEST_PATH);
  if (loaded.error) {
    loaded.error.command = command;
    stdout.write(`${canonicalJson(loaded.error)}\n`);
    return 2;
  }
  const diagnostics = validateScenarioManifest(loaded.manifest);
  if (command === 'validate') {
    stdout.write(`${canonicalJson({
      schemaVersion: 'scenario-lab.validation.v1',
      valid: diagnostics.length === 0,
      manifest: diagnostics.length === 0 ? identity(loaded.manifest) : null,
      scenarioCount: Array.isArray(loaded.manifest.scenarios) ? loaded.manifest.scenarios.length : 0,
      diagnostics,
    })}\n`);
    return diagnostics.length ? 2 : 0;
  }
  if (diagnostics.length) {
    stdout.write(`${canonicalJson({
      schemaVersion: 'scenario-lab.cli-result.v1',
      command,
      ok: false,
      diagnostics,
    })}\n`);
    return 2;
  }
  if (command === 'list') {
    stdout.write(`${canonicalJson(createScenarioList(loaded.manifest))}\n`);
    return 0;
  }

  try {
    const written = await writeExecutionArtifacts(
      loaded.manifest,
      parsed.options['--scenario'],
      parsed.options['--output-dir'],
    );
    stdout.write(`${canonicalJson({
      schemaVersion: 'scenario-lab.cli-result.v1',
      command,
      ok: written.status === 'passed',
      status: written.status,
      planFile: written.planFile,
      resultFile: written.resultFile,
    })}\n`);
    return written.status === 'passed' ? 0 : (written.status === 'failed' ? 4 : 3);
  } catch (error) {
    const code = error?.code === 'SCENARIO_NOT_FOUND'
      ? 'unknown-scenario'
      : (error?.code === 'EEXIST' ? 'artifact-exists' : 'artifact-write-failed');
    const messages = {
      'unknown-scenario': 'scenario id is not registered',
      'artifact-exists': 'execution artifacts already exist and will not be overwritten',
      'artifact-write-failed': 'execution artifacts could not be written',
    };
    stdout.write(`${canonicalJson(failure(command, code, messages[code]))}\n`);
    return 2;
  }
}

const invokedPath = globalThis.process.argv[1] ? path.resolve(globalThis.process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  globalThis.process.exitCode = await runScenarioLabCli();
}
