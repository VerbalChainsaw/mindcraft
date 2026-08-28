import assert from 'node:assert/strict';
import test from 'node:test';

import minecraftData from 'minecraft-data';
import Vec3 from 'vec3';

import {
  executeCapabilityAction,
  getCapabilityDefinition,
} from '../../src/agent/runtime/capability-catalogue.js';
import { nextExplorerStep } from '../../src/agent/runtime/jobs/explorer-plan.js';
import {
  advanceWorkOrder,
  createWorkOrder,
  normalizeWorkOrder,
} from '../../src/agent/runtime/work-order.js';

function explorerOrder({ evidence, checkpoint = {} }) {
  const order = createWorkOrder({
    id: 'explorer-route-truth',
    role: 'miner',
    kind: 'explore',
    source: 'player',
    requester: 'Director',
    target: { name: 'ores', x: 10, y: 70, z: 20 },
    quota: 2,
    checkpoint: {
      homeDimension: 'overworld',
      containerName: 'chest',
      containerDimension: 'overworld',
      containerX: 11,
      containerY: 70,
      containerZ: 20,
      ...checkpoint,
    },
  });
  const baseline = nextExplorerStep(order, {
    inventory: { raw_iron: 2 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  });
  const prepared = normalizeWorkOrder({
    ...order,
    phase: baseline.phase,
    checkpoint: baseline.checkpoint,
  });
  return normalizeWorkOrder({
    ...prepared,
    phase: 'recover',
    resumePhase: 'execute',
    checkpoint: {
      ...prepared.checkpoint,
      ...checkpoint,
    },
    evidence,
  });
}

test('search-region relocation stays incomplete until the bound region is reached', () => {
  const definition = getCapabilityDefinition('relocate_search_region');
  const args = definition.normalizeArguments({
    x: 166,
    y: 79,
    z: -332,
    closeness: 8,
    minimumDisplacement: 16,
    dimension: 'overworld',
  });
  const binding = definition.bind({}, args);
  const verification = definition.verify(
    { position: { x: 807, y: 63, z: -487 }, dimension: 'overworld' },
    { position: { x: 782, y: 63, z: -480 }, dimension: 'overworld' },
    binding,
  );

  assert.equal(verification.changedRegion, true);
  assert.equal(verification.reachedTarget, false);
  assert.equal(verification.ok, false);
});

test('cave binding preserves an unfinished round-trip route as inconclusive', async () => {
  const home = new Vec3(0, 70, 0);
  const cave = new Vec3(20, 60, 0);
  const bot = {
    entity: { position: home.clone(), isInLava: false },
    registry: minecraftData('1.21.11'),
    traversalPolicy: 'preserve',
    inventory: { items: () => [] },
    findBlocks() { return [cave.clone()]; },
    blockAt(position) {
      if (position.y === cave.y - 1) {
        return { name: 'stone', boundingBox: 'block', position: position.clone() };
      }
      return {
        name: 'air',
        boundingBox: 'empty',
        skyLight: 0,
        position: position.clone(),
      };
    },
    pathfinder: {
      tickTimeout: 40,
      getPathTo() { return { status: 'timeout', path: [] }; },
    },
  };
  const definition = getCapabilityDefinition('survey_nearby_cave');
  const args = definition.normalizeArguments({
    home,
    range: 64,
    excludedTargets: [],
    light: false,
  });

  const result = definition.bind({
    bot,
    snapshot: { position: home, dimension: 'overworld' },
  }, args);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'source_not_found');
  assert.equal(result.inconclusive, true);
  assert.match(result.detail, /did not finish|ran out of search time/i);
  assert.doesNotMatch(result.detail, /had no .* route/i);

  const execution = await executeCapabilityAction({
    id: 'survey_nearby_cave',
    arguments: args,
  }, {
    agent: { bot },
  });
  assert.equal(execution.result.inconclusive, true);
  assert.equal(
    execution.result.evidence.capability.bindingReport.inconclusive,
    true,
  );
});

test('cave binding considers a valid route beyond the first 128 observations', () => {
  const home = new Vec3(0, 70, 0);
  const candidates = [];
  for (let x = 12; x < 28; x += 1) {
    for (let z = 0; z < 8; z += 1) candidates.push(new Vec3(x, 64, z));
  }
  const reachable = new Vec3(120, 64, 0);
  candidates.push(reachable);
  const bot = {
    entity: { position: home.clone(), isInLava: false },
    registry: minecraftData('1.21.11'),
    traversalPolicy: 'preserve',
    inventory: { items: () => [] },
    modes: { isOn: () => false },
    findBlocks() { return candidates.map(position => position.clone()); },
    blockAt(position) {
      return position.y === 63
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : {
            name: 'air',
            boundingBox: 'empty',
            skyLight: 0,
            position: position.clone(),
          };
    },
    pathfinder: {
      tickTimeout: 40,
      getPathFromTo(_movements, _start, goal) {
        const inbound = Array.isArray(goal?.goals);
        const includesReachable = inbound && goal.goals.some(candidate => (
          candidate.x === reachable.x
          && candidate.y === reachable.y
          && candidate.z === reachable.z
        ));
        const status = inbound && !includesReachable ? 'noPath' : 'success';
        const terminal = inbound ? reachable : home;
        return (function * routeProbe() {
          yield {
            result: {
              status,
              path: status === 'success' ? [terminal.clone()] : [],
            },
          };
        }());
      },
    },
  };
  const definition = getCapabilityDefinition('survey_nearby_cave');
  const args = definition.normalizeArguments({
    home,
    range: 128,
    excludedTargets: [],
    light: false,
  });

  const result = definition.bind({
    bot,
    snapshot: { position: home, dimension: 'overworld' },
  }, args);

  assert.equal(result.ok, true);
  assert.deepEqual(result.target, {
    name: 'cave_region',
    x: reachable.x,
    y: reachable.y,
    z: reachable.z,
  });
});

test('Explorer retries an inconclusive cave survey without relocating the search', () => {
  const order = advanceWorkOrder(explorerOrder({}), {
    actionId: 'cave-route-timeout',
    phase: 'failed',
    retryable: true,
    code: 'source_not_found',
    inconclusive: true,
    detail: 'The cave route search did not finish.',
  });
  assert.equal(order.evidence.inconclusive, true);
  const step = nextExplorerStep(order, {
    inventory: { raw_iron: 2, torch: 8 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  }, null, {
    planItem: () => ({ status: 'complete' }),
  });

  assert.equal(step.capability.id, 'survey_nearby_cave');
  assert.notEqual(step.capability.id, 'relocate_search_region');
});

test('work orders preserve route uncertainty carried by the executed skill receipt', () => {
  const order = advanceWorkOrder(explorerOrder({}), {
    actionId: 'mining-route-timeout',
    phase: 'failed',
    retryable: true,
    code: 'capability_effects_unverified',
    detail: 'Minecraft did not confirm mining-depth progress.',
    evidence: {
      skill: {
        kind: 'mining_relocation',
        outcome: 'open_cave_route_unproven',
        inconclusive: true,
      },
    },
  });

  assert.equal(order.evidence.inconclusive, true);
});

test('Explorer retries inconclusive exposed-ore routing without exhausting the cave', () => {
  const order = advanceWorkOrder(explorerOrder({
    checkpoint: { caveLit: true, caveLightingComplete: true },
  }), {
    actionId: 'ore-route-timeout',
    phase: 'failed',
    retryable: true,
    code: 'resource_not_found',
    inconclusive: true,
    detail: 'The exposed-ore route search did not finish.',
  });
  assert.equal(order.evidence.inconclusive, true);
  const step = nextExplorerStep(order, {
    inventory: { raw_iron: 3, torch: 8 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  });

  assert.equal(step.capability?.id, 'collect_exposed_ore');
  assert.notEqual(step.code, 'cave_region_exhausted');
});

test('Explorer keeps existing relocation and exhaustion behavior after conclusive absence', () => {
  const relocate = nextExplorerStep(explorerOrder({
    evidence: { code: 'source_not_found', detail: 'No cave was observed.' },
  }), {
    inventory: { raw_iron: 2, torch: 8 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  });
  assert.equal(relocate.capability.id, 'relocate_search_region');

  const exhausted = nextExplorerStep(explorerOrder({
    checkpoint: { caveLit: true, caveLightingComplete: true },
    evidence: { code: 'resource_not_found', detail: 'No exposed ore was observed.' },
  }), {
    inventory: { raw_iron: 3, torch: 8 },
    dimension: 'overworld',
    x: 10,
    y: 70,
    z: 20,
  });
  assert.equal(exhausted.code, 'cave_region_exhausted');
  assert.equal(exhausted.checkpoint.caveLit, false);
});
