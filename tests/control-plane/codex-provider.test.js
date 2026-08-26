import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { buildHealthStatus } from '../../src/mindcraft/health-status.js';
import { describeModelProvider } from '../../src/models/_model_map.js';
import { CODEX_MODEL, Codex, resolveCodexCommand } from '../../src/models/codex.js';

let nextPid = 40_000;

function fakeChild(onInput) {
  const child = new EventEmitter();
  child.pid = nextPid++;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      onInput(String(chunk), child);
      callback();
    },
  });
  return child;
}

function sendJson(child, message) {
  child.stdout.write(`${JSON.stringify(message)}\n`);
}

function terminateFake(child) {
  if (child.exitCode === null) {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  }
  return Promise.resolve({ success: true, pid: child.pid });
}

test('Codex Windows resolution ignores stale npm packages that have no PATH shim', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-resolution-'));
  const decoy = path.join(root, 'decoy');
  const installed = path.join(root, 'installed');
  const relativeEntry = path.join('node_modules', '@openai', 'codex', 'bin', 'codex.js');
  try {
    await Promise.all([
      mkdir(path.dirname(path.join(decoy, relativeEntry)), { recursive: true }),
      mkdir(path.dirname(path.join(installed, relativeEntry)), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(decoy, relativeEntry), 'stale'),
      writeFile(path.join(installed, relativeEntry), 'current'),
      writeFile(path.join(installed, 'codex.cmd'), '@echo off'),
    ]);

    assert.deepEqual(resolveCodexCommand({
      platform: 'win32',
      env: { PATH: `${decoy}${path.delimiter}${installed}` },
    }), {
      command: process.execPath,
      prefixArgs: [path.join(installed, relativeEntry)],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function appServerHarness({ leaveTurnPending = false } = {}) {
  const requests = [];
  const spawns = [];
  let activeTurns = 0;
  let maxActiveTurns = 0;
  let threadNumber = 0;
  const spawn = (command, args, options) => {
    const child = fakeChild((raw, currentChild) => {
      for (const line of raw.split('\n').filter(Boolean)) {
        const message = JSON.parse(line);
        requests.push(message);
        if (message.method === 'initialize') {
          sendJson(currentChild, { id: message.id, result: { userAgent: 'fake' } });
        } else if (message.method === 'model/list') {
          sendJson(currentChild, {
            id: message.id,
            result: { data: [{ model: CODEX_MODEL }], nextCursor: null },
          });
        } else if (message.method === 'thread/start') {
          threadNumber += 1;
          sendJson(currentChild, {
            id: message.id,
            result: {
              model: CODEX_MODEL,
              thread: { id: `thread-${threadNumber}` },
            },
          });
        } else if (message.method === 'turn/start') {
          activeTurns += 1;
          maxActiveTurns = Math.max(maxActiveTurns, activeTurns);
          const turnId = `turn-${threadNumber}`;
          sendJson(currentChild, { id: message.id, result: { turn: { id: turnId } } });
          if (!leaveTurnPending) {
            setImmediate(() => {
              sendJson(currentChild, {
                method: 'item/completed',
                params: {
                  threadId: message.params.threadId,
                  turnId,
                  completedAtMs: Date.now(),
                  item: { id: `agent-${threadNumber}`, type: 'agentMessage', text: `answer-${threadNumber}` },
                },
              });
              sendJson(currentChild, {
                method: 'turn/completed',
                params: {
                  threadId: message.params.threadId,
                  turn: { id: turnId, status: 'completed', items: [] },
                },
              });
              activeTurns -= 1;
            });
          }
        } else if (message.method === 'turn/interrupt') {
          sendJson(currentChild, { id: message.id, result: {} });
          setImmediate(() => {
            sendJson(currentChild, {
              method: 'turn/completed',
              params: {
                threadId: message.params.threadId,
                turn: { id: message.params.turnId, status: 'interrupted', items: [] },
              },
            });
            activeTurns = Math.max(0, activeTurns - 1);
          });
        }
      }
    });
    spawns.push({ command, args, options, child });
    return child;
  };
  return { spawn, spawns, requests, get maxActiveTurns() { return maxActiveTurns; } };
}

test('Codex app-server uses exact ephemeral text-only JSONL turns and strips inherited API-key variables', async () => {
  const harness = appServerHarness();
  const model = new Codex(CODEX_MODEL, null, { timeout: 1 }, {
    spawn: harness.spawn,
    terminateProcessTree: terminateFake,
    command: { command: 'fake-codex', prefixArgs: [] },
    env: {
      PATH: 'fake-path',
      OPENAI_API_KEY: 'must-not-reach-child',
      CODEX_API_KEY: 'must-not-reach-child',
      CODEX_ACCESS_TOKEN: 'must-not-reach-child',
      SAFE_VALUE: 'preserved',
    },
  });

  try {
    const [first, second] = await Promise.all([
      model.sendRequest([{ role: 'user', content: 'first' }], 'system-one'),
      model.sendRequest([{ role: 'user', content: 'second' }], 'system-two'),
    ]);
    assert.deepEqual([first, second], ['answer-1', 'answer-2']);
    assert.equal(harness.spawns.length, 1);
    assert.equal(harness.maxActiveTurns, 1);

    const [{ args, options }] = harness.spawns;
    assert.deepEqual(args, ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}']);
    assert.equal(options.shell, false);
    assert.equal(options.env.SAFE_VALUE, 'preserved');
    assert.equal(Object.hasOwn(options.env, 'OPENAI_API_KEY'), false);
    assert.equal(Object.hasOwn(options.env, 'CODEX_API_KEY'), false);
    assert.equal(Object.hasOwn(options.env, 'CODEX_ACCESS_TOKEN'), false);

    const initialize = harness.requests.find(({ method }) => method === 'initialize');
    assert.equal(initialize.params.capabilities.experimentalApi, true);
    assert.ok(harness.requests.some(({ method }) => method === 'initialized'));
    const threads = harness.requests.filter(({ method }) => method === 'thread/start');
    assert.equal(threads.length, 2);
    for (const { params } of threads) {
      assert.equal(params.model, CODEX_MODEL);
      assert.equal(params.allowProviderModelFallback, false);
      assert.equal(params.approvalPolicy, 'never');
      assert.equal(params.sandbox, 'read-only');
      assert.equal(params.ephemeral, true);
      assert.deepEqual(params.environments, []);
      assert.deepEqual(params.dynamicTools, []);
    }
    const turns = harness.requests.filter(({ method }) => method === 'turn/start');
    assert.ok(turns.every(({ params }) => params.model === CODEX_MODEL));
    assert.ok(turns.every(({ params }) => params.sandboxPolicy.type === 'readOnly'));
    assert.ok(turns.every(({ params }) => params.sandboxPolicy.networkAccess === false));
  } finally {
    await model.dispose();
    await model.dispose();
  }
});

test('Codex cancellation interrupts only the pending turn and rejects queued generation', async () => {
  const harness = appServerHarness({ leaveTurnPending: true });
  const model = new Codex(CODEX_MODEL, null, { timeout: 30 }, {
    spawn: harness.spawn,
    terminateProcessTree: terminateFake,
    command: { command: 'fake-codex', prefixArgs: [] },
    env: { PATH: 'fake-path' },
  });

  try {
    const active = model.sendRequest([{ role: 'user', content: 'wait' }], 'wait');
    const queued = model.sendRequest([{ role: 'user', content: 'queued' }], 'queued');
    while (!harness.requests.some(({ method }) => method === 'turn/start')) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(model.cancelPending(), 2);
    await assert.rejects(active, error => error.code === 'CANCELLED');
    await assert.rejects(queued, error => error.code === 'CANCELLED');
    while (!harness.requests.some(({ method }) => method === 'turn/interrupt')) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(harness.requests.filter(({ method }) => method === 'turn/interrupt').length, 1);
  } finally {
    await model.dispose();
  }
});

test('Codex uses ephemeral JSON exec only when app-server startup protocol is unsupported', async () => {
  const spawns = [];
  const spawn = (command, args, options) => {
    const appServer = args.includes('app-server');
    const child = fakeChild((raw, currentChild) => {
      if (appServer) {
        const request = JSON.parse(raw.trim());
        if (request.method === 'initialize') {
          sendJson(currentChild, {
            id: request.id,
            error: { code: -32601, message: 'Method not found: initialize' },
          });
        }
        return;
      }
      setImmediate(() => {
        sendJson(currentChild, {
          type: 'item.completed',
          item: { id: 'fallback-message', type: 'agent_message', text: 'fallback-ok' },
        });
        sendJson(currentChild, { type: 'turn.completed' });
        currentChild.exitCode = 0;
        currentChild.emit('exit', 0, null);
      });
    });
    spawns.push({ command, args, options, child });
    return child;
  };
  const model = new Codex(CODEX_MODEL, null, { timeout: 30 }, {
    spawn,
    terminateProcessTree: terminateFake,
    command: { command: 'fake-codex', prefixArgs: [] },
    env: { PATH: 'fake-path' },
  });

  try {
    assert.equal(await model.sendRequest([{ role: 'user', content: 'fallback' }], 'fallback'), 'fallback-ok');
    assert.equal(spawns.length, 2);
    assert.ok(spawns[0].args.includes('app-server'));
    assert.deepEqual(spawns[1].args.slice(0, 7), [
      'exec', '--ephemeral', '--json', '--sandbox', 'read-only', '-C', spawns[1].options.cwd,
    ]);
    assert.ok(spawns[1].args.includes(CODEX_MODEL));
    assert.ok(spawns[1].args.includes('--ignore-user-config'));
    assert.equal(spawns[1].args.at(-1), '-');
  } finally {
    await model.dispose();
  }
});

test('Codex provider advertises OAuth/no-key readiness and accepts caller-selected models', async () => {
  assert.deepEqual(describeModelProvider({ model: `codex/${CODEX_MODEL}` }), {
    ok: true,
    provider: 'codex',
    credentialAlternatives: [],
  });
  assert.deepEqual(describeModelProvider({ model: 'codex/another-model' }), {
    ok: true,
    provider: 'codex',
    credentialAlternatives: [],
  });
  const selected = new Codex('another-model', null, {}, {
    command: { command: 'unused', prefixArgs: [] },
  });
  assert.equal(selected.model_name, 'another-model');
  await selected.dispose();
  const health = buildHealthStatus({
    anyApiKey: false,
    keysFileExists: false,
    minecraftReachable: true,
    minecraftTarget: '127.0.0.1:25565',
    agents: [{ in_game: true }],
    selectedProfiles: [{
      name: 'CodexBot',
      state: 'ready',
      providerRoles: [{ role: 'chat model', provider: 'codex' }],
      reason: null,
    }],
  });
  assert.equal(health.ok, true);
  assert.equal(health.problems.some(problem => /API key/i.test(problem)), false);

  const model = new Codex(CODEX_MODEL, null, {}, {
    command: { command: 'unused', prefixArgs: [] },
  });
  await assert.rejects(model.embed('text'), error => error.code === 'UNSUPPORTED_EMBEDDING');
  await assert.rejects(model.sendVisionRequest([], '', Buffer.alloc(0)), error => error.code === 'UNSUPPORTED_VISION');
  await model.dispose();
});
