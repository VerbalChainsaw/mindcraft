import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import process from 'node:process';
import { broadcastAgentStatus, logoutAgent } from '../mindcraft/mindserver.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));
const MIN_AUTO_RESTART_UPTIME_MS = 10000;
const MAX_AUTO_RESTARTS = 3;

export class AgentProcess {
    constructor(name, port, {
        spawnChild = spawn,
        now = Date.now,
        minAutoRestartUptimeMs = MIN_AUTO_RESTART_UPTIME_MS,
        maxAutoRestarts = MAX_AUTO_RESTARTS,
        notifyStatus = broadcastAgentStatus,
    } = {}) {
        this.name = name;
        this.port = port;
        this.spawnChild = spawnChild;
        this.now = now;
        this.minAutoRestartUptimeMs = minAutoRestartUptimeMs;
        this.maxAutoRestarts = maxAutoRestarts;
        this.notifyStatus = notifyStatus;
        this.state = 'idle';
        this.lastError = null;
        this.running = false;
        this.process = null;
        this._autoRestartCount = 0;
        this._restartRequested = false;
        this._stopRequested = false;
        this._restartDeferred = null;
        this._startedAt = null;
        this._exitWait = null;
        this._exitWaitProcess = null;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        this.count_id = count_id;
        this.running = false;
        this.state = 'starting';
        this.lastError = null;
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
                stdio: 'inherit',
                stderr: 'inherit',
            });
        } catch (error) {
            return this._failStart(error);
        }

        this.process = agentProcess;
        this._beginExitWait(agentProcess);
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error) => {
                if (settled || agentProcess !== this.process) return;
                settled = true;
                this._failProcess(error);
                this._resolveExitWait(agentProcess);
                reject(error);
            };

            agentProcess.once('spawn', () => {
                if (settled || agentProcess !== this.process) return;
                settled = true;
                if (this._stopRequested) {
                    this.running = false;
                    this.state = 'stopped';
                    logoutAgent(this.name);
                    this._notifyStatus();
                    reject(new Error('Agent startup stopped before becoming ready'));
                    return;
                }
                this.running = true;
                this.state = 'running';
                this._startedAt = this.now();
                this._notifyStatus();
                resolve(this);
            });
            agentProcess.on('error', (error) => {
                if (!settled) {
                    fail(error);
                    return;
                }
                if (agentProcess !== this.process) return;
                this._failProcess(error, true);
            });
            agentProcess.once('exit', (code, signal) => {
                this._handleExit(agentProcess, code, signal);
            });
        });
    }

    stop() {
        if (!this.process) return false;
        this._restartRequested = false;
        this._finishRestart(null);
        this._stopRequested = true;
        this.state = 'stopping';
        if (this.process.killed) return false;
        return this.process.kill('SIGINT');
    }

    waitForExit() {
        return this._exitWait ? this._exitWait.promise : Promise.resolve();
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
        this._restartDeferred = this._createRestartDeferred();
        const restartPromise = this._restartDeferred.promise;
        if (this.process.killed) {
            this._failProcess(new Error('Agent process is still stopping; wait for it to exit before restarting'), true);
            return restartPromise;
        }
        if (!this.process.kill('SIGINT')) {
            this._failProcess(new Error('Unable to send SIGINT to agent process; restart requires child exit'), true);
        }
        return restartPromise;
    }

    isActive() {
        return this.process !== null || ['starting', 'running', 'stopping', 'restarting'].includes(this.state);
    }

    _handleExit(agentProcess, code, signal) {
        if (agentProcess !== this.process) return;

        console.log(`Agent process exited with code ${code} and signal ${signal}`);
        this.running = false;

        const restartRequested = this._restartRequested;
        const stopRequested = this._stopRequested;
        this._restartRequested = false;
        this._stopRequested = false;
        this.process = null;
        this._resolveExitWait(agentProcess);

        if (restartRequested) {
            this.state = 'restarting';
            logoutAgent(this.name);
            this._notifyStatus();
            this._startRestart().then(
                (result) => this._finishRestart(result),
                (error) => this._finishRestart(null, error),
            );
            return;
        }

        if (stopRequested || code === 0 || signal === 'SIGINT') {
            this.state = 'stopped';
            logoutAgent(this.name);
            this._notifyStatus();
            return;
        }

        this.lastError = `Agent process exited with code ${code} and signal ${signal}`;
        const uptime = this._startedAt === null ? 0 : this.now() - this._startedAt;
        if (code > 1 || uptime < this.minAutoRestartUptimeMs || this._autoRestartCount >= this.maxAutoRestarts) {
            this.state = 'failed';
            logoutAgent(this.name);
            this._notifyStatus();
            return;
        }

        this._autoRestartCount += 1;
        this.state = 'restarting';
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
            this.lastError = this._describeError(error);
            deferred.reject(error);
            return;
        }
        deferred.resolve(result);
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

    _resolveExitWait(agentProcess) {
        if (this._exitWaitProcess !== agentProcess || !this._exitWait) return;
        const wait = this._exitWait;
        this._exitWait = null;
        this._exitWaitProcess = null;
        wait.resolve();
    }

    _failProcess(error, retainProcess = false) {
        this.running = false;
        this.state = 'failed';
        this.lastError = this._describeError(error);
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
