import { readFile } from 'node:fs/promises';
import process from 'node:process';

const CRITICAL_FILES = [
  'package.json',
  'src/agent/runtime/action-result.js',
  'src/agent/runtime/gameplay-safety.js',
  'src/mindcraft/managed-minecraft-server.js',
  'src/mindcraft/mindcraft.js',
  'src/mindcraft/mindserver.js',
  'src/mindcraft/owned-local-services.js',
  'src/mindcraft/process-tree.js',
  'src/mindcraft/public/js/agents.js',
  'src/mindcraft/public/js/api.js',
  'src/mindcraft/public/js/main.js',
  'src/mindcraft/stack-shutdown.js',
  'src/process/agent_process.js',
  'tests/critical-runtime-output.test.js',
  'tests/runtime/behavior-runtime-cases.json',
  'tools/check-critical-format.mjs',
  'tools/verify-behavior-runtime.mjs',
];

async function main() {
  const problems = [];
  for (const file of CRITICAL_FILES) {
    const source = await readFile(file, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) problems.push(`${file}:${index + 1}: trailing whitespace`);
      if (/^(<{7}|={7}|>{7})(?: |$)/.test(line)) problems.push(`${file}:${index + 1}: conflict marker`);
    });
    if (source.length > 0 && !source.endsWith('\n')) problems.push(`${file}: missing final newline`);
  }

  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Critical format check passed for ${CRITICAL_FILES.length} files.\n`);
  }
}

void main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
