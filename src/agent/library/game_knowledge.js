import * as mc from '../../utils/mcdata.js';

const MAX_RECIPES = 4;
const MAX_SUGGESTIONS = 8;

function canonicalName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 80);
}

function itemNameById(bot, id) {
  const numericId = Number(id);
  return bot.registry?.items?.[numericId]?.name
    || mc.getItemName(numericId)
    || null;
}

function inventoryCount(bot, name) {
  return (bot.inventory?.items?.() || []).reduce(
    (total, item) => total + (item?.name === name ? Math.max(0, Number(item.count) || 0) : 0),
    0,
  );
}

function capabilityTags(name, item, block, food) {
  const tags = new Set();
  if (block) tags.add('placeable_block');
  if (food) tags.add('food');
  if (item?.maxDurability) tags.add('durable');
  if (/_(?:pickaxe|axe|shovel|hoe)$/.test(name)) tags.add('tool');
  if (/(?:_sword|bow|crossbow|trident|mace)$/.test(name)) tags.add('weapon');
  if (/(?:_helmet|_chestplate|_leggings|_boots)$/.test(name)) tags.add('armor');
  if (name === 'shield') tags.add('defense');
  if (name.endsWith('_bucket') || name === 'bucket') tags.add('container_tool');
  if (name.endsWith('_boat') || name.endsWith('_minecart')) tags.add('vehicle');
  if (name.includes('spawn_egg')) tags.add('spawn_item');
  if (name.endsWith('_seeds') || ['carrot', 'potato', 'beetroot', 'nether_wart'].includes(name)) tags.add('plantable');
  if (name.includes('potion')) tags.add('potion');
  return [...tags];
}

function recipeSummaries(name) {
  return (mc.getItemCraftingRecipes(name) || [])
    .slice(0, MAX_RECIPES)
    .map(([ingredients, result]) => ({
      ingredients,
      outputCount: Math.max(1, Number(result?.craftedCount) || 1),
    }));
}

function suggestionScore(query, candidate) {
  if (candidate === query) return 1000;
  if (candidate.startsWith(query)) return 500 - candidate.length;
  if (candidate.includes(query)) return 300 - candidate.length;
  const queryTokens = query.split('_').filter(Boolean);
  const candidateTokens = new Set(candidate.split('_'));
  return queryTokens.reduce((score, token) => score + (candidateTokens.has(token) ? 25 : 0), 0);
}

function suggestions(bot, query) {
  const names = new Set([
    ...Object.keys(bot.registry?.itemsByName || {}),
    ...Object.keys(bot.registry?.blocksByName || {}),
  ]);
  return [...names]
    .map(name => ({ name, score: suggestionScore(query, name) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, MAX_SUGGESTIONS)
    .map(entry => entry.name);
}

export function inspectGameObject(bot, requestedName) {
  const name = canonicalName(requestedName);
  if (!name) {
    return {
      found: false,
      query: '',
      suggestions: [],
      error: 'A Minecraft item or block name is required.',
    };
  }

  const item = bot.registry?.itemsByName?.[name] || null;
  const block = bot.registry?.blocksByName?.[name] || null;
  if (!item && !block) {
    return {
      found: false,
      query: name,
      suggestions: suggestions(bot, name),
      error: `'${name}' is not present in the connected server registry.`,
    };
  }

  const food = bot.registry?.foodsByName?.[name] || null;
  const harvestTools = Object.keys(block?.harvestTools || {})
    .map(id => itemNameById(bot, id))
    .filter(Boolean);
  const carriedHarvestTools = harvestTools.filter(tool => inventoryCount(bot, tool) > 0);
  const drops = [...new Set((block?.drops || []).map(id => itemNameById(bot, id)).filter(Boolean))];
  const heldName = bot.heldItem?.name || null;
  const heldCanHarvest = Boolean(
    block
    && bot.heldItem
    && (
      harvestTools.length === 0
      || harvestTools.includes(heldName)
    ),
  );

  return {
    found: true,
    query: name,
    canonicalName: name,
    displayName: item?.displayName || block?.displayName || name,
    kinds: [
      ...(item ? ['item'] : []),
      ...(block ? ['block'] : []),
    ],
    capabilities: capabilityTags(name, item, block, food),
    inventory: {
      count: inventoryCount(bot, name),
      held: heldName === name,
    },
    item: item ? {
      stackSize: Number(item.stackSize) || 1,
      maxDurability: Number(item.maxDurability) || null,
      repairWith: Array.isArray(item.repairWith) ? item.repairWith.slice(0, 12) : [],
      foodPoints: Number(food?.foodPoints) || null,
      saturation: Number(food?.saturation) || null,
    } : null,
    block: block ? {
      diggable: block.diggable === true,
      hardness: Number.isFinite(block.hardness) ? block.hardness : null,
      material: String(block.material || ''),
      boundingBox: String(block.boundingBox || ''),
      lightEmitted: Number(block.emitLight) || 0,
      drops,
      harvestTools,
      carriedHarvestTools,
      heldCanHarvest,
    } : null,
    recipes: item ? recipeSummaries(name) : [],
  };
}

function list(values, empty = 'none') {
  return Array.isArray(values) && values.length > 0 ? values.join(', ') : empty;
}

export function formatGameObjectKnowledge(knowledge) {
  if (!knowledge?.found) {
    const suggestionsText = knowledge?.suggestions?.length
      ? ` Suggestions: ${knowledge.suggestions.join(', ')}.`
      : '';
    return `MINECRAFT_OBJECT_UNKNOWN\n- ${knowledge?.error || 'Object not found.'}${suggestionsText}`;
  }

  const lines = [
    'MINECRAFT_OBJECT',
    `- Canonical: ${knowledge.canonicalName}`,
    `- Display: ${knowledge.displayName}`,
    `- Registry kinds: ${list(knowledge.kinds)}`,
    `- Capabilities: ${list(knowledge.capabilities)}`,
    `- Inventory: ${knowledge.inventory.count}; held: ${knowledge.inventory.held}`,
  ];
  if (knowledge.item) {
    lines.push(`- Item: stack ${knowledge.item.stackSize}; durability ${knowledge.item.maxDurability ?? 'not durable'}`);
    if (knowledge.item.repairWith.length) lines.push(`- Repairs with: ${list(knowledge.item.repairWith)}`);
    if (knowledge.item.foodPoints) {
      lines.push(`- Food: ${knowledge.item.foodPoints} hunger points; saturation ${knowledge.item.saturation ?? 'unknown'}`);
    }
  }
  if (knowledge.block) {
    lines.push(`- Block: diggable ${knowledge.block.diggable}; hardness ${knowledge.block.hardness ?? 'unknown'}; material ${knowledge.block.material || 'unknown'}; collision ${knowledge.block.boundingBox || 'unknown'}`);
    lines.push(`- Drops: ${list(knowledge.block.drops)}`);
    lines.push(`- Valid harvest tools: ${list(knowledge.block.harvestTools, knowledge.block.diggable ? 'hand or no registry restriction' : 'none')}`);
    lines.push(`- Compatible tools carried: ${list(knowledge.block.carriedHarvestTools)}; held tool works: ${knowledge.block.heldCanHarvest}`);
    if (knowledge.block.lightEmitted > 0) lines.push(`- Emits light: ${knowledge.block.lightEmitted}`);
  }
  if (knowledge.recipes.length > 0) {
    lines.push('- Crafting recipes:');
    knowledge.recipes.forEach((recipe, index) => {
      const ingredients = Object.entries(recipe.ingredients)
        .map(([name, count]) => `${count} ${name}`)
        .join(' + ');
      lines.push(`  ${index + 1}. ${ingredients || 'no ingredients'} -> ${recipe.outputCount} ${knowledge.canonicalName}`);
    });
  } else if (knowledge.item) {
    lines.push('- Crafting recipes: none in the connected version (it may be gathered, smelted, traded, looted, or use another workstation).');
  }
  return lines.join('\n').slice(0, 4_000);
}
