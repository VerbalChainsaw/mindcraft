import { executeCommand as executeAgentCommand } from '../commands/index.js';
import { BehaviorDirector } from './behavior-director.js';
import { evaluateGameplayProgression } from './gameplay-progression.js';

// `evaluateGameplayProgression` already derives a truthful survival ladder from
// live evidence, but until now it was only ever rendered as advice text for the
// language model. Nothing deterministic acted on it, so an autonomous bot had no
// arc of its own: it survived, ground out its role's work order, and otherwise
// stood still. This director gives that ladder somewhere to go.
const SUCCESS_COOLDOWN_MS = 1_500;
const FAILURE_COOLDOWN_MS = 20_000;
const BLOCKED_COOLDOWN_MS = 60_000;
const DORMANT_COOLDOWN_MS = 300_000;
const WORKSTATION_RANGE = 16;
const MAX_CONSECUTIVE_FAILURES = 3;

// Only bounded, local acquisition steps may run unsupervised. Dimension travel,
// exploration quests, death recovery, and combat are deliberately excluded: a
// bot must never decide on its own to walk into the Nether while its player is
// standing next to it. Those remain explicit player commands.
const SELF_DIRECTED_COMMANDS = Object.freeze(new Set([
  '!collectWood',
  '!collectWoodInRange',
  '!collectBlocks',
  '!collectBlocksInRange',
  '!prepareMaterial',
  '!prepareTool',
  '!prepareWoodenTool',
  '!prepareFood',
  '!craftRecipe',
  '!smeltItem',
]));

const NEARBY_WORKSTATIONS = Object.freeze(['crafting_table', 'furnace', 'nether_portal']);

function commandName(command) {
  return String(command || '').match(/^![A-Za-z0-9_]+/)?.[0] || '';
}

function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot?.inventory?.items?.() || []) {
    if (!item?.name) continue;
    counts[item.name] = (counts[item.name] || 0) + Math.max(0, Number(item.count) || 0);
  }
  return counts;
}

function nearbyWorkstations(bot) {
  const blocks = [];
  if (typeof bot?.findBlock !== 'function') return blocks;
  for (const name of NEARBY_WORKSTATIONS) {
    const id = bot.registry?.blocksByName?.[name]?.id;
    if (!Number.isInteger(id)) continue;
    try {
      if (bot.findBlock({ matching: id, maxDistance: WORKSTATION_RANGE })) {
        blocks.push({ name, count: 1 });
      }
    } catch {
      // An unavailable chunk simply means the workstation is not proven nearby.
    }
  }
  return blocks;
}

/**
 * The minimum state `evaluateGameplayProgression` reads. Deliberately not the
 * full world snapshot: that performs wide scans and is far too heavy to build
 * on a behavior tick.
 */
export function progressionSnapshot(agent) {
  const bot = agent?.bot;
  return {
    inventory: { counts: inventoryCounts(bot) },
    perception: {
      usefulBlocks: nearbyWorkstations(bot),
      // Threat and hazard proximity belong to the survival and reflex lanes,
      // which sit above this one. Leaving them empty here keeps the safety
      // override driven purely by health and hunger, so the two lanes cannot
      // fight over the same decision.
      hostiles: [],
      hazards: [],
    },
    gameplay: {
      health: Number(bot?.health),
      hunger: Number(bot?.food),
      dimension: bot?.game?.dimension,
    },
    action: { lastResult: agent?.last_action_result || null },
    memory: {},
  };
}

export class ProgressionDirector extends BehaviorDirector {
  constructor(agent, {
    executeCommand = executeAgentCommand,
    getSnapshot = progressionSnapshot,
    evaluate = evaluateGameplayProgression,
    now = Date.now,
  } = {}) {
    super(agent, { name: 'progression' });
    this.executeProgressionCommand = executeCommand;
    this.getSnapshot = getSnapshot;
    this.evaluate = evaluate;
    this.now = now;
    this.consecutiveFailures = 0;
    this.lastStage = null;
    this.plan = null;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      stage: this.plan?.currentStage || null,
      nextMilestone: this.plan?.nextMilestone || null,
      completedMilestones: this.plan?.completedMilestones ?? null,
      totalMilestones: this.plan?.totalMilestones ?? null,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /** Self-directed progression is what `autonomous` is supposed to mean. */
  permitted() {
    return this.agent?.runtime?.autonomy === 'autonomous';
  }

  update() {
    if (!this.permitted() || !this.canSchedule()) return;

    let plan;
    try {
      plan = this.evaluate(this.getSnapshot(this.agent));
    } catch (error) {
      this.fail('progression_snapshot_failed', error?.message || error, true);
      this.nextEligibleAt = this.now() + FAILURE_COOLDOWN_MS;
      return;
    }
    if (!plan || typeof plan !== 'object') {
      this.defer('Progression produced no usable plan.', DORMANT_COOLDOWN_MS);
      return;
    }
    this.plan = plan;

    // Health and hunger overrides belong to the survival lane above this one.
    if (plan.safetyOverride) {
      this.defer('Survival upkeep owns the current decision.', BLOCKED_COOLDOWN_MS);
      return;
    }

    const command = typeof plan.recommendedCommand === 'string' ? plan.recommendedCommand : '';
    const selected = commandName(command);
    if (!selected || !SELF_DIRECTED_COMMANDS.has(selected)) {
      // The ladder has reached a milestone that needs a player's say-so. Go
      // quiet rather than looping on a step this lane may not take.
      this.defer(
        plan.nextMilestone
          ? `${plan.nextMilestone} needs an explicit order.`
          : 'No self-directed progression step is available.',
        DORMANT_COOLDOWN_MS,
      );
      return;
    }
    if (this.agent.blocked_actions?.includes(selected)) {
      this.defer(`${selected} is disabled for this bot.`, DORMANT_COOLDOWN_MS);
      return;
    }
    if (plan.currentStage !== this.lastStage) {
      this.consecutiveFailures = 0;
      this.lastStage = plan.currentStage;
    }
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.consecutiveFailures = 0;
      this.defer(`${plan.nextMilestone || 'This step'} is not making progress.`, DORMANT_COOLDOWN_MS);
      return;
    }

    const target = { name: String(plan.currentStage || 'progression').slice(0, 64) };
    if (!this.begin(`progression_${plan.currentStage || 'step'}`, target, plan.nextOperation || '')) return;
    const previousActionId = this.agent.last_action_result?.actionId || null;

    void Promise.resolve(this.executeProgressionCommand(this.agent, command, { owner: 'autonomy' }))
      .then(() => {
        const result = this.agent.last_action_result;
        if (!result?.actionId || result.actionId === previousActionId) {
          this.consecutiveFailures += 1;
          this.fail('missing_action_result', 'Progression step returned without a new structured result.', true);
          this.nextEligibleAt = this.now() + FAILURE_COOLDOWN_MS;
          return;
        }
        const succeeded = result.phase === 'succeeded';
        this.consecutiveFailures = succeeded ? 0 : this.consecutiveFailures + 1;
        this.finish({
          phase: succeeded ? 'succeeded' : result.phase || 'failed',
          code: result.code || `progression_${plan.currentStage || 'step'}`,
          target,
          detail: result.detail || plan.nextOperation || '',
          retryable: result.retryable === true,
        });
        this.nextEligibleAt = this.now() + (succeeded ? SUCCESS_COOLDOWN_MS : FAILURE_COOLDOWN_MS);
      })
      .catch(error => {
        this.consecutiveFailures += 1;
        this.fail('progression_dispatch_error', error?.message || error, true);
        this.nextEligibleAt = this.now() + FAILURE_COOLDOWN_MS;
      });
  }
}
