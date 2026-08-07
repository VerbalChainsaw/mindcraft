import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBuilderConstructionOrder,
  createBuilderStockpileOrder,
  createConstructionBlueprint,
  nextBuilderStep,
} from '../../src/agent/runtime/jobs/builder-plan.js';
import {
  expandStructureDesign,
  parseStructureDesign,
} from '../../src/agent/runtime/jobs/structure-design.js';
import { bindStructureAccessoryMaterials } from '../../src/agent/runtime/jobs/structure-material-binder.js';
import { createWorkOrder } from '../../src/agent/runtime/work-order.js';
import { getCommandDocs } from '../../src/agent/commands/index.js';

test('general construction compiler creates bounded supported shapes with a safe room doorway', () => {
  const compactDocs = getCommandDocs({ blocked_actions: [] }, { compact: true });
  assert.match(compactDocs, /DESIGN MUST BE THIS DSL, NEVER PROSE/);
  assert.match(compactDocs, /block X Y Z MATERIAL/);
  assert.match(compactDocs, /Fixtures MUST use put, never block/);
  assert.match(compactDocs, /torches go in interior air adjacent to a same-height solid wall/);
  assert.match(compactDocs, /bed occupies its anchor plus one block in its facing direction/i);

  const mixed = expandStructureDesign(
    'slab 0 0 0 5 5 cobblestone; ring 0 1 0 5 5 rail; block 2 1 0 powered_rail; block 2 1 1 redstone_torch',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  );
  assert.deepEqual(
    new Set(mixed.cells.map(cell => cell.material)),
    new Set(['cobblestone', 'rail', 'powered_rail', 'redstone_torch']),
  );
  assert.throws(() => expandStructureDesign(
    'slab 0 0 0 3 3 cobblestone; block 0 0 0 redstone_torch; block 0 1 0 powered_rail',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  ), /no path down to the ground/i);

  const habitable = expandStructureDesign(
    'room 0 0 0 5 4 5 cobblestone; put 0 1 2 door east; put 1 1 1 bed south',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  );
  assert.deepEqual(
    habitable.fixtures.map(({ kind, facing, occupiedOffsets }) => ({ kind, facing, occupiedOffsets })),
    [
      {
        kind: 'door',
        facing: 'east',
        occupiedOffsets: [
          { x: 0, y: 0, z: 0, part: 'lower' },
          { x: 0, y: 1, z: 0, part: 'upper' },
        ],
      },
      {
        kind: 'bed',
        facing: 'south',
        occupiedOffsets: [
          { x: 0, y: 0, z: 0, part: 'foot' },
          { x: 0, y: 0, z: 1, part: 'head' },
        ],
      },
    ],
  );
  assert.throws(() => expandStructureDesign(
    'slab 0 0 0 5 5 cobblestone; shell 0 1 0 5 3 5 cobblestone; carve 0 1 2 1 2 1; put 0 1 2 door east; put 1 1 1 bed south',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  ), /weather_cover|open to the sky/i);
  assert.throws(() => expandStructureDesign(
    'shell 0 0 0 5 4 5 cobblestone; carve 2 1 0 1 2 1; put 2 1 0 door north; put 1 1 1 bed east',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  ), /lacks planned solid support.*bed occupies its anchor plus one block/i);
  assert.throws(() => expandStructureDesign(
    'room 0 0 0 7 4 5 cobblestone; put 1 1 4 bed south',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  ), /bed occupies its anchor plus one block.*move it inward.*supported interior floor/i);
  assert.throws(() => expandStructureDesign(
    'room 0 0 0 5 4 5 cobblestone; put 1 1 1 bed north',
    'cobblestone',
    { canSupportMaterial: name => name === 'cobblestone' },
  ), /occupied head cell.*move it or face it into clear interior space/i,
  'an explicit facing must not silently rotate, and its correction must describe the occupancy defect');

  const platform = createConstructionBlueprint({
    shape: 'platform',
    width: 4,
    depth: 3,
    height: 1,
    material: 'cobblestone',
  });
  assert.equal(platform.cells.length, 12);
  assert.ok(platform.cells.every(cell => cell.y === 0 && cell.function === 'supported_surface'));

  const room = createConstructionBlueprint({
    shape: 'room',
    width: 5,
    depth: 5,
    height: 4,
    material: 'stone',
  });
  assert.equal(room.cells.some(cell => cell.x === 0 && cell.y === 1 && cell.z === 2), false);
  assert.equal(room.cells.some(cell => cell.x === 0 && cell.y === 2 && cell.z === 2), false);
  assert.equal(room.cells.filter(cell => cell.function === 'foundation').length, 25);
  assert.equal(room.cells.filter(cell => cell.function === 'weather_cover').length, 25);

  const order = createBuilderConstructionOrder({
    x: 10,
    y: 64,
    z: -4,
    shape: 'wall',
    width: 6,
    depth: 1,
    height: 3,
    material: 'stone_bricks',
  });
  assert.equal(order.source, 'player');
  assert.equal(order.kind, 'build');
  assert.equal(order.blueprint.cells.length, 18);
  assert.deepEqual(order.target, { name: 'construction_site', x: 10, y: 64, z: -4 });

  let plannerRequest = null;
  const acquire = nextBuilderStep(
    {
      ...order,
      phase: 'acquire',
      checkpoint: { failedMethods: ['collect:stone->stone_bricks'] },
    },
    {
      inventory: {},
      freeSlots: 12,
      blueprintAudit: {
        valid: true,
        incorrect: [],
        missing: [{ x: 10, y: 64, z: -4, material: 'stone_bricks', supported: true }],
      },
    },
    {
      phase: 'failed',
      evidence: {
        skill: {
          toolRequirement: { name: 'stone_pickaxe', minimumUsableDurability: 24 },
        },
      },
    },
    {
      planItem: request => {
        plannerRequest = request;
        return {
          status: 'ready',
          nextStep: {
            capability: { id: 'craft', arguments: { item: request.target, batches: 1, expectedIncrease: 4 } },
            reason: 'Use the shared prerequisite catalogue.',
            learningKey: 'craft:stone_bricks<-4xstone',
          },
        };
      },
    },
  );
  assert.equal(acquire.command, undefined);
  assert.equal(acquire.capability.id, 'craft');
  assert.equal(acquire.code, 'material_prerequisite_planned');
  assert.deepEqual(plannerRequest.toolRequirement, {
    name: 'stone_pickaxe',
    minimumUsableDurability: 24,
  });
  assert.deepEqual(plannerRequest.excludedMethods, ['collect:stone->stone_bricks']);
  assert.equal(acquire.methodKey, 'craft:stone_bricks<-4xstone');
  assert.equal(acquire.nextPhase, 'acquire');
  assert.deepEqual(acquire.checkpoint.acquisitionRequirement, {
    target: 'stone_bricks',
    quantity: 1,
  });
  assert.equal(plannerRequest.allowEntityAlternatives, true);
  assert.deepEqual(acquire.checkpoint.toolRequirement, plannerRequest.toolRequirement);

  const remoteAcquire = nextBuilderStep(
    {
      ...order,
      phase: 'recover',
      checkpoint: {
        acquisitionRequirement: { target: 'stone_bricks', quantity: 1 },
        acquisitionVariantCommitted: true,
      },
    },
    {
      inventory: {},
      freeSlots: 12,
      blueprintAudit: { valid: false, code: 'unloaded' },
    },
    null,
    {
      planItem: request => {
        assert.equal(request.allowEntityAlternatives, false);
        return {
          status: 'ready',
          nextStep: {
            capability: { id: 'collect', arguments: { item: request.target, quantity: 1 } },
            reason: 'Continue acquisition in the verified search region.',
          },
        };
      },
    },
  );
  assert.equal(remoteAcquire.command, undefined);
  assert.equal(remoteAcquire.capability.id, 'collect');
  assert.equal(remoteAcquire.nextPhase, 'acquire');
  assert.deepEqual(remoteAcquire.target, { name: 'stone_bricks' });

  const capacity = nextBuilderStep(
    { ...createBuilderStockpileOrder({ material: 'stone_bricks', quota: 16 }), phase: 'acquire' },
    {
      inventory: {},
      freeSlots: 0,
      deposit: { mode: 'inventory' },
      blueprintAudit: { valid: true, incorrect: [], missing: [] },
    },
  );
  assert.equal(
    capacity.command,
    '!releaseInventoryWorkingSlots("stone_bricks", 2)',
  );
  assert.equal(capacity.nextPhase, 'acquire');
  assert.equal(capacity.code, 'inventory_capacity_release_required');

  const buildCapacity = nextBuilderStep(
    { ...order, phase: 'acquire' },
    {
      inventory: {},
      freeSlots: 0,
      deposit: { mode: 'inventory' },
      blueprintAudit: {
        valid: true,
        incorrect: [],
        missing: [{ x: 10, y: 64, z: -4, material: 'stone_bricks', supported: true }],
      },
    },
  );
  assert.equal(buildCapacity.command, '!releaseInventoryWorkingSlots("stone_bricks", 2)');
  assert.equal(buildCapacity.nextPhase, 'acquire');
  assert.equal(buildCapacity.code, 'inventory_capacity_release_required');

  const continueMining = nextBuilderStep(
    { ...order, phase: 'acquire' },
    {
      inventory: {},
      freeSlots: 0,
      deposit: { mode: 'inventory' },
      blueprintAudit: {
        valid: true,
        incorrect: [],
        missing: [{ x: 10, y: 64, z: -4, material: 'stone_bricks', supported: true }],
      },
    },
    {
      phase: 'failed',
      evidence: {
        skill: {
          progress: {
            verified: true,
            kind: 'mining_route_cell',
            position: { x: 4, y: 42, z: -8 },
          },
        },
      },
    },
    {
      planItem: () => ({
        status: 'ready',
        nextStep: {
          capability: { id: 'collect', arguments: { item: 'stone_bricks', quantity: 1 } },
          reason: 'Continue the verified acquisition route.',
        },
      }),
    },
  );
  assert.equal(continueMining.command, undefined);
  assert.equal(continueMining.capability.id, 'collect');
  assert.equal(continueMining.code, 'material_prerequisite_planned');

  const carriedOutOfSequence = nextBuilderStep(
    { ...order, phase: 'acquire' },
    {
      inventory: { oak_planks: 1 },
      freeSlots: 0,
      blueprintAudit: {
        valid: true,
        incorrect: [],
        missing: [
          { x: 10, y: 64, z: -4, material: 'stone_bricks', stage: 1, supported: true, index: 0 },
          { x: 11, y: 64, z: -4, material: 'oak_planks', stage: 1, supported: true, index: 1 },
        ],
      },
    },
  );
  assert.equal(carriedOutOfSequence.phase, 'execute');
  assert.equal(carriedOutOfSequence.code, 'carried_material_ready');
});

test('structure design parser normalizes unambiguous model notation without shifting extra values', () => {
  const operations = parseStructureDesign(
    'room 0 0 0 5 4 5 [oak_planks]; put 1 1 1 crafting_table',
  );
  assert.equal(operations[0].material, 'oak_planks');
  assert.equal(operations[1].thing, 'crafting');
  assert.throws(
    () => parseStructureDesign('slab 0 0 0 5 7 5 oak_planks'),
    /accepts at most 6 values but got 7/,
  );
});

test('generic fixture defaults bind once to the locally feasible registry family member', () => {
  const items = {
    1: { id: 1, name: 'oak_door' },
    2: { id: 2, name: 'birch_door' },
    3: { id: 3, name: 'oak_planks' },
    4: { id: 4, name: 'birch_planks' },
    5: { id: 5, name: 'oak_log' },
    6: { id: 6, name: 'birch_log' },
    7: { id: 7, name: 'white_bed' },
    8: { id: 8, name: 'brown_bed' },
    9: { id: 9, name: 'white_wool' },
    10: { id: 10, name: 'brown_wool' },
  };
  const blocks = {
    11: { id: 11, name: 'oak_door' },
    12: { id: 12, name: 'birch_door' },
    15: { id: 15, name: 'oak_log' },
    16: { id: 16, name: 'birch_log' },
    17: { id: 17, name: 'white_bed' },
    18: { id: 18, name: 'brown_bed' },
  };
  let carriedItems = [];
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0, distanceTo: position => Math.hypot(position.x, position.y - 64, position.z) } },
    inventory: { items: () => carriedItems },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks,
      blocksByName: Object.fromEntries(Object.values(blocks).map(block => [block.name, block])),
      recipes: {
        1: [{ inShape: [[3, 3], [3, 3], [3, 3]], result: { id: 1, count: 3 } }],
        2: [{ inShape: [[4, 4], [4, 4], [4, 4]], result: { id: 2, count: 3 } }],
        7: [{ inShape: [[9, 9, 9], [4, 4, 4]], result: { id: 7, count: 1 } }],
        8: [{ inShape: [[10, 10, 10], [4, 4, 4]], result: { id: 8, count: 1 } }],
      },
    },
    findBlock({ matching }) {
      return matching === 16 ? { position: { x: 4, y: 64, z: 0 } } : null;
    },
    blockAt() { return { name: 'air' }; },
  };
  const order = createWorkOrder({
    id: 'builder-family-binding',
    role: 'builder',
    kind: 'build',
    source: 'player',
    target: { name: 'construction_site', x: 10, y: 64, z: 10 },
    quota: 1,
    blueprint: {
      id: 'family_binding',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{ x: 0, y: 0, z: 0, material: 'oak_door', stage: 0, function: 'access' }],
    },
  });
  const planItem = (_bot, { target }) => ({
    status: 'ready',
    actions: [{
      kind: 'collect',
      capability: {
        arguments: { source: target === 'birch_door' ? 'birch_log' : 'oak_log' },
        cost: 8,
      },
    }],
  });

  const bound = bindStructureAccessoryMaterials(order, bot, { planItem });
  assert.equal(bound.blueprint.cells[0].material, 'birch_door');
  assert.equal(bound.blueprint.cells[0].materialFamily, 'wooden_door');
  assert.equal(bound.id, order.id);

  const discoveredAlternative = bindStructureAccessoryMaterials(createWorkOrder({
    ...order,
    blueprint: {
      id: 'family_rebinding',
      width: 2,
      depth: 1,
      height: 1,
      cells: [
        { x: 0, y: 0, z: 0, material: 'birch_door', materialFamily: 'wooden_door', stage: 0, function: 'access' },
        { x: 1, y: 0, z: 0, material: 'white_bed', materialFamily: 'bed', stage: 0, function: 'rest' },
      ],
    },
    quota: 2,
  }), bot, { planItem, alternativeOutput: 'brown_wool' });
  assert.equal(discoveredAlternative.blueprint.cells[0].material, 'birch_door');
  assert.equal(discoveredAlternative.blueprint.cells[0].materialFamily, 'wooden_door');
  assert.equal(discoveredAlternative.blueprint.cells[1].material, 'brown_bed');
  assert.equal(discoveredAlternative.blueprint.cells[1].materialFamily, 'bed');
  assert.equal(
    bindStructureAccessoryMaterials(discoveredAlternative, bot, { planItem, alternativeOutput: 'brown_wool' }),
    discoveredAlternative,
  );

  const whiteProgressOrder = createWorkOrder({
    ...order,
    blueprint: {
      id: 'progress_preserving_rebinding',
      width: 1,
      depth: 1,
      height: 1,
      cells: [{
        x: 0,
        y: 0,
        z: 0,
        material: 'white_bed',
        materialFamily: 'bed',
        stage: 0,
        function: 'rest',
      }],
    },
  });
  carriedItems = [{ name: 'white_wool', count: 2 }];
  assert.equal(
    bindStructureAccessoryMaterials(whiteProgressOrder, bot, { planItem, alternativeOutput: 'brown_wool' }),
    whiteProgressOrder,
  );
  carriedItems = [{ name: 'white_wool', count: 2 }, { name: 'brown_wool', count: 3 }];
  assert.equal(
    bindStructureAccessoryMaterials(whiteProgressOrder, bot, { planItem, alternativeOutput: 'brown_wool' })
      .blueprint.cells[0].material,
    'brown_bed',
  );
});

test('an unlocked designed structure binds one feasible material for its full structural quantity', () => {
  const items = {
    1: { id: 1, name: 'oak_planks' },
    2: { id: 2, name: 'dirt' },
    3: { id: 3, name: 'cobblestone' },
  };
  const blocks = {
    11: { id: 11, name: 'oak_planks' },
    12: { id: 12, name: 'dirt' },
    13: { id: 13, name: 'cobblestone' },
  };
  const bot = {
    inventory: { items: () => [{ name: 'dirt', type: 2, count: 12 }] },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks,
      blocksByName: Object.fromEntries(Object.values(blocks).map(block => [block.name, block])),
    },
    blockAt() { return { name: 'air' }; },
  };
  const order = createWorkOrder({
    id: 'builder-structural-binding',
    role: 'builder',
    kind: 'build',
    source: 'player',
    target: { name: 'construction_site', x: 20, y: 64, z: 20 },
    quota: 3,
    blueprint: {
      id: 'structural_binding',
      width: 3,
      depth: 1,
      height: 1,
      cells: [0, 1, 2].map(x => ({
        x, y: 0, z: 0, material: 'oak_planks', stage: 0, function: 'foundation',
      })),
    },
  });
  const planItem = (_bot, { target, quantity, allowUnobservedSelfDropRoot }) => ({
    status: target === 'dirt' ? 'complete' : 'ready',
    actions: target === 'dirt' ? [] : [{
      kind: 'collect',
      capability: { arguments: { source: target }, cost: quantity * 4 },
    }],
    allowUnobservedSelfDropRoot,
  });

  const bound = bindStructureAccessoryMaterials(order, bot, {
    planItem,
    structuralMaterialAlternatives: true,
  });

  assert.deepEqual(new Set(bound.blueprint.cells.map(cell => cell.material)), new Set(['dirt']));
  assert.ok(bound.blueprint.cells.every(cell => cell.materialFamily === 'survival_building_block'));
  assert.equal(
    bindStructureAccessoryMaterials(order, bot, { planItem, structuralMaterialAlternatives: false }),
    order,
  );
});

test('general construction compiler rejects unknown, excessive, and unsafe room geometry', () => {
  assert.throws(() => createConstructionBlueprint({
    shape: 'castle',
    width: 4,
    depth: 4,
    height: 4,
    material: 'stone',
  }), /shape/i);
  assert.throws(() => createConstructionBlueprint({
    shape: 'platform',
    width: 17,
    depth: 2,
    height: 1,
    material: 'stone',
  }), /width/i);
  assert.throws(() => createConstructionBlueprint({
    shape: 'wall',
    width: 4,
    depth: 1,
    height: 5,
    material: 'stone',
  }), /height must be an integer from 1 to 4/i);
  assert.throws(() => createConstructionBlueprint({
    shape: 'room',
    width: 2,
    depth: 3,
    height: 3,
    material: 'stone',
  }), /3x3x3/i);
});

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

  const naturalObstructionAudit = {
    valid: true,
    missing: [],
    incorrect: [{
      x: 2,
      y: 64,
      z: 1,
      expected: 'stone',
      observed: 'dirt',
      clearable: true,
    }],
  };
  const naturalObstruction = nextBuilderStep({ ...order, phase: 'execute' }, {
    blueprintAudit: naturalObstructionAudit,
  });
  assert.equal(naturalObstruction.command, '!breakBlock(2, 64, 1)');
  assert.equal(naturalObstruction.nextPhase, 'execute');
  assert.equal(naturalObstruction.code, 'worksite_clearing');

  let toolPlannerRequest = null;
  const toolRecovery = nextBuilderStep({
    ...order,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: {
      toolRequirement: { name: 'wooden_pickaxe', minimumUsableDurability: 1 },
      accessRequirement: { kind: 'surface' },
    },
  }, {
    inventory: {},
    blueprintAudit: naturalObstructionAudit,
  }, null, {
    planItem: request => {
      toolPlannerRequest = request;
      return {
        status: 'ready',
        nextStep: {
          capability: { id: 'craft', arguments: { output: 'wooden_pickaxe', count: 1 } },
          learningKey: 'craft:wooden_pickaxe',
          reason: 'Replace the missing worksite-clearing tool.',
        },
      };
    },
  });
  assert.deepEqual(toolPlannerRequest.toolRequirement, {
    name: 'wooden_pickaxe',
    minimumUsableDurability: 1,
  });
  assert.deepEqual(toolPlannerRequest.accessRequirement, { kind: 'surface' });
  assert.equal(toolRecovery.capability.id, 'craft');
  assert.equal(toolRecovery.nextPhase, 'recover');
  assert.equal(toolRecovery.command, undefined, 'Builder must not retry the obstruction before its tool prerequisite');

  const structuralObstruction = nextBuilderStep({ ...order, phase: 'execute' }, {
    blueprintAudit: {
      valid: true,
      missing: [],
      incorrect: [{
        x: 2,
        y: 64,
        z: 1,
        expected: 'stone',
        observed: 'oak_planks',
        clearable: false,
      }],
    },
  });
  assert.equal(structuralObstruction.terminal, true);
  assert.equal(structuralObstruction.code, 'blueprint_incorrect_block');
  assert.match(structuralObstruction.detail, /not safe natural terrain/i);

  const mixedSite = nextBuilderStep({ ...order, phase: 'execute' }, {
    blueprintAudit: {
      valid: true,
      missing: [],
      incorrect: [
        {
          x: 1,
          y: 64,
          z: 1,
          expected: 'stone',
          observed: 'sand',
          clearable: true,
        },
        {
          x: 2,
          y: 64,
          z: 1,
          expected: 'stone',
          observed: 'copper_torch',
          clearable: false,
        },
      ],
    },
  });
  assert.equal(mixedSite.terminal, true);
  assert.equal(mixedSite.code, 'blueprint_incorrect_block');
  assert.match(mixedSite.detail, /copper_torch at 2, 64, 1/i);
});

test('Given a far unloaded authorized blueprint, Builder approaches once before auditing it', () => {
  const order = createWorkOrder({
    id: 'remote-repair',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    target: { name: 'remembered_home', x: -523, y: 63, z: -475 },
    blueprint: {
      id: 'remembered_home',
      width: 5,
      depth: 5,
      height: 4,
      cells: [{ x: 0, y: 0, z: 0, material: 'cobblestone' }],
    },
  });
  const unloaded = { blueprintAudit: { valid: false, code: 'unloaded', missing: [], incorrect: [] } };

  const far = nextBuilderStep(order, { ...unloaded, x: -836, y: 63, z: -515 });
  assert.equal(far.command, '!goToCoordinates(-520.5, 63, -472.5, 6)');
  assert.equal(far.nextPhase, 'assess');
  assert.equal(far.code, 'worksite_approach_required');
  assert.equal(far.keepAnchor, true);

  const stillUnloadedNearby = nextBuilderStep(order, { ...unloaded, x: -520.5, y: 63, z: -479 });
  assert.equal(stillUnloadedNearby.terminal, true);
  assert.equal(stillUnloadedNearby.code, 'unsafe_blueprint_unloaded');
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
  assert.deepEqual(complete.checkpoint, { verifiedCount: 2, nextCell: 2 });
});

test('Given a missing logical fixture, Builder dispatches one fixture placement instead of one block placement', () => {
  const order = createWorkOrder({
    id: 'build-door',
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester: 'Director',
    phase: 'execute',
    target: { name: 'worksite', x: 10, y: 64, z: 10 },
    blueprint: {
      id: 'doorway',
      width: 1,
      depth: 1,
      height: 3,
      cells: [
        { x: 0, y: 0, z: 0, material: 'cobblestone', stage: 0 },
        {
          x: 0,
          y: 1,
          z: 0,
          material: 'oak_door',
          stage: 1,
          function: 'access',
          fixtureId: 'door_1',
          facing: 'east',
        },
      ],
      fixtures: [{
        id: 'door_1',
        kind: 'door',
        material: 'oak_door',
        function: 'access',
        facing: 'east',
        anchor: { x: 0, y: 1, z: 0 },
        occupiedOffsets: [
          { x: 0, y: 0, z: 0, part: 'lower' },
          { x: 0, y: 1, z: 0, part: 'upper' },
        ],
        supportOffsets: [{ x: 0, y: -1, z: 0 }],
      }],
    },
  });
  const step = nextBuilderStep(order, {
    inventory: { oak_door: 1 },
    blueprintAudit: {
      valid: true,
      missing: [{
        x: 10,
        y: 65,
        z: 10,
        material: 'oak_door',
        stage: 1,
        index: 1,
        supported: true,
        fixture: { kind: 'door', facing: 'east' },
      }],
      incorrect: [],
      correct: 1,
    },
  });

  assert.equal(step.command, '!placeFixtureAt("oak_door", 10, 65, 10, "door", "east")');
  assert.equal(step.nextPhase, 'verify');
});

test('A verified emergency shelter completes only after the bot occupies its protected interior', () => {
  const order = createWorkOrder({
    id: 'survival-shelter',
    role: 'builder',
    kind: 'emergency_shelter',
    source: 'survival',
    requester: 'MindcraftBot',
    target: { name: 'worksite', x: 10, y: 64, z: 10 },
    blueprint: {
      id: 'shelter',
      width: 3,
      depth: 3,
      height: 3,
      cells: [{ x: 0, y: 2, z: 0, material: 'cobblestone' }],
    },
  });
  const audit = { valid: true, missing: [], incorrect: [], correct: 23 };

  const enter = nextBuilderStep({ ...order, phase: 'verify' }, {
    x: 10.5,
    y: 64,
    z: 7.5,
    inventory: {},
    blueprintAudit: audit,
  });
  assert.equal(enter.command, '!goToCoordinates(10.5, 64, 10.5, 0.5)');
  assert.equal(enter.nextPhase, 'deliver');
  assert.equal(enter.code, 'shelter_occupancy_required');
  assert.deepEqual(enter.checkpoint, { verifiedCount: 23, nextCell: 23 });

  const complete = nextBuilderStep({ ...order, phase: 'deliver' }, {
    x: 10.5,
    y: 64,
    z: 10.5,
    inventory: {},
    blueprintAudit: audit,
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.code, 'blueprint_complete');
});
