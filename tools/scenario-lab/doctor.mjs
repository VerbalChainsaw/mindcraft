#!/usr/bin/env node
/**
 * Is the Scenario Lab ready to run right now?
 *
 *   npm run scenario:doctor
 *
 * Every check here corresponds to a real failure that cost a debugging cycle on
 * 2026-08-16, where the symptom did not name its own cause:
 *
 *   busy port      -> "Runtime did not become world-ready within three minutes"
 *   held lock      -> "Another Scenario Lab invocation owns the managed runtime"
 *   WSL gitdir     -> "fatal: not a git repository: (NULL)" from a provenance probe
 *   missing fixture-> a hash mismatch several hundred lines into a worker
 *
 * Each of those reads like a product defect and is not one. Run this first and
 * the run either starts clean or tells you exactly what to clear.
 *
 * Exit 0 = ready. Exit 1 = something must be cleared first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveMindserverUrl, mindserverPortFromLauncherConfig } from '../mindserver-url.mjs';
import { loadScenarioManifest, validateScenarioManifest } from '../scenario-lab.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

// An explicit override wins outright. Falling back to the machine-local default
// when someone has set this variable would silently run against the wrong
// fixture -- or hide a typo on a machine that has its own copy elsewhere.
const FIXTURE_ROOTS = process.env.SCENARIO_LAB_FOLLOW_FIXTURE_ROOT
  ? [process.env.SCENARIO_LAB_FOLLOW_FIXTURE_ROOT]
  : ['C:/Users/zerop/Development/JordanWorkspace/artifacts/minecraft-validation/fixtures/doorway-corridor-follow-v1'];

const EXPECTED_FIXTURE_HASHES = {
  'follow-world.zip': 'be49ccbd9115e34ccd3ea6b0958302fa7c794709dfdcc6b379d06fba31a026b8',
  'fixture-metadata.json': 'ddcc34aba25090cbc1e760c3a8dca2883ed47f35337f8d55ab3f1c235cc49a67',
  'scenario-profile.json': 'e82b8f03e0411678073191db52b35c9ad74d6cfe8e36572db07c866f0817ae57',
};

const results = [];
const record = (ok, name, detail, fix = null) => {
  results.push({ ok, name, detail, fix });
};

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// What the manifest froze for a scenario's world, or null if it is unregistered.
// Read straight from the file so this check runs before the manifest section
// below and still reports on the same registration the worker will enforce.
function registeredFixtureHash(scenarioId) {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO, 'tools', 'scenario-lab', 'scenarios.v1.json'), 'utf8'),
    );
    return manifest.scenarios.find(scenario => scenario.id === scenarioId)?.world?.fixtureHash || null;
  } catch {
    return null;
  }
}

function portHolder(port) {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;`
      + 'if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;'
      + ' "$($c.OwningProcess) $($p.ProcessName)" } else { "" }',
    ], { encoding: 'utf8', timeout: 20_000 }).trim();
    return out || null;
  } catch {
    return null; // cannot tell; treated as free rather than blocking the run
  }
}

// --- fixture -----------------------------------------------------------------
const fixtureRoot = FIXTURE_ROOTS.find(dir => existsSync(path.join(dir, 'follow-world.zip')));
if (!fixtureRoot) {
  record(false, 'fixture', `not found in: ${FIXTURE_ROOTS.join(', ')}`,
    'Set SCENARIO_LAB_FOLLOW_FIXTURE_ROOT to the directory holding follow-world.zip. See tools/scenario-lab/FIXTURES.md.');
} else {
  const bad = [];
  for (const [file, want] of Object.entries(EXPECTED_FIXTURE_HASHES)) {
    const full = path.join(fixtureRoot, file);
    if (!existsSync(full)) { bad.push(`${file} missing`); continue; }
    if (sha256(full) !== want) bad.push(`${file} hash mismatch`);
  }
  if (bad.length) {
    record(false, 'fixture', `${fixtureRoot}: ${bad.join(', ')}`,
      'The frozen fixture is damaged or replaced. See tools/scenario-lab/FIXTURES.md.');
  } else {
    record(true, 'fixture', `${fixtureRoot} (3 files, hashes match)`);
  }
}

// --- generated fixture -------------------------------------------------------
// The deliver course carries a text recipe instead of a captured world, so the
// check is that the recipe is present and still hashes to what the manifest
// registered -- the same guarantee the archive hash gives, without a binary that
// can rot. A recipe edited without re-registering would otherwise surface as a
// hash mismatch deep inside the worker.
{
  const root = path.join(REPO, 'tools', 'scenario-lab', 'fixtures', 'deliver-item-flat-v1');
  const recipe = path.join(root, 'fixture-metadata.json');
  const profile = path.join(root, 'scenario-profile.json');
  const missing = [recipe, profile].filter(file => !existsSync(file));
  if (missing.length) {
    record(false, 'deliver fixture', `missing: ${missing.map(f => path.basename(f)).join(', ')}`,
      'This fixture is checked into the repo -- restore it from git. See tools/scenario-lab/FIXTURES.md.');
  } else {
    const registered = registeredFixtureHash('deliver-item-goal');
    const actual = sha256(recipe);
    if (registered && registered !== actual) {
      record(false, 'deliver fixture', `recipe hash ${actual} does not match the registered ${registered}`,
        'Recompute world.fixtureHash and the manifestHash after editing the recipe. See tools/scenario-lab/FIXTURES.md.');
    } else {
      const surface = JSON.parse(readFileSync(recipe, 'utf8'))?.generation?.surface;
      record(true, 'deliver fixture', `generated flat world, surface y=${surface?.stand_y} (recipe hash matches)`);
    }
  }
}

// --- ports -------------------------------------------------------------------
const mindserverPort = mindserverPortFromLauncherConfig() ?? 8080;
for (const port of [...new Set([8080, mindserverPort, 25579])]) {
  const holder = portHolder(port);
  const label = port === 25579 ? `${port} (Paper)` : `${port} (MindServer)`;
  if (holder) {
    record(false, `port ${label}`, `held by pid ${holder}`,
      `Stop it before running. A busy port surfaces as "Runtime did not become world-ready within three minutes".`);
  } else {
    record(true, `port ${label}`, 'free');
  }
}
record(true, 'mindserver url', resolveMindserverUrl());

// --- managed server already running ------------------------------------------
// The worker aborts if OUR Paper server is already up. It used to abort on any
// java process, so the Director playing Minecraft blocked the lab while this
// doctor still said ready. Check exactly what the worker checks.
{
  const managedJar = path.join(REPO, 'server_data', 'managed-java', 'server.jar');
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `$j = ${JSON.stringify(managedJar)};`
      + ' $p = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("java.exe","javaw.exe") -and $_.CommandLine -like ("*" + $j + "*") } | Select-Object -First 1;'
      + ' if ($p) { "$($p.ProcessId)" } else { "" }',
    ], { encoding: 'utf8', timeout: 20_000 }).trim();
    if (out) {
      record(false, 'managed server', `already running as pid ${out}`,
        'A previous scenario did not clean up. Stop that pid before running.');
    } else {
      record(true, 'managed server', 'not running');
    }
  } catch {
    record(true, 'managed server', 'could not determine; the worker will enforce it');
  }
}

// --- managed-runtime lock ----------------------------------------------------
const managed = path.join(REPO, 'server_data', 'managed-java');
let lockHeld = false;
try {
  for (const entry of readdirSync(managed)) {
    if (existsSync(path.join(managed, entry, 'session.lock')) && /^scenario-lab-/.test(entry)) lockHeld = true;
  }
} catch { /* managed dir may not exist yet */ }
if (lockHeld) {
  record(false, 'runtime lock', 'a scenario world is still installed',
    'A previous run did not finish cleaning up. Wait for it, or remove the leftover scenario-lab-* world under server_data/managed-java.');
} else {
  record(true, 'runtime lock', 'free');
}

// --- git provenance ----------------------------------------------------------
try {
  const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  record(true, 'git provenance', `HEAD ${head.slice(0, 12)}`);
} catch {
  record(true, 'git provenance', 'plain git fails here (WSL gitdir); workers resolve it themselves',
    null);
}

// --- manifest ----------------------------------------------------------------
try {
  const manifest = await loadScenarioManifest();
  const diagnostics = validateScenarioManifest(manifest);
  // status 'not-run' is necessary but not sufficient. stone-recovery is
  // not-run and permanently unrunnable here: its worker needs a trial-world.zip
  // and a trial-bot-memory directory that exist nowhere on this machine.
  // Reporting it as runnable would send the next agent chasing a fixture that
  // cannot be produced.
  const DRIVEABLE = new Set(['doorway-corridor-follow', 'obstruction-follow', 'deliver-item-goal', 'orchestration-charcoal']);
  const notRun = manifest.scenarios.filter(s => s.status === 'not-run').map(s => s.id);
  const runnable = notRun.filter(id => DRIVEABLE.has(id));
  const blocked = notRun.filter(id => !DRIVEABLE.has(id));
  if (diagnostics.length) {
    record(false, 'manifest', `${diagnostics.length} validation error(s)`,
      'Re-register with computeManifestHash after editing. See tools/scenario-lab/FIXTURES.md.');
  } else {
    record(true, 'manifest', `valid, runnable: ${runnable.join(', ')}`);
    if (blocked.length) {
      record(true, 'blocked', `${blocked.join(', ')} — registered but no fixture exists here`);
    }
  }
} catch (error) {
  record(false, 'manifest', String(error?.message || error), null);
}

// --- report ------------------------------------------------------------------
const failed = results.filter(r => !r.ok);
for (const r of results) {
  process.stdout.write(`${r.ok ? '  ok  ' : '  XX  '}${r.name.padEnd(26)} ${r.detail}\n`);
}
if (failed.length) {
  process.stdout.write('\nNot ready:\n');
  for (const r of failed) if (r.fix) process.stdout.write(`  - ${r.name}: ${r.fix}\n`);
  process.stdout.write('\n');
} else {
  process.stdout.write(
    '\nReady. Run: npm run scenario:follow  |  npm run scenario:obstruction'
    + '  |  npm run scenario:deliver\n',
  );
}
process.exitCode = failed.length ? 1 : 0;
