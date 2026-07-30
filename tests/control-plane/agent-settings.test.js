import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAgentSettings } from '../../src/mindcraft/agent-settings.js';

const spec = {
  profile: { type: 'object', required: true },
  auth: { type: 'string', default: 'offline', options: ['offline', 'microsoft'] },
  port: { type: 'number', default: 25565 },
  blocked_actions: { type: 'array', default: [] },
  task: { type: 'object', default: null },
};

test('Given valid bot settings, when normalized, then defaults are applied and unknown fields are removed', () => {
  assert.deepEqual(normalizeAgentSettings({
    profile: { name: 'SafeBot', model: 'ollama/qwen' },
    port: 25570,
    unknown: 'discard me',
  }, spec), {
    profile: { name: 'SafeBot', model: 'ollama/qwen' },
    auth: 'offline',
    port: 25570,
    blocked_actions: [],
    task: null,
  });
});

test('Given malformed or identity-changing bot settings, when normalized, then they are rejected', () => {
  assert.throws(
    () => normalizeAgentSettings({ profile: { name: '../escape' } }, spec),
    /3-16 alphanumeric/i,
  );
  assert.throws(
    () => normalizeAgentSettings({ profile: { name: 'OtherBot' }, port: Number.NaN }, spec, {
      expectedAgentName: 'SafeBot',
    }),
    /finite number|cannot change/i,
  );
});
