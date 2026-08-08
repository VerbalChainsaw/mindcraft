import * as mc from '../../utils/mcdata.js';
import {
  entityHarvestAlternativeSearchCost,
  entityMatchesHarvestSource,
  entityHarvestSearchCost,
  entityHarvestSources,
} from '../../utils/entity-harvest-semantics.js';
import {
  createPlankFamilyRecipe,
  isPlankFamilyRecipe,
  plankRecipeAlternativeGroups,
} from '../../utils/recipe-families.js';
import { createCapabilityPlanAction } from './capability-catalogue.js';
import { completionRequirementSatisfied } from './goal-contract.js';

const DEFAULT_RANGE = 64;
const DEFAULT_MAX_DEPTH = 24;
const DEFAULT_MAX_NODES = 384;
const DEFAULT_MAX_ACTIONS = 64;
const PLANNER_PROXIMITY_RANGE = 16;
const TOOL_TIER = Object.freeze({
  wooden: 1,
  golden: 2,
  stone: 3,
  copper: 3.5,
  iron: 4,
  diamond: 5,
  netherite: 6,
});
function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function canonicalName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 80);
}

function itemName(bot, id) {
  return bot.registry?.items?.[Number(id)]?.name || mc.getItemName(Number(id)) || null;
}

function usableDurability(bot, item) {
  const max = Number(
    item?.maxDurability
    ?? bot.registry?.items?.[item?.type]?.maxDurability
    ?? bot.registry?.itemsByName?.[item?.name]?.maxDurability,
  );
  if (!Number.isFinite(max) || max <= 0) return Number.POSITIVE_INFINITY;
  const used = Math.max(0, Number(item?.durabilityUsed) || 0);
  const reserve = Math.max(16, Math.ceil(max * 0.1));
  return Math.max(0, max - used - reserve);
}

function usableDurableItemCount(bot, name, minimumUsableDurability) {
  const minimum = Math.max(1, Math.floor(Number(minimumUsableDurability) || 1));
  return (bot.inventory?.items?.() || []).reduce((total, item) => (
    item?.name === name && usableDurability(bot, item) >= minimum
      ? total + Math.max(0, Number(item.count) || 0)
      : total
  ), 0);
}

function inventoryLedger(bot) {
  const ledger = new Map();
  for (const item of bot.inventory?.items?.() || []) {
    const name = canonicalName(item?.name);
    if (!name) continue;
    ledger.set(name, (ledger.get(name) || 0) + Math.max(0, Number(item.count) || 0));
  }
  return ledger;
}

function ledgerCount(context, name) {
  return Math.max(0, Number(context.ledger.get(name)) || 0);
}

function setLedgerCount(context, name, count) {
  context.ledger.set(name, Math.max(0, Math.floor(Number(count) || 0)));
}

function cloneContext(context) {
  return {
    ...context,
    ledger: new Map(context.ledger),
    actions: context.actions.slice(),
  };
}

function acceptContext(target, candidate) {
  target.ledger = candidate.ledger;
  target.actions = candidate.actions;
}

function learnedPreference(context, learningKey) {
  if (!learningKey || typeof context.experience !== 'function') return 0;
  try {
    return Math.max(-12, Math.min(12, Number(context.experience(learningKey)) || 0));
  } catch {
    return 0;
  }
}

function methodExcluded(context, learningKey) {
  return Boolean(learningKey && context.excludedMethods.has(learningKey));
}

function isLog(name) {
  return /_(?:log|stem)$/.test(name);
}

function fuelOutput(name) {
  return mc.getFuelSmeltOutput(name);
}

export function plannedInventoryCount(bot, name, family = null) {
  const items = Array.isArray(bot.inventory?.slots)
    ? bot.inventory.slots.filter(Boolean)
    : bot.inventory?.items?.() || [];
  if (family === 'logs') {
    return items.reduce((total, item) => total + (isLog(String(item?.name || '')) ? Math.max(0, Number(item.count) || 0) : 0), 0);
  }
  if (family === 'planks') {
    return items.reduce((total, item) => total + (String(item?.name || '').endsWith('_planks') ? Math.max(0, Number(item.count) || 0) : 0), 0);
  }
  return items.reduce((total, item) => total + (item?.name === name ? Math.max(0, Number(item.count) || 0) : 0), 0);
}

function addAction(context, action) {
  if (context.actions.length >= context.maxActions) {
    return blocked('planner_action_budget', `The causal plan exceeded its ${context.maxActions}-action budget.`, action.target, action.trail);
  }
  const hasExpectedName = Object.hasOwn(action, 'expectedName');
  const expectedName = hasExpectedName ? action.expectedName : action.target;
  context.actions.push(Object.freeze({
    kind: action.kind,
    capability: action.capability,
    target: action.target,
    expectedName: expectedName || null,
    expectedFamily: action.expectedFamily || null,
    expectedIncrease: expectedName
      ? Math.max(1, Math.floor(Number(action.expectedIncrease) || 1))
      : 0,
    reason: String(action.reason || '').slice(0, 280),
    trail: Object.freeze((action.trail || []).slice(0, 24)),
    learningKey: String(action.learningKey || '').slice(0, 160) || null,
    learnedPreference: learnedPreference(context, action.learningKey),
  }));
  return null;
}

function addCapabilityAction(bot, context, capabilityId, args, metadata) {
  try {
    return addAction(context, createCapabilityPlanAction(
      capabilityId,
      args,
      metadata,
      { bot, inventory: context.ledger },
    ));
  } catch (error) {
    return blocked(
      'capability_binding_failed',
      error?.message || `The planner could not bind capability ${capabilityId}.`,
      metadata.target,
      metadata.trail,
    );
  }
}

function blocked(code, detail, target, trail = []) {
  return Object.freeze({
    ok: false,
    code,
    detail: String(detail || '').slice(0, 360),
    target: canonicalName(target),
    trail: Object.freeze(trail.slice(0, 24)),
  });
}

function enterNode(context, target, trail) {
  context.budget.nodes += 1;
  if (context.budget.nodes > context.maxNodes) {
    return blocked('planner_node_budget', `The causal search exceeded its ${context.maxNodes}-node budget.`, target, trail);
  }
  if (trail.length > context.maxDepth) {
    return blocked('planner_depth_budget', `The prerequisite chain exceeded its ${context.maxDepth}-step depth budget.`, target, trail);
  }
  if (trail.includes(target)) {
    return blocked('planner_cycle', `The connected registry produced a prerequisite cycle at ${target}.`, target, [...trail, target]);
  }
  return null;
}

function recipeIngredientEntries(bot, recipe) {
  const entries = recipe?.inShape
    ? recipe.inShape.flat()
    : Array.isArray(recipe?.ingredients)
      ? recipe.ingredients
      : [];
  const ingredients = new Map();
  for (const raw of entries) {
    if (raw == null) continue;
    const id = typeof raw === 'number' ? raw : Number(raw?.id);
    const name = itemName(bot, id);
    if (!name) continue;
    const count = typeof raw === 'number' ? 1 : Math.max(1, Math.abs(Number(raw?.count) || 1));
    ingredients.set(name, (ingredients.get(name) || 0) + count);
  }
  return [...ingredients.entries()].map(([name, count]) => ({ name, count }));
}

function planningRecipeIngredientEntries(bot, recipe) {
  const ingredients = recipeIngredientEntries(bot, recipe);
  if (!isPlankFamilyRecipe(recipe)) return ingredients;
  return [
    ...ingredients.filter(ingredient => !ingredient.name.endsWith('_planks')),
    {
      name: 'planks',
      count: Math.max(1, Number(recipe.mindcraftIngredientFamily.count) || 1),
      family: 'planks',
      members: [...(recipe.mindcraftIngredientFamily.members || [])],
    },
  ];
}

function ledgerFamilyCount(context, family) {
  if (family !== 'planks') return 0;
  return [...context.ledger.entries()].reduce((total, [name, count]) => (
    name.endsWith('_planks') ? total + Math.max(0, Number(count) || 0) : total
  ), 0);
}

function consumeLedgerFamily(context, family, amount) {
  let remaining = Math.max(0, Number(amount) || 0);
  if (family !== 'planks') return false;
  const members = [...context.ledger.entries()]
    .filter(([name, count]) => name.endsWith('_planks') && Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]));
  if (members.reduce((total, [, count]) => total + Number(count), 0) < remaining) return false;
  for (const [name, count] of members) {
    if (remaining <= 0) break;
    const used = Math.min(Number(count), remaining);
    setLedgerCount(context, name, Number(count) - used);
    remaining -= used;
  }
  return remaining === 0;
}

function ensureLedgerFamily(bot, context, ingredient, amount, trail) {
  if (ledgerFamilyCount(context, ingredient.family) >= amount) {
    return consumeLedgerFamily(context, ingredient.family, amount)
      ? null
      : blocked(
          'missing_recipe_family',
          `${trail.at(-1)} requires ${amount} interchangeable ${ingredient.family}.`,
          trail.at(-1),
          trail,
        );
  }
  if (ingredient.family !== 'planks') {
    return blocked(
      'missing_recipe_family',
      `${trail.at(-1)} requires ${amount} interchangeable ${ingredient.family}.`,
      trail.at(-1),
      trail,
    );
  }

  const missing = amount - ledgerFamilyCount(context, ingredient.family);
  const baselineActionCount = context.actions.length;
  const baselineLedger = new Map(context.ledger);
  const rankedMembers = [...new Set(ingredient.members || [])]
    .filter(name => Boolean(bot.registry?.itemsByName?.[name]))
    .sort((left, right) => (
      (ledgerCount(context, right) + immediateCarriedProduction(bot, context, right))
        - (ledgerCount(context, left) + immediateCarriedProduction(bot, context, left))
      || left.localeCompare(right)
    ));
  const materiallyGrounded = rankedMembers.filter(name => (
    hasCarriedProductionPath(bot, context, name)
  ));
  const members = (materiallyGrounded.length > 0 ? materiallyGrounded : rankedMembers).slice(0, 4);
  const candidates = [];
  for (const member of members) {
    const candidate = cloneContext(context);
    const requiredMemberCount = ledgerCount(candidate, member) + missing;
    const failure = ensureItem(
      bot,
      candidate,
      member,
      requiredMemberCount,
      [...trail, `${ingredient.family}:${member}`],
    );
    if (failure || !consumeLedgerFamily(candidate, ingredient.family, amount)) continue;
    candidates.push({ kind: 'recipe', member, candidate });
  }
  candidates.sort((left, right) => (
    compareDerivedPlans(left, right, baselineActionCount, baselineLedger)
    || left.member.localeCompare(right.member)
  ));
  if (candidates.length === 0) {
    return blocked(
      'missing_recipe_family',
      `${trail.at(-1)} requires ${amount} interchangeable ${ingredient.family}, and no bounded member plan succeeded.`,
      trail.at(-1),
      trail,
    );
  }
  acceptContext(context, candidates[0].candidate);
  return null;
}

function recipeOutputCount(recipe) {
  return Math.max(1, Math.floor(Number(recipe?.result?.count) || 1));
}

function connectedRecipes(bot, target) {
  const itemId = bot.registry?.itemsByName?.[target]?.id;
  const registryRecipes = Number.isInteger(itemId)
    ? (bot.registry?.recipes?.[itemId] || []).slice()
    : [];
  if (!target.endsWith('_wool')) return registryRecipes;

  const dyeName = `${target.slice(0, -'_wool'.length)}_dye`;
  const dye = bot.registry?.itemsByName?.[dyeName];
  const exposesWoolRecolor = dye && registryRecipes.some(recipe => {
    const ingredients = recipeIngredientEntries(bot, recipe);
    return ingredients.some(ingredient => ingredient.name === dyeName)
      && ingredients.some(ingredient => ingredient.name.endsWith('_wool'));
  });
  if (!exposesWoolRecolor) return registryRecipes;

  // minecraft-data flattens the vanilla wool tag in dye recipes to one
  // representative colour. Expand that connected-registry family so the
  // planner can rank every registered wool input instead of following an
  // arbitrary colour-to-colour cycle.
  const seen = new Set(registryRecipes.map(recipe => (
    recipeIngredientEntries(bot, recipe)
      .map(ingredient => `${ingredient.count}x${ingredient.name}`)
      .sort()
      .join('+')
  )));
  const expanded = registryRecipes.slice();
  for (const wool of Object.values(bot.registry?.itemsByName || {})
    .filter(item => item?.name?.endsWith('_wool') && item.name !== target)
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const key = `1x${dyeName}+1x${wool.name}`.split('+').sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    expanded.push({
      ingredients: [{ id: dye.id, count: 1 }, { id: wool.id, count: 1 }],
      result: { id: itemId, count: 1 },
    });
  }
  return expanded;
}

function recipeNeedsTable(recipe) {
  if (Array.isArray(recipe?.inShape)) {
    const height = recipe.inShape.length;
    const width = recipe.inShape.reduce((maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0), 0);
    return height > 2 || width > 2;
  }
  return Array.isArray(recipe?.ingredients) && recipe.ingredients.filter(value => value != null).length > 4;
}

function plannerProximityRange(range) {
  return Math.max(4, Math.min(
    PLANNER_PROXIMITY_RANGE,
    Math.floor(Number(range) || PLANNER_PROXIMITY_RANGE),
  ));
}

function nearbyBlock(bot, name, range = PLANNER_PROXIMITY_RANGE, cache = null) {
  const boundedRange = plannerProximityRange(range);
  const cacheKey = `${name}:${boundedRange}`;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);
  const block = bot.registry?.blocksByName?.[name];
  if (!block || typeof bot.findBlock !== 'function') {
    cache?.set(cacheKey, null);
    return null;
  }
  try {
    const found = bot.findBlock({ matching: block.id, maxDistance: boundedRange }) || null;
    cache?.set(cacheKey, found);
    return found;
  } catch {
    cache?.set(cacheKey, null);
    return null;
  }
}

function sourceBlocks(bot, target) {
  const item = bot.registry?.itemsByName?.[target];
  if (!item) return [];
  const sources = [];
  for (const block of Object.values(bot.registry?.blocks || {})) {
    if (
      block?.diggable === true
      // Potted plants are player-placed decorations, not renewable world
      // sources. Treating them as generic acquisition leaves both threatens
      // structures and disguises one missing flower as a second strategy.
      && !String(block.name || '').startsWith('potted_')
      && Array.isArray(block.drops)
      && block.drops.includes(item.id)
    ) sources.push(block);
  }
  return sources;
}

function selfDroppingSourceIsGrounded(bot, context, source, target, trail) {
  if (source.name !== target) return true;
  // A root request may deliberately search for its named world block, and an
  // item with no recipe is a genuine collection leaf. Inside a recipe chain,
  // though, a craftable block that merely drops itself is not proof that the
  // block exists in the world. Require a real local observation before using
  // that placed-block shortcut; otherwise let the causal search try another
  // recipe or acquisition method.
  if (
    (context.allowUnobservedSelfDropRoot && trail.length <= 1)
    || connectedRecipes(bot, target).length === 0
  ) return true;
  return Boolean(nearbyBlock(
    bot,
    source.name,
    context.range,
    context.blockProximityCache,
  ));
}

function blockDistance(bot, block) {
  if (!block) return null;
  const origin = bot.entity?.position;
  const position = block?.position;
  if (!position) return 0;
  if (typeof origin?.distanceTo === 'function') {
    const distance = Number(origin.distanceTo(position));
    return Number.isFinite(distance) ? Math.max(0, distance) : null;
  }
  const coordinates = [origin?.x, origin?.y, origin?.z, position.x, position.y, position.z]
    .map(Number);
  if (!coordinates.every(Number.isFinite)) return null;
  const [originX, originY, originZ, targetX, targetY, targetZ] = coordinates;
  return Math.hypot(targetX - originX, targetY - originY, targetZ - originZ);
}

function nearestBlockDistance(bot, names, range, cache = null) {
  let nearest = null;
  for (const name of new Set(names)) {
    const distance = blockDistance(bot, nearbyBlock(bot, name, range, cache));
    if (!Number.isFinite(distance)) continue;
    nearest = nearest === null ? distance : Math.min(nearest, distance);
  }
  return nearest;
}

// Recipe alternatives often differ one level below their visible ingredient:
// sticks consume planks, while the physical choice is the log that can produce
// those planks. Rank that connected-registry source instead of hardcoding one
// wood species. The shallow bound keeps this a cheap hint; the real recursive
// planner still proves every prerequisite before accepting a candidate.
function acquisitionSourceDistance(bot, target, range, depth = 0, trail = [], blockCache = null) {
  if (depth > 2 || trail.includes(target)) return null;
  const nextTrail = [...trail, target];
  let nearest = nearestBlockDistance(bot, [
    target,
    ...sourceBlocks(bot, target).map(block => block.name),
  ], range, blockCache);
  if (depth === 2) return nearest;

  const consider = distance => {
    if (!Number.isFinite(distance)) return;
    nearest = nearest === null ? distance : Math.min(nearest, distance);
  };
  for (const smeltingInput of smeltingInputCandidates(bot, {
    ledger: new Map(),
    range,
    blockProximityCache: blockCache,
  }, target)) {
    consider(acquisitionSourceDistance(bot, smeltingInput, range, depth + 1, nextTrail, blockCache));
  }
  const itemId = bot.registry?.itemsByName?.[target]?.id;
  for (const recipe of connectedRecipes(bot, target).slice(0, 32)) {
    for (const ingredient of recipeIngredientEntries(bot, recipe)) {
      consider(acquisitionSourceDistance(bot, ingredient.name, range, depth + 1, nextTrail, blockCache));
    }
  }
  return nearest;
}

function sourceLearningKey(blockName, target) {
  return `collect:${canonicalName(blockName)}->${canonicalName(target)}`;
}

function sourceScore(context, block, target) {
  let score = 0;
  if (block.name === 'stone' || block.name === 'dirt' || block.name === 'sand') score += 20;
  if (!block.name.startsWith('deepslate_')) score += 5;
  if (block.name.endsWith('_ore')) score += 12;
  return score + learnedPreference(context, sourceLearningKey(block.name, target));
}

function recipeLearningKey(bot, target, recipe) {
  const ingredients = planningRecipeIngredientEntries(bot, recipe)
    .map(ingredient => `${ingredient.count}x${ingredient.name}`)
    .sort()
    .join('+');
  return `craft:${canonicalName(target)}<-${ingredients}`.slice(0, 160);
}

function recipeVariantInputs(bot, target, recipe) {
  const separator = target.lastIndexOf('_');
  if (separator < 1) return [];
  const suffix = target.slice(separator);
  return recipeIngredientEntries(bot, recipe)
    .filter(ingredient => (
      ingredient.name !== target
      && ingredient.name.endsWith(suffix)
    ));
}

function pruneUnboundVariantTransforms(bot, context, target, recipes) {
  const hasIndependentRecipe = recipes.some(recipe => recipeVariantInputs(bot, target, recipe).length === 0);
  const independentEntityHarvestAvailable = entityHarvestSources(bot.registry, target).length > 0;
  const carriedOrIndependent = recipes.filter(recipe => {
    const variants = recipeVariantInputs(bot, target, recipe);
    if (variants.length === 0) return true;
    return variants.some(ingredient => ledgerCount(context, ingredient.name) >= ingredient.count);
  });
  if (hasIndependentRecipe || context.allowEntityAlternatives) return carriedOrIndependent;
  if (!independentEntityHarvestAvailable) return recipes;
  if (carriedOrIndependent.length > 0) return carriedOrIndependent;

  // When the exact target has an entity-harvest method but no family
  // alternative may be rebound, retain one cheapest renewable transform (for
  // example common white wool plus dye for a rare colour). Expanding every
  // uncarried colour is combinatorial and cannot improve that decision.
  const renewable = recipes
    .map(recipe => ({
      recipe,
      cost: recipeVariantInputs(bot, target, recipe).reduce((best, ingredient) => (
        Math.min(
          best,
          ...entityHarvestSources(bot.registry, ingredient.name)
            .map(source => entityHarvestSearchCost(source)),
        )
      ), Number.POSITIVE_INFINITY),
    }))
    .filter(candidate => Number.isFinite(candidate.cost))
    .sort((left, right) => (
      left.cost - right.cost
      || recipeLearningKey(bot, target, left.recipe).localeCompare(
        recipeLearningKey(bot, target, right.recipe),
      )
    ));
  return renewable.length > 0 ? [renewable[0].recipe] : recipes;
}

function losslessReverseRecipeInput(bot, target, recipe) {
  const ingredients = recipeIngredientEntries(bot, recipe);
  if (ingredients.length !== 1) return null;
  const input = ingredients[0];
  const outputCount = recipeOutputCount(recipe);
  const reversible = connectedRecipes(bot, input.name).some(reverseRecipe => {
    const reverseIngredients = recipeIngredientEntries(bot, reverseRecipe);
    return reverseIngredients.length === 1
      && reverseIngredients[0].name === target
      && (outputCount * recipeOutputCount(reverseRecipe))
        === (input.count * reverseIngredients[0].count);
  });
  return reversible ? input : null;
}

function pruneUngroundedReversibleTransforms(bot, context, target, amount, recipes) {
  return recipes.filter(recipe => {
    const input = losslessReverseRecipeInput(bot, target, recipe);
    if (!input) return true;
    // Lossless compression/decompression is an inventory-normalization method,
    // not an acquisition source. It is useful when the compressed form is
    // already carried, but recursively crafting that input from the requested
    // output creates a causal loop (iron block <-> ingots, ingot <-> nuggets).
    const batches = Math.max(1, Math.ceil(amount / recipeOutputCount(recipe)));
    return ledgerCount(context, input.name) >= input.count * batches
      || Boolean(nearbyBlock(
        bot,
        input.name,
        context.range,
        context.blockProximityCache,
      ));
  });
}

// Rough per-unit cost of obtaining an item the bot does not have. Surface wood
// and stone are nearly free; anything that requires a deliberate underground
// search is not. Without this the planner treated every missing ingredient as
// equally cheap and would happily choose an iron recipe over a wooden one.
const ACQUISITION_COST = Object.freeze([
  Object.freeze({ cost: 1, pattern: /(?:_planks|_log|_stem|_wood|_hyphae|stick|dirt|sand|gravel|cobblestone|cobbled_deepslate|stone|netherrack|flint)$/ }),
  Object.freeze({ cost: 3, pattern: /(?:coal|charcoal|clay_ball|string|leather|feather|bone|wheat|seeds)$/ }),
  Object.freeze({ cost: 8, pattern: /(?:copper_ingot|raw_copper|quartz)$/ }),
  Object.freeze({ cost: 12, pattern: /(?:iron_ingot|raw_iron|redstone|lapis_lazuli)$/ }),
  Object.freeze({ cost: 16, pattern: /(?:gold_ingot|raw_gold|blaze_rod|ender_pearl)$/ }),
  Object.freeze({ cost: 40, pattern: /(?:diamond|emerald)$/ }),
  Object.freeze({ cost: 60, pattern: /(?:netherite_ingot|netherite_scrap|ancient_debris)$/ }),
]);
const DEFAULT_ACQUISITION_COST = 6;

function acquisitionCost(name) {
  for (const entry of ACQUISITION_COST) {
    if (entry.pattern.test(name)) return entry.cost;
  }
  return DEFAULT_ACQUISITION_COST;
}

function smeltingInputCandidates(bot, context, target) {
  return mc.getItemSmeltingIngredients(target)
    .filter(input => Boolean(bot.registry?.itemsByName?.[input]))
    .filter(input => {
      if (ledgerCount(context, input) > 0) return true;
      // Equipment-to-nugget recipes are salvage operations. They are useful
      // only for equipment already carried; planning and crafting fresh gear
      // merely to melt it is a causal loop disguised as a valid recipe.
      if (target.endsWith('_nugget')) return false;
      const block = bot.registry?.blocksByName?.[input];
      const item = bot.registry?.itemsByName?.[input];
      // Ore smelting recipes require the ore item itself (normally Silk Touch).
      // If ordinary mining cannot produce that item, it is not an acquisition
      // candidate unless the item is already in inventory.
      if (block && item && !block.drops?.includes(item.id)) return false;
      return true;
    })
    .sort((left, right) => {
      const carriedDifference = ledgerCount(context, right) - ledgerCount(context, left);
      if (carriedDifference !== 0) return carriedDifference;
      const leftDistance = nearestBlockDistance(bot, [
        left,
        ...sourceBlocks(bot, left).map(block => block.name),
      ], context.range, context.blockProximityCache);
      const rightDistance = nearestBlockDistance(bot, [
        right,
        ...sourceBlocks(bot, right).map(block => block.name),
      ], context.range, context.blockProximityCache);
      if (Number.isFinite(leftDistance) || Number.isFinite(rightDistance)) {
        if (!Number.isFinite(leftDistance)) return 1;
        if (!Number.isFinite(rightDistance)) return -1;
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      }
      return acquisitionCost(left) - acquisitionCost(right) || left.localeCompare(right);
    });
}

// Recipe ranking is only a hint, but it must value material already carried
// one deterministic transform upstream. Otherwise one acacia plank beats an
// oak log that can immediately produce four planks, and the accepted plan
// searches for a tree that is not present. Recursive ensureItem() still proves
// the chosen chain; this bounded look-through only ranks equivalent recipes.
function immediateCarriedProduction(bot, context, target) {
  const itemId = bot.registry?.itemsByName?.[target]?.id;
  if (!Number.isInteger(itemId)) return 0;
  let best = 0;
  for (const recipe of (bot.registry?.recipes?.[itemId] || []).slice(0, 32)) {
    const ingredients = recipeIngredientEntries(bot, recipe);
    if (ingredients.length === 0) continue;
    const batches = ingredients.reduce((limit, ingredient) => Math.min(
      limit,
      Math.floor(ledgerCount(context, ingredient.name) / ingredient.count),
    ), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(batches) || batches < 1) continue;
    best = Math.max(best, batches * recipeOutputCount(recipe));
  }
  return best;
}

function hasCarriedProductionPath(bot, context, target, depth = 0, trail = []) {
  if (ledgerCount(context, target) > 0) return true;
  if (depth >= 2 || trail.includes(target)) return false;
  const nextTrail = [...trail, target];
  return connectedRecipes(bot, target).slice(0, 32).some(recipe => {
    const ingredients = recipeIngredientEntries(bot, recipe);
    return ingredients.length > 0 && ingredients.every(ingredient => (
      ledgerCount(context, ingredient.name) >= ingredient.count
      || hasCarriedProductionPath(bot, context, ingredient.name, depth + 1, nextTrail)
    ));
  });
}

function logTransformForPlanks(bot, plankName) {
  return connectedRecipes(bot, plankName)
    .map(recipe => {
      const ingredients = recipeIngredientEntries(bot, recipe);
      if (ingredients.length !== 1 || !isLog(ingredients[0].name)) return null;
      return {
        logName: ingredients[0].name,
        logCount: ingredients[0].count,
        plankCount: recipeOutputCount(recipe),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      (right.plankCount / right.logCount) - (left.plankCount / left.logCount)
      || left.logName.localeCompare(right.logName)
    ))[0] || null;
}

function plankVariantDescriptor(bot, recipe) {
  const ingredients = recipeIngredientEntries(bot, recipe);
  const plankIngredients = ingredients.filter(ingredient => ingredient.name.endsWith('_planks'));
  if (plankIngredients.length !== 1) return null;
  const transform = logTransformForPlanks(bot, plankIngredients[0].name);
  if (!transform) return null;
  const signature = ingredients
    .map(ingredient => `${ingredient.count}x${ingredient.name.endsWith('_planks') ? '#planks' : ingredient.name}`)
    .sort()
    .join('+');
  return {
    recipe,
    signature: `${recipeOutputCount(recipe)}<-${signature}`,
    plank: plankIngredients[0],
    transform,
  };
}

// Registry recipe alternatives often encode a tag as many concrete recipes.
// If none of those species is carried or physically observed, choosing the
// registry's first species turns planning into a blind search. Collect one
// bounded batch through the existing wood-family capability, then let the
// mandatory post-action replan bind the actual log and plank species found.
function planUnboundPlankFamily(bot, context, target, amount, recipes, trail) {
  const learningKey = 'collect:logs->logs';
  if (methodExcluded(context, learningKey)) return null;

  const groups = new Map();
  for (const recipe of recipes) {
    const descriptor = plankVariantDescriptor(bot, recipe);
    if (!descriptor) continue;
    const group = groups.get(descriptor.signature) || [];
    group.push(descriptor);
    groups.set(descriptor.signature, group);
  }
  const family = [...groups.values()]
    .filter(group => new Set(group.map(entry => entry.plank.name)).size >= 2)
    .sort((left, right) => (
      right.length - left.length
      || left[0].signature.localeCompare(right[0].signature)
    ))[0];
  if (!family) return null;

  const hasConcreteBinding = family.some(entry => {
    if (ledgerCount(context, entry.plank.name) > 0) return true;
    if (immediateCarriedProduction(bot, context, entry.plank.name) > 0) return true;
    return Number.isFinite(acquisitionSourceDistance(
      bot,
      entry.plank.name,
      context.range,
      0,
      [],
      context.blockProximityCache,
    ));
  });
  if (hasConcreteBinding) return null;

  const representative = family
    .slice()
    .sort((left, right) => left.plank.name.localeCompare(right.plank.name))[0];
  const candidate = cloneContext(context);
  const batches = Math.max(1, Math.ceil(amount / recipeOutputCount(representative.recipe)));
  const planksNeeded = representative.plank.count * batches;
  const logsNeeded = Math.max(1, Math.ceil(
    (planksNeeded * representative.transform.logCount) / representative.transform.plankCount,
  ));
  const actionFailure = addCapabilityAction(bot, candidate, 'collect_wood', {
    count: logsNeeded,
    range: candidate.range,
    expectedIncrease: logsNeeded,
  }, {
    kind: 'collect',
    target: 'logs',
    expectedName: 'logs',
    expectedFamily: 'logs',
    expectedIncrease: logsNeeded,
    reason: `${target} accepts interchangeable plank recipes, but no concrete wood species is currently bound.`,
    trail: [...trail, target, 'plank_family'],
    learningKey,
  });
  if (actionFailure) return { failure: actionFailure };

  // This representative log exists only inside the speculative remainder of
  // this candidate. The family collection is always its next physical action,
  // and the mandatory post-action replan binds the actual species found.
  setLedgerCount(
    candidate,
    representative.transform.logName,
    ledgerCount(candidate, representative.transform.logName) + logsNeeded,
  );
  const recipeFailure = planFromRecipe(
    bot,
    candidate,
    target,
    amount,
    representative.recipe,
    trail,
  );
  return recipeFailure
    ? { failure: recipeFailure }
    : {
        candidate,
        score: recipeScore(bot, context, target, representative.recipe),
      };
}

function collapsePlankRecipeAlternatives(bot, context, target, amount, recipes, trail) {
  const discarded = new Set();
  for (const group of plankRecipeAlternativeGroups(bot.registry, recipes)) {
    const candidates = [];
    const baselineLedger = new Map(context.ledger);
    const groundedRecipes = group.filter(recipe => {
      const plank = recipeIngredientEntries(bot, recipe)
        .find(ingredient => ingredient.name.endsWith('_planks'));
      return plank && hasCarriedProductionPath(bot, context, plank.name);
    });
    for (const recipe of groundedRecipes.length > 0 ? groundedRecipes : group) {
      const plank = recipeIngredientEntries(bot, recipe)
        .find(ingredient => ingredient.name.endsWith('_planks'));
      if (!plank) continue;
      const candidate = cloneContext(context);
      const batches = Math.max(1, Math.ceil(amount / recipeOutputCount(recipe)));
      const baselineActionCount = candidate.actions.length;
      const failure = ensureItem(
        bot,
        candidate,
        plank.name,
        plank.count * batches,
        [...trail, target, 'plank_family_binding'],
      );
      if (failure) continue;
      candidates.push({
        recipe,
        rank: derivedPlanRank(candidate, baselineActionCount, baselineLedger),
        score: recipeScore(bot, context, target, recipe),
      });
    }
    candidates.sort((left, right) => (
      left.rank.effectiveCost - right.rank.effectiveCost
      || left.rank.cost - right.rank.cost
      || right.rank.preference - left.rank.preference
      || left.rank.actions - right.rank.actions
      || right.score - left.score
      || recipeLearningKey(bot, target, left.recipe).localeCompare(recipeLearningKey(bot, target, right.recipe))
    ));
    const selected = candidates[0]?.recipe;
    if (!selected) continue;
    for (const recipe of group) {
      if (recipe !== selected) discarded.add(recipe);
    }
  }
  return recipes.filter(recipe => !discarded.has(recipe));
}

function recipeScore(bot, context, target, recipe) {
  const ingredients = planningRecipeIngredientEntries(bot, recipe);
  let score = 0;
  for (const ingredient of ingredients) {
    const available = ingredient.family
      ? ledgerFamilyCount(context, ingredient.family)
      : ledgerCount(context, ingredient.name);
    score += Math.min(ingredient.count, available) * 100;
    // When two recipes are already satisfiable, preserve the scarce exact
    // ingredient for downstream recipes. Fifty bamboo is a better source for
    // sticks than the bot's last two planks, even though both can craft now.
    score += Math.min(24, Math.max(0, available - ingredient.count));
    if (available < ingredient.count) {
      const missing = ingredient.count - available;
      score += Math.min(
        missing,
        immediateCarriedProduction(bot, context, ingredient.name),
      ) * 110;
      const cacheKey = `${ingredient.name}:${context.range}`;
      if (!context.proximityCache.has(cacheKey)) {
        context.proximityCache.set(
          cacheKey,
          acquisitionSourceDistance(
            bot,
            ingredient.name,
            context.range,
            0,
            [],
            context.blockProximityCache,
          ),
        );
      }
      const distance = context.proximityCache.get(cacheKey);
      if (Number.isFinite(distance) && distance <= context.range) {
        score += Math.max(1, Math.round(100 * (1 - (distance / context.range))));
      }
      const renewableSearchCost = entityHarvestSources(bot.registry, ingredient.name)
        .reduce((best, source) => Math.min(best, entityHarvestSearchCost(source)), Number.POSITIVE_INFINITY);
      if (Number.isFinite(renewableSearchCost)) {
        score += missing * Math.max(0, 50 - renewableSearchCost);
      }
    }
    // What the bot still has to go and get is what actually costs it time.
    score -= Math.max(0, ingredient.count - available) * acquisitionCost(ingredient.name);
    if (ingredient.name === 'cobblestone') score += 12;
    if (ingredient.name.endsWith('_planks')) score += 8;
  }
  return score - ingredients.length + learnedPreference(
    context,
    recipeLearningKey(bot, target, recipe),
  );
}

function entityHarvestMethodScore(bot, context, source, amount) {
  const searchCost = context.allowEntityAlternatives
    ? entityHarvestAlternativeSearchCost(bot.registry, source)
    : entityHarvestSearchCost(source);
  const rarityCost = searchCost * Math.max(1, amount);
  const toolAdjustment = source.requiredItem
    ? ledgerCount(context, source.requiredItem) > 0
      ? 20
      : -acquisitionCost(source.requiredItem)
    : 0;
  const origin = bot.entity?.position;
  const observedDistance = Object.values(bot.entities || {})
    .filter(entity => entityMatchesHarvestSource(entity, source))
    .reduce((nearest, entity) => {
      if (!origin || !entity?.position) return nearest;
      const distance = typeof origin.distanceTo === 'function'
        ? Number(origin.distanceTo(entity.position))
        : Math.hypot(
          Number(origin.x) - Number(entity.position.x),
          Number(origin.y) - Number(entity.position.y),
          Number(origin.z) - Number(entity.position.z),
        );
      return Number.isFinite(distance) ? Math.min(nearest, distance) : nearest;
    }, Number.POSITIVE_INFINITY);
  const observedBonus = Number.isFinite(observedDistance)
    ? Math.max(200, 500 - Math.round(observedDistance * 2))
    : 0;
  return 100 - (rarityCost * 4) + toolAdjustment + observedBonus + learnedPreference(
    context,
    `harvest:${source.method}:${source.entity}->${source.output}`,
  );
}

function toolScore(name) {
  const prefix = name.split('_')[0];
  return TOOL_TIER[prefix] ?? 100;
}

function requiredHarvestTools(bot, block, context = null) {
  return Object.keys(block?.harvestTools || {})
    .map(id => itemName(bot, id))
    .filter(Boolean)
    .sort((left, right) => {
      if (context) {
        const preparationScore = tool => connectedRecipes(bot, tool).reduce((best, recipe) => (
          Math.max(best, recipeScore(bot, context, tool, recipe))
        ), Number.NEGATIVE_INFINITY);
        const readinessDifference = preparationScore(right) - preparationScore(left);
        if (readinessDifference !== 0) return readinessDifference;
      }
      return toolScore(left) - toolScore(right) || left.localeCompare(right);
    });
}

function reserveFuel(bot, context, amount, trail) {
  let remaining = Math.max(1, amount);
  const fuels = [...context.ledger.entries()]
    .map(([name, count]) => ({ name, count, output: fuelOutput(name) }))
    .filter(entry => entry.count > 0 && entry.output > 0)
    .sort((left, right) => right.output - left.output);
  for (const fuel of fuels) {
    if (remaining <= 0) break;
    const needed = Math.min(fuel.count, Math.ceil(remaining / fuel.output));
    setLedgerCount(context, fuel.name, fuel.count - needed);
    remaining -= needed * fuel.output;
  }
  if (remaining <= 0) return null;

  const logsNeeded = Math.max(1, Math.ceil(remaining / 1.5));
  const actionFailure = addCapabilityAction(bot, context, 'collect_wood', {
    count: Math.min(64, logsNeeded),
    range: context.range,
    expectedIncrease: logsNeeded,
  }, {
    kind: 'collect_fuel',
    target: 'logs',
    expectedName: 'logs',
    expectedFamily: 'logs',
    expectedIncrease: logsNeeded,
    reason: `Smelting requires fuel for ${amount} item${amount === 1 ? '' : 's'}.`,
    trail,
  });
  if (actionFailure) return actionFailure;
  return null;
}

function ensurePersistentItem(bot, context, name, trail) {
  if (context.workstationConstraint?.name === name) return null;
  const carriedRequired = context.workstationRequirement?.carried === true
    && context.workstationRequirement.name === name;
  if (
    ledgerCount(context, name) > 0
    // The execution adapter owns approach binding and will return a carried
    // workstation requirement if this loaded candidate is not actually
    // reachable. Requiring interaction reach here duplicated that query and
    // rebuilt tables/furnaces that native Pathfinder could reach in seconds.
    || (!carriedRequired && nearbyBlock(bot, name, context.range, context.blockProximityCache))
  ) return null;
  return ensureItem(bot, context, name, 1, trail);
}

function planFromRecipe(bot, context, target, amount, recipe, trail) {
  const outputCount = recipeOutputCount(recipe);
  const batches = Math.max(1, Math.ceil(amount / outputCount));
  const ingredients = planningRecipeIngredientEntries(bot, recipe);
  if (ingredients.length === 0) {
    return blocked('recipe_without_ingredients', `The connected registry exposed an unusable recipe for ${target}.`, target, trail);
  }

  for (const ingredient of ingredients) {
    const required = ingredient.count * batches;
    if (ingredient.family) {
      const familyFailure = ensureLedgerFamily(
        bot,
        context,
        ingredient,
        required,
        [...trail, target],
      );
      if (familyFailure) return familyFailure;
      continue;
    }
    const ingredientFailure = ensureItem(bot, context, ingredient.name, required, [...trail, target]);
    if (ingredientFailure) return ingredientFailure;
    setLedgerCount(context, ingredient.name, ledgerCount(context, ingredient.name) - required);
  }

  // A crafting table is required at execution time, not before remote
  // ingredients are acquired. Binding it first made every ore relocation
  // rebuild or carry a table before the ore existed, and regional recovery
  // could then strand that capability. Replanning after each verified
  // ingredient keeps the table adjacent to the actual craft action.
  if (recipeNeedsTable(recipe) && target !== 'crafting_table') {
    const workstationFailure = ensurePersistentItem(bot, context, 'crafting_table', [...trail, `${target}:workstation`]);
    if (workstationFailure) return workstationFailure;
  }

  const produced = batches * outputCount;
  const actionFailure = addCapabilityAction(bot, context, 'craft', {
    item: target,
    batches,
    expectedIncrease: produced,
    workstation: context.workstationConstraint?.name === 'crafting_table'
      ? context.workstationConstraint
      : null,
  }, {
    kind: 'craft',
    target,
    expectedIncrease: produced,
    reason: `${target} is produced from ${ingredients.map(ingredient => `${ingredient.count * batches} ${ingredient.name}`).join(' + ')}.`,
    trail: [...trail, target],
    learningKey: recipeLearningKey(bot, target, recipe),
  });
  if (actionFailure) return actionFailure;
  setLedgerCount(context, target, ledgerCount(context, target) + produced);
  return null;
}

function planFromSmelting(bot, context, target, amount, input, trail) {
  const inputFailure = ensureItem(bot, context, input, amount, [...trail, target]);
  if (inputFailure) return inputFailure;
  const furnaceFailure = ensurePersistentItem(bot, context, 'furnace', [...trail, `${target}:furnace`]);
  if (furnaceFailure) return furnaceFailure;
  const fuelFailure = reserveFuel(bot, context, amount, [...trail, `${target}:fuel`]);
  if (fuelFailure) return fuelFailure;

  setLedgerCount(context, input, ledgerCount(context, input) - amount);
  const actionFailure = addCapabilityAction(bot, context, 'smelt', {
    input,
    output: target,
    count: amount,
    expectedIncrease: amount,
    workstation: context.workstationConstraint?.name === 'furnace'
      ? context.workstationConstraint
      : null,
  }, {
    kind: 'smelt',
    target,
    expectedIncrease: amount,
    reason: `${input} plus furnace fuel produces ${target}.`,
    trail: [...trail, target],
    learningKey: `smelt:${canonicalName(input)}->${canonicalName(target)}`,
  });
  if (actionFailure) return actionFailure;
  setLedgerCount(context, target, ledgerCount(context, target) + amount);
  return null;
}

function planFromWorldSource(bot, context, target, amount, trail) {
  const sources = sourceBlocks(bot, target)
    .filter(source => selfDroppingSourceIsGrounded(bot, context, source, target, trail))
    .filter(source => !methodExcluded(context, sourceLearningKey(source.name, target)))
    .sort((left, right) => (
      sourceScore(context, right, target) - sourceScore(context, left, target)
      || left.name.localeCompare(right.name)
    ));
  if (sources.length === 0) {
    return blocked(
      'unsupported_acquisition_leaf',
      `No crafting, smelting, or verified block-drop source is known for ${target} in the connected Minecraft version.`,
      target,
      [...trail, target],
    );
  }

  const failures = [];
  for (const source of sources.slice(0, 12)) {
    const candidate = cloneContext(context);
    const tools = requiredHarvestTools(bot, source, candidate);
    if (tools.length > 0 && !tools.some(tool => ledgerCount(candidate, tool) > 0)) {
      let toolPrepared = false;
      for (const tool of tools) {
        const toolCandidate = cloneContext(candidate);
        const toolFailure = ensureItem(bot, toolCandidate, tool, 1, [...trail, target, `${source.name}:tool`]);
        if (!toolFailure) {
          acceptContext(candidate, toolCandidate);
          toolPrepared = true;
          break;
        }
        failures.push(toolFailure);
      }
      if (!toolPrepared) continue;
    }

    const actionFailure = addCapabilityAction(bot, candidate, 'collect_block', {
      source: source.name,
      output: target,
      count: Math.min(2304, amount),
      range: context.range,
      expectedIncrease: amount,
    }, {
      kind: 'collect',
      target,
      expectedIncrease: amount,
      reason: `${source.name} is a connected-registry block source whose drop produces ${target}.`,
      trail: [...trail, target, source.name],
      learningKey: sourceLearningKey(source.name, target),
    });
    if (actionFailure) {
      failures.push(actionFailure);
      continue;
    }
    setLedgerCount(candidate, target, ledgerCount(candidate, target) + amount);
    acceptContext(context, candidate);
    return null;
  }

  return failures[0] || blocked(
    'unavailable_harvest_tool',
    `Known ${target} source blocks require a tool whose prerequisites could not be satisfied.`,
    target,
    [...trail, target],
  );
}

function planFromEntityHarvestSource(bot, context, target, amount, trail) {
  const sources = entityHarvestSources(bot.registry, target)
    .filter(source => !methodExcluded(
      context,
      `harvest:${source.method}:${source.entity}->${target}`,
    ));
  if (sources.length === 0) {
    return blocked(
      'unsupported_entity_harvest_leaf',
      `No verified entity-harvest source is known for ${target} in the connected Minecraft version.`,
      target,
      [...trail, target],
    );
  }

  const failures = [];
  for (const source of sources) {
    const candidate = cloneContext(context);
    if (source.requiredItem) {
      const toolFailure = ensureItem(
        bot,
        candidate,
        source.requiredItem,
        1,
        [...trail, target, `${source.entity}:${source.method}:tool`],
      );
      if (toolFailure) {
        failures.push(toolFailure);
        continue;
      }
    }
    const actionFailure = addCapabilityAction(bot, candidate, 'harvest_entity_drop', {
      source: source.entity,
      output: target,
      method: source.method,
      count: amount,
      // Mobile sources are much sparser than block resources. Give the
      // deterministic entity-search primitive enough bounded terrain to cover
      // several loaded regions without changing block-collection policy.
      range: Math.max(192, context.range),
      allowAlternative: context.allowEntityAlternatives,
      expectedIncrease: amount,
    }, {
      kind: 'harvest_entity',
      target,
      expectedIncrease: amount,
      reason: `${source.entity} is a versioned ${source.method} source whose verified drop produces ${target}.`,
      trail: [...trail, target, source.entity, source.method],
      learningKey: `harvest:${source.method}:${source.entity}->${target}`,
    });
    if (actionFailure) {
      failures.push(actionFailure);
      continue;
    }
    setLedgerCount(candidate, target, ledgerCount(candidate, target) + amount);
    acceptContext(context, candidate);
    return null;
  }
  return failures[0] || blocked(
    'unavailable_entity_harvest_tool',
    `Known ${target} entity sources require prerequisites that could not be satisfied.`,
    target,
    [...trail, target],
  );
}

function depletedCarriedInputs(candidate, baselineLedger) {
  if (!(baselineLedger instanceof Map)) return 0;
  let depleted = 0;
  for (const [name, count] of baselineLedger.entries()) {
    if (Number(count) > 0 && ledgerCount(candidate, name) === 0) depleted += 1;
  }
  return depleted;
}

function derivedPlanRank(candidate, baselineActionCount, baselineLedger = null) {
  const actions = candidate.actions.slice(baselineActionCount);
  const cost = actions.reduce((total, action) => (
    total + Math.max(0, Number(action.capability?.cost) || 0)
  ), 0);
  const depletedInputs = depletedCarriedInputs(candidate, baselineLedger);
  return {
    cost,
    effectiveCost: cost + (depletedInputs * 2),
    depletedInputs,
    preference: actions.reduce((total, action) => (
      total + Number(action.learnedPreference || 0)
    ), 0),
    actions: actions.length,
  };
}

function compareDerivedPlans(left, right, baselineActionCount, baselineLedger = null) {
  const leftRank = derivedPlanRank(left.candidate, baselineActionCount, baselineLedger);
  const rightRank = derivedPlanRank(right.candidate, baselineActionCount, baselineLedger);
  return (left.kind === right.kind ? 0 : right.score - left.score)
    || leftRank.effectiveCost - rightRank.effectiveCost
    || leftRank.cost - rightRank.cost
    || rightRank.preference - leftRank.preference
    || leftRank.actions - rightRank.actions
    || right.score - left.score
    || left.kind.localeCompare(right.kind);
}

function produceItem(bot, context, target, amount, trail) {
  const nodeFailure = enterNode(context, target, trail);
  if (nodeFailure) return nodeFailure;
  const nextTrail = [...trail, target];

  const smeltingFailures = [];
  for (const smeltingInput of smeltingInputCandidates(bot, context, target)
    .filter(input => !methodExcluded(context, `smelt:${canonicalName(input)}->${canonicalName(target)}`))) {
    const candidate = cloneContext(context);
    const failure = planFromSmelting(bot, candidate, target, amount, smeltingInput, nextTrail);
    if (!failure) {
      acceptContext(context, candidate);
      return null;
    }
    smeltingFailures.push(failure);
  }

  const directSources = sourceBlocks(bot, target);
  const hasObservedDirectSource = directSources.some(block => Boolean(nearbyBlock(
    bot,
    block.name,
    context.range,
    context.blockProximityCache,
  )));
  const hasNaturalTransformSource = directSources.some(block => (
    block.name !== target
    && block.name !== `${target}_block`
    && !block.name.endsWith(`_${target}_block`)
    && /(?:_ore|stone|deepslate|gravel|clay)$/.test(block.name)
  ));
  if (hasNaturalTransformSource || hasObservedDirectSource) {
    const sourceCandidate = cloneContext(context);
    const sourceFailure = planFromWorldSource(bot, sourceCandidate, target, amount, nextTrail);
    if (!sourceFailure) {
      acceptContext(context, sourceCandidate);
      return null;
    }
  }

  const connectedRecipeCandidates = pruneUngroundedReversibleTransforms(
    bot,
    context,
    target,
    amount,
    pruneUnboundVariantTransforms(
      bot,
      context,
      target,
      connectedRecipes(bot, target)
        .filter(recipe => !methodExcluded(context, recipeLearningKey(bot, target, recipe))),
    ),
  );
  const plankFamilyMethod = planUnboundPlankFamily(
    bot,
    context,
    target,
    amount,
    connectedRecipeCandidates,
    nextTrail,
  );
  const familyRecipe = createPlankFamilyRecipe(bot.registry, connectedRecipeCandidates);
  const recipes = collapsePlankRecipeAlternatives(
    bot,
    context,
    target,
    amount,
    connectedRecipeCandidates,
    nextTrail,
  );
  if (
    familyRecipe
    && !methodExcluded(context, recipeLearningKey(bot, target, familyRecipe))
  ) recipes.push(familyRecipe);
  recipes.sort((left, right) => (
      recipeScore(bot, context, target, right) - recipeScore(bot, context, target, left)
    ));
  const recipeFailures = [];
  const methodFailures = [];
  const entitySources = entityHarvestSources(bot.registry, target);
  const acquisitionMethods = [
    ...recipes.slice(0, 32).map(recipe => ({
      kind: 'recipe',
      recipe,
      score: recipeScore(bot, context, target, recipe),
    })),
    ...(entitySources.length > 0 ? [{
      kind: 'entity_harvest',
      score: Math.max(...entitySources.map(source => (
        entityHarvestMethodScore(bot, context, source, amount)
      ))),
    }] : []),
  ].sort((left, right) => (
    right.score - left.score
    || left.kind.localeCompare(right.kind)
  ));
  const baselineActionCount = context.actions.length;
  const baselineLedger = new Map(context.ledger);
  const successfulMethods = [];
  if (plankFamilyMethod?.candidate) {
    // Generic wood collection is one recipe candidate, not a gate in front of
    // the causal search. A completely carried transform (for example bamboo
    // into planks) can now outrank a blind regional tree search.
    successfulMethods.push({
      kind: 'recipe',
      score: plankFamilyMethod.score,
      candidate: plankFamilyMethod.candidate,
    });
  } else if (plankFamilyMethod?.failure) {
    methodFailures.push(plankFamilyMethod.failure);
    recipeFailures.push(plankFamilyMethod.failure);
  }
  for (const method of acquisitionMethods) {
    const blindPlankVariant = plankFamilyMethod?.candidate
      && method.kind === 'recipe'
      && planningRecipeIngredientEntries(bot, method.recipe).some(ingredient => (
        ingredient.family === 'planks' || ingredient.name.endsWith('_planks')
      ));
    if (blindPlankVariant) {
      // The family candidate exists only when no carried transform or observed
      // species can bind these recipes. It has already planned the same recipe
      // after one generic wood collection, so recursively exploring every
      // ungrounded plank species cannot produce a better executable next step.
      continue;
    }
    const dominantAlternativeHarvest = successfulMethods.find(candidate => (
      candidate.kind === 'entity_harvest'
      && candidate.score > method.score
    ));
    if (dominantAlternativeHarvest && method.kind === 'recipe') {
      // The entity capability has one aggregated deterministic binding. A
      // lower-scored recipe is a different method kind, so the comparator
      // cannot select it; recursively expanding all dye-family recipes here
      // only burns the global node budget.
      break;
    }
    const candidate = cloneContext(context);
    const failure = method.kind === 'recipe'
      ? planFromRecipe(bot, candidate, target, amount, method.recipe, nextTrail)
      : planFromEntityHarvestSource(bot, candidate, target, amount, nextTrail);
    if (!failure) {
      successfulMethods.push({ ...method, candidate });
      continue;
    }
    methodFailures.push(failure);
    if (method.kind === 'recipe') recipeFailures.push(failure);
  }

  const sourceCandidate = cloneContext(context);
  const sourceFailure = planFromWorldSource(bot, sourceCandidate, target, amount, nextTrail);
  if (!sourceFailure) {
    successfulMethods.push({ kind: 'world_source', score: 0, candidate: sourceCandidate });
  }
  if (successfulMethods.length > 0) {
    successfulMethods.sort((left, right) => (
      compareDerivedPlans(left, right, baselineActionCount, baselineLedger)
    ));
    acceptContext(context, successfulMethods[0].candidate);
    return null;
  }

  return methodFailures[0] || recipeFailures[0] || smeltingFailures[0] || sourceFailure;
}

function ensureItem(bot, context, targetName, requiredCount, trail = []) {
  const target = canonicalName(targetName);
  const required = Math.max(0, Math.floor(Number(requiredCount) || 0));
  if (!target || required < 1) return null;
  const available = ledgerCount(context, target);
  if (available >= required) return null;
  return produceItem(bot, context, target, required - available, trail);
}

function publicAction(action) {
  return {
    kind: action.kind,
    capability: action.capability,
    target: action.target,
    expectedName: action.expectedName,
    expectedFamily: action.expectedFamily,
    expectedIncrease: action.expectedIncrease,
    reason: action.reason,
    trail: [...action.trail],
    learningKey: action.learningKey,
    learnedPreference: action.learnedPreference,
  };
}

export function buildPrerequisitePlan(bot, {
  target,
  quantity = 1,
  completion = 'inventory',
  range = DEFAULT_RANGE,
  maxDepth = DEFAULT_MAX_DEPTH,
  maxNodes = DEFAULT_MAX_NODES,
  maxActions = DEFAULT_MAX_ACTIONS,
  experience = null,
  toolRequirement = null,
  workstationRequirement = null,
  accessRequirement = null,
  workstationConstraint = null,
  blockProximityCache = null,
  allowEntityAlternatives = false,
  allowUnobservedSelfDropRoot = true,
  excludedMethods = [],
} = {}) {
  const canonicalTarget = canonicalName(target);
  const desired = boundedInteger(quantity, 1, 1, 100_000);
  if (!canonicalTarget || !bot?.registry?.itemsByName?.[canonicalTarget]) {
    return {
      status: 'blocked',
      code: 'unknown_planner_target',
      detail: `${canonicalTarget || 'The requested target'} is not an item in the connected server registry.`,
      target: canonicalTarget,
      quantity: desired,
      actions: [],
      blocker: canonicalTarget || null,
      trail: [],
      exploredNodes: 0,
    };
  }

  const requiredTool = canonicalName(toolRequirement?.name);
  const minimumUsableDurability = boundedInteger(
    toolRequirement?.minimumUsableDurability,
    1,
    1,
    10_000,
  );
  // When the requested output IS the discovered replacement tool, raw item
  // count is not completion: a worn-out carried tool must not satisfy the
  // durability contract and send the caller straight back to the same failure.
  const current = requiredTool === canonicalTarget
    ? usableDurableItemCount(bot, canonicalTarget, minimumUsableDurability)
    : plannedInventoryCount(bot, canonicalTarget);
  const completionKind = completion?.kind || completion || 'inventory';
  if (current >= desired) {
    if (
      ['main_hand', 'off_hand'].includes(completionKind)
      && !completionRequirementSatisfied(bot, { inventoryName: canonicalTarget }, { kind: completionKind })
    ) {
      const destination = completionKind === 'main_hand' ? 'main_hand' : 'off_hand';
      const action = publicAction(createCapabilityPlanAction('equip', {
        item: canonicalTarget,
        destination,
      }, {
        kind: 'equip',
        target: canonicalTarget,
        expectedName: null,
        expectedFamily: null,
        expectedIncrease: 0,
        reason: `${canonicalTarget} is available and must be verified in the ${completionKind === 'main_hand' ? 'main hand' : 'offhand'}.`,
        trail: [canonicalTarget, completionKind],
        learningKey: `equip:${canonicalTarget}->${completionKind}`,
        learnedPreference: 0,
      }, { bot }));
      return {
        status: 'ready',
        code: 'equipment_completion_ready',
        detail: `Inventory contains ${current} ${canonicalTarget}; equipment verification is still required.`,
        target: canonicalTarget,
        quantity: desired,
        actions: [action],
        nextStep: action,
        blocker: null,
        trail: [...action.trail],
        exploredNodes: 0,
      };
    }
    return {
      status: 'complete',
      code: 'target_already_satisfied',
      detail: `Inventory already contains ${current} ${canonicalTarget}; ${desired} required.`,
      target: canonicalTarget,
      quantity: desired,
      actions: [],
      blocker: null,
      trail: [canonicalTarget],
      exploredNodes: 0,
    };
  }

  const context = {
    ledger: inventoryLedger(bot),
    actions: [],
    budget: { nodes: 0 },
    range: boundedInteger(range, DEFAULT_RANGE, 16, 512),
    maxDepth: boundedInteger(maxDepth, DEFAULT_MAX_DEPTH, 4, 64),
    maxNodes: boundedInteger(maxNodes, DEFAULT_MAX_NODES, 32, 2_048),
    maxActions: boundedInteger(maxActions, DEFAULT_MAX_ACTIONS, 4, 128),
    experience: typeof experience === 'function' ? experience : null,
    excludedMethods: new Set((Array.isArray(excludedMethods) ? excludedMethods : [])
      .map(value => String(value || '').slice(0, 160))
      .filter(Boolean)),
    allowEntityAlternatives: allowEntityAlternatives === true,
    allowUnobservedSelfDropRoot: allowUnobservedSelfDropRoot === true,
    proximityCache: new Map(),
    blockProximityCache: blockProximityCache instanceof Map ? blockProximityCache : new Map(),
    workstationRequirement: {
      name: canonicalName(workstationRequirement?.name),
      carried: workstationRequirement?.carried === true,
    },
    workstationConstraint: workstationConstraint?.position
      ? {
          name: canonicalName(workstationConstraint.name),
          position: {
            x: Math.floor(Number(workstationConstraint.position.x)),
            y: Math.floor(Number(workstationConstraint.position.y)),
            z: Math.floor(Number(workstationConstraint.position.z)),
          },
          dimension: String(workstationConstraint.dimension || '').slice(0, 64),
          source: String(workstationConstraint.source || 'player_explicit_here').slice(0, 48),
          observedAt: Number.isFinite(workstationConstraint.observedAt)
            ? workstationConstraint.observedAt
            : Date.now(),
        }
      : null,
  };
  let failure = null;
  if (accessRequirement?.kind === 'surface') {
    failure = addCapabilityAction(bot, context, 'reach_surface', {}, {
      kind: 'access',
      target: 'surface',
      expectedName: null,
      expectedIncrease: 0,
      reason: 'The selected physical source requires a verified supported surface stance before acquisition can continue.',
      trail: [canonicalTarget, 'surface_access'],
      learningKey: null,
    });
  }
  if (requiredTool) {
    if (!bot.registry?.itemsByName?.[requiredTool]) {
      failure = blocked(
        'unknown_tool_requirement',
        `The mining preflight requested an unknown replacement tool: ${requiredTool}.`,
        requiredTool,
        [canonicalTarget, 'tool_durability'],
      );
    } else {
      setLedgerCount(
        context,
        requiredTool,
        usableDurableItemCount(bot, requiredTool, minimumUsableDurability),
      );
      failure = ensureItem(
        bot,
        context,
        requiredTool,
        1,
        requiredTool === canonicalTarget
          ? ['tool_durability']
          : [canonicalTarget, 'tool_durability'],
      );
    }
  }
  if (!failure) failure = ensureItem(bot, context, canonicalTarget, desired, []);
  if (failure) {
    return {
      status: 'blocked',
      code: failure.code,
      detail: failure.detail,
      target: canonicalTarget,
      quantity: desired,
      actions: context.actions.slice(0, 12).map(publicAction),
      blocker: failure.target || canonicalTarget,
      trail: [...failure.trail],
      exploredNodes: context.budget.nodes,
    };
  }

  const actions = context.actions.map(publicAction);
  if (actions.length === 0) {
    return {
      status: 'blocked',
      code: 'planner_made_no_plan',
      detail: `The causal planner could not derive a physical action for ${canonicalTarget}.`,
      target: canonicalTarget,
      quantity: desired,
      actions: [],
      blocker: canonicalTarget,
      trail: [canonicalTarget],
      exploredNodes: context.budget.nodes,
    };
  }
  return {
    status: 'ready',
    code: 'causal_plan_ready',
    detail: `${actions.length} verified action${actions.length === 1 ? '' : 's'} derived; next is ${actions[0].kind} ${actions[0].target}.`,
    target: canonicalTarget,
    quantity: desired,
    actions,
    nextStep: actions[0],
    blocker: null,
    trail: [...actions[0].trail],
    exploredNodes: context.budget.nodes,
  };
}
