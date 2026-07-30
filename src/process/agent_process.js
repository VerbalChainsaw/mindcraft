import { spawn } from 'child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'url';
import process from 'node:process';
import { broadcastAgentStatus, logoutAgent } from '../mindcraft/mindserver.js';
import { terminateOwnedProcessTree } from '../mindcraft/process-tree.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));
const MIN_AUTO_RESTART_UPTIME_MS = 10000;
const MAX_AUTO_RESTARTS = 3;
const WINDOWS_CONTROL_C_EXIT = 0xC000013A;
const MAX_DIAGNOSTIC_LINES = 40;
const MAX_DIAGNOSTIC_LINE_LENGTH = 500;
const MAX_DIAGNOSTIC_BUFFER_LENGTH = MAX_DIAGNOSTIC_LINE_LENGTH;
const DIAGNOSTIC_CAUSE_MAX_AGE_MS = 30_000;
const DIAGNOSTIC_DISPLAY_MAX_AGE_MS = 5 * 60_000;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const MIN_READY_TIMEOUT_MS = 5_000;
const MAX_READY_TIMEOUT_MS = 180_000;
const READINESS_STAGES = new Set([
    'process_starting',
    'process_spawned',
    'bridge_connected',
    'minecraft_login',
    'world_ready',
]);
const STARTUP_EVIDENCE = new Set([
    ...READINESS_STAGES,
    'failure',
    'child.settings_profile_ready',
    'child.mineflayer_created',
    'child.login_callback',
    'child.spawn_callback',
    'child.handlers_ready',
]);
const CHILD_STARTUP_MARKER_PATTERN = /^\[mindcraft-startup\] (settings_profile_ready|mineflayer_created|login_callback|spawn_callback|handlers_ready)$/;
// eslint-disable-next-line no-control-regex -- strip terminal escape sequences from child diagnostics
const ANSI_ESCAPE_PATTERN = new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'g');
// eslint-disable-next-line no-control-regex -- strip non-printable control characters before dashboard exposure
const CONTROL_CHARACTER_PATTERN = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');

export function sanitizeAgentDiagnostic(value) {
    return String(value || '')
        .replace(ANSI_ESCAPE_PATTERN, '')
        .replace(CONTROL_CHARACTER_PATTERN, '')
        .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
        .replace(/\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
        .replace(/:\/\/([^/@:\s]+):([^/@\s]+)@/g, '://$1:[redacted]@')
        .trim()
        .slice(0, MAX_DIAGNOSTIC_LINE_LENGTH);
}

export class AgentProcess {
    constructor(name, port, {
        spawnChild = spawn,
        now = Date.now,
        minAutoRestartUptimeMs = MIN_AUTO_RESTART_UPTIME_MS,
        maxAutoRestarts = MAX_AUTO_RESTARTS,
        notifyStatus = broadcastAgentStatus,
        platform = process.platform,
        connectionToken = randomBytes(32).toString('hex'),
        readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
        restartGracefulTimeoutMs = 15_000,
        terminateProcessTree = terminateOwnedProcessTree,
    } = {}) {
        this.name = name;
        this.port = port;
        this.spawnChild = spawnChild;
        this.now = now;
        this.minAutoRestartUptimeMs = minAutoRestartUptimeMs;
        this.maxAutoRestarts = maxAutoRestarts;
        this.notifyStatus = notifyStatus;
        this.platform = platform;
        this.connectionToken = connectionToken;
        this.terminateProcessTree = terminateProcessTree;
        this.restartGracefulTimeoutMs = Math.max(1_000, Number(restartGracefulTimeoutMs) || 15_000);
        this.readyTimeoutMs = Math.max(
            MIN_READY_TIMEOUT_MS,
            Math.min(MAX_READY_TIMEOUT_MS, Number(readyTimeoutMs) || DEFAULT_READY_TIMEOUT_MS),
        );
        this.state = 'idle';
        this.readinessStage = 'idle';
        this.retryable = false;
        this.lastError = null;
        this.running = false;
        this.process = null;
        this._autoRestartCount = 0;
        this._restartRequested = false;
        this._stopRequested = false;
        this._restartDeferred = null;
        this._restartTerminationTimer = null;
        this._startedAt = null;
        this._exitWait = null;
        this._exitWaitProcess = null;
        this._diagnosticBuffer = '';
        this._diagnostics = [];
        this._startupEvidenceStartedAt = null;
        this._lastStartupEvidenceElapsedMs = 0;
        this._lastStartupEvidence = null;
        this._readyWait = null;
        this._startupFailure = null;
    }

    start(load_memory=false, init_message=null, count_id=0, readyTimeoutMs=this.readyTimeoutMs) {
        this.count_id = count_id;
        this.running = false;
        this.state = 'starting';
        this.readinessStage = 'process_starting';
        this.retryable = false;
        this.lastError = null;
        this._startupFailure = null;
        this._diagnosticBuffer = '';
        this._diagnostics = [];
        this._startupEvidenceStartedAt = this.now();
        this._lastStartupEvidenceElapsedMs = 0;
        this._lastStartupEvidence = null;
        this._recordStartupEvidence('process_starting');
        this._notifyStatus();

        let args = [init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        let agentProcess;
        try {
            agentProcess = this.spawnChild(process.execPath, args, {
                windowsHide: true,
                stdio: ['ignore', 'inherit', 'pipe'],
                env: {
                    ...process.env,
                    MINDCRAFT_AGENT_TOKEN: this.connectionToken,
                },
            });
        } catch (error) {
            return this._failStart(error);
        }

        this.process = agentProcess;
        this._attachDiagnostics(agentProcess);
        this._beginExitWait(agentProcess);
        const readyWait = this._beginReadyWait(agentProcess, readyTimeoutMs);

        agentProcess.once('spawn', () => {
            if (agentProcess !== this.process) return;
            if (this._stopRequested) {
                this._settleReadyWait(agentProcess, new Error('Agent startup stopped before becoming ready.'));
                return;
            }
            this._startedAt = this.now();
            this.markReadinessStage('process_spawned');
        });
        agentProcess.once('error', (error) => {
            if (agentProcess !== this.process) return;
            this._startupFailure = { process: agentProcess, error };
            const childStarted = Number.isInteger(agentProcess.pid) && agentProcess.pid > 0;
            this._failProcess(error, childStarted);
            if (!childStarted) this._resolveExitWait(agentProcess);
        });
        agentProcess.once('exit', (code, signal) => {
            this._handleExit(agentProcess, code, signal);
        });
        return readyWait;
    }

    markReadinessStage(stage) {
        if (!READINESS_STAGES.has(stage) || !this.process || this._stopRequested) return false;
        if (this.state !== 'starting' && stage !== 'world_ready') return false;
        this.readinessStage = stage;
        this._recordStartupEvidence(stage);
        this._notifyStatus();
        return true;
    }

    markReady() {
        const agentProcess = this.process;
        if (!agentProcess || this._stopRequested || this._readyWait?.process !== agentProcess) return false;
        this.running = true;
        this.state = 'running';
        this.readinessStage = 'world_ready';
        this.retryable = false;
        this.lastError = null;
        this._recordStartupEvidence('world_ready');
        this._settleReadyWait(agentProcess);
        this._notifyStatus();
        return true;
    }

    stop() {
        if (!this.process) return false;
        this._restartRequested = false;
        this._stopRequested = true;
        this.state = 'stopping';
        this.readinessStage = 'stopping';
        this.retryable = false;
        this._settleReadyWait(this.process, new Error(`Agent '${this.name}' startup stopped by operator request.`));
        this._cancelRestart(new Error(`Agent '${this.name}' restart cancelled by stop request.`));
        if (this.process.killed) return false;
        return this.process.kill('SIGINT');
    }

    waitForExit() {
        return this._exitWait ? this._exitWait.promise : Promise.resolve();
    }

    forceStop() {
        const activeProcess = this.process;
        if (!activeProcess) return { success: true, alreadyExited: true, pid: null };
        this._restartRequested = false;
        this._stopRequested = true;
        this.state = 'stopping';
        this.readinessStage = 'stopping';
        this.retryable = false;
        this._settleReadyWait(activeProcess, new Error(`Agent '${this.name}' was force-stopped by operator request.`));
        this._cancelRestart(new Error(`Agent '${this.name}' restart cancelled by force-stop request.`));
        return this.terminateProcessTree(activeProcess);
    }

    forceRestart() {
        if (this._restartDeferred) return this._restartDeferred.promise;

        this._autoRestartCount = 0;
        if (!this.process) {
            const restart = this._startRestart();
            restart.catch(() => {});
            return restart;
        }

        this._restartRequested = true;
        this._stopRequested = true;
        this.state = 'stopping';
        this.retryable = false;
        this._restartDeferred = this._createRestartDeferred();
        const restartPromise = this._restartDeferred.promise;
        const activeProcess = this.process;
        let signalled = activeProcess.killed;
        if (!signalled) {
            try {
                signalled = activeProcess.kill('SIGINT');
            } catch {
                signalled = false;
            }
        }
        this._restartTerminationTimer = setTimeout(async () => {
            this._restartTerminationTimer = null;
            if (this.process !== activeProcess || !this._restartDeferred) return;
            const result = await this.terminateProcessTree(activeProcess);
            if (!result.success && this.process === activeProcess) {
                this._failProcess(
                    new Error(result.error || `Agent '${this.name}' process tree did not exit for restart.`),
                    true,
                );
            }
        }, signalled ? this.restartGracefulTimeoutMs : 1);
        this._restartTerminationTimer.unref?.();
        if (!signalled) {
            this.lastError = `Agent '${this.name}' did not accept graceful restart; forcing its process tree to exit.`;
            this._notifyStatus();
        }
        return restartPromise;
    }

    isActive() {
        return this.process !== null || ['starting', 'running', 'stopping', 'restarting'].includes(this.state);
    }

    getDiagnostics(limit = 12, maxAgeMs = DIAGNOSTIC_DISPLAY_MAX_AGE_MS) {
        const boundedLimit = Math.max(0, Math.min(MAX_DIAGNOSTIC_LINES, Number(limit) || 0));
        const cutoff = this.now() - Math.max(0, Number(maxAgeMs) || 0);
        return this._diagnostics
            .filter((entry) => entry.at >= cutoff)
            .slice(-boundedLimit)
            .map((entry) => entry.line);
    }

    _attachDiagnostics(agentProcess) {
        agentProcess.stderr?.on?.('data', (chunk) => {
            try { process.stderr.write(chunk); } catch { /* terminal unavailable */ }
            this._recordDiagnosticChunk(chunk);
        });
    }

    _recordDiagnosticChunk(chunk, flush = false) {
        const combined = this._diagnosticBuffer + String(chunk || '');
        const lines = combined.split(/\r?\n/);
        const remainder = lines.pop() || '';
        this._diagnosticBuffer = !flush
            ? remainder.slice(0, MAX_DIAGNOSTIC_BUFFER_LENGTH)
            : '';
        if (flush && remainder) lines.push(remainder);
        for (const rawLine of lines) {
            const candidate = String(rawLine);
            if (candidate.trimStart().startsWith('[mindcraft-startup]')) {
                const marker = CHILD_STARTUP_MARKER_PATTERN.exec(candidate);
                if (marker && this.state === 'starting') this._recordStartupEvidence(`child.${marker[1]}`);
                continue;
            }
            const line = sanitizeAgentDiagnostic(candidate);
            if (line) this._appendDiagnostic(line);
        }
    }

    _appendDiagnostic(line) {
        this._diagnostics.push({ at: this.now(), line });
        if (this._diagnostics.length > MAX_DIAGNOSTIC_LINES) {
            this._diagnostics.splice(0, this._diagnostics.length - MAX_DIAGNOSTIC_LINES);
        }
    }

    _recordStartupEvidence(evidence) {
        if (!STARTUP_EVIDENCE.has(evidence) || this._startupEvidenceStartedAt === null) return false;
        if (evidence === this._lastStartupEvidence) return false;
        const elapsed = Math.max(
            this._lastStartupEvidenceElapsedMs,
            Math.max(0, this.now() - this._startupEvidenceStartedAt),
        );
        this._lastStartupEvidenceElapsedMs = elapsed;
        this._lastStartupEvidence = evidence;
        const line = sanitizeAgentDiagnostic(`startup +${elapsed}ms: ${evidence}`);
        this._appendDiagnostic(line);
        return true;
    }

    _exitError(code, signal) {
        const cutoff = this.now() - DIAGNOSTIC_CAUSE_MAX_AGE_MS;
        const diagnostic = [...this._diagnostics].reverse().find((entry) => (
            entry.at >= cutoff
            && !/^at\s/i.test(entry.line)
            && !/^Failed to start agent process:?$/i.test(entry.line)
            && !/^startup \+\d+ms:/i.test(entry.line)
        ));
        return diagnostic?.line || `Agent process exited with code ${code ?? 'unknown'} and signal ${signal ?? 'none'}`;
    }

    _handleExit(agentProcess, code, signal) {
        if (agentProcess !== this.process) return;
        if (this._restartTerminationTimer) clearTimeout(this._restartTerminationTimer);
        this._restartTerminationTimer = null;

        this._recordDiagnosticChunk('', true);
        console.log(`Agent process exited with code ${code} and signal ${signal}`);
        this.running = false;
        const startupFailure = this._startupFailure?.process === agentProcess
            ? this._startupFailure.error
            : null;
        const readinessPending = this._readyWait?.process === agentProcess;
        const readinessError = startupFailure || (readinessPending ? new Error(this._exitError(code, signal)) : null);
        if (readinessError) this._settleReadyWait(agentProcess, readinessError);

        const restartRequested = this._restartRequested;
        const stopRequested = this._stopRequested;
        this._restartRequested = false;
        this._stopRequested = false;
        this._startupFailure = null;
        this.process = null;
        this._resolveExitWait(agentProcess);

        if (restartRequested) {
            this.state = 'restarting';
            this.readinessStage = 'restarting';
            this.retryable = false;
            logoutAgent(this.name);
            this._notifyStatus();
            this._startRestart().then(
                (result) => this._finishRestart(result),
                (error) => this._finishRestart(null, error),
            );
            return;
        }

        if (readinessError && !stopRequested) {
            this.state = 'failed';
            this.readinessStage = 'failed';
            this.retryable = true;
            this.lastError = this._describeError(readinessError);
            this._recordStartupEvidence('failure');
            logoutAgent(this.name);
            this._notifyStatus();
            return;
        }

        if (stopRequested || code === 0 || signal === 'SIGINT') {
            this.state = 'stopped';
            this.readinessStage = 'stopped';
            this.retryable = true;
            logoutAgent(this.name);
            this._notifyStatus();
            return;
        }

        this.lastError = this._exitError(code, signal);
        const uptime = this._startedAt === null ? 0 : this.now() - this._startedAt;
        const recoverableWindowsControlExit = this.platform === 'win32' && code === WINDOWS_CONTROL_C_EXIT;
        const unrecoverableExitCode = code > 1 && !recoverableWindowsControlExit;
        if (unrecoverableExitCode || uptime < this.minAutoRestartUptimeMs || this._autoRestartCount >= this.maxAutoRestarts) {
            this.state = 'failed';
            this.readinessStage = 'failed';
            this.retryable = true;
            this._recordStartupEvidence('failure');
            logoutAgent(this.name);
            this._notifyStatus();
            return;
        }

        if (recoverableWindowsControlExit) {
            console.warn(`Agent ${this.name} received an unexpected Windows control event; attempting bounded recovery.`);
        }
        this._autoRestartCount += 1;
        this.state = 'restarting';
        this.readinessStage = 'restarting';
        this.retryable = false;
        logoutAgent(this.name);
        this._notifyStatus();
        this._startRestart().catch((error) => {
            this._failProcess(error);
        });
    }

    _startRestart() {
        return this.start(true, 'Agent process restarted.', this.count_id);
    }

    _createRestartDeferred() {
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        promise.catch(() => {});
        return { promise, resolve, reject };
    }

    _finishRestart(result, error = null) {
        if (!this._restartDeferred) return;
        const deferred = this._restartDeferred;
        this._restartDeferred = null;
        if (error) {
            this.state = 'failed';
            this.readinessStage = 'failed';
            this.retryable = true;
            this.lastError = this._describeError(error);
            this._recordStartupEvidence('failure');
            deferred.reject(error);
            return;
        }
        deferred.resolve(result);
    }

    _cancelRestart(error) {
        if (this._restartTerminationTimer) clearTimeout(this._restartTerminationTimer);
        this._restartTerminationTimer = null;
        if (!this._restartDeferred) return;
        const deferred = this._restartDeferred;
        this._restartDeferred = null;
        deferred.reject(error);
    }

    _failStart(error) {
        this._failProcess(error);
        return Promise.reject(error);
    }

    _beginExitWait(agentProcess) {
        let resolve;
        const promise = new Promise((resolvePromise) => {
            resolve = resolvePromise;
        });
        this._exitWait = { promise, resolve };
        this._exitWaitProcess = agentProcess;
    }

    _beginReadyWait(agentProcess, timeoutMs) {
        if (this._readyWait) {
            this._settleReadyWait(
                this._readyWait.process,
                new Error(`Agent '${this.name}' startup was replaced by a newer attempt.`),
            );
        }
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        promise.catch(() => {});
        const boundedTimeout = Math.max(
            MIN_READY_TIMEOUT_MS,
            Math.min(MAX_READY_TIMEOUT_MS, Number(timeoutMs) || this.readyTimeoutMs),
        );
        const timeout = setTimeout(() => {
            if (this._readyWait?.process !== agentProcess || this._readyWait.settled) return;
            const error = new Error(
                `Agent '${this.name}' did not become world-ready within ${Math.ceil(boundedTimeout / 1000)} seconds.`,
            );
            this._startupFailure = { process: agentProcess, error };
            this._settleReadyWait(agentProcess, error);
            this._failProcess(error, true);
            if (!agentProcess.killed) {
                try { agentProcess.kill('SIGINT'); } catch { /* exit handler retains the startup failure */ }
            }
            const cleanupTimer = setTimeout(() => {
                if (this.process === agentProcess) void this.terminateProcessTree(agentProcess);
            }, 5_000);
            cleanupTimer.unref?.();
        }, boundedTimeout);
        this._readyWait = { process: agentProcess, promise, resolve, reject, timeout, settled: false };
        return promise;
    }

    _settleReadyWait(agentProcess, error = null) {
        const wait = this._readyWait;
        if (!wait || wait.process !== agentProcess || wait.settled) return false;
        wait.settled = true;
        clearTimeout(wait.timeout);
        this._readyWait = null;
        if (error) wait.reject(error);
        else wait.resolve(this);
        return true;
    }

    _resolveExitWait(agentProcess) {
        if (this._exitWaitProcess !== agentProcess || !this._exitWait) return;
        const wait = this._exitWait;
        this._exitWait = null;
        this._exitWaitProcess = null;
        wait.resolve();
    }

    _failProcess(error, retainProcess = false) {
        const activeProcess = this.process;
        if (activeProcess) this._settleReadyWait(activeProcess, error);
        this.running = false;
        this.state = 'failed';
        this.readinessStage = 'failed';
        this.retryable = true;
        this.lastError = this._describeError(error);
        this._recordStartupEvidence('failure');
        if (!retainProcess) this.process = null;
        this._restartRequested = false;
        this._stopRequested = false;
        logoutAgent(this.name);
        this._notifyStatus();
        this._finishRestart(null, error);
    }

    _notifyStatus() {
        this.notifyStatus();
    }

    _describeError(error) {
        return error && error.message ? error.message : String(error);
    }
}
