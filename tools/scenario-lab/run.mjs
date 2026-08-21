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
  'deliver-item-goal':
    'Typed goal end to end: acquire a block of dirt and physically hand it to '
    + 'the player. The only course that exercises goal-director.',
  'orchestration-charcoal':
    'Phase 3 charcoal Mission vertical slice: the model interprets one promise, '
    + 'then stable causal Activities acquire and deliver exactly eight charcoal.',
  'route-probe-inconclusive':
    'Phase 4 route truth: a whole-route search that exhausts its clock remains '
    + 'retryable and unproven without moving or excavating.',
});

// The deliver course runs on a generated flat world instead of the captured
// follow world. That is not a preference: the follow fixture is an island, so
// acquisition relocates 32 blocks into open ocean and drowns, and the goal is
// interrupted every time. This fixture is a text recipe, lives in the repo, and
// needs no machine-local path or override.
const GENERATED_FIXTURES = Object.freeze({
  'deliver-item-goal': path.join(REPO, 'tools', 'scenario-lab', 'fixtures', 'deliver-item-flat-v1'),
  'orchestration-charcoal': path.join(REPO, 'tools', 'scenario-lab', 'fixtures', 'orchestration-forest-v1'),
  'route-probe-inconclusive': path.join(REPO, 'tools', 'scenario-lab', 'fixtures', 'deliver-item-flat-v1'),
});

// The fixture is machine-local and gitignored. An explicit override wins outright. Falling back to the machine-local default
// when someone has set this variable would silently run against the wrong
// fixture -- or hide a typo on a machine that has its own copy elsewhere.
const FIXTURE_ROOTS = process.env.SCENARIO_LAB_FOLLOW_FIXTURE_ROOT
  ? [process.env.SCENARIO_LAB_FOLLOW_FIXTURE_ROOT]
  : ['C:/Users/zerop/Development/JordanWorkspace/artifacts/minecraft-validation/fixtures/doorway-corridor-follow-v1'];

function resolveFixtureRoot(scenario) {
  const generated = GENERATED_FIXTURES[scenario];
  if (generated) {
    if (existsSync(path.join(generated, 'fixture-metadata.json'))) return generated;
    throw new Error(
      `The generated fixture for '${scenario}' is missing its recipe.\n`
      + `Expected: ${path.join(generated, 'fixture-metadata.json')}\n`
      + 'This fixture is checked into the repo — restore it from git rather than\n'
      + 'looking for a world archive. See tools/scenario-lab/FIXTURES.md.\n',
    );
  }
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

/** Human-readable scenario menu, shared by --list and the unknown-name error. */
function describeScenarios(heading) {
  const lines = Object.entries(SCENARIOS)
    .map(([id, why]) => `  ${id}\n      ${why}`)
    .join('\n');
  return `${heading}\n${lines}\n\nCheck readiness first: npm run scenario:doctor\n`;
}

// Timestamped so the adapter's non-recursive mkdir and wx writes never collide.
function outputDirectory(scenario, now) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return path.join(REPO, 'validation-output', `${scenario}-${stamp}`);
}

async function main(argv) {
  const scenario = argv[0] || 'doorway-corridor-follow';
  if (scenario === '--list' || scenario === '-l') {
    process.stdout.write(describeScenarios('Scenario Lab scenarios:'));
    return 0;
  }
  if (!Object.hasOwn(SCENARIOS, scenario)) {
    process.stderr.write(
      describeScenarios(`Unknown scenario '${scenario}'.\n\nAvailable:`),
    );
    return 2;
  }

  const fixtureRoot = resolveFixtureRoot(scenario);
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
