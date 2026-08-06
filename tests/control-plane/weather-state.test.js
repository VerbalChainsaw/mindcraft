import assert from 'node:assert/strict';
import test from 'node:test';

import { minecraftWeather } from '../../src/agent/runtime/weather-state.js';

test('weather requires the server rain edge instead of stale intensity alone', () => {
  assert.equal(minecraftWeather({ isRaining: false, rainState: 0.4, thunderState: 0.7 }), 'Clear');
  assert.equal(minecraftWeather({ isRaining: true, rainState: 0.4, thunderState: 0 }), 'Rain');
  assert.equal(minecraftWeather({ isRaining: true, rainState: 0.4, thunderState: 0.7 }), 'Thunderstorm');
});
