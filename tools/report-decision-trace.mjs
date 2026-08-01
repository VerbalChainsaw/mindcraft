import fs from 'node:fs';
import process from 'node:process';

import {
  extractDecisionTraces,
  formatDecisionTrace,
} from '../src/agent/runtime/decision-trace.js';

function readInput(inputPath) {
  return inputPath
    ? fs.readFileSync(inputPath, 'utf8')
    : fs.readFileSync(0, 'utf8');
}

try {
  const inputPath = process.argv[2] || null;
  const raw = readInput(inputPath);
  const parsed = JSON.parse(raw);
  const traces = extractDecisionTraces(parsed);
  if (traces.length === 0) {
    throw new Error('No DecisionTraceV1 records found in the supplied JSON.');
  }
  process.stdout.write(`${traces.map(formatDecisionTrace).join('\n\n')}\n`);
} catch (error) {
  process.stderr.write(`decision-trace reporter failed: ${String(error?.message || error).slice(0, 500)}\n`);
  process.exitCode = 1;
}
