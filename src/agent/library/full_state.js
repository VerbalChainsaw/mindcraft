import { 
    getPosition,
    getBiomeName,
    getNearestBlocksWhere,
    getBlockAtPosition,
    getFirstBlockAboveHead,
    hasLineOfSightToEntity,
} from "./world.js";
import convoManager from '../conversation.js';
import * as mc from '../../utils/mcdata.js';
import { actionResultToTelemetry } from '../runtime/action-result.js';
import { identityToTelemetry } from '../runtime/identity-config.js';
import { evaluateGameplayProgression } from '../runtime/gameplay-progression.js';
import { rideableEntityKnowledge } from './game_knowledge.js';

const AIR_BLOCKS = new Set(['air', 'cave_air', 'void_air']);
const HAZARD_BLOCKS = new Set([
    'lava',
    'fire',
    'soul_fire',
    'magma_block',
    'cactus',
    'campfire',
    'soul_campfire',
    'sweet_berry_bush',
    'powder_snow',
]);
const USEFUL_BLOCK_PATTERN = /(?:_log|_stem|_ore|crafting_table|furnace|chest|barrel|_bed|farmland|wheat|carrots|potatoes|beetroots|sugar_cane|torch|water)$/;
const TOOL_PATTERN = /(?:pickaxe|axe|shovel|hoe|shears|fishing_rod|flint_and_steel)$/;
const WEAPON_PATTERN = /(?:sword|bow|crossbow|trident|mace)$/;
const FOOD_PATTERN = /(?:apple|bread|carrot|potato|beetroot|berries|melon|beef|porkchop|chicken|mutton|rabbit|cod|salmon|stew|pie|cookie|cake)$/;
const PERCEPTION_CACHE_REFRESH_MS = 5_000;
const PERCEPTION_CACHE_MAX_AGE_MS = 15_000;
const PERCEPTION_RETRY_MS = 5_000;
const perceptionSnapshots = new WeakMap();

function round(value, places = 1) {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(places));
}

function directionVector(yaw = 0) {
    return {
        x: -Math.sin(yaw),
        z: Math.cos(yaw),
    };
}

function cardinalDirection(yaw = 0) {
    const { x, z } = directionVector(yaw);
    if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'east' : 'west';
    return z > 0 ? 'south' : 'north';
}

function relativeDirection(bot, targetPosition) {
    const deltaX = targetPosition.x - bot.entity.position.x;
    const deltaZ = targetPosition.z - bot.entity.position.z;
    const forward = directionVector(bot.entity.yaw);
    const front = (deltaX * forward.x) + (deltaZ * forward.z);
    const right = (deltaX * -forward.z) + (deltaZ * forward.x);
    const vertical = targetPosition.y - bot.entity.position.y;
    const parts = [];
    if (Math.abs(front) > 0.75) parts.push(front > 0 ? 'ahead' : 'behind');
    if (Math.abs(right) > 0.75) parts.push(right > 0 ? 'right' : 'left');
    if (Math.abs(vertical) > 1.5) parts.push(vertical > 0 ? 'above' : 'below');
    return parts.join('-') || 'here';
}

function viewAlignment(bot, targetPosition) {
    const origin = bot.entity?.position;
    if (!origin || !targetPosition) return 0;
    const eyeY = origin.y + (Number(bot.entity.height) || 1.62);
    const dx = targetPosition.x - origin.x;
    const dy = targetPosition.y - eyeY;
    const dz = targetPosition.z - origin.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.001) return 1;
    const yaw = Number(bot.entity.yaw) || 0;
    const pitch = Number(bot.entity.pitch) || 0;
    const forward = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y: -Math.sin(pitch),
        z: Math.cos(yaw) * Math.cos(pitch),
    };
    return round(((dx * forward.x) + (dy * forward.y) + (dz * forward.z)) / length, 3);
}

export function classifyEntityMotion(bot, entity) {
    const origin = bot.entity?.position;
    const position = entity?.position;
    if (!origin || !position) return { state: 'unknown', closingSpeed: 0 };
    const dx = position.x - origin.x;
    const dy = position.y - origin.y;
    const dz = position.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.001) return { state: 'stationary', closingSpeed: 0 };
    const entityVelocity = entity.velocity || {};
    const botVelocity = bot.entity?.velocity || {};
    const relative = {
        x: (Number(entityVelocity.x) || 0) - (Number(botVelocity.x) || 0),
        y: (Number(entityVelocity.y) || 0) - (Number(botVelocity.y) || 0),
        z: (Number(entityVelocity.z) || 0) - (Number(botVelocity.z) || 0),
    };
    const radialVelocity = ((relative.x * dx) + (relative.y * dy) + (relative.z * dz)) / distance;
    const closingSpeed = round(-radialVelocity, 3);
    return {
        state: closingSpeed > 0.04 ? 'approaching' : closingSpeed < -0.04 ? 'retreating' : 'stationary',
        closingSpeed,
    };
}

export function scoreEntityThreat({
    name = '',
    distance = Infinity,
    hostile = false,
    disposition = '',
    visible = null,
    motion = 'unknown',
} = {}) {
    if (!hostile) return 0;
    let score = Math.max(0, 24 - Math.max(0, Number(distance) || 0));
    if (visible === true) score += 6;
    if (motion === 'approaching') score += 7;
    if (/creeper/.test(name)) score += 18;
    else if (/(?:skeleton|pillager|blaze|ghast|witch)/.test(name)) score += 11;
    else if (/(?:warden|ravager|hoglin|vindicator)/.test(name)) score += 15;
    if (/(?:avoid|critical|hostile)/.test(String(disposition))) score += 4;
    return Math.max(0, Math.round(score));
}

function describeGoal(goal) {
    if (!goal) return null;
    const description = { type: goal.constructor?.name || 'Goal' };
    for (const key of ['x', 'y', 'z', 'range']) {
        if (Number.isFinite(goal[key])) description[key] = round(goal[key], 1);
    }
    return description;
}

function recognizeDroppedItem(entity) {
    try {
        const item = entity.getDroppedItem?.();
        if (item?.name) return { name: item.name, count: item.count || 1 };
    } catch (error) {
        console.warn(`[awareness] Could not identify dropped item ${entity.id}: ${error.message}`);
    }
    return { name: 'unknown_item', count: 1 };
}

function classifyInventory(bot) {
    const items = bot.inventory.items();
    const counts = {};
    for (const slot of bot.inventory.slots) {
        if (!slot?.name) continue;
        counts[slot.name] = (counts[slot.name] || 0) + slot.count;
    }
    const summarize = pattern => items
        .filter(item => pattern.test(item.name))
        .map(item => {
            const summary = { name: item.name, count: item.count };
            const maxDurability = Number(
                item.maxDurability
                ?? bot.registry?.items?.[item.type]?.maxDurability
                ?? bot.registry?.itemsByName?.[item.name]?.maxDurability,
            );
            if (Number.isFinite(maxDurability) && maxDurability > 0) {
                const remaining = Math.max(0, maxDurability - (Math.max(0, Number(item.durabilityUsed) || 0)));
                summary.durability = {
                    remaining,
                    maximum: maxDurability,
                    percent: Math.round((remaining / maxDurability) * 100),
                    needsReplacement: remaining <= Math.max(16, Math.ceil(maxDurability * 0.1)),
                };
            }
            return summary;
        });
    return {
        counts,
        stacksUsed: items.length,
        tools: summarize(TOOL_PATTERN),
        weapons: summarize(WEAPON_PATTERN),
        food: summarize(FOOD_PATTERN),
    };
}

function captureNearbyEntities(bot, maxDistance = 64) {
    const origin = bot.entity?.position;
    if (!origin) return [];
    const entities = [];
    for (const entity of Object.values(bot.entities || {})) {
        if (!entity?.position) continue;
        let distance;
        try {
            distance = entity.position.distanceTo(origin);
        } catch {
            continue;
        }
        if (!Number.isFinite(distance) || distance > maxDistance) continue;
        entities.push({ entity, distance });
    }
    entities.sort((left, right) => left.distance - right.distance);
    return entities;
}

function buildEntityPerception(bot, nearbyEntities) {
    const entities = nearbyEntities
        .filter(({ entity, distance }) => entity !== bot.entity && distance <= 24)
        .slice(0, 16)
        .map(({ entity, distance }) => {
            const roundedDistance = round(distance);
            const alignment = viewAlignment(bot, entity.position);
            const inView = alignment >= 0.55;
            let visible = null;
            try {
                visible = hasLineOfSightToEntity(bot, entity);
            } catch {
                // A missing raycast is unknown, not proof that the entity is hidden.
            }
            const motion = classifyEntityMotion(bot, entity);
            const position = {
                x: round(entity.position.x),
                y: round(entity.position.y),
                z: round(entity.position.z),
            };
            if (entity.name === 'item') {
                return {
                    kind: 'dropped_item',
                    ...recognizeDroppedItem(entity),
                    entityId: Number.isFinite(entity.id) ? entity.id : null,
                    distance: roundedDistance,
                    direction: relativeDirection(bot, entity.position),
                    position,
                    visible,
                    inView,
                    viewAlignment: alignment,
                    motion: motion.state,
                    closingSpeed: motion.closingSpeed,
                };
            }
            const rideable = rideableEntityKnowledge(entity.name);
            const hostile = mc.isHostile(entity);
            const threatDisposition = mc.getThreatDisposition(entity);
            const threatScore = scoreEntityThreat({
                name: entity.name,
                distance,
                hostile,
                disposition: threatDisposition,
                visible,
                motion: motion.state,
            });
            return {
                kind: entity.type === 'player' ? 'player' : 'entity',
                name: entity.username || entity.name || 'unknown',
                entityId: Number.isFinite(entity.id) ? entity.id : null,
                distance: roundedDistance,
                direction: relativeDirection(bot, entity.position),
                position,
                visible,
                inView,
                viewAlignment: alignment,
                motion: motion.state,
                closingSpeed: motion.closingSpeed,
                hostile,
                threatDisposition,
                threatScore,
                threatPriority: threatScore >= 36 ? 'critical' : threatScore >= 24 ? 'high' : threatScore > 0 ? 'moderate' : 'none',
                huntable: mc.isHuntable(entity),
                rideable,
            };
        });

    const hostiles = entities
        .filter(entity => entity.hostile)
        .sort((left, right) => right.threatScore - left.threatScore || left.distance - right.distance);
    return {
        entities,
        droppedItems: entities.filter(entity => entity.kind === 'dropped_item'),
        hostiles,
        primaryThreat: hostiles[0] || null,
    };
}

function buildBlockPerception(bot) {
    const hazards = getNearestBlocksWhere(
        bot,
        block => HAZARD_BLOCKS.has(block?.name),
        10,
        12,
    ).filter(Boolean).map(block => ({
        name: block.name,
        distance: round(block.position.distanceTo(bot.entity.position)),
        direction: relativeDirection(bot, block.position),
        inView: viewAlignment(bot, block.position) >= 0.55,
        position: {
            x: block.position.x,
            y: block.position.y,
            z: block.position.z,
        },
    }));

    const usefulBlocks = getNearestBlocksWhere(
        bot,
        block => USEFUL_BLOCK_PATTERN.test(block?.name || ''),
        16,
        24,
    ).filter(Boolean).map(block => ({
        name: block.name,
        distance: round(block.position.distanceTo(bot.entity.position)),
        direction: relativeDirection(bot, block.position),
        inView: viewAlignment(bot, block.position) >= 0.55,
        position: {
            x: block.position.x,
            y: block.position.y,
            z: block.position.z,
        },
    }));

    return {
        hazards,
        usefulBlocks,
    };
}

function mergePerception(entityPerception, blockPerception) {
    const entities = entityPerception.entities || [];
    const hostiles = entityPerception.hostiles || [];
    const droppedItems = entityPerception.droppedItems || [];
    const hazards = blockPerception.hazards || [];
    const usefulBlocks = blockPerception.usefulBlocks || [];
    return {
        entities,
        droppedItems,
        hostiles,
        hazards,
        usefulBlocks,
        primaryThreat: entityPerception.primaryThreat || null,
        summary: {
            detectedEntities: entities.length,
            visibleEntities: entities.filter(entity => entity.visible === true && entity.inView).length,
            hostiles: hostiles.length,
            approachingHostiles: hostiles.filter(entity => entity.motion === 'approaching').length,
            droppedItems: droppedItems.length,
            hazards: hazards.length,
            usefulBlocks: usefulBlocks.length,
        },
    };
}

function emptyEntityPerception() {
    return {
        entities: [],
        droppedItems: [],
        hostiles: [],
        primaryThreat: null,
    };
}

function emptyBlockPerception() {
    return {
        hazards: [],
        usefulBlocks: [],
    };
}

function getLandmarkState(agent) {
    try {
        return agent.landmark_memory?.telemetry?.(8) || null;
    } catch {
        // Spatial recall must never be able to break state reporting.
        return null;
    }
}

function getRoleDirectorState(agent) {
    const status = agent.role_director?.status;
    if (!status || typeof status !== 'object') return null;
    return {
        phase: String(status.phase || 'unknown').slice(0, 32),
        code: String(status.code || 'unknown').slice(0, 64),
        role: String(status.role || agent.runtime?.role || 'companion').slice(0, 48),
        target: typeof status.target === 'string' ? status.target.slice(0, 64) : null,
        evidence: String(status.evidence || '').slice(0, 240),
        retryable: status.retryable === true,
        at: Number.isFinite(status.at) ? status.at : null,
        nextAttemptAt: Number.isFinite(agent.role_director?.nextAttemptAt)
            ? agent.role_director.nextAttemptAt
            : null,
    };
}

export function getSurvivalDirectorState(agent) {
    let status;
    try {
        status = agent.survival_director?.snapshot?.();
    } catch {
        return null;
    }
    if (!status || typeof status !== 'object') return null;
    const target = {};
    if (status.target && typeof status.target === 'object' && !Array.isArray(status.target)) {
        for (const key of ['name', 'type', 'x', 'y', 'z', 'distance']) {
            if (typeof status.target[key] === 'string') target[key] = status.target[key].slice(0, 96);
            else if (Number.isFinite(status.target[key])) target[key] = status.target[key];
        }
    }
    return {
        name: String(status.name || 'survival').slice(0, 40),
        phase: String(status.phase || 'unknown').slice(0, 24),
        code: String(status.code || 'unknown').slice(0, 80),
        target: Object.keys(target).length ? target : null,
        detail: String(status.detail || '').slice(0, 280),
        retryable: status.retryable === true,
        nextEligibleAt: Number.isFinite(status.nextEligibleAt) ? status.nextEligibleAt : null,
    };
}

function boundedDirectorTarget(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const target = {};
    for (const key of [
        'name',
        'type',
        'requestedName',
        'canonicalName',
        'inventoryName',
        'family',
        'acquisitionKind',
        'x',
        'y',
        'z',
        'distance',
    ]) {
        if (typeof value[key] === 'string') target[key] = value[key].slice(0, 96);
        else if (Number.isFinite(value[key])) target[key] = value[key];
    }
    return Object.keys(target).length ? target : null;
}

export function getJobDirectorState(agent) {
    let status;
    try {
        status = agent.job_director?.snapshot?.();
    } catch {
        return null;
    }
    if (!status || typeof status !== 'object') return null;
    const workOrder = status.workOrder;
    let projectedOrder = null;
    if (workOrder && typeof workOrder === 'object' && !Array.isArray(workOrder)) {
        const checkpoint = {};
        for (const key of ['verifiedCount', 'nextCell', 'collected', 'delivered']) {
            if (Number.isFinite(workOrder.checkpoint?.[key])) checkpoint[key] = workOrder.checkpoint[key];
        }
        const evidence = workOrder.evidence && typeof workOrder.evidence === 'object'
            ? {
                code: String(workOrder.evidence.code || '').slice(0, 80),
                detail: String(workOrder.evidence.detail || '').slice(0, 280),
                actionId: String(workOrder.evidence.actionId || '').slice(0, 96),
            }
            : null;
        projectedOrder = {
            id: String(workOrder.id || '').slice(0, 96),
            role: String(workOrder.role || '').slice(0, 24),
            kind: String(workOrder.kind || '').slice(0, 32),
            phase: String(workOrder.phase || '').slice(0, 24),
            target: boundedDirectorTarget(workOrder.target),
            attempts: Number.isFinite(workOrder.attempts) ? workOrder.attempts : 0,
            maxAttempts: Number.isFinite(workOrder.maxAttempts) ? workOrder.maxAttempts : 0,
            checkpoint,
            evidence,
        };
    }
    return {
        phase: String(status.phase || 'unknown').slice(0, 24),
        code: String(status.code || 'unknown').slice(0, 80),
        retryable: status.retryable === true,
        nextAttemptAt: Number.isFinite(status.nextAttemptAt) ? status.nextAttemptAt : null,
        workOrder: projectedOrder,
    };
}

export function getGoalDirectorState(agent) {
    let status;
    try {
        status = agent.goal_director?.snapshot?.();
    } catch {
        return null;
    }
    if (!status || typeof status !== 'object') return null;
    const goal = status.goal;
    const plan = status.plan;
    return {
        phase: String(status.phase || 'unknown').slice(0, 24),
        code: String(status.code || 'unknown').slice(0, 80),
        detail: String(status.detail || '').slice(0, 280),
        retryable: status.retryable === true,
        inFlight: status.inFlight === true,
        nextAttemptAt: Number.isFinite(status.nextAttemptAt) ? status.nextAttemptAt : null,
        plan: plan && typeof plan === 'object' && !Array.isArray(plan)
            ? {
                status: String(plan.status || 'unknown').slice(0, 24),
                code: String(plan.code || 'unknown').slice(0, 80),
                detail: String(plan.detail || '').slice(0, 280),
                target: String(plan.target || '').slice(0, 80),
                quantity: Math.max(0, Number(plan.quantity) || 0),
                blocker: plan.blocker ? String(plan.blocker).slice(0, 80) : null,
                exploredNodes: Math.max(0, Number(plan.exploredNodes) || 0),
                revision: Math.max(0, Number(plan.revision) || 0),
                remainingActions: Math.max(0, Number(plan.remainingActions) || 0),
                experienceApplied: plan.experienceApplied === true,
                nextStep: plan.nextStep && typeof plan.nextStep === 'object'
                    ? {
                        kind: String(plan.nextStep.kind || '').slice(0, 32),
                        target: String(plan.nextStep.target || '').slice(0, 80),
                        command: String(plan.nextStep.command || '').slice(0, 240),
                        reason: String(plan.nextStep.reason || '').slice(0, 280),
                        learningKey: plan.nextStep.learningKey
                            ? String(plan.nextStep.learningKey).slice(0, 160)
                            : null,
                        learnedPreference: Number(plan.nextStep.learnedPreference) || 0,
                    }
                    : null,
                actions: Array.isArray(plan.actions)
                    ? plan.actions.slice(0, 8).map(action => ({
                        kind: String(action.kind || '').slice(0, 32),
                        target: String(action.target || '').slice(0, 80),
                        command: String(action.command || '').slice(0, 240),
                        expectedIncrease: Math.max(0, Number(action.expectedIncrease) || 0),
                        reason: String(action.reason || '').slice(0, 280),
                        learningKey: action.learningKey
                            ? String(action.learningKey).slice(0, 160)
                            : null,
                        learnedPreference: Number(action.learnedPreference) || 0,
                    }))
                    : [],
            }
            : null,
        goal: goal && typeof goal === 'object' && !Array.isArray(goal)
            ? {
                id: String(goal.id || '').slice(0, 96),
                kind: String(goal.kind || '').slice(0, 24),
                requester: String(goal.requester || '').slice(0, 64),
                target: boundedDirectorTarget(goal.target),
                quantity: Math.max(0, Number(goal.quantity) || 0),
                destination: goal.destination?.kind === 'player'
                    ? { kind: 'player', player: String(goal.destination.player || '').slice(0, 64) }
                    : { kind: 'inventory', player: null },
                phase: String(goal.phase || '').slice(0, 24),
                attempts: Math.max(0, Number(goal.attempts) || 0),
                maxAttempts: Math.max(0, Number(goal.maxAttempts) || 0),
                checkpoint: {
                    baselineInventory: Math.max(0, Number(goal.checkpoint?.baselineInventory) || 0),
                    targetInventory: Math.max(0, Number(goal.checkpoint?.targetInventory) || 0),
                    delivered: Math.max(0, Number(goal.checkpoint?.delivered) || 0),
                },
                procedureId: goal.procedureId ? String(goal.procedureId).slice(0, 96) : null,
                subgoals: Array.isArray(goal.subgoals) ? goal.subgoals.length : 0,
                activeSubgoal: Array.isArray(goal.subgoals) && goal.subgoals.length > 0
                    ? {
                        kind: String(goal.subgoals.at(-1)?.kind || '').slice(0, 32),
                        state: String(goal.subgoals.at(-1)?.state || '').slice(0, 24),
                        commandName: String(goal.subgoals.at(-1)?.commandName || '').slice(0, 80),
                        targetName: String(goal.subgoals.at(-1)?.targetName || '').slice(0, 80),
                        expectedIncrease: Math.max(0, Number(goal.subgoals.at(-1)?.expectedIncrease) || 0),
                        code: String(goal.subgoals.at(-1)?.code || '').slice(0, 80),
                    }
                    : null,
            }
            : null,
    };
}

export function getReactionDirectorState(agent) {
    let status;
    try {
        status = agent.reaction_director?.snapshot?.();
    } catch {
        return null;
    }
    if (!status || typeof status !== 'object') return null;
    return {
        phase: String(status.phase || 'unknown').slice(0, 24),
        code: String(status.code || 'unknown').slice(0, 80),
        spoken: Math.max(0, Math.min(1_000_000, Number(status.spoken) || 0)),
        gestures: Math.max(0, Math.min(1_000_000, Number(status.gestures) || 0)),
        fallbacks: Math.max(0, Math.min(1_000_000, Number(status.fallbacks) || 0)),
        lastEventId: status.lastEventId ? String(status.lastEventId).slice(0, 96) : null,
        detail: String(status.detail || '').slice(0, 280),
        queued: Math.max(0, Math.min(256, Number(status.queued) || 0)),
    };
}

function getAttentionState(agent) {
    const prompter = agent.self_prompter;
    const held = agent.isOperatorHeld?.() === true;
    const active = prompter?.isActive?.() === true;
    const paused = prompter?.isPaused?.() === true;
    const stopped = prompter?.isStopped?.() === true;
    const hasGoal = Boolean(prompter?.prompt);
    return {
        state: held ? 'held' : active ? 'working' : paused ? 'paused' : 'none',
        goalActive: active,
        goalSaved: !stopped && hasGoal,
        goalSource: prompter?.goal_source ? String(prompter.goal_source).slice(0, 24) : 'none',
        loopActive: prompter?.loop_active === true,
        processingTurn: prompter?.processing_turn === true,
        noProgressCount: Number.isFinite(prompter?.no_progress_count) ? prompter.no_progress_count : 0,
        maxNoProgress: agent.runtime?.limits?.maxNoProgress ?? null,
        lastTurnAt: Number.isFinite(prompter?.last_turn_at) ? prompter.last_turn_at : null,
        lastVerifiedProgressAt: Number.isFinite(prompter?.last_verified_progress_at)
            ? prompter.last_verified_progress_at
            : null,
        attempts: Math.max(0, Number(prompter?.goal_attempt_count) || 0),
        verifiedSteps: Math.max(0, Number(prompter?.verified_step_count) || 0),
        repeatedBlockerCount: Math.max(0, Number(prompter?.repeated_blocker_count) || 0),
        lastCommand: prompter?.last_command ? String(prompter.last_command).slice(0, 260) : null,
        lastOutcome: prompter?.last_goal_outcome ? {
            phase: String(prompter.last_goal_outcome.phase || 'unknown').slice(0, 24),
            code: String(prompter.last_goal_outcome.code || 'unknown').slice(0, 80),
            detail: String(prompter.last_goal_outcome.detail || '').slice(0, 280),
            retryable: prompter.last_goal_outcome.retryable === true,
        } : null,
        operatorHeld: held,
    };
}

function getDialogueState(agent) {
    const activeConversation = convoManager.activeConversation;
    const partner = activeConversation?.name;
    return {
        muted: agent.shut_up === true,
        inConversation: convoManager.inConversation() === true,
        partner: typeof partner === 'string' ? partner.slice(0, 64) : null,
        lastSender: typeof agent.last_sender === 'string' ? agent.last_sender.slice(0, 64) : null,
    };
}

function withPerceptionMeta(snapshot, status, sampledAt, now) {
    return {
        ...snapshot,
        status,
        sampledAt: Number.isFinite(sampledAt) ? sampledAt : null,
        ageMs: Number.isFinite(sampledAt) ? Math.max(0, now - sampledAt) : null,
    };
}

// Deep scans are intentionally decoupled from the fast state heartbeat. A
// shallow heartbeat reuses the last known scan and reports exactly how old it
// is; it never pretends that "not sampled" means there are no threats/items.
export function invalidatePerception(agent, reason = 'world_event') {
    const cached = perceptionSnapshots.get(agent);
    if (!cached) return false;
    perceptionSnapshots.set(agent, {
        ...cached,
        nextRefreshAt: 0,
        invalidatedBy: String(reason || 'world_event').slice(0, 64),
    });
    return true;
}

function getPerceptionSnapshot(agent, bot, nearbyEntities, { deep = false, now = Date.now() } = {}) {
    const cached = perceptionSnapshots.get(agent);
    let liveEntities;
    try {
        liveEntities = buildEntityPerception(bot, nearbyEntities);
    } catch (error) {
        console.warn(`[awareness] Entity detection failed for ${agent.name || 'bot'}: ${error?.message || error}`);
        liveEntities = emptyEntityPerception();
    }
    const refreshDue = deep || !cached || now >= (cached.nextRefreshAt || 0);
    if (refreshDue) {
        try {
            const snapshot = buildBlockPerception(bot);
            perceptionSnapshots.set(agent, {
                sampledAt: now,
                snapshot,
                nextRefreshAt: now + PERCEPTION_CACHE_REFRESH_MS,
                lastRefreshFailed: false,
                unavailable: false,
                invalidatedBy: null,
            });
            return withPerceptionMeta(mergePerception(liveEntities, snapshot), 'fresh', now, now);
        } catch (error) {
            console.warn(`[awareness] Perception scan failed for ${agent.name || 'bot'}: ${error?.message || error}`);
            if (cached && !cached.unavailable) {
                perceptionSnapshots.set(agent, {
                    ...cached,
                    nextRefreshAt: now + PERCEPTION_RETRY_MS,
                    lastRefreshFailed: true,
                });
                return withPerceptionMeta(
                    mergePerception(liveEntities, cached.snapshot),
                    'stale',
                    cached.sampledAt,
                    now,
                );
            }
            perceptionSnapshots.set(agent, {
                sampledAt: null,
                snapshot: emptyBlockPerception(),
                nextRefreshAt: now + PERCEPTION_RETRY_MS,
                lastRefreshFailed: true,
                unavailable: true,
            });
            return withPerceptionMeta(
                mergePerception(liveEntities, emptyBlockPerception()),
                'unavailable',
                null,
                now,
            );
        }
    }

    if (!cached) return withPerceptionMeta(mergePerception(liveEntities, emptyBlockPerception()), 'unsampled', null, now);
    if (cached.unavailable) return withPerceptionMeta(mergePerception(liveEntities, emptyBlockPerception()), 'unavailable', null, now);
    const ageMs = Math.max(0, now - cached.sampledAt);
    return withPerceptionMeta(
        mergePerception(liveEntities, cached.snapshot),
        cached.lastRefreshFailed || ageMs > PERCEPTION_CACHE_MAX_AGE_MS ? 'stale' : 'cached',
        cached.sampledAt,
        now,
    );
}

export function getFullState(agent, { deep = false } = {}) {
    const bot = agent.bot;
    const sampledAt = Date.now();

    const pos = getPosition(bot);
    const position = {
        x: Number(pos.x.toFixed(2)),
        y: Number(pos.y.toFixed(2)),
        z: Number(pos.z.toFixed(2))
    };

    let weather = 'Clear';
    if (bot.thunderState > 0) weather = 'Thunderstorm';
    else if (bot.rainState > 0) weather = 'Rain';

    let timeLabel = 'Night';
    if (bot.time.timeOfDay < 6000) timeLabel = 'Morning';
    else if (bot.time.timeOfDay < 12000) timeLabel = 'Afternoon';

    const below = getBlockAtPosition(bot, 0, -1, 0).name;
    const legs = getBlockAtPosition(bot, 0, 0, 0).name;
    const head = getBlockAtPosition(bot, 0, 1, 0).name;
    const facingVector = directionVector(bot.entity.yaw);
    const frontOffsetX = Math.round(facingVector.x);
    const frontOffsetZ = Math.round(facingVector.z);
    const frontBelow = getBlockAtPosition(bot, frontOffsetX, -1, frontOffsetZ).name;
    const frontLegs = getBlockAtPosition(bot, frontOffsetX, 0, frontOffsetZ).name;
    const frontHead = getBlockAtPosition(bot, frontOffsetX, 1, frontOffsetZ).name;
    const nearbyEntities = captureNearbyEntities(bot);
    const perception = getPerceptionSnapshot(agent, bot, nearbyEntities, { deep, now: sampledAt });
    const categorizedInventory = classifyInventory(bot);

    let players = nearbyEntities
        .filter(({ entity }) => entity.type === 'player' && entity.username !== bot.username)
        .map(({ entity }) => entity.username)
        .filter(Boolean);
    let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
    players = players.filter(p => !bots.includes(p));
    const entityTypes = [];
    const seenEntityTypes = new Set();
    for (const { entity, distance } of nearbyEntities) {
        if (distance > 16) break;
        const type = entity?.name;
        if (!type || type === 'player' || type === 'item' || seenEntityTypes.has(type)) continue;
        seenEntityTypes.add(type);
        entityTypes.push(type);
    }

    const helmet = bot.inventory.slots[5];
    const chestplate = bot.inventory.slots[6];
    const leggings = bot.inventory.slots[7];
    const boots = bot.inventory.slots[8];
    const roleDirector = getRoleDirectorState(agent);
    const survivalDirector = getSurvivalDirectorState(agent);
    const jobDirector = getJobDirectorState(agent);
    const goalDirector = getGoalDirectorState(agent);
    const reactionDirector = getReactionDirectorState(agent);
    const observedVehicle = bot.vehicle && bot.entities?.[bot.vehicle.id]?.isValid !== false
        ? bot.entities?.[bot.vehicle.id] || null
        : null;
    const mountedVehicle = observedVehicle && rideableEntityKnowledge(observedVehicle.name)
        ? {
            ...rideableEntityKnowledge(observedVehicle.name),
            entityId: Number.isFinite(observedVehicle.id) ? observedVehicle.id : null,
            position: observedVehicle.position ? {
                x: round(observedVehicle.position.x, 2),
                y: round(observedVehicle.position.y, 2),
                z: round(observedVehicle.position.z, 2),
            } : null,
        }
        : null;

    // Richer activity than a bare "Idle": a bot counts as idle (no action executing) even while
    // chatting, deciding its next move, or stopped. Surface those so the dashboard is meaningful.
    let activity;
    if (!agent.isIdle()) {
        activity = { current: agent.actions.currentActionLabel || 'Acting', kind: 'acting' };
    } else if (convoManager.inConversation()) {
        const who = convoManager.activeConversation?.name;
        activity = { current: who ? `Chatting with ${who}` : 'Chatting', kind: 'chatting' };
    } else if (survivalDirector?.phase === 'acting') {
        activity = {
            current: `Survival: ${survivalDirector.code.replace(/_/g, ' ')}`,
            kind: 'acting',
        };
    } else if (survivalDirector?.phase === 'recovering') {
        activity = {
            current: `Recovering: ${survivalDirector.code.replace(/_/g, ' ')}`,
            kind: 'acting',
        };
    } else if (goalDirector?.goal && !['complete', 'failed', 'cancelled'].includes(goalDirector.goal.phase)) {
        activity = {
            current: goalDirector.inFlight
                ? `Goal active: ${goalDirector.code.replace(/_/g, ' ')}`
                : `Goal ${goalDirector.goal.phase.replace(/_/g, ' ')}: ${goalDirector.goal.target?.family || goalDirector.goal.target?.canonicalName || 'item'}`,
            kind: goalDirector.inFlight ? 'acting' : 'thinking',
        };
    } else if (agent.self_prompter.isStopped() && roleDirector?.phase === 'waiting') {
        const waitingLabels = {
            waiting_for_player: 'Waiting for player',
            startup_delay: 'Role initializing',
            resource_search_exhausted: 'Resource search paused',
            no_safe_default: 'Waiting for role assignment',
        };
        activity = {
            current: waitingLabels[roleDirector.code] || `Role waiting: ${roleDirector.code}`,
            kind: 'thinking',
        };
    } else if (agent.self_prompter.isStopped() && roleDirector?.phase === 'recovering') {
        activity = {
            current: roleDirector.code === 'searching_for_resources'
                ? 'Searching for resources'
                : roleDirector.code === 'resource_search_relocated'
                    ? 'Rescanning new work area'
                    : `Role recovering: ${roleDirector.code}`,
            kind: 'acting',
        };
    } else if (agent.self_prompter.isStopped() && roleDirector?.phase === 'acting') {
        activity = {
            current: `Role active: ${roleDirector.code.replace(/^role_/, '').replace(/_/g, ' ')}`,
            kind: 'acting',
        };
    } else if (agent.self_prompter.isStopped() && roleDirector?.phase === 'succeeded') {
        activity = { current: 'Role cycle complete', kind: 'idle' };
    } else if (agent.self_prompter.isStopped() && roleDirector?.phase === 'suppressed') {
        activity = {
            current: roleDirector.code === 'operator_hold'
                ? 'Stopped by operator'
                : roleDirector.code === 'command_autonomy'
                    ? 'Command only'
                    : 'Manual control',
            kind: 'stopped',
        };
    } else if (agent.self_prompter.isStopped() && roleDirector?.phase === 'failed') {
        activity = { current: `Role blocked: ${roleDirector.code}`, kind: 'stopped' };
    } else if (agent.self_prompter.isStopped()) {
        activity = { current: 'Stopped', kind: 'stopped' };   // self-prompter OFF: won't act on its own
    } else if (agent.self_prompter.isPaused()) {
        activity = { current: 'Chatting', kind: 'chatting' };
    } else if (agent.self_prompter.isActive()) {
        activity = { current: 'Thinking', kind: 'thinking' }; // self-prompting between actions
    } else {
        activity = { current: 'Idle', kind: 'idle' };
    }

    const deathMemory = agent.memory_bank?.recallDeath?.() || null;
    const deathManifestCount = Object.values(deathMemory?.inventory || {})
        .reduce((total, count) => total + Math.max(0, Number(count) || 0), 0);
    const deathRecoveryPending = Boolean(
        deathMemory
        && !deathMemory.recoveredAt
        && deathManifestCount > 0
    );
    const state = {
        _meta: {
            sampledAt,
            source: 'live',
            depth: perception.status === 'fresh' ? 'deep' : 'shallow',
        },
        name: agent.name,
        identity: {
            ...identityToTelemetry(agent.runtime?.identity || agent.prompter?.profile?.identity, {
                displayName: agent.name,
            }),
            role: agent.runtime?.role || 'companion',
            autonomy: agent.runtime?.autonomy || 'balanced',
            roleFocus: [...(agent.runtime?.rolePreset?.focus || [])],
            job: String(agent.prompter?.profile?.job || '').slice(0, 180),
            language: agent.runtime?.identity?.language || 'en',
            style: agent.runtime?.identity?.style || '',
            attitude: agent.runtime?.identity?.attitude || '',
            specialties: [...(agent.runtime?.identity?.specialties || [])],
        },
        persona: agent.getPersona?.() || '',
        gameplay: {
            position,
            dimension: bot.game.dimension,
            gamemode: bot.game.gameMode,
            health: Math.round(bot.health),
            healthMax: 20,
            hunger: Math.round(bot.food),
            hungerMax: 20,
            biome: getBiomeName(bot),
            weather,
            timeOfDay: bot.time.timeOfDay,
            timeLabel
        },
        action: {
            current: activity.current,
            kind: activity.kind,
            isIdle: agent.isIdle(),
            pathfinding: describeGoal(bot.pathfinder?.goal),
            held: agent.isOperatorHeld?.() === true,
            stopRequestedAt: Number.isFinite(agent.actions?.stopRequestedAt) ? agent.actions.stopRequestedAt : null,
            stopTimedOutAt: Number.isFinite(agent.actions?.stopTimedOutAt) ? agent.actions.stopTimedOutAt : null,
            lastResult: actionResultToTelemetry(agent.last_action_result || agent.actions?.lastResult),
            survivalDirector,
            goalDirector,
            jobDirector,
            reactionDirector,
            roleDirector,
            behaviorArbiter: agent.behavior_arbiter?.snapshot?.() || null,
        },
        landmarks: getLandmarkState(agent),
        attention: getAttentionState(agent),
        companion: agent.companion_context?.snapshot?.() || null,
        dialogue: getDialogueState(agent),
        body: {
            facing: cardinalDirection(bot.entity.yaw),
            yaw: round(bot.entity.yaw, 2),
            pitch: round(bot.entity.pitch, 2),
            onGround: bot.entity.onGround === true,
            mounted: Boolean(mountedVehicle),
            vehicle: mountedVehicle,
            velocity: {
                x: round(bot.entity.velocity?.x || 0, 2),
                y: round(bot.entity.velocity?.y || 0, 2),
                z: round(bot.entity.velocity?.z || 0, 2),
            },
            mainHand: bot.heldItem ? bot.heldItem.name : null,
        },
        surroundings: {
            below,
            legs,
            head,
            firstBlockAboveHead: getFirstBlockAboveHead(bot, null, 32),
            front: {
                below: frontBelow,
                legs: frontLegs,
                head: frontHead,
                bodyClear: AIR_BLOCKS.has(frontLegs) && AIR_BLOCKS.has(frontHead),
                hasSupport: !AIR_BLOCKS.has(frontBelow),
            },
        },
        inventory: {
            totalSlots: bot.inventory.slots.length,
            equipment: {
                helmet: helmet ? helmet.name : null,
                chestplate: chestplate ? chestplate.name : null,
                leggings: leggings ? leggings.name : null,
                boots: boots ? boots.name : null,
                mainHand: bot.heldItem ? bot.heldItem.name : null
            },
            ...categorizedInventory,
        },
        nearby: {
            humanPlayers: players,
            botPlayers: bots,
            entityTypes,
        },
        perception,
        modes: {
            summary: bot.modes.getMiniDocs(),
            status: bot.modes.getStatus?.() || [],
        },
        memory: {
            explorationRouteVerified: Boolean(agent.memory_bank?.recallFact?.('exploration_route_verified')),
            deathRecoveryVerified: Boolean(
                agent.memory_bank?.recallFact?.('death_recovery_verified')
                && !deathRecoveryPending
            ),
            deathRecoveryPending,
            home: agent.home_state?.telemetry?.() || null,
            learnedOutcomes: agent.memory_bank?.personal?.getOutcomeSummary?.(6) || [],
        },
        performance: {
            prompt: agent.prompter?.performance?.conversation || null,
        },
    };

    state.progression = evaluateGameplayProgression(state);
    return state;
}
