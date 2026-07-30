import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js';
import convoManager from './conversation.js';

function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    void Promise.resolve()
        .then(() => agent.openChat(message))
        .catch(error => {
            console.error(`[mode:narration] Failed to send behavior chat: ${String(error?.message || error).slice(0, 512)}`);
        });
}

const DEFAULT_UNSTUCK_TIMEOUT_MS = 10_000;
const DEFAULT_REFLEX_RETRY_MS = 1_500;
const RECENT_DAMAGE_WINDOW_MS = 4_000;
const LOW_HEALTH_RETREAT_THRESHOLD = 10;
const SEVERE_DAMAGE_MINIMUM = 4;
const SURVIVAL_RETREAT_DISTANCE = 24;
const SURVIVAL_FALLBACK_DISTANCE = 12;
const SURVIVAL_RETREAT_COOLDOWN_MS = 4_000;
const DROWNING_REFLEX_OXYGEN = 12;
const FALL_REFLEX_VELOCITY = -0.7;
const SELF_DEFENSE_RANGE = 8;
const COMBAT_PRIORITY_ROLES = new Set(['defender', 'attacker']);

function isExplicitGuardOrder(agent) {
    return agent?.actions?.currentActionLabel === 'action:guardPlayer';
}

function hasCombatPriorityThreat(agent) {
    try {
        const threat = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16);
        return Boolean(threat && mc.isCombatSafeHostile(threat));
    } catch {
        // A transient entity-list read must never block the safety scheduler.
        return false;
    }
}

function getRecentDamageCombatThreat(agent) {
    const bot = agent?.bot;
    const elapsed = Date.now() - Number(bot?.lastDamageTime);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RECENT_DAMAGE_WINDOW_MS) return null;
    try {
        // This is bounded proximity correlation only; it does not attribute the damage to the hostile.
        return world.getNearestEntityWhere(bot, entity => mc.isCombatSafeHostile(entity), SELF_DEFENSE_RANGE);
    } catch {
        return null;
    }
}

function getAttributedProtectionThreat(agent) {
    return agent?.companion_context?.protectionThreat?.() || null;
}

function getModeSuppressionReason(agent, mode) {
    if (!agent || !mode) return null;
    if (agent.isOperatorHeld?.() && mode.name !== 'self_preservation') {
        return 'operator_hold';
    }

    const explicitlyGuarding = isExplicitGuardOrder(agent);
    const authorizedRecovery = mode.name === 'unstuck'
        && agent.actions?.executing === true
        && ['player', 'job', 'survival'].includes(agent.actions.currentActionOwner);
    if (agent.runtime?.autonomy === 'command'
        && mode.name !== 'self_preservation'
        && mode.name !== 'idle_staring'
        && mode.name !== 'elbow_room'
        && !authorizedRecovery
        && !(mode.name === 'self_defense'
            && (getAttributedProtectionThreat(agent) || getRecentDamageCombatThreat(agent)))) {
        return 'command_autonomy';
    }

    // A defender/attacker (or a bot explicitly ordered to guard) must not
    // immediately flee before its self-defense reflex gets a chance to act.
    // Self-preservation remains earlier in the mode list and still wins when
    // the bot is actually in danger.
    if (mode.name === 'cowardice'
        && (COMBAT_PRIORITY_ROLES.has(agent.runtime?.role) || explicitlyGuarding)
        && hasCombatPriorityThreat(agent)) {
        return 'combat_priority';
    }

    return null;
}

function isExpectedPathCancellation(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    return name === 'PathStopped' || /path (?:was )?stopped before it could be completed/i.test(message);
}

function stopUnstuckMotion(agent, { interrupt = true } = {}) {
    if (interrupt) {
        try {
            agent.requestInterrupt();
        } catch (error) {
            console.error(`[mode:unstuck] Failed to interrupt movement: ${String(error?.message || error).slice(0, 512)}`);
        }
    }
    try {
        agent.bot.clearControlStates();
    } catch (error) {
        console.error(`[mode:unstuck] Failed to clear control state: ${String(error?.message || error).slice(0, 512)}`);
    }
}

export async function runBoundedUnstuckRecovery(agent, {
    moveAway = skills.moveAway,
    timeoutMs = DEFAULT_UNSTUCK_TIMEOUT_MS,
} = {}) {
    const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_UNSTUCK_TIMEOUT_MS;
    let timeoutId;
    const movement = Promise.resolve()
        .then(() => moveAway(agent.bot, 5))
        .then(
            moved => moved === false
                ? { state: 'unmoved', reason: agent.bot.lastActionEvidence?.outcome || 'no safe retreat path' }
                : { state: 'moved' },
            error => ({ state: 'failed', error }),
        );
    const deadline = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({ state: 'timed-out' }), boundedTimeoutMs);
    });

    const outcome = await Promise.race([movement, deadline]);
    clearTimeout(timeoutId);

    if (outcome.state === 'timed-out') {
        stopUnstuckMotion(agent);
        return { success: false, reason: 'timed-out' };
    }
    if (outcome.state === 'failed') {
        if (isExpectedPathCancellation(outcome.error)) {
            stopUnstuckMotion(agent);
            return { success: false, reason: 'interrupted' };
        }
        throw outcome.error;
    }
    if (outcome.state === 'unmoved') {
        stopUnstuckMotion(agent, { interrupt: false });
        return { success: false, reason: outcome.reason };
    }
    return { success: true, reason: null };
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'red_sand', 'gravel'],
        last_retreat_at: 0,
        update: function (agent) {
            const bot = agent.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            const oxygen = Number(bot.oxygenLevel);
            const isFalling = !bot.entity.onGround
                && !bot.entity.isInWater
                && !bot.entity.isInLava
                && Number(bot.entity.velocity?.y) <= FALL_REFLEX_VELOCITY;
            if (blockAbove.name === 'water' && Number.isFinite(oxygen) && oxygen <= DROWNING_REFLEX_OXYGEN) {
                say(agent, 'I need air!');
                void execute(this, agent, async () => {
                    return await skills.escapeDrowning(bot);
                });
            }
            else if (isFalling) {
                void execute(this, agent, async () => {
                    return await skills.stabilizeFall(bot);
                });
            }
            else if (
                this.fall_blocks.includes(blockAbove.name)
                || blockAbove.name.endsWith('_concrete_powder')
                || blockAbove.name === 'anvil'
                || blockAbove.name.endsWith('_anvil')
            ) {
                void execute(this, agent, async () => {
                    return await skills.moveAway(bot, 2);
                });
            }
            else if (
                bot.entity.isInLava
                || ['lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire'].includes(block.name)
                || ['lava', 'fire', 'soul_fire'].includes(blockAbove.name)
            ) {
                say(agent, 'I\'m on fire!');
                void execute(this, agent, async () => {
                    const success = await skills.escapeBurning(bot);
                    if (success) say(agent, 'I reached safe ground.');
                    return success;
                });
            }
            else if (
                Date.now() - bot.lastDamageTime < RECENT_DAMAGE_WINDOW_MS
                && (
                    bot.health <= LOW_HEALTH_RETREAT_THRESHOLD
                    || bot.lastDamageTaken >= Math.max(SEVERE_DAMAGE_MINIMUM, bot.health * 0.5)
                )
                && Date.now() - this.last_retreat_at >= SURVIVAL_RETREAT_COOLDOWN_MS
            ) {
                const now = Date.now();
                let threat = null;
                try {
                    threat = world.getNearestEntityWhere(
                        bot,
                        entity => mc.isHostile(entity),
                        SURVIVAL_RETREAT_DISTANCE,
                    );
                } catch (error) {
                    console.warn(`[mode:self_preservation] Could not resolve the damage threat: ${String(error?.message || error).slice(0, 240)}`);
                }
                this.last_retreat_at = now;
                say(agent, threat?.name
                    ? `I'm badly hurt—retreating from ${threat.name.replaceAll('_', ' ')}!`
                    : 'I\'m badly hurt—moving to safer ground!');
                void execute(this, agent, async () => {
                    if (threat?.position) {
                        const retreated = await skills.moveAwayFromEntity(
                            bot,
                            threat,
                            SURVIVAL_RETREAT_DISTANCE,
                        );
                        if (retreated || bot.interrupt_code) return retreated;
                    }
                    return await skills.moveAway(bot, SURVIVAL_FALLBACK_DISTANCE);
                });
            }
            else if (agent.isIdle()) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        prev_dig_block: null,
        prev_action_label: null,
        prev_action_started_at: null,
        update: function (agent) {
            if (agent.isIdle()) { 
                this.prev_location = null;
                this.stuck_time = 0;
                this.prev_action_label = null;
                this.prev_action_started_at = null;
                return; // don't get stuck when idle
            }
            const bot = agent.bot;
            const actionLabel = agent.actions?.currentActionLabel || '';
            const actionStartedAt = agent.actions?.last_action_time || null;
            if (
                this.prev_action_label !== actionLabel
                || this.prev_action_started_at !== actionStartedAt
            ) {
                this.prev_location = null;
                this.stuck_time = 0;
                this.prev_dig_block = null;
                this.last_time = Date.now();
                this.prev_action_label = actionLabel;
                this.prev_action_started_at = actionStartedAt;
            }
            const motionPosition = (
                bot.vehicle
                && bot.entities?.[bot.vehicle.id]?.isValid !== false
                && bot.entities?.[bot.vehicle.id]?.position
            ) || bot.entity.position;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(motionPosition) < this.distance && cur_dig_block == this.prev_dig_block) {
                this.stuck_time += (Date.now() - this.last_time) / 1000;
            }
            else {
                this.prev_location = motionPosition.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(agent, 'I\'m stuck!');
                this.stuck_time = 0;
                void execute(this, agent, async () => {
                    const recovery = await runBoundedUnstuckRecovery(agent);
                    if (recovery.success) {
                        say(agent, 'I\'m free.');
                    } else {
                        say(agent, 'I could not get free, so I stopped that movement.');
                    }
                    return recovery.success;
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
            this.prev_action_label = null;
            this.prev_action_started_at = null;
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Aaa! A ${enemy.name.replace("_", " ")}!`);
                void execute(this, agent, async () => {
                    return await skills.avoidEnemies(agent.bot, 24);
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Attack nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const protectionThreat = getAttributedProtectionThreat(agent);
            const enemy = protectionThreat || (agent.runtime?.autonomy === 'command'
                ? getRecentDamageCombatThreat(agent)
                : world.getNearestEntityWhere(
                    agent.bot,
                    entity => mc.isCombatSafeHostile(entity),
                    SELF_DEFENSE_RANGE,
                ));
            if (!enemy) return;
            if (await world.isClearPath(agent.bot, enemy)) {
                say(agent, protectionThreat
                    ? `Protecting ${agent.companion_context?.canonicalUsername || 'the guarded player'} from ${enemy.name}!`
                    : `Fighting ${enemy.name}!`);
                void execute(this, agent, async () => {
                    try {
                        return await skills.resolveTacticalCombat(
                            agent.bot,
                            SELF_DEFENSE_RANGE,
                            protectionThreat?.id ?? null,
                        );
                    } finally {
                        if (protectionThreat) agent.companion_context?.clearProtection?.('engagement_finished');
                    }
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                void execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    return await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    void execute(this, agent, async () => {
                        return await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                void execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    return await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Maintain a natural personal-space boundary when idle.',
        interrupts: [],
        on: true,
        active: false,
        distance: 1.25,
        update: function (agent) {
            if (!agent.isIdle() || agent.isOperatorHeld?.()) return false;
            const player = world.getNearestEntityWhere(
                agent.bot,
                entity => entity.type === 'player'
                    && entity.username !== agent.name
                    && !convoManager.isOtherAgent(entity.username),
                this.distance,
            );
            if (player) {
                void execute(this, agent, async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        return await skills.moveAwayFromEntity(agent.bot, player, 1.75);
                    }
                    return true;
                });
                return true;
            }
            return false;
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            if (!agent.isIdle()) return false;
            let changedAttention = false;
            const canSee = entity => {
                try {
                    return world.hasLineOfSightToEntity(agent.bot, entity) === true;
                } catch {
                    return false;
                }
            };
            const context = agent.companion_context?.snapshot?.();
            const companionEntity = context?.loaded
                && context.lineOfSight === true
                && Number(context.lineOfSightAge) <= 2_000
                ? agent.bot.entities?.[context.entityId]
                : null;
            const nearbyHuman = world.getNearestEntityWhere(
                agent.bot,
                entity => entity.type === 'player'
                    && entity.username !== agent.name
                    && !convoManager.isOtherAgent(entity.username)
                    && canSee(entity),
                10,
            );
            const entity = companionEntity || nearbyHuman || agent.bot.nearestEntity(entity => canSee(entity));
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
                changedAttention = true;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata?.[16];
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                    changedAttention = true;
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
            return changedAttention;
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    }
];

async function execute(mode, agent, func, timeout=-1) {
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;
    let code_return;
    try {
        code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
            return await func();
        }, { timeout, owner: 'reflex' });
    } catch (error) {
        const detail = String(error?.stack || error?.message || error).slice(0, 4096);
        console.error(`[mode:${mode.name}] Mode execution failed: ${detail}`);
        code_return = { success: false, message: detail, interrupted: false, timedout: false };
    } finally {
        mode.active = false;
    }
    if (!code_return?.success && !code_return?.interrupted) {
        const retryAfterMs = Number.isFinite(mode.retryAfterMs) && mode.retryAfterMs > 0
            ? mode.retryAfterMs
            : DEFAULT_REFLEX_RETRY_MS;
        mode.next_retry_at = Date.now() + retryAfterMs;
    }
    console.log(`Mode ${mode.name} finished executing, code_return: ${code_return?.message || ''}`);

    let should_reprompt = 
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return?.interrupted; // this mode action was not interrupted by something else

    if (should_reprompt) {
        // auto prompt to respond to the interruption
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
        Your behavior log: ${logs}\nRespond accordingly.`);
    }
    return code_return;
}

export { execute as executeModeAction, getModeSuppressionReason };

const controllerAgents = new WeakMap();
const COMBAT_REFLEX_MODES = Object.freeze(['cowardice', 'self_defense']);

function hasExplicitRuntimeProfile(agent) {
    return Boolean(
        agent?.prompter?.profile?.runtime
        && typeof agent.prompter.profile.runtime === 'object'
        && !Array.isArray(agent.prompter.profile.runtime)
    );
}

function applyRuntimeCombatReflexPolicy(agent) {
    if (!hasExplicitRuntimeProfile(agent)) return;

    const policy = agent.runtime?.reflexes?.combat || 'role';
    const roleReflexes = new Set(agent.runtime?.rolePreset?.reflexes || []);
    const enabled = policy === 'defend'
        ? new Set(['self_defense'])
        : policy === 'avoid'
            ? new Set(['cowardice'])
            : policy === 'off'
                ? new Set()
                : roleReflexes;

    for (const modeName of COMBAT_REFLEX_MODES) {
        agent.bot.modes.setOn(modeName, enabled.has(modeName));
    }
}

function createModeState() {
    return modes_list.map(mode => ({
        ...mode,
        interrupts: [...mode.interrupts],
        ...(mode.fall_blocks ? { fall_blocks: [...mode.fall_blocks] } : {}),
    }));
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor(agent) {
        this.behavior_log = '';
        this.modes = createModeState();
        this.modeMap = Object.fromEntries(this.modes.map(mode => [mode.name, mode]));
        this.updateCycle = 0;
        this.updateCycleOpen = false;
        this.evaluatedThisCycle = new Set();
        controllerAgents.set(this, agent);
    }

    exists(mode_name) {
        return this.modeMap[mode_name] != null;
    }

    setOn(mode_name, on) {
        const mode = this.modeMap[mode_name];
        if (!mode) throw new Error(`Unknown mode: ${mode_name}`);
        mode.on = on;
    }

    isOn(mode_name) {
        return this.modeMap[mode_name]?.on === true;
    }

    pause(mode_name) {
        const mode = this.modeMap[mode_name];
        if (!mode) throw new Error(`Unknown mode: ${mode_name}`);
        mode.paused = true;
    }

    unpause(mode_name) {
        const mode = this.modeMap[mode_name];
        if (!mode) return;
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of this.modes) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of this.modes) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of this.modes) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    beginUpdateCycle() {
        const agent = controllerAgents.get(this);
        this.updateCycle += 1;
        this.updateCycleOpen = true;
        this.evaluatedThisCycle.clear();
        if (!agent) return this.updateCycle;
        if (agent.isIdle()) {
            this.unPauseAll();
        }
        return this.updateCycle;
    }

    endUpdateCycle() {
        this.updateCycleOpen = false;
    }

    async updateBand(modeNames = []) {
        const agent = controllerAgents.get(this);
        if (!agent) return { active: false, scheduled: false, mode: null, code: 'agent_unavailable' };
        if (!this.updateCycleOpen) this.beginUpdateCycle();
        const names = [...new Set(Array.isArray(modeNames) ? modeNames : [modeNames])];
        for (const modeName of names) {
            const mode = this.modeMap[modeName];
            if (!mode || this.evaluatedThisCycle.has(modeName)) continue;
            this.evaluatedThisCycle.add(modeName);
            if (mode.active) {
                return { active: true, scheduled: false, mode: mode.name, code: 'mode_active' };
            }
            if (getModeSuppressionReason(agent, mode)) continue;
            const interruptible = mode.interrupts.some(i => i === 'all')
                || mode.interrupts.some(i => i === agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && Date.now() >= (mode.next_retry_at || 0) && (agent.isIdle() || interruptible)) {
                const wasExecuting = agent.actions.executing === true;
                const previousLabel = agent.actions.currentActionLabel;
                const result = await mode.update(agent);
                const scheduled = result === true
                    || mode.active
                    || (!wasExecuting && agent.actions.executing === true)
                    || previousLabel !== agent.actions.currentActionLabel;
                if (scheduled) {
                    return { active: mode.active === true, scheduled: true, mode: mode.name, code: 'mode_scheduled' };
                }
            }
        }
        return { active: false, scheduled: false, mode: null, code: 'band_clear' };
    }

    async update() {
        this.beginUpdateCycle();
        try {
            return await this.updateBand(this.modes.map(mode => mode.name));
        } finally {
            this.endUpdateCycle();
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of this.modes) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    getStatus() {
        const agent = controllerAgents.get(this);
        return this.modes.map(mode => {
            const suppressionReason = getModeSuppressionReason(agent, mode);
            return {
                name: mode.name,
                on: mode.on === true,
                active: mode.active === true,
                paused: mode.paused === true,
                suppressedByAutonomy: suppressionReason === 'command_autonomy',
                suppressedByHold: suppressionReason === 'operator_hold',
                suppressedByRole: suppressionReason === 'combat_priority',
                suppressionReason,
            };
        });
    }

    loadJson(json) {
        for (let mode of this.modes) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController(agent);
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }
    applyRuntimeCombatReflexPolicy(agent);
}
