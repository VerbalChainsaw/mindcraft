import assert from 'node:assert/strict';
import test from 'node:test';

import { scanMinecraftPorts } from '../../src/mindcraft/mcserver.js';

test('Given a LAN port range, when discovery runs, then probes are bounded-concurrent and early exit preserves port order', async () => {
  let active = 0;
  let maximumActive = 0;
  const originalConsoleLog = console.log;
  const checked = [];

  const servers = await scanMinecraftPorts({
    startPort: 49_000,
    endPort: 49_008,
    concurrency: 3,
    earlyExit: true,
    checkPort: async (port) => {
      assert.equal(console.log, originalConsoleLog);
      checked.push(port);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return port === 49_004 ? port : null;
    },
    inspectPort: (port) => ({ host: '127.0.0.1', port }),
  });

  assert.equal(maximumActive, 3);
  assert.deepEqual(servers, [{ host: '127.0.0.1', port: 49_004 }]);
  assert.deepEqual(checked, [49_000, 49_001, 49_002, 49_003, 49_004, 49_005]);
  assert.equal(console.log, originalConsoleLog);
});
