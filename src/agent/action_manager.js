import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { actionResultFromError, createActionResult } from './runtime/action-result.js';

const STOP_WAIT_TIMEOUT_MS = 10_000;
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
const PLAYER_PREEMPTIBLE_REFLEX_ACTIONS = new Set([
    'mode:unstuck',
    'mode:item_collecting',
    'mode:torch_placing',
    'mode:hunting',
    'mode:elbow_room',
    'mode:idle_staring',
]);
const MAX_ACTION_ERROR_CHARS = 4_096;

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
    const target = result?.target;
    if (
        result?.phase !== 'succeeded'
        || !target
        || ![target.x, target.y, target.z].every(Number.isFinite)
    ) return null;
    return JSON.stringify([
        String(target.name || target.type || ''),
        target.x,
        target.y,
        target.z,
    ]);
}

function normalizeActionOwner(owner) {
    const normalized = String(owner || '').trim().toLowerCase();
    return Object.hasOwn(ACTION_OWNER_PRIORITY, normalized) ? normalized : 'player';
}

export class ActionManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionOwner = '';
        this.currentActionId = '';
        this.currentActionFn = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.resume_owner = '';
        this.last_action_time = 0;
        this.currentActionStartedAt = 0;
        this.recentActionAttempts = [];
        this.lastProgressTargetByAction = new Map();
        this.lastResult = null;
        this.nextActionId = 0;
        this.stopRequestedAt = null;
        this.stopTimedOutAt = null;
        this.ownerContext = new AsyncLocalStorage();
    }

    runWithOwner(owner, operation) {
        if (typeof operation !== 'function') throw new TypeError('Action owner operation must be a function.');
        return this.ownerContext.run(normalizeActionOwner(owner), operation);
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

    recordActionAttempt(actionLabel, actionOwner) {
        const now = Date.now();
        this.recentActionAttempts = this.recentActionAttempts.filter(attempt => (
            now - attempt.startedAt <= ACTION_PATTERN_WINDOW_MS
        ));

        // A fresh player command is authoritative and starts a new local
        // intent. It must never be rejected because the bot was previously
        // struggling with an automatic task at the same location.
        if (actionOwner === 'player') {
            this.recentActionAttempts = [];
            return null;
        }
        if (this.isCriticalReflexAction(actionOwner, actionLabel)) return null;

        const position = actionPosition(this.agent);
        const repeats = this.recentActionAttempts.filter(attempt => (
            attempt.owner === actionOwner
            && attempt.label === actionLabel
            && isSameActionArea(attempt.position, position)
        ));
        if (repeats.length >= ACTION_PATTERN_MAX_REPEATS) {
            return { repeats: repeats.length + 1, position };
        }

        this.recentActionAttempts.push({
            label: actionLabel,
            owner: actionOwner,
            position,
            startedAt: now,
        });
        return null;
    }

    recordActionProgress(actionLabel, actionOwner, result) {
        const target = actionProgressTarget(result);
        if (!target) return false;
        const key = JSON.stringify([actionOwner, actionLabel]);
        const previousTarget = this.lastProgressTargetByAction.get(key);
        this.lastProgressTargetByAction.set(key, target);
        if (previousTarget === target) return false;

        // A deterministic skill just changed a different world coordinate.
        // That is productive batch work (placing a blueprint, mining a seam),
        // not the same no-progress action reclaiming one patch of ground.
        this.recentActionAttempts = this.recentActionAttempts.filter(attempt => (
            attempt.owner !== actionOwner || attempt.label !== actionLabel
        ));
        return true;
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
    async resumeAction(actionLabel = null, actionFn = null, timeout = 10, owner = null) {
        return this._executeResume(actionLabel, actionFn, timeout, owner);
    }

    async runAction(actionLabel, actionFn, { timeout, resume = false, owner } = {}) {
        const actionOwner = normalizeActionOwner(owner || this.ownerContext.getStore());
        if (resume) {
            return this._executeResume(actionLabel, actionFn, timeout, actionOwner);
        } else {
            return this._executeAction(actionLabel, actionFn, timeout, actionOwner);
        }
    }

    async stop({ timeoutMs = STOP_WAIT_TIMEOUT_MS, continueWhile = () => true } = {}) {
        if (!this.executing) {
            this.stopRequestedAt = null;
            this.stopTimedOutAt = null;
            return { stopped: true, timedOut: false };
        }
        if (this.stopTimedOutAt) {
            try { this.agent.requestInterrupt(); } catch { /* bot cleanup is best effort */ }
            return { stopped: false, timedOut: true, requestedAt: this.stopRequestedAt };
        }

        const requestedAt = Date.now();
        const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? Math.min(timeoutMs, STOP_WAIT_TIMEOUT_MS)
            : STOP_WAIT_TIMEOUT_MS;
        const deadline = requestedAt + boundedTimeoutMs;
        this.stopRequestedAt = requestedAt;
        let attempt = 0;
        let lastInterruptAt = 0;
        while (this.executing && Date.now() < deadline) {
            if (!continueWhile()) {
                return { stopped: false, timedOut: false, superseded: true, requestedAt };
            }
            const now = Date.now();
            if (attempt === 0 || now - lastInterruptAt >= INTERRUPT_REISSUE_MS) {
                lastInterruptAt = now;
                try { this.agent.requestInterrupt(); } catch { /* bot cleanup is best effort */ }
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await new Promise(resolve => setTimeout(resolve, Math.min(stopPollDelayMs(attempt), remaining)));
            attempt += 1;
        }

        if (!continueWhile()) {
            return { stopped: !this.executing, timedOut: false, superseded: true, requestedAt };
        }

        if (this.executing) {
            this.stopTimedOutAt = Date.now();
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
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10, owner = null) {
        const new_resume = actionFn != null;
        if (new_resume) { // start new resume
            this.resume_func = actionFn;
            assert(actionLabel != null, 'actionLabel is required for new resume');
            this.resume_name = actionLabel;
            this.resume_owner = normalizeActionOwner(owner || this.ownerContext.getStore());
        }
        if (this.resume_func != null && (this.agent.isIdle() || new_resume) && (!this.agent.self_prompter.isActive() || new_resume)) {
            this.currentActionLabel = this.resume_name;
            let res = await this._executeAction(
                this.resume_name,
                this.resume_func,
                timeout,
                this.resume_owner || 'player',
            );
            this.currentActionLabel = '';
            if (!res.success && res.result?.retryable === false) {
                this.cancelResume();
            }
            return res;
        } else {
            return { success: false, message: null, interrupted: false, timedout: false };
        }
    }

    async _executeAction(actionLabel, actionFn, timeout = 10, owner = 'player') {
        let TIMEOUT;
        const startedAt = Date.now();
        const actionId = `${this.agent.name || 'bot'}-${++this.nextActionId}-${startedAt}`;
        const actionOwner = normalizeActionOwner(owner);
        try {
            if (
                this.agent.isOperatorHeld?.()
                && !(actionOwner === 'reflex' && actionLabel === 'mode:self_preservation')
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

            const repeatedPattern = this.recordActionAttempt(actionLabel, actionOwner);
            if (repeatedPattern) {
                console.warn(`Repeated action pattern detected for '${actionLabel}' (${repeatedPattern.repeats} starts within ${ACTION_PATTERN_WINDOW_MS}ms).`);
                this.cancelResume();
                this.agent.holdPosition?.('repeated action pattern safety');
                const result = createActionResult({
                    actionId,
                    label: actionLabel,
                    phase: 'blocked',
                    code: 'action_pattern_detected',
                    detail: 'The same automatic action kept restarting in the same area, so the bot stopped to avoid looping. Give it a fresh player command after checking the obstruction.',
                    evidence: {
                        repeats: repeatedPattern.repeats,
                        windowMs: ACTION_PATTERN_WINDOW_MS,
                        position: repeatedPattern.position,
                    },
                    retryable: false,
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
            this.currentActionStartedAt = this.last_action_time;
            this.agent.behavior_arbiter?.recordActionStart?.({
                actionId,
                owner: actionOwner,
                ownerPriority: this.ownerPriority(actionOwner),
                label: actionLabel,
                acquiredAt: this.currentActionStartedAt,
                startedAt: this.currentActionStartedAt,
            });
            this.timedout = false;

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            // Start the action. A large portion of the skill library uses an
            // explicit `false` result for a verified inability to act (missing
            // tool, unreachable target, interrupted path, and so on). Preserve
            // that signal instead of converting every resolved Promise into a
            // false success.
            const actionValue = await actionFn();

            // mark action as finished + cleanup
            this.agent.behavior_arbiter?.recordActionRelease?.({
                actionId,
                owner: actionOwner,
                ownerPriority: this.ownerPriority(actionOwner),
                releasedAt: Date.now(),
            });
            this.executing = false;
            this.currentActionId = '';
            this.currentActionLabel = '';
            this.currentActionOwner = '';
            this.currentActionFn = null;
            this.currentActionStartedAt = 0;
            this.stopRequestedAt = null;
            this.stopTimedOutAt = null;
            clearTimeout(TIMEOUT);

            // get bot activity summary
            let output = this.getBotOutputSummary();
            let interrupted = this.agent.bot.interrupt_code;
            let timedout = this.timedout;
            this.agent.clearBotLogs();

            // if not interrupted and not generating, emit idle event
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }

            // return action status report
            const skillEvidence = this.agent.bot.lastActionEvidence || null;
            const skillFailed = actionValue === false;
            const skillRequested = !skillFailed && skillEvidence?.completion === 'requested';
            const skillFailureCode = typeof skillEvidence?.outcome === 'string' && skillEvidence.outcome.trim()
                ? `skill_${skillEvidence.outcome.trim()}`
                : 'skill_failed';
            const skillSuccessCode = typeof skillEvidence?.outcome === 'string' && skillEvidence.outcome.trim()
                ? `skill_${skillEvidence.outcome.trim()}`
                : 'completed';
            const skillRetryable = skillFailed && typeof skillEvidence?.retryable === 'boolean'
                ? skillEvidence.retryable
                : skillFailed;
            const requestedRetryable = skillRequested && skillEvidence?.retryable === true;
            const result = createActionResult({
                actionId,
                label: actionLabel,
                phase: interrupted ? 'interrupted' : timedout || skillFailed ? 'failed' : skillRequested ? 'requested' : 'succeeded',
                code: interrupted ? 'interrupted' : timedout ? 'timeout' : skillFailed ? skillFailureCode : skillSuccessCode,
                detail: output || (interrupted
                    ? 'Action was interrupted.'
                    : skillFailed
                        ? 'The skill reported that it could not complete.'
                        : skillRequested
                            ? 'The server-side action was requested; waiting for Minecraft state to verify it.'
                        : 'Action completed.'),
                target: skillEvidence?.target || null,
                evidence: { output: output || null, skill: skillEvidence },
                retryable: interrupted || timedout || skillRetryable || requestedRetryable,
                startedAt,
            });
            this.lastResult = result;
            this.recordActionProgress(actionLabel, actionOwner, result);
            this.agent.recordActionResult?.(result);
            return { success: result.phase === 'succeeded', message: output, interrupted, timedout, result };
        } catch (err) {
            if (this.currentActionId === actionId) {
                this.agent.behavior_arbiter?.recordActionRelease?.({
                    actionId,
                    owner: actionOwner,
                    ownerPriority: this.ownerPriority(actionOwner),
                    releasedAt: Date.now(),
                });
            }
            this.executing = false;
            this.currentActionId = '';
            this.currentActionLabel = '';
            this.currentActionOwner = '';
            this.currentActionFn = null;
            this.currentActionStartedAt = 0;
            this.stopRequestedAt = null;
            this.stopTimedOutAt = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();
            const errorDetail = String(err?.stack || err?.message || err).slice(0, MAX_ACTION_ERROR_CHARS);
            console.error('Code execution triggered catch:', errorDetail);
            await this.stop();
            const errorMessage = String(err?.message || err).slice(0, MAX_ACTION_ERROR_CHARS);

            let message = this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + errorMessage + '\n' +
                'Stack trace:\n' + errorDetail+'\n';

            let interrupted = this.agent.bot.interrupt_code;
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
                evidence: { skill: this.agent.bot.lastActionEvidence || null },
            });
            this.lastResult = result;
            this.agent.recordActionResult?.(result);
            return { success: false, message, interrupted, timedout: false, result, error: err };
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

    _startTimeout(TIMEOUT_MINS = 10) {
        return setTimeout(async () => {
            console.warn(`Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            await this.stop(); // last attempt to stop
        }, TIMEOUT_MINS * 60 * 1000);
    }

}
