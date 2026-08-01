import convoManager from '../conversation.js';
import { executeCommand } from '../commands/index.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { resolvePlayerTarget } from '../player-target.js';

const STARTUP_DELAY_MS = 5_000;
const MANUAL_COMMAND_GRACE_MS = 120_000;
const SUCCESS_COOLDOWN_MS = 15_000;
const FAILURE_COOLDOWN_MS = 60_000;
const TARGET_RETRY_MS = 5_000;
const SEARCH_STEP_DELAY_MS = 3_000;
const SEARCH_EXHAUSTED_COOLDOWN_MS = 120_000;
const RESOURCE_SCAN_RADIUS = 64;
const RESOURCE_SEARCH_STEP = 32;
const BALANCED_ROLE_WORK_RADIUS = 12;
// A remembered vein is only worth walking to if it is outside the radius the
// local scan just failed in, and close enough to still be cheaper than a fresh
// search. Ore is the only sighting worth this: trees are never scarce.
const REMEMBERED_RESOURCE_RANGE = 192;
const MIN_RELOCATION_DISTANCE = 24;

const CONTINUOUS_MOVEMENT_BEHAVIORS = new Set(['follow', 'guard']);
const RESOURCE_ROLES = new Set(['builder', 'lumberjack', 'miner']);
const RESOURCE_RELOCATION_CODES = new Set([
  'skill_resource_not_found',
  'skill_not_collected',
  'skill_unreachable',
  'skill_not_broken',
  'skill_path_timeout',
  'skill_collect_blocked',
  'skill_target_unloaded',
]);
const AUTONOMOUS_JOB_COMMANDS = Object.freeze({
  builder: '!collectWood(4)',
  lumberjack: '!collectWood(6)',
  miner: '!collectBlocks("cobblestone", 6)',
});
const RESOURCE_TARGETS = Object.freeze({
  builder: 'nearby tree cover',
  lumberjack: 'nearby tree cover',
  miner: 'exposed stone',
});
const ROLE_TOOL_REQUIREMENTS = Object.freeze({
  lumberjack: Object.freeze({ family: 'axe', starter: 'wooden_axe' }),
  miner: Object.freeze({ family: 'pickaxe', starter: 'wooden_pickaxe' }),
});

function boundedText(value, maximum = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function playerDistance(agent, player) {
  try {
    return agent.bot.entity.position.distanceTo(player.entity.position);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function visibleHumanPlayers(agent) {
  const botNames = new Set(convoManager.getInGameAgents());
  botNames.add(agent.name);
  return Object.entries(agent.bot?.players || {})
    .filter(([name, player]) => !botNames.has(name) && player?.entity)
    .map(([name, player]) => ({ name, entity: player.entity, distance: playerDistance(agent, player) }))
    .sort((left, right) => left.distance - right.distance);
}

function resolveLeader(agent) {
  const companion = agent.companion_context?.snapshot?.();
  if (companion?.presence === 'present' && companion.canonicalUsername) return companion.canonicalUsername;
  const assigned = boundedText(agent.runtime?.assignment?.leader, 16);
  if (assigned) {
    const resolved = resolvePlayerTarget(agent.bot, assigned, {
      knownBotNames: convoManager.getInGameAgents(),
    });
    if (resolved.entity) return resolved.canonical;
  }
  return visibleHumanPlayers(agent)[0]?.name || '';
}

function nearbyCombatTarget(agent, range = 16) {
  try {
    return world.getNearestEntityWhere(
      agent.bot,
      entity => mc.isCombatSafeHostile(entity),
      Math.max(1, Math.min(32, Number(range) || 16)),
    );
  } catch {
    return null;
  }
}

function scoutCommand(agent, { step = 10, sequence = null } = {}) {
  const position = agent.bot?.entity?.position;
  if (!position) return null;
  const activeSequence = Number.isInteger(sequence)
    ? sequence
    : agent.role_director?.sequence || 0;
  const offsets = [
    [step, 0],
    [0, step],
    [-step, 0],
    [0, -step],
  ];
  const [xOffset, zOffset] = offsets[activeSequence % offsets.length];
  return `!goToCoordinates(${Math.floor(position.x + xOffset)}, ${Math.floor(position.y)}, ${Math.floor(position.z + zOffset)}, 2)`;
}

function rememberedResourceRoute(agent, role) {
  if (role !== 'miner') return null;
  const origin = agent.bot?.entity?.position;
  if (!agent.landmark_memory?.recall || !origin) return null;
  let matches;
  try {
    matches = agent.landmark_memory.recall({
      bot: agent.bot,
      category: 'ore',
      dimension: agent.bot?.game?.dimension,
      origin,
      maxDistance: REMEMBERED_RESOURCE_RANGE,
      limit: 4,
    });
  } catch (error) {
    console.warn(`[role-director] Landmark recall failed safely: ${boundedText(error?.message || error)}`);
    return null;
  }
  if (!Array.isArray(matches)) return null;
  // The local scan already failed where the bot stands, so only a genuinely
  // different location is worth the walk.
  return matches.find(entry => Number(entry.distance) >= MIN_RELOCATION_DISTANCE) || null;
}

function missingRoleTool(agent, role) {
  const requirement = ROLE_TOOL_REQUIREMENTS[role];
  if (!requirement) return null;
  const available = agent.bot?.inventory?.items?.()
    ?.some(item => item.name.endsWith(`_${requirement.family}`));
  return available ? null : requirement.starter;
}

function chooseIntent(agent) {
  const role = agent.runtime?.role || 'companion';
  const autonomy = agent.runtime?.autonomy || 'balanced';
  const leader = resolveLeader(agent);

  if (role === 'companion') {
    if (!leader) return { blocked: 'waiting_for_player', target: null };
    return {
      command: `!followPlayer("${leader}", 4)`,
      target: leader,
      behavior: 'follow',
    };
  }

  if (role === 'defender') {
    if (!leader) return { blocked: 'waiting_for_player', target: null };
    return {
      command: `!guardPlayer("${leader}", 3)`,
      target: leader,
      behavior: 'guard',
    };
  }

  if (role === 'attacker') {
    const hostile = nearbyCombatTarget(agent, 16);
    if (hostile) {
      return {
        command: '!attackHostile',
        target: hostile.name || hostile.displayName || 'nearby hostile',
        behavior: 'attack',
      };
    }
    if (leader) {
      return {
        command: `!goToPlayer("${leader}", 4)`,
        target: leader,
        behavior: 'escort',
      };
    }
    return {
      command: scoutCommand(agent, { step: 8 }),
      target: 'nearby patrol',
      behavior: 'patrol',
    };
  }

  if (autonomy === 'balanced') {
    if (!leader) return { blocked: 'waiting_for_player', target: null };
    const resolvedLeader = resolvePlayerTarget(agent.bot, leader, {
      knownBotNames: convoManager.getInGameAgents(),
    });
    const distance = playerDistance(agent, { entity: resolvedLeader.entity });
    if (distance > BALANCED_ROLE_WORK_RADIUS) {
      return {
        command: `!goToPlayer("${leader}", 5)`,
        target: leader,
        behavior: 'regroup',
      };
    }
  }

  if (role === 'scout') {
    return { command: scoutCommand(agent), target: leader || 'nearby area', behavior: 'scout' };
  }

  if (
    autonomy === 'autonomous'
    && RESOURCE_ROLES.has(role)
    && agent.role_director?.resourceSearchPending
  ) {
    const remembered = rememberedResourceRoute(agent, role);
    if (remembered) {
      return {
        command: `!goToCoordinates(${remembered.x}, ${remembered.y}, ${remembered.z}, 3)`,
        target: `remembered ${remembered.name.replace(/_/g, ' ')}`,
        behavior: 'resource_search',
      };
    }
    const attempt = agent.role_director.resourceSearchAttempts;
    // Keep block scans at the skill's normal bounded radius. A much larger
    // synchronous world scan can starve bot telemetry. Move through reachable
    // terrain first, then let the next normal collection step rescan.
    const step = Math.min(
      RESOURCE_SEARCH_STEP + (attempt * 16),
      RESOURCE_SCAN_RADIUS,
    );
    return {
      command: `!moveAway(${step})`,
      target: `new ${RESOURCE_TARGETS[role] || 'resource'} search area`,
      behavior: 'resource_search',
    };
  }

  const requiredTool = missingRoleTool(agent, role);
  if (requiredTool) {
    return {
      command: `!prepareWoodenTool("${requiredTool}")`,
      target: requiredTool,
      behavior: 'tool_preparation',
    };
  }

  const command = AUTONOMOUS_JOB_COMMANDS[role];
  if (command) {
    return {
      command,
      target: RESOURCE_TARGETS[role] || leader || 'nearby area',
      behavior: role,
    };
  }
  return { blocked: 'no_safe_default', target: leader || null };
}

function shouldRelocateForResource(result) {
  return Boolean(
    result?.retryable === true
    && result?.evidence?.skill?.kind === 'collect'
    && RESOURCE_RELOCATION_CODES.has(result.code),
  );
}

export class RoleDirector {
  constructor(agent) {
    this.agent = agent;
    this.inFlight = false;
    this.sequence = 0;
    this.resourceSearchPending = false;
    this.resourceSearchAttempts = 0;
    this.resourceSearchExhaustedUntil = 0;
    this.nextDelayMs = null;
    this.nextAttemptAt = Date.now() + STARTUP_DELAY_MS;
    this.status = {
      phase: 'waiting',
      code: 'startup_delay',
      role: agent.runtime?.role || 'companion',
      target: null,
      evidence: 'Waiting for Minecraft spawn state to settle.',
      retryable: true,
      at: Date.now(),
    };
  }

  deferForManualCommand(reason = 'manual command') {
    this.nextAttemptAt = Math.max(this.nextAttemptAt, Date.now() + MANUAL_COMMAND_GRACE_MS);
    this.setStatus('suppressed', 'manual_command', null, reason, true);
  }

  setStatus(phase, code, target, evidence, retryable) {
    const next = {
      phase,
      code,
      role: this.agent.runtime?.role || 'companion',
      target: target || null,
      evidence: boundedText(evidence, 240),
      retryable: retryable === true,
    };
    const unchanged = this.status
      && Object.entries(next).every(([key, value]) => this.status[key] === value);
    if (unchanged) return;
    this.status = { ...next, at: Date.now() };
  }

  update() {
    if (this.agent.isOperatorHeld?.()) {
      this.setStatus('suppressed', 'operator_hold', null, this.agent.operator_hold_reason || 'Operator Stop is active.', false);
      return;
    }
    if (this.agent.runtime?.autonomy === 'command') {
      this.setStatus('suppressed', 'command_autonomy', null, 'Automatic role work is disabled for this profile.', false);
      return;
    }
    if (this.inFlight || !this.agent.isIdle() || !this.agent.self_prompter?.isStopped?.()) return;
    if (Date.now() < this.nextAttemptAt) return;
    if (Date.now() < this.resourceSearchExhaustedUntil) {
      this.setStatus(
        'waiting',
        'resource_search_exhausted',
        RESOURCE_TARGETS[this.agent.runtime?.role] || null,
        'The bounded resource search found no workable target. Waiting before another safe search.',
        true,
      );
      this.nextAttemptAt = this.resourceSearchExhaustedUntil;
      return;
    }

    const intent = chooseIntent(this.agent);
    if (!intent.command) {
      this.nextAttemptAt = Date.now() + TARGET_RETRY_MS;
      this.setStatus('waiting', intent.blocked || 'no_intent', intent.target, 'Waiting for a safe role target or explicit assignment.', true);
      return;
    }

    this.inFlight = true;
    this.sequence += 1;
    if (intent.behavior === 'resource_search') this.resourceSearchAttempts += 1;
    this.setStatus('acting', `role_${intent.behavior}`, intent.target, `Dispatching ${intent.behavior} through the verified command path.`, true);
    const previousActionId = this.agent.last_action_result?.actionId || null;

    void Promise.resolve(executeCommand(this.agent, intent.command, { owner: 'job' }))
      .then(() => {
        const result = this.agent.last_action_result;
        const changed = Boolean(result?.actionId && result.actionId !== previousActionId);
        const succeeded = changed && result.phase === 'succeeded';
        const activeFollow = CONTINUOUS_MOVEMENT_BEHAVIORS.has(intent.behavior) && !this.agent.isIdle();
        if (activeFollow) {
          this.setStatus('acting', `role_${intent.behavior}`, intent.target, 'Role movement is active.', true);
          return;
        }
        if (!changed) {
          this.setStatus('failed', 'missing_action_result', intent.target, 'The role command returned without a structured action result.', true);
          return;
        }
        if (intent.behavior === 'attack' && result.code === 'skill_no_combat_safe_threat') {
          this.nextDelayMs = TARGET_RETRY_MS;
          this.setStatus(
            'waiting',
            'combat_target_gone',
            intent.target,
            'The hostile left combat range before engagement. Returning to escort or patrol.',
            true,
          );
          return;
        }
        const role = this.agent.runtime?.role || 'companion';
        const recoveryBudget = Math.max(1, Math.min(6, Number(this.agent.runtime?.limits?.maxRecoveryAttempts) || 2));
        if (
          this.agent.runtime?.autonomy === 'autonomous'
          && RESOURCE_ROLES.has(role)
          && intent.behavior !== 'resource_search'
          && shouldRelocateForResource(result)
        ) {
          if (this.resourceSearchAttempts >= recoveryBudget) {
            this.resourceSearchPending = false;
            this.resourceSearchAttempts = 0;
            this.resourceSearchExhaustedUntil = Date.now() + SEARCH_EXHAUSTED_COOLDOWN_MS;
            this.nextDelayMs = SEARCH_EXHAUSTED_COOLDOWN_MS;
            this.setStatus(
              'waiting',
              'resource_search_exhausted',
              intent.target,
              `No workable ${RESOURCE_TARGETS[role] || 'resource'} was found after the bounded search.`,
              true,
            );
          } else {
            this.resourceSearchPending = true;
            this.nextDelayMs = SEARCH_STEP_DELAY_MS;
            this.setStatus(
              'recovering',
              'searching_for_resources',
              intent.target,
              `${result.detail || `No ${RESOURCE_TARGETS[role] || 'resource'} is reachable here.`} Relocating through safe pathfinding before retrying.`,
              true,
            );
          }
          return;
        }
        if (intent.behavior === 'resource_search') {
          if (succeeded) {
            this.resourceSearchPending = false;
            this.nextDelayMs = SEARCH_STEP_DELAY_MS;
            this.setStatus(
              'recovering',
              'resource_search_relocated',
              intent.target,
              'Reached a new search area. The next role step will rescan for usable resources.',
              true,
            );
          } else if (this.resourceSearchAttempts >= recoveryBudget) {
            this.resourceSearchPending = false;
            this.resourceSearchAttempts = 0;
            this.resourceSearchExhaustedUntil = Date.now() + SEARCH_EXHAUSTED_COOLDOWN_MS;
            this.nextDelayMs = SEARCH_EXHAUSTED_COOLDOWN_MS;
            this.setStatus(
              'waiting',
              'resource_search_exhausted',
              intent.target,
              'The bounded search routes were blocked. Waiting before another safe search.',
              true,
            );
          } else {
            this.resourceSearchPending = true;
            this.nextDelayMs = SEARCH_STEP_DELAY_MS;
            this.setStatus(
              'recovering',
              result.code || 'resource_search_blocked',
              intent.target,
              result.detail || 'This search route was blocked; another bounded direction will be tried.',
              true,
            );
          }
          return;
        }
        if (RESOURCE_ROLES.has(role) && succeeded) {
          this.resourceSearchPending = false;
          this.resourceSearchAttempts = 0;
          this.resourceSearchExhaustedUntil = 0;
        }
        this.setStatus(
          succeeded ? 'succeeded' : result.phase || 'failed',
          result.code || `role_${intent.behavior}`,
          intent.target,
          result.detail || result.evidence?.outcome || 'Role action finished.',
          result.retryable === true,
        );
      })
      .catch((error) => {
        this.setStatus('failed', 'role_dispatch_error', intent.target, error?.message || error, true);
      })
      .finally(() => {
        this.inFlight = false;
        const failed = !['succeeded', 'acting'].includes(this.status.phase);
        const delay = Number.isFinite(this.nextDelayMs)
          ? this.nextDelayMs
          : failed ? FAILURE_COOLDOWN_MS : SUCCESS_COOLDOWN_MS;
        this.nextDelayMs = null;
        this.nextAttemptAt = Date.now() + delay;
      });
  }
}
