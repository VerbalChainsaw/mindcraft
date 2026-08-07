function entryId(entry) {
  if (entry == null) return -1;
  return typeof entry === 'number' ? entry : Number(entry.id);
}

function itemName(registry, entry) {
  const id = entryId(entry);
  return id < 0 ? null : registry?.items?.[id]?.name || null;
}

function isPlank(name) {
  return typeof name === 'string' && name.endsWith('_planks');
}

function recipeEntries(recipe) {
  if (Array.isArray(recipe?.inShape)) return recipe.inShape.flat();
  return Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
}

function entryCount(entry) {
  return typeof entry === 'number'
    ? 1
    : Math.max(1, Math.abs(Number(entry?.count) || 1));
}

function familySignature(registry, recipe) {
  const shape = Array.isArray(recipe?.inShape)
    ? recipe.inShape.map(row => row.map(entry => {
      const name = itemName(registry, entry);
      return isPlank(name) ? '#planks' : entryId(entry);
    }))
    : null;
  const ingredients = !shape && Array.isArray(recipe?.ingredients)
    ? recipe.ingredients.map(entry => {
      const name = itemName(registry, entry);
      return isPlank(name) ? '#planks' : entryId(entry);
    }).sort()
    : null;
  return JSON.stringify({
    shape,
    ingredients,
    result: {
      id: entryId(recipe?.result),
      count: Math.max(1, Number(recipe?.result?.count) || 1),
    },
  });
}

function cloneEntry(entry, replacementId = null) {
  if (entry == null) return null;
  const id = replacementId ?? entryId(entry);
  if (typeof entry === 'number') return { id, count: 1, metadata: null };
  return { ...entry, id };
}

function cloneRecipe(recipe) {
  return {
    ...recipe,
    result: recipe?.result ? { ...recipe.result } : recipe?.result,
    inShape: Array.isArray(recipe?.inShape)
      ? recipe.inShape.map(row => row.map(entry => cloneEntry(entry)))
      : null,
    ingredients: Array.isArray(recipe?.ingredients)
      ? recipe.ingredients.map(entry => cloneEntry(entry))
      : null,
    outShape: Array.isArray(recipe?.outShape)
      ? recipe.outShape.map(row => row.map(entry => cloneEntry(entry)))
      : recipe?.outShape || null,
  };
}

function plankFamilyGroups(registry, recipes) {
  const groups = new Map();
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const plankNames = recipeEntries(recipe)
      .map(entry => itemName(registry, entry))
      .filter(isPlank);
    if (plankNames.length === 0) continue;
    const key = familySignature(registry, recipe);
    const group = groups.get(key) || [];
    group.push({ recipe, plankNames });
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter(group => new Set(group.flatMap(entry => entry.plankNames)).size >= 2)
    .sort((left, right) => right.length - left.length);
}

/**
 * Minecraft-data expands the vanilla #planks tag into one recipe per species.
 * Preserve that shape while recording the shared family contract so planning
 * can consume mixed carried planks truthfully.
 */
export function createPlankFamilyRecipe(registry, recipes) {
  const group = plankFamilyGroups(registry, recipes)[0];
  if (!group) return null;
  const recipe = cloneRecipe(group[0].recipe);
  const members = [...new Set(group.flatMap(entry => entry.plankNames))].sort();
  const count = recipeEntries(recipe)
    .filter(entry => isPlank(itemName(registry, entry)))
    .reduce((total, entry) => total + entryCount(entry), 0);
  if (count < 1) return null;
  recipe.mindcraftIngredientFamily = Object.freeze({
    name: 'planks',
    count,
    members: Object.freeze(members),
  });
  return recipe;
}

/**
 * minecraft-data expands one #planks recipe into one equivalent recipe per
 * wood species. Expose those equivalent groups so the planner can bind their
 * species-dependent plank prerequisite once before it expands unrelated
 * shared ingredients.
 */
export function plankRecipeAlternativeGroups(registry, recipes) {
  return plankFamilyGroups(registry, recipes)
    .map(group => Object.freeze(group.map(entry => entry.recipe)));
}

export function carriedPlankCount(items) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => (
    isPlank(item?.name)
      ? total + Math.max(0, Number(item.count) || 0)
      : total
  ), 0);
}

/** Bind each #planks slot to a concrete carried item for one physical craft. */
export function bindCarriedPlankRecipe(registry, recipe, items) {
  const family = recipe?.mindcraftIngredientFamily;
  if (family?.name !== 'planks') return null;
  const available = (Array.isArray(items) ? items : [])
    .filter(item => isPlank(item?.name) && Number(item.count) > 0)
    .map(item => ({
      name: item.name,
      id: Number(item.type ?? registry?.itemsByName?.[item.name]?.id),
      count: Math.max(0, Number(item.count) || 0),
    }))
    .filter(item => Number.isInteger(item.id))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  if (available.reduce((sum, item) => sum + item.count, 0) < family.count) return null;

  const bound = cloneRecipe(recipe);
  const bindEntry = entry => {
    if (!isPlank(itemName(registry, entry))) return cloneEntry(entry);
    const selected = available.find(item => item.count > 0);
    if (!selected) return null;
    selected.count -= 1;
    return cloneEntry(entry, selected.id);
  };
  if (Array.isArray(bound.inShape)) {
    bound.inShape = bound.inShape.map(row => row.map(bindEntry));
  } else if (Array.isArray(bound.ingredients)) {
    bound.ingredients = bound.ingredients.map(bindEntry);
  }
  return bound;
}

export function isPlankFamilyRecipe(recipe) {
  return recipe?.mindcraftIngredientFamily?.name === 'planks';
}
