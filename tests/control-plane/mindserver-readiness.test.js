import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import * as Mindcraft from '../../src/mindcraft/mindcraft.js';
import {
  createMindServer,
  getServer,
  MindServerAlreadyRunningError,
  waitForMindServerListening,
} from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

async function closeListeningServer(server) {
  if (!server) return;
  if (!server.listening) await once(server, 'listening');
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('Given a delayed server listener, when MindServer readiness is awaited, then startup remains pending until listening', async () => {
  // Given
  const delayedServer = new EventEmitter();
  delayedServer.listen = () => delayedServer;

  // When
  let settled = false;
  const ready = waitForMindServerListening(delayedServer, 8080);
  ready.then(() => {
    settled = true;
  });
  await Promise.resolve();

  // Then
  assert.equal(settled, false);
  delayedServer.emit('listening');
  assert.equal(await ready, delayedServer);
});

test('Given an ephemeral MindServer port, when startup is awaited, then the returned server is listening', async () => {
  // Given
  const startup = createMindServer(false, 0);

  try {
    // When
    const startedServer = await startup;

    // Then
    assert.equal(startedServer.listening, true);
  } finally {
    await closeListeningServer(await startup);
    swarm.stop();
  }
});

test('Given an occupied loopback port, when listening is awaited, then EADDRINUSE rejects without crashing', async () => {
  // Given
  const occupiedServer = http.createServer();
  await waitForMindServerListening(occupiedServer, 0);
  const occupiedPort = occupiedServer.address().port;
  const rejectedServer = http.createServer();

  try {
    // When / Then
    await assert.rejects(
      () => waitForMindServerListening(rejectedServer, occupiedPort),
      (error) => error.code === 'EADDRINUSE',
    );
    assert.equal(rejectedServer.listening, false);
  } finally {
    await closeListeningServer(occupiedServer);
  }
});

test('Given a non-EADDRINUSE bind failure, when MindServer starts with a scan range, then it rejects without retrying', async () => {
  // Given / When / Then
  await assert.rejects(
    () => createMindServer(false, 65536, 10),
    (error) => error.code === 'ERR_SOCKET_BAD_PORT',
  );
});

test('Given a collision at the configured start port, when MindServer starts within its scan range, then it binds the next available port', async () => {
  // Given
  const occupiedServer = http.createServer();
  await waitForMindServerListening(occupiedServer, 0);
  const occupiedPort = occupiedServer.address().port;
  let startedServer;

  try {
    // When
    startedServer = await createMindServer(false, occupiedPort, 10);
    const selectedPort = startedServer.address().port;

    // Then
    assert.equal(startedServer.listening, true);
    assert.ok(selectedPort > occupiedPort && selectedPort < occupiedPort + 10);
  } finally {
    await closeListeningServer(startedServer);
    swarm.stop();
    await closeListeningServer(occupiedServer);
  }
});

test('Given an occupied port belongs to Mindcraft, when another launcher starts, then it refuses to create a competing control plane', async () => {
  // Given
  const occupiedServer = http.createServer((request, response) => {
    if (request.url !== '/api/identity') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      success: true,
      service: 'mindcraft-control-center',
      protocolVersion: 1,
    }));
  });
  await waitForMindServerListening(occupiedServer, 0);
  const occupiedPort = occupiedServer.address().port;

  try {
    // When / Then
    await assert.rejects(
      () => createMindServer(false, occupiedPort, 10),
      (error) => (
        error instanceof MindServerAlreadyRunningError
        && error.code === 'EMINDSERVERALREADYRUNNING'
        && error.port === occupiedPort
      ),
    );
  } finally {
    await closeListeningServer(occupiedServer);
    swarm.stop();
  }
});

test('Given a MindServer bind failure, when initialization is retried on an ephemeral port, then Mindcraft was not marked connected prematurely', async () => {
  // Given
  const occupiedServer = http.createServer();
  await waitForMindServerListening(occupiedServer, 0);
  const occupiedPort = occupiedServer.address().port;
  let startedServer;

  try {
    // When
    await assert.rejects(
      () => Mindcraft.init(false, occupiedPort, false, 1),
      (error) => error.code === 'EADDRINUSE',
    );
    const selectedPort = await Mindcraft.init(false, 0, false, 1);
    startedServer = getServer();

    // Then
    assert.equal(startedServer.listening, true);
    assert.equal(selectedPort, startedServer.address().port);
  } finally {
    await closeListeningServer(startedServer);
    swarm.stop();
    await closeListeningServer(occupiedServer);
  }
});
