#!/usr/bin/env node
// Veto audit.
//
// This codebase's second failure mode, after "correct code that nothing
// invokes": correct engines that project code refuses to let answer. On
// 2026-08-17 mineflayer-pathfinder was handed three of its four action classes
// deleted and could only ever reply "no path"; a per-block stance test vetoed
// twelve obtainable stone blocks before pathfinder was consulted; and probes
// turned an expired 100ms budget into "unreachable", which became a trapped
// exit, a missing shelter, and a silently skipped ore candidate downstream.
//
// None of that is findable by reading one file, and none of it is a broken
// wire, so wiring-audit.mjs cannot see it. This walks the seams where project
// judgment overrides engine capability.
//
//   node tools/veto-audit.mjs           report everything
//   node tools/veto-audit.mjs --assert  exit non-zero on an unnamed veto
//
// THE CONVENTION THIS ENFORCES
//
// Restricting the engine is sometimes correct. Leading livestock should not
// tunnel through the pen. Chasing a mob should not authorize excavation. Those
// are policy, and policy is legitimate -- but it must SAY SO. A restriction
// carrying a `// policy:` note naming its reason is accepted. A bare one is
// reported, because the difference between "I will not" and "I cannot" is the
// entire architecture and it is invisible at the call site otherwise.
//
// Classifications:
//   NAMED_POLICY_VETO         a restriction that names its reason -- fine
//   PRE_ENGINE_VETO           the engine was disabled with no stated reason
//   INCONCLUSIVE_AS_IMPOSSIBLE  an unfinished search reported as a fact
//
// Findings that turn out to be false get encoded away here rather than
// remembered, for the same reason wiring-audit does it: an audit nobody trusts
// is worse than no audit.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

// Capabilities pathfinder needs to answer "how do I get there". Turning one off
// removes an entire class of move from the search.
const ENGINE_CAPABILITIES = [
  'canDig',
  'canPlaceBlocks',
  'allow1by1towers',
  'allowParkour',
  'canOpenDoors',
];

// A restriction is named if a `policy:` note appears in the comment block
// immediately above it, or trailing on the same line.
const POLICY_NOTE = /(?:\/\/|\*)\s*policy:/i;
const POLICY_LOOKBEHIND_LINES = 6;

const findings = [];
const accepted = [];

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'public') continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

function report(list, kind, file, line, detail) {
  list.push({ kind, file: relative(file), line, detail });
}

/** Is this restriction accompanied by a note naming why? */
function hasPolicyNote(lines, index) {
  if (POLICY_NOTE.test(lines[index])) return true;
  // Scan back through code as well as comments. A note documenting a whole
  // function sits above its signature, so stopping at the first non-comment
  // line missed every restriction that was properly explained -- the probe run
  // that found this reported a correctly-annotated disable as unnamed.
  //
  // Stop at another restriction, so one note cannot silently cover a second,
  // unrelated amputation further down.
  for (let back = 1; back <= POLICY_LOOKBEHIND_LINES; back += 1) {
    const candidate = lines[index - back];
    if (candidate === undefined) break;
    if (POLICY_NOTE.test(candidate)) return true;
    if (ENGINE_CAPABILITIES.some((capability) => new RegExp(`\\b${capability}\\s*=\\s*false\\b`).test(candidate))) {
      // A run of disables shares the note above the first one.
      continue;
    }
  }
  return false;
}

for (const file of sourceFiles(SRC)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // --- engine capability disabled ---------------------------------------
    for (const capability of ENGINE_CAPABILITIES) {
      // Only a literal disable. `= allowPillars === true` is a caller-supplied
      // decision, not a hardcoded amputation, and is reported by its caller.
      const disabled = new RegExp(`\\b${capability}\\s*=\\s*false\\b`);
      if (!disabled.test(line)) continue;
      // Prose describing a restriction is not a restriction. safeMovements
      // documents the historical `canDig = false` bug inside its own comment,
      // and reporting that as a live veto is the kind of invented finding that
      // makes an audit worthless.
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) continue;
      const beforeMatch = line.slice(0, line.search(disabled));
      if (beforeMatch.includes('//')) continue;
      const detail = `${capability} = false`;
      if (hasPolicyNote(lines, index)) report(accepted, 'NAMED_POLICY_VETO', file, lineNumber, detail);
      else report(findings, 'PRE_ENGINE_VETO', file, lineNumber, detail);
    }

    // --- unfinished search reported as a fact ------------------------------
    // `reachable: x.status === 'success'` collapses success/partial/timeout/
    // noPath into a boolean. Only noPath from a finished search is evidence.
    if (/reachable:\s*[^,;]*status\s*===\s*'success'/.test(line)) {
      const window = lines.slice(Math.max(0, index - 6), index + 8).join('\n');
      if (!/conclusive/.test(window)) {
        report(findings, 'INCONCLUSIVE_AS_IMPOSSIBLE', file, lineNumber,
          "reachable derived from status === 'success' with no conclusive flag");
      } else {
        report(accepted, 'INCONCLUSIVE_HANDLED', file, lineNumber, 'carries a conclusive flag');
      }
    }

    // --- an unreachable claim with no engine result behind it --------------
    // Only where the value is ASSIGNED. Comparing against it, listing it in a
    // retryable-outcome vocabulary, or reading it off a binding are consumers.
    // Flagging those buried every real finding under fifty invented ones, which
    // is precisely the failure this audit exists to avoid.
    const manufactures = /(?:outcome|status|code|reason)\s*:\s*'unreachable'|=\s*'unreachable'\s*[;,)]/.test(line)
      && !/===|!==|includes\(|\.has\(/.test(line);
    if (manufactures) {
      const window = lines.slice(Math.max(0, index - 10), index + 6).join('\n');
      // Reporting a failed attempt is not the defect. "I walked toward it and
      // did not arrive" is an engine result, and these are all retryable. The
      // defect is refusing BEFORE trying, or calling an unfinished search a
      // fact. Separate the two, because lumping them together hides the ones
      // that matter behind the ones that do not.
      const afterAttempt = /\breached\b|goToGoal|goToPosition|interactionStance/.test(window);
      if (afterAttempt) {
        report(accepted, 'POST_ATTEMPT_REPORT', file, lineNumber,
          "'unreachable' after a real attempt (imprecise wording, not a veto)");
      } else if (!/noPath|conclusive|pathfinder|Timeout|pathStatus|routeStatus|miningFailure/i.test(window)) {
        report(findings, 'INCONCLUSIVE_AS_IMPOSSIBLE', file, lineNumber,
          "assigns 'unreachable' with no engine result and no attempt");
      } else {
        report(accepted, 'UNREACHABLE_CORRELATED', file, lineNumber,
          "'unreachable' assigned near an engine result");
      }
    }
  });
}

const order = ['PRE_ENGINE_VETO', 'INCONCLUSIVE_AS_IMPOSSIBLE'];
findings.sort((left, right) => (
  order.indexOf(left.kind) - order.indexOf(right.kind)
  || left.file.localeCompare(right.file)
  || left.line - right.line
));

const byKind = (list, kind) => list.filter((item) => item.kind === kind);

process.stdout.write(`Veto audit over ${sourceFiles(SRC).length} source files.\n`);
for (const kind of order) {
  process.stdout.write(`  ${kind}: ${byKind(findings, kind).length}\n`);
}
process.stdout.write(`  NAMED_POLICY_VETO (accepted): ${byKind(accepted, 'NAMED_POLICY_VETO').length}\n`);
process.stdout.write(`  INCONCLUSIVE_HANDLED (accepted): ${byKind(accepted, 'INCONCLUSIVE_HANDLED').length}\n`);

if (findings.length) {
  process.stdout.write('\nUNNAMED (each is either a policy that must say so, or a capability to restore)\n');
  for (const item of findings) {
    process.stdout.write(`  [${item.kind}] ${item.file}:${item.line}\n      ${item.detail}\n`);
  }
}

if (accepted.length) {
  process.stdout.write('\nACCEPTED\n');
  for (const item of accepted) {
    process.stdout.write(`  [${item.kind}] ${item.file}:${item.line} — ${item.detail}\n`);
  }
}

process.stdout.write(`\n${findings.length} unnamed veto(s), ${accepted.length} accepted.\n`);

if (process.argv.includes('--assert') && findings.length > 0) {
  process.exitCode = 1;
}
