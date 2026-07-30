import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBuilderStockpileOrder,
  nextBuilderStep,
} from '../../src/agent/runtime/jobs/builder-plan.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Given an autonomous idle Builder, the default order stockpiles and never grants construction authority', () => {
  const order = createBuilderStockpileOrder({ quota: 64 });
  assert.equal(order.kind, 'stockpile');
  assert.equal(order.source, 'role');
  assert.equal(order.target.name, 'planks');
  assert.equal(order.quota, 64);
  const stockpile = nextBuilderStep(order, { inventory: { oak_planks: 12 } });
  assert.equal(stockpile.command, '!prepareMaterial("planks", 52, 64)');
  assert.equal(stockpile.nextPhase, 'verify');

  const unauthorized = createWorkOrder({
    id: 'bad-build',
    role: 'builder',
    kind: 'build',
    source: 'role',
    target: { name: 'worksite', x: 0, y: 64, z: 0 },
    blueprint: {
      id: 'hut',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'stone' }],
    },
  });
  const step = nextBuilderStep(unauthorized, {
    blueprintAudit: { valid: true, missing: [{ x: 0, y: 64, z: 0, material: 'stone' }], incorrect: [] },
  });
  assert.equal(step.terminal, true);
  assert.equal(step.code, 'construction_not_authorized');
});

test('Given a hazardous, occupied, or trapping worksite, Builder chooses the safe bounded outcome', () => {
  const order = createWorkOrder({
    id: 'hazard-build',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    target: { name: 'worksite', x: 0, y: 64, z: 0 },
    blueprint: {
      id: 'hut',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'stone' }],
    },
  });

  for (const hazard of ['protected', 'liquid', 'unsupported', 'trapped_exit']) {
    const step = nextBuilderStep(order, {
      blueprintAudit: { valid: false, code: hazard, missing: [], incorrect: [] },
    });
    assert.equal(step.terminal, true);
    assert.equal(step.code, `unsafe_blueprint_${hazard}`);
  }
  const occupied = nextBuilderStep(order, {
    blueprintAudit: { valid: false, code: 'occupied', missing: [], incorrect: [] },
  });
  assert.equal(occupied.blocked, true);
  assert.equal(occupied.code, 'blueprint_occupied');
  assert.equal(occupied.retryable, true);
});

test('Given verified cells and inventory, Builder places only the next missing cell and completes only after an exact audit', () => {
  const base = createWorkOrder({
    id: 'build-resume',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    target: { name: 'worksite', x: 10, y: 64, z: 10 },
    blueprint: {
      id: 'wall',
      width: 2,
      depth: 1,
      height: 1,
      cells: [
        { x: 0, y: 0, z: 0, material: 'stone' },
        { x: 1, y: 0, z: 0, material: 'stone' },
      ],
    },
  });
  const order = { ...base, phase: 'execute', checkpoint: { verifiedCount: 1, nextCell: 1 } };
  const step = nextBuilderStep(order, {
    inventory: { stone: 1 },
    blueprintAudit: {
      valid: true,
      missing: [{ x: 11, y: 64, z: 10, material: 'stone', index: 1 }],
      incorrect: [],
      correct: 1,
    },
  });
  assert.equal(step.command, '!placeBlockAt("stone", 11, 64, 10)');
  assert.equal(step.nextPhase, 'verify');
  assert.deepEqual(step.checkpoint, { verifiedCount: 1, nextCell: 1 });

  const complete = nextBuilderStep({ ...order, phase: 'verify' }, {
    inventory: {},
    blueprintAudit: { valid: true, missing: [], incorrect: [], correct: 2 },
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.code, 'blueprint_complete');
});
