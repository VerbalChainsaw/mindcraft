import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX64 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]*$/;
const TEXT = /^\S(?:[\s\S]*\S)?$/;
const REL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._${}\/-]+$/;
const MISSING_PATH = /^\/(?:[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+)*$/;
const FAMILIES = ['follow-navigation', 'ordinary-obstruction', 'operator-hold'];
const VARIANTS = [
  'follow-course',
  'ordinary-obstruction-alternate-route',
  'operator-hold-safe-and-bounded-emergency-self-preservation',
];
const ROUTES = ['direct', 'nl'];
const ARMS = ['off', 'on'];
const DISPOSITIONS = ['valid', 'held', 'invalid'];

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`canonical JSON cannot contain ${typeof value}`);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function computeManifestHash(manifest) {
  const withoutHash = {};
  for (const key of Object.keys(manifest)) if (key !== 'manifestHash') withoutHash[key] = manifest[key];
  return sha256(Buffer.from(canonicalJson(withoutHash), 'utf8'));
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function diagnostic(pathname, code, message) {
  return { path: pathname, code, message };
}

function sortDiagnostics(items) {
  return items.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function checker() {
  const errors = [];
  const add = (p, code, message) => errors.push(diagnostic(p, code, message));
  const object = (value, p, required, allowed = required) => {
    if (!plain(value)) { add(p, 'type', 'must be an object'); return false; }
    for (const key of required) if (!Object.hasOwn(value, key)) add(`${p}/${key}`, 'required', 'is required');
    for (const key of Object.keys(value)) if (!allowed.includes(key)) add(`${p}/${key}`, 'additional-property', 'is not allowed');
    return true;
  };
  const string = (value, p, min, max, pattern) => {
    if (typeof value !== 'string') { add(p, 'type', 'must be a string'); return false; }
    if (value.length < min || value.length > max) add(p, 'bounds', `length must be ${min}..${max}`);
    if (pattern && !pattern.test(value)) add(p, 'pattern', 'has an invalid format');
    return true;
  };
  const enumeration = (value, p, values) => {
    if (!values.includes(value)) { add(p, 'enum', `must be one of ${values.map(String).join(', ')}`); return false; }
    return true;
  };
  const boolean = (value, p) => { if (typeof value !== 'boolean') { add(p, 'type', 'must be a boolean'); return false; } return true; };
  const number = (value, p, min, max, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
      add(p, 'type', `must be a finite ${integer ? 'integer' : 'number'}`); return false;
    }
    if (value < min || value > max) add(p, 'bounds', `must be ${min}..${max}`);
    return true;
  };
  const array = (value, p, min, max) => {
    if (!Array.isArray(value)) { add(p, 'type', 'must be an array'); return false; }
    if (value.length < min || value.length > max) add(p, 'bounds', `item count must be ${min}..${max}`);
    return true;
  };
  return { errors, add, object, string, enumeration, boolean, number, array };
}

function validateMissing(value, p, c) {
  if (!c.array(value, p, 0, 128)) return;
  const seen = new Set();
  value.forEach((item, i) => {
    if (c.string(item, `${p}/${i}`, 1, 160, MISSING_PATH)) {
      if (seen.has(item)) c.add(`${p}/${i}`, 'unique', 'must not duplicate another item');
      seen.add(item);
    }
  });
}

function validateBlockers(value, p, c) {
  if (!c.array(value, p, 0, 16)) return;
  value.forEach((item, i) => {
    const q = `${p}/${i}`;
    if (!c.object(item, q, ['code', 'detail'])) return;
    c.string(item.code, `${q}/code`, 1, 96, ID);
    c.string(item.detail, `${q}/detail`, 1, 512, TEXT);
  });
}

function validateArgv(value, p, c, nullable = false) {
  if (nullable && value === null) return;
  if (!c.array(value, p, 1, 32)) return;
  value.forEach((item, i) => c.string(item, `${p}/${i}`, 1, 240));
}

function validateBot(value, p, c) {
  if (!c.object(value, p, ['name', 'runtime'])) return;
  if (value.name !== null) c.string(value.name, `${p}/name`, 1, 64, /^[A-Za-z0-9_-]+$/);
  c.enumeration(value.runtime, `${p}/runtime`, ['mineflayer', null]);
}

function validateServer(value, p, c) {
  if (!c.object(value, p, ['version', 'protocolVersion'])) return;
  if (value.version !== null) c.string(value.version, `${p}/version`, 1, 96);
  if (value.protocolVersion !== null) c.number(value.protocolVersion, `${p}/protocolVersion`, 1, 100000, true);
}

function validateWorld(value, p, c) {
  if (!c.object(value, p, ['worldId', 'seed', 'dimension', 'resetId', 'resetPolicy'])) return;
  if (value.worldId !== null) c.string(value.worldId, `${p}/worldId`, 1, 96, ID);
  if (value.seed !== null) c.number(value.seed, `${p}/seed`, -9223372036854775808, 9223372036854775807, true);
  c.enumeration(value.dimension, `${p}/dimension`, ['overworld', 'the_nether', 'the_end', null]);
  if (value.resetId !== null) c.string(value.resetId, `${p}/resetId`, 1, 96, ID);
  c.enumeration(value.resetPolicy, `${p}/resetPolicy`, ['fresh', 'restored', null]);
}

function validateFixture(value, p, c) {
  if (!c.object(value, p, ['fixtureId', 'fixtureHash', 'coordinates'])) return;
  c.string(value.fixtureId, `${p}/fixtureId`, 1, 96, ID);
  if (value.fixtureHash !== null) c.string(value.fixtureHash, `${p}/fixtureHash`, 64, 64, HEX64);
  if (c.array(value.coordinates, `${p}/coordinates`, 1, 32)) value.coordinates.forEach((coordinate, i) => {
    const q = `${p}/coordinates/${i}`;
    if (!c.object(coordinate, q, ['x', 'y', 'z'])) return;
    c.number(coordinate.x, `${q}/x`, -30000000, 30000000);
    c.number(coordinate.y, `${q}/y`, -2048, 2048);
    c.number(coordinate.z, `${q}/z`, -30000000, 30000000);
  });
}

function validateSafety(value, p, c) {
  const keys = ['maxAttempts', 'maxElapsedMs', 'maxMovementDistanceBlocks', 'maxFixtureMutations', 'requiresAuthorizedActiveWorld', 'allowExternalNetwork'];
  if (!c.object(value, p, keys)) return;
  c.number(value.maxAttempts, `${p}/maxAttempts`, 1, 3, true);
  c.number(value.maxElapsedMs, `${p}/maxElapsedMs`, 1000, 3600000, true);
  c.number(value.maxMovementDistanceBlocks, `${p}/maxMovementDistanceBlocks`, 0, 10000);
  c.number(value.maxFixtureMutations, `${p}/maxFixtureMutations`, 0, 100000, true);
  if (c.boolean(value.requiresAuthorizedActiveWorld, `${p}/requiresAuthorizedActiveWorld`) && value.requiresAuthorizedActiveWorld !== true) c.add(`${p}/requiresAuthorizedActiveWorld`, 'const', 'must be true');
  if (c.boolean(value.allowExternalNetwork, `${p}/allowExternalNetwork`) && value.allowExternalNetwork !== false) c.add(`${p}/allowExternalNetwork`, 'const', 'must be false');
}

function validateFamily(value, p, c) {
  const keys = ['family', 'variant', 'selected', 'freezeStatus', 'routes', 'blockers'];
  if (!c.object(value, p, keys)) return;
  c.enumeration(value.family, `${p}/family`, FAMILIES);
  c.enumeration(value.variant, `${p}/variant`, VARIANTS);
  c.boolean(value.selected, `${p}/selected`);
  c.enumeration(value.freezeStatus, `${p}/freezeStatus`, ['eligible-after-evidence', 'blocked']);
  if (c.array(value.routes, `${p}/routes`, 2, 2)) value.routes.forEach((route, i) => {
    const q = `${p}/routes/${i}`;
    const routeKeys = ['routeOrigin', 'available', 'harnessPath', 'argvTemplate', 'blockers'];
    if (!c.object(route, q, routeKeys)) return;
    c.enumeration(route.routeOrigin, `${q}/routeOrigin`, ROUTES);
    c.boolean(route.available, `${q}/available`);
    if (route.harnessPath !== null) c.string(route.harnessPath, `${q}/harnessPath`, 1, 240, REL_PATH);
    validateArgv(route.argvTemplate, `${q}/argvTemplate`, c, true);
    validateBlockers(route.blockers, `${q}/blockers`, c);
    if (route.available === true) {
      if (route.harnessPath === null) c.add(`${q}/harnessPath`, 'relationship', 'must be non-null when available');
      if (!Array.isArray(route.argvTemplate)) c.add(`${q}/argvTemplate`, 'relationship', 'must be an array when available');
      if (Array.isArray(route.blockers) && route.blockers.length) c.add(`${q}/blockers`, 'relationship', 'must be empty when available');
    } else if (route.available === false) {
      if (route.harnessPath !== null) c.add(`${q}/harnessPath`, 'relationship', 'must be null when unavailable');
      if (route.argvTemplate !== null) c.add(`${q}/argvTemplate`, 'relationship', 'must be null when unavailable');
      if (Array.isArray(route.blockers) && !route.blockers.length) c.add(`${q}/blockers`, 'relationship', 'must be non-empty when unavailable');
    }
  });
  validateBlockers(value.blockers, `${p}/blockers`, c);
  if (value.freezeStatus === 'blocked' && Array.isArray(value.blockers) && !value.blockers.length) c.add(`${p}/blockers`, 'relationship', 'must be non-empty when freezeStatus is blocked');
}

function validateRun(value, p, c) {
  const keys = ['family', 'variant', 'harness', 'argvTemplate', 'routeOrigin', 'diagnosticsArm', 'evidenceDisposition', 'runId', 'invocationId', 'independentRunIndex', 'attemptCount', 'pairId', 'gitCommit', 'bot', 'server', 'world', 'fixture', 'timeoutMs', 'safetyBounds', 'expectedArtifactPath', 'metadataStatus', 'missingFields', 'blockers'];
  if (!c.object(value, p, keys)) return;
  c.enumeration(value.family, `${p}/family`, FAMILIES);
  c.enumeration(value.variant, `${p}/variant`, VARIANTS);
  c.string(value.harness, `${p}/harness`, 1, 240, REL_PATH);
  validateArgv(value.argvTemplate, `${p}/argvTemplate`, c);
  c.enumeration(value.routeOrigin, `${p}/routeOrigin`, ROUTES);
  c.enumeration(value.diagnosticsArm, `${p}/diagnosticsArm`, ARMS);
  c.enumeration(value.evidenceDisposition, `${p}/evidenceDisposition`, DISPOSITIONS);
  c.string(value.runId, `${p}/runId`, 1, 96, ID);
  c.string(value.invocationId, `${p}/invocationId`, 1, 96, ID);
  c.number(value.independentRunIndex, `${p}/independentRunIndex`, 1, 10000, true);
  c.number(value.attemptCount, `${p}/attemptCount`, 1, 3, true);
  if (value.pairId !== null) c.string(value.pairId, `${p}/pairId`, 1, 96, ID);
  c.string(value.gitCommit, `${p}/gitCommit`, 40, 40, /^[a-f0-9]{40}$/);
  validateBot(value.bot, `${p}/bot`, c);
  validateServer(value.server, `${p}/server`, c);
  validateWorld(value.world, `${p}/world`, c);
  validateFixture(value.fixture, `${p}/fixture`, c);
  c.number(value.timeoutMs, `${p}/timeoutMs`, 1000, 3600000, true);
  validateSafety(value.safetyBounds, `${p}/safetyBounds`, c);
  c.string(value.expectedArtifactPath, `${p}/expectedArtifactPath`, 1, 240, REL_PATH);
  c.enumeration(value.metadataStatus, `${p}/metadataStatus`, ['complete', 'incomplete']);
  validateMissing(value.missingFields, `${p}/missingFields`, c);
  validateBlockers(value.blockers, `${p}/blockers`, c);
  if (value.metadataStatus === 'complete') {
    if (Array.isArray(value.missingFields) && value.missingFields.length) c.add(`${p}/missingFields`, 'relationship', 'must be empty when metadataStatus is complete');
    if (!['valid', 'invalid'].includes(value.evidenceDisposition)) c.add(`${p}/evidenceDisposition`, 'relationship', 'must be valid or invalid when metadataStatus is complete');
    if (plain(value.bot) && (typeof value.bot.name !== 'string' || value.bot.runtime !== 'mineflayer')) c.add(`${p}/bot`, 'relationship', 'must be complete when metadataStatus is complete');
    if (plain(value.server) && (typeof value.server.version !== 'string' || !Number.isInteger(value.server.protocolVersion))) c.add(`${p}/server`, 'relationship', 'must be complete when metadataStatus is complete');
    if (plain(value.world) && (typeof value.world.worldId !== 'string' || !Number.isInteger(value.world.seed) || !['overworld', 'the_nether', 'the_end'].includes(value.world.dimension) || typeof value.world.resetId !== 'string' || !['fresh', 'restored'].includes(value.world.resetPolicy))) c.add(`${p}/world`, 'relationship', 'must be complete when metadataStatus is complete');
    if (plain(value.fixture) && !HEX64.test(value.fixture.fixtureHash ?? '')) c.add(`${p}/fixture/fixtureHash`, 'relationship', 'must be a SHA-256 when metadataStatus is complete');
    if (Array.isArray(value.blockers) && value.blockers.length) c.add(`${p}/blockers`, 'relationship', 'must be empty when metadataStatus is complete');
  } else if (value.metadataStatus === 'incomplete') {
    if (Array.isArray(value.missingFields) && !value.missingFields.length) c.add(`${p}/missingFields`, 'relationship', 'must be non-empty when metadataStatus is incomplete');
    if (value.evidenceDisposition !== 'held') c.add(`${p}/evidenceDisposition`, 'relationship', 'must be held when metadataStatus is incomplete');
    if (Array.isArray(value.blockers) && !value.blockers.length) c.add(`${p}/blockers`, 'relationship', 'must be non-empty when metadataStatus is incomplete');
  }
}

export function validateManifest(manifest) {
  const c = checker();
  const keys = ['schemaVersion', 'manifestRevision', 'manifestHash', 'manifestStatus', 'title', 'metadataStatus', 'missingFields', 'families', 'runs'];
  if (!c.object(manifest, '', keys)) return sortDiagnostics(c.errors);
  if (manifest.schemaVersion !== 'a0.manifest.v1') c.add('/schemaVersion', 'const', 'must equal a0.manifest.v1');
  c.string(manifest.manifestRevision, '/manifestRevision', 1, 96, ID);
  if (manifest.manifestHash !== 'pending') c.string(manifest.manifestHash, '/manifestHash', 64, 64, HEX64);
  c.enumeration(manifest.manifestStatus, '/manifestStatus', ['planned', 'runnable']);
  c.string(manifest.title, '/title', 1, 512, TEXT);
  c.enumeration(manifest.metadataStatus, '/metadataStatus', ['complete', 'incomplete']);
  validateMissing(manifest.missingFields, '/missingFields', c);
  if (c.array(manifest.families, '/families', 1, 16)) manifest.families.forEach((item, i) => validateFamily(item, `/families/${i}`, c));
  if (c.array(manifest.runs, '/runs', 1, 640)) manifest.runs.forEach((item, i) => validateRun(item, `/runs/${i}`, c));
  if (manifest.metadataStatus === 'complete' && Array.isArray(manifest.missingFields) && manifest.missingFields.length) c.add('/missingFields', 'relationship', 'must be empty when metadataStatus is complete');
  if (manifest.metadataStatus === 'incomplete' && Array.isArray(manifest.missingFields) && !manifest.missingFields.length) c.add('/missingFields', 'relationship', 'must be non-empty when metadataStatus is incomplete');
  if (manifest.manifestHash === 'pending' && (manifest.manifestStatus !== 'planned' || manifest.metadataStatus !== 'incomplete')) c.add('/manifestHash', 'relationship', 'pending is allowed only for a planned, incomplete manifest');
  if (manifest.manifestStatus === 'runnable' && (manifest.manifestHash === 'pending' || manifest.metadataStatus !== 'complete' || (Array.isArray(manifest.missingFields) && manifest.missingFields.length))) c.add('/manifestStatus', 'relationship', 'runnable requires a complete manifest and a SHA-256 hash');
  if (HEX64.test(manifest.manifestHash ?? '')) {
    let computed;
    try { computed = computeManifestHash(manifest); } catch { computed = null; }
    if (computed !== manifest.manifestHash) c.add('/manifestHash', 'hash-mismatch', `must equal ${computed ?? 'the canonical manifest SHA-256'}`);
  }
  return sortDiagnostics(c.errors);
}

function typedArtifactField(artifact, primary, legacy, predicate) {
  if (Object.hasOwn(artifact, primary)) return predicate(artifact[primary]) ? artifact[primary] : null;
  if (legacy && Object.hasOwn(artifact, legacy)) return predicate(artifact[legacy]) ? artifact[legacy] : null;
  return null;
}

function initialRow(run) {
  return {
    runId: run.runId,
    invocationId: run.invocationId,
    pairId: run.pairId,
    family: run.family,
    variant: run.variant,
    routeOrigin: run.routeOrigin,
    diagnosticsArm: run.diagnosticsArm,
    independentRunIndex: run.independentRunIndex,
    gitCommit: run.gitCommit,
    harness: run.harness,
    argvTemplate: run.argvTemplate,
    bot: run.bot,
    server: run.server,
    world: run.world,
    fixture: run.fixture,
    timeoutMs: run.timeoutMs,
    safetyBounds: run.safetyBounds,
    expectedArtifactPath: run.expectedArtifactPath,
    artifactSha256: null,
    comparisonFingerprint: null,
    diagnosticsMutationDetected: null,
    evidenceDisposition: run.evidenceDisposition,
    evidenceCompleteness: 'incomplete',
    missingFields: [...run.missingFields],
    success: null,
    unsafe: null,
    death: null,
    conflict: null,
    timeout: null,
    retryCount: null,
    terminalReason: null,
    elapsedMs: null,
  };
}

function normalizeArtifact(run, artifact, artifactHash) {
  const row = initialRow(run);
  row.artifactSha256 = artifactHash;
  const missing = new Set(row.missingFields);
  if (!plain(artifact)) {
    missing.add('/artifact');
    row.evidenceDisposition = run.evidenceDisposition === 'invalid' ? 'invalid' : 'held';
    row.missingFields = [...missing].sort();
    return row;
  }
  if (artifact.runId !== run.runId) missing.add('/artifact/runId');
  if (artifact.invocationId !== run.invocationId) missing.add('/artifact/invocationId');
  if (artifact.evidenceCompleteness !== 'complete') missing.add('/artifact/evidenceCompleteness');
  if (!Array.isArray(artifact.missingFields) || artifact.missingFields.length !== 0) missing.add('/artifact/missingFields');
  const bool = (value) => typeof value === 'boolean';
  const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const nonnegativeInt = (value) => Number.isInteger(value) && value >= 0;
  const nonempty = (value) => typeof value === 'string' && value.length > 0;
  row.success = typedArtifactField(artifact, 'success', 'passed', bool);
  row.elapsedMs = typedArtifactField(artifact, 'elapsedMs', 'durationMs', nonnegative);
  row.unsafe = typedArtifactField(artifact, 'unsafe', null, bool);
  row.death = typedArtifactField(artifact, 'death', null, bool);
  row.conflict = typedArtifactField(artifact, 'conflict', null, bool);
  row.timeout = typedArtifactField(artifact, 'timeout', null, bool);
  row.retryCount = typedArtifactField(artifact, 'retryCount', null, nonnegativeInt);
  row.terminalReason = typedArtifactField(artifact, 'terminalReason', null, nonempty);
  for (const field of ['success', 'unsafe', 'death', 'conflict', 'timeout', 'retryCount', 'terminalReason', 'elapsedMs']) if (row[field] === null) missing.add(`/artifact/${field}`);
  if (Object.hasOwn(artifact, 'comparisonFingerprint')) {
    if (typeof artifact.comparisonFingerprint === 'string' && HEX64.test(artifact.comparisonFingerprint)) row.comparisonFingerprint = artifact.comparisonFingerprint;
    else missing.add('/artifact/comparisonFingerprint');
  }
  if (Object.hasOwn(artifact, 'diagnosticsMutationDetected')) {
    if (typeof artifact.diagnosticsMutationDetected === 'boolean') row.diagnosticsMutationDetected = artifact.diagnosticsMutationDetected;
    else missing.add('/artifact/diagnosticsMutationDetected');
  }
  row.missingFields = [...missing].sort();
  row.evidenceCompleteness = row.missingFields.length === 0 ? 'complete' : 'incomplete';
  if (run.evidenceDisposition === 'invalid') row.evidenceDisposition = 'invalid';
  else if (run.metadataStatus === 'complete' && run.evidenceDisposition === 'valid' && row.evidenceCompleteness === 'complete') row.evidenceDisposition = 'valid';
  else row.evidenceDisposition = 'held';
  return row;
}

function duplicateDiagnostics(manifest, rows) {
  const diagnostics = [];
  const seen = { runId: new Map(), invocationId: new Map(), expectedArtifactPath: new Map(), artifactSha256: new Map(), worldId: new Map(), resetId: new Map() };
  const record = (kind, value, p) => {
    if (value === null || value === undefined) return;
    if (seen[kind].has(value)) diagnostics.push(diagnostic(p, `duplicate-${kind}`, `duplicates ${seen[kind].get(value)}`));
    else seen[kind].set(value, p);
  };
  manifest.runs.forEach((run, i) => {
    record('runId', run.runId, `/runs/${i}/runId`);
    record('invocationId', run.invocationId, `/runs/${i}/invocationId`);
    record('expectedArtifactPath', run.expectedArtifactPath, `/runs/${i}/expectedArtifactPath`);
    if (run.world?.resetPolicy === 'fresh') {
      record('worldId', run.world.worldId, `/runs/${i}/world/worldId`);
      record('resetId', run.world.resetId, `/runs/${i}/world/resetId`);
    }
  });
  rows.forEach((row, i) => record('artifactSha256', row.artifactSha256, `/rows/${i}/artifactSha256`));
  return sortDiagnostics(diagnostics);
}

function pairAnalysis(rows) {
  const groups = new Map();
  rows.forEach((row) => { if (row.pairId !== null) groups.set(row.pairId, [...(groups.get(row.pairId) ?? []), row]); });
  const comparisons = [];
  const contamination = [];
  const incomplete = [];
  const provenance = ['gitCommit', 'family', 'variant', 'harness', 'argvTemplate', 'routeOrigin', 'independentRunIndex', 'bot', 'server', 'world', 'fixture', 'timeoutMs', 'safetyBounds'];
  for (const pairId of [...groups.keys()].sort()) {
    const members = groups.get(pairId).sort((a, b) => a.diagnosticsArm.localeCompare(b.diagnosticsArm) || a.runId.localeCompare(b.runId));
    const off = members.filter((row) => row.diagnosticsArm === 'off');
    const on = members.filter((row) => row.diagnosticsArm === 'on');
    const issues = [];
    let status = 'complete';
    if (members.length !== 2 || off.length !== 1 || on.length !== 1) {
      status = 'incomplete'; issues.push('pair must contain exactly one off and one on arm');
      incomplete.push(diagnostic(`/pairs/${pairId}`, 'pair-incomplete', issues.at(-1)));
    } else {
      const a = off[0]; const b = on[0];
      for (const field of provenance) if (canonicalJson(a[field]) !== canonicalJson(b[field])) {
        status = 'contaminated'; issues.push(`provenance mismatch: ${field}`);
        contamination.push(diagnostic(`/pairs/${pairId}/${field}`, 'diagnostics-contamination', issues.at(-1)));
      }
      if (a.diagnosticsMutationDetected === true || b.diagnosticsMutationDetected === true) {
        status = 'contaminated'; issues.push('diagnostics mutation was detected');
        contamination.push(diagnostic(`/pairs/${pairId}/diagnosticsMutationDetected`, 'diagnostics-contamination', issues.at(-1)));
      }
      if (status !== 'contaminated' && (!a.comparisonFingerprint || !b.comparisonFingerprint || a.comparisonFingerprint !== b.comparisonFingerprint)) {
        status = 'incomplete'; issues.push('matching comparison fingerprints are required');
        incomplete.push(diagnostic(`/pairs/${pairId}/comparisonFingerprint`, 'comparison-incomplete', issues.at(-1)));
      }
    }
    comparisons.push({ pairId, status, offRunId: off[0]?.runId ?? null, onRunId: on[0]?.runId ?? null, issues: issues.sort() });
  }
  return { comparisons, contamination: sortDiagnostics(contamination), incomplete: sortDiagnostics(incomplete) };
}

function rounded(value) { return Number(value.toFixed(12)); }

export function wilson(successes, n) {
  if (n === 0) return null;
  const z = 1.96;
  const p = successes / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
  return { low: rounded(Math.max(0, center - margin)), high: rounded(Math.min(1, center + margin)) };
}

export function nearestRank(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function proportion(rows, predicate) {
  const n = rows.length;
  if (!n) return { count: 0, n: 0, rate: null, wilson95: null };
  const count = rows.filter(predicate).length;
  return { count, n, rate: rounded(count / n), wilson95: wilson(count, n) };
}

function stats(inputRows) {
  const rows = inputRows.filter((row) => row.evidenceDisposition === 'valid');
  const reasons = new Map();
  rows.forEach((row) => reasons.set(row.terminalReason, (reasons.get(row.terminalReason) ?? 0) + 1));
  const elapsed = rows.map((row) => row.elapsedMs);
  const retries = rows.map((row) => row.retryCount);
  return {
    n: rows.length,
    success: proportion(rows, (row) => row.success),
    unsafe: proportion(rows, (row) => row.unsafe),
    death: proportion(rows, (row) => row.death),
    conflict: proportion(rows, (row) => row.conflict),
    timeout: proportion(rows, (row) => row.timeout),
    retry: proportion(rows, (row) => row.retryCount > 0),
    elapsedMs: { p50: nearestRank(elapsed, 0.50), p95: nearestRank(elapsed, 0.95) },
    retryCount: { p50: nearestRank(retries, 0.50), p95: nearestRank(retries, 0.95) },
    terminalReasons: [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })),
  };
}

function grouped(rows, key, values) {
  return values.map((value) => ({ [key]: value, totals: dispositions(rows.filter((row) => row[key] === value)), measures: stats(rows.filter((row) => row[key] === value)) }));
}

function dispositions(rows) {
  return {
    n: rows.length,
    valid: rows.filter((row) => row.evidenceDisposition === 'valid').length,
    held: rows.filter((row) => row.evidenceDisposition === 'held').length,
    invalid: rows.filter((row) => row.evidenceDisposition === 'invalid').length,
  };
}

function buildReport(manifest, rows, diagnostics, pair) {
  const selected = manifest.families.filter((family) => family.selected).map((family) => family.family).sort();
  const allocation = selected.map((family) => {
    const familyRows = rows.filter((row) => row.family === family && row.evidenceDisposition === 'valid');
    const direct = familyRows.filter((row) => row.routeOrigin === 'direct').length;
    const nl = familyRows.filter((row) => row.routeOrigin === 'nl').length;
    return { family, directValidInvocations: direct, nlValidInvocations: nl, minimumPerRoute: 5, allocationMet: direct >= 5 && nl >= 5 };
  });
  const parity = selected.map((family) => {
    const familyRows = rows.filter((row) => row.family === family);
    const directRows = familyRows.filter((row) => row.routeOrigin === 'direct');
    const nlRows = familyRows.filter((row) => row.routeOrigin === 'nl');
    return { family, complete: stats(directRows).n > 0 && stats(nlRows).n > 0, direct: { totals: dispositions(directRows), measures: stats(directRows) }, nl: { totals: dispositions(nlRows), measures: stats(nlRows) } };
  });
  const promotion = ARMS.map((arm) => {
    const validIndependentInvocations = rows.filter((row) => row.diagnosticsArm === arm && row.evidenceDisposition === 'valid').length;
    return { diagnosticsArm: arm, validIndependentInvocations, minimum: 20, thresholdMet: validIndependentInvocations >= 20 };
  });
  return {
    schemaVersion: 'a0.report.v1',
    manifestRevision: manifest.manifestRevision,
    manifestHash: manifest.manifestHash,
    computedManifestHash: computeManifestHash(manifest),
    manifestStatus: manifest.manifestStatus,
    rows,
    totals: dispositions(rows),
    evidenceCompleteness: {
      complete: rows.filter((row) => row.evidenceCompleteness === 'complete').length,
      incomplete: rows.filter((row) => row.evidenceCompleteness !== 'complete').length,
    },
    measures: stats(rows),
    byFamily: grouped(rows, 'family', FAMILIES),
    byRoute: grouped(rows, 'routeOrigin', ROUTES),
    byArm: grouped(rows, 'diagnosticsArm', ARMS),
    routeAllocation: allocation,
    routeParity: parity,
    pairComparisons: pair.comparisons,
    promotionThreshold: { note: 'Reported separately from A0 allocation; this report claims neither freeze nor promotion.', arms: promotion },
    freezeClaimed: false,
    promotionClaimed: false,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function heldMissingArtifact(run, reason) {
  const row = initialRow(run);
  row.missingFields = [...new Set([...row.missingFields, '/artifact'])].sort();
  row.evidenceDisposition = run.evidenceDisposition === 'invalid' ? 'invalid' : 'held';
  row.readError = reason;
  return row;
}

export async function aggregateManifest(manifest, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const validation = validateManifest(manifest);
  if (validation.length) {
    return { exitCode: 2, report: { schemaVersion: 'a0.report.v1', rows: [], diagnostics: validation } };
  }
  const rows = [];
  const artifactValidation = [];
  for (let i = 0; i < manifest.runs.length; i += 1) {
    const run = manifest.runs[i];
    const resolved = path.resolve(cwd, run.expectedArtifactPath);
    const relative = path.relative(cwd, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      artifactValidation.push(diagnostic(`/runs/${i}/expectedArtifactPath`, 'path-escape', 'must resolve within process.cwd()'));
      rows.push(heldMissingArtifact(run, 'path escape rejected'));
      continue;
    }
    let bytes;
    try { bytes = await readFile(resolved); }
    catch (error) { rows.push(heldMissingArtifact(run, `${error.code ?? 'read-error'}`)); continue; }
    let artifact;
    try { artifact = JSON.parse(bytes.toString('utf8')); }
    catch { artifactValidation.push(diagnostic(`/artifacts/${run.invocationId}`, 'malformed-json', 'artifact is not valid JSON')); rows.push(heldMissingArtifact(run, 'malformed JSON')); continue; }
    rows.push(normalizeArtifact(run, artifact, sha256(bytes)));
  }
  rows.sort((a, b) => a.runId.localeCompare(b.runId) || a.invocationId.localeCompare(b.invocationId));
  if (artifactValidation.length) {
    const report = buildReport(manifest, rows, artifactValidation, { comparisons: [] });
    return { exitCode: 2, report };
  }
  const duplicates = duplicateDiagnostics(manifest, rows);
  const pair = pairAnalysis(rows);
  const held = rows.some((row) => row.evidenceDisposition === 'held') || manifest.metadataStatus === 'incomplete';
  const diagnostics = [...duplicates, ...pair.contamination, ...pair.incomplete];
  let exitCode = 0;
  if (duplicates.length || pair.contamination.length) exitCode = 4;
  else if (held) exitCode = 3;
  else if (pair.incomplete.length) exitCode = 5;
  const report = buildReport(manifest, rows, diagnostics, pair);
  return { exitCode, report };
}

export async function aggregateManifestPath(manifestPath, options = {}) {
  let bytes;
  try { bytes = await readFile(manifestPath); }
  catch (error) {
    return { exitCode: 2, report: { schemaVersion: 'a0.report.v1', rows: [], diagnostics: [diagnostic('/manifest', 'read-error', `${error.code ?? 'unable to read manifest'}`)] } };
  }
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { return { exitCode: 2, report: { schemaVersion: 'a0.report.v1', rows: [], diagnostics: [diagnostic('/manifest', 'malformed-json', 'manifest is not valid JSON')] } }; }
  return aggregateManifest(manifest, options);
}

export async function runCli(argv = process.argv.slice(2)) {
  let result;
  if (argv.length !== 2 || argv[0] !== '--manifest' || !argv[1]) {
    result = { exitCode: 2, report: { schemaVersion: 'a0.report.v1', rows: [], diagnostics: [diagnostic('/cli', 'usage', 'usage: node tools/a0/aggregate.mjs --manifest <path>')] } };
  } else result = await aggregateManifestPath(argv[1]);
  process.stdout.write(`${canonicalJson(result.report)}\n`);
  return result.exitCode;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await runCli();
