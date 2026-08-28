import { randomUUID } from 'node:crypto';

import { isPreemption } from './action-result.js';
import { loopEraseMiningRouteCells } from './mining-corridor-planner.js';

const ROLES = new Set(['builder', 'miner', 'lumberjack', 'scout']);
const KINDS = new Set(['stockpile', 'build', 'emergency_shelter', 'mine', 'harvest', 'explore', 'scout']);
const SOURCES = new Set(['player', 'role', 'survival', 'restart']);
const PHASES = new Set([
  'assess',
  'acquire',
  'prepare',
  'execute',
  'verify',
  'deliver',
  'recover',
  'complete',
  'failed',
  'cancelled',
]);
const CANONICAL_NAME = /^[a-z0-9_]{1,64}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const SAFE_REQUESTER = /^[A-Za-z0-9_ -]{0,32}$/;
const MAX_BLUEPRINT_CELLS = 4096;
const MAX_BLUEPRINT_FIXTURES = 64;
const MAX_FAILED_METHODS = 24;
const MAX_FAILED_TARGETS = 24;
const MAX_MINING_RETURN_CELLS = 512;
const MAX_NAVIGATION_STEP_EXCLUSIONS = 16;
const DEFAULT_MAX_RECOVERIES = 8;
const FIXTURE_KINDS = new Set(['bed', 'door', 'stair']);
const HORIZONTAL_FACINGS = new Set(['north', 'south', 'east', 'west']);
// A preemption is not the work order failing. The bot was mid-swing when a
// creeper arrived: nothing about the order became wrong, and the same step is
// still the right next step. Folding one in as a retryable failure burned an
// attempt, so three interruptions killed a job permanently, and it routed the
  // order through `recover`, walking the bot away from the very worksite it
  // was using. Preemption still needs a ceiling: a bot pinned by something it
// cannot escape would otherwise re-derive the same step forever with no
// failure to report.
const MAX_PREEMPTIONS = 24;

function finiteInteger(value, fallback, minimum, maximum) {
  const number = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedText(value, maximum) {
  const text = String(value || '');
  // eslint-disable-next-line no-control-regex -- Persisted work-order text must be display and storage safe.
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new TypeError('Text contains control characters.');
  return text.trim().slice(0, maximum);
}

function acquisitionStrategyFailureKey(method) {
  const match = /^(collect|harvest):[^>]+->([a-z0-9_]+)$/.exec(method);
  return match ? `${match[1]}:*->${match[2]}` : method;
}

function physicalTargetKey(target) {
  if (![target?.x, target?.y, target?.z].every(Number.isFinite)) return null;
  return `${target.name || ''}:${Math.floor(target.x)}:${Math.floor(target.y)}:${Math.floor(target.z)}`;
}

function normalizeTarget(target) {
  if (target == null) return null;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TypeError('Work-order target must be an object.');
  }
  const normalized = {};
  if (target.name !== undefined) {
    const name = boundedText(target.name, 64);
    if (!CANONICAL_NAME.test(name)) throw new TypeError('Target name must be canonical.');
    normalized.name = name;
  }
  for (const coordinate of ['x', 'y', 'z']) {
    if (target[coordinate] !== undefined) {
      if (!Number.isFinite(target[coordinate])) throw new TypeError(`Target ${coordinate} must be finite.`);
      normalized[coordinate] = Math.floor(target[coordinate]);
    }
  }
  return Object.freeze(normalized);
}

function normalizeBlueprint(blueprint) {
  if (blueprint == null) return null;
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
    throw new TypeError('Blueprint must be an object.');
  }
  const id = boundedText(blueprint.id, 64);
  if (!CANONICAL_NAME.test(id)) throw new TypeError('Blueprint id must be canonical.');
  const width = finiteInteger(blueprint.width, 0, 1, 32);
  const depth = finiteInteger(blueprint.depth, 0, 1, 32);
  const height = finiteInteger(blueprint.height, 0, 1, 32);
  if (
    width !== blueprint.width
    || depth !== blueprint.depth
    || height !== blueprint.height
  ) throw new TypeError('Blueprint dimensions are invalid or excessive.');
  if (!Array.isArray(blueprint.cells) || blueprint.cells.length > MAX_BLUEPRINT_CELLS) {
    throw new TypeError('Blueprint cell count is invalid or excessive.');
  }
  const occupied = new Set();
  const cells = blueprint.cells.map(cell => {
    if (
      !cell
      || !Number.isInteger(cell.x)
      || !Number.isInteger(cell.y)
      || !Number.isInteger(cell.z)
      || Math.abs(cell.x) > 31
      || cell.y < 0
      || cell.y > 31
      || Math.abs(cell.z) > 31
    ) throw new TypeError('Blueprint cell coordinates are invalid.');
    const material = boundedText(cell.material, 64);
    if (!CANONICAL_NAME.test(material)) throw new TypeError('Blueprint material must be canonical.');
    const hasStage = Number.isFinite(cell.stage);
    const stage = finiteInteger(cell.stage, 0, 0, 16);
    const cellFunction = cell.function == null ? '' : boundedText(cell.function, 64);
    if (cellFunction && !CANONICAL_NAME.test(cellFunction)) {
      throw new TypeError('Blueprint cell function must be canonical.');
    }
    const materialFamily = cell.materialFamily == null ? '' : boundedText(cell.materialFamily, 64);
    if (materialFamily && !CANONICAL_NAME.test(materialFamily)) {
      throw new TypeError('Blueprint cell material family must be canonical.');
    }
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    if (occupied.has(key)) throw new TypeError('Blueprint contains a duplicate cell.');
    occupied.add(key);
    const fixtureId = cell.fixtureId == null ? '' : boundedText(cell.fixtureId, 64);
    if (fixtureId && !CANONICAL_NAME.test(fixtureId)) throw new TypeError('Blueprint fixture id must be canonical.');
    const facing = cell.facing == null ? '' : boundedText(cell.facing, 16);
    if (facing && !HORIZONTAL_FACINGS.has(facing)) throw new TypeError('Blueprint fixture facing is invalid.');
    return Object.freeze({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      material,
      ...(hasStage ? { stage } : {}),
      ...(cellFunction ? { function: cellFunction } : {}),
      ...(materialFamily ? { materialFamily } : {}),
      ...(fixtureId ? { fixtureId } : {}),
      ...(facing ? { facing } : {}),
    });
  });
  const fixtureOffsets = (values, label, { allowEmpty = false } = {}) => {
    if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > 4) {
      throw new TypeError(`Blueprint fixture ${label} are invalid.`);
    }
    return Object.freeze(values.map(value => {
      if (
        !value
        || !Number.isInteger(value.x)
        || !Number.isInteger(value.y)
        || !Number.isInteger(value.z)
        || Math.max(Math.abs(value.x), Math.abs(value.y), Math.abs(value.z)) > 2
      ) throw new TypeError(`Blueprint fixture ${label} contain an invalid offset.`);
      const part = value.part == null ? '' : boundedText(value.part, 16);
      if (part && !CANONICAL_NAME.test(part)) throw new TypeError('Blueprint fixture part must be canonical.');
      return Object.freeze({ x: value.x, y: value.y, z: value.z, ...(part ? { part } : {}) });
    }));
  };
  const rawFixtures = Array.isArray(blueprint.fixtures) ? blueprint.fixtures : [];
  if (rawFixtures.length > MAX_BLUEPRINT_FIXTURES) throw new TypeError('Blueprint has too many logical fixtures.');
  const fixtureIds = new Set();
  const fixtures = rawFixtures.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Blueprint fixture is invalid.');
    const fixtureId = boundedText(raw.id, 64);
    const kind = boundedText(raw.kind, 16);
    const material = boundedText(raw.material, 64);
    const fixtureFunction = boundedText(raw.function, 64);
    const facing = boundedText(raw.facing, 16);
    if (
      !CANONICAL_NAME.test(fixtureId)
      || fixtureIds.has(fixtureId)
      || !FIXTURE_KINDS.has(kind)
      || !CANONICAL_NAME.test(material)
      || !CANONICAL_NAME.test(fixtureFunction)
      || !HORIZONTAL_FACINGS.has(facing)
    ) throw new TypeError('Blueprint fixture identity is invalid.');
    fixtureIds.add(fixtureId);
    const anchor = raw.anchor;
    if (
      !anchor
      || !Number.isInteger(anchor.x)
      || !Number.isInteger(anchor.y)
      || !Number.isInteger(anchor.z)
    ) throw new TypeError('Blueprint fixture anchor is invalid.');
    const occupiedOffsets = fixtureOffsets(raw.occupiedOffsets, 'occupied offsets');
    const supportOffsets = fixtureOffsets(raw.supportOffsets, 'support offsets', {
      // A lowest-course one-cell fixture is supported by the natural terrain
      // proven by site selection and rechecked immediately before placement.
      allowEmpty: kind === 'stair' && anchor.y === 0,
    });
    const anchorCell = cells.find(cell => (
      cell.x === anchor.x
      && cell.y === anchor.y
      && cell.z === anchor.z
      && cell.fixtureId === fixtureId
      && cell.material === material
    ));
    if (!anchorCell) throw new TypeError('Blueprint fixture has no matching placement cell.');
    return Object.freeze({
      id: fixtureId,
      kind,
      material,
      function: fixtureFunction,
      facing,
      anchor: Object.freeze({ x: anchor.x, y: anchor.y, z: anchor.z }),
      occupiedOffsets,
      supportOffsets,
    });
  });
  return Object.freeze({
    id,
    width,
    depth,
    height,
    cells: Object.freeze(cells),
    fixtures: Object.freeze(fixtures),
  });
}

/**
 * Where the bot was standing when it last dispatched work. A fight can drag it
 * a long way from its own worksite, and without this the order resumes from
 * wherever the chase ended instead of from where the work is.
 */
function normalizeAnchor(anchor) {
  if (anchor == null) return null;
  if (typeof anchor !== 'object' || Array.isArray(anchor)) {
    throw new TypeError('Work-order anchor must be an object.');
  }
  if (!['x', 'y', 'z'].every(axis => Number.isFinite(anchor[axis]))) return null;
  return Object.freeze({
    x: Math.floor(anchor.x),
    y: Math.floor(anchor.y),
    z: Math.floor(anchor.z),
  });
}

function normalizeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return Object.freeze({});
  const normalized = {};
  for (const key of ['baselineInventory', 'targetInventory']) {
    if (Number.isFinite(checkpoint[key])) {
      normalized[key] = finiteInteger(checkpoint[key], 0, 0, 100_000);
    }
  }
  for (const key of [
    'verifiedCount',
    'nextCell',
    'collected',
    'delivered',
    'deliveryIndex',
    'deliveryOffset',
    'caveSearchRelocations',
    'miningRegionRelocations',
    'corridorSearchLegs',
    'corridorRequirementProgress',
    'materialSearchRelocations',
    'safetyDetours',
  ]) {
    if (Number.isFinite(checkpoint[key])) normalized[key] = finiteInteger(checkpoint[key], 0, 0, 4096);
  }
  if (Number.isSafeInteger(checkpoint.scoutSearchRelocations) && checkpoint.scoutSearchRelocations >= 0) {
    normalized.scoutSearchRelocations = checkpoint.scoutSearchRelocations;
  }
  if (Number.isFinite(checkpoint.miningReturnIndex)) {
    normalized.miningReturnIndex = finiteInteger(
      checkpoint.miningReturnIndex,
      -1,
      -1,
      MAX_MINING_RETURN_CELLS - 1,
    );
  }
  const deathRecoveryRecordedAt = Number(checkpoint.deathRecovery?.recordedAt);
  if (Number.isSafeInteger(deathRecoveryRecordedAt) && deathRecoveryRecordedAt > 0) {
    normalized.deathRecovery = Object.freeze({
      recordedAt: deathRecoveryRecordedAt,
    });
  }
  if (checkpoint.caveLit === true) normalized.caveLit = true;
  if (checkpoint.caveLightingComplete === true) normalized.caveLightingComplete = true;
  if (checkpoint.scoutReturned === true) normalized.scoutReturned = true;
  if (checkpoint.scoutGuideComplete === true) normalized.scoutGuideComplete = true;
  if (checkpoint.bestEffort === true) normalized.bestEffort = true;
  if (checkpoint.retainResults === true) normalized.retainResults = true;
  if (checkpoint.miningRelocationPending === true) normalized.miningRelocationPending = true;
  if (checkpoint.worksiteReturnPending === true) normalized.worksiteReturnPending = true;
  if (checkpoint.worksiteReturnDryOnly === true) normalized.worksiteReturnDryOnly = true;
  if (Array.isArray(checkpoint.navigationStepExclusions)) {
    const exclusions = new Map();
    for (const value of checkpoint.navigationStepExclusions.slice(-MAX_NAVIGATION_STEP_EXCLUSIONS)) {
      if (![value?.x, value?.y, value?.z].every(Number.isFinite)) continue;
      const exclusion = {
        x: Math.floor(value.x),
        y: Math.floor(value.y),
        z: Math.floor(value.z),
      };
      if ([value?.source?.x, value?.source?.y, value?.source?.z].every(Number.isFinite)) {
        exclusion.source = Object.freeze({
          x: Math.floor(value.source.x),
          y: Math.floor(value.source.y),
          z: Math.floor(value.source.z),
        });
      }
      const locomotion = boundedText(value?.locomotion, 32);
      if (locomotion) exclusion.locomotion = locomotion;
      exclusions.set(`${exclusion.x}:${exclusion.y}:${exclusion.z}`, Object.freeze(exclusion));
    }
    if (exclusions.size > 0) {
      normalized.navigationStepExclusions = Object.freeze([...exclusions.values()]);
    }
  }
  const lastFailedTargetActionId = boundedText(checkpoint.lastFailedTargetActionId, 96);
  if (lastFailedTargetActionId) normalized.lastFailedTargetActionId = lastFailedTargetActionId;
  if (['exposed_cave', 'mining_corridor'].includes(checkpoint.acquisitionStrategy)) {
    normalized.acquisitionStrategy = checkpoint.acquisitionStrategy;
  }
  const corridorRequirementItem = boundedText(checkpoint.corridorRequirementItem, 64);
  if (CANONICAL_NAME.test(corridorRequirementItem)) {
    normalized.corridorRequirementItem = corridorRequirementItem;
  }
  const homeDimension = boundedText(checkpoint.homeDimension, 64);
  if (CANONICAL_NAME.test(homeDimension)) normalized.homeDimension = homeDimension;
  if (Number.isSafeInteger(checkpoint.scoutSearchLimit) && checkpoint.scoutSearchLimit > 0) {
    normalized.scoutSearchLimit = checkpoint.scoutSearchLimit;
  }
  const scoutFindings = [...new Set((Array.isArray(checkpoint.scoutFindings)
    ? checkpoint.scoutFindings
    : [])
    .map(value => boundedText(value, 32))
    .filter(value => ['cave', 'animal', 'village'].includes(value)))];
  if (scoutFindings.length > 0) normalized.scoutFindings = Object.freeze(scoutFindings);
  const scoutGuideFinding = boundedText(checkpoint.scoutGuideFinding, 32);
  if (scoutFindings.includes(scoutGuideFinding)) {
    normalized.scoutGuideFinding = scoutGuideFinding;
  }
  const scoutAnimalTarget = boundedText(checkpoint.scoutAnimalTarget, 64);
  if (scoutFindings.includes('animal') && CANONICAL_NAME.test(scoutAnimalTarget)) {
    normalized.scoutAnimalTarget = scoutAnimalTarget;
    normalized.scoutAnimalMinimumCount = finiteInteger(
      checkpoint.scoutAnimalMinimumCount,
      1,
      1,
      8,
    );
  }
  for (const [prefix, includeName] of [['scoutCave', false], ['scoutAnimal', true], ['scoutVillage', false]]) {
    const coordinates = ['X', 'Y', 'Z'].map(axis => Number(checkpoint[`${prefix}${axis}`]));
    if (!coordinates.every(Number.isFinite)) continue;
    normalized[`${prefix}X`] = Math.floor(coordinates[0]);
    normalized[`${prefix}Y`] = Math.floor(coordinates[1]);
    normalized[`${prefix}Z`] = Math.floor(coordinates[2]);
    if (includeName) {
      const name = boundedText(checkpoint.scoutAnimalName, 64);
      if (CANONICAL_NAME.test(name)) normalized.scoutAnimalName = name;
    }
  }
  const containerName = boundedText(checkpoint.containerName, 64);
  const containerDimension = boundedText(checkpoint.containerDimension, 64);
  const containerCoordinates = ['containerX', 'containerY', 'containerZ']
    .map(key => Number(checkpoint[key]));
  if (
    ['chest', 'trapped_chest', 'barrel'].includes(containerName)
    && CANONICAL_NAME.test(containerDimension)
    && containerCoordinates.every(Number.isFinite)
  ) {
    normalized.containerName = containerName;
    normalized.containerDimension = containerDimension;
    normalized.containerX = Math.floor(containerCoordinates[0]);
    normalized.containerY = Math.floor(containerCoordinates[1]);
    normalized.containerZ = Math.floor(containerCoordinates[2]);
  }
  if (checkpoint.baselineFamilyCounts && typeof checkpoint.baselineFamilyCounts === 'object') {
    const counts = {};
    for (const [rawName, rawCount] of Object.entries(checkpoint.baselineFamilyCounts).slice(0, 64)) {
      const name = boundedText(rawName, 64);
      const count = Number(rawCount);
      if (CANONICAL_NAME.test(name) && Number.isFinite(count) && count >= 0) {
        counts[name] = finiteInteger(count, 0, 0, 2304);
      }
    }
    normalized.baselineFamilyCounts = Object.freeze(counts);
  }
  if (Array.isArray(checkpoint.collectedManifest)) {
    const manifest = [];
    for (const rawEntry of checkpoint.collectedManifest.slice(0, 64)) {
      const item = boundedText(rawEntry?.item, 64);
      const quantity = Number(rawEntry?.quantity);
      if (!CANONICAL_NAME.test(item) || !Number.isFinite(quantity) || quantity < 1) continue;
      manifest.push(Object.freeze({
        item,
        quantity: finiteInteger(quantity, 1, 1, 2304),
      }));
    }
    normalized.collectedManifest = Object.freeze(manifest);
  }
  if (Array.isArray(checkpoint.requiredOutputs)) {
    const requirements = [];
    const seen = new Set();
    for (const rawEntry of checkpoint.requiredOutputs.slice(0, 12)) {
      const source = boundedText(rawEntry?.source, 64);
      const item = boundedText(rawEntry?.item, 64);
      const quantity = Number(rawEntry?.quantity);
      if (
        !CANONICAL_NAME.test(source)
        || !CANONICAL_NAME.test(item)
        || !Number.isFinite(quantity)
        || quantity < 1
        || seen.has(item)
      ) continue;
      seen.add(item);
      requirements.push(Object.freeze({
        source,
        item,
        quantity: finiteInteger(quantity, 1, 1, 2304),
      }));
    }
    if (requirements.length > 0) normalized.requiredOutputs = Object.freeze(requirements);
  }
  if (Array.isArray(checkpoint.verifiedCells)) {
    normalized.verifiedCells = Object.freeze(checkpoint.verifiedCells
      .slice(0, MAX_BLUEPRINT_CELLS)
      .filter(value => typeof value === 'string' && value.length <= 32));
  }
  if (Array.isArray(checkpoint.miningReturnRoute)) {
    const route = loopEraseMiningRouteCells(
      checkpoint.miningReturnRoute,
      { limit: MAX_MINING_RETURN_CELLS },
    ).map(cell => Object.freeze(cell));
    if (route.length > 0) {
      normalized.miningReturnRoute = Object.freeze(route);
      if (Number.isFinite(normalized.miningReturnIndex)) {
        normalized.miningReturnIndex = Math.min(
          route.length - 1,
          normalized.miningReturnIndex,
        );
      }
    }
  }
  const miningSearchNoProgress = checkpoint.miningSearchNoProgress;
  const miningSearchMethod = boundedText(miningSearchNoProgress?.method, 120);
  const miningSearchTarget = boundedText(miningSearchNoProgress?.target, 64);
  if (
    miningSearchMethod === 'action:mineSearchTunnel'
    && CANONICAL_NAME.test(miningSearchTarget)
    && ['x', 'y', 'z'].every(axis => Number.isFinite(miningSearchNoProgress?.[axis]))
  ) {
    normalized.miningSearchNoProgress = Object.freeze({
      method: miningSearchMethod,
      target: miningSearchTarget,
      x: Math.floor(miningSearchNoProgress.x),
      y: Math.floor(miningSearchNoProgress.y),
      z: Math.floor(miningSearchNoProgress.z),
      code: boundedText(miningSearchNoProgress.code, 80),
    });
  }
  const toolName = boundedText(checkpoint.toolRequirement?.name, 80);
  const minimumUsableDurability = Number(checkpoint.toolRequirement?.minimumUsableDurability);
  if (/^[a-z0-9_]+$/.test(toolName) && Number.isFinite(minimumUsableDurability)) {
    normalized.toolRequirement = Object.freeze({
      name: toolName,
      minimumUsableDurability: finiteInteger(minimumUsableDurability, 1, 1, 10_000),
    });
  }
  const workstationName = boundedText(checkpoint.workstationRequirement?.name, 80);
  if (/^[a-z0-9_]+$/.test(workstationName) && checkpoint.workstationRequirement?.carried === true) {
    normalized.workstationRequirement = Object.freeze({
      name: workstationName,
      carried: true,
    });
  }
  if (checkpoint.accessRequirement?.kind === 'surface') {
    normalized.accessRequirement = Object.freeze({ kind: 'surface' });
  }
  const acquisitionTarget = boundedText(checkpoint.acquisitionRequirement?.target, 64);
  const acquisitionQuantity = Number(checkpoint.acquisitionRequirement?.quantity);
  if (CANONICAL_NAME.test(acquisitionTarget) && Number.isFinite(acquisitionQuantity)) {
    normalized.acquisitionRequirement = Object.freeze({
      target: acquisitionTarget,
      quantity: finiteInteger(acquisitionQuantity, 1, 1, 2304),
    });
  }
  if (checkpoint.acquisitionVariantCommitted === true) {
    normalized.acquisitionVariantCommitted = true;
  }
  const materialSearchTarget = boundedText(checkpoint.materialSearchTarget, 64);
  if (CANONICAL_NAME.test(materialSearchTarget)) {
    normalized.materialSearchTarget = materialSearchTarget;
  }
  if (Array.isArray(checkpoint.failedMethods)) {
    normalized.failedMethods = Object.freeze([...new Set(checkpoint.failedMethods
      .slice(0, MAX_FAILED_METHODS)
      .map(value => boundedText(value, 160))
      .filter(Boolean))]);
  }
  if (Array.isArray(checkpoint.failedTargets)) {
    const targets = new Map();
    for (const rawTarget of checkpoint.failedTargets.slice(-MAX_FAILED_TARGETS)) {
      const target = normalizeTarget(rawTarget);
      if (![target?.x, target?.y, target?.z].every(Number.isFinite)) continue;
      const failureCode = boundedText(
        rawTarget?.failureCode || rawTarget?.outcome || rawTarget?.code,
        80,
      );
      targets.set(
        `${target.name || ''}:${target.x}:${target.y}:${target.z}`,
        failureCode ? Object.freeze({ ...target, failureCode }) : target,
      );
    }
    if (targets.size > 0) normalized.failedTargets = Object.freeze([...targets.values()]);
  }
  return Object.freeze(normalized);
}

export function checkpointAfterControlHazard(order, hazard) {
  const checkpoint = normalizeCheckpoint(order?.checkpoint);
  if (
    order?.role !== 'miner'
    || checkpoint.worksiteReturnPending !== true
    || hazard?.kind !== 'drowning'
    || !String(hazard?.outcome || '').startsWith('drowning_escape_')
  ) return checkpoint;
  return normalizeCheckpoint({
    ...checkpoint,
    worksiteReturnDryOnly: true,
  });
}

function discoveredPrerequisiteCheckpoint(result, currentCheckpoint) {
  const skill = result?.evidence?.skill;
  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) return null;
  const candidate = normalizeCheckpoint({
    ...currentCheckpoint,
    ...(skill.toolRequirement ? { toolRequirement: skill.toolRequirement } : {}),
    ...(skill.workstationRequirement ? { workstationRequirement: skill.workstationRequirement } : {}),
    ...(skill.accessRequirement ? { accessRequirement: skill.accessRequirement } : {}),
  });
  const changed = ['toolRequirement', 'workstationRequirement', 'accessRequirement']
    .some(key => JSON.stringify(candidate[key] || null) !== JSON.stringify(currentCheckpoint?.[key] || null));
  return changed ? candidate : null;
}

function checkpointWithVerifiedMiningRoute(result, currentCheckpoint) {
  const skill = result?.evidence?.skill;
  if (
    result?.phase !== 'succeeded'
    || skill?.routeDigging !== true
    || skill?.returnable !== true
    || !Array.isArray(skill.returnRoute)
    || skill.returnRoute.length < 1
  ) return currentCheckpoint;
  const incoming = [];
  for (const rawCell of skill.returnRoute) {
    if (![rawCell?.x, rawCell?.y, rawCell?.z].every(Number.isFinite)) continue;
    const cell = {
      x: Math.floor(rawCell.x),
      y: Math.floor(rawCell.y),
      z: Math.floor(rawCell.z),
    };
    const previous = incoming.at(-1);
    if (previous && previous.x === cell.x && previous.y === cell.y && previous.z === cell.z) continue;
    incoming.push(cell);
  }
  if (incoming.length < 1) return currentCheckpoint;

  const prior = Array.isArray(currentCheckpoint?.miningReturnRoute)
    && Number(currentCheckpoint?.miningReturnIndex) >= 0
    ? [...currentCheckpoint.miningReturnRoute]
    : [];
  const incomingStart = incoming[0];
  // The next bounded mining leg may first walk backward to stable ground on
  // the preserved route, then extend from that earlier cell. Keep the proven
  // prefix through the latest exact overlap and replace only its superseded
  // tail. Requiring overlap at the old final cell forgets the real exit.
  const overlapIndex = prior.findLastIndex(cell => (
    cell.x === incomingStart.x
    && cell.y === incomingStart.y
    && cell.z === incomingStart.z
  ));
  // A collection action can walk through an already-open tunnel before it
  // starts the next excavated fragment. In that case the new route has no
  // exact cell overlap even though the same action physically traversed the
  // gap. Keep the prior exit path and append the fragment; the existing
  // no-dig route-cell capability will reverify that open gap during return.
  const combined = prior.length > 0
    ? overlapIndex >= 0
      ? prior.slice(0, overlapIndex + 1)
      : prior
    : [];
  for (const cell of incoming) {
    const previous = combined.at(-1);
    if (previous && previous.x === cell.x && previous.y === cell.y && previous.z === cell.z) continue;
    if (combined.length >= MAX_MINING_RETURN_CELLS) break;
    combined.push(cell);
  }
  if (combined.length < 1) return currentCheckpoint;
  return normalizeCheckpoint({
    ...currentCheckpoint,
    miningReturnRoute: combined,
    miningReturnIndex: combined.length - 1,
  });
}

function surfaceRecoveryObservation(result) {
  const skill = result?.evidence?.skill;
  if (skill?.kind !== 'surface_navigation') return null;
  return Object.freeze({
    reached: result.phase === 'succeeded' && skill.outcome === 'surface_reached',
    progressed: (
      skill.supported === true
      && Number(skill.verticalProgress) >= 1
    ),
  });
}

function movementRecoveryObservation(result) {
  const skill = result?.evidence?.skill;
  const progress = skill?.progress;
  if (
    result?.phase !== 'failed'
    || result?.retryable !== true
    || skill?.kind !== 'movement'
  ) return null;

  if (
    progress?.progressed === true
    && progress?.supported === true
    && Number.isFinite(progress?.startMetric)
    && Number.isFinite(progress?.lastMetric)
    && progress.lastMetric < progress.startMetric
    && ['x', 'y', 'z'].every(axis => (
      Number.isFinite(progress?.startPosition?.[axis])
      && Number.isFinite(progress?.lastPosition?.[axis])
    ))
  ) {
    const displacement = Math.hypot(
      progress.lastPosition.x - progress.startPosition.x,
      progress.lastPosition.y - progress.startPosition.y,
      progress.lastPosition.z - progress.startPosition.z,
    );
    return Object.freeze({
      progressed: displacement >= 0.75,
      displacement,
    });
  }

  const segmentedProgress = Number(skill.progressed);
  const verifiedSegment = Array.isArray(skill.segments)
    && skill.segments.some(segment => (
      segment?.executed === true
      && ['progress_verified', 'detour_verified'].includes(segment?.outcome)
      && segment?.safety?.supported === true
      && segment?.safety?.nonHazardous === true
      && ['x', 'y', 'z'].every(axis => Number.isFinite(segment?.terminal?.[axis]))
    ));
  if (!verifiedSegment || !Number.isFinite(segmentedProgress) || segmentedProgress < 0.75) {
    return null;
  }
  return Object.freeze({
    progressed: true,
    displacement: segmentedProgress,
  });
}

function checkpointWithNavigationStepExclusion(result, checkpoint) {
  const skill = result?.evidence?.skill;
  const excludedStep = skill?.kind === 'movement'
    ? skill?.recovery?.excludedStep
    : null;
  if (![excludedStep?.x, excludedStep?.y, excludedStep?.z].every(Number.isFinite)) {
    return checkpoint;
  }
  return normalizeCheckpoint({
    ...checkpoint,
    navigationStepExclusions: [
      ...(checkpoint?.navigationStepExclusions || []),
      excludedStep,
    ],
  });
}

function miningSearchNoProgressCheckpoint(result) {
  const skill = result?.evidence?.skill;
  const progress = skill?.progress;
  if (
    result?.phase !== 'failed'
    || result?.label !== 'action:mineSearchTunnel'
    || skill?.kind !== 'mining_search'
    || skill?.routeDigging !== true
    || progress?.kind !== 'mining_search_physical'
    || progress?.verified !== true
    || progress?.changed !== false
    || skill?.toolRequirement
    || skill?.workstationRequirement
    || skill?.accessRequirement
    || !CANONICAL_NAME.test(boundedText(skill?.target?.name, 64))
    || !['x', 'y', 'z'].every(axis => Number.isFinite(progress?.position?.[axis]))
  ) return null;
  return Object.freeze({
    method: 'action:mineSearchTunnel',
    target: boundedText(skill.target.name, 64),
    x: Math.floor(progress.position.x),
    y: Math.floor(progress.position.y),
    z: Math.floor(progress.position.z),
    code: boundedText(result.code, 80),
  });
}

function normalizeConstraints(constraints) {
  const source = constraints && typeof constraints === 'object' && !Array.isArray(constraints)
    ? constraints
    : {};
  return Object.freeze({
    maxDistance: finiteInteger(source.maxDistance, 64, 16, 512),
    minHunger: finiteInteger(source.minHunger, 16, 0, 20),
    minFoodPoints: finiteInteger(source.minFoodPoints, 12, 0, 2304),
    reserveSlots: finiteInteger(source.reserveSlots, 1, 0, 36),
    requireLight: source.requireLight !== false,
    replant: source.replant !== false,
  });
}

function normalizeInteractionFailure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const target = normalizeTarget(value.target);
    const kind = boundedText(value.kind, 40);
    const method = boundedText(value.method, 80);
    const failureStage = boundedText(value.failureStage, 80);
    if (!kind || !method || !failureStage || !target) return null;
    const material = boundedText(value.material, 64);
    return Object.freeze({
      kind,
      method,
      failureStage,
      candidateCount: finiteInteger(value.candidateCount, 0, 0, 65_536),
      target,
      ...(CANONICAL_NAME.test(material) ? { material } : {}),
    });
  } catch {
    return null;
  }
}

function normalizeMaterialBlocker(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const missionId = boundedText(value.missionId, 96);
  const activityId = boundedText(value.activityId, 128);
  const materialToken = boundedText(value.materialToken, 240);
  const selectedSkill = boundedText(value.selectedSkill, 80);
  if (!missionId || !activityId || !materialToken || !selectedSkill) return null;
  const args = Object.freeze((Array.isArray(value.args) ? value.args : [])
    .slice(0, 16)
    .map(argument => {
      if (argument === null || typeof argument === 'boolean') return argument;
      if (typeof argument === 'number') return Number.isFinite(argument) ? argument : null;
      if (typeof argument === 'string') return boundedText(argument, 240);
      return null;
    }));
  const position = (() => {
    try {
      return normalizeTarget(value.position);
    } catch {
      return null;
    }
  })();
  return Object.freeze({
    missionId,
    activityId,
    materialToken,
    selectedSkill,
    args,
    ...(position ? { position } : {}),
    openedAt: Number.isFinite(Number(value.openedAt))
      ? Math.max(0, Math.floor(Number(value.openedAt)))
      : null,
  });
}

function materialBlockerFromResult(result) {
  if (
    result?.code !== 'action_pattern_detected'
    || result?.continuation?.kind !== 'retry_after_material_change'
  ) return null;
  const evidence = result.evidence;
  return normalizeMaterialBlocker({
    missionId: evidence?.missionId,
    activityId: evidence?.activityId,
    materialToken: evidence?.materialToken,
    selectedSkill: evidence?.selectedSkill,
    args: evidence?.args,
    position: evidence?.position,
    openedAt: evidence?.circuitOpenedAt,
  });
}

function interactionFailureFromResult(result) {
  const skill = result?.evidence?.skill;
  const stance = skill?.interactionStance;
  const request = result?.evidence?.request;
  if (
    !stance
    || stance.status !== 'failed'
    || !stance.failureStage
    || !request?.selectedSkill
  ) return null;
  const target = stance.target || skill?.target || result?.target;
  if (!target) return null;
  return normalizeInteractionFailure({
    kind: skill?.kind || stance.kind || 'interaction',
    method: request.selectedSkill,
    material: typeof request.args?.[0] === 'string' ? request.args[0] : '',
    target,
    failureStage: stance.failureStage,
    candidateCount: stance.candidateCount,
  });
}

function exhaustiveBuilderPlacementFailure(order, result) {
  if (order?.role !== 'builder' || result?.phase === 'succeeded') return null;
  const failure = interactionFailureFromResult(result);
  const request = result?.evidence?.request;
  const args = request?.args;
  if (
    failure?.kind !== 'place'
    || failure.method !== '!placeBlockAt'
    || failure.failureStage !== 'no_legal_stance'
    || failure.candidateCount !== 0
    || !Array.isArray(args)
    || ![args[1], args[2], args[3]].every(Number.isFinite)
    || failure.target.x !== Math.floor(args[1])
    || failure.target.y !== Math.floor(args[2])
    || failure.target.z !== Math.floor(args[3])
    || failure.material !== args[0]
  ) return null;
  return failure;
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const target = (() => {
    try {
      return normalizeTarget(evidence.target);
    } catch {
      return null;
    }
  })();
  const interactionFailure = normalizeInteractionFailure(evidence.interactionFailure);
  const materialBlocker = normalizeMaterialBlocker(evidence.materialBlocker);
  return Object.freeze({
    code: boundedText(evidence.code, 80),
    detail: boundedText(evidence.detail, 280),
    actionId: boundedText(evidence.actionId, 96),
    ...(target ? { target } : {}),
    ...(interactionFailure ? { interactionFailure } : {}),
    ...(materialBlocker ? { materialBlocker } : {}),
    ...(boundedText(evidence.continuationKind, 40)
      ? { continuationKind: boundedText(evidence.continuationKind, 40) }
      : {}),
    ...(evidence.inconclusive === true ? { inconclusive: true } : {}),
  });
}

function actionResultEvidence(result) {
  const inconclusive = result?.inconclusive === true
    || result?.evidence?.skill?.inconclusive === true
    || result?.evidence?.capability?.bindingReport?.inconclusive === true;
  return {
    code: result?.code,
    detail: result?.detail,
    actionId: result?.actionId,
    target: result?.evidence?.skill?.target || result?.target || null,
    interactionFailure: interactionFailureFromResult(result),
    materialBlocker: materialBlockerFromResult(result),
    continuationKind: result?.continuation?.kind,
    ...(inconclusive ? { inconclusive: true } : {}),
  };
}

export function normalizeWorkOrder(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Work order must be an object.');
  }
  let requester;
  try {
    requester = boundedText(raw.requester, 32);
  } catch {
    throw new TypeError('Work-order requester is invalid.');
  }
  if (!SAFE_REQUESTER.test(requester)) throw new TypeError('Work-order requester is invalid.');
  const id = boundedText(raw.id, 96);
  if (!SAFE_ID.test(id)) throw new TypeError('Work-order id is invalid.');
  const role = boundedText(raw.role, 24);
  if (!ROLES.has(role)) throw new TypeError('Work-order role is invalid.');
  const kind = boundedText(raw.kind, 32);
  if (!KINDS.has(kind)) throw new TypeError('Work-order kind is invalid.');
  const source = boundedText(raw.source || 'role', 24);
  if (!SOURCES.has(source)) throw new TypeError('Work-order source is invalid.');
  const phase = boundedText(raw.phase || 'assess', 24);
  if (!PHASES.has(phase)) throw new TypeError('Work-order phase is invalid.');
  const resumePhase = raw.resumePhase == null ? null : boundedText(raw.resumePhase, 24);
  if (resumePhase !== null && !PHASES.has(resumePhase)) throw new TypeError('Resume phase is invalid.');
  const quota = finiteInteger(raw.quota, 1, 1, 2304);
  const attempts = finiteInteger(raw.attempts, 0, 0, 32);
  const maxAttempts = finiteInteger(raw.maxAttempts, 3, 1, 8);
  const recoveries = finiteInteger(raw.recoveries, 0, 0, 32);
  const maxRecoveries = finiteInteger(raw.maxRecoveries, DEFAULT_MAX_RECOVERIES, 1, 24);
  const preemptions = finiteInteger(raw.preemptions, 0, 0, MAX_PREEMPTIONS);
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return Object.freeze({
    id,
    role,
    kind,
    source,
    requester,
    target: normalizeTarget(raw.target),
    constraints: normalizeConstraints(raw.constraints),
    quota,
    blueprint: normalizeBlueprint(raw.blueprint),
    phase,
    resumePhase,
    attempts,
    maxAttempts,
    recoveries,
    maxRecoveries,
    preemptions,
    anchor: normalizeAnchor(raw.anchor),
    checkpoint: normalizeCheckpoint(raw.checkpoint),
    evidence: normalizeEvidence(raw.evidence),
    createdAt,
    updatedAt,
  });
}

export function createWorkOrder(input = {}) {
  return normalizeWorkOrder({
    id: input.id || `${input.role || 'job'}-${randomUUID()}`,
    phase: 'assess',
    attempts: 0,
    maxAttempts: 3,
    recoveries: 0,
    maxRecoveries: DEFAULT_MAX_RECOVERIES,
    source: 'role',
    requester: '',
    checkpoint: {},
    ...input,
  });
}

function collectionTargetFamily(name) {
  const canonical = boundedText(name, 64);
  return canonical.startsWith('deepslate_') ? canonical.slice('deepslate_'.length) : canonical;
}

export function workOrderCollectionExclusions(order, requestedName = null) {
  const requestedFamily = collectionTargetFamily(requestedName);
  const targets = (order?.checkpoint?.failedTargets || [])
    .filter(target => [target?.x, target?.y, target?.z].every(Number.isFinite))
    .filter(target => !requestedFamily || collectionTargetFamily(target.name) === requestedFamily);
  // One rejected block excludes its compact vein. Two repeat rejections are
  // evidence that the local approach/region is unsuitable only when their
  // coordinates actually describe the same local region. A global count of
  // unrelated failures must not inflate every old point until their zones
  // erase an otherwise usable forest or ore field.
  return targets.map((target, index) => {
    const repeatedLocalFailure = targets.slice(0, index).some(previous => (
      previous.name === target.name
      && Math.max(
        Math.abs(previous.x - target.x),
        Math.abs(previous.y - target.y),
        Math.abs(previous.z - target.z),
      ) <= 8
    ));
    return {
      name: target.name,
      x: Math.floor(target.x),
      y: Math.floor(target.y),
      z: Math.floor(target.z),
      radius: repeatedLocalFailure ? 16 : 4,
    };
  });
}

export function workOrderProtectedRegionExclusion(order) {
  const home = order?.target;
  if (
    order?.kind !== 'explore'
    || ['complete', 'failed', 'cancelled'].includes(order?.phase)
    || ![home?.x, home?.y, home?.z].every(Number.isFinite)
  ) return null;
  return Object.freeze({
    x: Math.floor(home.x),
    y: Math.floor(home.y),
    z: Math.floor(home.z),
    radius: 12,
  });
}

export function advanceWorkOrder(order, result, {
  previousActionId = null,
  nextPhase = null,
  failedMethod = null,
  failedTarget = null,
  failedTargets = null,
  recoveryAction = false,
  safetySuspended = false,
  now = Date.now(),
} = {}) {
  const current = normalizeWorkOrder(order);
  const {
    miningSearchNoProgress: _clearedMiningSearchNoProgress,
    ...checkpointAfterVerifiedProgress
  } = current.checkpoint;
  const verifiedProgressCheckpoint = checkpointWithVerifiedMiningRoute(
    result,
    result?.phase === 'succeeded' ? checkpointAfterVerifiedProgress : current.checkpoint,
  );
  const miningNoProgress = miningSearchNoProgressCheckpoint(result);
  const failedCheckpoint = miningNoProgress
    ? normalizeCheckpoint({
        ...current.checkpoint,
        miningSearchNoProgress: miningNoProgress,
      })
    : current.checkpoint;
  // A failed action selected while already recovering still belongs to the
  // original productive phase. Pointing recovery back at `recover` erases
  // that continuation and lets reducers skip required preparation forever.
  const recoveryResumePhase = current.phase === 'recover'
    ? (current.resumePhase || 'assess')
    : current.phase;
  if (!result?.actionId || result.actionId === previousActionId) return current;
  const navigationRecoveryCheckpoint = checkpointWithNavigationStepExclusion(
    result,
    current.checkpoint,
  );
  if (safetySuspended === true) {
    return normalizeWorkOrder({
      ...current,
      evidence: {
        actionId: result.actionId,
        phase: 'interrupted',
        code: 'safety_suspended',
        detail: result.detail || 'Survival took exclusive control; the work order remains at its current phase.',
      },
      // Unlike generic repeated preemption, a named Safety incident has an
      // owning terminal condition. It therefore spends neither productive nor
      // anti-spin budgets; the arbiter releases this same order when safe.
      updatedAt: now,
    });
  }
  const dryRouteMethodRejected = (
    recoveryAction === true
    && current.checkpoint?.worksiteReturnPending === true
    && current.checkpoint?.worksiteReturnDryOnly === true
    && result?.phase === 'failed'
    && result?.evidence?.skill?.kind === 'movement'
    && result.evidence.skill.outcome === 'segmented_journey_no_safe_waypoint'
  );
  if (dryRouteMethodRejected) {
    const {
      worksiteReturnDryOnly: _rejectedDryRoute,
      ...checkpoint
    } = navigationRecoveryCheckpoint;
    // Drowning makes dry travel the first recovery method, not a permanent
    // declaration that swimming is forbidden everywhere. Once Pathfinder has
    // proved there is no supported dry waypoint from this settled stance, retire
    // only that method and continue ordinary progressive travel under Safety.
    return normalizeWorkOrder({
      ...current,
      phase: 'recover',
      resumePhase: recoveryResumePhase,
      recoveries: 0,
      checkpoint,
      evidence: {
        code: 'dry_route_method_rejected',
        detail: 'No supported dry waypoint exists from the settled stance; continuing with ordinary progressive navigation under Safety supervision.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  const surfaceRecovery = surfaceRecoveryObservation(result);
  if (surfaceRecovery?.reached && nextPhase && PHASES.has(nextPhase)) {
    // Reaching the surface satisfies a physical access prerequisite; it is not
    // productive work on the requested build/mine/harvest outcome. Preserve
    // both budgets until a later material or blueprint action verifies real
    // output, while allowing the planner to clear the access requirement.
    return normalizeWorkOrder({
      ...current,
      phase: nextPhase,
      evidence: actionResultEvidence(result),
      updatedAt: now,
    });
  }
  if (surfaceRecovery && result.retryable === true) {
    if (surfaceRecovery.progressed) {
      // A bounded ascent may stop before its full surface-access effect while
      // still ending higher on verified support. Rebind from that checkpoint
      // without pretending the effect completed or charging either budget.
      return normalizeWorkOrder({
        ...current,
        evidence: {
          code: 'capability_verified_partial_progress',
          detail: result.detail || 'Surface recovery advanced to a higher supported stance.',
          actionId: result.actionId,
        },
        updatedAt: now,
      });
    }
    if (current.recoveries < current.maxRecoveries) {
      // Surface navigation is bounded recovery, never a failed attempt at the
      // player's requested production. No-progress legs spend only the
      // recovery ceiling and re-derive the same access step from fresh state.
      return normalizeWorkOrder({
        ...current,
        recoveries: current.recoveries + 1,
        evidence: actionResultEvidence(result),
        updatedAt: now,
      });
    }
    return normalizeWorkOrder({
      ...current,
      phase: 'failed',
      resumePhase: null,
      evidence: {
        code: 'surface_recovery_exhausted',
        detail: result.detail || 'Surface access remained unavailable after bounded recovery.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  if (result.phase === 'succeeded' && nextPhase && PHASES.has(nextPhase)) {
    return normalizeWorkOrder({
      ...current,
      phase: nextPhase,
      resumePhase: null,
      checkpoint: verifiedProgressCheckpoint,
      // Verified progress clears the preemption budget. A long job should not
      // be killed by interruptions or failures accumulated across work it
      // already finished.
      preemptions: 0,
      attempts: 0,
      recoveries: 0,
      evidence: actionResultEvidence(result),
      updatedAt: now,
    });
  }
  const continuationKind = result?.continuation?.kind || null;
  if (['resume_same', 'disengage_then_resume'].includes(continuationKind)) {
    return normalizeWorkOrder({
      ...current,
      preemptions: isPreemption(result)
        ? Math.min(MAX_PREEMPTIONS, current.preemptions + 1)
        : current.preemptions,
      evidence: actionResultEvidence(result),
      updatedAt: now,
    });
  }
  if (continuationKind === 'retry_after_material_change') {
    return normalizeWorkOrder({
      ...current,
      evidence: actionResultEvidence(result),
      updatedAt: now,
    });
  }
  const exhaustivePlacementFailure = exhaustiveBuilderPlacementFailure(current, result);
  if (exhaustivePlacementFailure) {
    return normalizeWorkOrder({
      ...current,
      phase: 'failed',
      resumePhase: null,
      evidence: {
        ...actionResultEvidence(result),
        code: 'builder_placement_no_legal_stance',
        detail: `No legal placement stance exists for ${exhaustivePlacementFailure.material || 'the selected block'} at ${exhaustivePlacementFailure.target.x},${exhaustivePlacementFailure.target.y},${exhaustivePlacementFailure.target.z}; the unchanged Builder action will not be redispatched.`,
      },
      updatedAt: now,
    });
  }
  if (isPreemption(result) && current.preemptions < MAX_PREEMPTIONS) {
    // Hold the phase and the attempt budget. The next tick re-derives the same
    // step against fresh world state, which is what "resume what I was doing"
    // actually means.
    return normalizeWorkOrder({
      ...current,
      preemptions: current.preemptions + 1,
      evidence: {
        code: 'preempted',
        detail: result.detail || 'A higher-priority lane took ownership; the work order is unchanged.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  const capacityBlocked = result.code === 'inventory_capacity_blocked'
    || result.code === 'skill_no_safe_release'
    || (
      result.evidence?.skill?.kind === 'inventory_capacity'
      && result.evidence.skill.outcome === 'no_safe_release'
    );
  if (capacityBlocked) {
    // Working capacity is a physical precondition, not a failed attempt at
    // the requested build/mine/craft operation. Repeating the same release
    // policy cannot improve the inventory and must not spend the productive
    // work-order budget or trigger relocation.
    return normalizeWorkOrder({
      ...current,
      phase: 'failed',
      resumePhase: null,
      evidence: {
        code: 'inventory_capacity_blocked',
        detail: result.detail || 'No safe working inventory slot can be released.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  const movementRecovery = recoveryAction
    ? movementRecoveryObservation(result)
    : null;
  if (movementRecovery?.progressed) {
    // A recovery route that times out after materially converging is an
    // unfinished recovery leg, not a failed recovery decision. Rebind the
    // same owner from the newly occupied supported stance. Recovery limits
    // bound consecutive failures at one frontier, not the lifetime of a long
    // productive journey, so verified progress opens a fresh bounded segment.
    return normalizeWorkOrder({
      ...current,
      phase: 'recover',
      resumePhase: recoveryResumePhase,
      recoveries: 0,
      checkpoint: navigationRecoveryCheckpoint,
      evidence: {
        code: 'capability_verified_partial_progress',
        detail: result.detail || `Recovery movement advanced ${movementRecovery.displacement.toFixed(2)} blocks toward its bound target.`,
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  if (recoveryAction && result.retryable === true) {
    if (current.recoveries < current.maxRecoveries) {
      return normalizeWorkOrder({
        ...current,
        phase: 'recover',
        resumePhase: recoveryResumePhase,
        recoveries: current.recoveries + 1,
        checkpoint: navigationRecoveryCheckpoint,
        evidence: actionResultEvidence(result),
        updatedAt: now,
      });
    }
    return normalizeWorkOrder({
      ...current,
      phase: 'failed',
      resumePhase: null,
      checkpoint: navigationRecoveryCheckpoint,
      evidence: {
        code: 'recovery_action_exhausted',
        detail: result.detail || 'The bounded recovery action made no verified progress.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  const incomingFailedTargets = normalizeCheckpoint({
    failedTargets: Array.isArray(failedTargets)
      ? failedTargets
      : failedTarget && typeof failedTarget === 'object'
        ? [failedTarget]
        : [],
  }).failedTargets || [];
  const prerequisiteCheckpoint = discoveredPrerequisiteCheckpoint(result, current.checkpoint);
  const recoveryCheckpoint = prerequisiteCheckpoint || failedCheckpoint;
  if (result.retryable === true && incomingFailedTargets.length > 0) {
    if (current.recoveries < current.maxRecoveries) {
      const method = boundedText(failedMethod, 160);
      const sourceFailureCounts = new Map();
      for (const previous of current.checkpoint.failedTargets || []) {
        const key = physicalTargetKey(previous);
        if (!key) continue;
        sourceFailureCounts.set(key, (sourceFailureCounts.get(key) || 0) + 1);
      }
      let repeatedSourceFailure = false;
      for (const target of incomingFailedTargets) {
        const key = physicalTargetKey(target);
        if (!key) continue;
        const priorCount = sourceFailureCounts.get(key) || 0;
        if (priorCount >= 1) repeatedSourceFailure = true;
        sourceFailureCounts.set(key, priorCount + 1);
      }
      // One action may report several distinct blocks of the same type. Keep
      // each as a concrete exclusion; only failure at the exact same physical
      // coordinate again is evidence that target ranking cannot recover this
      // acquisition strategy.
      const failedMethods = method && repeatedSourceFailure
        ? [...new Set([
            ...(current.checkpoint.failedMethods || []),
            acquisitionStrategyFailureKey(method),
          ])].slice(-MAX_FAILED_METHODS)
        : current.checkpoint.failedMethods;
      return normalizeWorkOrder({
        ...current,
        phase: 'recover',
        resumePhase: recoveryResumePhase,
        recoveries: current.recoveries + 1,
        checkpoint: {
          ...recoveryCheckpoint,
          failedTargets: [
            ...(current.checkpoint.failedTargets || []),
            ...incomingFailedTargets,
          ].slice(-MAX_FAILED_TARGETS),
          lastFailedTargetActionId: result.actionId,
          ...(failedMethods ? { failedMethods } : {}),
        },
        evidence: actionResultEvidence(result),
        updatedAt: now,
      });
    }
    // A bounded target-recovery budget is independent of the productive
    // method budget. Exhausting it fails truthfully; it must not silently
    // convert candidate rejections into productive attempts.
    return normalizeWorkOrder({
      ...current,
      phase: 'failed',
      resumePhase: null,
      evidence: {
        code: 'target_recovery_exhausted',
        detail: result.detail || 'Concrete acquisition targets remained unsafe after bounded recovery.',
        actionId: result.actionId,
      },
      updatedAt: now,
    });
  }
  if (result.retryable === true && prerequisiteCheckpoint) {
    // A newly discovered physical prerequisite is planning information, not a
    // failed attempt at the selected acquisition method. Persist it before the
    // next reducer pass so restart cannot lose the replacement requirement,
    // and preserve both productive and target-recovery budgets when no
    // independently verified target-local failure accompanied it.
    return normalizeWorkOrder({
      ...current,
      phase: 'recover',
      resumePhase: recoveryResumePhase,
      checkpoint: prerequisiteCheckpoint,
      evidence: actionResultEvidence(result),
      updatedAt: now,
    });
  }
  if (result.retryable === true && current.attempts < current.maxAttempts) {
    const method = boundedText(failedMethod, 160);
    const failedMethods = method
      ? [...new Set([...(current.checkpoint.failedMethods || []), method])].slice(-MAX_FAILED_METHODS)
      : current.checkpoint.failedMethods;
    return normalizeWorkOrder({
      ...current,
      phase: 'recover',
      resumePhase: recoveryResumePhase,
      attempts: current.attempts + 1,
      checkpoint: {
        ...failedCheckpoint,
        ...(failedMethods ? { failedMethods } : {}),
      },
      evidence: actionResultEvidence(result),
      updatedAt: now,
    });
  }
  return normalizeWorkOrder({
    ...current,
    phase: 'failed',
    resumePhase: null,
    evidence: actionResultEvidence(result),
    updatedAt: now,
  });
}

export function reconcileWorkOrder(order, currentSnapshot = {}, now = Date.now()) {
  const current = normalizeWorkOrder(order);
  if (['complete', 'failed', 'cancelled'].includes(current.phase)) return current;
  const detail = `Restart revalidation required at ${boundedText(JSON.stringify({
    inventory: currentSnapshot.inventory || {},
    position: currentSnapshot.position || null,
  }), 180)}`;
  return normalizeWorkOrder({
    ...current,
    phase: 'assess',
    resumePhase: current.phase === 'assess' ? current.resumePhase : current.phase,
    evidence: { code: 'restart_revalidation', detail, actionId: '' },
    updatedAt: now,
  });
}

export function resumeFailedWorkOrder(order, now = Date.now(), { allowAutomatic = false } = {}) {
  const current = normalizeWorkOrder(order);
  if (
    current.phase !== 'failed'
    || (current.source !== 'player' && allowAutomatic !== true)
  ) return current;
  const {
    caveSearchRelocations: _caveSearchRelocations,
    miningRegionRelocations: _miningRegionRelocations,
    corridorSearchLegs: _corridorSearchLegs,
    miningRelocationPending: _miningRelocationPending,
    lastFailedTargetActionId: _lastFailedTargetActionId,
    failedMethods: _failedMethods,
    miningSearchNoProgress: _miningSearchNoProgress,
    ...checkpoint
  } = current.checkpoint;
  return normalizeWorkOrder({
    ...current,
    phase: 'assess',
    resumePhase: null,
    attempts: 0,
    recoveries: 0,
    preemptions: 0,
    // An explicit player resume is a new bounded attempt against freshly
    // audited Minecraft state. Preserve verified outputs, baselines, exact
    // failed targets, and the physical return route, but re-arm method and
    // region-exhaustion budgets. Those counters describe the retired tactic,
    // not player-visible progress; keeping them can terminalize the repaired
    // executor before it receives one fresh bounded attempt.
    checkpoint,
    evidence: {
      code: current.source === 'player' ? 'player_resume_requested' : 'operator_resume_requested',
      detail: current.source === 'player'
        ? 'The player explicitly resumed this exact failed work order; Minecraft state must be reassessed before execution.'
        : 'The operator explicitly resumed this exact failed automatic work order after repairing its blocker; Minecraft state must be reassessed before execution.',
      actionId: '',
    },
    updatedAt: now,
  });
}
