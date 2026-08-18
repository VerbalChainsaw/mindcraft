#!/usr/bin/env node
/**
 * Does collection geometry decide reachability?
 *
 *   node tools/probe-collection-geometry.mjs --url http://localhost:8081 \
 *     --authorized-active-world
 *
 * The 2026-08-17 orchestration run reported this, standing on open forest floor
 * a few blocks from a stone outcrop the fixture had deliberately built as
 * walk-up rock:
 *
 *   Found 12 cobblestone candidates, but none has a safe reachable route
 *   (noPath:12). Collected 0 cobblestone.
 *
 * In the same log, `!breakBlock` at explicit coordinates broke stone from that
 * same outcrop without complaint. So the world was minable and the collection
 * skill said it was not. Reading the movement configuration produced one
 * confident hypothesis that turned out to be wrong (stone IS in
 * NATURAL_FILL_BLOCKS), which is the argument for measuring instead.
 *
 * This asks one question with one variable. Same skill, same command, same
 * pickaxe, same cleared floor, same distance -- only the SHAPE of the stone
 * changes:
 *
 *   A  three isolated stone blocks       the geometry verify-collection-field
 *                                        already covers, and the control
 *   B  one solid 4x3x4 stone mass        the orchestration outcrop, verbatim
 *
 * If A collects and B reports noPath, the defect is that a solid mass has no
 * legal stance the router will accept, and the shape is the whole cause. If
 * both collect, the outcrop is not the variable and this probe has cleared it
 * -- which is worth knowing before another twenty-minute course run.
 *
 * Requires a live stack (npm start) pointed at a DISPOSABLE world: this fills
 * and clears a 15x5x11 box and would damage a real save.
 */
import process from 'node:process';

import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const POLL_MS = 200;
const FLOOR = 'polished_andesite';
const TOOL = 'stone_pickaxe';
const COMMAND = '!collectBlocksInRange("cobblestone", 3, 64)';
// Cleared working box. Wide enough that nothing outside the fixture is in
// scanning range and the router cannot route around through real terrain.
const BOX = Object.freeze({ x1: 1026, y1: 99, z1: 1006, x2: 1040, y2: 103, z2: 1016 });
const BOT_STAND = Object.freeze({ x: 1033.5, y: 100, z: 1013.5 });

// A: stone under the surface, so reaching it requires digging DOWN through
// cover. The probe's first run met this shape by accident and it is the shape
// that failed, so it is the reproduction rather than the control.
const BURIED = Object.freeze([
  Object.freeze({ x: 1032, z: 1013 }),
  Object.freeze({ x: 1035, z: 1013 }),
  Object.freeze({ x: 1038, z: 1013 }),
]);
const BURIED_STONE_Y = 96;
// B: tools/verify-follow-field.mjs OUTCROP, copied exactly. Exposed rock the
// bot can walk up to and mine from the side.
const OUTCROP = Object.freeze({ x1: 1036, y1: 100, z1: 1012, x2: 1039, y2: 102, z2: 1015 });

function parseArgs(argv) {
  const options = { url: '', bot: 'MindcraftBot', authorized: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--url') options.url = String(argv[++index] || '');
    else if (argument === '--bot') options.bot = String(argv[++index] || '');
    else if (argument === '--authorized-active-world') options.authorized = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.url) throw new Error('An explicit --url is required.');
  if (!options.authorized) {
    throw new Error('This probe fills and clears world geometry. Pass --authorized-active-world.');
  }
  const parsed = new URL(options.url);
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  options.url = parsed.toString().replace(/\/$/, '');
  return options;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(read, accept, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await read();
    if (accept(latest)) return latest;
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${label}. Last: ${JSON.stringify(latest)?.slice(0, 400)}`);
}

async function post(baseUrl, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok || parsed?.success === false) {
      throw new Error(`${path} -> HTTP ${response.status} ${JSON.stringify(parsed)?.slice(0, 200)}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function connect(baseUrl) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { reconnection: false, timeout: 15_000, transports: ['websocket'] });
    const timer = setTimeout(() => { socket.close(); reject(new Error('socket connect timed out')); }, 15_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.close(); reject(error); });
  });
}

function emitAcknowledged(socket, event, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timed out`)), timeoutMs);
    socket.emit(event, ...args, result => { clearTimeout(timer); resolve(result); });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Fail with the actual reason rather than a state timeout. The first run of
  // this probe timed out waiting for a state that was never going to arrive,
  // and the cause was my own wrong call signature, not the stack.
  const readAgent = async () => {
    const agents = await fetch(`${options.url}/api/agents`).then(r => r.json()).catch(() => null);
    return agents?.agents?.find(entry => entry?.name === options.bot) || null;
  };
  const worldReady = entry => entry?.state === 'running'
    && entry?.in_game === true
    && entry?.socket_connected === true;

  const socket = await connect(options.url);

  // The agent process exits on its own between probe attempts, so asking for it
  // back is part of the probe rather than a manual step before it.
  if (!worldReady(await readAgent())) {
    process.stdout.write(`${options.bot} is not world-ready; starting it.\n`);
    await emitAcknowledged(socket, 'start-agent', [options.bot], 120_000).catch(() => null);
    await waitFor(readAgent, worldReady, `${options.bot} world-ready`, 180_000);
  }
  // applyStateUpdate(states, revisions, payload) -> {states, revisions,
  // resyncRequired}. One payload argument carrying the whole map, not a
  // (name, update) pair.
  let states = {};
  let revisions = {};
  const outputs = [];
  const receive = (payload) => {
    const applied = applyStateUpdate(states, revisions, payload);
    states = applied.states;
    revisions = applied.revisions;
    if (applied.resyncRequired) socket.emit('request-agent-state-snapshot');
  };
  socket.on('state-update', receive);
  socket.on('state-delta', receive);
  socket.on('bot-output', (name, output) => {
    if (name === options.bot) outputs.push(String(output).slice(0, 600));
  });
  socket.emit('listen-to-agents');
  socket.emit('request-agent-state-snapshot');

  const paper = command => post(options.url, '/api/minecraft-server/command', { command });
  const state = () => states?.[options.bot] || null;

  await waitFor(state, value => Boolean(value?.gameplay?.position), 'first bot state', 60_000);

  const results = [];

  for (const fixture of [
    { id: 'A', label: 'stone buried under cover (must dig down)', build: BURIED },
    { id: 'B', label: 'exposed solid 4x3x4 outcrop (walk up and mine)', build: OUTCROP },
    // Same buried geometry as A. The only change is where the bot is standing:
    // directly on top of the column instead of a block and a half away. If A
    // fails and C collects, the cause is the stance the route digger works
    // from, not the cover and not the shape of the stone.
    { id: 'C', label: 'stone buried under cover, bot standing on the column', build: BURIED, stand: { x: 1032.5, y: 100, z: 1013.5 } },
  ]) {
    await emitAcknowledged(socket, 'send-message', [options.bot, { message: '!stop' }]);
    await delay(1_500);

    // Move the bot in FIRST. The probe's first run issued its fills while the
    // bot was still at world spawn, the chunks were not loaded, every fill and
    // setblock was silently discarded, and the "fixture" the skill actually met
    // was untouched superflat terrain. The geometry has to exist before it can
    // be a variable.
    const stand = fixture.stand || BOT_STAND;
    await paper(`gamemode survival ${options.bot}`);
    await paper(`tp ${options.bot} ${stand.x} ${stand.y} ${stand.z}`);
    await delay(1_500);

    // Same clearance above, same tool, same start for both fixtures. Only the
    // position of the stone relative to the bot changes.
    await paper(`fill ${BOX.x1} ${BOX.y1 + 1} ${BOX.z1} ${BOX.x2} ${BOX.y2} ${BOX.z2} air`);
    if (fixture.id !== 'B') {
      // Cover, then stone beneath it. Everything between is ordinary dirt.
      await paper(`fill ${BOX.x1} ${BURIED_STONE_Y} ${BOX.z1} ${BOX.x2} ${BOX.y1} ${BOX.z2} dirt`);
      for (const column of BURIED) {
        await paper(`setblock ${column.x} ${BURIED_STONE_Y} ${column.z} stone`);
      }
    } else {
      await paper(`fill ${BOX.x1} ${BOX.y1} ${BOX.z1} ${BOX.x2} ${BOX.y1} ${BOX.z2} ${FLOOR}`);
      const mass = fixture.build;
      await paper(`fill ${mass.x1} ${mass.y1} ${mass.z1} ${mass.x2} ${mass.y2} ${mass.z2} stone`);
    }
    await paper(`kill @e[type=item,x=${BOX.x1},y=${BOX.y1},z=${BOX.z1},dx=14,dy=6,dz=10]`);
    // A zombie wandered in and the self-preservation reflex correctly retreated
    // 24 blocks, which ended the measurement and told us nothing about stone.
    // The follow harness clears a wide margin for exactly this reason.
    await paper('difficulty peaceful');
    await paper('kill @e[type=!player,x=976,y=60,z=956,dx=110,dy=80,dz=110]');
    await paper(`tp ${options.bot} ${stand.x} ${stand.y} ${stand.z}`);
    await paper(`clear ${options.bot} minecraft:cobblestone`);
    await paper(`clear ${options.bot} minecraft:${TOOL}`);
    await paper(`give ${options.bot} minecraft:${TOOL} 1`);
    await paper(`effect give ${options.bot} minecraft:instant_health 1 4 true`);
    await paper(`effect give ${options.bot} minecraft:saturation 180 1 true`);
    await delay(2_500);

    const before = Number(state()?.inventory?.counts?.cobblestone) || 0;
    const priorActionId = state()?.action?.lastResult?.actionId || null;
    outputs.length = 0;

    await emitAcknowledged(socket, 'send-message', [options.bot, { message: COMMAND }]);

    let terminal = null;
    try {
      terminal = await waitFor(
        () => state()?.action?.lastResult || null,
        result => Boolean(
          result?.actionId
          && result.actionId !== priorActionId
          && ['succeeded', 'failed'].includes(result.phase),
        ),
        `${fixture.id} collection result`,
        120_000,
      );
    } catch (error) {
      terminal = { phase: 'timeout', code: 'probe_timeout', detail: String(error.message).slice(0, 200) };
    }

    await delay(1_000);
    const after = Number(state()?.inventory?.counts?.cobblestone) || 0;
    results.push({
      fixture: fixture.id,
      geometry: fixture.label,
      phase: terminal?.phase || null,
      code: terminal?.code || null,
      collected: after - before,
      detail: String(terminal?.detail || '').slice(0, 1600),
      outputs: outputs.slice(-6),
    });
  }

  await emitAcknowledged(socket, 'send-message', [options.bot, { message: '!stop' }]);
  socket.close();

  process.stdout.write('\n=== collection geometry probe ===\n');
  for (const row of results) {
    process.stdout.write(
      `\n[${row.fixture}] ${row.geometry}\n`
      + `    phase     : ${row.phase} / ${row.code}\n`
      + `    collected : ${row.collected}\n`
      + `    detail    : ${row.detail}\n`,
    );
    for (const line of row.outputs) process.stdout.write(`    said      : ${line.slice(0, 200)}\n`);
  }
  const [control, subject] = results;
  process.stdout.write(
    `\nverdict: control ${control.collected > 0 ? 'collected' : 'did NOT collect'}, `
    + `solid mass ${subject.collected > 0 ? 'collected' : 'did NOT collect'}.\n`,
  );
  // Exit on the reproduction: A is the shape that fails today.
  process.exitCode = control.collected > 0 ? 0 : 3;
}

await main();
