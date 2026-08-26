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
  // A valid break edge may cost more than the package's historical numeric
  // impossible sentinel. This course proves the edge remains selectable and
  // executable with an empty inventory and a slow hand break.
  'pathfinding-finite-break-cost',
  // When exact player arrival is physically impossible, finite navigation must
  // consume Pathfinder's best available route without claiming false arrival.
  'player-route-best-reachable',
  // Finite player-directed navigation must reach a stationary requester even
  // when the only route requires breaking ordinary terrain.
  'player-route-obstruction',
  // Phase 4 truth boundary: an unfinished whole-route search remains
  // explicitly unproven and cannot authorize movement or terrain mutation.
  'route-probe-inconclusive',
  // Phase 6 begins with the native water-ascent and dry-bank exit mechanism.
  // Both request transports carry the same explicit command so the probe does
  // not spend provider quota or confound locomotion with model interpretation.
  'terrain-swim-exit',
]);
export const DEFAULT_MANIFEST_PATH = fileURLToPath(
  new URL('./scenario-lab/scenarios.v1.json', import.meta.url),
);
export const VARIANCE_EXECUTION_MODES = Object.freeze(['recorded-trace', 'frozen-model']);
export const VARIANCE_TELEMETRY_MODES = Object.freeze(['off', 'on']);
export const VARIANCE_PREFLIGHT_MODES = Object.freeze(['off', 'on']);
// One observation cannot contain run-to-run variation. Two is the mathematical
// minimum for comparison, not a confidence or campaign quota; every additional
// independently supplied trial remains accepted and is included in the report.
export const MIN_INDEPENDENT_VARIANCE_TRIALS = 2; // Owner: comparison math; prevents a false variance claim from one observation.

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

const sortedDiagnostics = (diagnostics) => [...diagnostics].sort((left, right) => (
  left.path.localeCompare(right.path)
  || left.code.localeCompare(right.code)
  || left.message.localeCompare(right.message)
));

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

export function computeVarianceMatrixHash(matrix) {
  const withoutHash = { ...matrix };
  delete withoutHash.matrixHash;
  return sha256(Buffer.from(canonicalJson(withoutHash), 'utf8'));
}

function validateVarianceCase(value, pathname, c) {
  const keys = [
    'id',
    'fixtureFingerprint',
    'inputFingerprint',
    'recordedTraceFingerprint',
    'frozenModelFingerprint',
  ];
  if (!c.object(value, pathname, keys)) return;
  c.string(value.id, `${pathname}/id`, { max: Infinity, pattern: ID });
  for (const key of keys.slice(1)) {
    c.string(value[key], `${pathname}/${key}`, { min: 64, max: 64, pattern: HEX64 });
  }
}

function validateVarianceObservation(value, pathname, c) {
  const keys = [
    'runId',
    'caseId',
    'trial',
    'executionMode',
    'telemetryMode',
    'preflightMode',
    'resetId',
    'fixtureFingerprint',
    'inputFingerprint',
    'driverFingerprint',
    'modelOutputFingerprint',
    'modelRouteFingerprint',
    'decisionFingerprint',
    'preflightFingerprint',
    'lifecycleFingerprint',
    'outcomeFingerprint',
    'passed',
    'settledBefore',
    'settledAfter',
    'elapsedMs',
  ];
  if (!c.object(value, pathname, keys)) return;
  c.string(value.runId, `${pathname}/runId`, { max: Infinity, pattern: ID });
  c.string(value.caseId, `${pathname}/caseId`, { max: Infinity, pattern: ID });
  c.integer(value.trial, `${pathname}/trial`, 1, Number.MAX_SAFE_INTEGER, true);
  c.enumeration(value.executionMode, `${pathname}/executionMode`, VARIANCE_EXECUTION_MODES);
  c.enumeration(value.telemetryMode, `${pathname}/telemetryMode`, VARIANCE_TELEMETRY_MODES);
  c.enumeration(value.preflightMode, `${pathname}/preflightMode`, VARIANCE_PREFLIGHT_MODES);
  c.string(value.resetId, `${pathname}/resetId`, { max: Infinity, pattern: ID });
  for (const key of [
    'fixtureFingerprint',
    'inputFingerprint',
    'driverFingerprint',
    'decisionFingerprint',
    'outcomeFingerprint',
  ]) {
    c.string(value[key], `${pathname}/${key}`, { min: 64, max: 64, pattern: HEX64 });
  }
  for (const key of [
    'modelOutputFingerprint',
    'modelRouteFingerprint',
    'preflightFingerprint',
    'lifecycleFingerprint',
  ]) {
    if (value[key] !== null) {
      c.string(value[key], `${pathname}/${key}`, { min: 64, max: 64, pattern: HEX64 });
    }
  }
  for (const key of ['passed', 'settledBefore', 'settledAfter']) {
    if (typeof value[key] !== 'boolean') c.add(`${pathname}/${key}`, 'type', 'must be a boolean');
  }
  if (typeof value.elapsedMs !== 'number' || !Number.isFinite(value.elapsedMs)) {
    c.add(`${pathname}/elapsedMs`, 'type', 'must be a finite number');
  } else if (value.elapsedMs < 0) {
    c.add(`${pathname}/elapsedMs`, 'bounds', 'must be non-negative');
  }
}

const varianceCellKey = (observation, includeTrial = true) => [
  observation.caseId,
  ...(includeTrial ? [observation.trial] : []),
  observation.executionMode,
  observation.telemetryMode,
  observation.preflightMode,
].join('|');

export function validateVarianceMatrix(matrix) {
  const c = checker();
  const keys = [
    'schemaVersion',
    'matrixRevision',
    'matrixHash',
    'candidateCommit',
    'cases',
    'observations',
  ];
  if (!c.object(matrix, '/', keys)) return sortedDiagnostics(c.errors);
  c.string(matrix.schemaVersion, '/schemaVersion', { max: Infinity });
  if (matrix.schemaVersion !== 'scenario-lab.variance-matrix.v1') {
    c.add('/schemaVersion', 'const', 'must be scenario-lab.variance-matrix.v1');
  }
  c.string(matrix.matrixRevision, '/matrixRevision', { max: Infinity, pattern: TEXT });
  c.string(matrix.matrixHash, '/matrixHash', { min: 64, max: 64, pattern: HEX64 });
  c.string(matrix.candidateCommit, '/candidateCommit', { min: 40, max: 40, pattern: HEX40 });
  if (c.array(matrix.cases, '/cases', 1, Infinity)) {
    matrix.cases.forEach((item, index) => validateVarianceCase(item, `/cases/${index}`, c));
  }
  if (c.array(matrix.observations, '/observations', 1, Infinity)) {
    matrix.observations.forEach((item, index) => (
      validateVarianceObservation(item, `/observations/${index}`, c)
    ));
  }

  const cases = new Map();
  if (Array.isArray(matrix.cases)) {
    matrix.cases.forEach((item, index) => {
      if (!plain(item) || typeof item.id !== 'string') return;
      if (cases.has(item.id)) {
        c.add(`/cases/${index}/id`, 'duplicate-id', `duplicates ${cases.get(item.id).path}`);
      } else {
        cases.set(item.id, { ...item, path: `/cases/${index}` });
      }
    });
  }

  const seen = {
    runId: new Map(),
    resetId: new Map(),
    cell: new Map(),
  };
  if (Array.isArray(matrix.observations)) {
    matrix.observations.forEach((observation, index) => {
      if (!plain(observation)) return;
      const pathname = `/observations/${index}`;
      for (const key of ['runId', 'resetId']) {
        const value = observation[key];
        if (typeof value !== 'string') continue;
        if (seen[key].has(value)) {
          c.add(`${pathname}/${key}`, `duplicate-${key}`, `duplicates ${seen[key].get(value)}`);
        } else {
          seen[key].set(value, `${pathname}/${key}`);
        }
      }
      if (
        typeof observation.caseId === 'string'
        && Number.isInteger(observation.trial)
        && VARIANCE_EXECUTION_MODES.includes(observation.executionMode)
        && VARIANCE_TELEMETRY_MODES.includes(observation.telemetryMode)
        && VARIANCE_PREFLIGHT_MODES.includes(observation.preflightMode)
      ) {
        const key = varianceCellKey(observation);
        if (seen.cell.has(key)) {
          c.add(pathname, 'duplicate-cell', `duplicates ${seen.cell.get(key)}`);
        } else {
          seen.cell.set(key, pathname);
        }
      }

      const declared = cases.get(observation.caseId);
      if (!declared) {
        if (typeof observation.caseId === 'string') {
          c.add(`${pathname}/caseId`, 'unknown-case', 'must name a declared matrix case');
        }
        return;
      }
      for (const [field, expected] of [
        ['fixtureFingerprint', declared.fixtureFingerprint],
        ['inputFingerprint', declared.inputFingerprint],
      ]) {
        if (observation[field] !== expected) {
          c.add(`${pathname}/${field}`, 't0-contamination', `must match ${declared.path}/${field}`);
        }
      }
      const expectedDriver = observation.executionMode === 'recorded-trace'
        ? declared.recordedTraceFingerprint
        : declared.frozenModelFingerprint;
      if (observation.driverFingerprint !== expectedDriver) {
        c.add(`${pathname}/driverFingerprint`, 'driver-drift', 'must match the declared execution driver');
      }
      if (observation.executionMode === 'recorded-trace' && observation.modelOutputFingerprint !== null) {
        c.add(`${pathname}/modelOutputFingerprint`, 'relationship', 'must be null when no model is called');
      }
      if (observation.executionMode === 'recorded-trace' && observation.modelRouteFingerprint !== null) {
        c.add(`${pathname}/modelRouteFingerprint`, 'relationship', 'must be null when no model is called');
      }
      if (observation.executionMode === 'frozen-model' && !HEX64.test(observation.modelOutputFingerprint || '')) {
        c.add(`${pathname}/modelOutputFingerprint`, 'relationship', 'must fingerprint the observed model output');
      }
      if (observation.executionMode === 'frozen-model' && !HEX64.test(observation.modelRouteFingerprint || '')) {
        c.add(`${pathname}/modelRouteFingerprint`, 'relationship', 'must fingerprint the selected provider route');
      }
      if (observation.preflightMode === 'off' && observation.preflightFingerprint !== null) {
        c.add(`${pathname}/preflightFingerprint`, 'relationship', 'must be null when preflights are off');
      }
      if (observation.preflightMode === 'on' && !HEX64.test(observation.preflightFingerprint || '')) {
        c.add(`${pathname}/preflightFingerprint`, 'relationship', 'must fingerprint the observed preflight result');
      }
      if (observation.telemetryMode === 'off' && observation.lifecycleFingerprint !== null) {
        c.add(`${pathname}/lifecycleFingerprint`, 'relationship', 'must be null when lifecycle telemetry is off');
      }
      if (observation.telemetryMode === 'on' && !HEX64.test(observation.lifecycleFingerprint || '')) {
        c.add(`${pathname}/lifecycleFingerprint`, 'relationship', 'must fingerprint the observed lifecycle sequence');
      }
      if (observation.settledBefore !== true) {
        c.add(`${pathname}/settledBefore`, 'unsettled-boundary', 'the prior activity must be physically settled');
      }
      if (observation.settledAfter !== true) {
        c.add(`${pathname}/settledAfter`, 'unsettled-boundary', 'the measured activity must be physically settled');
      }
    });
  }

  if (HEX64.test(matrix.matrixHash || '')) {
    try {
      const computed = computeVarianceMatrixHash(matrix);
      if (computed !== matrix.matrixHash) {
        c.add('/matrixHash', 'hash-mismatch', `must equal ${computed}`);
      }
    } catch {
      c.add('/matrixHash', 'hash-unavailable', 'could not hash malformed matrix content');
    }
  }
  return sortedDiagnostics(c.errors);
}

const observationSort = (left, right) => (
  left.caseId.localeCompare(right.caseId)
  || left.trial - right.trial
  || left.executionMode.localeCompare(right.executionMode)
  || left.telemetryMode.localeCompare(right.telemetryMode)
  || left.preflightMode.localeCompare(right.preflightMode)
  || left.runId.localeCompare(right.runId)
);

const distinct = (rows, field) => new Set(rows.map((row) => row[field]));

function sourceSignal(source, evidence, complete) {
  return {
    source,
    status: evidence.length ? 'supported' : (complete ? 'not-observed' : 'unmeasured'),
    evidence,
  };
}

export function analyzeVarianceMatrix(matrix) {
  const validation = validateVarianceMatrix(matrix);
  const identity = {
    revision: plain(matrix) && typeof matrix.matrixRevision === 'string' ? matrix.matrixRevision : null,
    hash: plain(matrix) && typeof matrix.matrixHash === 'string' ? matrix.matrixHash : null,
    candidateCommit: plain(matrix) && typeof matrix.candidateCommit === 'string'
      ? matrix.candidateCommit
      : null,
  };
  if (validation.length) {
    return {
      schemaVersion: 'scenario-lab.variance-report.v1',
      matrix: identity,
      valid: false,
      complete: false,
      verdict: 'invalid',
      coverage: [],
      variableCells: [],
      axisComparisons: [],
      signals: [],
      diagnostics: validation,
    };
  }

  const observations = [...matrix.observations].sort(observationSort);
  const byExactCell = new Map(observations.map((row) => [varianceCellKey(row), row]));
  const coverageDiagnostics = [];
  const coverage = matrix.cases
    .map(({ id }) => {
      const trials = [...new Set(observations
        .filter((row) => row.caseId === id)
        .map((row) => row.trial))]
        .sort((left, right) => left - right);
      const trialCoverage = trials.map((trial) => {
        const missingCells = [];
        for (const executionMode of VARIANCE_EXECUTION_MODES) {
          for (const telemetryMode of VARIANCE_TELEMETRY_MODES) {
            for (const preflightMode of VARIANCE_PREFLIGHT_MODES) {
              const key = [id, trial, executionMode, telemetryMode, preflightMode].join('|');
              if (!byExactCell.has(key)) {
                missingCells.push({ executionMode, telemetryMode, preflightMode });
              }
            }
          }
        }
        if (missingCells.length) {
          coverageDiagnostics.push({
            path: `/coverage/${id}/${trial}`,
            code: 'matrix-cells-missing',
            message: `${missingCells.length} required axis cell(s) are missing`,
          });
        }
        return { trial, complete: missingCells.length === 0, missingCells };
      });
      if (trials.length < MIN_INDEPENDENT_VARIANCE_TRIALS) {
        coverageDiagnostics.push({
          path: `/coverage/${id}`,
          code: 'independent-comparison-missing',
          message: 'at least two independent trials are required to measure run-to-run variation',
        });
      }
      return {
        caseId: id,
        trialCount: trials.length,
        independentlyComparable: trials.length >= MIN_INDEPENDENT_VARIANCE_TRIALS,
        trials: trialCoverage,
      };
    })
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const complete = coverageDiagnostics.length === 0;

  const acrossTrials = new Map();
  for (const row of observations) {
    const key = varianceCellKey(row, false);
    acrossTrials.set(key, [...(acrossTrials.get(key) || []), row]);
  }
  const variableCells = [...acrossTrials.entries()]
    .filter(([, rows]) => distinct(rows, 'passed').size > 1)
    .map(([key, rows]) => ({
      key,
      caseId: rows[0].caseId,
      executionMode: rows[0].executionMode,
      telemetryMode: rows[0].telemetryMode,
      preflightMode: rows[0].preflightMode,
      decisionVaried: distinct(rows, 'decisionFingerprint').size > 1,
      lifecycleVaried: distinct(rows, 'lifecycleFingerprint').size > 1,
      modelOutputVaried: distinct(rows, 'modelOutputFingerprint').size > 1,
      modelRouteVaried: distinct(rows, 'modelRouteFingerprint').size > 1,
      outcomes: rows.map((row) => ({
        trial: row.trial,
        runId: row.runId,
        passed: row.passed,
        elapsedMs: row.elapsedMs,
        outcomeFingerprint: row.outcomeFingerprint,
      })),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const axisComparisons = [];
  const compare = (caseId, trial, axis, left, right) => {
    if (!left || !right) return;
    axisComparisons.push({
      caseId,
      trial,
      axis,
      leftRunId: left.runId,
      rightRunId: right.runId,
      outcomeChanged: left.passed !== right.passed
        || left.outcomeFingerprint !== right.outcomeFingerprint,
      decisionChanged: left.decisionFingerprint !== right.decisionFingerprint,
    });
  };
  for (const item of coverage) {
    for (const { trial } of item.trials) {
      const get = (executionMode, telemetryMode, preflightMode) => byExactCell.get(
        [item.caseId, trial, executionMode, telemetryMode, preflightMode].join('|'),
      );
      for (const executionMode of VARIANCE_EXECUTION_MODES) {
        for (const preflightMode of VARIANCE_PREFLIGHT_MODES) {
          compare(
            item.caseId,
            trial,
            'telemetry',
            get(executionMode, 'off', preflightMode),
            get(executionMode, 'on', preflightMode),
          );
        }
        for (const telemetryMode of VARIANCE_TELEMETRY_MODES) {
          compare(
            item.caseId,
            trial,
            'preflight',
            get(executionMode, telemetryMode, 'off'),
            get(executionMode, telemetryMode, 'on'),
          );
        }
      }
      for (const telemetryMode of VARIANCE_TELEMETRY_MODES) {
        for (const preflightMode of VARIANCE_PREFLIGHT_MODES) {
          compare(
            item.caseId,
            trial,
            'execution',
            get('recorded-trace', telemetryMode, preflightMode),
            get('frozen-model', telemetryMode, preflightMode),
          );
        }
      }
    }
  }
  axisComparisons.sort((left, right) => (
    left.caseId.localeCompare(right.caseId)
    || left.trial - right.trial
    || left.axis.localeCompare(right.axis)
    || left.leftRunId.localeCompare(right.leftRunId)
  ));

  const modelSampling = variableCells.filter((cell) => {
    if (
      cell.executionMode !== 'frozen-model'
      || !cell.decisionVaried
      || !cell.modelOutputVaried
      || cell.modelRouteVaried
    ) return false;
    const control = acrossTrials.get([
      cell.caseId,
      'recorded-trace',
      cell.telemetryMode,
      cell.preflightMode,
    ].join('|')) || [];
    return control.length >= MIN_INDEPENDENT_VARIANCE_TRIALS
      && distinct(control, 'passed').size === 1
      && distinct(control, 'decisionFingerprint').size === 1;
  }).map((cell) => cell.key);
  const modelRouting = variableCells
    .filter((cell) => cell.executionMode === 'frozen-model' && cell.modelRouteVaried)
    .map((cell) => cell.key);
  const lifecycle = variableCells
    .filter((cell) => cell.telemetryMode === 'on' && !cell.decisionVaried && cell.lifecycleVaried)
    .map((cell) => cell.key);
  const downstreamRuntime = variableCells
    .filter((cell) => cell.executionMode === 'recorded-trace' || !cell.decisionVaried)
    .map((cell) => cell.key);
  const residualTiming = variableCells
    .filter((cell) => cell.telemetryMode === 'on' && !cell.decisionVaried && !cell.lifecycleVaried)
    .map((cell) => cell.key);
  const preflight = axisComparisons
    .filter((comparison) => comparison.axis === 'preflight' && comparison.outcomeChanged)
    .map((comparison) => `${comparison.caseId}|${comparison.trial}|${comparison.leftRunId}|${comparison.rightRunId}`);
  const telemetry = axisComparisons
    .filter((comparison) => comparison.axis === 'telemetry' && comparison.outcomeChanged)
    .map((comparison) => `${comparison.caseId}|${comparison.trial}|${comparison.leftRunId}|${comparison.rightRunId}`);
  const signals = [
    sourceSignal('model-sampling', modelSampling, complete),
    sourceSignal('model-routing', modelRouting, complete),
    sourceSignal('lifecycle', lifecycle, complete),
    sourceSignal('preflight', preflight, complete),
    sourceSignal('telemetry-observer-effect', telemetry, complete),
    sourceSignal('downstream-runtime', downstreamRuntime, complete),
    sourceSignal('timing-or-unobserved-runtime', residualTiming, complete),
  ];
  const supported = signals.some((signal) => signal.status === 'supported');
  const verdict = !complete
    ? 'incomplete'
    : supported
      ? 'source-signals-observed'
      : variableCells.length
        ? 'variance-unattributed'
        : 'stable';

  return {
    schemaVersion: 'scenario-lab.variance-report.v1',
    matrix: identity,
    valid: true,
    complete,
    verdict,
    coverage,
    variableCells,
    axisComparisons,
    signals,
    diagnostics: sortedDiagnostics(coverageDiagnostics),
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
    variance: ['--input'],
  };
  if (!Object.hasOwn(allowed, command)) {
    stdout.write(`${canonicalJson(failure(command, 'usage', 'command must be list, validate, plan, or variance'))}\n`);
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
  if (command === 'variance' && !parsed.options['--input']) {
    stdout.write(`${canonicalJson(failure(command, 'usage', 'variance requires --input'))}\n`);
    return 2;
  }

  if (command === 'variance') {
    let matrix;
    try {
      matrix = JSON.parse(await readFile(path.resolve(parsed.options['--input']), 'utf8'));
    } catch (error) {
      stdout.write(`${canonicalJson(failure(
        command,
        error instanceof SyntaxError ? 'malformed-json' : 'read-failed',
        error instanceof SyntaxError
          ? 'variance input must contain valid JSON'
          : 'variance input could not be read',
        '/input',
      ))}\n`);
      return 2;
    }
    const report = analyzeVarianceMatrix(matrix);
    stdout.write(`${canonicalJson(report)}\n`);
    if (!report.valid) return 2;
    return report.complete ? 0 : 3;
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
