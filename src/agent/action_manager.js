import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { actionResultFromError, createActionResult } from './runtime/action-result.js';

const STOP_WAIT_TIMEOUT_MS = 10_000;
const ACTION_OWNER_PRIORITY = Object.freeze({
    background: 0,
    autonomy: 10,
    job: 20,
    player: 30,
    survival: 40,
    reflex: 50,
});

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
        this.currentActionFn = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.resume_owner = '';
        this.last_action_time = 0;
        this.recent_action_counter = 0;
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

    isOwnerBlocked(owner) {
        return Boolean(
            this.executing
            && this.ownerPriority(owner) < this.ownerPriority(this.currentActionOwner),
        );
    }

    async resumeAction(actionFn, timeout) {
        return this._executeResume(actionFn, timeout);
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
        while (this.executing && Date.now() < deadline) {
            if (!continueWhile()) {
                return { stopped: false, timedOut: false, superseded: true, requestedAt };
            }
            try { this.agent.requestInterrupt(); } catch { /* bot cleanup is best effort */ }
            await new Promise(resolve => setTimeout(resolve, 300));
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

            if (this.last_action_time > 0) {
                let time_diff = Date.now() - this.last_action_time;
                if (time_diff < 20) {
                    this.recent_action_counter++;
                }
                else {
                    this.recent_action_counter = 0;
                }
                if (this.recent_action_counter > 3) {
                    console.warn('Fast action loop detected, cancelling resume.');
                    this.cancelResume(); // likely cause of repetition
                }
                if (this.recent_action_counter > 5) {
                    console.error('Infinite action loop detected; holding the bot and cancelling resume.');
                    this.cancelResume();
                    this.agent.holdPosition?.('fast action loop safety');
                    const result = createActionResult({
                        actionId,
                        label: actionLabel,
                        phase: 'blocked',
                        code: 'action_loop_detected',
                        detail: 'Rapid repeated actions were detected. The bot is held to prevent a runaway loop; give it an explicit new command after reviewing the last result.',
                        retryable: false,
                        startedAt,
                    });
                    this.lastResult = result;
                    this.agent.recordActionResult?.(result);
                    return { success: false, message: result.detail, interrupted: false, timedout: false, result };
                }
            }
            this.last_action_time = Date.now();
            console.log('executing code...\n');

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();
            this.agent.bot.lastActionEvidence = null;

            this.executing = true;
            this.currentActionLabel = actionLabel;
            this.currentActionOwner = actionOwner;
            this.currentActionFn = actionFn;
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
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionOwner = '';
            this.currentActionFn = null;
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
            this.agent.recordActionResult?.(result);
            return { success: result.phase === 'succeeded', message: output, interrupted, timedout, result };
        } catch (err) {
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionOwner = '';
            this.currentActionFn = null;
            this.stopRequestedAt = null;
            this.stopTimedOutAt = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();
            console.error("Code execution triggered catch:", err);
            // Log the full stack trace
            console.error(err.stack);
            await this.stop();
            const errorMessage = err.toString();

            let message = this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + errorMessage + '\n' +
                'Stack trace:\n' + err.stack+'\n';

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
