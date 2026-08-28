import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { actionResultFromError, createActionResult } from './runtime/action-result.js';
import {
    createActionReceiptLedger,
    createLegacyActionReceiptEnvelope,
} from './runtime/action-receipt-ledger.js';

const ACTION_EXECUTION_CONTEXT = new AsyncLocalStorage();

export function currentActionExecutionContext() {
    return ACTION_EXECUTION_CONTEXT.getStore() || null;
}

export function recordActionChild(relationship, evidence) {
    const context = currentActionExecutionContext();
    if (context?.receiptMode !== 'composed' || !context.receiptLedger) {
        return Object.freeze({
            accepted: false,
            code: 'composed_action_receipt_context_unavailable',
            snapshot: null,
        });
    }
    return context.receiptLedger.recordChild(context.actionId, relationship, evidence);
}

export function recordActionTerminal(evidence) {
    const context = currentActionExecutionContext();
    if (context?.receiptMode !== 'composed' || !context.receiptLedger) {
        return Object.freeze({
            accepted: false,
            code: 'composed_action_receipt_context_unavailable',
            snapshot: null,
        });
    }
    return context.receiptLedger.recordTerminal(context.actionId, evidence);
}

const STOP_WAIT_TIMEOUT_MS = 10_000;
const GRACEFUL_HALT_TIMEOUT_MS = 350;
const SETTLEMENT_TIMEOUT_MS = 2_000;
// Escalating stop poll. A cooperative skill checks `interrupt_code` within a
// few milliseconds, so waiting a flat 300ms before re-testing put a hard floor
// under every handoff — including an emergency reflex preempting a job. The
// tail of the ladder keeps a stubborn action from being polled thousands of
// times before the 10s ceiling.
const STOP_POLL_LADDER_MS = Object.freeze([5, 10, 15, 25, 40, 60, 100, 150, 200, 300]);
// `requestInterrupt` writes control states and cancels tasks, which puts packets
// on the wire. The fast poll only re-reads `executing`; the interrupt itself is
// re-issued on this slower beat so a tight poll cannot flood the server.
const INTERRUPT_REISSUE_MS = 120;

function inferActivitySpecialist(_actionLabel, requestedSpecialist = null) {
    const requested = String(requestedSpecialist || '').trim().toLowerCase();
    if (
        requested === 'pathfinder'
        || requested === 'collectblock'
        || requested === 'container'
        || requested === 'craft'
        || requested === 'furnace'
        || requested === 'placement'
        || requested === 'pvp'
        || requested === 'vehicle'
    ) return requested;
    return null;
}

function activeControlState(bot) {
    return Object.values(bot?.controlState || {}).some(Boolean);
}

function compactPathProgress(result) {
    return {
        status: typeof result?.status === 'string' ? result.status : null,
        visitedNodes: Number.isFinite(result?.visitedNodes) ? result.visitedNodes : null,
        generatedNodes: Number.isFinite(result?.generatedNodes) ? result.generatedNodes : null,
    };
}

class PathfinderActivityAdapter {
    constructor(bot, onProgress) {
        this.bot = bot;
        this.onProgress = onProgress;
        this.listeners = [];
    }

    start() {
        this.listen('path_update', result => this.onProgress('path_update', compactPathProgress(result)));
        this.listen('path_reset', reason => this.onProgress('path_reset', { reason: String(reason || 'unknown') }));
        this.listen('goal_reached', () => this.onProgress('goal_reached', {}));
    }

    listen(event, listener) {
        this.bot.on(event, listener);
        this.listeners.push([event, listener]);
    }

    requestHalt() {
        let acknowledged = false;
        const onGoalUpdated = goal => {
            if (goal == null) acknowledged = true;
        };
        this.bot.on('goal_updated', onGoalUpdated);
        try {
            this.bot.pathfinder.setGoal(null);
        } finally {
            this.bot.removeListener('goal_updated', onGoalUpdated);
        }
        return Promise.resolve({ acknowledged, evidence: acknowledged ? 'goal_updated:null' : 'goal_update_not_observed' });
    }

    async forceHalt() {
        try { this.bot.pathfinder.stop(); } catch { /* no active path */ }
        try { this.bot.pathfinder.setGoal(null); } catch { /* no active goal */ }
        try { await Promise.resolve(this.bot.stopDigging()); } catch { /* no active dig */ }
        try { this.bot.clearControlStates(); } catch { /* disconnected body */ }
        return { acknowledged: this.isSettled(), evidence: 'pathfinder_stop' };
    }

    isSettled() {
        const pathfinder = this.bot?.pathfinder;
        if (
            typeof pathfinder?.isMoving !== 'function'
            || typeof pathfinder?.isMining !== 'function'
            || typeof pathfinder?.isBuilding !== 'function'
        ) return false;
        return pathfinder.isMoving() === false
            && pathfinder.isMining() === false
            && pathfinder.isBuilding() === false
            && this.bot.targetDigBlock == null
            && !activeControlState(this.bot);
    }

    waitForSettlement(timeoutMs) {
        if (this.isSettled()) return Promise.resolve({ settled: true, evidence: 'pathfinder_idle' });
        return new Promise(resolve => {
            let finished = false;
            const events = [
                'path_update',
                'path_reset',
                'path_stop',
                'goal_reached',
                'goal_updated',
                'diggingAborted',
                'diggingCompleted',
                'physicsTick',
            ];
            const cleanup = () => {
                for (const event of events) this.bot.removeListener(event, check);
                clearTimeout(timer);
            };
            const finish = result => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(result);
            };
            const check = () => {
                if (this.isSettled()) finish({ settled: true, evidence: 'pathfinder_idle' });
            };
            for (const event of events) this.bot.on(event, check);
            const timer = setTimeout(
                () => finish({ settled: false, evidence: 'pathfinder_settlement_timeout' }),
                timeoutMs,
            );
            check();
        });
    }

    dispose() {
        for (const [event, listener] of this.listeners) this.bot.removeListener(event, listener);
        this.listeners = [];
    }
}

class CollectBlockActivityAdapter {
    constructor(bot, onProgress) {
        this.bot = bot;
        this.onProgress = onProgress;
        this.listeners = [];
    }

    start() {
        this.listen('collectBlock_targetFailed', (_target, error) => {
            this.onProgress('collectBlock_targetFailed', {
                error: String(error?.message || error || 'unknown').slice(0, 160),
            });
        });
        this.listen('collectBlock_cancelled', generation => {
            this.onProgress('collectBlock_cancelled', { generation: generation ?? null });
        });
        this.listen('collectBlock_finished', generation => {
            this.onProgress('collectBlock_finished', { generation: generation ?? null });
        });
    }

    listen(event, listener) {
        this.bot.on(event, listener);
        this.listeners.push([event, listener]);
    }

    async requestHalt() {
        let cancelledEvent = false;
        const onCancelled = () => { cancelledEvent = true; };
        this.bot.on('collectBlock_cancelled', onCancelled);
        try {
            await this.bot.collectBlock.cancelTask();
        } finally {
            this.bot.removeListener('collectBlock_cancelled', onCancelled);
        }
        const acknowledged = cancelledEvent || this.bot.collectBlock.activeTask == null;
        return { acknowledged, evidence: cancelledEvent ? 'collectBlock_cancelled' : 'collectBlock_idle' };
    }

    async forceHalt() {
        try { this.bot.pathfinder.setGoal(null); } catch { /* no active goal */ }
        try { this.bot.pathfinder.stop(); } catch { /* no active path */ }
        try { await Promise.resolve(this.bot.stopDigging()); } catch { /* no active dig */ }
        try { this.bot.clearControlStates(); } catch { /* disconnected body */ }
        try { await this.bot.collectBlock.cancelTask(); } catch { /* settlement check remains authoritative */ }
        return { acknowledged: this.bot.collectBlock.activeTask == null, evidence: 'collectBlock_force_halt' };
    }

    isSettled() {
        const pathfinder = this.bot?.pathfinder;
        if (
            !this.bot?.collectBlock
            || typeof pathfinder?.isMoving !== 'function'
            || typeof pathfinder?.isMining !== 'function'
            || typeof pathfinder?.isBuilding !== 'function'
        ) return false;
        return this.bot.collectBlock.activeTask == null
            && pathfinder.isMoving() === false
            && pathfinder.isMining() === false
            && pathfinder.isBuilding() === false
            && this.bot.targetDigBlock == null
            && !activeControlState(this.bot);
    }

    waitForSettlement(timeoutMs) {
        if (this.isSettled()) return Promise.resolve({ settled: true, evidence: 'collectBlock_idle' });
        return new Promise(resolve => {
            let finished = false;
            const events = [
                'collectBlock_cancelled',
                'collectBlock_finished',
                'path_update',
                'path_reset',
                'path_stop',
                'diggingAborted',
                'diggingCompleted',
                'physicsTick',
            ];
            const cleanup = () => {
                for (const event of events) this.bot.removeListener(event, check);
                clearTimeout(timer);
            };
            const finish = result => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(result);
            };
            const check = () => {
                if (this.isSettled()) finish({ settled: true, evidence: 'collectBlock_idle' });
            };
            for (const event of events) this.bot.on(event, check);
            const timer = setTimeout(
                () => finish({ settled: false, evidence: 'collectBlock_settlement_timeout' }),
                timeoutMs,
            );
            check();
        });
    }

    dispose() {
        for (const [event, listener] of this.listeners) this.bot.removeListener(event, listener);
        this.listeners = [];
    }
}

class ContainerActivityAdapter extends PathfinderActivityAdapter {
    start() {
        super.start();
        this.listen('windowOpen', window => {
            this.onProgress('container_opened', {
                windowId: Number.isFinite(window?.id) ? window.id : null,
                windowType: String(window?.type || 'unknown').slice(0, 80),
            });
        });
        this.listen('windowClose', window => {
            this.onProgress('container_closed', {
                windowId: Number.isFinite(window?.id) ? window.id : null,
            });
        });
    }

    closeCurrentWindow() {
        const window = this.bot?.currentWindow;
        if (!window) return false;
        try {
            if (typeof window.close === 'function') window.close();
            else this.bot.closeWindow?.(window);
            return true;
        } catch {
            return false;
        }
    }

    async requestHalt() {
        const pathfinder = await super.requestHalt();
        const closedWindow = this.closeCurrentWindow();
        const acknowledged = this.isSettled();
        return {
            acknowledged,
            evidence: acknowledged
                ? (closedWindow ? 'container_closed_pathfinder_idle' : 'container_idle_pathfinder_idle')
                : `container_halt_pending:${pathfinder?.evidence || 'pathfinder_unknown'}`,
        };
    }

    async forceHalt() {
        this.closeCurrentWindow();
        await super.forceHalt();
        const acknowledged = this.isSettled();
        return {
            acknowledged,
            evidence: acknowledged ? 'container_force_closed_idle' : 'container_force_halt_pending',
        };
    }

    isSettled() {
        return this.bot?.currentWindow == null
            && this.bot?.inventory?.selectedItem == null
            && super.isSettled();
    }

    async waitForSettlement(timeoutMs) {
        const settlement = await super.waitForSettlement(timeoutMs);
        return settlement?.settled === true
            ? { settled: true, evidence: 'container_closed_pathfinder_idle' }
            : { settled: false, evidence: 'container_settlement_timeout' };
    }
}

class WindowTransactionActivityAdapter extends ContainerActivityAdapter {
    constructor(bot, onProgress, transactionKind) {
        super(bot, onProgress);
        this.transactionKind = transactionKind;
        this.activeTransactions = new Set();
    }

    start() {
        super.start();
        this.listen(`${this.transactionKind}_transaction_start`, transaction => {
            const transactionId = String(transaction?.transactionId || 'unknown');
            this.activeTransactions.add(transactionId);
            this.onProgress(`${this.transactionKind}_transaction_started`, {
                transactionId,
                target: transaction?.target || null,
            });
        });
        this.listen(`${this.transactionKind}_transaction_end`, transaction => {
            const transactionId = String(transaction?.transactionId || 'unknown');
            this.activeTransactions.delete(transactionId);
            this.onProgress(`${this.transactionKind}_transaction_ended`, {
                transactionId,
                target: transaction?.target || null,
                outcome: transaction?.outcome || null,
            });
        });
    }

    isSettled() {
        return this.activeTransactions.size === 0 && super.isSettled();
    }

    waitForSettlement(timeoutMs) {
        if (this.isSettled()) {
            return Promise.resolve({
                settled: true,
                evidence: `${this.transactionKind}_transaction_closed_cursor_clear_pathfinder_idle`,
            });
        }
        return new Promise(resolve => {
            let finished = false;
            const events = [
                `${this.transactionKind}_transaction_end`,
                'windowClose',
                'path_update',
                'path_reset',
                'path_stop',
                'goal_reached',
                'goal_updated',
                'physicsTick',
            ];
            const cleanup = () => {
                for (const event of events) this.bot.removeListener(event, check);
                clearTimeout(timer);
            };
            const finish = result => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(result);
            };
            const check = () => {
                if (this.isSettled()) finish({
                    settled: true,
                    evidence: `${this.transactionKind}_transaction_closed_cursor_clear_pathfinder_idle`,
                });
            };
            for (const event of events) this.bot.on(event, check);
            const timer = setTimeout(
                () => finish({
                    settled: false,
                    evidence: `${this.transactionKind}_transaction_settlement_timeout`,
                }),
                timeoutMs,
            );
            check();
        });
    }
}

class PlacementActivityAdapter extends PathfinderActivityAdapter {
    constructor(bot, onProgress) {
        super(bot, onProgress);
        this.activePlacements = new Set();
    }

    start() {
        super.start();
        this.listen('placement_start', operation => {
            const operationId = String(operation?.operationId || 'unknown');
            this.activePlacements.add(operationId);
            this.onProgress('placement_started', {
                operationId,
                target: operation?.target || null,
                item: operation?.item || null,
            });
        });
        this.listen('placement_verified', operation => {
            this.onProgress('placement_verified', {
                operationId: String(operation?.operationId || 'unknown'),
                target: operation?.target || null,
                observed: operation?.observed || null,
            });
        });
        this.listen('placement_end', operation => {
            const operationId = String(operation?.operationId || 'unknown');
            this.activePlacements.delete(operationId);
            this.onProgress('placement_ended', {
                operationId,
                target: operation?.target || null,
                outcome: operation?.outcome || null,
            });
        });
    }

    async requestHalt() {
        const pathfinder = await super.requestHalt();
        if (this.isSettled()) {
            return { acknowledged: true, evidence: 'placement_idle_pathfinder_idle' };
        }
        return new Promise(resolve => {
            const events = [
                'placement_end',
                'path_update',
                'path_reset',
                'path_stop',
                'goal_reached',
                'goal_updated',
                'diggingAborted',
                'diggingCompleted',
                'physicsTick',
            ];
            const check = () => {
                if (!this.isSettled()) return;
                for (const event of events) this.bot.removeListener(event, check);
                resolve({
                    acknowledged: true,
                    evidence: pathfinder?.acknowledged === true
                        ? 'placement_finished_pathfinder_halt_acknowledged'
                        : 'placement_finished_pathfinder_idle',
                });
            };
            for (const event of events) this.bot.on(event, check);
            check();
        });
    }

    async forceHalt() {
        await super.forceHalt();
        const acknowledged = this.isSettled();
        return {
            acknowledged,
            evidence: acknowledged ? 'placement_force_halted_idle' : 'placement_force_halt_pending',
        };
    }

    isSettled() {
        return this.activePlacements.size === 0 && super.isSettled();
    }

    waitForSettlement(timeoutMs) {
        if (this.isSettled()) return Promise.resolve({ settled: true, evidence: 'placement_idle_pathfinder_idle' });
        return new Promise(resolve => {
            let finished = false;
            const events = [
                'placement_end',
                'path_update',
                'path_reset',
                'path_stop',
                'goal_reached',
                'goal_updated',
                'diggingAborted',
                'diggingCompleted',
                'physicsTick',
            ];
            const cleanup = () => {
                for (const event of events) this.bot.removeListener(event, check);
                clearTimeout(timer);
            };
            const finish = result => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(result);
            };
            const check = () => {
                if (this.isSettled()) finish({ settled: true, evidence: 'placement_idle_pathfinder_idle' });
            };
            for (const event of events) this.bot.on(event, check);
            const timer = setTimeout(
                () => finish({ settled: false, evidence: 'placement_settlement_timeout' }),
                timeoutMs,
            );
            check();
        });
    }
}

class PvpActivityAdapter extends PathfinderActivityAdapter {
    start() {
        super.start();
        this.listen('startedAttacking', () => this.onProgress('pvp_started', {
            targetId: Number.isFinite(this.bot?.pvp?.target?.id) ? this.bot.pvp.target.id : null,
        }));
        this.listen('attackedTarget', () => this.onProgress('pvp_attack', {
            targetId: Number.isFinite(this.bot?.pvp?.target?.id) ? this.bot.pvp.target.id : null,
        }));
        this.listen('stoppedAttacking', () => this.onProgress('pvp_stopped', {}));
    }

    async requestHalt() {
        let pvpEvidence = 'pvp_already_idle';
        try {
            await this.bot.pvp.stop();
            pvpEvidence = 'pvp_stop_settled';
        } catch {
            pvpEvidence = 'pvp_stop_unconfirmed';
        }
        const pathfinder = await super.requestHalt();
        const acknowledged = this.isSettled();
        return {
            acknowledged,
            evidence: acknowledged
                ? `${pvpEvidence}:pathfinder_idle`
                : `pvp_halt_pending:${pathfinder?.evidence || pvpEvidence}`,
        };
    }

    async forceHalt() {
        try { this.bot.pvp.forceStop?.(); } catch { /* settlement check remains authoritative */ }
        await super.forceHalt();
        const acknowledged = this.isSettled();
        return {
            acknowledged,
            evidence: acknowledged ? 'pvp_force_stopped_pathfinder_idle' : 'pvp_force_halt_pending',
        };
    }

    isSettled() {
        return this.bot?.pvp?.target == null
            && this.bot?.pathfinder?.goal == null
            && super.isSettled();
    }

    waitForSettlement(timeoutMs) {
        if (this.isSettled()) return Promise.resolve({ settled: true, evidence: 'pvp_idle_pathfinder_idle' });
        return new Promise(resolve => {
            let finished = false;
            const events = [
                'stoppedAttacking',
                'path_update',
                'path_reset',
                'path_stop',
                'goal_reached',
                'goal_updated',
                'physicsTick',
            ];
            const cleanup = () => {
                for (const event of events) this.bot.removeListener(event, check);
                clearTimeout(timer);
            };
            const finish = result => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(result);
            };
            const check = () => {
                if (this.isSettled()) finish({ settled: true, evidence: 'pvp_idle_pathfinder_idle' });
            };
            for (const event of events) this.bot.on(event, check);
            const timer = setTimeout(
                () => finish({ settled: false, evidence: 'pvp_settlement_timeout' }),
                timeoutMs,
            );
            check();
        });
    }
}

class VehicleActivityAdapter {
    constructor(bot, onProgress) {
        this.bot = bot;
        this.onProgress = onProgress;
        this.listeners = [];
        this.controlActive = false;
    }

    start() {
        this.listen('vehicle_control_start', evidence => {
            this.controlActive = true;
            this.onProgress('vehicle_control_started', evidence || {});
        });
        this.listen('vehicle_control_stop', evidence => {
            this.controlActive = false;
            this.onProgress('vehicle_control_stopped', evidence || {});
        });
    }

    listen(event, listener) {
        this.bot.on(event, listener);
        this.listeners.push([event, listener]);
    }

    requestHalt() {
        try { this.bot.moveVehicle(0, 0); } catch { /* disconnected or dismounted */ }
        this.controlActive = false;
        try { this.bot.clearControlStates(); } catch { /* disconnected body */ }
        return Promise.resolve({
            acknowledged: this.isSettled(),
            evidence: 'vehicle_input_zeroed',
        });
    }

    forceHalt() {
        return this.requestHalt();
    }

    isSettled() {
        return this.controlActive === false && !activeControlState(this.bot);
    }

    waitForSettlement(timeoutMs) {
        if (this.isSettled()) return Promise.resolve({ settled: true, evidence: 'vehicle_input_idle' });
        return new Promise(resolve => {
            let finished = false;
            const events = ['vehicle_control_stop', 'dismount', 'physicsTick'];
            const cleanup = () => {
                for (const event of events) this.bot.removeListener(event, check);
                clearTimeout(timer);
            };
            const finish = result => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(result);
            };
            const check = () => {
                if (this.isSettled()) finish({ settled: true, evidence: 'vehicle_input_idle' });
            };
            for (const event of events) this.bot.on(event, check);
            const timer = setTimeout(
                () => finish({ settled: false, evidence: 'vehicle_settlement_timeout' }),
                timeoutMs,
            );
            check();
        });
    }

    dispose() {
        for (const [event, listener] of this.listeners) this.bot.removeListener(event, listener);
        this.listeners = [];
    }
}

function stopPollDelayMs(attempt) {
    const index = Math.min(Math.max(0, attempt), STOP_POLL_LADDER_MS.length - 1);
    return STOP_POLL_LADDER_MS[index];
}

const ACTION_OWNER_PRIORITY = Object.freeze({
    background: 0,
    autonomy: 10,
    job: 20,
    player: 30,
    survival: 40,
    reflex: 50,
});

// A rapid retry is not enough evidence that the bot is looping: Mineflayer can
// legitimately hand control between short actions in the same tick.  Instead,
// only arrest repeated non-player work that keeps re-claiming the same patch of
// ground over a meaningful gameplay window.
const ACTION_PATTERN_WINDOW_MS = 15_000;
const ACTION_PATTERN_MAX_REPEATS = 4;
const ACTION_PATTERN_RADIUS_SQUARED = 2.5 ** 2;
const CRITICAL_REFLEX_ACTIONS = new Set([
    'mode:self_preservation',
    'mode:self_defense',
    'mode:cowardice',
]);
const OPERATOR_HOLD_REFLEX_ACTIONS = new Set([
    'mode:self_preservation',
    'mode:self_defense',
]);
const PLAYER_PREEMPTIBLE_REFLEX_ACTIONS = new Set([
    'mode:unstuck',
    'mode:item_collecting',
    'mode:torch_placing',
    'mode:hunting',
    'mode:elbow_room',
    'mode:idle_staring',
]);
const MAX_ACTION_ERROR_CHARS = 4_096;
const MAX_REQUEST_ARGS = 8;
const MAX_REQUEST_TEXT = 160;
const REQUEST_ROUTE_ORIGINS = new Set([
    'explicit-command',
    'deterministic-nl',
    'model-selected',
    'directive-resume',
    'agenda-director',
    'goal-director',
    'mission-director',
    'job-director',
    'internal',
]);
const DURABLE_SUBMISSION_KINDS = new Set([
    'goal_submission',
    'job_submission',
    'agenda_submission',
]);

function boundedRequestText(value, maxLength = MAX_REQUEST_TEXT) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeRequestContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const requestId = boundedRequestText(value.requestId, 80);
    if (!requestId) return null;
    const routeOrigin = boundedRequestText(value.routeOrigin, 40).toLowerCase();
    const args = Object.freeze((Array.isArray(value.args) ? value.args : [])
        .slice(0, MAX_REQUEST_ARGS)
        .map(argument => {
            if (argument === null || typeof argument === 'boolean') return argument;
            if (typeof argument === 'number') return Number.isFinite(argument) ? argument : null;
            if (typeof argument === 'string') return boundedRequestText(argument);
            return null;
        }));
    return Object.freeze({
        requestId,
        routeOrigin: REQUEST_ROUTE_ORIGINS.has(routeOrigin) ? routeOrigin : 'internal',
        selectedSkill: boundedRequestText(value.selectedSkill, 80),
        args,
        requestedAt: Number.isFinite(Number(value.requestedAt))
            ? Math.max(0, Math.floor(Number(value.requestedAt)))
            : null,
        agendaDisposition: value.agendaDisposition === 'interrupt' ? 'interrupt' : 'append',
        missionId: boundedRequestText(value.missionId, 96) || null,
        activityId: boundedRequestText(value.activityId, 128) || null,
        materialToken: boundedRequestText(value.materialToken, 240) || null,
    });
}

function actionPosition(agent) {
    const position = agent?.bot?.entity?.position;
    if (![position?.x, position?.y, position?.z].every(Number.isFinite)) return null;
    return { x: position.x, y: position.y, z: position.z };
}

function isSameActionArea(first, second) {
    if (!first || !second) return true;
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    const dz = first.z - second.z;
    return dx * dx + dy * dy + dz * dz <= ACTION_PATTERN_RADIUS_SQUARED;
}

function actionProgressTarget(result) {
    const progress = result?.evidence?.skill?.progress;
    if (
        progress?.verified === true
        && typeof progress.kind === 'string'
        && progress.kind.trim()
        && [progress?.position?.x, progress?.position?.y, progress?.position?.z].every(Number.isFinite)
    ) {
        return JSON.stringify([
            'verified_progress',
            progress.kind.trim().slice(0, 80),
            Math.floor(progress.position.x),
            Math.floor(progress.position.y),
            Math.floor(progress.position.z),
        ]);
    }
    const target = result?.target;
    if (
        !(
            result?.phase === 'succeeded'
            || (result?.phase === 'failed' && result?.retryable === true)
        )
        || !target
        || ![target.x, target.y, target.z].every(Number.isFinite)
    ) return null;
    return JSON.stringify([
        result.phase === 'failed' ? 'failed_target' : 'verified_target',
        String(target.name || target.type || ''),
        target.x,
        target.y,
        target.z,
    ]);
}

function normalizeActionOwner(owner) {
    const normalized = String(owner || '').trim().toLowerCase();
    // Omitted ownership retains the historical direct-command default. An
    // explicitly supplied but unknown owner is not equivalent to player
    // authority; fail it closed to the lowest non-player lane.
    if (!normalized) return 'player';
    return Object.hasOwn(ACTION_OWNER_PRIORITY, normalized) ? normalized : 'background';
}

function normalizeReceiptMode(mode) {
    return mode === 'composed' ? 'composed' : 'legacy';
}

function actionAttemptSignature(actionLabel, requestContext = null) {
    return JSON.stringify([
        String(requestContext?.missionId || ''),
        String(requestContext?.activityId || ''),
        String(requestContext?.materialToken || ''),
        String(actionLabel || ''),
        String(requestContext?.selectedSkill || ''),
        Array.isArray(requestContext?.args) ? requestContext.args : [],
    ]);
}

export class ActionManager {
    constructor(agent, {
        now = Date.now,
        stopWaitTimeoutMs = STOP_WAIT_TIMEOUT_MS,
        gracefulHaltTimeoutMs = GRACEFUL_HALT_TIMEOUT_MS,
        settlementTimeoutMs = SETTLEMENT_TIMEOUT_MS,
    } = {}) {
        this.agent = agent;
        this.now = now;
        this.stopWaitTimeoutMs = Math.max(1, Math.min(STOP_WAIT_TIMEOUT_MS, Number(stopWaitTimeoutMs) || STOP_WAIT_TIMEOUT_MS));
        this.gracefulHaltTimeoutMs = Math.max(1, Number(gracefulHaltTimeoutMs) || GRACEFUL_HALT_TIMEOUT_MS);
        this.settlementTimeoutMs = Math.max(1, Number(settlementTimeoutMs) || SETTLEMENT_TIMEOUT_MS);
        this.activityWorldRevision = 0;
        this.currentActivity = null;
        this.lastActivity = null;
        this.currentActivityAdapter = null;
        this.activityHaltPromise = null;
        this.activityForceHaltPromise = null;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionOwner = '';
        this.currentActionId = '';
        this.currentActionFn = null;
        this.currentActionController = null;
        this.currentReceiptLedger = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.resume_owner = '';
        this.resume_receipt_mode = 'legacy';
        this.resume_activity_options = null;
        this.deferredPlayerAction = null;
        this.last_action_time = 0;
        this.currentActionStartedAt = 0;
        this.recentActionAttempts = [];
        this.lastProgressTargetByAction = new Map();
        this.lastResult = null;
        this.nextActionId = 0;
        this.stopRequestedAt = null;
        this.stopTimedOutAt = null;
        this.ownerContext = new AsyncLocalStorage();
        this.requestContext = new AsyncLocalStorage();
        this.commandExecutionContext = new AsyncLocalStorage();
        this.actionCircuits = new Map();
    }

    activitySnapshot() {
        const activity = this.currentActivity || this.lastActivity;
        if (!activity) return null;
        return Object.freeze({
            ...activity,
            progress: activity.progress ? { ...activity.progress } : null,
            settlement: activity.settlement ? { ...activity.settlement } : null,
            terminalResult: activity.terminalResult ? { ...activity.terminalResult } : null,
        });
    }

    beginActivity({ actionId, actionLabel, missionId, activityId, specialist, effectiveMovements }) {
        const selectedSpecialist = inferActivitySpecialist(actionLabel, specialist);
        const pathfinder = this.agent.bot?.pathfinder;
        const pathfinderAvailable = typeof pathfinder?.setGoal === 'function'
            && typeof pathfinder?.isMoving === 'function'
            && typeof pathfinder?.isMining === 'function'
            && typeof pathfinder?.isBuilding === 'function';
        if (selectedSpecialist && selectedSpecialist !== 'vehicle' && !pathfinderAvailable) return null;
        if (
            selectedSpecialist === 'collectblock'
            && typeof this.agent.bot?.collectBlock?.cancelTask !== 'function'
        ) return null;
        if (
            selectedSpecialist === 'pvp'
            && (
                typeof this.agent.bot?.pvp?.stop !== 'function'
                || typeof this.agent.bot?.pvp?.forceStop !== 'function'
            )
        ) return null;
        if (selectedSpecialist === 'vehicle' && typeof this.agent.bot?.moveVehicle !== 'function') return null;
        const record = {
            missionId: missionId || null,
            activityId: activityId || actionId,
            specialist: selectedSpecialist,
            lifecycle: 'RUNNING',
            startedAt: this.now(),
            lastProgressAt: null,
            cancelRequestedAt: null,
            cancelAcknowledgedAt: null,
            forceHaltAt: null,
            settledAt: null,
            worldRevisionAtStart: ++this.activityWorldRevision,
            worldRevisionAtEnd: null,
            bodyLeaseOwner: actionId,
            effectiveMovements: effectiveMovements || null,
            progress: null,
            settlement: null,
            terminalResult: null,
        };
        this.currentActivity = record;
        this.currentActivityAdapter = selectedSpecialist === 'pathfinder'
            ? new PathfinderActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            })
            : selectedSpecialist === 'collectblock'
            ? new CollectBlockActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            })
            : selectedSpecialist === 'container'
            ? new ContainerActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            })
            : selectedSpecialist === 'craft' || selectedSpecialist === 'furnace'
            ? new WindowTransactionActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            }, selectedSpecialist)
            : selectedSpecialist === 'placement'
            ? new PlacementActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            })
            : selectedSpecialist === 'pvp'
            ? new PvpActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            })
            : selectedSpecialist === 'vehicle'
            ? new VehicleActivityAdapter(this.agent.bot, (kind, evidence) => {
                this.observeActivityProgress(kind, evidence);
            })
            : null;
        this.activityHaltPromise = null;
        this.activityForceHaltPromise = null;
        this.currentActivityAdapter?.start?.();
        return this.activitySnapshot();
    }

    observeActivityProgress(kind, evidence = {}) {
        if (!this.currentActivity || this.currentActivity.lifecycle === 'ABORTED_UNSETTLED') return null;
        this.currentActivity.lastProgressAt = this.now();
        this.currentActivity.progress = {
            kind: String(kind || 'progress'),
            evidence: { ...evidence },
            worldRevision: ++this.activityWorldRevision,
        };
        return this.currentActivity.progress;
    }

    acknowledgeCancellation(evidence = null) {
        if (!this.currentActivity || this.currentActivity.cancelAcknowledgedAt !== null) return false;
        this.currentActivity.cancelAcknowledgedAt = this.now();
        if (evidence) this.currentActivity.cancelAcknowledgement = String(evidence).slice(0, 160);
        ++this.activityWorldRevision;
        return true;
    }

    requestHalt(reason = 'stop_requested') {
        if (!this.currentActivity || !this.currentActivityAdapter) {
            return Promise.resolve({ acknowledged: false, evidence: 'no_specialist_activity' });
        }
        if (this.activityHaltPromise) return this.activityHaltPromise;
        this.currentActivity.lifecycle = 'CANCELING';
        this.currentActivity.cancelRequestedAt = this.currentActivity.cancelRequestedAt || this.now();
        this.currentActivity.cancelReason = String(reason).slice(0, 160);
        ++this.activityWorldRevision;
        this.activityHaltPromise = Promise.resolve(this.currentActivityAdapter.requestHalt(reason))
            .then(result => {
                if (result?.acknowledged === true) this.acknowledgeCancellation(result.evidence);
                return result;
            })
            .catch(error => ({
                acknowledged: false,
                evidence: `halt_error:${String(error?.message || error).slice(0, 120)}`,
            }));
        return this.activityHaltPromise;
    }

    forceHalt(reason = 'graceful_halt_expired') {
        if (!this.currentActivity || !this.currentActivityAdapter) {
            return Promise.resolve({ acknowledged: false, evidence: 'no_specialist_activity' });
        }
        if (this.activityForceHaltPromise) return this.activityForceHaltPromise;
        this.currentActivity.forceHaltAt = this.currentActivity.forceHaltAt || this.now();
        this.currentActivity.forceHaltReason = String(reason).slice(0, 160);
        ++this.activityWorldRevision;
        this.activityForceHaltPromise = Promise.resolve(this.currentActivityAdapter.forceHalt(reason))
            .then(result => {
                if (result?.acknowledged === true) this.acknowledgeCancellation(result.evidence);
                return result;
            })
            .catch(error => ({
                acknowledged: false,
                evidence: `force_halt_error:${String(error?.message || error).slice(0, 120)}`,
            }));
        return this.activityForceHaltPromise;
    }

    recordTerminalResult(result) {
        if (!this.currentActivity) return null;
        this.currentActivity.terminalResult = { ...result };
        ++this.activityWorldRevision;
        return this.currentActivity.terminalResult;
    }

    markActivityUnsettled(reason, settlement = null) {
        if (!this.currentActivity) return null;
        this.currentActivity.lifecycle = 'ABORTED_UNSETTLED';
        this.currentActivity.settlement = settlement ? { ...settlement } : { settled: false, evidence: reason };
        this.currentActivity.worldRevisionAtEnd = ++this.activityWorldRevision;
        this.recordTerminalResult({
            lifecycle: 'ABORTED_UNSETTLED',
            reasonClass: 'SETTLEMENT',
            reasonCode: String(reason || 'settlement_unproven'),
            retryable: false,
        });
        return this.activitySnapshot();
    }

    async proveSettlement(terminalLifecycle) {
        if (!this.currentActivity) {
            return { settled: true, evidence: 'legacy_promise_only' };
        }
        if (!this.currentActivityAdapter) {
            this.currentActivity.lifecycle = terminalLifecycle;
            this.currentActivity.settledAt = this.now();
            this.currentActivity.settlement = { settled: true, evidence: 'command_promise_settled' };
            this.currentActivity.worldRevisionAtEnd = ++this.activityWorldRevision;
            return this.currentActivity.settlement;
        }
        if (this.currentActivity.lifecycle === 'ABORTED_UNSETTLED') {
            return { settled: false, evidence: 'activity_already_unsettled' };
        }
        this.currentActivity.lifecycle = 'SETTLING';
        ++this.activityWorldRevision;
        const settlement = await this.currentActivityAdapter.waitForSettlement(this.settlementTimeoutMs);
        if (
            settlement?.settled === true
            && this.currentActivity.cancelRequestedAt !== null
            && this.currentActivity.cancelAcknowledgedAt === null
        ) {
            // Cancellation and normal completion can cross in the same event
            // turn. A specialist that has closed its transaction/window,
            // cleared the cursor, and stopped pathfinding has physically
            // yielded; waiting for the parallel halt promise to repeat that
            // fact creates a false ABORTED_UNSETTLED lease. Join the cancel to
            // the stronger settlement proof before evaluating release.
            this.acknowledgeCancellation(`settled:${settlement.evidence || 'specialist_idle'}`);
        }
        if (
            settlement?.settled !== true
            || (this.currentActivity.cancelRequestedAt !== null && this.currentActivity.cancelAcknowledgedAt === null)
        ) {
            return {
                ...settlement,
                settled: false,
                activity: this.markActivityUnsettled(
                    settlement?.evidence || 'halt_not_acknowledged',
                    settlement,
                ),
            };
        }
        this.currentActivity.lifecycle = terminalLifecycle;
        this.currentActivity.settledAt = this.now();
        this.currentActivity.settlement = { ...settlement };
        this.currentActivity.worldRevisionAtEnd = ++this.activityWorldRevision;
        return settlement;
    }

    releaseBodyLease(actionId, actionOwner) {
        const activity = this.currentActivity;
        this.agent.behavior_arbiter?.recordActionRelease?.({
            actionId,
            owner: actionOwner,
            ownerPriority: this.ownerPriority(actionOwner),
            activityId: activity?.activityId || null,
            specialist: activity?.specialist || null,
            worldRevision: activity?.worldRevisionAtEnd || null,
            releasedAt: this.now(),
        });
        try { this.currentActivityAdapter?.dispose(); } catch { /* settled listener cleanup */ }
        if (activity) this.lastActivity = { ...activity };
        this.currentActivity = null;
        this.currentActivityAdapter = null;
        this.activityHaltPromise = null;
        this.activityForceHaltPromise = null;
        this.executing = false;
        this.currentActionId = '';
        this.currentActionLabel = '';
        this.currentActionOwner = '';
        this.currentActionFn = null;
        this.currentActionController = null;
        this.currentReceiptLedger = null;
        this.currentActionStartedAt = 0;
        this.stopRequestedAt = null;
        this.stopTimedOutAt = null;
    }

    runWithOwner(owner, operation) {
        if (typeof operation !== 'function') throw new TypeError('Action owner operation must be a function.');
        return this.ownerContext.run(normalizeActionOwner(owner), operation);
    }

    runWithRequestContext(context, operation) {
        if (typeof operation !== 'function') throw new TypeError('Action request operation must be a function.');
        return this.requestContext.run(normalizeRequestContext(context), operation);
    }

    currentRequestContext() {
        return this.requestContext.getStore() || null;
    }

    async runWithCommandExecution(operation, requestContext = null) {
        if (typeof operation !== 'function') throw new TypeError('Command execution operation must be a function.');
        const envelope = {
            result: null,
            requestContext: normalizeRequestContext(requestContext),
            durableSubmission: null,
        };
        const value = await this.commandExecutionContext.run(envelope, operation);
        return Object.freeze({
            value,
            result: envelope.result,
            requestContext: envelope.requestContext,
            durableSubmission: envelope.durableSubmission,
        });
    }

    recordCommandExecutionResult(result) {
        const envelope = this.commandExecutionContext.getStore();
        if (!envelope || !result || typeof result !== 'object') return false;
        envelope.result = result;
        return true;
    }

    recordDurableSubmissionReceipt(receipt) {
        const envelope = this.commandExecutionContext.getStore();
        const requestContext = envelope?.requestContext;
        if (!envelope || !requestContext || !receipt || typeof receipt !== 'object') return false;
        if (
            envelope.durableSubmission !== null
            || !requestContext.requestId
            || !DURABLE_SUBMISSION_KINDS.has(receipt.submissionKind)
            || receipt.requestId !== requestContext.requestId
            || receipt.selectedSkill !== requestContext.selectedSkill
            || receipt.routeOrigin !== requestContext.routeOrigin
            || (receipt.missionId || null) !== requestContext.missionId
            || (receipt.activityId || null) !== requestContext.activityId
        ) return false;
        envelope.durableSubmission = Object.freeze({ ...receipt });
        return true;
    }

    ownerPriority(owner) {
        return ACTION_OWNER_PRIORITY[normalizeActionOwner(owner)];
    }

    currentSurvivalActionIsCritical() {
        const bot = this.agent?.bot;
        const health = Number(bot?.health);
        const hunger = Number(bot?.food);
        const criticalFood = Number(this.agent?.runtime?.survival?.criticalFood ?? 6);
        return Boolean(
            (Number.isFinite(health) && health <= 8)
            || (Number.isFinite(hunger) && hunger <= criticalFood)
        );
    }

    isCriticalReflexAction(owner = this.currentActionOwner, label = this.currentActionLabel) {
        return normalizeActionOwner(owner) === 'reflex'
            && CRITICAL_REFLEX_ACTIONS.has(String(label || ''));
    }

    recordActionAttempt(actionLabel, actionOwner, requestContext = null) {
        const now = Date.now();
        this.recentActionAttempts = this.recentActionAttempts.filter(attempt => (
            now - attempt.startedAt <= ACTION_PATTERN_WINDOW_MS
        ));

        // A fresh player command is authoritative and starts a new local
        // intent. It must never be rejected because the bot was previously
        // struggling with an automatic task at the same location.
        if (actionOwner === 'player') {
            this.recentActionAttempts = [];
            this.actionCircuits.clear();
            return null;
        }
        if (this.isCriticalReflexAction(actionOwner, actionLabel)) return null;

        const position = actionPosition(this.agent);
        const signature = actionAttemptSignature(actionLabel, requestContext);
        const circuitKey = JSON.stringify([actionOwner, signature]);
        const openCircuit = this.actionCircuits.get(circuitKey);
        if (openCircuit) {
            if (isSameActionArea(openCircuit.position, position)) {
                return { ...openCircuit, circuitKey };
            }
            // The guard arrests a repeated action on one unchanged patch of
            // ground. Once another owner has physically displaced the body,
            // that old circuit is no longer evidence about the new region.
            this.actionCircuits.delete(circuitKey);
        }
        const repeats = this.recentActionAttempts.filter(attempt => (
            attempt.owner === actionOwner
            && attempt.signature === signature
            && isSameActionArea(attempt.position, position)
        ));
        if (repeats.length >= ACTION_PATTERN_MAX_REPEATS) {
            const circuit = { repeats: repeats.length + 1, position, openedAt: now };
            this.actionCircuits.set(circuitKey, circuit);
            return { ...circuit, circuitKey };
        }

        this.recentActionAttempts.push({
            label: actionLabel,
            signature,
            owner: actionOwner,
            position,
            startedAt: now,
        });
        return null;
    }

    recordActionProgress(actionLabel, actionOwner, result, requestContext = null) {
        const target = actionProgressTarget(result);
        if (!target) return false;
        const signature = actionAttemptSignature(actionLabel, requestContext);
        const key = JSON.stringify([actionOwner, signature]);
        const previousTarget = this.lastProgressTargetByAction.get(key);
        this.lastProgressTargetByAction.set(key, target);
        if (previousTarget === target) return false;

        // A deterministic skill changed either a verified progress marker or
        // the concrete target that failed retryably. The latter remains a
        // failure and is charged to the Director's target-recovery budget; it
        // only proves that the next automatic action is not the same local
        // failure signature. Unchanged targets still reach this safety ceiling.
        this.recentActionAttempts = this.recentActionAttempts.filter(attempt => (
            attempt.owner !== actionOwner
        ));
        this.actionCircuits.delete(key);
        return true;
    }

    discardInterruptedActionAttempt(actionLabel, actionOwner, requestContext = null) {
        const signature = actionAttemptSignature(actionLabel, requestContext);
        for (let index = this.recentActionAttempts.length - 1; index >= 0; index -= 1) {
            const attempt = this.recentActionAttempts[index];
            if (attempt.owner !== actionOwner || attempt.signature !== signature) continue;
            this.recentActionAttempts.splice(index, 1);
            return true;
        }
        return false;
    }

    settleActionAttempt(actionLabel, actionOwner, result, requestContext = null) {
        // A higher-priority lane stopped this action before it could establish
        // progress or failure. WorkOrder owns a separate bounded preemption
        // ceiling; counting the same event here falsely turns safe resumption
        // into an automatic-action loop.
        if (result?.phase === 'interrupted' || result?.code === 'interrupted') {
            return this.discardInterruptedActionAttempt(actionLabel, actionOwner, requestContext);
        }
        return this.recordActionProgress(actionLabel, actionOwner, result, requestContext);
    }

    isOwnerBlocked(owner) {
        const requestedOwner = normalizeActionOwner(owner);
        const activeOwner = normalizeActionOwner(this.currentActionOwner);
        if (
            this.executing
            && requestedOwner === 'player'
            && activeOwner === 'survival'
            && !this.currentSurvivalActionIsCritical()
        ) return false;
        // Recovery and ambient reflexes should never hold the steering wheel
        // against a new dashboard/player command. True safety reflexes retain
        // their higher priority.
        if (
            this.executing
            && requestedOwner === 'player'
            && activeOwner === 'reflex'
            && PLAYER_PREEMPTIBLE_REFLEX_ACTIONS.has(this.currentActionLabel)
        ) return false;
        return Boolean(
            this.executing
            && this.ownerPriority(requestedOwner) < this.ownerPriority(activeOwner),
        );
    }

    // Positional parameters must match `_executeResume`. The zero-argument form
    // resumes whatever resume function is already registered.
    async resumeAction(actionLabel = null, actionFn = null, timeout = 10, owner = null, receiptMode = 'legacy', activityOptions = null) {
        return this._executeResume(actionLabel, actionFn, timeout, owner, receiptMode, activityOptions);
    }

    async runAction(actionLabel, actionFn, {
        timeout,
        resume = false,
        owner,
        receiptMode = 'legacy',
        missionId = null,
        activityId = null,
        specialist = null,
        effectiveMovements = null,
    } = {}) {
        const actionOwner = normalizeActionOwner(owner || this.ownerContext.getStore());
        const actionReceiptMode = normalizeReceiptMode(receiptMode);
        const activityOptions = { missionId, activityId, specialist, effectiveMovements };
        if (
            resume !== true
            && actionOwner === 'player'
            && this.isCriticalReflexAction()
            && this.isOwnerBlocked(actionOwner)
        ) {
            return this.deferPlayerAction(actionLabel, actionFn, timeout, actionOwner, actionReceiptMode, activityOptions);
        }
        if (resume) {
            return this._executeResume(actionLabel, actionFn, timeout, actionOwner, actionReceiptMode, activityOptions);
        } else {
            return this._executeAction(actionLabel, actionFn, timeout, actionOwner, actionReceiptMode, activityOptions);
        }
    }

    async stop({ timeoutMs = STOP_WAIT_TIMEOUT_MS, continueWhile = () => true } = {}) {
        if (!this.executing) {
            this.stopRequestedAt = null;
            this.stopTimedOutAt = null;
            return { stopped: true, timedOut: false };
        }
        if (this.stopTimedOutAt) {
            this.currentReceiptLedger?.seal?.({
                reason: 'cancelled',
                mirrorEvidence: this.agent.bot.lastActionEvidence,
            });
            try { this.currentActionController?.abort(); } catch { /* already aborted */ }
            void this.requestHalt('stop_reissued');
            void this.forceHalt('stop_reissued_after_timeout');
            try { this.agent.requestInterrupt(); } catch { /* bot cleanup is best effort */ }
            return { stopped: false, timedOut: true, requestedAt: this.stopRequestedAt };
        }

        const requestedAt = this.now();
        const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? Math.min(timeoutMs, this.stopWaitTimeoutMs)
            : this.stopWaitTimeoutMs;
        const deadline = requestedAt + boundedTimeoutMs;
        this.stopRequestedAt = requestedAt;
        void this.requestHalt('stop_requested');
        let attempt = 0;
        let lastInterruptAt = 0;
        while (this.executing && this.now() < deadline) {
            if (!continueWhile()) {
                return { stopped: false, timedOut: false, superseded: true, requestedAt };
            }
            const now = this.now();
            if (now - requestedAt >= this.gracefulHaltTimeoutMs) {
                void this.forceHalt('graceful_halt_expired');
            }
            if (attempt === 0 || now - lastInterruptAt >= INTERRUPT_REISSUE_MS) {
                lastInterruptAt = now;
                try { this.currentActionController?.abort(); } catch { /* already aborted */ }
                try { this.agent.requestInterrupt(); } catch { /* bot cleanup is best effort */ }
            }
            const remaining = deadline - this.now();
            if (remaining <= 0) break;
            await new Promise(resolve => setTimeout(resolve, Math.min(stopPollDelayMs(attempt), remaining)));
            attempt += 1;
        }

        if (!continueWhile()) {
            return { stopped: !this.executing, timedOut: false, superseded: true, requestedAt };
        }

        if (this.executing) {
            this.currentReceiptLedger?.seal?.({
                reason: 'cancelled',
                mirrorEvidence: this.agent.bot.lastActionEvidence,
            });
            this.stopTimedOutAt = this.now();
            if (this.currentActivity && this.currentActivity.lifecycle !== 'ABORTED_UNSETTLED') {
                this.markActivityUnsettled('stop_timeout', {
                    settled: false,
                    evidence: 'action_promise_or_specialist_not_settled',
                });
            }
            console.warn(`Action "${this.currentActionLabel || 'unknown'}" did not stop within ${boundedTimeoutMs}ms; leaving the bot held.`);
            return { stopped: false, timedOut: true, requestedAt };
        }

        this.stopRequestedAt = null;
        this.stopTimedOutAt = null;
        return { stopped: true, timedOut: false, requestedAt };
    } 

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
        this.resume_owner = '';
        this.resume_receipt_mode = 'legacy';
        this.resume_activity_options = null;
        this.deferredPlayerAction = null;
    }

    deferPlayerAction(actionLabel, actionFn, timeout = -1, owner = 'player', receiptMode = 'legacy', activityOptions = null) {
        this.deferredPlayerAction = Object.freeze({
            actionLabel,
            actionFn,
            timeout,
            owner: normalizeActionOwner(owner),
            receiptMode: normalizeReceiptMode(receiptMode),
            activityOptions,
            requestContext: this.currentRequestContext(),
        });
        this.agent.behavior_arbiter?.wake?.('deferred_player_action_registered');
        return {
            success: true,
            message: null,
            interrupted: false,
            timedout: false,
            deferred: true,
        };
    }

    hasDeferredPlayerAction() {
        return this.deferredPlayerAction !== null;
    }

    async resumeDeferredPlayerAction() {
        if (!this.deferredPlayerAction || this.executing) {
            return {
                success: false,
                message: null,
                interrupted: false,
                timedout: false,
                deferred: this.deferredPlayerAction !== null,
            };
        }
        const pending = this.deferredPlayerAction;
        this.deferredPlayerAction = null;
        const execute = () => this._executeAction(
            pending.actionLabel,
            pending.actionFn,
            pending.timeout,
            pending.owner,
            pending.receiptMode,
            pending.activityOptions,
        );
        return pending.requestContext
            ? this.runWithRequestContext(pending.requestContext, execute)
            : execute();
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10, owner = null, receiptMode = 'legacy', activityOptions = null) {
        const new_resume = actionFn != null;
        if (new_resume) { // start new resume
            this.resume_func = actionFn;
            assert(actionLabel != null, 'actionLabel is required for new resume');
            this.resume_name = actionLabel;
            this.resume_owner = normalizeActionOwner(owner || this.ownerContext.getStore());
            this.resume_receipt_mode = normalizeReceiptMode(receiptMode);
            this.resume_activity_options = activityOptions;
        }
        // A critical reflex owns the body until it settles, but an explicit
        // resumable player action is still valid work. Register it without
        // entering _executeAction: doing so would report a false rejection and
        // used to overwrite the reflex label before the ownership guard ran.
        if (new_resume && this.isOwnerBlocked(this.resume_owner)) {
            this.agent.behavior_arbiter?.wake?.('resumable_action_registered');
            return {
                success: true,
                message: null,
                interrupted: false,
                timedout: false,
                deferred: true,
            };
        }
        if (this.resume_func != null && (this.agent.isIdle() || new_resume) && (!this.agent.self_prompter.isActive() || new_resume)) {
            let res = await this._executeAction(
                this.resume_name,
                this.resume_func,
                timeout,
                this.resume_owner || 'player',
                this.resume_receipt_mode,
                this.resume_activity_options,
            );
            if (!res.success && res.result?.retryable === false) {
                this.cancelResume();
            }
            return res;
        } else {
            return { success: false, message: null, interrupted: false, timedout: false };
        }
    }

    async _executeAction(actionLabel, actionFn, timeout = 10, owner = 'player', receiptMode = 'legacy', activityOptions = null) {
        let TIMEOUT;
        let receiptLedger = null;
        let sealedSkillEvidence = null;
        const startedAt = Date.now();
        const actionId = `${this.agent.name || 'bot'}-${++this.nextActionId}-${startedAt}`;
        const actionOwner = normalizeActionOwner(owner);
        const actionReceiptMode = normalizeReceiptMode(receiptMode);
        const commandRequest = this.requestContext.getStore();
        try {
            if (
                this.agent.isOperatorHeld?.()
                && !(actionOwner === 'reflex' && OPERATOR_HOLD_REFLEX_ACTIONS.has(actionLabel))
            ) {
                const result = createActionResult({
                    actionId,
                    label: actionLabel,
                    phase: 'blocked',
                    code: 'operator_hold',
                    detail: 'The bot is held by an operator stop and needs an explicit new command or goal.',
                    retryable: false,
                    startedAt,
                });
                this.lastResult = result;
                this.agent.recordActionResult?.(result);
                return { success: false, message: result.detail, interrupted: false, timedout: false, result };
            }
            if (this.isOwnerBlocked(actionOwner)) {
                const result = createActionResult({
                    actionId,
                    label: actionLabel,
                    phase: 'blocked',
                    code: 'higher_priority_action_active',
                    detail: `The ${this.currentActionOwner || 'current'} action '${this.currentActionLabel || 'unknown'}' retains control.`,
                    evidence: {
                        requestedOwner: actionOwner,
                        activeOwner: this.currentActionOwner || null,
                        activeAction: this.currentActionLabel || null,
                    },
                    retryable: true,
                    startedAt,
                });
                this.lastResult = result;
                this.agent.recordActionResult?.(result);
                return { success: false, message: result.detail, interrupted: false, timedout: false, result };
            }
            if (this.executing) {
                console.log(
                    `${actionOwner} action "${actionLabel}" trying to interrupt `
                    + `${this.currentActionOwner || 'unknown'} action "${this.currentActionLabel}"`,
                );
            }
            const stopOutcome = await this.stop();
            if (!stopOutcome.stopped) {
                const result = createActionResult({
                    actionId,
                    label: actionLabel,
                    phase: 'blocked',
                    code: 'previous_action_unresponsive',
                    detail: `The current action '${this.currentActionLabel || 'unknown'}' did not yield to Stop. The bot remains held; explicitly restart it only if it does not recover.`,
                    evidence: {
                        activeAction: this.currentActionLabel || null,
                        stopRequestedAt: stopOutcome.requestedAt || this.stopRequestedAt || null,
                        stopTimedOutAt: this.stopTimedOutAt || null,
                    },
                    retryable: false,
                    startedAt,
                });
                this.lastResult = result;
                this.agent.recordActionResult?.(result);
                return { success: false, message: result.detail, interrupted: false, timedout: true, result };
            }

            const repeatedPattern = this.recordActionAttempt(actionLabel, actionOwner, commandRequest);
            if (repeatedPattern) {
                console.warn(`Repeated action pattern detected for '${actionLabel}' (${repeatedPattern.repeats} starts within ${ACTION_PATTERN_WINDOW_MS}ms).`);
                const result = createActionResult({
                    actionId,
                    label: actionLabel,
                    phase: 'blocked',
                    code: 'action_pattern_detected',
                    detail: 'This owner repeated the same automatic action without a material state change. Its checkpoint is preserved until the owning Director changes the target, phase, or recovery state.',
                    evidence: {
                        repeats: repeatedPattern.repeats,
                        windowMs: ACTION_PATTERN_WINDOW_MS,
                        position: repeatedPattern.position,
                        selectedSkill: commandRequest?.selectedSkill || null,
                        args: commandRequest?.args || [],
                        missionId: commandRequest?.missionId || null,
                        activityId: commandRequest?.activityId || null,
                        materialToken: commandRequest?.materialToken || null,
                        circuitOpenedAt: repeatedPattern.openedAt || null,
                    },
                    retryable: true,
                    continuation: { kind: 'retry_after_material_change' },
                    startedAt,
                });
                this.lastResult = result;
                this.agent.recordActionResult?.(result);
                return { success: false, message: result.detail, interrupted: false, timedout: false, result };
            }
            this.last_action_time = Date.now();
            console.log('executing code...\n');

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();
            this.agent.bot.lastActionEvidence = null;

            this.executing = true;
            this.currentActionId = actionId;
            this.currentActionLabel = actionLabel;
            this.currentActionOwner = actionOwner;
            this.currentActionFn = actionFn;
            this.currentActionController = new AbortController();
            this.currentActionStartedAt = this.last_action_time;
            receiptLedger = createActionReceiptLedger(actionId, { mode: actionReceiptMode });
            this.currentReceiptLedger = receiptLedger;
            const activity = this.beginActivity({
                actionId,
                actionLabel,
                missionId: activityOptions?.missionId || commandRequest?.missionId || commandRequest?.requestId || null,
                activityId: activityOptions?.activityId || commandRequest?.activityId || null,
                specialist: activityOptions?.specialist || null,
                effectiveMovements: activityOptions?.effectiveMovements || null,
            });
            this.agent.behavior_arbiter?.recordActionStart?.({
                actionId,
                activityId: activity?.activityId || null,
                missionId: activity?.missionId || null,
                specialist: activity?.specialist || null,
                bodyLeaseOwner: activity?.bodyLeaseOwner || actionId,
                worldRevision: activity?.worldRevisionAtStart || null,
                owner: actionOwner,
                ownerPriority: this.ownerPriority(actionOwner),
                label: actionLabel,
                acquiredAt: this.currentActionStartedAt,
                startedAt,
                ...(commandRequest || {}),
            });
            this.timedout = false;

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(
                    timeout,
                    actionId,
                    this.currentActionController,
                    receiptLedger,
                );
            }

            // Start the action. A large portion of the skill library uses an
            // explicit `false` result for a verified inability to act (missing
            // tool, unreachable target, interrupted path, and so on). Preserve
            // that signal instead of converting every resolved Promise into a
            // false success.
            const actionValue = await ACTION_EXECUTION_CONTEXT.run({
                actionId,
                signal: this.currentActionController.signal,
                receiptMode: actionReceiptMode,
                receiptLedger,
                deadlineAt: timeout > 0
                    ? this.currentActionStartedAt + (timeout * 60 * 1000)
                    : null,
            }, actionFn);

            const sealedReceipt = receiptLedger.seal({
                reason: this.timedout ? 'timeout' : this.agent.bot.interrupt_code ? 'cancelled' : 'resolved',
                mirrorEvidence: this.agent.bot.lastActionEvidence,
            });
            sealedSkillEvidence = sealedReceipt.receipt || sealedSkillEvidence;

            clearTimeout(TIMEOUT);

            // get bot activity summary
            let output = this.getBotOutputSummary();
            let timedout = this.timedout;
            // The timeout path uses the same physical interrupt as an external
            // preemption, but it remains a productive action failure. Keeping
            // these distinct lets GoalDirector charge the acquisition once and
            // preserve its concrete target for replanning.
            let interrupted = this.agent.bot.interrupt_code && !timedout;

            // return action status report
            const skillEvidence = actionReceiptMode === 'composed'
                ? sealedSkillEvidence
                : createLegacyActionReceiptEnvelope(actionId, this.agent.bot.lastActionEvidence);
            const receiptContractFailure = actionReceiptMode === 'composed'
                && skillEvidence?.contract?.valid !== true;
            const skillFailed = actionValue === false || receiptContractFailure;
            const skillRequested = !skillFailed && skillEvidence?.completion === 'requested';
            const skillFailureCode = typeof skillEvidence?.outcome === 'string' && skillEvidence.outcome.trim()
                ? `skill_${skillEvidence.outcome.trim()}`
                : 'skill_failed';
            const skillSuccessCode = typeof skillEvidence?.outcome === 'string' && skillEvidence.outcome.trim()
                ? `skill_${skillEvidence.outcome.trim()}`
                : 'completed';
            const receiptFailureCode = receiptContractFailure
                ? String(skillEvidence?.contract?.code || skillEvidence?.outcome || 'action_receipt_contract_violation')
                    .trim()
                    .slice(0, 80)
                : null;
            const skillRetryable = receiptContractFailure
                ? false
                : skillFailed && typeof skillEvidence?.retryable === 'boolean'
                    ? skillEvidence.retryable
                    : skillFailed && actionReceiptMode === 'legacy';
            const requestedRetryable = skillRequested && skillEvidence?.retryable === true;
            const phase = interrupted
                ? 'interrupted'
                : timedout || skillFailed ? 'failed' : skillRequested ? 'requested' : 'succeeded';
            const code = receiptContractFailure
                ? receiptFailureCode
                : interrupted ? 'interrupted' : timedout ? 'timeout' : skillFailed ? skillFailureCode : skillSuccessCode;
            const lifecycle = phase === 'succeeded'
                ? 'SUCCEEDED'
                : phase === 'interrupted' ? 'CANCELLED' : 'FAILED';
            this.recordTerminalResult({
                lifecycle,
                reasonClass: interrupted ? 'CANCEL' : timedout ? 'BUDGET' : 'ENGINE',
                reasonCode: code,
                retryable: receiptContractFailure
                    ? false
                    : interrupted || timedout || skillRetryable || requestedRetryable,
            });
            const settlement = await this.proveSettlement(lifecycle);
            if (settlement.settled !== true) {
                this.stopTimedOutAt = this.now();
                const result = createActionResult({
                    actionId,
                    label: actionLabel,
                    phase: 'failed',
                    code: 'activity_unsettled',
                    detail: 'The specialist did not prove physical settlement. The body lease remains held until a controlled restart.',
                    evidence: {
                        output: output || null,
                        skill: skillEvidence,
                        request: commandRequest || null,
                        activity: this.activitySnapshot(),
                    },
                    retryable: false,
                    startedAt,
                });
                this.lastResult = result;
                this.cancelResume();
                this.settleActionAttempt(actionLabel, actionOwner, result, commandRequest);
                this.agent.recordActionResult?.(result);
                return { success: false, message: result.detail, interrupted, timedout, unsettled: true, result };
            }
            const activityEvidence = this.activitySnapshot();
            const tacticalDecision = Array.isArray(skillEvidence?.decisions)
                ? skillEvidence.decisions.at(-1)
                : null;
            const failedMeleeContinuation = phase === 'failed'
                && skillEvidence?.kind === 'tactical_combat'
                && ['melee', 'shield_melee'].includes(tacticalDecision?.response)
                ? {
                    kind: 'disengage_then_resume',
                    incidentId: this.agent.survival_director?.safetyIncident?.id || undefined,
                  }
                : null;
            const result = createActionResult({
                actionId,
                label: actionLabel,
                phase,
                code,
                detail: output || (interrupted
                    ? 'Action was interrupted.'
                    : skillFailed
                        ? 'The skill reported that it could not complete.'
                        : skillRequested
                            ? 'The server-side action was requested; waiting for Minecraft state to verify it.'
                        : 'Action completed.'),
                target: skillEvidence?.target || null,
                evidence: {
                    output: output || null,
                    skill: skillEvidence,
                    request: commandRequest || null,
                    activity: activityEvidence,
                },
                retryable: receiptContractFailure
                    ? false
                    : interrupted || timedout || skillRetryable || requestedRetryable,
                continuation: failedMeleeContinuation,
                startedAt,
            });
            this.releaseBodyLease(actionId, actionOwner);
            this.agent.clearBotLogs();
            if (!interrupted) this.agent.bot.emit('idle');
            this.lastResult = result;
            this.settleActionAttempt(actionLabel, actionOwner, result, commandRequest);
            this.agent.recordActionResult?.(result);
            return { success: result.phase === 'succeeded', message: output, interrupted, timedout, result };
        } catch (err) {
            if (receiptLedger) {
                const sealedReceipt = receiptLedger.seal({
                    reason: this.timedout ? 'timeout' : 'exception',
                    mirrorEvidence: this.agent.bot.lastActionEvidence,
                });
                sealedSkillEvidence = sealedReceipt.receipt || sealedSkillEvidence;
            }
            clearTimeout(TIMEOUT);
            this.cancelResume();
            const errorDetail = String(err?.stack || err?.message || err).slice(0, MAX_ACTION_ERROR_CHARS);
            console.error('Code execution triggered catch:', errorDetail);
            const errorMessage = String(err?.message || err).slice(0, MAX_ACTION_ERROR_CHARS);
            const interrupted = Boolean(this.agent.bot.interrupt_code || this.currentActionController?.signal?.aborted);

            if (this.currentActionId === actionId && this.currentActivity) {
                const halt = await this.requestHalt('specialist_error');
                if (halt.acknowledged !== true) await this.forceHalt('specialist_error');
                this.recordTerminalResult({
                    lifecycle: interrupted ? 'CANCELLED' : 'FAILED',
                    reasonClass: interrupted ? 'CANCEL' : 'ENGINE',
                    reasonCode: this.timedout ? 'timeout' : 'runtime_error',
                    retryable: interrupted || this.timedout,
                });
                const settlement = await this.proveSettlement(interrupted ? 'CANCELLED' : 'FAILED');
                if (settlement.settled !== true) {
                    this.stopTimedOutAt = this.now();
                    const result = createActionResult({
                        actionId,
                        label: actionLabel,
                        phase: 'failed',
                        code: 'activity_unsettled',
                        detail: 'The specialist failed and did not prove physical settlement. The body lease remains held until a controlled restart.',
                        evidence: {
                            skill: actionReceiptMode === 'composed'
                                ? sealedSkillEvidence
                                : createLegacyActionReceiptEnvelope(actionId, this.agent.bot.lastActionEvidence),
                            request: commandRequest || null,
                            activity: this.activitySnapshot(),
                        },
                        retryable: false,
                        startedAt,
                    });
                    this.lastResult = result;
                    this.settleActionAttempt(actionLabel, actionOwner, result, commandRequest);
                    this.agent.recordActionResult?.(result);
                    return { success: false, message: result.detail, interrupted, timedout: this.timedout, unsettled: true, result, error: err };
                }
            }

            const activityEvidence = this.activitySnapshot();
            if (this.currentActionId === actionId) this.releaseBodyLease(actionId, actionOwner);

            let message = this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + errorMessage + '\n' +
                'Stack trace:\n' + errorDetail+'\n';

            this.agent.clearBotLogs();
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }
            const result = actionResultFromError(err, {
                actionId,
                label: actionLabel,
                detail: message,
                interrupted,
                startedAt,
                evidence: {
                    skill: actionReceiptMode === 'composed'
                        ? sealedSkillEvidence
                        : createLegacyActionReceiptEnvelope(actionId, this.agent.bot.lastActionEvidence),
                    request: commandRequest || null,
                    activity: activityEvidence,
                },
                retryable: actionReceiptMode === 'composed'
                    && sealedSkillEvidence?.contract?.valid !== true
                    ? false
                    : undefined,
            });
            this.settleActionAttempt(actionLabel, actionOwner, result, commandRequest);
            this.lastResult = result;
            this.agent.recordActionResult?.(result);
            return { success: false, message, interrupted, timedout: this.timedout, result, error: err };
        }
    }

    getBotOutputSummary() {
        const { bot } = this.agent;
        if (bot.interrupt_code && !this.timedout) return '';
        let output = String(bot.output || '');
        if (!output.trim()) {
            bot.output = '';
            return '';
        }
        const MAX_OUT = 500;
        if (output.length > MAX_OUT) {
            output = `Action output is very long (${output.length} chars) and has been shortened.\n
          First outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n ${output.substring(output.length - MAX_OUT / 2)}`;
        }
        else {
            output = 'Action output:\n' + output.toString();
        }
        bot.output = '';
        return output;
    }

    _startTimeout(TIMEOUT_MINS = 10, actionId = null, controller = null, receiptLedger = null) {
        // Nothing observes a timer callback's promise. This callback is the
        // recovery path for a stuck action, so a rejection escaping it would
        // surface as an unhandled rejection -- crashing the agent at exactly
        // the moment it is supposed to recover the bot. Sink errors here.
        return setTimeout(() => {
            void (async () => {
                if (!this.executing || (actionId && this.currentActionId !== actionId)) return;
                const message = `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`;
                console.warn(message);
                this.timedout = true;
                receiptLedger?.seal?.({
                    reason: 'timeout',
                    mirrorEvidence: this.agent.bot.lastActionEvidence,
                });
                // Deliberately not awaited: history.add can reach a model
                // summarization call, and the force stop must not queue behind
                // it. It still needs its own sink or it rejects into the void.
                void Promise.resolve(this.agent.history.add('system', message))
                    .catch((error) => {
                        console.error('[action-manager] Timeout history record failed:', error?.message || error);
                    });
                try { controller?.abort(); } catch { /* already aborted */ }
                await this.stop(); // last attempt to stop
            })().catch((error) => {
                console.error('[action-manager] Timeout recovery failed:', error?.message || error);
            });
        }, TIMEOUT_MINS * 60 * 1000);
    }

}
