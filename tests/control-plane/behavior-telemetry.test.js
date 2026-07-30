import assert from 'node:assert/strict';
import test from 'node:test';

import { behaviorStatusLabel } from '../../src/mindcraft/public/js/utils.js';

test('Dashboard behavior summary renders only bounded server-projected director state', () => {
  const action = {
    survivalDirector: { phase: 'waiting', code: 'missing_safe_food' },
    jobDirector: {
      phase: 'recovering',
      code: 'skill_unreachable',
      workOrder: {
        role: 'miner',
        kind: 'mine',
        phase: 'recover',
        checkpoint: { collected: 4 },
      },
    },
    reactionDirector: { phase: 'succeeded', code: 'reaction_delivered', queued: 2 },
  };

  const label = behaviorStatusLabel(action);

  assert.equal(
    label,
    'Survival waiting: missing safe food · Miner mine: recover (4 verified) · Reactions delivered (2 queued)',
  );
  assert.equal(label.length < 240, true);
});
