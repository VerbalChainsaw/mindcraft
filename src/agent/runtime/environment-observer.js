import convoManager from '../conversation.js';
import * as mc from '../../utils/mcdata.js';
import { hasLineOfSightToEntity } from '../library/world.js';

const SAMPLE_INTERVAL_MS = 750;
const APPROACH_DISTANCE = 10;
const FAR_DISTANCE = 20;
const RETURN_ABSENCE_MS = 20_000;
const LOOK_DISTANCE = 8;
const LOOK_DOT_THRESHOLD = 0.92;
const LOOK_COOLDOWN_MS = 30_000;
const BLOCK_EVENT_COOLDOWN_MS = 15_000;
const MAX_TRACKED_PLAYERS = 64;
const STRUCTURE_PATTERN = /(?:crafting_table|furnace|chest|barrel|_bed|_portal|enchanting_table|anvil)$/;
const MEANINGFUL_TERRAIN_PATTERN = /(?:_ore|ancient_debris|lava|water|spawner|amethyst_cluster)$/;

function safeName(value, fallback = 'unknown') {
  return String(value || fallback)
    .replace(/[^A-Za-z0-9_. -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || fallback;
}

function distanceBetween(left, right) {
  try {
    const distance = left?.distanceTo?.(right);
    return Number.isFinite(distance) ? distance : Infinity;
  } catch {
    return Infinity;
  }
}

function targetForEntity(entity, origin) {
  const position = entity?.position;
  const name = safeName(entity?.username || entity?.name || entity?.displayName, 'entity');
  if (!position) return { name };
  return {
    name,
    x: position.x,
    y: position.y,
    z: position.z,
    distance: distanceBetween(origin, position),
  };
}

function nearbyWitnesses(agent, maximumDistance = 48) {
  const origin = agent.bot?.entity?.position;
  const names = [agent.name];
  for (const name of convoManager.getInGameAgents()) {
    if (name === agent.name) continue;
    const entity = agent.bot?.players?.[name]?.entity;
    if (entity?.position && distanceBetween(origin, entity.position) <= maximumDistance) names.push(name);
  }
  return names;
}

function isLookingAt(entity, targetPosition) {
  if (!entity?.position || !targetPosition || !Number.isFinite(entity.yaw)) return false;
  const dx = targetPosition.x - entity.position.x;
  const dz = targetPosition.z - entity.position.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return true;
  const facingX = -Math.sin(entity.yaw);
  const facingZ = Math.cos(entity.yaw);
  return ((facingX * dx) + (facingZ * dz)) / length >= LOOK_DOT_THRESHOLD;
}

function lineOfSight(bot, entity) {
  try {
    return hasLineOfSightToEntity(bot, entity);
  } catch {
    return null;
  }
}

export class EnvironmentObserver {
  constructor(agent, { now = Date.now } = {}) {
    this.agent = agent;
    this.now = now;
    this.nextSampleAt = 0;
    this.players = new Map();
    this.lastBlockEventAt = new Map();
  }

  publish(event) {
    this.agent.publishBehaviorEvent?.(event);
  }

  update() {
    const now = this.now();
    if (now < this.nextSampleAt) return;
    this.nextSampleAt = now + SAMPLE_INTERVAL_MS;
    const bot = this.agent.bot;
    const origin = bot?.entity?.position;
    if (!origin) return;

    const observed = new Set();
    for (const player of Object.values(bot.players || {})) {
      const entity = player?.entity;
      const name = safeName(player?.username || entity?.username, '');
      if (!name || name === this.agent.name || !entity?.position) continue;
      this.agent.companion_context?.observeLoadedPlayer?.(name, entity, {
        lineOfSight: lineOfSight(bot, entity),
        dimension: bot.game?.dimension,
      });
      observed.add(name);
      const distance = distanceBetween(origin, entity.position);
      const previous = this.players.get(name);
      const near = distance <= APPROACH_DISTANCE;
      const returned = Boolean(
        near
        && previous?.hasBeenNear
        && previous.farSince
        && now - previous.farSince >= RETURN_ABSENCE_MS
      );
      const approached = Boolean(near && (!previous || previous.distance > FAR_DISTANCE));
      if (returned || approached) {
        this.agent.companion_context?.requestAttention?.(returned ? 'player_returned' : 'player_approached');
        this.publish({
          id: `player-${returned ? 'returned' : 'approached'}-${name}-${Math.floor(now / 5_000)}`,
          type: returned ? 'player.returned' : 'player.approached',
          target: targetForEntity(entity, origin),
          salience: returned ? 3 : 2,
          witnesses: nearbyWitnesses(this.agent),
          timestamp: now,
        });
      }

      const lookedAt = distance <= LOOK_DISTANCE && isLookingAt(entity, origin);
      if (lookedAt && (!previous?.lastLookAt || now - previous.lastLookAt >= LOOK_COOLDOWN_MS)) {
        this.agent.companion_context?.requestAttention?.('player_looked');
        this.publish({
          id: `player-looked-${name}-${Math.floor(now / LOOK_COOLDOWN_MS)}`,
          type: 'player.looked',
          target: targetForEntity(entity, origin),
          salience: 2,
          witnesses: nearbyWitnesses(this.agent),
          timestamp: now,
        });
      }

      this.players.set(name, {
        distance,
        hasBeenNear: near || previous?.hasBeenNear === true,
        farSince: distance > FAR_DISTANCE
          ? previous?.farSince || now
          : returned || approached
            ? null
            : previous?.farSince || null,
        lastLookAt: lookedAt ? now : previous?.lastLookAt || 0,
        lastSeenAt: now,
      });
    }

    for (const [name, state] of this.players) {
      if (!observed.has(name) && !state.farSince) state.farSince = now;
    }
    if (this.players.size > MAX_TRACKED_PLAYERS) {
      const oldest = [...this.players.entries()]
        .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
        .slice(0, this.players.size - MAX_TRACKED_PLAYERS);
      for (const [name] of oldest) this.players.delete(name);
    }
  }

  observeEntityHurt(entity, source = null) {
    const origin = this.agent.bot?.entity?.position;
    if (!origin || !entity?.position || entity === this.agent.bot.entity) return;
    this.agent.companion_context?.observeProtectedHurt?.(entity, source);
    const target = targetForEntity(entity, origin);
    if (target.distance > 24) return;
    this.publish({
      id: `entity-hurt-${Number.isFinite(entity.id) ? entity.id : target.name}-${Math.floor(this.now() / 1_000)}`,
      type: 'entity.hurt',
      target,
      evidence: {
        code: source ? 'nearby_hurt_attributed' : 'nearby_hurt_unattributed',
        ...(source?.username || source?.name ? { sourceName: source.username || source.name } : {}),
        ...(Number.isFinite(source?.id) ? { sourceEntityId: source.id } : {}),
      },
      salience: target.distance <= 8 ? 4 : 3,
      witnesses: nearbyWitnesses(this.agent),
    });
  }

  observeEntityDead(entity) {
    const origin = this.agent.bot?.entity?.position;
    if (!origin || !entity?.position || entity === this.agent.bot.entity) return;
    const target = targetForEntity(entity, origin);
    if (target.distance > 32) return;
    this.publish({
      id: `entity-died-${Number.isFinite(entity.id) ? entity.id : target.name}`,
      type: 'entity.died',
      target,
      evidence: { code: 'nearby_death' },
      salience: 4,
      witnesses: nearbyWitnesses(this.agent),
    });
  }

  observeEntityGone(entity) {
    const origin = this.agent.bot?.entity?.position;
    if (!origin || !entity?.position || !mc.isHostile(entity)) return;
    const target = targetForEntity(entity, origin);
    if (target.distance > 32) return;
    this.publish({
      id: `threat-cleared-${Number.isFinite(entity.id) ? entity.id : target.name}`,
      type: 'threat.cleared',
      target,
      evidence: { code: 'left_observation_range' },
      salience: 3,
      witnesses: nearbyWitnesses(this.agent),
    });
  }

  observeEntitySpawn(entity) {
    const origin = this.agent.bot?.entity?.position;
    if (!origin || entity?.name !== 'item' || !entity.position) return;
    const distance = distanceBetween(origin, entity.position);
    if (distance > 16) return;
    let itemName = 'dropped_item';
    try {
      itemName = safeName(entity.getDroppedItem?.()?.name, itemName);
    } catch {
      // The item is still a factual dropped-item observation without subtype.
    }
    this.publish({
      id: `item-observed-${Number.isFinite(entity.id) ? entity.id : itemName}`,
      type: 'observation.item',
      target: {
        name: itemName,
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
        distance,
      },
      salience: /(?:diamond|netherite|emerald|totem)/.test(itemName) ? 4 : 2,
      witnesses: nearbyWitnesses(this.agent),
    });
  }

  observeBlockUpdate(oldBlock, newBlock) {
    const block = newBlock || oldBlock;
    const origin = this.agent.bot?.entity?.position;
    if (!origin || !block?.position || oldBlock?.name === newBlock?.name) return;
    const distance = distanceBetween(origin, block.position);
    if (distance > 16) return;
    const name = safeName(newBlock?.name || oldBlock?.name, 'terrain');
    const type = STRUCTURE_PATTERN.test(name)
      ? 'observation.structure'
      : MEANINGFUL_TERRAIN_PATTERN.test(name)
        ? 'observation.terrain'
        : null;
    if (!type) return;
    const key = `${type}:${block.position.x}:${block.position.y}:${block.position.z}:${name}`;
    const now = this.now();
    if (now - (this.lastBlockEventAt.get(key) || 0) < BLOCK_EVENT_COOLDOWN_MS) return;
    this.lastBlockEventAt.set(key, now);
    if (this.lastBlockEventAt.size > 256) this.lastBlockEventAt.delete(this.lastBlockEventAt.keys().next().value);
    this.publish({
      id: `block-observed-${block.position.x}-${block.position.y}-${block.position.z}-${name}-${Math.floor(now / BLOCK_EVENT_COOLDOWN_MS)}`,
      type,
      target: {
        name,
        x: block.position.x,
        y: block.position.y,
        z: block.position.z,
        distance,
      },
      salience: /(?:diamond|ancient_debris|lava|spawner)/.test(name) ? 4 : 2,
      witnesses: nearbyWitnesses(this.agent),
      timestamp: now,
    });
  }
}
