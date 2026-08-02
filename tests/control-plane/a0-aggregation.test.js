import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregateManifest,
  aggregateManifestPath,
  canonicalJson,
  computeManifestHash,
  nearestRank,
  validateManifest,
  wilson,
} from '../../tools/a0/aggregate.mjs';

const BASELINE_PATH = path.resolve('tools', 'a0', 'manifests', 'baseline.v1.json');
const FINGERPRINT_A = 'c'.repeat(64);
const FINGERPRINT_B = 'd'.repeat(64);

async function withTempDirectory(fn) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'a0-aggregation-'));
  try {
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function familyDeclaration() {
  return {
    family: 'follow-navigation',
    variant: 'follow-course',
    selected: true,
    freezeStatus: 'eligible-after-evidence',
    routes: [
      {
        routeOrigin: 'direct',
        available: true,
        harnessPath: 'tools/verify-follow-field.mjs',
        argvTemplate: ['node', 'tools/verify-follow-field.mjs'],
        blockers: [],
      },
      {
        routeOrigin: 'nl',
        available: true,
        harnessPath: 'tools/verify-follow-field.mjs',
        argvTemplate: ['node', 'tools/verify-follow-field.mjs', '--natural-language'],
        blockers: [],
      },
    ],
    blockers: [],
  };
}

function completeRun(id, diagnosticsArm = 'off', overrides = {}) {
  return {
    family: 'follow-navigation',
    variant: 'follow-course',
    harness: 'tools/verify-follow-field.mjs',
    argvTemplate: ['node', 'tools/verify-follow-field.mjs'],
    routeOrigin: 'direct',
    diagnosticsArm,
    evidenceDisposition: 'valid',
    runId: `run-${id}`,
    invocationId: `invocation-${id}`,
    independentRunIndex: 1,
    attemptCount: 1,
    pairId: null,
    gitCommit: 'a'.repeat(40),
    bot: { name: 'A0Bot', runtime: 'mineflayer' },
    server: { version: '1.21.4', protocolVersion: 769 },
    world: {
      worldId: `world-${id}`,
      seed: 12345,
      dimension: 'overworld',
      resetId: `reset-${id}`,
      resetPolicy: 'restored',
    },
    fixture: {
      fixtureId: 'follow-course-fixture',
      fixtureHash: 'b'.repeat(64),
      coordinates: [{ x: 1, y: 64, z: 1 }],
    },
    timeoutMs: 300000,
    safetyBounds: {
      maxAttempts: 1,
      maxElapsedMs: 300000,
      maxMovementDistanceBlocks: 100,
      maxFixtureMutations: 100,
      requiresAuthorizedActiveWorld: true,
      allowExternalNetwork: false,
    },
    expectedArtifactPath: `artifacts/${id}.json`,
    metadataStatus: 'complete',
    missingFields: [],
    blockers: [],
    ...overrides,
  };
}

function runnableManifest(runs) {
  const manifest = {
    schemaVersion: 'a0.manifest.v1',
    manifestRevision: 'synthetic.v1',
    manifestHash: 'pending',
    manifestStatus: 'runnable',
    title: 'Synthetic A0 aggregation evidence',
    metadataStatus: 'complete',
    missingFields: [],
    families: [familyDeclaration()],
    runs,
  };
  manifest.manifestHash = computeManifestHash(manifest);
  return manifest;
}

function completeArtifact(run, overrides = {}) {
  return {
    runId: run.runId,
    invocationId: run.invocationId,
    evidenceCompleteness: 'complete',
    missingFields: [],
    success: true,
    unsafe: false,
    death: false,
    conflict: false,
    timeout: false,
    retryCount: 0,
    terminalReason: 'completed',
    elapsedMs: 100,
    ...overrides,
  };
}

async function writeArtifact(directory, run, artifact) {
  const artifactPath = path.join(directory, run.expectedArtifactPath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(artifact), 'utf8');
}

async function writeCompleteArtifacts(directory, manifest, overrides = new Map()) {
  for (const run of manifest.runs) {
    await writeArtifact(directory, run, completeArtifact(run, overrides.get(run.runId)));
  }
}

function diagnosticCodes(report) {
  return new Set(report.diagnostics.map(({ code }) => code));
}

test('canonical JSON sorts object keys recursively and manifest hashing omits manifestHash', () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 4, c: 3 }, m: [2, { b: 2, a: 1 }] }), '{"a":{"c":3,"d":4},"m":[2,{"a":1,"b":2}],"z":1}');

  const manifest = runnableManifest([completeRun('canonical')]);
  const expected = computeManifestHash(manifest);
  assert.equal(computeManifestHash({ ...manifest, manifestHash: 'f'.repeat(64) }), expected);
  assert.equal(computeManifestHash({ manifestHash: 'pending', ...manifest }), expected);
});

test('manifest validation is strict, required, typed, and closed at nested object boundaries', () => {
  const manifest = runnableManifest([completeRun('validation')]);
  assert.deepEqual(validateManifest(manifest), []);

  const malformed = structuredClone(manifest);
  malformed.unexpected = true;
  malformed.runs[0].bot.unexpected = true;
  delete malformed.runs[0].server.protocolVersion;
  malformed.runs[0].attemptCount = 'one';
  const diagnostics = validateManifest(malformed);

  assert.ok(diagnostics.some((item) => item.path === '/unexpected' && item.code === 'additional-property'));
  assert.ok(diagnostics.some((item) => item.path === '/runs/0/bot/unexpected' && item.code === 'additional-property'));
  assert.ok(diagnostics.some((item) => item.path === '/runs/0/server/protocolVersion' && item.code === 'required'));
  assert.ok(diagnostics.some((item) => item.path === '/runs/0/attemptCount' && item.code === 'type'));
});

test('the committed planned baseline aggregates to held exit 3 without mutating the manifest', async () => {
  const manifest = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  const before = canonicalJson(manifest);

  await withTempDirectory(async (directory) => {
    const result = await aggregateManifest(manifest, { cwd: directory });
    assert.equal(result.exitCode, 3);
    assert.equal(result.report.totals.n, manifest.runs.length);
    assert.equal(result.report.totals.held, manifest.runs.length);
    assert.equal(result.report.totals.valid, 0);
  });

  assert.equal(canonicalJson(manifest), before);
});

test('unknown legacy facts normalize to held and are excluded from denominators and rates', async () => {
  await withTempDirectory(async (directory) => {
    const run = completeRun('legacy');
    const manifest = runnableManifest([run]);
    await writeArtifact(directory, run, {
      runId: run.runId,
      invocationId: run.invocationId,
      evidenceCompleteness: 'complete',
      missingFields: [],
      passed: true,
      durationMs: 25,
    });

    const result = await aggregateManifest(manifest, { cwd: directory });
    assert.equal(result.exitCode, 3);
    assert.equal(result.report.rows[0].evidenceDisposition, 'held');
    assert.equal(result.report.rows[0].success, true);
    assert.equal(result.report.rows[0].elapsedMs, 25);
    assert.equal(result.report.rows[0].unsafe, null);
    assert.equal(result.report.measures.n, 0);
    assert.deepEqual(result.report.measures.success, { count: 0, n: 0, rate: null, wilson95: null });
    assert.deepEqual(result.report.measures.elapsedMs, { p50: null, p95: null });
  });
});

test('complete correlated off/on evidence produces a valid paired report', async () => {
  await withTempDirectory(async (directory) => {
    const shared = {
      pairId: 'pair-complete',
      independentRunIndex: 7,
      world: { worldId: 'paired-world', seed: 12345, dimension: 'overworld', resetId: 'paired-reset', resetPolicy: 'restored' },
    };
    const off = completeRun('pair-off', 'off', shared);
    const on = completeRun('pair-on', 'on', shared);
    const manifest = runnableManifest([off, on]);
    const overrides = new Map([
      [off.runId, { comparisonFingerprint: FINGERPRINT_A, diagnosticsMutationDetected: false, elapsedMs: 50 }],
      [on.runId, { comparisonFingerprint: FINGERPRINT_A, diagnosticsMutationDetected: false, elapsedMs: 150 }],
    ]);
    await writeCompleteArtifacts(directory, manifest, overrides);

    const result = await aggregateManifest(manifest, { cwd: directory });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.report.totals, { n: 2, valid: 2, held: 0, invalid: 0 });
    assert.equal(new Set(result.report.rows.map((row) => row.artifactSha256)).size, 2);
    assert.deepEqual(result.report.pairComparisons, [{
      pairId: 'pair-complete',
      status: 'complete',
      offRunId: off.runId,
      onRunId: on.runId,
      issues: [],
    }]);
    assert.deepEqual(result.report.measures.elapsedMs, { p50: 50, p95: 150 });
  });
});

test('nearest-rank p50/p95 and Wilson 95% intervals use the declared formulas', () => {
  assert.equal(nearestRank([40, 10, 30, 20], 0.50), 20);
  assert.equal(nearestRank([40, 10, 30, 20], 0.95), 40);
  assert.equal(nearestRank([], 0.95), null);
  assert.deepEqual(wilson(1, 2), { low: 0.094528654801, high: 0.905471345199 });
  assert.equal(wilson(0, 0), null);
});

test('duplicate run, invocation, artifact SHA, and fresh reset identities exit 4', async () => {
  await withTempDirectory(async (directory) => {
    const freshWorld = { worldId: 'fresh-world', seed: 12345, dimension: 'overworld', resetId: 'fresh-reset', resetPolicy: 'fresh' };
    const first = completeRun('duplicate', 'off', { world: freshWorld });
    const second = completeRun('duplicate', 'off', {
      world: structuredClone(freshWorld),
      expectedArtifactPath: 'artifacts/duplicate-copy.json',
    });
    const manifest = runnableManifest([first, second]);
    const artifact = completeArtifact(first);
    await writeArtifact(directory, first, artifact);
    await writeArtifact(directory, second, artifact);

    const result = await aggregateManifest(manifest, { cwd: directory });
    assert.equal(result.exitCode, 4);
    const codes = diagnosticCodes(result.report);
    for (const code of ['duplicate-runId', 'duplicate-invocationId', 'duplicate-artifactSha256', 'duplicate-worldId', 'duplicate-resetId']) {
      assert.ok(codes.has(code), `expected ${code}`);
    }
  });
});

test('diagnostics mutation and paired provenance mismatch are contamination exit 4', async () => {
  await withTempDirectory(async (directory) => {
    const shared = {
      pairId: 'pair-contaminated',
      independentRunIndex: 3,
      world: { worldId: 'contamination-world', seed: 12345, dimension: 'overworld', resetId: 'contamination-reset', resetPolicy: 'restored' },
    };
    const off = completeRun('contamination-off', 'off', shared);
    const on = completeRun('contamination-on', 'on', { ...shared, timeoutMs: 299999 });
    const manifest = runnableManifest([off, on]);
    const overrides = new Map([
      [off.runId, { comparisonFingerprint: FINGERPRINT_A, diagnosticsMutationDetected: false }],
      [on.runId, { comparisonFingerprint: FINGERPRINT_A, diagnosticsMutationDetected: true }],
    ]);
    await writeCompleteArtifacts(directory, manifest, overrides);

    const result = await aggregateManifest(manifest, { cwd: directory });
    assert.equal(result.exitCode, 4);
    assert.equal(result.report.pairComparisons[0].status, 'contaminated');
    assert.ok(result.report.diagnostics.some((item) => item.path.endsWith('/timeoutMs') && item.code === 'diagnostics-contamination'));
    assert.ok(result.report.diagnostics.some((item) => item.path.endsWith('/diagnosticsMutationDetected') && item.code === 'diagnostics-contamination'));
  });
});

test('missing partners and mismatched fingerprints are incomplete comparison exit 5', async (t) => {
  await t.test('missing partner', async () => {
    await withTempDirectory(async (directory) => {
      const run = completeRun('unpaired', 'off', { pairId: 'pair-missing' });
      const manifest = runnableManifest([run]);
      await writeArtifact(directory, run, completeArtifact(run, { comparisonFingerprint: FINGERPRINT_A }));

      const result = await aggregateManifest(manifest, { cwd: directory });
      assert.equal(result.exitCode, 5);
      assert.equal(result.report.pairComparisons[0].status, 'incomplete');
      assert.ok(diagnosticCodes(result.report).has('pair-incomplete'));
    });
  });

  await t.test('fingerprint mismatch', async () => {
    await withTempDirectory(async (directory) => {
      const shared = {
        pairId: 'pair-fingerprint',
        independentRunIndex: 4,
        world: { worldId: 'fingerprint-world', seed: 12345, dimension: 'overworld', resetId: 'fingerprint-reset', resetPolicy: 'restored' },
      };
      const off = completeRun('fingerprint-off', 'off', shared);
      const on = completeRun('fingerprint-on', 'on', shared);
      const manifest = runnableManifest([off, on]);
      await writeCompleteArtifacts(directory, manifest, new Map([
        [off.runId, { comparisonFingerprint: FINGERPRINT_A }],
        [on.runId, { comparisonFingerprint: FINGERPRINT_B }],
      ]));

      const result = await aggregateManifest(manifest, { cwd: directory });
      assert.equal(result.exitCode, 5);
      assert.equal(result.report.pairComparisons[0].status, 'incomplete');
      assert.ok(diagnosticCodes(result.report).has('comparison-incomplete'));
    });
  });
});

test('malformed JSON, schema violations, and path escapes fail closed with exit 2', async (t) => {
  await t.test('malformed manifest JSON', async () => {
    await withTempDirectory(async (directory) => {
      const manifestPath = path.join(directory, 'manifest.json');
      await writeFile(manifestPath, '{', 'utf8');
      const result = await aggregateManifestPath(manifestPath, { cwd: directory });
      assert.equal(result.exitCode, 2);
      assert.ok(diagnosticCodes(result.report).has('malformed-json'));
    });
  });

  await t.test('malformed artifact JSON', async () => {
    await withTempDirectory(async (directory) => {
      const run = completeRun('malformed-artifact');
      const manifest = runnableManifest([run]);
      const artifactPath = path.join(directory, run.expectedArtifactPath);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, '{', 'utf8');
      const result = await aggregateManifest(manifest, { cwd: directory });
      assert.equal(result.exitCode, 2);
      assert.ok(diagnosticCodes(result.report).has('malformed-json'));
    });
  });

  await t.test('closed schema and path escape', async () => {
    const schemaViolation = runnableManifest([completeRun('schema')]);
    schemaViolation.unexpected = true;
    const schemaResult = await aggregateManifest(schemaViolation);
    assert.equal(schemaResult.exitCode, 2);
    assert.ok(diagnosticCodes(schemaResult.report).has('additional-property'));

    const escaped = runnableManifest([completeRun('escape')]);
    escaped.runs[0].expectedArtifactPath = '../escape.json';
    escaped.manifestHash = computeManifestHash(escaped);
    const escapeResult = await aggregateManifest(escaped);
    assert.equal(escapeResult.exitCode, 2);
    assert.ok(escapeResult.report.diagnostics.some((item) => item.path === '/runs/0/expectedArtifactPath' && item.code === 'pattern'));
  });
});

test('repeated aggregation emits deterministic canonical report JSON', async () => {
  await withTempDirectory(async (directory) => {
    const first = completeRun('deterministic-a', 'off');
    const second = completeRun('deterministic-b', 'on', { independentRunIndex: 2 });
    const manifest = runnableManifest([second, first]);
    await writeCompleteArtifacts(directory, manifest, new Map([
      [first.runId, { elapsedMs: 75, retryCount: 1, terminalReason: 'retried' }],
      [second.runId, { elapsedMs: 125 }],
    ]));

    const firstResult = await aggregateManifest(manifest, { cwd: directory });
    const secondResult = await aggregateManifest(structuredClone(manifest), { cwd: directory });
    assert.equal(firstResult.exitCode, 0);
    assert.equal(secondResult.exitCode, 0);
    assert.equal(canonicalJson(firstResult.report), canonicalJson(secondResult.report));
    assert.deepEqual(firstResult.report.rows.map((row) => row.runId), [first.runId, second.runId]);
  });
});
