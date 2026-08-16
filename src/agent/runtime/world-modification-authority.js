import { isProtectedGameplayBlock } from './gameplay-safety.js';
import Vec3 from 'vec3';

const AUTHORITY_SCHEMA_VERSION = 1;
const SITE_EVIDENCE_LIMIT = 16;
const CRAFTED_SITE_PATTERN = /(?:_planks|_bricks?|_concrete|_wool|_carpet|_terracotta|_glazed_terracotta|_stairs|_slab|_fence|_wall|_door|_trapdoor|_copper|_tiles|_glass|_glass_pane)$/;
const CRAFTED_SITE_BLOCKS = new Set([
  'bricks', 'bookshelf', 'crafting_table', 'furnace', 'blast_furnace', 'smoker',
  'chest', 'trapped_chest', 'barrel', 'enchanting_table', 'ender_chest',
  'quartz_block', 'iron_block', 'gold_block', 'diamond_block', 'netherite_block',
  'bed', 'ladder', 'lantern', 'soul_lantern', 'torch', 'soul_torch', 'beacon',
]);

function finiteCell(position) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  };
}

export function isPlayerBuildEvidence(blockOrName) {
  const name = typeof blockOrName === 'string'
    ? blockOrName
    : String(blockOrName?.name || '');
  if (!name) return false;
  return isProtectedGameplayBlock(name)
    || CRAFTED_SITE_BLOCKS.has(name)
    || CRAFTED_SITE_PATTERN.test(name)
    || name.endsWith('_bed')
    || name.endsWith('_sign')
    || name.endsWith('_hanging_sign');
}

/**
 * Bounded spatial evidence, not ownership inference. Manufactured or
 * functional blocks prove a protected site; fully loaded natural-looking
 * terrain proves only that this local read found no build evidence. Unloaded
 * cells remain unknown.
 */
export function observeLocalModificationSite(bot, position, { radius = 3 } = {}) {
  const origin = finiteCell(position);
  if (!origin || typeof bot?.blockAt !== 'function') {
    return Object.freeze({ state: 'unknown', origin, inspected: 0, unloaded: 0, evidence: Object.freeze([]) });
  }
  const boundedRadius = Math.max(1, Math.min(6, Math.floor(Number(radius) || 3)));
  const evidence = [];
  let inspected = 0;
  let unloaded = 0;
  for (let x = origin.x - boundedRadius; x <= origin.x + boundedRadius; x += 1) {
    for (let z = origin.z - boundedRadius; z <= origin.z + boundedRadius; z += 1) {
      for (let y = origin.y - 1; y <= origin.y + 2; y += 1) {
        inspected += 1;
        let block = null;
        try {
          block = bot.blockAt(new Vec3(x, y, z));
        } catch {
          unloaded += 1;
          continue;
        }
        if (!block) {
          unloaded += 1;
          continue;
        }
        if (isPlayerBuildEvidence(block) && evidence.length < SITE_EVIDENCE_LIMIT) {
          evidence.push(Object.freeze({ name: block.name, x, y, z }));
        }
      }
    }
  }
  return Object.freeze({
    state: evidence.length > 0 ? 'protected' : unloaded > 0 ? 'unknown' : 'natural_observed',
    origin: Object.freeze(origin),
    radius: boundedRadius,
    inspected,
    unloaded,
    evidence: Object.freeze(evidence),
  });
}

export function assessWorldModificationAuthority({ purpose, mutation, site } = {}) {
  const siteState = ['protected', 'unknown', 'natural_observed'].includes(site?.state)
    ? site.state
    : 'unknown';
  const allowed = siteState === 'natural_observed';
  return Object.freeze({
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    allowed,
    code: allowed
      ? 'natural_site_authorized'
      : siteState === 'protected' ? 'protected_site' : 'site_authority_unknown',
    purpose: String(purpose || 'world_modification').slice(0, 64),
    mutation: String(mutation || 'unknown').slice(0, 64),
    site: site || Object.freeze({ state: 'unknown' }),
  });
}

export function observeWorldModificationAuthority(bot, position, options = {}) {
  return assessWorldModificationAuthority({
    purpose: options.purpose,
    mutation: options.mutation,
    site: observeLocalModificationSite(bot, position, options),
  });
}

export const WORLD_MODIFICATION_AUTHORITY_VERSION = AUTHORITY_SCHEMA_VERSION;
