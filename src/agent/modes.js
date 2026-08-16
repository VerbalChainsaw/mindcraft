import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js';
import convoManager from './conversation.js';
import { isDrinkableHealingPotion } from './runtime/brewing-plan.js';

const MAX_BEHAVIOR_LOG_CHARS = 1_024;
const FRESH_PLAYER_ACTION_GRACE_MS = 3_000;
const PLAYER_ACTION_GUARD_MODES = new Set([
    'unstuck',
    'item_collecting',
    'torch_placing',
    'hunting',
    'elbow_room',
    'idle_staring',
]);

function appendBehaviorLog(agent, message) {
    const current = String(agent?.bot?.modes?.behavior_log || '');
    const next = `${current}${String(message || '')}\n`;
    agent.bot.modes.behavior_log = next.length <= MAX_BEHAVIOR_LOG_CHARS
        ? next
        : `[behavior log capped]\n${next.slice(-(MAX_BEHAVIOR_LOG_CHARS - 24))}`;
}

function say(agent, message) {
    // The log always records it. Whether the bot says it out loud in chat is a
    // per-bot dial, so quieting one chatty bot no longer silences every bot in
    // the world and no longer needs a restart.
    appendBehaviorLog(agent, message);
    const narration = agent.runtime?.narration
        || (settings.narrate_behavior === true ? 'chatty' : 'quiet');
    if (agent.shut_up || narration === 'quiet') return;
    void Promise.resolve()
        .then(() => agent.openChat(message))
        .catch(error => {
            console.error(`[mode:narration] Failed to send behavior chat: ${String(error?.message || error).slice(0, 512)}`);
        });
}

const DEFAULT_UNSTUCK_TIMEOUT_MS = 10_000;
const DEFAULT_REFLEX_RETRY_MS = 1_500;
const RECENT_DAMAGE_WINDOW_MS = 4_000;
const LOW_HEALTH_RETREAT_THRESHOLD = 14;
const CRITICAL_HEALING_THRESHOLD = 10;
const SEVERE_DAMAGE_MINIMUM = 4;
const SURVIVAL_RETREAT_DISTANCE = 24;
const SURVIVAL_FALLBACK_DISTANCE = 12;
const SURVIVAL_RETREAT_COOLDOWN_MS = 4_000;
const DROWNING_REFLEX_OXYGEN = 12;
const FALL_REFLEX_VELOCITY = -0.7;
const IMMEDIATE_EXPLOSIVE_RANGE = 10;
const CRITICAL_EXPLOSIVE_RANGE = 6;
const CRITICAL_TACTICAL_HEALTH = 8;
// Match the ordinary tactical-combat observation envelope. Projectile mobs can
// damage the bot well before they enter an eight-block melee bubble, so a
// recent hit must be allowed to bind the loaded attacker while useful health
// remains for the existing deterministic retreat response.
const SELF_DEFENSE_RANGE = 16;
const COMBAT_PRIORITY_ROLES = new Set(['defender', 'attacker']);
const RETREAT_ROUTE_FAILURE_CODES = new Set([
    'skill_unreachable',
    'skill_path_not_found',
    'skill_path_execution_failed',
]);
const RETREAT_ROUTE_FAILURE_OUTCOMES = new Set([
    'unreachable',
    'path_not_found',
    'path_execution_failed',
    'retreat_blocked',
    'retreat_no_progress',
]);

function reflexBlockPosition(position) {
    if (![position?.x, position?.y, position?.z].every(Number.isFinite)) return null;
    return Object.freeze({
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
    });
}

function sameReflexBlockPosition(left, right) {
    return Boolean(
        left
        && right
        && left.x === right.x
        && left.y === right.y
        && left.z === right.z
    );
}

function tacticalFailureStage({ failureCode, failureOutcome, response } = {}) {
    if (
        response === 'retreat'
        && (
            RETREAT_ROUTE_FAILURE_CODES.has(String(failureCode || ''))
            || RETREAT_ROUTE_FAILURE_OUTCOMES.has(String(failureOutcome || ''))
        )
    ) return 'route_unavailable';
    return 'tactical_execution';
}

function selfDefenseReflexReceipt(agent, threat, detail = {}) {
    const bot = agent?.bot;
    const targetName = String(threat?.name || '').toLowerCase().slice(0, 64);
    const threatAirborne = typeof threat?.onGround === 'boolean'
        ? threat.onGround === false
        : null;
    const failureCode = String(detail.failureCode || '').slice(0, 80);
    const failureOutcome = String(detail.failureOutcome || '').slice(0, 80);
    const response = String(detail.response || '').slice(0, 40);
    return Object.freeze({
        entityId: Number.isFinite(Number(threat?.id)) ? Number(threat.id) : null,
        entityUuid: typeof threat?.uuid === 'string' ? threat.uuid.slice(0, 80) : null,
        targetName,
        threatAirborne,
        botPosition: reflexBlockPosition(bot?.entity?.position),
        threatPosition: reflexBlockPosition(threat?.position),
        health: Number.isFinite(Number(bot?.health))
            ? Math.round(Number(bot.health) * 10) / 10
            : null,
        lastDamageTime: Number.isFinite(Number(bot?.lastDamageTime))
            ? Number(bot.lastDamageTime)
            : 0,
        dimension: String(bot?.game?.dimension || '').slice(0, 48),
        failureCode,
        failureOutcome,
        failureStage: tacticalFailureStage({ failureCode, failureOutcome, response }),
        response,
        responseReason: String(detail.responseReason || '').slice(0, 64),
        retreatDistanceBefore: Number.isFinite(Number(detail.retreatDistanceBefore))
            ? Math.round(Number(detail.retreatDistanceBefore) * 10) / 10
            : null,
        retreatDistanceAfter: Number.isFinite(Number(detail.retreatDistanceAfter))
            ? Math.round(Number(detail.retreatDistanceAfter) * 10) / 10
            : null,
    });
}

/**
 * A failed tactical response is retry authority only after material Minecraft
 * evidence changes. A scheduler delay alone cannot make the same retreat,
 * pursuit, or attack succeed against an unchanged hostile.
 */
export function selfDefenseReflexEligibility(agent, threat, failedReceipt = null) {
    const receipt = selfDefenseReflexReceipt(agent, threat);
    const sameThreatInstance = Boolean(
        failedReceipt
        && receipt.entityId !== null
        && failedReceipt.entityId === receipt.entityId
        && (failedReceipt.entityUuid || null) === (receipt.entityUuid || null)
    );
    const equivalentAirborneThreat = Boolean(
        failedReceipt
        && receipt.targetName
        && failedReceipt.targetName === receipt.targetName
        && failedReceipt.threatAirborne === true
        && receipt.threatAirborne === true
    );
    const criticalRouteFailure = Boolean(
        failedReceipt?.failureStage === 'route_unavailable'
        && failedReceipt.response === 'retreat'
        && failedReceipt.responseReason === 'critical_health'
    );
    const unchangedCriticalRouteFailure = Boolean(
        criticalRouteFailure
        && (sameThreatInstance || equivalentAirborneThreat)
        && sameReflexBlockPosition(failedReceipt.botPosition, receipt.botPosition)
        && failedReceipt.dimension === receipt.dimension
        && failedReceipt.threatAirborne === receipt.threatAirborne
        && Number.isFinite(receipt.health)
        && receipt.health <= CRITICAL_TACTICAL_HEALTH
    );
    const unchangedOrdinaryFailure = Boolean(
        failedReceipt
        && !criticalRouteFailure
        && sameThreatInstance
        && sameReflexBlockPosition(failedReceipt.botPosition, receipt.botPosition)
        && failedReceipt.health === receipt.health
        && Number(failedReceipt.lastDamageTime || 0) === receipt.lastDamageTime
        && failedReceipt.dimension === receipt.dimension
    );
    const unchangedFailure = unchangedCriticalRouteFailure || unchangedOrdinaryFailure;
    return Object.freeze({
        eligible: !unchangedFailure,
        code: unchangedFailure
            ? 'unchanged_failed_tactical_suppressed'
            : 'self_defense_evidence_changed',
        receipt,
    });
}

/**
 * Ordinary nearby-hostile scanning is ambient autonomy. It cannot take the
 * body away from an explicit player action merely because that action lasts
 * longer than a short startup grace period. Fresh damage and attributed
 * protection are selected before this gate and remain valid reflex authority.
 */
export function ambientSelfDefensePermitted(agent) {
    return !durablePlayerAccompanimentActive(agent)
        && !(agent?.actions?.executing === true
            && agent.actions.currentActionOwner === 'player');
}

/**
 * Follow and guard are standing player commitments, not just the individual
 * ActionManager turn currently moving the body. Keep that authority through
 * the brief idle handoff after a safety reflex so ambient hostile scanning
 * cannot win another turn before the accepted directive resumes.
 */
export function durablePlayerAccompanimentActive(agent) {
    const directive = String(
        agent?.companion_context?.snapshot?.().directive || '',
    ).toLowerCase();
    return directive === 'follow' || directive === 'guard';
}

function announceAccompanimentHandoff(agent, message) {
    if (agent?.shut_up || typeof agent?.openChat !== 'function') return false;
    void Promise.resolve(agent.openChat(message)).catch(error => {
        console.error(`[mode:handoff] Failed to send safety status: ${String(error?.message || error).slice(0, 512)}`);
    });
    return true;
}

/**
 * Once tactical combat has physically disengaged from the exact hostile that
 * caused a safety incident, let the survival-owned rendezvous/cover action
 * finish. A new hit moves the incident back to `threat_response`, and a
 * different entity never matches this gate, so genuine new danger can still
 * preempt immediately.
 */
export function selfDefenseRecoveryOwnsSameThreat(agent, threat) {
    const director = agent?.survival_director;
    const snapshot = director?.snapshot?.() || null;
    const incident = director?.safetyIncident || snapshot?.safetyIncident;
    const status = director?.status || snapshot;
    const sourceId = Number(incident?.source?.id);
    const threatId = Number(threat?.id);
    return Boolean(
        incident?.active === true
        && incident.stage === 'disengaged'
        && Number.isFinite(sourceId)
        && Number.isFinite(threatId)
        && sourceId === threatId
        && agent?.actions?.executing === true
        && agent.actions.currentActionOwner === 'survival'
        && ['return_to_player', 'seek_shelter'].includes(status?.code)
    );
}

/**
 * Cancellation is censored. Latch only a physically settled, retryable
 * tactical-combat failure using the structured skill receipt rather than
 * parsing logs or narration. Successful settlement and terminal failures do
 * not need retry suppression.
 */
export function selfDefenseFailedTacticalReceipt(agent, threat, execution) {
    const result = execution?.result;
    const skill = result?.evidence?.skill;
    const lastDecision = Array.isArray(skill?.decisions) ? skill.decisions.at(-1) : null;
    const before = Number(skill?.retreatDistanceBefore);
    const after = Number(skill?.retreatDistanceAfter);
    if (
        execution?.interrupted
        || result?.phase !== 'failed'
        || skill?.kind !== 'tactical_combat'
        || skill?.retryable === false
    ) return null;
    return selfDefenseReflexReceipt(agent, threat, {
        failureCode: result.code,
        failureOutcome: skill.outcome,
        response: lastDecision?.response,
        responseReason: lastDecision?.reason,
        retreatDistanceBefore: before,
        retreatDistanceAfter: after,
    });
}

export function shouldUseCriticalHealingPotion(bot, threshold = CRITICAL_HEALING_THRESHOLD) {
    const health = Number(bot?.health);
    if (!Number.isFinite(health) || health > threshold) return false;
    return (bot?.inventory?.items?.() || []).some(item => (
        isDrinkableHealingPotion(item, bot.version)
    ));
}

export function recentDamageRequiresRetreat(bot, now = Date.now()) {
    const health = Number(bot?.health);
    const lastDamageTaken = Number(bot?.lastDamageTaken);
    const lastDamageTime = Number(bot?.lastDamageTime);
    if (!Number.isFinite(health) || !Number.isFinite(lastDamageTime)) return false;
    return now - lastDamageTime < RECENT_DAMAGE_WINDOW_MS
        && (
            health <= LOW_HEALTH_RETREAT_THRESHOLD
            || lastDamageTaken >= Math.max(SEVERE_DAMAGE_MINIMUM, health * 0.5)
    );
}

/**
 * A retreat leg that bought real distance but still lost health is not an
 * unchanged retry. Preserve emergency ownership for the next behavior tick
 * instead of letting the ordinary combat band replace self-preservation while
 * the bot is critically exposed.
 */
export function rearmDeterioratingSelfPreservationRetreat(mode, agent, execution) {
    const result = execution?.result;
    const skill = result?.evidence?.skill;
    const healthBefore = Number(skill?.healthBefore);
    const healthAfter = Number(skill?.healthAfter);
    const distanceBefore = Number(skill?.retreatDistanceBefore);
    const distanceAfter = Number(skill?.retreatDistanceAfter);
    const materiallyChanged = Boolean(
        execution?.interrupted !== true
        && result?.phase === 'failed'
        && skill?.kind === 'tactical_combat'
        && skill?.outcome === 'retreat_health_deteriorated'
        && skill?.retryable === true
        && Number.isFinite(healthBefore)
        && Number.isFinite(healthAfter)
        && healthAfter < healthBefore
        && Number.isFinite(distanceBefore)
        && Number.isFinite(distanceAfter)
        && distanceAfter > distanceBefore + 0.5
    );
    if (!materiallyChanged || !mode) return false;
    mode.last_retreat_at = 0;
    mode.next_retry_at = 0;
    agent?.behavior_arbiter?.wake?.('self_preservation_health_deteriorated');
    return true;
}

/**
 * Breathing at the surface is not stable settlement while swim input is still
 * required. Keep the emergency lane ahead of combat until Pathfinder reaches
 * dry support or a later observation proves the body is no longer in water.
 */
export function rearmOpenWaterDrowningEscape(mode, agent, execution) {
    const result = execution?.result;
    const skill = result?.evidence?.skill;
    const bot = agent?.bot;
    const stillInWater = Boolean(bot?.entity?.isInWater || bot?.blockAt?.(bot.entity?.position)?.name === 'water');
    if (
        execution?.interrupted === true
        || result?.phase !== 'failed'
        || skill?.kind !== 'survival'
        || skill?.outcome !== 'drowning_escape_open_water'
        || skill?.retryable !== true
        || !stillInWater
    ) return false;
    mode.next_retry_at = 0;
    agent?.behavior_arbiter?.wake?.('open_water_drowning_escape');
    return true;
}

function getImmediateExplosiveThreat(agent) {
    const bot = agent?.bot;
    if (!bot?.entity?.position) return null;
    try {
        const threat = world.getNearestEntityWhere(
            bot,
            entity => entity?.name === 'creeper' && mc.isCombatSafeHostile(entity),
            IMMEDIATE_EXPLOSIVE_RANGE,
        );
        if (!threat) return null;
        // A solid wall is already valid blast protection. Unknown visibility is
        // treated conservatively because an unloaded ray sample must not turn a
        // lethal approach into permission to stand still.
        return world.hasLineOfSightToEntity(bot, threat) === false ? null : threat;
    } catch {
        return null;
    }
}

function explosiveReflexReceipt(agent, threat) {
    const bot = agent?.bot;
    const distance = threat?.position && bot?.entity?.position?.distanceTo
        ? bot.entity.position.distanceTo(threat.position)
        : Number.POSITIVE_INFINITY;
    return Object.freeze({
        entityId: Number.isFinite(Number(threat?.id)) ? Number(threat.id) : null,
        entityUuid: typeof threat?.uuid === 'string' ? threat.uuid.slice(0, 80) : null,
        actionLabel: String(agent?.actions?.currentActionLabel || '').slice(0, 120),
        goalId: typeof agent?.goal_director?.activeGoal?.id === 'string'
            ? agent.goal_director.activeGoal.id.slice(0, 120)
            : null,
        lastDamageTime: Number.isFinite(Number(bot?.lastDamageTime))
            ? Number(bot.lastDamageTime)
            : 0,
        rangeBand: distance <= CRITICAL_EXPLOSIVE_RANGE ? 'critical' : 'warning',
    });
}

/**
 * A warning-range explosive observation may become stale while ActionManager
 * settles the player action it preempts. If tactical revalidation then finds
 * the area already secure, do not steal the same commitment again for the
 * same entity and unchanged damage evidence. A critical-range threat, new
 * damage, a different entity, action, or goal is always material new evidence.
 */
export function explosiveReflexEligibility(agent, threat, staleReceipt = null) {
    const receipt = explosiveReflexReceipt(agent, threat);
    const sameEntity = staleReceipt
        && receipt.entityId !== null
        && staleReceipt.entityId === receipt.entityId
        && (staleReceipt.entityUuid || null) === (receipt.entityUuid || null);
    const repeatedStaleWarning = Boolean(
        receipt.rangeBand === 'warning'
        && sameEntity
        && staleReceipt.actionLabel === receipt.actionLabel
        && (staleReceipt.goalId || null) === (receipt.goalId || null)
        && Number(staleReceipt.lastDamageTime || 0) === receipt.lastDamageTime
    );
    return Object.freeze({
        eligible: !repeatedStaleWarning,
        code: repeatedStaleWarning ? 'stale_explosive_trigger_suppressed' : 'explosive_threat_observed',
        receipt,
    });
}

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
    const receipt = freshReceivedDamageReceipt(agent);
    if (!receipt || receipt.kind !== 'hostile') return null;
    const exact = liveReceivedDamageSource(agent, receipt);
    if (!exact?.position || !mc.isCombatSafeHostile(exact)) return null;
    const distance = typeof exact.position.distanceTo === 'function'
        ? exact.position.distanceTo(bot.entity?.position)
        : Math.hypot(
            Number(exact.position.x) - Number(bot.entity?.position?.x),
            Number(exact.position.y) - Number(bot.entity?.position?.y),
            Number(exact.position.z) - Number(bot.entity?.position?.z),
        );
    return Number.isFinite(distance) && distance <= SELF_DEFENSE_RANGE ? exact : null;
}

function freshReceivedDamageReceipt(agent) {
    const receipt = agent?.bot?.lastDamageSource;
    const age = Date.now() - Number(receipt?.observedAt);
    return receipt?.matchesSelf === true
        && Number.isFinite(age)
        && age >= 0
        && age < RECENT_DAMAGE_WINDOW_MS
        ? receipt
        : null;
}

function liveReceivedDamageSource(agent, receipt = freshReceivedDamageReceipt(agent)) {
    const source = receipt?.source;
    if (!Number.isFinite(Number(source?.id))) return null;
    const entity = agent?.bot?.entities?.[Number(source.id)] || null;
    if (!entity) return null;
    const expectedPlayer = String(source.username || '').toLowerCase();
    const actualPlayer = String(entity.username || '').toLowerCase();
    if (expectedPlayer && actualPlayer !== expectedPlayer) return null;
    const expectedName = String(source.name || '').toLowerCase();
    const actualName = String(entity.name || '').toLowerCase();
    if (!expectedPlayer && expectedName && actualName !== expectedName) return null;
    return entity;
}

function getAttributedProtectionThreat(agent) {
    const threat = agent?.companion_context?.protectionThreat?.() || null;
    const botPosition = agent?.bot?.entity?.position;
    if (!threat?.position || !botPosition) return null;
    const distance = Math.hypot(
        threat.position.x - botPosition.x,
        threat.position.y - botPosition.y,
        threat.position.z - botPosition.z,
    );
    return Number.isFinite(distance) && distance <= SELF_DEFENSE_RANGE ? threat : null;
}

function standingDirectiveIdentity(agent) {
    const context = agent?.companion_context;
    const snapshot = context && typeof context.directive !== 'undefined'
        ? context
        : context?.snapshot?.() || {};
    const directive = String(snapshot?.directive || '').toLowerCase();
    if (directive !== 'follow' && directive !== 'guard') return null;
    return Object.freeze({
        directive,
        canonicalUsername: String(snapshot.canonicalUsername || '').slice(0, 64),
        authorizedAt: snapshot.directiveAuthorizedAt ?? null,
        presence: String(snapshot.presence || 'unknown'),
    });
}

function peekAttributedProtectionThreat(agent, now = Date.now()) {
    const protection = agent?.companion_context?.protection;
    if (
        protection?.state !== 'attributed'
        || !Number.isFinite(Number(protection.threatEntityId))
        || !Number.isFinite(Number(protection.expiresAt))
        || now >= Number(protection.expiresAt)
    ) return null;
    const entity = agent?.bot?.entities?.[Number(protection.threatEntityId)] || null;
    if (!entity?.position || !mc.isCombatSafeHostile(entity)) return null;
    const position = agent?.bot?.entity?.position;
    if (!position) return null;
    const distance = Math.hypot(
        Number(entity.position.x) - Number(position.x),
        Number(entity.position.y) - Number(position.y),
        Number(entity.position.z) - Number(position.z),
    );
    return Number.isFinite(distance) && distance <= SELF_DEFENSE_RANGE ? entity : null;
}

function safetyRecoveryOwnsThreat(agent, threat) {
    const director = agent?.survival_director;
    const incident = director?.safetyIncident || director?.snapshot?.()?.safetyIncident;
    return Boolean(
        incident?.active === true
        && incident.stage === 'disengaged'
        && Number.isFinite(Number(incident.source?.id))
        && Number(incident.source.id) === Number(threat?.id)
    );
}

function attributedAccompanimentProposal(agent, selfPreservationMode, selfDefenseMode, now = Date.now()) {
    const directive = standingDirectiveIdentity(agent);
    if (!directive) return Object.freeze({ applicable: false, code: 'standing_directive_absent' });

    const damageReceipt = freshReceivedDamageReceipt(agent);
    const recentDamageThreat = damageReceipt?.kind === 'hostile'
        ? getRecentDamageCombatThreat(agent)
        : null;
    const protectionThreat = peekAttributedProtectionThreat(agent, now);
    const retreatRequired = Boolean(recentDamageThreat && recentDamageRequiresRetreat(agent?.bot, now));
    const threat = retreatRequired
        ? recentDamageThreat
        : protectionThreat || recentDamageThreat;
    if (!threat) {
        return Object.freeze({
            applicable: false,
            code: 'attributed_threat_absent',
            directive,
        });
    }

    const attribution = protectionThreat === threat ? 'protected_player' : 'self_damage';
    const failedReceipt = retreatRequired
        ? selfPreservationMode?.failed_tactical_trigger
        : selfDefenseMode?.failed_tactical_trigger;
    const eligibility = selfDefenseReflexEligibility(agent, threat, failedReceipt);
    return Object.freeze({
        applicable: true,
        code: 'attributed_accompaniment_observed',
        directive,
        threat: Object.freeze({
            entityId: Number(threat.id),
            entityUuid: typeof threat.uuid === 'string' ? threat.uuid.slice(0, 80) : null,
            name: String(threat.name || threat.username || 'threat').slice(0, 64),
            attribution,
        }),
        retreatRequired,
        recoveryOwnsThreat: safetyRecoveryOwnsThreat(agent, threat),
        tacticalEligible: eligibility.eligible,
        tacticalCode: eligibility.code,
        handoffMessage: selfDefenseHandoffMessage(
            agent,
            attribution === 'protected_player' ? threat : null,
            attribution === 'self_damage' ? damageReceipt : null,
            threat,
        ),
    });
}

function liveProposalThreat(agent, proposal) {
    const expectedId = Number(proposal?.threat?.entityId);
    if (!Number.isFinite(expectedId)) return null;
    const entity = agent?.bot?.entities?.[expectedId] || null;
    if (!entity?.position || !mc.isCombatSafeHostile(entity)) return null;
    const expectedUuid = proposal?.threat?.entityUuid || null;
    if (expectedUuid && entity.uuid !== expectedUuid) return null;
    return entity;
}

function dispatchAttributedRetreat(mode, agent, proposal) {
    const threat = liveProposalThreat(agent, proposal);
    if (!threat) return { scheduled: false, code: 'proposal_stale' };
    if (agent.survival_director?.observeAttributedThreat?.(proposal.threat) !== true) {
        return { scheduled: false, code: 'safety_incident_unavailable' };
    }
    mode.failed_tactical_trigger = null;
    mode.last_retreat_at = Date.now();
    say(agent, `I'm badly hurt—breaking contact with the ${threat.name.replaceAll('_', ' ')} that hit me!`);
    void execute(mode, agent, async () => {
        if (shouldUseCriticalHealingPotion(agent.bot)) {
            await skills.consume(agent.bot, 'healing_potion');
            if (agent.bot.interrupt_code) return false;
        }
        return await skills.resolveTacticalCombat(
            agent.bot,
            SURVIVAL_RETREAT_DISTANCE,
            threat.id,
            { objective: 'disengage' },
        );
    }).then(execution => {
        mode.failed_tactical_trigger = selfDefenseFailedTacticalReceipt(agent, threat, execution) || null;
        rearmDeterioratingSelfPreservationRetreat(mode, agent, execution);
    });
    return { scheduled: true, code: 'shared_accompaniment_intent_scheduled' };
}

function dispatchAttributedProtection(mode, agent, proposal) {
    const threat = liveProposalThreat(agent, proposal);
    if (!threat) return { scheduled: false, code: 'proposal_stale' };
    if (agent.survival_director?.observeAttributedThreat?.(proposal.threat) !== true) {
        return { scheduled: false, code: 'safety_incident_unavailable' };
    }
    mode.failed_tactical_trigger = null;
    say(agent, proposal.threat.attribution === 'protected_player'
        ? `Protecting ${agent.companion_context?.canonicalUsername || 'the guarded player'} from ${threat.name}!`
        : `Fighting ${threat.name}!`);
    void execute(mode, agent, async () => {
        try {
            return await skills.resolveTacticalCombat(agent.bot, SELF_DEFENSE_RANGE, threat.id);
        } finally {
            if (proposal.threat.attribution === 'protected_player') {
                agent.companion_context?.clearProtection?.('engagement_finished');
            }
        }
    }, -1, { handoffMessage: proposal.handoffMessage }).then(execution => {
        mode.failed_tactical_trigger = selfDefenseFailedTacticalReceipt(agent, threat, execution) || null;
    });
    return { scheduled: true, code: 'shared_accompaniment_intent_scheduled' };
}

function handoffSubject(value, fallback) {
    const normalized = String(value || '')
        .replaceAll('_', ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 64);
    return normalized || fallback;
}

function selfDefenseHandoffMessage(agent, protectionThreat, damageReceipt, enemy) {
    const threatName = handoffSubject(enemy?.name || enemy?.username, 'threat');
    if (protectionThreat) {
        const playerName = handoffSubject(
            agent?.companion_context?.canonicalUsername,
            'the player I am protecting',
        );
        return `${playerName} was attacked by ${threatName}. I am stepping in, then I will resume your order.`;
    }
    if (damageReceipt) {
        return `${threatName} attacked me. I am responding, then I will resume your order.`;
    }
    return 'I need to respond to a nearby threat, then I will resume your order.';
}

function hasFreshPlayerAction(agent) {
    const actions = agent?.actions;
    if (actions?.executing !== true || actions.currentActionOwner !== 'player') return false;
    const startedAt = Number(actions.currentActionStartedAt || actions.last_action_time);
    return Number.isFinite(startedAt)
        && startedAt > 0
        && Date.now() - startedAt < FRESH_PLAYER_ACTION_GRACE_MS;
}

function getModeSuppressionReason(agent, mode) {
    if (!agent || !mode) return null;
    const heldRecentDamageDefense = mode.name === 'self_defense'
        && Boolean(getRecentDamageCombatThreat(agent));
    if (
        agent.isOperatorHeld?.()
        && mode.name !== 'self_preservation'
        && !heldRecentDamageDefense
    ) {
        return 'operator_hold';
    }

    if (PLAYER_ACTION_GUARD_MODES.has(mode.name) && hasFreshPlayerAction(agent)) {
        return 'fresh_player_action';
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
    const movementController = new AbortController();
    let timeoutId;
    const movement = Promise.resolve()
        .then(() => moveAway(agent.bot, 5, { signal: movementController.signal }))
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
        movementController.abort('unstuck_timeout');
        stopUnstuckMotion(agent);
        // The timeout owns cancellation and does not release the lane until the
        // movement promise acknowledges it. No stale navigation continuation
        // can mutate controls after the recovery result is returned.
        await movement;
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
        stale_explosive_trigger: null,
        failed_tactical_trigger: null,
        update: function (agent, { skipAttributedAccompaniment = false } = {}) {
            const bot = agent.bot;
            let explosiveThreat = null;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            const oxygen = Number(bot.oxygenLevel);
            const health = Number(bot.health);
            const criticalWaterExposure = bot.entity.isInWater
                && Number.isFinite(health)
                && health <= LOW_HEALTH_RETREAT_THRESHOLD;
            const isFalling = !bot.entity.onGround
                && !bot.entity.isInWater
                && !bot.entity.isInLava
                && Number(bot.entity.velocity?.y) <= FALL_REFLEX_VELOCITY;
            if (
                (blockAbove.name === 'water' && Number.isFinite(oxygen) && oxygen <= DROWNING_REFLEX_OXYGEN)
                || criticalWaterExposure
            ) {
                say(agent, criticalWaterExposure && blockAbove.name !== 'water'
                    ? 'I need stable shore before I can fight.'
                    : 'I need air!');
                void execute(this, agent, async () => {
                    return await skills.escapeDrowning(bot);
                }).then(execution => {
                    rearmOpenWaterDrowningEscape(this, agent, execution);
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
            else if ((explosiveThreat = getImmediateExplosiveThreat(agent))) {
                const eligibility = explosiveReflexEligibility(
                    agent,
                    explosiveThreat,
                    this.stale_explosive_trigger,
                );
                if (!eligibility.eligible) {
                    return { code: eligibility.code };
                }
                say(agent, `A ${explosiveThreat.name.replaceAll('_', ' ')} is too close—moving clear!`);
                void execute(this, agent, async () => {
                    const resolved = await skills.resolveTacticalCombat(
                        bot,
                        SELF_DEFENSE_RANGE,
                        explosiveThreat.id,
                    );
                    this.stale_explosive_trigger = bot.lastActionEvidence?.outcome === 'area_already_secure'
                        && eligibility.receipt.rangeBand === 'warning'
                        ? eligibility.receipt
                        : null;
                    return resolved;
                });
            }
            else if (
                !skipAttributedAccompaniment
                &&
                recentDamageRequiresRetreat(bot)
                && Date.now() - this.last_retreat_at >= SURVIVAL_RETREAT_COOLDOWN_MS
            ) {
                const now = Date.now();
                const sourceReceipt = freshReceivedDamageReceipt(agent);
                const damageSource = liveReceivedDamageSource(agent, sourceReceipt);
                const threat = sourceReceipt?.kind === 'hostile' && damageSource
                    ? damageSource
                    : null;
                this.last_retreat_at = now;
                if (sourceReceipt?.kind === 'requester_player') {
                    say(agent, 'You hit me. I\'m giving you room; tell me if that was intentional.');
                } else if (sourceReceipt?.kind === 'other_player') {
                    say(agent, `${sourceReceipt.source?.username || 'Another player'} hit me. I'm getting clear and need help!`);
                } else {
                    say(agent, threat?.name
                        ? `I'm badly hurt—responding to the ${threat.name.replaceAll('_', ' ')} that hit me!`
                        : 'I\'m badly hurt, but the damage source is unknown—seeking safety without blaming a nearby mob!');
                }
                void execute(this, agent, async () => {
                    if (shouldUseCriticalHealingPotion(bot)) {
                        await skills.consume(bot, 'healing_potion');
                        if (bot.interrupt_code) return false;
                    }
                    if (threat?.position) {
                        return await skills.resolveTacticalCombat(
                            bot,
                            SURVIVAL_RETREAT_DISTANCE,
                            threat.id,
                            { objective: 'disengage' },
                        );
                    }
                    if (damageSource?.position && sourceReceipt?.kind === 'requester_player') {
                        return await skills.moveAwayFromEntity(bot, damageSource, 8);
                    }
                    if (damageSource?.position && sourceReceipt?.kind === 'other_player') {
                        return await skills.moveAwayFromEntity(bot, damageSource, SURVIVAL_RETREAT_DISTANCE);
                    }
                    return await skills.moveAway(bot, SURVIVAL_FALLBACK_DISTANCE);
                }).then(execution => {
                    rearmDeterioratingSelfPreservationRetreat(this, agent, execution);
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
        max_stuck_time: 8,
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
            const actionStartedAt = agent.actions?.currentActionStartedAt
                || agent.actions?.last_action_time
                || null;
            if ((Number(bot.mindcraftManagedNavigationDepth) || 0) > 0) {
                this.prev_location = null;
                this.stuck_time = 0;
                this.prev_dig_block = null;
                this.last_time = Date.now();
                return;
            }
            const vehicleControlActive = Boolean(
                bot.vehicle
                && ['forward', 'back', 'left', 'right', 'jump']
                    .some(control => bot.getControlState?.(control) === true)
            );
            const movementExpected = Boolean(bot.pathfinder?.goal || vehicleControlActive);
            if (!movementExpected) {
                this.prev_location = null;
                this.stuck_time = 0;
                this.prev_dig_block = null;
                this.last_time = Date.now();
                return;
            }
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
        update: async function (agent, { skipAttributedAccompaniment = false } = {}) {
            if (skipAttributedAccompaniment) return { code: 'shared_accompaniment_policy_owns_threat' };
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
        failed_tactical_trigger: null,
        update: function (agent, { skipAttributedAccompaniment = false } = {}) {
            if (skipAttributedAccompaniment) return { code: 'shared_accompaniment_policy_owns_threat' };
            const protectionThreat = getAttributedProtectionThreat(agent);
            const damageReceipt = freshReceivedDamageReceipt(agent);
            const enemy = protectionThreat || (damageReceipt
                ? getRecentDamageCombatThreat(agent)
                : agent.runtime?.autonomy === 'command' || !ambientSelfDefensePermitted(agent)
                    ? null
                    : world.getNearestEntityWhere(
                        agent.bot,
                        entity => mc.isCombatSafeHostile(entity),
                        SELF_DEFENSE_RANGE,
                    ));
            if (!enemy) return;
            if (selfDefenseRecoveryOwnsSameThreat(agent, enemy)) {
                return { code: 'survival_incident_recovery_owns_same_threat' };
            }
            const eligibility = selfDefenseReflexEligibility(
                agent,
                enemy,
                this.failed_tactical_trigger,
            );
            if (!eligibility.eligible) return { code: eligibility.code };
            this.failed_tactical_trigger = null;
            // Threat relevance is independent from whether pathfinder can walk
            // beside the nearest hostile. The tactical selector evaluates all
            // loaded threats and chooses melee, range, or retreat itself.
            say(agent, protectionThreat
                ? `Protecting ${agent.companion_context?.canonicalUsername || 'the guarded player'} from ${enemy.name}!`
                : `Fighting ${enemy.name}!`);
            void execute(this, agent, async () => {
                try {
                    return await skills.resolveTacticalCombat(
                        agent.bot,
                        SELF_DEFENSE_RANGE,
                        enemy.id,
                    );
                } finally {
                    if (protectionThreat) agent.companion_context?.clearProtection?.('engagement_finished');
                }
            }, -1, {
                handoffMessage: selfDefenseHandoffMessage(
                    agent,
                    protectionThreat,
                    damageReceipt,
                    enemy,
                ),
            }).then(execution => {
                const failedTactical = selfDefenseFailedTacticalReceipt(agent, enemy, execution);
                this.failed_tactical_trigger = failedTactical || null;
            });
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
            let item = world.getNearestEntityWhere(
                agent.bot,
                entity => entity.name === 'item' && !skills.isIgnoredPickupEntity(agent.bot, entity),
                8,
            );
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
        was_idle: false,
        last_look_at: 0,
        update: function (agent) {
            if (!agent.isIdle()) {
                this.was_idle = false;
                return false;
            }
            const now = Date.now();
            const becameIdle = !this.was_idle;
            this.was_idle = true;
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
            if (entity_in_view && (becameIdle || entity !== this.last_entity)) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = now + Math.random() * 1000 + 4000;
                changedAttention = true;
            }
            if (entity_in_view && this.staring && now - this.last_look_at >= 250) {
                const isBaby = entity.type !== 'player' && entity.metadata?.[16];
                const fullHeight = Number.isFinite(entity.height) ? entity.height : 1.6;
                const eyeHeight = isBaby
                    ? Math.max(0.35, fullHeight * 0.65)
                    : Math.max(0.75, fullHeight * 0.85);
                this.last_look_at = now;
                void Promise.resolve()
                    .then(() => agent.bot.lookAt(entity.position.offset(0, eyeHeight, 0), true))
                    .catch(error => console.warn(`[mode:idle_staring] Could not track visible entity: ${String(error?.message || error).slice(0, 240)}`));
            }
            if (!entity_in_view) {
                this.last_entity = null;
                this.staring = false;
            }
            const currentPitch = Number(agent.bot.entity?.pitch);
            const offHorizon = !entity_in_view
                && Number.isFinite(currentPitch)
                && Math.abs(currentPitch) > 0.18;
            if ((!entity_in_view && becameIdle) || offHorizon || now > this.next_change) {
                if (entity_in_view) {
                    this.staring = true;
                    this.next_change = now + Math.random() * 2000 + 4000;
                    return changedAttention;
                }
                // Physical actions often finish while looking at a mined block.
                // Return to a shallow horizon scan immediately so an idle bot
                // looks situationally aware instead of staring at its feet.
                const yaw = becameIdle
                    ? Number(agent.bot.entity?.yaw) || 0
                    : Math.random() * Math.PI * 2;
                const pitch = (Math.random() - 0.5) * 0.18;
                this.staring = false;
                this.last_look_at = now;
                void Promise.resolve()
                    .then(() => agent.bot.look(yaw, pitch, true))
                    .catch(error => console.warn(`[mode:idle_staring] Could not scan horizon: ${String(error?.message || error).slice(0, 240)}`));
                changedAttention = true;
                this.next_change = now + Math.random() * 6000 + 4000;
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

async function execute(mode, agent, func, timeout=-1, { handoffMessage = null } = {}) {
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    const continuingAccompaniment = durablePlayerAccompanimentActive(agent);
    const interruptedDirective = continuingAccompaniment
        ? standingDirectiveIdentity(agent)
        : null;
    const announcesSafetyHandoff = continuingAccompaniment
        && ['self_defense', 'self_preservation'].includes(mode.name);
    mode.active = true;
    let code_return;
    try {
        code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
            if (announcesSafetyHandoff) {
                announceAccompanimentHandoff(
                    agent,
                    mode.name === 'self_defense'
                        ? handoffMessage || 'I need to respond to a nearby threat, then I will resume your order.'
                        : 'I need to get safe for a moment, then I will resume your order.',
                );
            }
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

    if ((interrupted_action || continuingAccompaniment) && code_return?.success === true) {
        // A reflex preemption is a control-loop event, not a new conversation.
        // GoalDirector, JobDirector, and resumable companion directives already
        // retain the exact deterministic work to continue. Asking the model what
        // to do here added a full inference delay and commonly produced status or
        // awareness commands while the original action still owned control.
        if (announcesSafetyHandoff) {
            const skillOutcome = code_return?.result?.evidence?.skill?.outcome;
            const recoveryStillRequired = skillOutcome === 'retreated';
            announceAccompanimentHandoff(
                agent,
                recoveryStillRequired
                    ? 'I broke contact. I am getting safe before I resume your order.'
                    : 'I am clear. Resuming your order now.',
            );
        }
        agent.behavior_arbiter?.requestDirectiveResume?.(interruptedDirective);
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

    proposeAttributedAccompaniment() {
        const agent = controllerAgents.get(this);
        if (!agent) return Object.freeze({ applicable: false, code: 'agent_unavailable' });
        return attributedAccompanimentProposal(
            agent,
            this.modeMap.self_preservation,
            this.modeMap.self_defense,
        );
    }

    dispatchAttributedAccompaniment(intent, proposal) {
        const agent = controllerAgents.get(this);
        if (!agent || proposal?.applicable !== true) {
            return { active: false, scheduled: false, mode: null, code: 'proposal_unavailable' };
        }
        const currentDirective = standingDirectiveIdentity(agent);
        if (
            !currentDirective
            || currentDirective.directive !== proposal.directive?.directive
            || currentDirective.canonicalUsername.toLowerCase()
                !== String(proposal.directive?.canonicalUsername || '').toLowerCase()
            || (currentDirective.authorizedAt ?? null) !== (proposal.directive?.authorizedAt ?? null)
        ) {
            return { active: false, scheduled: false, mode: null, code: 'proposal_stale' };
        }
        const mode = intent === 'retreat'
            ? this.modeMap.self_preservation
            : intent === 'protect'
                ? this.modeMap.self_defense
                : null;
        if (!mode || mode.on !== true || mode.paused === true || mode.active === true) {
            return { active: false, scheduled: false, mode: mode?.name || null, code: 'selected_mode_unavailable' };
        }
        const dispatch = intent === 'retreat'
            ? dispatchAttributedRetreat(mode, agent, proposal)
            : dispatchAttributedProtection(mode, agent, proposal);
        return {
            active: mode.active === true,
            scheduled: dispatch.scheduled,
            mode: mode.name,
            code: dispatch.code,
        };
    }

    async updateBand(modeNames = [], options = {}) {
        const agent = controllerAgents.get(this);
        if (!agent) return { active: false, scheduled: false, mode: null, code: 'agent_unavailable' };
        if (!this.updateCycleOpen) this.beginUpdateCycle();
        const names = [...new Set(Array.isArray(modeNames) ? modeNames : [modeNames])];
        let inactiveCode = 'band_clear';
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
                const result = await mode.update(agent, options);
                if (result && typeof result === 'object' && typeof result.code === 'string') {
                    inactiveCode = result.code;
                }
                const scheduled = result === true
                    || mode.active
                    || (!wasExecuting && agent.actions.executing === true)
                    || previousLabel !== agent.actions.currentActionLabel;
                if (scheduled) {
                    return { active: mode.active === true, scheduled: true, mode: mode.name, code: 'mode_scheduled' };
                }
            }
        }
        return { active: false, scheduled: false, mode: null, code: inactiveCode };
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
                suppressedByPlayerAction: suppressionReason === 'fresh_player_action',
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
