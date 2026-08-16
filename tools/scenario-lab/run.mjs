#!/usr/bin/env node
/**
 * Run a Scenario Lab scenario. This is the entry point — use it, not the
 * adapter underneath.
 *
 *   node tools/scenario-lab/run.mjs                     # doorway-corridor-follow
 *   node tools/scenario-lab/run.mjs obstruction-follow  # obstructed follow
 *   npm run scenario:follow
 *   npm run scenario:obstruction
 *
 * It exists because running a scenario by hand needs four facts that are not
 * discoverable from the repo: where the frozen fixture lives (outside the repo,
 * gitignored), that regression mode is required on any commit past the
 * registered one, that the output directory must not already exist, and which
 * course a scenario maps to. Every one of those was lost at some point, and the
 * lab sat unrunnable for 250 commits partly as a result. Keep this wrapper
 * working and that cannot happen the same way twice.
 *
 * Exit code 0 means the scenario passed with complete evidence. Anything else
 * is a failure — read the printed result path.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const ADAPTER = path.join(REPO, 'tools', 'scenario-lab', 'adapters', 'run-follow-field.mjs');

const SCENARIOS = Object.freeze({
  'doorway-corridor-follow':
    'Follow a player through a doorway and down a corridor on open ground.',
  'obstruction-follow':
    'Follow a player when terrain must be broken to reach them. Fails if the '
    + 'companion cannot dig — the 2026-08-16 defect.',
});

// The fixture is machine-local and gitignored. Env var wins so another machine
// can point elsewhere without editing this file.
const FIXTURE_ROOTS = [
  process.env.SCENARIO_LAB_FOLLOW_FIXTURE_ROOT,
  'C:/Users/zerop/Development/JordanWorkspace/artifacts/minecraft-validation/fixtures/doorway-corridor-follow-v1',
].filter(Boolean);

function resolveFixtureRoot() {
  for (const candidate of FIXTURE_ROOTS) {
    if (existsSync(path.join(candidate, 'follow-world.zip'))) return candidate;
  }
  throw new Error(
    'Could not find the frozen follow fixture (follow-world.zip).\n'
    + 'Set SCENARIO_LAB_FOLLOW_FIXTURE_ROOT to the directory containing\n'
    + 'follow-world.zip, scenario-profile.json and fixture-metadata.json.\n'
    + `Looked in:\n  ${FIXTURE_ROOTS.join('\n  ')}\n`
    + 'See tools/scenario-lab/FIXTURES.md.',
  );
}

// Timestamped so the adapter's non-recursive mkdir and wx writes never collide.
function outputDirectory(scenario, now) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return path.join(REPO, 'validation-output', `${scenario}-${stamp}`);
}

async function main(argv) {
  const scenario = argv[0] || 'doorway-corridor-follow';
  if (!Object.hasOwn(SCENARIOS, scenario)) {
    process.stderr.write(
      `Unknown scenario '${scenario}'.\n\nAvailable:\n`
      + Object.entries(SCENARIOS).map(([id, why]) => `  ${id}\n      ${why}`).join('\n')
      + '\n',
    );
    return 2;
  }

  const fixtureRoot = resolveFixtureRoot();
  const outputDir = outputDirectory(scenario, Date.now());

  process.stdout.write(`scenario    : ${scenario}\n`);
  process.stdout.write(`fixture     : ${fixtureRoot}\n`);
  process.stdout.write(`output      : ${outputDir}\n`);
  process.stdout.write('mode        : regression (records provenance drift instead of aborting)\n\n');

  const child = spawn(process.execPath, [
    ADAPTER,
    '--scenario', scenario,
    '--fixture-root', fixtureRoot,
    '--output-dir', outputDir,
    '--regression-mode', 'true',
  ], { cwd: REPO, stdio: 'inherit' });

  return new Promise(resolve => {
    child.once('error', error => {
      process.stderr.write(`Failed to start the scenario adapter: ${error.message}\n`);
      resolve(1);
    });
    child.once('exit', code => {
      process.stdout.write(
        code === 0
          ? '\nPASSED — complete evidence, no safety violations.\n'
          : `\nFAILED (exit ${code}). Read ${path.join(outputDir, `${scenario}.result.v1.json`)}\n`,
      );
      resolve(code ?? 1);
    });
  });
}

process.exitCode = await main(process.argv.slice(2));
