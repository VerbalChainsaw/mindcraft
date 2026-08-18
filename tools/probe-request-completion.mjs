#!/usr/bin/env node
/**
 * Does a plain-language request end in the player's hands?
 *
 *   node tools/probe-request-completion.mjs --url http://localhost:8081 \
 *     --bot Kevin --authorized-active-world
 *
 * The charcoal course answers this in forty minutes, and it answers a dozen
 * other questions at the same time, so a failure there never says which link
 * broke. Every link is now individually proven -- wood, pickaxe, cobblestone,
 * furnace, smelt -- and the chain still does not reach the player. On
 * 2026-08-18 one run crafted the furnace and stopped: "I have crafted one
 * furnace for you and have it in my inventory. Let me know if you want me to
 * place it or bring it to someone." Another collected eight logs and stopped:
 * "I have collected a total of 8 oak_log as requested. If you'd like me to
 * deliver or use them, please specify the next step."
 *
 * That is a sequencing and hand-over problem, and it does not need mining to
 * reproduce. These cases hold the materials constant -- the bot is GIVEN what
 * it needs -- and vary only how many steps separate the request from the
 * player's inventory:
 *
 *   1  hand over something already held        give
 *   2  make one thing, then hand it over       craft -> give
 *   3  make a thing that needs a sub-part      craft -> craft -> give
 *
 * Acceptance is the same in all three and is not a claim: the item count in the
 * RECIPIENT's inventory, read from a real second player on the server.
 *
 * Requires a live stack (npm start) on a DISPOSABLE world.
 */
import process from 'node:process';

import mineflayer from 'mineflayer';
import { io } from 'socket.io-client';

import { applyStateUpdate } from '../src/mindcraft/public/js/agent-state-protocol.js';

const POLL_MS = 250;
const RECIPIENT = 'RequestTarget';
const STAND = Object.freeze({ x: 1033.5, y: 100, z: 1013.5 });
// Long enough for a multi-step chain with model latency, short enough that a
// stalled case is obvious in minutes rather than after a lunch break.
const CASE_TIMEOUT_MS = 180_000;

// Cases 1-3 isolate hand-over. Cases 4-7 are drawn from the campaign record
// Gabriel recovered on 2026-08-18 -- deeds that physically worked once and were
// then frozen in prose instead of replayed. Each is trimmed to its
// player-visible outcome so it runs in a minute rather than a session.
const CASES = Object.freeze([
  {
    id: '1-give',
    label: 'hand over something already in inventory',
    grant: [['minecraft:oak_log', 8]],
    request: 'Give me 4 oak logs.',
    want: { item: 'oak_log', count: 4 },
  },
  {
    id: '2-craft-give',
    label: 'one craft, then hand over',
    grant: [['minecraft:oak_log', 8]],
    request: 'Make me 8 oak planks and give them to me.',
    want: { item: 'oak_planks', count: 8 },
  },
  {
    id: '3-chain-give',
    label: 'two crafts, then hand over',
    grant: [['minecraft:oak_log', 8]],
    request: 'Make me 4 sticks and hand them over.',
    want: { item: 'stick', count: 4 },
  },
  {
    // Campaign 28: log -> planks -> sticks -> wooden pickaxe, equipped, with
    // useful leftovers retained. Passed once, without repair.
    id: '4-tool-prep',
    label: 'campaign 28: prepare and equip a wooden pickaxe',
    grant: [['minecraft:oak_log', 4]],
    request: 'Make yourself a wooden pickaxe and equip it.',
    want: { item: 'wooden_pickaxe', count: 1, holder: 'bot' },
  },
  {
    // Campaigns 29 and 70: an exact spoken quantity, mined locally, delivered.
    // The only case here that needs the mining chain, and the only one that has
    // to dig -- superflat puts stone under seven layers of dirt, which is the
    // geometry that was refusing every candidate until tonight.
    id: '5-mine-exact',
    label: 'campaigns 29/70: mine an exact quantity and deliver it',
    grant: [['minecraft:stone_pickaxe', 1]],
    request: 'Mine 4 cobblestone and bring them to me.',
    want: { item: 'cobblestone', count: 4 },
    timeoutMs: 300_000,
  },
  {
    // Campaign 68: several distinct kit items from supplied ingredients, using
    // an existing table, keeping exactly those items.
    id: '6-kit',
    label: 'campaign 68: craft a multi-item kit and keep it',
    grant: [['minecraft:oak_planks', 32], ['minecraft:stick', 16], ['minecraft:cobblestone', 16]],
    request: 'Make a stone sword and a stone shovel.',
    want: { item: 'stone_sword', count: 1, holder: 'bot', also: [{ item: 'stone_shovel', count: 1 }] },
  },
  {
    // M2 workshop milestone: exact recipe at the camp table, one output,
    // delivered to the player who asked.
    id: '7-workshop',
    label: 'M2: craft at the table and deliver the exact output',
    grant: [['minecraft:iron_ingot', 8], ['minecraft:stick', 8]],
    request: 'Craft an iron axe and give it to me.',
    want: { item: 'iron_axe', count: 1 },
  },
]);

function parseArgs(argv) {
  const options = { url: '', bot: 'Kevin', authorized: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--url') options.url = String(argv[++index] || '');
    else if (argument === '--bot') options.bot = String(argv[++index] || '');
    else if (argument === '--authorized-active-world') options.authorized = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.url) throw new Error('An explicit --url is required.');
  if (!options.authorized) {
    throw new Error('This probe grants items and teleports players. Pass --authorized-active-world.');
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
  throw new Error(`Timed out waiting for ${label}.`);
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
      throw new Error(`${path} -> HTTP ${response.status}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function connectDashboard(baseUrl) {
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

// A real second player, because "delivered" has to mean an item moved between
// two inventories on the server, not a sentence in a transcript.
function connectRecipient() {
  return new Promise((resolve, reject) => {
    const target = mineflayer.createBot({
      host: '127.0.0.1',
      port: 25579,
      username: RECIPIENT,
      auth: 'offline',
      checkTimeoutInterval: 60_000,
    });
    const timer = setTimeout(() => { target.end(); reject(new Error(`${RECIPIENT} did not spawn in 20s`)); }, 20_000);
    target.once('spawn', () => { clearTimeout(timer); resolve(target); });
    target.on('error', () => {});
  });
}

const heldBy = (bot, item) => (bot?.inventory?.items() || [])
  .filter(entry => entry?.name === item)
  .reduce((total, entry) => total + (entry.count || 0), 0);

// Some campaigns end with the companion holding the thing, not the player --
// preparing its own pickaxe, keeping its own kit. Measuring those against the
// recipient would fail a deed that actually worked.
const botHolds = (states, name, item) => Number(states?.[name]?.inventory?.counts?.[item]) || 0;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const readAgent = async () => {
    const agents = await fetch(`${options.url}/api/agents`).then(r => r.json()).catch(() => null);
    return agents?.agents?.find(entry => entry?.name === options.bot) || null;
  };
  const worldReady = entry => entry?.state === 'running'
    && entry?.in_game === true
    && entry?.socket_connected === true;

  const socket = await connectDashboard(options.url);
  if (!worldReady(await readAgent())) {
    process.stdout.write(`${options.bot} is not world-ready; starting it.\n`);
    await emitAcknowledged(socket, 'start-agent', [options.bot], 120_000).catch(() => null);
    await waitFor(readAgent, worldReady, `${options.bot} world-ready`, 180_000);
  }

  let states = {};
  let revisions = {};
  const outputs = [];
  socket.on('state-update', payload => {
    const applied = applyStateUpdate(states, revisions, payload);
    states = applied.states;
    revisions = applied.revisions;
  });
  socket.on('state-delta', payload => {
    const applied = applyStateUpdate(states, revisions, payload);
    states = applied.states;
    revisions = applied.revisions;
  });
  socket.on('bot-output', (name, output) => {
    if (name === options.bot) outputs.push(String(output).slice(0, 400));
  });
  socket.emit('listen-to-agents');
  socket.emit('request-agent-state-snapshot');

  const paper = command => post(options.url, '/api/minecraft-server/command', { command });
  const recipient = await connectRecipient();
  const results = [];

  for (const testCase of CASES) {
    await emitAcknowledged(socket, 'send-message', [options.bot, { message: '!stop' }]);
    await delay(1_500);

    await paper(`gamemode survival ${options.bot}`);
    await paper(`gamemode survival ${RECIPIENT}`);
    await paper(`tp ${options.bot} ${STAND.x} ${STAND.y} ${STAND.z}`);
    await paper(`tp ${RECIPIENT} ${STAND.x + 2} ${STAND.y} ${STAND.z}`);
    // Case 6 opened believing it held one cobblestone when it had been granted
    // sixteen: the previous case's mining had left drops on the ground, and the
    // bot picked them up after the clear. A case that inherits the last case's
    // litter is not measuring what it claims to.
    await paper(`kill @e[type=item,x=${STAND.x},y=40,z=${STAND.z},dx=120,dy=140,dz=120]`);
    await paper(`clear ${options.bot}`);
    await paper(`clear ${RECIPIENT}`);
    for (const [item, count] of testCase.grant) await paper(`give ${options.bot} ${item} ${count}`);
    // Crafting without a table is limited to a 2x2 grid; planks and sticks fit,
    // but give it a table so the case is about sequencing, not grid size.
    await paper(`give ${options.bot} minecraft:crafting_table 1`);
    await paper(`effect give ${options.bot} minecraft:saturation 600 1 true`);
    await paper('difficulty peaceful');
    await paper(`kill @e[type=!player,x=${STAND.x},y=60,z=${STAND.z},dx=80,dy=80,dz=80]`);
    await delay(2_500);

    // Who has to end up holding it. Most campaigns end in the player's hands;
    // a few -- preparing its own tool, keeping its own kit -- end in the
    // companion's, and measuring those against the recipient would fail a deed
    // that actually worked.
    const wants = [testCase.want, ...(testCase.want.also || [])];
    const holderOf = want => want.holder === 'bot' || testCase.want.holder === 'bot' ? 'bot' : 'recipient';
    const readHeld = want => (holderOf(want) === 'bot'
        ? botHolds(states, options.bot, want.item)
        : heldBy(recipient, want.item));
    const before = new Map(wants.map(want => [want.item, readHeld(want)]));
    const satisfied = () => wants.every(want => readHeld(want) - (before.get(want.item) || 0) >= want.count);
    outputs.length = 0;
    const startedAt = Date.now();

    // Sent as the recipient's own chat, so the request comes from the player
    // who is supposed to end up holding the result.
    recipient.chat(testCase.request);

    let delivered = false;
    try {
      await waitFor(
        () => satisfied(),
        done => done === true,
        `${testCase.id} outcome`,
        testCase.timeoutMs || CASE_TIMEOUT_MS,
      );
      delivered = true;
    } catch { /* recorded below */ }

    results.push({
      id: testCase.id,
      label: testCase.label,
      request: testCase.request,
      want: wants.map(want => `${want.count}x ${want.item}`).join(' + '),
      holder: holderOf(testCase.want),
      received: wants
        .map(want => `${readHeld(want) - (before.get(want.item) || 0)}x ${want.item}`)
        .join(' + '),
      delivered,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      lastSaid: outputs.slice(-3),
    });
  }

  await emitAcknowledged(socket, 'send-message', [options.bot, { message: '!stop' }]);
  recipient.end();
  socket.close();

  process.stdout.write('\n=== request completion probe ===\n');
  for (const row of results) {
    process.stdout.write(
      `\n[${row.id}] ${row.label}\n`
      + `    asked     : "${row.request}"\n`
      + `    wanted    : ${row.want}\n`
      + `    received  : ${row.received}${row.delivered ? '' : '  <-- NOT DELIVERED'}\n`
      + `    seconds   : ${row.seconds}\n`,
    );
    for (const line of row.lastSaid) process.stdout.write(`    said      : ${line.slice(0, 220)}\n`);
  }
  const passed = results.filter(row => row.delivered).length;
  process.stdout.write(`\n${passed}/${results.length} requests ended in the player's inventory.\n`);
  process.exitCode = passed === results.length ? 0 : 1;
}

await main();
