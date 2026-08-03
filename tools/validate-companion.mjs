import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

function parseFlags(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid flag/value pair near ${flag || '<end>'}.`);
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

async function loadPlan(argv) {
  if (argv[0] === '--plan') {
    if (!argv[1] || argv.length !== 2) {
      throw new Error('Usage: node tools/validate-companion.mjs --plan <plan.json>');
    }
    return JSON.parse(await readFile(path.resolve(argv[1]), 'utf8'));
  }
  const options = parseFlags(argv.slice(1));
  return {
    suite: argv[0] || 'quick',
    fixtureRoot: options['fixture-root'],
    outputRoot: options['output-root'],
    actionTimeoutMs: options['action-timeout-ms']
      ? Number(options['action-timeout-ms'])
      : undefined,
  };
}

function run(command, args, timeoutMs = 3_600_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repo,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(
        `${command} exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}.`,
      ));
    });
  });
}

async function runNpm(script) {
  if (process.platform === 'win32') {
    await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${script}`]);
    return;
  }
  await run('npm', ['run', script]);
}

async function quick() {
  await runNpm('test:behavior');
  await runNpm('test:scenario-lab');
  await run(process.execPath, ['--test', 'tests/control-plane/managed-minecraft-server.test.js']);
}

async function tree(plan) {
  const args = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(repo, 'tools', 'validation', 'run-tree-ab.ps1'),
  ];
  if (plan.fixtureRoot) args.push('-FixtureRoot', path.resolve(plan.fixtureRoot));
  if (plan.outputRoot) args.push('-OutputRoot', path.resolve(plan.outputRoot));
  if (plan.actionTimeoutMs) args.push('-ActionTimeoutMs', String(plan.actionTimeoutMs));
  await run('powershell.exe', args);
}

const plan = await loadPlan(process.argv.slice(2));
if (!['quick', 'tree', 'all'].includes(plan.suite)) {
  throw new Error('suite must be quick, tree, or all.');
}
if (plan.suite === 'quick' || plan.suite === 'all') await quick();
if (plan.suite === 'tree' || plan.suite === 'all') await tree(plan);