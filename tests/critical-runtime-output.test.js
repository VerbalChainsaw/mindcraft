import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import test from 'node:test';
import minecraftData from 'minecraft-data';
import Vec3 from 'vec3';

import {
  actionResultFromError,
  actionResultToMessage,
  actionResultToTelemetry,
  createActionResult,
} from '../src/agent/runtime/action-result.js';
import {
  isFallingGameplayBlock,
  isHazardousGameplayBlock,
  isLiquidGameplayBlock,
  isProtectedGameplayBlock,
  isReplaceableGameplayBlock,
  isSafeCaveStance,
  isSafeGameplaySupport,
} from '../src/agent/runtime/gameplay-safety.js';
import {
  matchesExpectedActionResult,
  parsePlayerList,
  parsePlayerListAfterLatestCommand,
  validatePreflightPayloads,
} from '../tools/verify-behavior-runtime.mjs';
import {
  createFixtureAdmissionReceipt,
  FixtureAdmissionError,
  fixtureCheckStatus,
  reconcileAdvisorySetupAcknowledgement,
  requireFixtureAdmission,
} from '../tools/validation/fixture-admission.mjs';
import { OwnedLocalServices } from '../src/mindcraft/owned-local-services.js';
import { terminateOwnedProcessTree } from '../src/mindcraft/process-tree.js';
import { stopMindcraftRuntime } from '../src/mindcraft/stack-shutdown.js';
import {
  attemptLocalNavigationEscape,
  goToGoal,
  goToPlayer,
  localNavigationEscapeStances,
  probeSafeNavigationGoal,
  probeSafeNavigationStances,
  probeSafeRoundTripNavigationStances,
  ResponsiveFollowGoal,
} from '../src/agent/library/skills.js';

test('a stalled native navigation promise cannot retain action ownership after its goal is stopped', async () => {
  let stoppedGoals = 0;
  let clearedControls = 0;
  const bot = new EventEmitter();
  Object.assign(bot, {
    output: '',
    interrupt_code: false,
    registry: minecraftData('1.21.11'),
    entity: {
      position: new Vec3(0.5, 66, 0.5),
      isInLava: false,
      isInWater: false,
      onGround: true,
      width: 0.6,
      height: 1.8,
    },
    blockAt(position) {
      return position.y <= 65
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    clearControlStates() {
      clearedControls += 1;
    },
  });
  bot.pathfinder = {
    setMovements() {},
    setGoal(goal) {
      if (goal === null) stoppedGoals += 1;
    },
    getLastStuckState: () => null,
    goto() {
      return new Promise(() => {});
    },
  };
  const goal = {
    x: 10,
    y: 66,
    z: 0,
    isEnd: () => false,
    heuristic: node => Math.abs(10 - node.x),
  };

  const startedAt = Date.now();
  const reached = await goToGoal(bot, goal, { movements: {} });

  assert.equal(reached, false);
  assert.equal(
    bot.lastActionEvidence.outcome,
    'path_stalled',
    JSON.stringify(bot.lastActionEvidence),
  );
  assert.ok(stoppedGoals >= 1);
  assert.ok(clearedControls >= 1);
  assert.ok(Date.now() - startedAt < 6_000, 'stopped navigation must return within its bounded settlement window');
});

test('critical action results preserve phase, sanitize output, and expose bounded telemetry', () => {
  const result = createActionResult({
    actionId: 'action-1',
    label: ' break protected block ',
    phase: 'blocked',
    code: 'protected_block',
    detail: 'Refused\u0000 protected chest',
    target: { name: 'chest', x: 4, y: 70, z: -2, ignored: 'secret' },
    retryable: false,
    startedAt: 10,
    finishedAt: 20,
  });

  assert.deepEqual(result, {
    actionId: 'action-1',
    label: 'break protected block',
    phase: 'blocked',
    code: 'protected_block',
    detail: 'Refused protected chest',
    target: { name: 'chest', x: 4, y: 70, z: -2 },
    evidence: null,
    retryable: false,
    startedAt: 10,
    finishedAt: 20,
  });
  assert.equal(actionResultToMessage(result), 'Blocked (protected_block): Refused protected chest');
  assert.deepEqual(actionResultToTelemetry(result), {
    actionId: 'action-1',
    phase: 'blocked',
    code: 'protected_block',
    label: 'break protected block',
    detail: 'Refused protected chest',
    target: { name: 'chest', x: 4, y: 70, z: -2 },
    retryable: false,
    durationMs: 10,
    startedAt: 10,
    finishedAt: 20,
  });

  const interrupted = actionResultFromError(new Error('path stopped by player'), {
    actionId: 'action-2',
    label: 'follow',
  });
  assert.equal(interrupted.phase, 'interrupted');
  assert.equal(interrupted.code, 'interrupted');
  assert.equal(interrupted.retryable, true);
});

test('critical gameplay safety classifies protected, replaceable, falling, hazardous, and supported blocks', () => {
  assert.equal(isProtectedGameplayBlock('chest'), true);
  assert.equal(isProtectedGameplayBlock('blue_shulker_box'), true);
  assert.equal(isProtectedGameplayBlock('stone'), false);
  assert.equal(isReplaceableGameplayBlock('tall_grass'), true);
  assert.equal(isReplaceableGameplayBlock('stone'), false);
  assert.equal(isFallingGameplayBlock('red_concrete_powder'), true);
  assert.equal(isFallingGameplayBlock('sandstone'), false);
  assert.equal(isHazardousGameplayBlock('soul_fire'), true);
  assert.equal(isLiquidGameplayBlock('kelp_plant'), true);
  assert.equal(isLiquidGameplayBlock({
    name: 'oak_stairs',
    getProperties: () => ({ waterlogged: true }),
  }), true);
  assert.equal(isLiquidGameplayBlock('short_grass'), false);
  assert.equal(isSafeGameplaySupport({ name: 'stone', boundingBox: 'block' }), true);
  assert.equal(isSafeGameplaySupport({ name: 'magma_block', boundingBox: 'block' }), false);
});

test('a cave stance is dark supported air regardless of Minecraft air subtype', () => {
  const position = new Vec3(0, 10, 0);
  const blocks = new Map();
  const put = (x, y, z, block) => blocks.set(`${x},${y},${z}`, block);
  put(0, 10, 0, { name: 'air', boundingBox: 'empty', skyLight: 0 });
  put(0, 11, 0, { name: 'air', boundingBox: 'empty', skyLight: 0 });
  put(0, 9, 0, { name: 'stone', boundingBox: 'block' });
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    put(x, 10, z, { name: 'stone', boundingBox: 'block' });
  }
  const bot = { blockAt: value => blocks.get(`${value.x},${value.y},${value.z}`) || null };
  assert.equal(isSafeCaveStance(bot, position), true);
  put(0, 10, 0, { name: 'cave_air', boundingBox: 'empty', skyLight: 0 });
  assert.equal(isSafeCaveStance(bot, position), true);
  put(0, 10, 0, { name: 'air', boundingBox: 'empty', skyLight: 4 });
  assert.equal(isSafeCaveStance(bot, position), false);
  put(0, 10, 0, { name: 'air', boundingBox: 'empty', skyLight: 15 });
  assert.equal(isSafeCaveStance(bot, position), false);
});

test('a cave stance is bindable only when native Pathfinder proves the return route', () => {
  const registry = minecraftData('1.21.11');
  const cave = new Vec3(10, 60, 0);
  const home = new Vec3(0, 70, 0);
  const routeStarts = [];
  const bot = {
    registry,
    traversalPolicy: 'preserve',
    entity: { position: home.clone(), isInLava: false },
    inventory: { items: () => [] },
    pathfinder: {
      thinkTimeout: 500,
      tickTimeout: 40,
      getPathTo() {
        return { status: 'success', path: [cave.clone()] };
      },
      getPathFromTo(_movements, start) {
        routeStarts.push(start.clone());
        const inbound = start.x === home.x && start.y === home.y && start.z === home.z;
        return (function * routeByDirection() {
          yield { result: inbound
            ? { status: 'success', path: [cave.clone()] }
            : { status: 'noPath', path: [] } };
        }());
      },
    },
  };

  const rejected = probeSafeRoundTripNavigationStances(bot, [cave], home, 500);
  assert.equal(rejected.reachable, false);
  assert.equal(rejected.status, 'return_route_unreachable');
  assert.deepEqual(routeStarts.map(position => position.toArray()), [
    home.toArray(),
    cave.toArray(),
  ]);

  bot.pathfinder.getPathFromTo = function * returnRoute(_movements, start) {
    routeStarts.push(start.clone());
    const inbound = start.x === home.x && start.y === home.y && start.z === home.z;
    yield { result: {
      status: 'success',
      path: [inbound ? cave.clone() : home.clone()],
    } };
  };
  const accepted = probeSafeRoundTripNavigationStances(bot, [cave], home, 500);
  assert.equal(accepted.reachable, true);
  assert.deepEqual(accepted.terminalPosition, { x: cave.x, y: cave.y, z: cave.z });
  assert.equal(accepted.returnStatus, 'success');
  assert.deepEqual(routeStarts.map(position => position.toArray()), [
    home.toArray(),
    cave.toArray(),
    home.toArray(),
    cave.toArray(),
  ]);
});

test('round-trip route probing keeps checking supplied candidates while time remains', () => {
  const home = new Vec3(0, 70, 0);
  const candidates = Array.from(
    { length: 129 },
    (_, index) => new Vec3(index + 1, 60, 0),
  );
  let inboundCalls = 0;
  const bot = {
    entity: { position: home.clone() },
    pathfinder: {
      tickTimeout: 40,
      getPathFromTo(_movements, start) {
        return (function* routeByDirection() {
          const inbound = start.equals(home);
          if (inbound) {
            const target = candidates[inboundCalls];
            inboundCalls += 1;
            yield { result: { status: 'success', path: [target.clone()] } };
            return;
          }
          const returnable = start.equals(candidates.at(-1));
          yield { result: returnable
            ? { status: 'success', path: [home.clone()] }
            : { status: 'noPath', path: [] } };
        }());
      },
    },
  };

  const route = probeSafeRoundTripNavigationStances(
    bot,
    candidates,
    home,
    5_000,
    {},
  );

  assert.equal(route.reachable, true);
  assert.deepEqual(route.terminalPosition, {
    x: candidates.at(-1).x,
    y: candidates.at(-1).y,
    z: candidates.at(-1).z,
  });
  assert.equal(route.returnStatus, 'success');
  assert.equal(route.roundTripCandidatesChecked, candidates.length);
  assert.equal(inboundCalls, candidates.length);
});

test('round-trip route probing preserves an unfinished return search as inconclusive', () => {
  const home = new Vec3(0, 70, 0);
  const candidates = [new Vec3(1, 60, 0), new Vec3(2, 60, 0)];
  let inboundCalls = 0;
  const bot = {
    entity: { position: home.clone() },
    pathfinder: {
      tickTimeout: 40,
      getPathFromTo(_movements, start) {
        return (function* routeByDirection() {
          if (start.equals(home)) {
            const target = candidates[inboundCalls];
            inboundCalls += 1;
            yield { result: { status: 'success', path: [target.clone()] } };
            return;
          }
          yield { result: start.equals(candidates[0])
            ? { status: 'timeout', path: [] }
            : { status: 'noPath', path: [] } };
        }());
      },
    },
  };

  const route = probeSafeRoundTripNavigationStances(bot, candidates, home, 5_000, {});

  assert.equal(route.reachable, false);
  assert.equal(route.conclusive, false);
  assert.equal(route.status, 'return_route_unproven');
  assert.equal(route.roundTripCandidatesChecked, candidates.length);
});

test('round-trip route probing treats completed inbound noPath as conclusive', () => {
  const home = new Vec3(0, 70, 0);
  const bot = {
    entity: { position: home.clone() },
    pathfinder: {
      tickTimeout: 40,
      getPathFromTo() {
        return (function* noRoute() {
          yield { result: { status: 'noPath', path: [] } };
        }());
      },
    },
  };

  const route = probeSafeRoundTripNavigationStances(
    bot,
    [new Vec3(1, 60, 0)],
    home,
    5_000,
    {},
  );

  assert.equal(route.reachable, false);
  assert.equal(route.conclusive, true);
  assert.equal(route.status, 'noPath');
  assert.equal(route.roundTripCandidatesChecked, 0);
});

test('local navigation recovery offers supported nearby stances without inventing a descent', () => {
  const origin = new Vec3(0, 64, 0);
  const bot = {
    entity: { position: origin.clone() },
    blockAt(position) {
      if (position.y === 63) {
        return { name: 'stone', boundingBox: 'block', position: position.clone() };
      }
      return { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
  };

  const stances = localNavigationEscapeStances(bot, origin);
  assert.ok(stances.length > 0);
  assert.ok(stances.every(stance => stance.y === origin.y));
  assert.ok(stances.every(stance => Math.hypot(stance.x, stance.z) >= 1));
  assert.ok(stances.every(stance => Math.hypot(stance.x, stance.z) <= 4));
});

test('local navigation recovery does not execute a stance with no native return route', async () => {
  const registry = minecraftData('1.21.11');
  const origin = new Vec3(0, 64, 0);
  let executions = 0;
  const bot = {
    registry,
    traversalPolicy: 'preserve',
    interrupt_code: false,
    entity: { position: origin.clone(), isInLava: false },
    inventory: { items: () => [] },
    blockAt(position) {
      if (position.y === 63) {
        return { name: 'stone', boundingBox: 'block', position: position.clone() };
      }
      return { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    pathfinder: {
      thinkTimeout: 500,
      tickTimeout: 40,
      getPathTo() {
        return { status: 'success', path: [new Vec3(1, 64, 0)] };
      },
      getPathFromTo(_movements, start, goal) {
        const inbound = start.x === origin.x && start.y === origin.y && start.z === origin.z;
        return (function * routeByDirection() {
          const selected = goal?.goals?.[0];
          yield { result: inbound
            ? {
              status: 'success',
              path: [new Vec3(selected.x, selected.y, selected.z)],
            }
            : { status: 'noPath', path: [] } };
        }());
      },
      goto() {
        executions += 1;
        return Promise.resolve();
      },
    },
  };

  const outcome = await attemptLocalNavigationEscape(bot);
  assert.equal(outcome.success, false);
  assert.equal(outcome.outcome, 'return_route_unreachable');
  assert.equal(executions, 0);
  assert.deepEqual(bot.entity.position, origin);
});

test('planned navigation distinguishes a missing complete route before execution', () => {
  const origin = new Vec3(0, 64, 0);
  const bot = {
    entity: { position: origin.clone() },
    blockAt(position) {
      return position.y === 63
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    pathfinder: {
      getPathTo() {
        return { status: 'noPath', path: [new Vec3(1, 63, 0)] };
      },
    },
  };
  const route = probeSafeNavigationGoal(
    bot,
    { isEnd: () => false, heuristic: () => 1 },
    500,
    {},
  );

  assert.deepEqual(route, {
    reachable: false,
    conclusive: true,
    status: 'noPath',
    pathLength: 1,
  });
  assert.deepEqual(bot.entity.position, origin);
});

test('probe navigation preserves inconclusive status', () => {
  const origin = new Vec3(0, 64, 0);
  const bot = {
    entity: { position: origin.clone() },
    blockAt(position) {
      return position.y === 63
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    pathfinder: {
      getPathTo() {
        return { status: 'timeout', path: [new Vec3(1, 64, 0)] };
      },
    },
  };

  const route = probeSafeNavigationGoal(
    bot,
    { isEnd: () => false, heuristic: () => 1 },
    500,
    {},
  );

  assert.deepEqual(route, {
    reachable: false,
    conclusive: false,
    status: 'timeout',
    pathLength: 1,
  });
  assert.deepEqual(bot.entity.position, origin);
});

test('stance navigation preserves conclusive status from native probe results', () => {
  const origin = new Vec3(0, 64, 0);
  const destination = new Vec3(3, 64, 0);
  const cases = [
    {
      status: 'timeout',
      path: [new Vec3(1, 64, 0)],
      reachable: false,
      conclusive: false,
      terminalPosition: null,
    },
    {
      status: 'noPath',
      path: [],
      reachable: false,
      conclusive: true,
      terminalPosition: null,
    },
    {
      status: 'success',
      path: [destination.clone()],
      reachable: true,
      conclusive: true,
      terminalPosition: { x: destination.x, y: destination.y, z: destination.z },
    },
  ];

  for (const expected of cases) {
    const bot = {
      entity: { position: origin.clone() },
      pathfinder: {
        getPathTo() {
          return { status: expected.status, path: expected.path.map(position => position.clone()) };
        },
      },
    };

    const route = probeSafeNavigationStances(bot, [destination], 500, {});
    assert.deepEqual(route, {
      reachable: expected.reachable,
      conclusive: expected.conclusive,
      status: expected.status,
      pathLength: expected.path.length,
      terminalPosition: expected.terminalPosition,
    }, expected.status);
    assert.deepEqual(bot.entity.position, origin);
  }
});

test('planned navigation continues native Pathfinder partial compute slices to a terminal route', () => {
  const origin = new Vec3(0, 64, 0);
  let slices = 0;
  const bot = {
    entity: { position: origin.clone() },
    blockAt(position) {
      return position.y === 63
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    pathfinder: {
      tickTimeout: 40,
      getPathFromTo() {
        return (function * completeRoute() {
          slices += 1;
          yield { result: { status: 'partial', path: [new Vec3(1, 64, 0)] } };
          slices += 1;
          yield {
            result: {
              status: 'success',
              path: [new Vec3(1, 64, 0), new Vec3(2, 64, 0)],
            },
          };
        }());
      },
    },
  };

  const route = probeSafeNavigationGoal(
    bot,
    { isEnd: () => false, heuristic: () => 1 },
    500,
    {},
  );

  assert.deepEqual(route, {
    reachable: true,
    conclusive: true,
    status: 'success',
    pathLength: 2,
  });
  assert.equal(slices, 2);
  assert.deepEqual(bot.entity.position, origin);
});

test('player navigation rejects the bot itself as a target instead of reporting success', async () => {
  const bot = { username: 'IronSuiteProof', output: '' };
  const reached = await goToPlayer(bot, 'IronSuiteProof', 2);

  assert.equal(reached, false);
  assert.equal(bot.lastActionEvidence.outcome, 'invalid_self_target');
  assert.match(bot.output, /identifies this bot, not the requesting player/);
});

test('player navigation refines a native goal cell that settles outside the physical arrival envelope', async () => {
  const registry = minecraftData('1.21.11');
  const dad = {
    id: 2,
    type: 'player',
    username: 'DadPlayer',
    position: new Vec3(0.5, 69, 0.5),
  };
  const boundaryNode = new Vec3(0, 65, 0);
  const boundaryPosition = new Vec3(0, 65, 0.5);
  const refinedNode = new Vec3(0, 66, 0);
  const refinedPosition = new Vec3(0.5, 66, 0.5);
  let planningProbes = 0;
  let nativeRoutes = 0;
  let goalMatchedSettlementEnvelope = false;
  let refinementMatchedRequestedDistance = false;
  let nativeMovements = null;
  const bot = new EventEmitter();
  Object.assign(bot, {
    username: 'IronSuiteProof',
    output: '',
    registry,
    traversalPolicy: 'full',
    interrupt_code: false,
    players: { DadPlayer: { username: 'DadPlayer', entity: dad } },
    entities: { 2: dad },
    modes: { isOn: () => false },
    inventory: { items: () => [] },
    entity: {
      position: new Vec3(4.5, 66, 0.5),
      isInLava: false,
      isInWater: false,
      onGround: true,
      effects: {},
    },
    blockAt(position) {
      return position.y <= 65
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    clearControlStates() {},
  });
  bot.pathfinder = {
    tickTimeout: 40,
    getPathFromTo() {
      planningProbes += 1;
      return (function * inconclusiveWholeRouteProbe() {
        yield {
          result: {
            status: 'timeout',
            path: [terminalNode.clone()],
          },
        };
      }());
    },
    setMovements(movements) { nativeMovements = movements; },
    setGoal() {},
    getLastStuckState: () => null,
    goto(goal) {
      nativeRoutes += 1;
      if (nativeRoutes === 1) {
        goalMatchedSettlementEnvelope = goal.isEnd(boundaryNode);
        bot.entity.position = boundaryPosition.clone();
      } else {
        refinementMatchedRequestedDistance = goal.isEnd(refinedNode);
        bot.entity.position = refinedPosition.clone();
      }
      return Promise.resolve();
    },
  };

  const reached = await goToPlayer(bot, 'DadPlayer', 3);

  assert.equal(planningProbes, 0, 'ordinary player travel must not require an atomic whole-route preflight');
  assert.equal(nativeRoutes, 2, 'native Pathfinder must refine a physically loose terminal cell');
  assert.equal(goalMatchedSettlementEnvelope, true);
  assert.equal(refinementMatchedRequestedDistance, true);
  assert.equal(nativeMovements.canDig, true);
  assert.equal(nativeMovements.canPlaceBlocks, true);
  assert.equal(nativeMovements.allow1by1towers, true);
  assert.equal(nativeMovements.allowParkour, true);
  assert.equal(reached, true);
  assert.equal(bot.lastActionEvidence.outcome, 'arrived');
  assert.equal(bot.lastActionEvidence.distance, 3);
});

test('player navigation walks the native best reachable path when the exact arrival goal is blocked', async () => {
  const registry = minecraftData('1.21.11');
  const dad = {
    id: 2,
    type: 'player',
    username: 'DadPlayer',
    position: new Vec3(10.5, 66, 0.5),
  };
  const bestNode = new Vec3(5, 66, 0);
  const bestPosition = new Vec3(5.5, 66, 0.5);
  let nativeRoutes = 0;
  let bestEffortMatched = false;
  const bot = new EventEmitter();
  Object.assign(bot, {
    username: 'IronSuiteProof',
    output: '',
    registry,
    traversalPolicy: 'full',
    interrupt_code: false,
    players: { DadPlayer: { username: 'DadPlayer', entity: dad } },
    entities: { 2: dad },
    modes: { isOn: () => false },
    inventory: { items: () => [] },
    entity: {
      position: new Vec3(0.5, 66, 0.5),
      isInLava: false,
      isInWater: false,
      onGround: true,
      effects: {},
    },
    blockAt(position) {
      return position.y <= 65
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    clearControlStates() {},
  });
  bot.pathfinder = {
    tickTimeout: 40,
    getPathFromTo() {
      return (function * completedNoPathProbe() {
        yield { result: { status: 'noPath', path: [] } };
      }());
    },
    setMovements() {},
    setGoal() {},
    getLastStuckState: () => null,
    goto(goal) {
      nativeRoutes += 1;
      if (nativeRoutes === 1) {
        bot.emit('path_update', {
          status: 'noPath',
          cost: 5,
          path: [new Vec3(1, 66, 0), bestNode.clone()],
        });
        const error = new Error('No path to the goal!');
        error.name = 'NoPath';
        return Promise.reject(error);
      }
      bestEffortMatched = goal.isEnd(bestNode);
      bot.entity.position = bestPosition.clone();
      return Promise.resolve();
    },
  };

  const reached = await goToPlayer(bot, 'DadPlayer', 3);

  assert.equal(nativeRoutes, 2, 'the native best endpoint must be executed after exact noPath');
  assert.equal(bestEffortMatched, true);
  assert.equal(reached, false, 'closest reachable progress must not claim exact arrival');
  assert.equal(bot.lastActionEvidence.outcome, 'closest_reachable');
  assert.equal(bot.lastActionEvidence.distance, 5);
  assert.match(bot.output, /closest reachable position/i);
});

test('player navigation reports its current stance when it is already the native best reachable endpoint', async () => {
  const registry = minecraftData('1.21.11');
  const dad = {
    id: 2,
    type: 'player',
    username: 'DadPlayer',
    position: new Vec3(10.5, 66, 0.5),
  };
  const currentNode = new Vec3(0, 66, 0);
  let nativeRoutes = 0;
  const bot = new EventEmitter();
  Object.assign(bot, {
    username: 'IronSuiteProof',
    output: '',
    registry,
    traversalPolicy: 'full',
    interrupt_code: false,
    players: { DadPlayer: { username: 'DadPlayer', entity: dad } },
    entities: { 2: dad },
    modes: { isOn: () => false },
    inventory: { items: () => [] },
    entity: {
      position: new Vec3(0.5, 66, 0.5),
      isInLava: false,
      isInWater: false,
      onGround: true,
      effects: {},
    },
    blockAt(position) {
      return position.y <= 65
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    clearControlStates() {},
  });
  bot.pathfinder = {
    tickTimeout: 40,
    getPathFromTo() {
      return (function * completedNoPathProbe() {
        yield { result: { status: 'noPath', path: [] } };
      }());
    },
    setMovements() {},
    setGoal() {},
    getLastStuckState: () => null,
    goto() {
      nativeRoutes += 1;
      bot.emit('path_update', {
        status: 'noPath',
        cost: 0,
        path: [currentNode.clone()],
      });
      const error = new Error('No path to the goal!');
      error.name = 'NoPath';
      return Promise.reject(error);
    },
  };

  const reached = await goToPlayer(bot, 'DadPlayer', 3);

  assert.equal(nativeRoutes, 1, 'the current best endpoint must not be routed twice');
  assert.equal(reached, false, 'the current closest stance must not claim exact arrival');
  assert.equal(bot.lastActionEvidence.outcome, 'closest_reachable');
  assert.equal(bot.lastActionEvidence.distance, 10);
  assert.match(bot.output, /closest reachable position/i);
});

test('player navigation preserves a physically converged timeout frontier as closest explored', async () => {
  const registry = minecraftData('1.21.11');
  const dad = {
    id: 2,
    type: 'player',
    username: 'DadPlayer',
    position: new Vec3(10.5, 66, 0.5),
  };
  let nativeRoutes = 0;
  const bot = new EventEmitter();
  Object.assign(bot, {
    username: 'IronSuiteProof',
    output: '',
    registry,
    traversalPolicy: 'full',
    interrupt_code: false,
    players: { DadPlayer: { username: 'DadPlayer', entity: dad } },
    entities: { 2: dad },
    modes: { isOn: () => false },
    inventory: { items: () => [] },
    entity: {
      position: new Vec3(0.5, 66, 0.5),
      isInLava: false,
      isInWater: false,
      onGround: true,
      effects: {},
    },
    blockAt(position) {
      return position.y <= 65
        ? { name: 'stone', boundingBox: 'block', position: position.clone() }
        : { name: 'air', boundingBox: 'empty', position: position.clone() };
    },
    clearControlStates() {},
  });
  bot.pathfinder = {
    tickTimeout: 40,
    setMovements() {},
    setGoal() {},
    getLastStuckState: () => null,
    goto() {
      nativeRoutes += 1;
      bot.entity.position = new Vec3(5.5, 66, 0.5);
      bot.emit('path_update', { status: 'timeout', cost: 5, path: [] });
      const error = new Error('Took too long to decide path to goal!');
      error.name = 'Timeout';
      return Promise.reject(error);
    },
  };

  const reached = await goToPlayer(bot, 'DadPlayer', 3);

  assert.equal(nativeRoutes, 1, 'physical convergence must not trigger a duplicate region route');
  assert.equal(reached, false, 'an unfinished search must not claim exact arrival');
  assert.equal(bot.lastActionEvidence.outcome, 'closest_explored');
  assert.equal(bot.lastActionEvidence.distance, 5);
  assert.match(bot.output, /closest explored position/i);
});

test('Follow remains active when the player is dry but the nearby bot stance is still water', () => {
  const blocks = new Map();
  const put = (x, y, z, name, boundingBox) => {
    const position = new Vec3(x, y, z);
    blocks.set(`${x},${y},${z}`, { name, boundingBox, position });
  };
  put(0, 1, 0, 'air', 'empty');
  put(0, 0, 0, 'grass_block', 'block');
  put(2, 0, 0, 'water', 'empty');
  put(2, -1, 0, 'sand', 'block');
  put(2, 1, 0, 'air', 'empty');
  put(2, 0, 1, 'grass_block', 'block');
  put(2, 1, 1, 'air', 'empty');

  const bot = {
    blockAt(position) {
      return blocks.get(`${position.x},${position.y},${position.z}`) || null;
    },
  };
  const player = { position: new Vec3(0.5, 1, 0.5) };
  const goal = new ResponsiveFollowGoal(bot, player, 4);

  assert.equal(goal.isEnd(new Vec3(2, 0, 0)), false);
  assert.equal(goal.isEnd(new Vec3(2, 1, 1)), true);
});

test('runtime verifier requires the exact fresh successful action result', () => {
  const expected = {
    phase: 'succeeded',
    code: 'completed',
    label: 'action:stay',
  };
  const state = {
    _meta: { sampledAt: 1_100 },
    action: {
      lastResult: {
        phase: 'succeeded',
        code: 'completed',
        label: 'action:stay',
        finishedAt: 1_050,
      },
    },
  };

  assert.equal(matchesExpectedActionResult(state, 1_000, expected), true);
  assert.equal(matchesExpectedActionResult({
    ...state,
    action: { lastResult: { ...state.action.lastResult, phase: 'blocked' } },
  }, 1_000, expected), false);
  assert.equal(matchesExpectedActionResult({
    ...state,
    action: { lastResult: { ...state.action.lastResult, label: 'reflex:retreat' } },
  }, 1_000, expected), false);
  assert.equal(matchesExpectedActionResult({
    ...state,
    action: { lastResult: { ...state.action.lastResult, finishedAt: 999 } },
  }, 1_000, expected), false);
});

test('runtime verifier preflight requires reachable Minecraft and a registered stopped bot', () => {
  const health = {
    success: true,
    checks: { minecraftReachable: true },
    problems: ['Agent(s) registered but none are in-game yet.'],
  };
  const stoppedAgent = {
    name: 'CriticalBot',
    state: 'stopped',
    in_game: false,
    socket_connected: false,
  };
  const agents = { success: true, agents: [stoppedAgent] };

  assert.equal(validatePreflightPayloads(health, agents, 'CriticalBot').selectedAgent, stoppedAgent);
  assert.throws(
    () => validatePreflightPayloads({
      ...health,
      checks: { minecraftReachable: false },
    }, agents, 'CriticalBot'),
    /not reachable/,
  );
  assert.throws(
    () => validatePreflightPayloads(health, { success: true, agents: [] }, 'CriticalBot'),
    /not registered/,
  );
  assert.throws(
    () => validatePreflightPayloads(health, {
      success: true,
      agents: [{ ...stoppedAgent, state: 'running', in_game: true }],
    }, 'CriticalBot'),
    /must be stopped/,
  );
});

test('fixture admission produces a bounded immutable receipt for confirmed preconditions', () => {
  const receipt = createFixtureAdmissionReceipt({
    id: 'family-workshop',
    observedAt: 1234,
    request: { message: '!stay(1)', maximumLength: 256, singleAuthorityUnit: true },
    checks: [
      {
        id: 'native_route_complete',
        status: fixtureCheckStatus(true),
        code: 'route_complete',
        detail: 'Native Pathfinder returned success.',
        source: 'Pathfinder',
        observed: 'status=success pathLength=17',
      },
      {
        id: 'interaction_stance_supported',
        status: 'confirmed',
        source: 'interaction stance contract',
      },
      {
        id: 'optional_weather_note',
        status: 'unknown',
        required: false,
      },
    ],
  });

  assert.equal(receipt.outcome, 'admitted');
  assert.equal(receipt.admitted, true);
  assert.deepEqual(receipt.failedCheckIds, []);
  assert.deepEqual(receipt.unknownCheckIds, []);
  assert.equal(requireFixtureAdmission(receipt), receipt);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.checks), true);
  assert.equal(Object.isFrozen(receipt.checks[0]), true);
  assert.throws(() => receipt.checks.push({}), TypeError);
});

test('fixture admission fails closed with exact invalid check identifiers', () => {
  const receipt = createFixtureAdmissionReceipt({
    id: 'blocked-workshop',
    request: { message: 'x'.repeat(257), maximumLength: 256, singleAuthorityUnit: true },
    checks: [
      {
        id: 'native_route_complete',
        status: 'failed',
        code: 'path_not_found',
        source: 'Pathfinder',
      },
    ],
  });

  assert.equal(receipt.outcome, 'fixture_invalid');
  assert.equal(receipt.admitted, false);
  assert.deepEqual(receipt.failedCheckIds, ['native_route_complete', 'request.within_limit']);
  assert.throws(
    () => requireFixtureAdmission(receipt),
    error => error instanceof FixtureAdmissionError
      && error.code === 'fixture_invalid'
      && error.receipt === receipt,
  );
});

test('fixture admission preserves missing required evidence as unknown', () => {
  const receipt = createFixtureAdmissionReceipt({
    id: 'unknown-custody',
    request: { message: '!stay(1)', maximumLength: 256, singleAuthorityUnit: true },
    checks: [
      {
        id: 'exact_item_custody',
        status: fixtureCheckStatus(undefined),
        source: 'inventory snapshot',
      },
    ],
  });

  assert.equal(fixtureCheckStatus(false), 'failed');
  assert.equal(receipt.outcome, 'fixture_unknown');
  assert.deepEqual(receipt.unknownCheckIds, ['exact_item_custody']);
  assert.throws(() => requireFixtureAdmission(receipt), /exact_item_custody/);
});

test('setup acknowledgement reconciliation trusts authoritative readiness without hiding terminal setup failure', () => {
  assert.deepEqual(
    reconcileAdvisorySetupAcknowledgement(null, true),
    {
      status: 'confirmed',
      code: 'setup_authoritatively_reconciled',
      acknowledgement: 'missing',
      authoritativeState: 'confirmed',
    },
  );
  assert.deepEqual(
    reconcileAdvisorySetupAcknowledgement({ success: false }, undefined),
    {
      status: 'failed',
      code: 'setup_explicitly_rejected',
      acknowledgement: 'rejected',
      authoritativeState: 'unknown',
    },
  );
  assert.equal(
    reconcileAdvisorySetupAcknowledgement(null, undefined).status,
    'unknown',
  );
});

test('runtime verifier parses authoritative managed-server player counts', () => {
  assert.deepEqual(
    parsePlayerList(['[Server thread/INFO]: There are 0 of a max of 20 players online:']),
    {
      count: 0,
      max: 20,
      players: [],
      line: '[Server thread/INFO]: There are 0 of a max of 20 players online:',
    },
  );
  assert.deepEqual(
    parsePlayerList(['There are 2 of a max of 20 players online: Alex, Steve']),
    {
      count: 2,
      max: 20,
      players: ['Alex', 'Steve'],
      line: 'There are 2 of a max of 20 players online: Alex, Steve',
    },
  );
  assert.equal(parsePlayerList(['Done (1.23s)!']), null);
  assert.equal(parsePlayerListAfterLatestCommand([
    '[command] > list',
    'There are 1 of a max of 20 players online: StalePlayer',
    '[command] > list',
  ]), null, 'a prior count cannot satisfy a newer acknowledged list command');
  assert.deepEqual(parsePlayerListAfterLatestCommand([
    '[command] > list',
    'There are 1 of a max of 20 players online: StalePlayer',
    '[command] > list',
    'There are 0 of a max of 20 players online:',
  ]), {
    count: 0,
    max: 20,
    players: [],
    line: 'There are 0 of a max of 20 players online:',
  });
});

test('runtime verifier dry-run reports the exact bounded live command without connecting', () => {
  const execution = spawnSync(process.execPath, [
    'tools/verify-behavior-runtime.mjs',
    '--dry-run',
    '--case',
    'bot-lifecycle',
    '--bot',
    'CriticalBot',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const output = JSON.parse(execution.stdout);
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.wouldConnect, false);
  assert.equal(output.bot, 'CriticalBot');
  assert.deepEqual(output.selectedCases.map((entry) => entry.id), ['bot-lifecycle']);
  assert.equal(output.selectedCases[0].command, '!stay(1)');
  assert.deepEqual(output.selectedCases[0].expectedActionResult, {
    phase: 'succeeded',
    code: 'completed',
    label: 'action:stay',
  });
  assert.deepEqual(output.mutations, [
    'query managed server player list',
    'start selected bot',
    'set session autonomy to command',
    'send !stay(1) to selected bot',
    'stop selected bot',
  ]);
});

test('stack shutdown runs every owner and reports partial cleanup instead of false success', async () => {
  const calls = [];
  const result = await stopMindcraftRuntime({
    stopDirector: () => { calls.push('director'); return { success: true }; },
    stopTaskRunners: () => { calls.push('tasks'); return { success: true }; },
    stopAgents: () => { calls.push('agents'); return { success: false, error: 'agent remained' }; },
    stopMinecraft: () => {
      calls.push('minecraft');
      return { phase: 'stopped', installed: true };
    },
    stopLocalServices: () => { calls.push('services'); return { success: true }; },
  });

  assert.deepEqual(calls, ['director', 'tasks', 'agents', 'minecraft', 'services']);
  assert.equal(result.success, false);
  assert.match(result.error, /agents: agent remained/);
  assert.equal(result.server.phase, 'stopped');
  assert.equal(result.components.length, 5);
});

test('Mindcraft owns and terminates only the Ollama process it starts', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  let spawnOptions = null;
  let discoveryCount = 0;
  let terminatedPid = null;
  const owner = new OwnedLocalServices({
    discoverOllama: () => {
      discoveryCount += 1;
      return discoveryCount === 1 ? [] : [{ name: 'qwen2.5:3b', kind: 'chat' }];
    },
    spawnImpl: (_command, _args, options) => {
      spawnOptions = options;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateProcessTree: (target) => {
      terminatedPid = target.pid;
      target.exitCode = 0;
      target.emit('exit', 0, null);
      return { success: true, pid: target.pid, forced: true, error: null };
    },
  });

  const started = await owner.startOllama();
  assert.equal(started.owned, true);
  assert.equal(started.pid, 4242);
  assert.equal(spawnOptions.detached, false);
  assert.equal(spawnOptions.windowsHide, true);

  const stopped = await owner.stopAll();
  assert.equal(stopped.success, true);
  assert.equal(stopped.ollama.stopped, true);
  assert.equal(terminatedPid, 4242);
});

test('Windows owned-process cleanup targets the complete hidden process tree', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  let invocation = null;
  const execFileImpl = (file, args, options, callback) => {
    invocation = { file, args, options };
    child.exitCode = 1;
    child.emit('exit', 1, null);
    callback(null);
  };

  const result = await terminateOwnedProcessTree(child, {
    platform: 'win32',
    execFileImpl,
    timeoutMs: 100,
  });

  assert.equal(result.success, true);
  assert.equal(result.forced, true);
  assert.deepEqual(invocation, {
    file: 'taskkill.exe',
    args: ['/PID', '4242', '/T', '/F'],
    options: { windowsHide: true, timeout: 10_000 },
  });
});
