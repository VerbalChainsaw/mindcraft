// Generated from the complete minecraft:smelting recipe set bundled with the
// locally managed Paper 1.21.11 runtime. Keep this repository-owned catalogue
// versioned with the supported server; connected-registry filtering below makes
// entries fail closed when an older runtime does not know an item.
const INPUTS_BY_OUTPUT = Object.freeze(Object.fromEntries(
  Object.entries({
  "baked_potato": [
    "potato"
  ],
  "black_glazed_terracotta": [
    "black_terracotta"
  ],
  "blue_glazed_terracotta": [
    "blue_terracotta"
  ],
  "brick": [
    "clay_ball"
  ],
  "brown_glazed_terracotta": [
    "brown_terracotta"
  ],
  "charcoal": [
    "acacia_log",
    "acacia_wood",
    "birch_log",
    "birch_wood",
    "cherry_log",
    "cherry_wood",
    "dark_oak_log",
    "dark_oak_wood",
    "jungle_log",
    "jungle_wood",
    "mangrove_log",
    "mangrove_wood",
    "oak_log",
    "oak_wood",
    "pale_oak_log",
    "pale_oak_wood",
    "spruce_log",
    "spruce_wood",
    "stripped_acacia_log",
    "stripped_acacia_wood",
    "stripped_birch_log",
    "stripped_birch_wood",
    "stripped_cherry_log",
    "stripped_cherry_wood",
    "stripped_dark_oak_log",
    "stripped_dark_oak_wood",
    "stripped_jungle_log",
    "stripped_jungle_wood",
    "stripped_mangrove_log",
    "stripped_mangrove_wood",
    "stripped_oak_log",
    "stripped_oak_wood",
    "stripped_pale_oak_log",
    "stripped_pale_oak_wood",
    "stripped_spruce_log",
    "stripped_spruce_wood"
  ],
  "coal": [
    "coal_ore",
    "deepslate_coal_ore"
  ],
  "cooked_beef": [
    "beef"
  ],
  "cooked_chicken": [
    "chicken"
  ],
  "cooked_cod": [
    "cod"
  ],
  "cooked_mutton": [
    "mutton"
  ],
  "cooked_porkchop": [
    "porkchop"
  ],
  "cooked_rabbit": [
    "rabbit"
  ],
  "cooked_salmon": [
    "salmon"
  ],
  "copper_ingot": [
    "copper_ore",
    "deepslate_copper_ore",
    "raw_copper"
  ],
  "copper_nugget": [
    "copper_axe",
    "copper_boots",
    "copper_chestplate",
    "copper_helmet",
    "copper_hoe",
    "copper_horse_armor",
    "copper_leggings",
    "copper_nautilus_armor",
    "copper_pickaxe",
    "copper_shovel",
    "copper_spear",
    "copper_sword"
  ],
  "cracked_deepslate_bricks": [
    "deepslate_bricks"
  ],
  "cracked_deepslate_tiles": [
    "deepslate_tiles"
  ],
  "cracked_nether_bricks": [
    "nether_bricks"
  ],
  "cracked_polished_blackstone_bricks": [
    "polished_blackstone_bricks"
  ],
  "cracked_stone_bricks": [
    "stone_bricks"
  ],
  "cyan_glazed_terracotta": [
    "cyan_terracotta"
  ],
  "deepslate": [
    "cobbled_deepslate"
  ],
  "diamond": [
    "deepslate_diamond_ore",
    "diamond_ore"
  ],
  "dried_kelp": [
    "kelp"
  ],
  "emerald": [
    "deepslate_emerald_ore",
    "emerald_ore"
  ],
  "glass": [
    "red_sand",
    "sand"
  ],
  "gold_ingot": [
    "deepslate_gold_ore",
    "gold_ore",
    "nether_gold_ore",
    "raw_gold"
  ],
  "gold_nugget": [
    "golden_axe",
    "golden_boots",
    "golden_chestplate",
    "golden_helmet",
    "golden_hoe",
    "golden_horse_armor",
    "golden_leggings",
    "golden_nautilus_armor",
    "golden_pickaxe",
    "golden_shovel",
    "golden_spear",
    "golden_sword"
  ],
  "gray_glazed_terracotta": [
    "gray_terracotta"
  ],
  "green_dye": [
    "cactus"
  ],
  "green_glazed_terracotta": [
    "green_terracotta"
  ],
  "iron_ingot": [
    "deepslate_iron_ore",
    "iron_ore",
    "raw_iron"
  ],
  "iron_nugget": [
    "chainmail_boots",
    "chainmail_chestplate",
    "chainmail_helmet",
    "chainmail_leggings",
    "iron_axe",
    "iron_boots",
    "iron_chestplate",
    "iron_helmet",
    "iron_hoe",
    "iron_horse_armor",
    "iron_leggings",
    "iron_nautilus_armor",
    "iron_pickaxe",
    "iron_shovel",
    "iron_spear",
    "iron_sword"
  ],
  "lapis_lazuli": [
    "deepslate_lapis_ore",
    "lapis_ore"
  ],
  "leaf_litter": [
    "acacia_leaves",
    "azalea_leaves",
    "birch_leaves",
    "cherry_leaves",
    "dark_oak_leaves",
    "flowering_azalea_leaves",
    "jungle_leaves",
    "mangrove_leaves",
    "oak_leaves",
    "pale_oak_leaves",
    "spruce_leaves"
  ],
  "light_blue_glazed_terracotta": [
    "light_blue_terracotta"
  ],
  "light_gray_glazed_terracotta": [
    "light_gray_terracotta"
  ],
  "lime_dye": [
    "sea_pickle"
  ],
  "lime_glazed_terracotta": [
    "lime_terracotta"
  ],
  "magenta_glazed_terracotta": [
    "magenta_terracotta"
  ],
  "nether_brick": [
    "netherrack"
  ],
  "netherite_scrap": [
    "ancient_debris"
  ],
  "orange_glazed_terracotta": [
    "orange_terracotta"
  ],
  "pink_glazed_terracotta": [
    "pink_terracotta"
  ],
  "popped_chorus_fruit": [
    "chorus_fruit"
  ],
  "purple_glazed_terracotta": [
    "purple_terracotta"
  ],
  "quartz": [
    "nether_quartz_ore"
  ],
  "red_glazed_terracotta": [
    "red_terracotta"
  ],
  "redstone": [
    "deepslate_redstone_ore",
    "redstone_ore"
  ],
  "resin_brick": [
    "resin_clump"
  ],
  "smooth_basalt": [
    "basalt"
  ],
  "smooth_quartz": [
    "quartz_block"
  ],
  "smooth_red_sandstone": [
    "red_sandstone"
  ],
  "smooth_sandstone": [
    "sandstone"
  ],
  "smooth_stone": [
    "stone"
  ],
  "sponge": [
    "wet_sponge"
  ],
  "stone": [
    "cobblestone"
  ],
  "terracotta": [
    "clay"
  ],
  "white_glazed_terracotta": [
    "white_terracotta"
  ],
  "yellow_glazed_terracotta": [
    "yellow_terracotta"
  ]
}).map(([output, inputs]) => [output, Object.freeze(inputs)]),
));

const OUTPUT_BY_INPUT = Object.freeze(Object.fromEntries(
  Object.entries(INPUTS_BY_OUTPUT).flatMap(([output, inputs]) => (
    inputs.map(input => [input, output])
  )),
));

function canonicalName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function smeltingInputsForOutput(outputName, registry = null) {
  const inputs = INPUTS_BY_OUTPUT[canonicalName(outputName)] || [];
  if (!registry?.itemsByName) return [...inputs];
  return inputs.filter(name => Boolean(registry.itemsByName[name]));
}

export function isSmeltingInput(inputName, registry = null) {
  const input = canonicalName(inputName);
  if (!input || (registry?.itemsByName && !registry.itemsByName[input])) return false;
  return Boolean(OUTPUT_BY_INPUT[input]);
}

export function smeltingOutputForInput(inputName, registry = null) {
  const input = canonicalName(inputName);
  if (!input || (registry?.itemsByName && !registry.itemsByName[input])) return null;
  const output = OUTPUT_BY_INPUT[input] || null;
  if (output && registry?.itemsByName && !registry.itemsByName[output]) return null;
  return output;
}
