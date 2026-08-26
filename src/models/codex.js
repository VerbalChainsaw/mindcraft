import { spawn as spawnChild } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { terminateOwnedProcessTree } from '../mindcraft/process-tree.js';

export const CODEX_MODEL = 'gpt-5.6-luna';
const DEFAULT_TIMEOUT_SECONDS = 90;
const MIN_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 180;
const STARTUP_TIMEOUT_MS = 15_000;
const INTERRUPT_GRACE_MS = 1_500;
// Windows can retain a just-terminated app-server's working-directory handle
// briefly after process exit. This settlement window is owned by provider
// disposal: exceeding it means isolated runtime cleanup is not trustworthy.
const TEMP_CLEANUP_SETTLEMENT_MS = 2_000;
const TEMP_CLEANUP_RETRY_MS = 100;
const SECRET_ENV_NAMES = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'];
const TEXT_ONLY_INSTRUCTIONS = [
    'You are a text-only response model embedded in a Minecraft companion.',
    'Never call tools, inspect files, execute commands, browse, or modify anything.',
    'Use only the instructions and conversation supplied by the client.',
    'Return only the final assistant message text.',
].join(' ');

export class CodexProviderError extends Error {
    constructor(message, code = 'CODEX_ERROR', options = {}) {
        super(message, options);
        this.name = 'CodexProviderError';
        this.code = code;
    }
}

function boundedTimeoutSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_TIMEOUT_SECONDS;
    return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, numeric));
}

function normalizedReasoningEffort(value) {
    if (value === undefined || value === null || value === '') return null;
    const effort = String(value).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(effort)) {
        throw new CodexProviderError('Codex reasoning effort must be a short named effort such as "low" or "medium".', 'INVALID_CONFIG');
    }
    return effort;
}

function sanitizedChildEnv(source = process.env) {
    const env = { ...source };
    for (const name of SECRET_ENV_NAMES) delete env[name];
    return env;
}

function sanitizeDetail(value) {
    return String(value || '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]')
        .replace(/\b(api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function actionableError(error, model = CODEX_MODEL) {
    if (error instanceof CodexProviderError && [
        'CANCELLED',
        'DISPOSED',
        'TIMEOUT',
        'MODEL_UNAVAILABLE',
        'AUTH_REQUIRED',
        'QUOTA',
        'CLI_UNAVAILABLE',
        'APP_SERVER_UNSUPPORTED',
    ].includes(error.code)) return error;

    const detail = sanitizeDetail(error?.message || error);
    if (/login|log in|unauthori[sz]ed|authentication|not authenticated|401/i.test(detail)) {
        return new CodexProviderError(
            'Codex ChatGPT login is unavailable. Run "codex login", confirm "codex login status", then restart the agent.',
            'AUTH_REQUIRED',
        );
    }
    if (/quota|usage limit|rate limit|too many requests|429/i.test(detail)) {
        return new CodexProviderError('Codex quota or rate limit was reached. Check the logged-in ChatGPT account and retry later.', 'QUOTA');
    }
    if (/model|not found|does not exist|unsupported/i.test(detail) && detail.includes(model)) {
        return new CodexProviderError(
            `Codex model "${model}" is unavailable for the logged-in ChatGPT account. This provider requires that exact model and did not fall back.`,
            'MODEL_UNAVAILABLE',
        );
    }
    return new CodexProviderError(
        detail ? `Codex provider failed: ${detail}` : 'Codex provider failed without a diagnostic.',
        error?.code || 'CODEX_ERROR',
    );
}

function protocolUnsupported(error) {
    if (error?.code === 'APP_SERVER_UNSUPPORTED') return true;
    if (error?.rpcCode === -32601) return true;
    return /method not found|unknown method|unrecognized subcommand|unexpected argument.*app-server|app-server.*not (?:available|supported)/i
        .test(String(error?.message || ''));
}

export function resolveCodexCommand({ platform = process.platform, env = process.env } = {}) {
    if (platform !== 'win32') return { command: 'codex', prefixArgs: [] };

    const pathEntries = String(env.PATH || env.Path || '')
        .split(path.delimiter)
        .map(entry => entry.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    for (const entry of pathEntries) {
        const nativeExecutable = path.join(entry, 'codex.exe');
        if (existsSync(nativeExecutable)) return { command: nativeExecutable, prefixArgs: [] };

        // npm's Windows codex shim is a .cmd/.ps1 file, which cannot be launched
        // directly without a shell. Launch its JavaScript entry point with the
        // current Node executable instead. Require the actual PATH shim: an
        // unrelated directory can contain a stale node_modules package without
        // exposing it as the `codex` command.
        const npmEntryPoint = path.join(entry, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
        const npmShimExists = existsSync(path.join(entry, 'codex.cmd'))
            || existsSync(path.join(entry, 'codex.ps1'));
        if (npmShimExists && existsSync(npmEntryPoint)) {
            return { command: process.execPath, prefixArgs: [npmEntryPoint] };
        }
    }
    return { command: 'codex.exe', prefixArgs: [] };
}

function isLive(child) {
    return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function makeConversationPrompt(turns, systemMessage) {
    const transcript = (Array.isArray(turns) ? turns : []).map((turn) => ({
        role: typeof turn?.role === 'string' ? turn.role : 'user',
        content: typeof turn?.content === 'string' ? turn.content : JSON.stringify(turn?.content ?? ''),
    }));
    return [
        TEXT_ONLY_INSTRUCTIONS,
        'SYSTEM INSTRUCTIONS:',
        String(systemMessage || ''),
        'AUTHORITATIVE MINDCRAFT CONVERSATION (JSON):',
        JSON.stringify(transcript),
        'Respond as the assistant to the current request. Do not continue or persist a separate conversation.',
    ].join('\n\n');
}

export class Codex {
    static get prefix() { return 'codex'; }

    constructor(modelName, _url, params = {}, dependencies = {}) {
        const selectedModel = typeof modelName === 'string' ? modelName.trim() : '';
        if (!selectedModel) {
            throw new CodexProviderError(
                'Codex provider requires a model name.',
                'MODEL_UNAVAILABLE',
            );
        }
        this.model_name = selectedModel;
        this.timeoutMs = boundedTimeoutSeconds(params?.timeout ?? params?.timeout_seconds) * 1000;
        this.reasoningEffort = normalizedReasoningEffort(
            params?.reasoning_effort ?? params?.reasoningEffort ?? params?.effort,
        );
        this._spawn = dependencies.spawn || spawnChild;
        this._terminate = dependencies.terminateProcessTree || terminateOwnedProcessTree;
        this._platform = dependencies.platform || process.platform;
        this._baseEnv = dependencies.env || process.env;
        this._command = dependencies.command || resolveCodexCommand({ platform: this._platform, env: this._baseEnv });

        this._mode = 'app-server';
        this._child = null;
        this._execChild = null;
        this._auxChild = null;
        this._tempDir = null;
        this._tempPromise = null;
        this._startPromise = null;
        this._startAttempts = 0;
        this._requestId = 0;
        this._rpcPending = new Map();
        this._stdoutBuffer = '';
        this._stderr = '';
        this._initialized = false;
        this._activeTurn = null;
        this._queue = [];
        this._activeJob = null;
        this._drainPromise = null;
        this._disposed = false;
        this._disposePromise = null;
    }

    _ensureTempDir() {
        if (this._tempDir) return this._tempDir;
        if (!this._tempPromise) {
            this._tempPromise = mkdtemp(path.join(os.tmpdir(), 'mindcraft-codex-'))
                .then(directory => {
                    this._tempDir = directory;
                    return directory;
                });
        }
        return this._tempPromise;
    }

    _spawnCodex(args, options = {}) {
        const child = this._spawn(
            this._command.command,
            [...this._command.prefixArgs, ...args],
            {
                ...options,
                env: sanitizedChildEnv(this._baseEnv),
                shell: false,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        return child;
    }

    async preflight() {
        if (this._disposed) throw new CodexProviderError('Codex provider is disposed.', 'DISPOSED');
        const appServerReady = await this._ensureAppServer();
        if (!appServerReady) await this._verifyExecLogin();
        return true;
    }

    _ensureAppServer() {
        if (this._mode === 'exec') return false;
        if (isLive(this._child) && this._initialized) return true;
        if (this._startPromise) return this._startPromise;
        if (this._startAttempts >= 2) {
            throw new CodexProviderError(
                'Codex app-server exited after its single restart. Restart the Mindcraft agent after checking Codex login and model access.',
                'APP_SERVER_EXIT',
            );
        }
        this._startAttempts += 1;
        this._startPromise = this._startAppServer()
            .catch(async (error) => {
                await this._stopAppServer();
                if (protocolUnsupported(error)) {
                    this._mode = 'exec';
                    return false;
                }
                throw actionableError(error, this.model_name);
            })
            .finally(() => {
                this._startPromise = null;
            });
        return this._startPromise;
    }

    async _startAppServer() {
        const cwd = await this._ensureTempDir();
        this._stdoutBuffer = '';
        this._stderr = '';
        this._initialized = false;

        let child;
        try {
            child = this._spawnCodex([
                'app-server', '--listen', 'stdio://',
                '-c', 'mcp_servers={}',
            ], { cwd });
        } catch (error) {
            throw new CodexProviderError(`Codex CLI could not be started: ${sanitizeDetail(error?.message || error)}`, 'CLI_UNAVAILABLE');
        }
        this._child = child;
        child.stdout?.setEncoding?.('utf8');
        child.stderr?.setEncoding?.('utf8');
        child.stdout?.on('data', chunk => this._consumeAppStdout(child, chunk));
        child.stderr?.on('data', chunk => {
            if (this._child === child) this._stderr = `${this._stderr}${chunk}`.slice(-8_000);
        });
        child.once?.('error', error => this._handleAppExit(child, null, null, error));
        child.once?.('exit', (code, signal) => this._handleAppExit(child, code, signal));

        await this._rpc('initialize', {
            clientInfo: { name: 'mindcraft-codex-provider', version: '1.0.0' },
            // Environment suppression and empty capability roots are guarded
            // experimental fields in codex-cli 0.145.0.
            capabilities: { experimentalApi: true },
        }, STARTUP_TIMEOUT_MS, true);
        this._writeAppMessage({ method: 'initialized', params: {} });
        await this._verifyExactModel();
        this._initialized = true;
        return true;
    }

    async _verifyExactModel() {
        let cursor = null;
        let found = false;
        do {
            const result = await this._rpc('model/list', {
                cursor,
                includeHidden: true,
                limit: 100,
            }, STARTUP_TIMEOUT_MS, true);
            found = Array.isArray(result?.data)
                && result.data.some(entry => entry?.model === this.model_name);
            cursor = result?.nextCursor || null;
        } while (!found && cursor);

        if (!found) {
            throw new CodexProviderError(
                `Codex model "${this.model_name}" is unavailable for the logged-in ChatGPT account. This provider requires that exact model and did not fall back.`,
                'MODEL_UNAVAILABLE',
            );
        }
    }

    _consumeAppStdout(child, chunk) {
        if (this._child !== child) return;
        this._stdoutBuffer += String(chunk);
        let newline;
        while ((newline = this._stdoutBuffer.indexOf('\n')) !== -1) {
            const line = this._stdoutBuffer.slice(0, newline).trim();
            this._stdoutBuffer = this._stdoutBuffer.slice(newline + 1);
            if (!line) continue;
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                const error = new CodexProviderError(
                    'Codex app-server did not use the installed JSONL protocol.',
                    this._initialized ? 'PROTOCOL_ERROR' : 'APP_SERVER_UNSUPPORTED',
                );
                this._rejectProtocolWaiters(error);
                void this._stopAppServer();
                continue;
            }
            this._handleAppMessage(message);
        }
    }

    _handleAppMessage(message) {
        if (Object.hasOwn(message || {}, 'id') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
            const pending = this._rpcPending.get(String(message.id));
            if (!pending) return;
            this._rpcPending.delete(String(message.id));
            clearTimeout(pending.timer);
            if (message.error) {
                const detail = sanitizeDetail(message.error?.message || 'JSONL request failed.');
                const error = new CodexProviderError(detail || 'Codex app-server request failed.', 'RPC_ERROR');
                error.rpcCode = message.error?.code;
                pending.reject(error);
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        if (Object.hasOwn(message || {}, 'id') && typeof message.method === 'string') {
            // This client never supplies approval, tool, token-refresh, or file services.
            this._writeAppMessage({
                id: message.id,
                error: { code: -32601, message: 'Mindcraft text provider does not service server requests.' },
            });
            return;
        }

        const state = this._activeTurn;
        if (!state || typeof message?.method !== 'string') return;
        const params = message.params || {};
        if (params.threadId !== state.threadId) return;
        const eventTurnId = params.turnId || params.turn?.id || null;
        if (state.turnId && eventTurnId && eventTurnId !== state.turnId) return;
        if (!state.turnId && eventTurnId) state.observedTurnId = eventTurnId;

        if (message.method === 'item/completed') {
            this._collectAgentMessage(state, params.item);
        } else if (message.method === 'item/started' && this._isToolItem(params.item)) {
            state.securityViolation = true;
            void this._interruptTurnWithGrace(
                state,
                new CodexProviderError('Codex attempted a tool operation in text-only mode; the turn was interrupted.', 'TOOL_ACCESS_BLOCKED'),
            );
        } else if (message.method === 'turn/completed') {
            for (const item of params.turn?.items || []) this._collectAgentMessage(state, item);
            this._finishTurn(state, params.turn);
        }
    }

    _isToolItem(item) {
        return Boolean(item?.type && ![
            'userMessage',
            'agentMessage',
            'reasoning',
            'plan',
            'hookPrompt',
            'contextCompaction',
        ].includes(item.type));
    }

    _collectAgentMessage(state, item) {
        if (item?.type !== 'agentMessage' || typeof item.text !== 'string') return;
        const key = typeof item.id === 'string' ? item.id : `message-${state.messages.size}`;
        state.messages.set(key, item.text);
    }

    _finishTurn(state, turn) {
        if (state.settled || this._activeTurn !== state) return;
        if (state.timedOut) {
            state.reject(new CodexProviderError(`Codex request timed out after ${this.timeoutMs / 1000} seconds.`, 'TIMEOUT'));
            return;
        }
        if (state.cancelRequested) {
            state.reject(new CodexProviderError('Codex request was cancelled.', 'CANCELLED'));
            return;
        }
        if (state.securityViolation) {
            state.reject(new CodexProviderError('Codex attempted a tool operation in text-only mode; no tool output was accepted.', 'TOOL_ACCESS_BLOCKED'));
            return;
        }
        if (turn?.status !== 'completed') {
            const turnError = turn?.error?.message || `turn ended with status "${turn?.status || 'unknown'}"`;
            state.reject(actionableError(new CodexProviderError(sanitizeDetail(turnError), 'TURN_FAILED'), this.model_name));
            return;
        }
        const text = [...state.messages.values()].filter(Boolean).join('\n').trim();
        if (!text) {
            state.reject(new CodexProviderError('Codex completed the turn without a completed agent message.', 'EMPTY_RESPONSE'));
            return;
        }
        state.resolve(text);
    }

    _createTurnState(threadId) {
        const state = {
            threadId,
            turnId: null,
            observedTurnId: null,
            messages: new Map(),
            settled: false,
            timedOut: false,
            cancelRequested: false,
            securityViolation: false,
            timer: null,
        };
        state.promise = new Promise((resolve, reject) => {
            state.resolve = (value) => {
                if (state.settled) return;
                state.settled = true;
                clearTimeout(state.timer);
                if (this._activeTurn === state) this._activeTurn = null;
                resolve(value);
            };
            state.reject = (error) => {
                if (state.settled) return;
                state.settled = true;
                clearTimeout(state.timer);
                if (this._activeTurn === state) this._activeTurn = null;
                reject(error);
            };
        });
        this._activeTurn = state;
        return state;
    }

    _armTurnTimeout(state) {
        state.timer = setTimeout(() => {
            state.timedOut = true;
            void this._interruptTurnWithGrace(
                state,
                new CodexProviderError(`Codex request timed out after ${this.timeoutMs / 1000} seconds.`, 'TIMEOUT'),
            );
        }, this.timeoutMs);
    }

    async _interruptTurnWithGrace(state, terminalError) {
        if (!state || state.settled) return;
        if (state.threadId && (state.turnId || state.observedTurnId) && isLive(this._child)) {
            try {
                await this._rpc('turn/interrupt', {
                    threadId: state.threadId,
                    turnId: state.turnId || state.observedTurnId,
                }, 2_000);
            } catch {
                // A bounded process-tree shutdown below is the final cancellation path.
            }
        }
        await Promise.race([state.promise.catch(() => undefined), delay(INTERRUPT_GRACE_MS)]);
        if (!state.settled) {
            await this._stopAppServer();
            state.reject(terminalError);
        }
    }

    _writeAppMessage(message) {
        if (!isLive(this._child) || !this._child.stdin?.writable) {
            throw new CodexProviderError('Codex app-server is not running.', 'APP_SERVER_EXIT');
        }
        this._child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    _rpc(method, params, timeoutMs = this.timeoutMs, unsupportedOnTimeout = false) {
        const id = ++this._requestId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._rpcPending.delete(String(id));
                reject(new CodexProviderError(
                    `Codex app-server did not answer ${method} within ${timeoutMs / 1000} seconds.`,
                    unsupportedOnTimeout ? 'APP_SERVER_UNSUPPORTED' : 'TIMEOUT',
                ));
            }, timeoutMs);
            this._rpcPending.set(String(id), { resolve, reject, timer });
            try {
                this._writeAppMessage({ id, method, params });
            } catch (error) {
                clearTimeout(timer);
                this._rpcPending.delete(String(id));
                reject(error);
            }
        });
    }

    _handleAppExit(child, code, signal, spawnError = null) {
        if (this._child !== child) return;
        this._child = null;
        const detail = sanitizeDetail(spawnError?.message || this._stderr);
        let error;
        if (spawnError?.code === 'ENOENT') {
            error = new CodexProviderError('Codex CLI was not found. Install Codex CLI and restart the agent.', 'CLI_UNAVAILABLE');
        } else if (!this._initialized) {
            error = actionableError(new CodexProviderError(
                detail || `Codex app-server exited during startup (${code ?? signal ?? 'unknown'}).`,
                /unrecognized|unexpected argument|app-server/i.test(detail) ? 'APP_SERVER_UNSUPPORTED' : 'APP_SERVER_START_FAILED',
            ), this.model_name);
        } else {
            error = new CodexProviderError(
                `Codex app-server exited unexpectedly (${code ?? signal ?? 'unknown'}). The provider will attempt at most one lazy restart.`,
                'APP_SERVER_EXIT',
            );
        }
        this._initialized = false;
        this._rejectProtocolWaiters(error);
    }

    _rejectProtocolWaiters(error) {
        for (const pending of this._rpcPending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this._rpcPending.clear();
        if (this._activeTurn && !this._activeTurn.settled) {
            const state = this._activeTurn;
            if (state.timedOut) state.reject(new CodexProviderError(`Codex request timed out after ${this.timeoutMs / 1000} seconds.`, 'TIMEOUT'));
            else if (state.cancelRequested) state.reject(new CodexProviderError('Codex request was cancelled.', 'CANCELLED'));
            else if (state.securityViolation) state.reject(new CodexProviderError('Codex attempted a tool operation in text-only mode; no tool output was accepted.', 'TOOL_ACCESS_BLOCKED'));
            else state.reject(error);
        }
    }

    async _stopAppServer() {
        const child = this._child;
        this._child = null;
        this._initialized = false;
        if (!child) return;
        this._rejectProtocolWaiters(new CodexProviderError('Codex app-server was stopped.', 'APP_SERVER_EXIT'));
        try { child.stdin?.end?.(); } catch { /* process shutdown is authoritative */ }
        await this._terminate(child, { timeoutMs: 2_000 });
    }

    async _runAppRequest(turns, systemMessage) {
        const ready = await this._ensureAppServer();
        if (!ready) return this._runExecRequest(turns, systemMessage);
        const cwd = await this._ensureTempDir();
        const threadResult = await this._rpc('thread/start', {
            model: this.model_name,
            allowProviderModelFallback: false,
            cwd,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            ephemeral: true,
            environments: [],
            dynamicTools: [],
            runtimeWorkspaceRoots: [],
            selectedCapabilityRoots: [],
            baseInstructions: TEXT_ONLY_INSTRUCTIONS,
            developerInstructions: String(systemMessage || ''),
        });
        if (threadResult?.model !== this.model_name) {
            throw new CodexProviderError(
                `Codex selected "${threadResult?.model || 'unknown'}" instead of required "${this.model_name}". The turn was refused; no fallback is allowed.`,
                'MODEL_UNAVAILABLE',
            );
        }
        const threadId = threadResult?.thread?.id;
        if (!threadId) throw new CodexProviderError('Codex app-server did not return a thread id.', 'PROTOCOL_ERROR');

        const state = this._createTurnState(threadId);
        try {
            const turnResult = await this._rpc('turn/start', {
                threadId,
                input: [{ type: 'text', text: makeConversationPrompt(turns, '') }],
                model: this.model_name,
                ...(this.reasoningEffort ? { effort: this.reasoningEffort } : {}),
                approvalPolicy: 'never',
                environments: [],
                runtimeWorkspaceRoots: [],
                sandboxPolicy: { type: 'readOnly', networkAccess: false },
            });
            state.turnId = turnResult?.turn?.id || null;
            if (!state.turnId) throw new CodexProviderError('Codex app-server did not return a turn id.', 'PROTOCOL_ERROR');
            if (state.observedTurnId && state.observedTurnId !== state.turnId) {
                throw new CodexProviderError('Codex app-server returned mismatched turn identifiers.', 'PROTOCOL_ERROR');
            }
            if (!state.settled) this._armTurnTimeout(state);
            return await state.promise;
        } catch (error) {
            if (!state.settled) state.reject(error);
            // Observe the state rejection here so setup failures do not create an
            // unhandled rejection while the original actionable error propagates.
            await state.promise.catch(() => undefined);
            throw error;
        }
    }

    async _verifyExecLogin() {
        const cwd = await this._ensureTempDir();
        await new Promise((resolve, reject) => {
            let child;
            let timer = null;
            let output = '';
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (this._auxChild === child) this._auxChild = null;
                error ? reject(actionableError(error, this.model_name)) : resolve();
            };
            try {
                child = this._spawnCodex(['login', 'status'], { cwd });
                this._auxChild = child;
            } catch (error) {
                finish(new CodexProviderError(`Codex CLI could not be started: ${sanitizeDetail(error?.message || error)}`, 'CLI_UNAVAILABLE'));
                return;
            }
            timer = setTimeout(() => {
                void this._terminate(child, { timeoutMs: 2_000 });
                finish(new CodexProviderError('Codex login status timed out. Run "codex login status" manually.', 'AUTH_REQUIRED'));
            }, 10_000);
            child.stdout?.on('data', chunk => { output = `${output}${chunk}`.slice(-2_000); });
            child.stderr?.on('data', chunk => { output = `${output}${chunk}`.slice(-2_000); });
            child.once?.('error', error => finish(error));
            child.once?.('exit', code => {
                if (code === 0 && /logged in/i.test(output)) finish();
                else finish(new CodexProviderError('Codex ChatGPT login is unavailable. Run "codex login" and confirm "codex login status".', 'AUTH_REQUIRED'));
            });
        });
    }

    async _runExecRequest(turns, systemMessage) {
        const cwd = await this._ensureTempDir();
        const prompt = makeConversationPrompt(turns, systemMessage);
        return await new Promise((resolve, reject) => {
            let child;
            let stdoutBuffer = '';
            let stderr = '';
            let completed = false;
            let timedOut = false;
            let spawnError = null;
            let eventError = '';
            let timer = null;
            const messages = new Map();

            try {
                child = this._spawnCodex([
                    'exec',
                    '--ephemeral',
                    '--json',
                    '--sandbox', 'read-only',
                    '-C', cwd,
                    '-m', this.model_name,
                    ...(this.reasoningEffort
                        ? ['-c', `model_reasoning_effort="${this.reasoningEffort}"`]
                        : []),
                    '--skip-git-repo-check',
                    '--ignore-user-config',
                    '--ignore-rules',
                    '-',
                ], { cwd });
                this._execChild = child;
            } catch (error) {
                reject(actionableError(new CodexProviderError(`Codex CLI could not be started: ${sanitizeDetail(error?.message || error)}`, 'CLI_UNAVAILABLE')));
                return;
            }

            const consumeLine = (line) => {
                if (!line.trim()) return;
                let event;
                try { event = JSON.parse(line); } catch { return; }
                if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
                    messages.set(event.item.id || `message-${messages.size}`, event.item.text);
                } else if (event?.type === 'turn.completed') {
                    completed = true;
                } else if (event?.type === 'turn.failed' || event?.type === 'error') {
                    eventError = sanitizeDetail(event?.error?.message || event?.message || eventError);
                }
            };
            child.stdout?.setEncoding?.('utf8');
            child.stderr?.setEncoding?.('utf8');
            child.stdout?.on('data', chunk => {
                stdoutBuffer += String(chunk);
                let newline;
                while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
                    consumeLine(stdoutBuffer.slice(0, newline));
                    stdoutBuffer = stdoutBuffer.slice(newline + 1);
                }
            });
            child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8_000); });
            child.once?.('error', error => {
                spawnError = error;
                clearTimeout(timer);
                if (this._execChild === child) this._execChild = null;
                reject(actionableError(new CodexProviderError(
                    error?.code === 'ENOENT'
                        ? 'Codex CLI was not found. Install Codex CLI and restart the agent.'
                        : `Codex CLI could not be started: ${sanitizeDetail(error?.message || error)}`,
                    'CLI_UNAVAILABLE',
                ), this.model_name));
            });
            timer = setTimeout(() => {
                timedOut = true;
                void this._terminate(child, { timeoutMs: 2_000 });
            }, this.timeoutMs);
            child.once?.('exit', (code) => {
                clearTimeout(timer);
                if (this._execChild === child) this._execChild = null;
                consumeLine(stdoutBuffer);
                if (this._activeJob?.cancelled) {
                    reject(new CodexProviderError('Codex request was cancelled.', 'CANCELLED'));
                    return;
                }
                if (timedOut) {
                    reject(new CodexProviderError(`Codex request timed out after ${this.timeoutMs / 1000} seconds.`, 'TIMEOUT'));
                    return;
                }
                if (spawnError?.code === 'ENOENT') {
                    reject(new CodexProviderError('Codex CLI was not found. Install Codex CLI and restart the agent.', 'CLI_UNAVAILABLE'));
                    return;
                }
                if (code !== 0 || eventError) {
                    reject(actionableError(new CodexProviderError(eventError || sanitizeDetail(stderr) || `codex exec exited with code ${code}.`, 'EXEC_FAILED'), this.model_name));
                    return;
                }
                if (!completed) {
                    reject(new CodexProviderError('codex exec ended without turn.completed.', 'PROTOCOL_ERROR'));
                    return;
                }
                const text = [...messages.values()].filter(Boolean).join('\n').trim();
                if (!text) {
                    reject(new CodexProviderError('codex exec completed without an agent_message.', 'EMPTY_RESPONSE'));
                    return;
                }
                resolve(text);
            });
            child.stdin?.end?.(prompt);
        });
    }

    sendRequest(turns, systemMessage) {
        if (this._disposed) return Promise.reject(new CodexProviderError('Codex provider is disposed.', 'DISPOSED'));
        return new Promise((resolve, reject) => {
            const job = { turns, systemMessage, resolve, reject, cancelled: false, settled: false };
            this._queue.push(job);
            void this._drainQueue();
        });
    }

    _drainQueue() {
        if (this._drainPromise) return this._drainPromise;
        this._drainPromise = (async () => {
            while (this._queue.length > 0) {
                const job = this._queue.shift();
                if (job.cancelled) continue;
                this._activeJob = job;
                try {
                    const result = await this._runAppRequest(job.turns, job.systemMessage);
                    if (!job.cancelled && !job.settled) {
                        job.settled = true;
                        job.resolve(result);
                    }
                } catch (error) {
                    if (!job.settled) {
                        job.settled = true;
                        job.reject(actionableError(error, this.model_name));
                    }
                } finally {
                    if (this._activeJob === job) this._activeJob = null;
                }
            }
        })().finally(() => {
            this._drainPromise = null;
            if (this._queue.length > 0) void this._drainQueue();
        });
        return this._drainPromise;
    }

    cancelPending() {
        const cancellation = new CodexProviderError('Codex request was cancelled.', 'CANCELLED');
        let cancelled = 0;
        for (const job of this._queue.splice(0)) {
            job.cancelled = true;
            if (!job.settled) {
                job.settled = true;
                job.reject(cancellation);
                cancelled += 1;
            }
        }
        const job = this._activeJob;
        if (job && !job.cancelled) {
            job.cancelled = true;
            if (!job.settled) {
                job.settled = true;
                job.reject(cancellation);
            }
            cancelled += 1;
            if (this._activeTurn && !this._activeTurn.settled) {
                this._activeTurn.cancelRequested = true;
                void this._interruptTurnWithGrace(this._activeTurn, cancellation);
            } else if (this._execChild) {
                void this._terminate(this._execChild, { timeoutMs: 2_000 });
            } else if (this._child) {
                void this._stopAppServer();
            }
        }
        return cancelled;
    }

    embed() {
        return Promise.reject(new CodexProviderError('Codex OAuth provider does not support embeddings; use Mindcraft lexical ranking.', 'UNSUPPORTED_EMBEDDING'));
    }

    sendVisionRequest() {
        return Promise.reject(new CodexProviderError('Codex OAuth provider does not support vision requests.', 'UNSUPPORTED_VISION'));
    }

    dispose() {
        if (this._disposePromise) return this._disposePromise;
        this._disposed = true;
        this._disposePromise = (async () => {
            this.cancelPending();
            const children = [this._execChild, this._auxChild].filter(Boolean);
            this._execChild = null;
            this._auxChild = null;
            await Promise.all(children.map(child => this._terminate(child, { timeoutMs: 2_000 })));
            await this._stopAppServer();
            await this._drainPromise?.catch?.(() => undefined);
            if (this._tempDir) {
                await rm(this._tempDir, {
                    recursive: true,
                    force: true,
                    maxRetries: Math.ceil(TEMP_CLEANUP_SETTLEMENT_MS / TEMP_CLEANUP_RETRY_MS),
                    retryDelay: TEMP_CLEANUP_RETRY_MS,
                });
                this._tempDir = null;
            }
        })();
        return this._disposePromise;
    }
}
