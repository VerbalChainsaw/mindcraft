import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const outputDir = process.argv[2];
const label = process.argv[3] || 'sample';
// MindServer's port comes from launcher-config.json and is not 8080 any more.
// This was hardcoded, so state capture connected to a dead port and the run
// died with a bare "websocket error" one step before the harness ever started.
const baseUrl = process.argv[4]
  || process.env.SCENARIO_LAB_MINDSERVER_URL
  || 'http://localhost:8080';
if (!outputDir) throw new Error('Usage: node capture-agent-state.mjs <output-dir> [label] [base-url]');
fs.mkdirSync(outputDir, { recursive: true });

const requireFromRepo = createRequire(path.join(repo, 'package.json'));
const { io } = requireFromRepo('socket.io-client');
const { applyStateUpdate } = await import(
  pathToFileURL(path.join(repo, 'src', 'mindcraft', 'public', 'js', 'agent-state-protocol.js')).href
);

let states = {};
let revisions = {};
let finished = false;
let captureTimer;
let hardTimer;
const socket = io(baseUrl, {
  transports: ['websocket'],
  timeout: 5000,
  reconnection: false,
});

function selectAgent() {
  return states.MindcraftBot
    || Object.values(states).find(value => value?.name === 'MindcraftBot')
    || null;
}

function closeWithError(error) {
  if (finished) return;
  finished = true;
  clearTimeout(captureTimer);
  clearTimeout(hardTimer);
  socket.disconnect();
  console.error(String(error?.stack || error));
  process.exitCode = 1;
}

function finish() {
  if (finished) return;
  const state = selectAgent();
  if (!state) return closeWithError(new Error('No MindcraftBot state arrived.'));
  finished = true;
  clearTimeout(captureTimer);
  clearTimeout(hardTimer);
  socket.disconnect();

  const sample = {
    observed_utc: new Date().toISOString(),
    label,
    wire_revision: revisions.MindcraftBot ?? null,
    gameplay: state.gameplay ?? null,
    body: state.body ?? null,
    inventory: state.inventory ?? null,
    action: state.action ?? null,
    progression: state.progression ?? null,
    perception: state.perception ?? null,
    companion: state.companion ?? null,
  };
  fs.writeFileSync(
    path.join(outputDir, 'latest-state.json'),
    JSON.stringify(sample, null, 2) + '\n',
    'utf8',
  );
  fs.appendFileSync(
    path.join(outputDir, 'live-samples.jsonl'),
    JSON.stringify(sample) + '\n',
    'utf8',
  );
  console.log(JSON.stringify({
    observed_utc: sample.observed_utc,
    label,
    position: sample.gameplay?.position ?? null,
    health: sample.gameplay?.health ?? null,
    hunger: sample.gameplay?.hunger ?? null,
    main_hand: sample.body?.mainHand ?? sample.inventory?.equipment?.mainHand ?? null,
    inventory: sample.inventory?.counts ?? null,
    action_current: sample.action?.current ?? null,
    action_idle: sample.action?.isIdle ?? null,
    last_result: sample.action?.lastResult ?? null,
  }));
}

function receive(payload) {
  const applied = applyStateUpdate(states, revisions, payload);
  states = applied.states;
  revisions = applied.revisions;
  if (applied.resyncRequired) socket.emit('request-agent-state-snapshot');
  if (selectAgent() && !captureTimer) captureTimer = setTimeout(finish, 700);
}

socket.on('state-update', receive);
socket.on('state-delta', receive);
socket.on('connect', () => {
  socket.emit('listen-to-agents');
  setTimeout(() => socket.emit('request-agent-state-snapshot'), 100);
});
socket.on('connect_error', closeWithError);
socket.on('error', closeWithError);
hardTimer = setTimeout(
  () => closeWithError(new Error('Timed out waiting for dashboard state.')),
  9000,
);
