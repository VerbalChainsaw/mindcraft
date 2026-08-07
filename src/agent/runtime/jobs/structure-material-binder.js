import Vec3 from 'vec3';

import {
  entityHarvestSearchCost,
  entityHarvestSources,
  entityMatchesHarvestSource,
} from '../../../utils/entity-harvest-semantics.js';
import { buildPrerequisitePlan } from '../prerequisite-planner.js';
import { createWorkOrder } from '../work-order.js';

const LOCAL_BIND_RANGE = 16;

const FAMILY_DEFAULTS = Object.freeze({
  oak_door: Object.freeze({
    family: 'wooden_door',
    suffix: '_door',
    accepts: ingredients => ingredients.length > 0 && ingredients.every(name => name.endsWith('_planks')),
  }),
  oak_fence: Object.freeze({
    family: 'wooden_fence',
    suffix: '_fence',
    accepts: ingredients => (
      ingredients.some(name => name.endsWith('_planks'))
      && ingredients.every(name => name === 'stick' || name.endsWith('_planks'))
    ),
  }),
  oak_fence_gate: Object.freeze({
    family: 'wooden_fence_gate',
    suffix: '_fence_gate',
    accepts: ingredients => (
      ingredients.some(name => name.endsWith('_planks'))
      && ingredients.every(name => name === 'stick' || name.endsWith('_planks'))
    ),
  }),
  red_bed: Object.freeze({
    family: 'bed',
    suffix: '_bed',
    accepts: ingredients => (
      ingredients.some(name => name.endsWith('_planks'))
      && ingredients.some(name => name.endsWith('_wool'))
      && ingredients.every(name => name.endsWith('_planks') || name.endsWith('_wool'))
    ),
  }),
});

function inventoryCount(bot, name) {
  return (bot?.inventory?.items?.() || []).reduce((total, item) => (
    item?.name === name ? total + Math.max(0, Number(item.count) || 0) : total
  ), 0);
}

function recipeIngredientNames(registry, recipe) {
  const rawIngredients = recipe?.inShape
    ? recipe.inShape.flat()
    : Array.isArray(recipe?.ingredients)
      ? recipe.ingredients
      : [];
  return rawIngredients
    .filter(value => value != null)
    .map(value => typeof value === 'number' ? value : Number(value?.id))
    .map(id => registry?.items?.[id]?.name)
    .filter(Boolean);
}

function familyCandidates(bot, family) {
  const registry = bot?.registry;
  if (!registry) return [];
  return Object.values(registry.itemsByName || {})
    .map(item => item?.name)
    .filter(name => typeof name === 'string' && name.endsWith(family.suffix))
    .filter(name => Boolean(registry.blocksByName?.[name]))
    .filter(name => (registry.recipes?.[registry.itemsByName[name]?.id] || []).some(recipe => (
      family.accepts(recipeIngredientNames(registry, recipe))
    )))
    .sort();
}

function blockDistance(bot, block) {
  const origin = bot?.entity?.position;
  const position = block?.position;
  if (!origin || !position) return Number.POSITIVE_INFINITY;
  if (typeof origin.distanceTo === 'function') {
    const distance = Number(origin.distanceTo(position));
    return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
  }
  const values = [origin.x, origin.y, origin.z, position.x, position.y, position.z].map(Number);
  if (!values.every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.hypot(values[3] - values[0], values[4] - values[1], values[5] - values[2]);
}

function firstCollectionDistance(bot, plan) {
  for (const action of plan?.actions || []) {
    const sourceName = action.capability?.arguments?.source;
    if (action.kind === 'collect') {
      const block = bot?.registry?.blocksByName?.[sourceName];
      if (!block || typeof bot?.findBlock !== 'function') return Number.POSITIVE_INFINITY;
      try {
        return blockDistance(bot, bot.findBlock({ matching: block.id, maxDistance: LOCAL_BIND_RANGE }));
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    }
    if (action.kind === 'harvest_entity') {
      const source = entityHarvestSources(bot?.registry, action.target)
        .find(candidate => candidate.entity === sourceName);
      if (!source) return Number.POSITIVE_INFINITY;
      const entity = Object.values(bot?.entities || {})
        .filter(candidate => entityMatchesHarvestSource(candidate, source))
        .sort((left, right) => blockDistance(bot, left) - blockDistance(bot, right))[0];
      return blockDistance(bot, entity);
    }
  }
  return 0;
}

function planCost(bot, plan) {
  return (plan?.actions || []).reduce(
    (total, action) => {
      const base = Math.max(0, Number(action?.capability?.cost) || 0);
      if (action.kind !== 'harvest_entity') return total + base;
      const source = entityHarvestSources(bot?.registry, action.target)[0];
      return total + base + entityHarvestSearchCost(source);
    },
    0,
  );
}

function rankCandidate(bot, name, range, planItem, blockProximityCache) {
  const carried = inventoryCount(bot, name);
  const plan = planItem(bot, {
    target: name,
    quantity: carried + 1,
    completion: 'inventory',
    range,
    blockProximityCache,
  });
  if (!['complete', 'ready'].includes(plan?.status)) return null;
  const distance = firstCollectionDistance(bot, plan);
  return {
    name,
    carried,
    plan,
    distance,
    cost: planCost(bot, plan),
  };
}

function familyDefaultForCell(cell, rebindRest = false) {
  if (cell?.materialFamily) {
    if (rebindRest && cell.materialFamily === 'bed') return 'red_bed';
    return null;
  }
  if (cell?.material === 'oak_door' && cell.function === 'access') return 'oak_door';
  if (cell?.material === 'oak_fence' && cell.function === 'containment') return 'oak_fence';
  if (cell?.material === 'oak_fence_gate' && cell.function === 'access') return 'oak_fence_gate';
  if (cell?.material === 'red_bed' && cell.function === 'rest') return 'red_bed';
  return null;
}

function observedFamilyMaterial(bot, order, cells, candidates) {
  if (typeof bot?.blockAt !== 'function') return null;
  const allowed = new Set(candidates);
  for (const cell of cells) {
    try {
      const block = bot.blockAt(new Vec3(
        order.target.x + cell.x,
        order.target.y + cell.y,
        order.target.z + cell.z,
      ));
      if (allowed.has(block?.name)) return block.name;
    } catch {
      // An unloaded remembered site has no binding evidence. The planner below
      // keeps the prior concrete material unless it can prove a better local one.
    }
  }
  return null;
}

function selectFamilyMaterial(bot, order, material, cells, range, planItem, forcedMaterial = null) {
  const family = FAMILY_DEFAULTS[material];
  if (!family) return material;
  const candidates = familyCandidates(bot, family);
  const observed = observedFamilyMaterial(bot, order, cells, candidates);
  if (observed) return observed;
  if (forcedMaterial && candidates.includes(forcedMaterial)) return forcedMaterial;

  const blockProximityCache = new Map();
  const ranked = candidates
    .map(name => rankCandidate(bot, name, range, planItem, blockProximityCache))
    .filter(Boolean)
    .sort((left, right) => (
      right.carried - left.carried
      || Number.isFinite(right.distance) - Number.isFinite(left.distance)
      || left.plan.actions.length - right.plan.actions.length
      || left.cost - right.cost
      || left.distance - right.distance
      || left.name.localeCompare(right.name)
    ));
  return ranked[0]?.name || material;
}

/**
 * Resolve generic DSL/catalog fixture defaults once at the durable order
 * boundary. The persisted blueprint remains concrete, so restart, placement,
 * and Paper verification all agree on the exact selected block.
 */
export function bindStructureAccessoryMaterials(order, bot, {
  planItem = buildPrerequisitePlan,
  alternativeOutput = null,
} = {}) {
  if (!order?.blueprint?.cells?.length || !order?.target) return order;
  const range = Math.max(16, Math.min(512, Number(order.constraints?.maxDistance) || 64));
  const forcedBedMaterial = String(alternativeOutput || '').endsWith('_wool')
    ? `${String(alternativeOutput).slice(0, -'_wool'.length)}_bed`
    : null;
  const rebindRest = Boolean(forcedBedMaterial);
  const grouped = new Map();
  for (const cell of order.blueprint.cells) {
    const familyDefault = familyDefaultForCell(cell, rebindRest);
    if (!familyDefault) continue;
    if (!grouped.has(familyDefault)) grouped.set(familyDefault, []);
    grouped.get(familyDefault).push(cell);
  }
  if (grouped.size === 0) return order;

  const bindings = new Map();
  for (const [material, cells] of grouped) {
    bindings.set(material, selectFamilyMaterial(
      bot,
      order,
      material,
      cells,
      range,
      planItem,
      material === 'red_bed' ? forcedBedMaterial : null,
    ));
  }
  const reboundCells = order.blueprint.cells.map(cell => {
    const familyDefault = familyDefaultForCell(cell, rebindRest);
    return {
      ...cell,
      material: bindings.get(familyDefault) || cell.material,
      ...(familyDefault ? { materialFamily: FAMILY_DEFAULTS[familyDefault].family } : {}),
    };
  });
  const changed = reboundCells.some((cell, index) => (
    cell.material !== order.blueprint.cells[index].material
    || cell.materialFamily !== order.blueprint.cells[index].materialFamily
  ));
  if (!changed) return order;

  const reboundFixtures = (order.blueprint.fixtures || []).map(fixture => {
    const anchorCell = reboundCells.find(cell => cell.fixtureId === fixture.id);
    return anchorCell ? { ...fixture, material: anchorCell.material } : fixture;
  });

  return createWorkOrder({
    ...order,
    blueprint: {
      ...order.blueprint,
      cells: reboundCells,
      fixtures: reboundFixtures,
    },
    updatedAt: Date.now(),
  });
}
