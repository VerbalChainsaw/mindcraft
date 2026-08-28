import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blueprintEscapeStances,
  builderAccessReturnStance,
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

  const uphillAfterSurface = nextWorksiteReturnStep({
    ...order,
    checkpoint: { accessRequirement: null },
    evidence: { code: 'skill_surface_reached' },
  }, {
    x: 18,
    y: 66,
    z: -18,
    blueprintAudit: {
      missing: [{ index: 0, x: 12, y: 70, z: -18 }],
    },
  });
  assert.equal(uphillAfterSurface.code, 'worksite_return_required');
  assert.equal(uphillAfterSurface.command, '!goToCoordinates(12, 70, -18, 2)');

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

test('a Miner return that survived drowning resumes the same destination on a dry-only progressive route', () => {
  const order = {
    role: 'miner',
    kind: 'explore',
    phase: 'recover',
    resumePhase: 'execute',
    target: { name: 'ores', x: 166, y: 79, z: -380 },
    anchor: { x: 207, y: 69, z: -359 },
    evidence: { code: 'preempted' },
    checkpoint: {
      worksiteReturnPending: true,
      worksiteReturnDryOnly: true,
    },
  };

  const returnStep = nextWorksiteReturnStep(order, { x: 760, y: 64, z: -520 });
  assert.equal(returnStep.command, '!goToCoordinates(207, 69, -359, 2, true, true, true)');
  assert.equal(returnStep.recoveryAction, true);

  const arrived = nextWorksiteReturnStep(order, { x: 207, y: 69, z: -359 });
  assert.equal(arrived.code, 'worksite_return_satisfied');
  assert.equal(arrived.checkpoint.worksiteReturnPending, undefined);
  assert.equal(arrived.checkpoint.worksiteReturnDryOnly, undefined);
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

test('Builder returns through the designed access approach before executing from below an enclosure', () => {
  const order = {
    role: 'builder',
    kind: 'build',
    phase: 'execute',
    target: { name: 'functional_shelter', x: 164, y: 78, z: -382 },
    checkpoint: { nextCell: 82 },
    evidence: { code: 'cell_verified' },
    blueprint: {
      width: 5,
      depth: 5,
      cells: [
        { x: 0, y: 1, z: 2, material: 'spruce_door', function: 'access' },
        { x: 3, y: 1, z: 3, material: 'furnace', function: 'smelting' },
      ],
    },
  };

  assert.deepEqual(builderAccessReturnStance(order), { x: 163.5, y: 79, z: -379.5 });
  const step = nextWorksiteReturnStep(order, {
    x: 167.65,
    y: 76,
    z: -378.5,
    blueprintAudit: {
      missing: [{ index: 82, x: 167, y: 79, z: -379 }],
    },
  });

  assert.equal(step.code, 'worksite_access_return_required');
  assert.equal(step.command, '!goToCoordinates(163.5, 79, -379.5, 0.75)');
  assert.equal(step.keepAnchor, true);
});
