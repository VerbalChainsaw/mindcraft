import {
    commandAssignsPersistentJob,
    commandExists,
    containsCommand,
    executeCommand,
    truncCommandMessage,
} from './commands/index.js';
import { waitForBotEvent } from './runtime/interruptible-delay.js';
import { isCancellation } from '../models/cancellation.js';

const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2

// How many consecutive self-prompt turns may pass with no verified action
// result before we pause the goal instead of killing it.
const DEFAULT_MAX_NO_PROGRESS = 3
// How many consecutive self-prompt failures (LLM error / response that
// could not be turned into an action) before we back off instead of dying.
const DEFAULT_MAX_FAILURES = 5
// Cooldown (ms) between self-prompt turns. The agent may also raise this
// via runtime limits, but we keep a sane floor here.
const DEFAULT_COOLDOWN = 350
// When an in-flight server action is awaiting Minecraft verification, pause the
// loop for this long before re-checking, rather than ending the goal.
const REQUEST_PAUSE_MS = 4000
// When the LLM call itself fails, wait this long (growing up to REQUEST_PAUSE_MS)
// before retrying, so a transient provider error does not end the goal.
const FAILURE_BACKOFF_MS = 5000
const MAX_LEDGER_TEXT = 360

function ledgerText(value, maximum = MAX_LEDGER_TEXT) {
    return String(value || '')
        // eslint-disable-next-line no-control-regex -- goal state is persisted and prompt-visible
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
        .replace(/\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
        .replace(/:\/\/([^/@:\s]+):([^/@\s]+)@/g, '://$1:[redacted]@')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
}

function readableCode(value, fallback = 'unknown') {
    return ledgerText(value, 80).replace(/^skill_/, '').replace(/_/g, ' ') || fallback;
}

export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.goal_source = 'none';
        this.idle_time = 0;
        this.cooldown = DEFAULT_COOLDOWN;
        this.no_progress_count = 0;
        this.failure_count = 0;
        this.processing_turn = false;
        this.last_turn_at = null;
        this.last_verified_progress_at = null;
        this.goal_attempt_count = 0;
        this.verified_step_count = 0;
        this.repeated_blocker_count = 0;
        this.last_blocker_signature = '';
        this.last_command = '';
        this.last_command_name = '';
        this.last_command_output = '';
        this.last_goal_outcome = null;
        this.last_model_error = '';
        // Optional callback invoked when a goal ends on its own (paused/stopped
        // due to no progress or repeated failure). The agent uses this to reseed
        // autonomy so a bot keeps playing instead of going idle forever.
        this.onGoalEnded = null;
    }

    // Register a watcher that is told whenever a goal ends without an explicit
    // operator stop. Returning a fresh prompt string from the callback will
    // resume autonomy automatically.
    setGoalEndedHandler(handler) {
        this.onGoalEnded = typeof handler === 'function' ? handler : null;
    }

    resetGoalLedger() {
        this.goal_attempt_count = 0;
        this.verified_step_count = 0;
        this.repeated_blocker_count = 0;
        this.last_blocker_signature = '';
        this.last_command = '';
        this.last_command_name = '';
        this.last_command_output = '';
        this.last_goal_outcome = null;
        this.last_model_error = '';
    }

    recordGoalAttempt(result = null) {
        if (!this.last_command) return;
        this.goal_attempt_count += 1;
        const outcome = result?.actionId
            ? {
                phase: ledgerText(result.phase, 24) || 'failed',
                code: ledgerText(result.code, 80) || 'unknown',
                detail: ledgerText(result.detail || this.last_command_output),
                retryable: result.retryable === true,
                actionId: ledgerText(result.actionId, 80),
            }
            : {
                phase: 'observed',
                code: this.last_command_output ? 'command_returned_observation' : 'missing_action_result',
                detail: ledgerText(
                    this.last_command_output
                    || 'The command returned without a structured action result or useful observation.',
                ),
                retryable: true,
                actionId: null,
            };
        this.last_goal_outcome = outcome;
        if (outcome.phase === 'succeeded') {
            this.verified_step_count += 1;
            this.repeated_blocker_count = 0;
            this.last_blocker_signature = '';
            return;
        }
        if (outcome.phase === 'requested' || outcome.phase === 'observed') return;
        const signature = `${this.last_command_name}:${outcome.phase}:${outcome.code}`;
        if (signature === this.last_blocker_signature) this.repeated_blocker_count += 1;
        else {
            this.last_blocker_signature = signature;
            this.repeated_blocker_count = 1;
        }
    }

    getProgressPrompt() {
        const outcome = this.last_goal_outcome;
        const lines = [
            'GOAL EXECUTION LEDGER (authoritative outcomes only):',
            `- Attempts: ${this.goal_attempt_count}; verified steps: ${this.verified_step_count}.`,
            `- Last command: ${this.last_command || 'none yet'}.`,
            outcome
                ? `- Last outcome: ${outcome.phase} / ${outcome.code}; retryable=${outcome.retryable}; ${outcome.detail || 'no detail'}.`
                : '- Last outcome: none yet.',
            `- Current blocker occurrences: ${this.repeated_blocker_count}.`,
            '- Choose the next command from current Minecraft evidence. Do not repeat an unchanged blocked action.',
            '- When current evidence proves the assigned goal complete, call !endGoal. Never claim completion first.',
        ];
        return lines.join('\n');
    }

    describeLastBlocker(fallback = 'No verified action result was produced.') {
        const outcome = this.last_goal_outcome;
        if (!outcome) return ledgerText(fallback);
        return `${readableCode(outcome.code)}: ${outcome.detail || ledgerText(fallback)}`;
    }

    start(prompt, { source = 'explicit' } = {}) {
        console.log('Self-prompting started.');
        if (this.agent.isOperatorHeld?.()) {
            this.state = STOPPED;
            this.idle_time = 0;
            return { started: false, reason: 'Agent is held by an operator stop. Give a new explicit goal or command first.' };
        }
        if (!prompt) {
            if (!this.prompt)
                return { started: false, reason: 'No prompt specified. Ignoring request.' };
            prompt = this.prompt;
        }
        const promptChanged = prompt !== this.prompt;
        this.state = ACTIVE;
        this.prompt = prompt;
        this.goal_source = ledgerText(source, 24) || 'explicit';
        if (promptChanged) {
            this.no_progress_count = 0;
            this.failure_count = 0;
            this.last_turn_at = null;
            this.last_verified_progress_at = null;
            this.resetGoalLedger();
        }
        if (!this.loop_active) {
            this.interrupt = false;
            this._startLoopGuarded();
        }
        return { started: true, reason: null };
    }

    /**
     * startLoop() is launched fire-and-forget by callers that cannot await it.
     * Its `finally` clears loop_active, but a throw between `loop_active = true`
     * and the `try` still escapes as a process-level unhandled rejection --
     * fatal under --unhandled-rejections=throw, and invisible to the arbiter,
     * which would keep selecting self_prompt_active for a loop that is no
     * longer running. Sink the error and leave the flag honest.
     */
    _startLoopGuarded() {
        void Promise.resolve(this.startLoop()).catch((error) => {
            this.loop_active = false;
            console.error(`[self-prompter] Self-prompt loop failed: ${error?.message || error}`);
        });
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        this.state = state;
        this.prompt = prompt;
        this.goal_source = 'restored';
        if (state === ACTIVE && this.agent.isOperatorHeld?.()) {
            this.state = STOPPED;
            this.idle_time = 0;
            return { started: false, reason: 'Saved self-prompt was not resumed because the bot is operator-held.' };
        }
        if (state === ACTIVE) {
            return this.start(prompt, { source: 'restored' });
        }
        return { started: false, reason: null };
    }

    setPromptPaused(prompt) {
        if (prompt !== this.prompt) {
            this.no_progress_count = 0;
            this.failure_count = 0;
            this.last_turn_at = null;
            this.last_verified_progress_at = null;
            this.resetGoalLedger();
        }
        this.prompt = prompt;
        this.goal_source = 'explicit';
        this.state = PAUSED;
    }

    async executeAutonomyResponse(response) {
        const commandName = containsCommand(response);
        if (!commandName || !commandExists(commandName)) {
            const detail = commandName
                ? `Autonomy selected unavailable command ${commandName}.`
                : 'Autonomy response contained no executable command.';
            this.last_command = ledgerText(truncCommandMessage(response), 260);
            this.last_command_name = ledgerText(commandName || 'invalid_response', 80);
            this.last_command_output = ledgerText(detail);
            await this.agent.history.add('system', detail);
            this.agent.history.save();
            return false;
        }
        if (
            this.interrupt
            || this.state !== ACTIVE
            || this.agent.goal_director?.activeGoal
        ) {
            await this.agent.history.add(
                'system',
                'A stale autonomy response was discarded because another goal now owns action control.',
            );
            this.agent.history.save();
            return false;
        }
        if (this.agent.isOperatorHeld?.()) {
            await this.agent.history.add('system', 'Autonomy command was not executed because Operator Stop is active.');
            this.agent.history.save();
            return false;
        }

        const command = truncCommandMessage(response);
        this.last_command = ledgerText(command, 260);
        this.last_command_name = ledgerText(commandName, 80);
        this.last_command_output = '';
        await this.agent.history.add(this.agent.name, command);
        if (commandAssignsPersistentJob(commandName)) {
            this.interruptForManualCommand();
        }
        let output;
        try {
            output = await executeCommand(this.agent, command, { owner: 'autonomy' });
        } catch (error) {
            output = `Autonomy command ${commandName} failed: ${String(error?.message || error).slice(0, 280)}`;
        }
        this.last_command_output = ledgerText(output);
        if (typeof output === 'string' && output.trim()) {
            await this.agent.history.add('system', output.trim().slice(0, 2_000));
        }
        this.agent.history.save();
        return true;
    }

    async startLoop() {
        if (this.agent.isOperatorHeld?.()) {
            this.state = STOPPED;
            return;
        }
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        const MAX_NO_PROGRESS = this.agent.runtime?.limits?.maxNoProgress ?? DEFAULT_MAX_NO_PROGRESS;
        const MAX_FAILURES = this.agent.runtime?.limits?.maxSelfPromptFailures ?? DEFAULT_MAX_FAILURES;
        let rePlanCounter = 0;
        try {
            while (!this.interrupt && this.state === ACTIVE) {
                if (this.agent.actions?.isOwnerBlocked?.('autonomy')) {
                    // The body frees on the 'idle' edge. Polling for it meant a
                    // bot could stand around for most of a cooldown after the
                    // higher-priority action had already finished. The cooldown
                    // stays as the upper bound so a missed edge cannot park the
                    // loop indefinitely.
                    await waitForBotEvent(this.agent.bot, 'idle', this.cooldown);
                    continue;
                }
                const previousActionId = this.agent.last_action_result?.actionId || null;
                let used_command;
                try {
                    this.last_turn_at = Date.now();
                    this.processing_turn = true;
                    // Use the dedicated autonomy prompt so the bot is explicitly
                    // instructed to ACT each turn, not just converse.
                    const recentContext = this.agent.history.getHistory().slice(-8);
                    used_command = await this.agent.prompter.promptAutonomy(recentContext);
                    if (typeof used_command === 'string' && used_command.trim()) {
                        used_command = await this.executeAutonomyResponse(used_command);
                    } else {
                        used_command = false;
                    }
                } catch (error) {
                    // A cancelled generation is this agent being stopped on
                    // purpose, not a provider failing. Charging it to the error
                    // budget would let a few Operator Stops push a later,
                    // healthy goal closer to its pause threshold, and backing
                    // off would delay a stop that is already in progress.
                    if (isCancellation(error)) {
                        console.log('Self-prompting turn cancelled.');
                        break;
                    }
                    // A thrown error here is almost always a transient LLM/provider
                    // failure, not a problem with the goal itself. Back off and retry
                    // instead of killing the goal so the bot keeps playing.
                    console.error('Self-prompting turn failed:', error);
                    this.last_model_error = ledgerText(error?.message || error);
                    this.failure_count += 1;
                    if (this.failure_count >= MAX_FAILURES) {
                        const out = `I paused this goal after ${MAX_FAILURES} consecutive model failures. Last error: ${this.last_model_error || 'provider unavailable'}.`;
                        console.warn(out);
                        void this.agent.openChat(out).catch(error => console.error('Failed to report self-prompt pause:', error));
                        this._endGoal(PAUSED);
                        break;
                    }
                    const backoff = Math.min(FAILURE_BACKOFF_MS * this.failure_count, REQUEST_PAUSE_MS);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                } finally {
                    this.processing_turn = false;
                }
                if (this.interrupt || this.state !== ACTIVE) break;

                const result = this.agent.last_action_result;
                const resultChanged = Boolean(result?.actionId && result.actionId !== previousActionId);
                const requestPending = resultChanged && result.phase === 'requested';
                const terminalFailure = resultChanged && result.phase !== 'succeeded' && result.retryable === false;
                this.recordGoalAttempt(resultChanged ? result : null);
                this.last_model_error = '';

                if (requestPending) {
                    // A server-side action was issued and is awaiting Minecraft
                    // state verification. This is NOT a failure: it means the bot
                    // did act. Pause briefly and re-check rather than ending the goal.
                    const reason = String(result.code || 'server action request').replace(/^skill_/, '').replace(/_/g, ' ');
                    console.warn(`Self-prompt action '${reason}' is pending Minecraft verification; pausing before next turn.`);
                    this.state = PAUSED;
                    await new Promise(r => setTimeout(r, REQUEST_PAUSE_MS));
                    // Resume only if nothing else took control in the meantime.
                    if (!this.interrupt && this.agent.isOperatorHeld?.()) {
                        this.state = STOPPED;
                        break;
                    }
                    this.state = ACTIVE;
                    this.no_progress_count = 0;
                    this.failure_count = 0;
                    continue;
                }

                if (terminalFailure) {
                    const out = `I paused this goal because the last action cannot continue: ${this.describeLastBlocker('non-retryable action failure')}.`;
                    console.warn(out);
                    void this.agent.openChat(out).catch(error => console.error('Failed to report self-prompt pause:', error));
                    this._endGoal(PAUSED);
                    break;
                }

                if (used_command && resultChanged && result.phase === 'succeeded') {
                    this.no_progress_count = 0;
                    this.failure_count = 0;
                    this.last_verified_progress_at = Date.now();
                } else {
                    this.failure_count = 0; // a successful model turn resets the error budget
                    this.no_progress_count += 1;
                    if (this.no_progress_count >= MAX_NO_PROGRESS) {
                        const out = `I paused this goal after ${MAX_NO_PROGRESS} turns without verified progress. Last blocker: ${this.describeLastBlocker()}.`;
                        console.warn(out);
                        void this.agent.openChat(out).catch(error => console.error('Failed to report self-prompt pause:', error));
                        this._endGoal(PAUSED);
                        break;
                    }
                }

                // Periodic re-planning: every ~10 productive-ish turns, give the
                // model a chance to re-state what it is doing so a stale goal
                // does not trap the bot. The prompt already permits goal changes,
                // this just ensures the loop keeps fresh context flowing.
                rePlanCounter += 1;
                if (rePlanCounter >= 10) {
                    rePlanCounter = 0;
                    await this.agent.history.add(
                        'system',
                        `Re-evaluate the active goal before the next command: '${this.prompt}'. Check recent evidence, change approach if progress has stalled, and do not claim unverified work.`,
                    );
                    this.agent.history.save();
                }

                // Pace by minimum turn period rather than by a trailing pause.
                // A turn that already spent about a second in the model and
                // longer still acting has more than served the rate limit;
                // adding a further fixed wait on top of it was dead time the
                // player watches the bot stand through after every action.
                const remainingCooldown = this.cooldown - (Date.now() - this.last_turn_at);
                if (remainingCooldown > 0) {
                    await new Promise(r => setTimeout(r, remainingCooldown));
                }
            }
        } finally {
            console.log('self prompt loop stopped')
            this.loop_active = false;
            this.interrupt = false;
        }
    }

    // Centralized goal-end path. A PAUSED end stays recoverable; STOPPED is
    // final unless explicitly restarted. Auto-reseeding on pause is handled
    // by update() so we never tight-loop startLoop inside startLoop.
    _endGoal(endState) {
        this.state = endState;
        this.idle_time = 0;
        this.no_progress_count = 0;
    }

    update(delta) {
        // automatically restarts loop
        let reseedPrompt = null;
        if (
            !this.agent.isOperatorHeld?.()
            && !this.agent.actions?.isOwnerBlocked?.('autonomy')
            && this.state === ACTIVE
            && !this.loop_active
            && !this.interrupt
        ) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this._startLoopGuarded();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }

        // When a previous goal ended in a recoverable way (paused), attempt
        // to reseed autonomy so the bot keeps playing instead of idling.
        // Explicit goals or !stop should pass `endState === STOPPED` and
        // silence reseed by returning null from the handler.
        if (
          !this.loop_active
          && !this.interrupt
          && !this.agent.isOperatorHeld?.()
          && reseedPrompt === null
          && this.state === PAUSED
          && this.goal_source === 'default'
          && typeof this.onGoalEnded === 'function'
        ) {
            reseedPrompt = this.onGoalEnded(this.prompt, this.state);
            if (typeof reseedPrompt === 'string' && reseedPrompt.trim()) {
                console.log(`Goal paused; reseeding with: "${reseedPrompt}"`);
                this.start(reseedPrompt.trim(), { source: 'default' });
            }
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (!this.loop_active) {
            this.interrupt = false;
            return;
        }
        if (!this.interrupt) {
            console.log('stopping self-prompt loop')
            this.interrupt = true;
        }
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action = true) {
        this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        if (this.processing_turn) {
            void this.stopLoop();
        } else {
            await this.stopLoop();
        }
        this.state = STOPPED;
        this.idle_time = 0;
        this.no_progress_count = 0;
    }

    async pause() {
        this.interrupt = true;
        await this.agent.actions.stop();
        if (this.processing_turn) {
            void this.stopLoop();
        } else {
            await this.stopLoop();
        }
        this.state = PAUSED;
        this.idle_time = 0;
    }

    interruptForManualCommand() {
        const hadAutonomy = this.state === ACTIVE || this.state === PAUSED || this.loop_active;
        if (!hadAutonomy) return false;
        // Do not call ActionManager.stop() here. This handoff runs immediately
        // before a direct player action, and stopping the manager would race or
        // cancel the new command the player just issued.
        this.interrupt = true;
        this.state = STOPPED;
        this.idle_time = 0;
        this.no_progress_count = 0;
        console.log('Self-prompting stopped for a direct player command.');
        return true;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}
