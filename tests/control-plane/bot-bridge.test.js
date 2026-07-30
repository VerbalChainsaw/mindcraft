import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { io } from 'socket.io-client';

import {
  createMindServer,
  registerAgent,
  unregisterAgent,
} from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

async function closeMindServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

function connect(url, options = {}) {
  return io(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...options,
  });
}

test('Given a registered bot capability, when bridge clients connect, then only the matching capability is accepted as that bot', async () => {
  const agentName = 'BridgeBot';
  registerAgent({
    profile: { name: agentName, model: 'ollama/qwen2.5:3b' },
    host: '127.0.0.1',
    port: 25565,
  }, 3000, 'valid-bridge-capability');
  const server = await createMindServer(false, 0);
  const url = `http://localhost:${server.address().port}`;
  const invalid = connect(url, {
    auth: {
      role: 'agent',
      agentName,
      token: 'wrong-bridge-capability',
    },
  });

  try {
    const invalidOutcome = await Promise.race([
      once(invalid, 'connect').then(() => 'connected'),
      once(invalid, 'connect_error').then(([error]) => error.message),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ]);
    assert.match(invalidOutcome, /agent authentication failed/i);

    const valid = connect(url, {
      auth: {
        role: 'agent',
        agentName,
        token: 'valid-bridge-capability',
      },
    });
    try {
      await once(valid, 'connect');
      const response = await new Promise((resolve) => {
        valid.emit('get-settings', agentName, resolve);
      });
      assert.equal(response.settings.profile.name, agentName);

      valid.emit('set-agent-settings', agentName, {
        profile: { name: agentName },
        host: 'agent-bridge-must-not-administer',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const unchanged = await new Promise((resolve) => {
        valid.emit('get-settings', agentName, resolve);
      });
      assert.equal(unchanged.settings.host, '127.0.0.1');
    } finally {
      valid.disconnect();
    }
  } finally {
    invalid.disconnect();
    unregisterAgent(agentName);
    await closeMindServer(server);
  }
});

test('Given two authenticated bot bridges, when one sends agent-owned data, then its registered identity cannot be spoofed', async () => {
  registerAgent({ profile: { name: 'BridgeOne' } }, 3001, 'bridge-one-capability');
  registerAgent({ profile: { name: 'BridgeTwo' } }, 3002, 'bridge-two-capability');
  const server = await createMindServer(false, 0);
  const url = `http://localhost:${server.address().port}`;
  const one = connect(url, {
    auth: { role: 'agent', agentName: 'BridgeOne', token: 'bridge-one-capability' },
  });
  const two = connect(url, {
    auth: { role: 'agent', agentName: 'BridgeTwo', token: 'bridge-two-capability' },
  });
  const dashboard = connect(url);

  try {
    await Promise.all([once(one, 'connect'), once(two, 'connect'), once(dashboard, 'connect')]);
    one.emit('connect-agent-process', 'BridgeOne');
    two.emit('connect-agent-process', 'BridgeTwo');

    const foreignSettings = await new Promise((resolve) => {
      one.emit('get-settings', 'BridgeTwo', resolve);
    });
    assert.match(foreignSettings.error, /authenticated agent identity/i);

    const relayed = once(two, 'chat-message');
    one.emit('chat-message', 'BridgeTwo', { from: 'SpoofedName', message: 'hello' });
    const [sender, payload] = await relayed;
    assert.equal(sender, 'BridgeOne');
    assert.equal(payload.message, 'hello');

    const spoofedOutput = Promise.race([
      once(dashboard, 'bot-output').then(() => 'received'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 150)),
    ]);
    one.emit('bot-output', 'BridgeTwo', 'spoofed output');
    assert.equal(await spoofedOutput, 'blocked');

    const validOutput = once(dashboard, 'bot-output');
    one.emit('bot-output', 'BridgeOne', 'owned output');
    const [outputName, output] = await validOutput;
    assert.equal(outputName, 'BridgeOne');
    assert.equal(output, 'owned output');
  } finally {
    one.disconnect();
    two.disconnect();
    dashboard.disconnect();
    unregisterAgent('BridgeOne');
    unregisterAgent('BridgeTwo');
    await closeMindServer(server);
  }
});
