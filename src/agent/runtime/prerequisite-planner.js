import * as mc from '../../utils/mcdata.js';

const DEFAULT_RANGE = 64;
const DEFAULT_MAX_DEPTH = 24;
const DEFAULT_MAX_NODES = 384;
const DEFAULT_MAX_ACTIONS = 64;
const TOOL_TIER = Object.freeze({
  wooden: 1,
  golden: 2,
  stone: 3,
  copper: 3.5,
  iron: 4,
  diamond: 5,
  netherite: 6,
});
const FUEL_OUTPUT = Object.freeze({
  coal: 8,
  charcoal: 8,
  blaze_rod: 12,
  coal_block: 80,
  lava_bucket: 100,
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

function commandString(value) {
  return JSON.stringify(String(value || ''));
}

function itemName(bot, id) {
  return bot.registry?.items?.[Number(id)]?.name || mc.getItemName(Number(id)) || null;
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

function isLog(name) {
  return /_(?:log|stem)$/.test(name);
}

function fuelOutput(name) {
  if (Object.hasOwn(FUEL_OUTPUT, name)) return FUEL_OUTPUT[name];
  if (isLog(name) || name.endsWith('_planks')) return 1.5;
  return 0;
}

export function plannedInventoryCount(bot, name, family = null) {
  const items = bot.inventory?.items?.() || [];
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
  context.actions.push(Object.freeze({
    kind: action.kind,
    command: action.command,
    target: action.target,
    expectedName: action.expectedName || action.target,
    expectedFamily: action.expectedFamily || null,
    expectedIncrease: Math.max(1, Math.floor(Number(action.expectedIncrease) || 1)),
    reason: String(action.reason || '').slice(0, 280),
    trail: Object.freeze((action.trail || []).slice(0, 24)),
  }));
  return null;
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

function recipeOutputCount(recipe) {
  return Math.max(1, Math.floor(Number(recipe?.result?.count) || 1));
}

function recipeNeedsTable(recipe) {
  if (Array.isArray(recipe?.inShape)) {
    const height = recipe.inShape.length;
    const width = recipe.inShape.reduce((maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0), 0);
    return height > 2 || width > 2;
  }
  return Array.isArray(recipe?.ingredients) && recipe.ingredients.filter(value => value != null).length > 4;
}

function nearbyBlock(bot, name, range = 16) {
  const block = bot.registry?.blocksByName?.[name];
  if (!block || typeof bot.findBlock !== 'function') return null;
  try {
    return bot.findBlock({ matching: block.id, maxDistance: range }) || null;
  } catch {
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
      && Array.isArray(block.drops)
      && block.drops.includes(item.id)
    ) sources.push(block);
  }
  return sources;
}

function sourceScore(block) {
  let score = 0;
  if (block.name === 'stone' || block.name === 'dirt' || block.name === 'sand') score += 20;
  if (!block.name.startsWith('deepslate_')) score += 5;
  if (block.name.endsWith('_ore')) score += 12;
  return score;
}

function recipeScore(bot, context, recipe) {
  const ingredients = recipeIngredientEntries(bot, recipe);
  let score = 0;
  for (const ingredient of ingredients) {
    score += Math.min(ingredient.count, ledgerCount(context, ingredient.name)) * 100;
    if (ingredient.name === 'cobblestone') score += 12;
    if (ingredient.name.endsWith('_planks')) score += 8;
    if (ingredient.name === 'oak_planks') score += 20;
  }
  return score - ingredients.length;
}

function toolScore(name) {
  const prefix = name.split('_')[0];
  return TOOL_TIER[prefix] ?? 100;
}

function requiredHarvestTools(bot, block) {
  return Object.keys(block?.harvestTools || {})
    .map(id => itemName(bot, id))
    .filter(Boolean)
    .sort((left, right) => toolScore(left) - toolScore(right) || left.localeCompare(right));
}

function reserveFuel(context, amount, trail) {
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
  const actionFailure = addAction(context, {
    kind: 'collect_fuel',
    command: `!collectWoodInRange(${Math.min(64, logsNeeded)}, ${context.range})`,
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
  if (ledgerCount(context, name) > 0 || nearbyBlock(bot, name, 4)) return null;
  return ensureItem(bot, context, name, 1, trail);
}

function planFromRecipe(bot, context, target, amount, recipe, trail) {
  const outputCount = recipeOutputCount(recipe);
  const batches = Math.max(1, Math.ceil(amount / outputCount));
  const ingredients = recipeIngredientEntries(bot, recipe);
  if (ingredients.length === 0) {
    return blocked('recipe_without_ingredients', `The connected registry exposed an unusable recipe for ${target}.`, target, trail);
  }

  if (recipeNeedsTable(recipe) && target !== 'crafting_table') {
    const workstationFailure = ensurePersistentItem(bot, context, 'crafting_table', [...trail, `${target}:workstation`]);
    if (workstationFailure) return workstationFailure;
  }

  for (const ingredient of ingredients) {
    const required = ingredient.count * batches;
    const ingredientFailure = ensureItem(bot, context, ingredient.name, required, [...trail, target]);
    if (ingredientFailure) return ingredientFailure;
    setLedgerCount(context, ingredient.name, ledgerCount(context, ingredient.name) - required);
  }

  const produced = batches * outputCount;
  const actionFailure = addAction(context, {
    kind: 'craft',
    command: `!craftRecipe(${commandString(target)}, ${batches})`,
    target,
    expectedIncrease: produced,
    reason: `${target} is produced from ${ingredients.map(ingredient => `${ingredient.count * batches} ${ingredient.name}`).join(' + ')}.`,
    trail: [...trail, target],
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
  const fuelFailure = reserveFuel(context, amount, [...trail, `${target}:fuel`]);
  if (fuelFailure) return fuelFailure;

  setLedgerCount(context, input, ledgerCount(context, input) - amount);
  const actionFailure = addAction(context, {
    kind: 'smelt',
    command: `!smeltItem(${commandString(input)}, ${amount})`,
    target,
    expectedIncrease: amount,
    reason: `${input} plus furnace fuel produces ${target}.`,
    trail: [...trail, target],
  });
  if (actionFailure) return actionFailure;
  setLedgerCount(context, target, ledgerCount(context, target) + amount);
  return null;
}

function planFromWorldSource(bot, context, target, amount, trail) {
  const sources = sourceBlocks(bot, target)
    .sort((left, right) => sourceScore(right) - sourceScore(left) || left.name.localeCompare(right.name));
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
    const tools = requiredHarvestTools(bot, source);
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

    const actionFailure = addAction(candidate, {
      kind: 'collect',
      command: `!collectBlocksInRange(${commandString(source.name)}, ${Math.min(2304, amount)}, ${context.range})`,
      target,
      expectedIncrease: amount,
      reason: `${source.name} is a connected-registry block source whose drop produces ${target}.`,
      trail: [...trail, target, source.name],
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

function produceItem(bot, context, target, amount, trail) {
  const nodeFailure = enterNode(context, target, trail);
  if (nodeFailure) return nodeFailure;
  const nextTrail = [...trail, target];

  const smeltingInput = mc.getItemSmeltingIngredient(target);
  if (smeltingInput) {
    const candidate = cloneContext(context);
    const failure = planFromSmelting(bot, candidate, target, amount, smeltingInput, nextTrail);
    if (!failure) {
      acceptContext(context, candidate);
      return null;
    }
  }

  const directSources = sourceBlocks(bot, target);
  const hasNaturalTransformSource = directSources.some(block => (
    block.name !== target
    && block.name !== `${target}_block`
    && !block.name.endsWith(`_${target}_block`)
    && /(?:_ore|stone|deepslate|gravel|clay)$/.test(block.name)
  ));
  if (hasNaturalTransformSource) {
    const sourceCandidate = cloneContext(context);
    const sourceFailure = planFromWorldSource(bot, sourceCandidate, target, amount, nextTrail);
    if (!sourceFailure) {
      acceptContext(context, sourceCandidate);
      return null;
    }
  }

  const itemId = bot.registry?.itemsByName?.[target]?.id;
  const recipes = Number.isInteger(itemId)
    ? (bot.registry?.recipes?.[itemId] || [])
      .slice()
      .sort((left, right) => recipeScore(bot, context, right) - recipeScore(bot, context, left))
    : [];
  const recipeFailures = [];
  for (const recipe of recipes.slice(0, 32)) {
    const candidate = cloneContext(context);
    const failure = planFromRecipe(bot, candidate, target, amount, recipe, nextTrail);
    if (!failure) {
      acceptContext(context, candidate);
      return null;
    }
    recipeFailures.push(failure);
  }

  const sourceCandidate = cloneContext(context);
  const sourceFailure = planFromWorldSource(bot, sourceCandidate, target, amount, nextTrail);
  if (!sourceFailure) {
    acceptContext(context, sourceCandidate);
    return null;
  }

  return recipeFailures[0] || sourceFailure;
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
    command: action.command,
    target: action.target,
    expectedName: action.expectedName,
    expectedFamily: action.expectedFamily,
    expectedIncrease: action.expectedIncrease,
    reason: action.reason,
    trail: [...action.trail],
  };
}

export function buildPrerequisitePlan(bot, {
  target,
  quantity = 1,
  range = DEFAULT_RANGE,
  maxDepth = DEFAULT_MAX_DEPTH,
  maxNodes = DEFAULT_MAX_NODES,
  maxActions = DEFAULT_MAX_ACTIONS,
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

  const current = plannedInventoryCount(bot, canonicalTarget);
  if (current >= desired) {
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
  };
  const failure = ensureItem(bot, context, canonicalTarget, desired, []);
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
