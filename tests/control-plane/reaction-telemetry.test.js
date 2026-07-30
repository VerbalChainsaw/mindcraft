import assert from 'node:assert/strict';
import test from 'node:test';

import { getReactionDirectorState } from '../../src/agent/library/full_state.js';

test('Reaction telemetry exposes bounded rates and status without event contents', () => {
  const state = getReactionDirectorState({
    reaction_director: {
      snapshot: () => ({
        phase: 'succeeded',
        code: 'reaction_delivered',
        spoken: 3,
        gestures: 1,
        fallbacks: 2,
        lastEventId: 'event-1',
        detail: 'done'.repeat(100),
        queued: 4,
        events: [{ secret: true }],
      }),
    },
  });

  assert.deepEqual(state, {
    phase: 'succeeded',
    code: 'reaction_delivered',
    spoken: 3,
    gestures: 1,
    fallbacks: 2,
    lastEventId: 'event-1',
    detail: 'done'.repeat(70),
    queued: 4,
  });
});
