import assert from 'node:assert/strict';
import test from 'node:test';

import { serverProxy } from '../../src/agent/mindserver_proxy.js';

test('MindServer peer count ignores stopped profiles when deciding whether open chat needs an address', () => {
  const priorAgent = serverProxy.agent;
  const priorAgents = serverProxy.agents;
  try {
    serverProxy.agent = { name: 'IronSuiteProof' };
    serverProxy.agents = [
      { name: 'IronSuiteProof', in_game: true },
      { name: 'StoppedPeer', in_game: false },
      { name: 'RunningPeer', in_game: true },
    ];
    assert.equal(serverProxy.getNumOtherAgents(), 1);

    serverProxy.agents[2].in_game = false;
    assert.equal(serverProxy.getNumOtherAgents(), 0);
  } finally {
    serverProxy.agent = priorAgent;
    serverProxy.agents = priorAgents;
  }
});
