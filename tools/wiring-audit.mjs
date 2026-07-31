#!/usr/bin/env node
// Wiring audit.
//
// This codebase's failure mode has never been broken components. It is
// correct code that nothing invokes: a mode in no arbiter band, a job step
// that emits a command name no one registered, a lane the dashboard cannot
// name, a socket event one side speaks and no one hears. Reading a file
// cannot see any of that, and neither can a unit test, because every piece
// involved is individually fine.
//
// So this walks the seams instead of the files. It is deliberately static: it
// must run without a Minecraft server, without a bot, and without keys.
//
//   node tools/wiring-audit.mjs           report everything
//   node tools/wiring-audit.mjs --assert  exit non-zero on any broken wire
//
// BROKEN means one side of a contract cannot reach the other. NOTE means the
// wire exists but nothing observed uses it, which is worth seeing and is not
// a failure. Findings that turn out to be false get encoded away here rather
// than remembered, because an audit nobody trusts is worse than no audit.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const broken = [];
const notes = [];

function report(list, area, detail, evidence = '') {
  list.push({ area, detail, evidence });
}

function walk(directory, extensions = ['.js', '.mjs']) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(directory, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.includes(path.extname(entry))) found.push(full);
  }
  return found;
}

const read = file => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const relative = file => path.relative(ROOT, file).replaceAll('\\', '/');
const sourceFiles = walk(SRC);

// --------------------------------------------------------------------------
// 1. Command wiring.
//
// Every `!name(...)` the runtime emits has to resolve to a registered command.
// A job plan that emits a command nobody registered does not throw: the
// executor records a failure, burns its recovery budget, and the whole job
// dies for a reason no log explains.
// --------------------------------------------------------------------------
async function auditCommands() {
  // Import through the barrel. actions.js and queries.js reference each other
  // through index.js, so importing either directly hits the cycle mid-init.
  const { getCommandManifest } = await import('../src/agent/commands/index.js');
  const manifest = getCommandManifest();
  const registered = new Set(manifest.map(command => command.name));

  for (const command of manifest) {
    if (!command.description || command.description.length < 8) {
      // A description is not documentation. It is the routing instruction the
      // model reads when deciding what a plain-language request maps to, so a
      // thin one is a command the bot cannot be talked into using.
      report(broken, 'command', `${command.name} has no usable description for language routing`);
    }
    for (const parameter of command.params || []) {
      if (!parameter.type) report(broken, 'command', `${command.name} parameter '${parameter.name}' has no type`);
      if (!parameter.description) {
        report(notes, 'command', `${command.name} parameter '${parameter.name}' has no description`);
      }
    }
  }

  // Command names emitted from runtime code, as opposed to typed by a player.
  // Only string literals count: `!isDoorOpen(block)` in ordinary code is the
  // negation operator, and treating it as a command name buries every real
  // finding under fifty invented ones.
  const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  const emitted = new Map();
  for (const file of sourceFiles) {
    if (file.includes(`${path.sep}commands${path.sep}`) || file.includes(`${path.sep}public${path.sep}`)) continue;
    for (const literal of read(file).matchAll(STRING_LITERAL)) {
      const body = literal[1] ?? literal[2] ?? literal[3] ?? '';
      for (const match of body.matchAll(/(?:^|[\s;])!([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g)) {
        const name = `!${match[1]}`;
        if (!emitted.has(name)) emitted.set(name, new Set());
        emitted.get(name).add(relative(file));
      }
    }
  }
  for (const [name, files] of emitted) {
    if (!registered.has(name)) {
      report(broken, 'command', `${name} is emitted by runtime code but is not registered`, [...files].join(', '));
    }
  }
  return { count: manifest.length };
}

// --------------------------------------------------------------------------
// 2. Behavior lane wiring.
//
// A lane the arbiter can select needs a tick period, or it silently falls to
// the default cadence, and a label, or the dashboard shows a raw enum to a
// person trying to understand what their bot is doing.
// --------------------------------------------------------------------------
function auditLanes() {
  const arbiter = read(path.join(SRC, 'agent/runtime/behavior-arbiter.js'));
  const brain = read(path.join(SRC, 'mindcraft/public/js/bot-brain.js'));
  const agent = read(path.join(SRC, 'agent/agent.js'));

  const named = (source, constant) => {
    const block = source.match(new RegExp(`const ${constant} = Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\);`));
    return new Set([...(block?.[1] || '').matchAll(/^\s*([a-z_]+):/gm)].map(match => match[1]));
  };
  const paced = named(arbiter, 'LANE_TICK_MS');
  const labelled = named(brain, 'LANE_LABEL');

  // The lane vocabulary is whatever the two tables between them declare. A
  // lane reaches select() by several routes -- a literal argument, a mode
  // band, a ternary chosen at the call site, the initial status value -- so
  // reachability is "the arbiter names it" rather than a guess at call shape.
  for (const lane of new Set([...paced, ...labelled])) {
    if (!new RegExp(`'${lane}'`).test(arbiter)) {
      report(broken, 'lane', `${lane} is a declared lane the arbiter never names, so nothing can select it`);
      continue;
    }
    if (!paced.has(lane)) report(broken, 'lane', `${lane} can be selected but has no tick period`);
    if (!labelled.has(lane)) report(broken, 'lane', `${lane} can be selected but the dashboard cannot name it`);
  }

  // Every director the arbiter ticks must actually be constructed on the agent.
  const ticked = new Set(
    [...arbiter.matchAll(/this\.agent\.([a-z_]*(?:director|engine|observer|prompter|context))\b/g)]
      .map(match => match[1]),
  );
  for (const director of ticked) {
    if (!new RegExp(`this\\.${director}\\s*=`).test(agent)) {
      report(broken, 'lane', `the arbiter ticks agent.${director} but agent.js never assigns it`);
    }
  }
  return { lanes: paced.size, directors: ticked.size };
}

// --------------------------------------------------------------------------
// 3. Mode wiring.
//
// A mode that belongs to no arbiter band is dead code that reads as a feature.
// This is exactly how item pickup, torch placing, and hunting shipped enabled
// and never once ran.
// --------------------------------------------------------------------------
function auditModes() {
  const modes = read(path.join(SRC, 'agent/modes.js'));
  const arbiter = read(path.join(SRC, 'agent/runtime/behavior-arbiter.js'));

  // A mode whose update does nothing is a flag the rest of the runtime reads,
  // not a behavior waiting for a band. `cheat` is the standing example.
  const declared = new Set(
    [...modes.matchAll(/^\s+name:\s*'([a-z_]+)',\s*$([\s\S]*?)(?=^\s+name:\s*'|\n\];)/gm)]
      .filter(match => !/update:\s*function\s*\([^)]*\)\s*\{\s*(?:\/\*[^*]*\*\/)?\s*\}/.test(match[2]))
      .map(match => match[1]),
  );
  const banded = new Set();
  for (const block of arbiter.matchAll(/_MODES = Object\.freeze\(\[([^\]]*)\]/g)) {
    for (const name of block[1].matchAll(/'([a-z_]+)'/g)) banded.add(name[1]);
  }
  for (const mode of declared) {
    if (!banded.has(mode)) {
      report(broken, 'mode', `${mode} is a declared mode but belongs to no arbiter band, so it never runs`);
    }
  }
  for (const mode of banded) {
    if (!declared.has(mode)) {
      report(broken, 'mode', `${mode} is banded by the arbiter but no such mode is declared`);
    }
  }
  return { declared: declared.size, banded: banded.size };
}

// --------------------------------------------------------------------------
// 4. Socket wiring.
//
// Three parties speak over the mindserver socket: the browser dashboard, the
// mindserver itself, and each agent process through mindserver_proxy. An
// event the dashboard sends that no server handler hears is a button that
// does nothing. Counting the agent proxy as a speaker is what keeps this from
// drowning in false positives.
// --------------------------------------------------------------------------
function auditSockets() {
  const serverFile = path.join(SRC, 'mindcraft/mindserver.js');
  const proxyFile = path.join(SRC, 'agent/mindserver_proxy.js');
  const clientFiles = walk(path.join(SRC, 'mindcraft/public'));

  const collect = (files, pattern) => {
    const found = new Map();
    for (const file of files) {
      for (const match of read(file).matchAll(pattern)) {
        if (!found.has(match[1])) found.set(match[1], new Set());
        found.get(match[1]).add(relative(file));
      }
    }
    return found;
  };
  // Neither side speaks socket.io through one literal shape. The server emits
  // through `candidateIo`, `conn.socket`, `room.volatile`, and a bare `io`;
  // the dashboard sends most of its requests through a `socketRequest(socket,
  // event, ...)` helper. Matching only `socket.emit(` reported the entire
  // squad control surface as dead when every event of it was wired, which is
  // the most dangerous thing an audit can do.
  const LISTEN = /\.on\(\s*'([a-z][a-z0-9-]*)'/g;
  const EMIT = /(?:\.(?:volatile\.)?emit|socketRequest\([^,]+,)\s*\(?\s*'([a-z][a-z0-9-]*)'/g;

  // Both sides also dispatch indirectly -- `runSquadAction('squad-stop', id)`
  // hands the event name to a helper that emits it. No regex over call shapes
  // can follow that, and guessing wrong reports a working control surface as
  // dead. So an event named anywhere in a party's source counts as spoken by
  // it. That trades precision for truth: this check answers "does anyone on
  // the other side even know this name", which is the question worth asking.
  const MENTION = /'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g;

  const serverListens = collect([serverFile], LISTEN);
  const serverEmits = collect([serverFile], EMIT);
  const clientListens = collect(clientFiles, LISTEN);
  const clientEmits = collect(clientFiles, EMIT);
  const clientMentions = collect(clientFiles, MENTION);
  const proxyListens = collect([proxyFile], LISTEN);
  const proxyEmits = collect([proxyFile], EMIT);

  // Socket.IO speaks these itself; no handler is required on either side.
  const reserved = new Set([
    'connect', 'disconnect', 'connection', 'connect_error', 'error',
    // Node stream and server events that share the socket namespace.
    'close', 'timeout', 'message', 'data', 'end', 'listening',
  ]);
  const heard = event => serverListens.has(event) || clientListens.has(event) || proxyListens.has(event);
  const spoken = event => serverEmits.has(event)
    || clientEmits.has(event)
    || proxyEmits.has(event)
    || clientMentions.has(event);

  for (const [event, files] of clientEmits) {
    if (reserved.has(event) || heard(event)) continue;
    report(broken, 'socket', `the dashboard sends '${event}' and nothing listens for it`, [...files].join(', '));
  }
  for (const [event, files] of serverEmits) {
    if (reserved.has(event) || heard(event)) continue;
    report(broken, 'socket', `the server sends '${event}' and nothing listens for it`, [...files].join(', '));
  }
  for (const [event, files] of proxyEmits) {
    if (reserved.has(event) || heard(event)) continue;
    report(broken, 'socket', `an agent sends '${event}' and nothing listens for it`, [...files].join(', '));
  }
  for (const [event, files] of serverListens) {
    if (reserved.has(event) || spoken(event)) continue;
    report(notes, 'socket', `the server listens for '${event}' that nothing sends`, [...files].join(', '));
  }
  for (const [event, files] of clientListens) {
    if (reserved.has(event) || spoken(event)) continue;
    report(notes, 'socket', `the dashboard listens for '${event}' that nothing sends`, [...files].join(', '));
  }
  return { events: new Set([...serverListens.keys(), ...clientEmits.keys()]).size };
}

// --------------------------------------------------------------------------
// 5. Interruptibility.
//
// A skill that awaits a long Minecraft operation the bot cannot be pulled out
// of cannot be stopped. The bot stays held, Stop reports
// `previous_action_unresponsive`, and every reflex underneath it is blocked
// until the operation finishes on its own. That is what made `!fish` freeze a
// bot for 45 seconds while a creeper walked up to it.
//
// An operation is escapable if `requestInterrupt` cancels it, which is why
// each entry names the call that does the cancelling. A bare `await` on an
// operation with no such call is the real finding.
// --------------------------------------------------------------------------
const LONG_RUNNING = Object.freeze([
  { call: 'bot.dig', cancelledBy: 'stopDigging' },
  { call: 'bot.consume', cancelledBy: 'deactivateItem' },
  { call: 'bot.activateItem', cancelledBy: 'deactivateItem' },
  { call: 'bot.fish', cancelledBy: 'deactivateItem' },
  { call: 'bot.pathfinder.goto', cancelledBy: 'pathfinder.setGoal' },
  { call: 'bot.craft', cancelledBy: 'closeWindow' },
  { call: 'bot.sleep', cancelledBy: 'wake' },
  // bot.lookAt is deliberately absent: it completes within a tick, so there is
  // nothing to escape from.
]);

function auditInterruptibility() {
  const skills = read(path.join(SRC, 'agent/library/skills.js'));
  const interrupt = read(path.join(SRC, 'agent/agent.js'))
    .match(/requestInterrupt\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] || '';

  for (const { call, cancelledBy } of LONG_RUNNING) {
    const pattern = new RegExp(`await\\s+${call.replaceAll('.', '\\.')}\\s*\\(`, 'g');
    const sites = [...skills.matchAll(pattern)];
    if (!sites.length) continue;
    // A cooperative wrapper makes the call escapable regardless of what
    // requestInterrupt cancels.
    const escapable = cancelledBy && interrupt.includes(cancelledBy);
    for (const site of sites) {
      const line = skills.slice(0, site.index).split('\n').length;
      const window = skills.slice(Math.max(0, site.index - 2_000), site.index + 800);
      if (escapable || /withInterrupt|withDeadline|interrupt_code/.test(window)) continue;
      report(
        broken,
        'interruptibility',
        `await ${call}(...) cannot be interrupted: requestInterrupt never calls ${cancelledBy || 'anything that cancels it'}`,
        `src/agent/library/skills.js:${line}`,
      );
    }
  }
}

// --------------------------------------------------------------------------
// 6. Continuity.
//
// The bot has to survive being pulled off what it was doing. Each executor
// that folds an action result back into its own plan must tell "something
// outranked me" apart from "this did not work", or a fight spends the
// recovery budget meant for genuine failure.
// --------------------------------------------------------------------------
function auditContinuity() {
  const executors = [
    'agent/runtime/goal-director.js',
    'agent/runtime/work-order.js',
  ];
  for (const file of executors) {
    const text = read(path.join(SRC, file));
    if (!/isPreemption/.test(text)) {
      report(broken, 'continuity', `src/${file} folds action results back into a plan without classifying preemption`);
    }
  }
  const jobs = read(path.join(SRC, 'agent/runtime/job-director.js'));
  if (!/anchor/.test(jobs)) {
    report(broken, 'continuity', 'job-director keeps no worksite anchor, so a fight leaves work resumed from wherever the chase ended');
  }
}

// --------------------------------------------------------------------------

const audits = [
  ['commands', auditCommands],
  ['lanes', auditLanes],
  ['modes', auditModes],
  ['sockets', auditSockets],
  ['interruptibility', auditInterruptibility],
  ['continuity', auditContinuity],
];

function print(title, list) {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const item of list) {
    console.log(`  [${item.area}] ${item.detail}${item.evidence ? `\n      ${item.evidence}` : ''}`);
  }
}

async function main() {
  const summary = [];
  for (const [name, run] of audits) {
    const before = broken.length + notes.length;
    try {
      await run();
    } catch (error) {
      report(broken, name, `audit could not run: ${error?.message || error}`);
    }
    summary.push(`  ${name}: ${broken.length + notes.length - before} finding(s)`);
  }

  console.log(`Wiring audit over ${sourceFiles.length} source files.`);
  console.log(summary.join('\n'));
  print(`BROKEN (${broken.length})`, broken);
  print(`NOTES (${notes.length})`, notes);
  console.log(`\n${broken.length} broken wire(s), ${notes.length} note(s).`);

  if (process.argv.includes('--assert') && broken.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(`Wiring audit failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
