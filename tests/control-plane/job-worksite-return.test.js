import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blueprintEscapeStances,
  nextWorksiteReturnStep,
} from '../../src/agent/runtime/job-director.js';

test('Builder composes surface access and native worksite return before blueprint execution', () => {
  const order = {
    role: 'builder',
    kind: 'build',
    phase: 'execute',
    target: { name: 'construction_site', x: 10, y: 70, z: -20 },
    evidence: { code: 'materials_ready' },
  };
  const vertical = nextWorksiteReturnStep(order, {
    x: 12,
    y: 12,
    z: -18,
  });

  assert.equal(vertical.code, 'worksite_surface_access_required');
  assert.equal(vertical.capability.id, 'reach_surface');
  assert.deepEqual(vertical.checkpoint.accessRequirement, { kind: 'surface' });
  assert.equal(vertical.keepAnchor, true);

  const continueVertical = nextWorksiteReturnStep({
    ...order,
    checkpoint: { accessRequirement: { kind: 'surface' } },
    evidence: { code: 'capability_verified_partial_progress' },
  }, {
    x: 12,
    y: 66,
    z: -18,
  });
  assert.equal(continueVertical.capability.id, 'reach_surface');

  const surfaceSatisfied = nextWorksiteReturnStep({
    ...order,
    checkpoint: { accessRequirement: { kind: 'surface' } },
    evidence: { code: 'skill_surface_reached' },
  }, {
    x: 12,
    y: 70,
    z: -18,
  });
  assert.equal(surfaceSatisfied.code, 'worksite_surface_access_satisfied');
  assert.equal(surfaceSatisfied.checkpoint.accessRequirement, null);

  const horizontal = nextWorksiteReturnStep(order, {
    x: 40,
    y: 70,
    z: -20,
  });
  assert.equal(horizontal.code, 'worksite_return_required');
  assert.equal(horizontal.command, '!goToCoordinates(10, 70, -20, 2)');
  assert.equal(horizontal.keepAnchor, true);

  const staleAcquisitionAnchor = nextWorksiteReturnStep({
    ...order,
    anchor: { x: -12, y: 20, z: 8 },
  }, {
    x: -12,
    y: 20,
    z: 8,
  });
  assert.equal(staleAcquisitionAnchor.code, 'worksite_surface_access_required');
  assert.deepEqual(staleAcquisitionAnchor.target, { name: 'surface_access' });

  const remoteFromNextCell = nextWorksiteReturnStep({
    ...order,
    anchor: { x: -12, y: 70, z: 8 },
    checkpoint: { nextCell: 44 },
  }, {
    x: -12,
    y: 70,
    z: 8,
    blueprintAudit: {
      missing: [{ index: 44, x: 12, y: 72, z: -18 }],
    },
  });
  assert.equal(remoteFromNextCell.code, 'worksite_return_required');
  assert.equal(remoteFromNextCell.command, '!goToCoordinates(12, 70, -18, 2)');
});

test('Construction escape candidates include safe one-block descents outside the footprint', () => {
  const bot = {
    entity: { position: { x: 4.5, y: 65, z: 4.5 } },
    blockAt(position) {
      if (position.y === 63) return { name: 'stone', boundingBox: 'block' };
      return { name: 'air', boundingBox: 'empty' };
    },
  };
  const stances = blueprintEscapeStances(bot, {
    target: { x: 0, y: 64, z: 0 },
    blueprint: { width: 5, depth: 5 },
  });

  assert.ok(stances.some(position => position.x === 4 && position.y === 64 && position.z === 5));
});
