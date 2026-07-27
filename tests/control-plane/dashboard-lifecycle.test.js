import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

function requestSocket(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${event} response.`));
    }, 1000);
    socket.emit(event, ...args, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

async function closeMindServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

test('Given a non-retryable blocked agent, when the dashboard requests startup, then it receives the sanitized lifecycle failure', async () => {
  // Given
  const agentName = 'dashboard-blocked-agent';
  const server = await createMindServer(false, 0);
  const socket = io(`http://localhost:${server.address().port}`, {
    forceNew: true,
    transports: ['websocket'],
  });
  Mindcraft.registerBlockedAgent({
    profile: {
      name: agentName,
      model: 'ollama/local',
      url: 'https://private.example/v1',
      params: { apiKey: 'must-not-leak' },
    },
  }, {
    name: agentName,
    state: 'blocked',
    running: false,
    retryable: false,
    lastError: 'Duplicate agent name.',
  });

  try {
    await once(socket, 'connect');

    // When
    const response = await requestSocket(socket, 'start-agent', agentName);

    // Then
    assert.deepEqual(response, { success: false, error: 'Duplicate agent name.' });
    assert.doesNotMatch(JSON.stringify(response), /private|must-not-leak|url|apiKey/i);
  } finally {
    Mindcraft.destroyAgent(agentName);
    socket.disconnect();
    await closeMindServer(server);
  }
});

test('Given the dashboard source, when lifecycle cards are rendered, then blocked and failed agents have explicit recovery wiring', async () => {
  // Given
  const dashboardPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/index.html',
  );

  // When
  const dashboard = await readFile(dashboardPath, 'utf8');

  // Then
  assert.match(dashboard, /function renderAgentStateDetail\(agent, state\)/);
  assert.match(dashboard, /state\s*===\s*'blocked'/);
  assert.match(dashboard, /state\s*===\s*'failed'/);
  assert.match(dashboard, /socket\.emit\('start-agent',\s*n,\s*\(response\)/);
});

test('Given the dashboard source, when untrusted agent data is rendered, then dynamic markup and handlers stay safe', async () => {
  const dashboardPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/index.html',
  );
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /<html lang="en">/);
  assert.match(dashboard, /function escapeHtml\(value\)/);
  assert.match(dashboard, /const safeName = escapeHtml\(agent\.name\)/);
  assert.match(dashboard, /const lastMessage = escapeHtml\(agentLastMessage\[agent\.name\]/);
  assert.doesNotMatch(dashboard, /onerror\s*=\s*["']/i);
  assert.doesNotMatch(dashboard, /onclick="[^"]*\$\{[^}]*agent/);
  assert.match(dashboard, /iconElementForItem/);
  assert.match(dashboard, /renderEmptyAgents/);
  assert.match(dashboard, /#settingsForm, #agentSettingsForm/);
  assert.match(dashboard, /function isNonRetryableReason/);
  assert.match(dashboard, /duplicate\|already exists/);
});

test('Given dashboard lifecycle errors, when recovery guidance is classified, then unsupported providers stay non-retryable while missing credentials can retry', async () => {
  const dashboardPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/index.html',
  );
  const dashboard = await readFile(dashboardPath, 'utf8');
  const classifier = dashboard.match(/function isCredentialReason\(reason\) \{[\s\S]*?\n        \}/)?.[0] || '';

  assert.match(classifier, /missing/);
  assert.match(classifier, /not found/);
  assert.doesNotMatch(classifier, /provider/);
  assert.match(dashboard, /state === 'blocked'\) return isCredentialReason\(reason\)/);
  assert.match(dashboard, /credentialIssue && retryable/);
  assert.match(dashboard, /isNonRetryableReason\(reason\)/);
});

test('Given the setup wizard, when live enablement is explained, then local-provider, cloud-credential, Minecraft, and loopback limits are explicit', async () => {
  // Given
  const setupPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/mindcraft/public/setup.html',
  );

  // When
  const setup = await readFile(setupPath, 'utf8');

  // Then
  assert.match(setup, /Ollama, LM Studio, and vLLM local profiles do not need an API key/i);
  assert.match(setup, /cloud-backed profile requires its provider's API key/i);
  assert.match(setup, /MindServer stays loopback-only/i);
  assert.match(setup, /open a world to LAN/i);
});
