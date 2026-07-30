import { io } from 'socket.io-client';
import convoManager from './conversation.js';
import { setSettings } from './settings.js';
import { getFullState } from './library/full_state.js';

const STATE_PUSH_DEBOUNCE_MS = 80;
const STATE_PUSH_HEARTBEAT_MS = 1_000;

function stateFingerprint(state) {
    return JSON.stringify(state, (key, value) => (
        ['timeOfDay', 'sampledAt'].includes(key) ? undefined : value
    ));
}

// agent's individual connection to the mindserver
// always connect to localhost

class MindServerProxy {
    constructor() {
        if (MindServerProxy.instance) {
            return MindServerProxy.instance;
        }
        
        this.socket = null;
        this.connected = false;
        this.connectPromise = null;
        this.settingsLoaded = false;
        this.agents = [];
        this.stateStreamDemanded = false;
        this.statePushTimer = null;
        this.stateHeartbeatTimer = null;
        this.stateListeners = [];
        this.stateSequence = 0;
        this.lastStateFingerprint = '';
        this.lastCheapState = '';
        this.forceNextStatePush = false;
        MindServerProxy.instance = this;
    }

    async connect(name, port, connectionToken) {
        if (typeof connectionToken !== 'string' || connectionToken.length < 16) {
            throw new Error('MindServer agent capability is missing or invalid.');
        }
        if (this.connected && this.socket?.connected) return;
        if (this.connectPromise) return this.connectPromise;

        const operation = this._connect(name, port, connectionToken);
        this.connectPromise = operation;
        try {
            await operation;
        } finally {
            if (this.connectPromise === operation) this.connectPromise = null;
        }
    }

    async _connect(name, port, connectionToken) {
        if (this.socket) this._disposeSocket(this.socket);
        this.name = name;
        const socket = io(`http://localhost:${port}`, {
            auth: {
                role: 'agent',
                agentName: name,
                token: connectionToken,
            },
            reconnection: false,
            timeout: 5000,
        });
        this.socket = socket;
        this.settingsLoaded = false;

        socket.on('disconnect', () => {
            if (this.socket !== socket) return;
            console.log('Disconnected from MindServer');
            this.connected = false;
            this.settingsLoaded = false;
            this.socket = null;
            if (this.agent) {
                this.agent.cleanKill('Disconnected from MindServer. Killing agent process.');
            }
        });

        socket.on('chat-message', (agentName, json) => {
            convoManager.receiveFromBot(agentName, json);
        });

        socket.on('agents-status', (agents) => {
            const nextAgents = Array.isArray(agents) ? agents : [];
            this.agents = nextAgents;
            convoManager.updateAgents(nextAgents);
            if (this.agent?.task) {
                console.log(this.agent.name, 'updating available agents');
                this.agent.task.updateAvailableAgents(nextAgents);
            }
        });

        socket.on('send-message', (data) => {
            try {
                if (!this.agent?.respondFunc) throw new Error('Agent runtime is not ready for messages.');
                this.agent.respondFunc(data?.from, data?.message);
            } catch (error) {
                console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
        });

        socket.on('squad-radio', (data) => {
            try {
                const sender = typeof data?.from === 'string' ? data.from : '';
                const message = typeof data?.message === 'string' ? data.message : '';
                if (sender && message) {
                    if (!this.agent) throw new Error('Agent runtime is not ready for squad radio.');
                    const normalizedKind = String(data?.kind || 'order').toLowerCase();
                    const eventType = {
                        order: 'squad.order',
                        warning: 'squad.warning',
                        request: 'squad.request',
                        completion: 'squad.completion',
                        complete: 'squad.completion',
                    }[normalizedKind];
                    if (eventType) {
                        this.agent.publishBehaviorEvent?.({
                            id: typeof data?.eventId === 'string' ? data.eventId : undefined,
                            type: eventType,
                            target: { name: sender },
                            evidence: { code: normalizedKind },
                            salience: normalizedKind === 'warning' ? 5 : normalizedKind === 'completion' || normalizedKind === 'complete' ? 4 : 3,
                            witnesses: [this.agent.name, ...convoManager.getInGameAgents()],
                        });
                    }
                    if (sender === 'Director') this.agent.handleMessage(sender, `[SQUAD RADIO · ${String(data?.kind || 'order').toUpperCase()}] ${message}`);
                    else convoManager.receiveSquadRadio(sender, message, data?.kind);
                }
            } catch (error) {
                console.error('Error handling squad radio:', error);
            }
        });

        socket.on('get-full-state', (callback) => {
            if (typeof callback !== 'function') return;
            try {
                if (!this.agent) {
                    callback({ error: 'agent runtime not ready' });
                    return;
                }
                callback(getFullState(this.agent));
            } catch (error) {
                console.error('Error getting full state:', error);
                callback({ error: String(error?.message || error || 'state collection failed').slice(0, 240) });
            }
        });

        socket.on('state-stream-demand', (enabled) => {
            if (this.socket !== socket) return;
            this.stateStreamDemanded = enabled === true;
            if (this.stateStreamDemanded) this.requestStatePush({ force: true, immediate: true });
            else if (this.statePushTimer) {
                clearTimeout(this.statePushTimer);
                this.statePushTimer = null;
            }
        });

        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                const finish = (error = null) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    socket.off('connect', onConnect);
                    socket.off('connect_error', onError);
                    if (error) reject(error);
                    else resolve();
                };
                const onConnect = () => finish();
                const onError = (error) => finish(error || new Error('MindServer connection failed.'));
                const timeout = setTimeout(
                    () => finish(new Error('MindServer connection timed out after 5 seconds.')),
                    5000,
                );
                socket.once('connect', onConnect);
                socket.once('connect_error', onError);
                if (socket.connected) finish();
            });

            await new Promise((resolve, reject) => {
                let settled = false;
                const finish = (error = null) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (error) reject(error);
                    else resolve();
                };
                const timeout = setTimeout(
                    () => finish(new Error('Settings request timed out after 5 seconds.')),
                    5000,
                );
                try {
                    socket.emit('get-settings', name, (response) => {
                        try {
                            if (response?.error) {
                                finish(new Error(response.error));
                                return;
                            }
                            if (!response?.settings) {
                                finish(new Error('MindServer returned no agent settings.'));
                                return;
                            }
                            setSettings(response.settings);
                            this.settingsLoaded = true;
                            finish();
                        } catch (error) {
                            finish(error);
                        }
                    });
                } catch (error) {
                    finish(error);
                }
            });

            if (!socket.connected || this.socket !== socket) {
                throw new Error('MindServer disconnected during agent setup.');
            }
            this.connected = true;
            console.log(name, 'connected to MindServer');
        } catch (error) {
            if (this.socket === socket) this.socket = null;
            this.connected = false;
            this.settingsLoaded = false;
            this._disposeSocket(socket);
            throw error;
        }
    }

    _disposeSocket(socket) {
        if (!socket) return;
        if (socket === this.socket) this.stopStateStream();
        try { socket.removeAllListeners(); } catch { /* best effort */ }
        try { socket.disconnect(); } catch { /* best effort */ }
    }

    setAgent(agent) {
        this.agent = agent;
        if (this.settingsLoaded && this.socket?.connected && this.name) {
            this.socket.emit('connect-agent-process', this.name);
        }
    }

    getAgents() {
        return this.agents;
    }

    getNumOtherAgents() {
        return this.agents.length - 1;
    }

    login() {
        if (!this.socket?.connected || !this.agent?.name) return false;
        this.socket.emit('login-agent', this.agent.name);
        return true;
    }

    async ready() {
        const socket = this.socket;
        const agentName = this.agent?.name;
        if (!socket?.connected || !agentName) {
            throw new Error('MindServer bridge is unavailable during world-ready acknowledgement.');
        }
        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (error) reject(error);
                else resolve();
            };
            const timeout = setTimeout(
                () => finish(new Error('MindServer world-ready acknowledgement timed out after 5 seconds.')),
                5000,
            );
            try {
                socket.emit('ready-agent', agentName, (response) => {
                    if (!response?.success) {
                        finish(new Error(response?.error || 'MindServer rejected world-ready acknowledgement.'));
                        return;
                    }
                    finish();
                });
            } catch (error) {
                finish(error);
            }
        });
        return true;
    }

    startStateStream() {
        this.stopStateStream();
        const bot = this.agent?.bot;
        if (!bot?.on) return false;
        const markFromPhysics = () => {
            const position = bot.entity?.position;
            const cheap = [
                position ? Number(position.x).toFixed(1) : '',
                position ? Number(position.y).toFixed(1) : '',
                position ? Number(position.z).toFixed(1) : '',
                Number(bot.entity?.yaw || 0).toFixed(1),
                Number(bot.health || 0).toFixed(1),
                Number(bot.food || 0).toFixed(1),
                bot.heldItem?.name || '',
                this.agent?.actions?.currentActionLabel || '',
                this.agent?.isOperatorHeld?.() === true ? 'held' : '',
            ].join('|');
            if (cheap === this.lastCheapState) return;
            this.lastCheapState = cheap;
            this.requestStatePush();
        };
        const markChanged = () => this.requestStatePush();
        const bind = (event, handler) => {
            bot.on(event, handler);
            this.stateListeners.push({ event, handler });
        };
        bind('physicsTick', markFromPhysics);
        for (const event of [
            'health',
            'heldItemChanged',
            'playerCollect',
            'entitySpawn',
            'entityGone',
            'death',
            'respawn',
        ]) bind(event, markChanged);
        this.stateHeartbeatTimer = setInterval(() => {
            this.requestStatePush({ force: true });
        }, STATE_PUSH_HEARTBEAT_MS);
        if (typeof this.stateHeartbeatTimer.unref === 'function') this.stateHeartbeatTimer.unref();
        if (this.stateStreamDemanded) this.requestStatePush({ force: true, immediate: true });
        return true;
    }

    stopStateStream() {
        if (this.statePushTimer) clearTimeout(this.statePushTimer);
        if (this.stateHeartbeatTimer) clearInterval(this.stateHeartbeatTimer);
        this.statePushTimer = null;
        this.stateHeartbeatTimer = null;
        const bot = this.agent?.bot;
        for (const { event, handler } of this.stateListeners) {
            try { bot?.off?.(event, handler); } catch { /* best effort */ }
        }
        this.stateListeners = [];
        this.lastCheapState = '';
    }

    requestStatePush({ force = false, immediate = false } = {}) {
        if (!this.stateStreamDemanded || !this.agent || !this.socket?.connected) return false;
        this.forceNextStatePush ||= force;
        if (this.statePushTimer) return true;
        this.statePushTimer = setTimeout(() => {
            this.statePushTimer = null;
            if (!this.stateStreamDemanded || !this.agent || !this.socket?.connected) return;
            try {
                const state = getFullState(this.agent);
                const fingerprint = stateFingerprint(state);
                const mustSend = this.forceNextStatePush || fingerprint !== this.lastStateFingerprint;
                this.forceNextStatePush = false;
                if (!mustSend) return;
                this.lastStateFingerprint = fingerprint;
                this.stateSequence += 1;
                this.socket.volatile.emit('agent-state', {
                    sequence: this.stateSequence,
                    sentAt: Date.now(),
                    state,
                });
            } catch (error) {
                console.warn('[agent-state] Push failed:', error?.message || error);
            }
        }, immediate ? 0 : STATE_PUSH_DEBOUNCE_MS);
        if (typeof this.statePushTimer.unref === 'function') this.statePushTimer.unref();
        return true;
    }

    shutdown() {
        this.stopStateStream();
        if (!this.socket?.connected) return false;
        this.socket.emit('shutdown');
        return true;
    }

    getSocket() {
        return this.socket;
    }
}

// Create and export a singleton instance
export const serverProxy = new MindServerProxy();

// for chatting with other bots
export function sendBotChatToServer(agentName, json) {
    const socket = serverProxy.getSocket();
    if (!socket?.connected) return false;
    const message = String(json?.message || '').slice(0, 4096);
    if (!message) return false;
    socket.emit('chat-message', agentName, {
        message,
        start: json?.start === true,
        end: json?.end === true,
    });
    return true;
}

export function sendSquadRadio(message, kind = 'status') {
    return new Promise((resolve) => {
        const socket = serverProxy.getSocket();
        if (!socket?.connected) return resolve({ success: false, error: 'MindServer is not connected.' });
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(result || { success: false, error: 'Squad radio returned no response.' });
        };
        const timeout = setTimeout(
            () => finish({ success: false, error: 'Squad radio acknowledgement timed out after 5 seconds.' }),
            5000,
        );
        try {
            socket.emit('squad-radio', {
                message: String(message || '').slice(0, 1200),
                kind: String(kind || 'status').slice(0, 24),
            }, finish);
        } catch (error) {
            finish({ success: false, error: String(error?.message || error || 'Squad radio failed.').slice(0, 240) });
        }
    });
}

// for sending general output to server for display
export function sendOutputToServer(agentName, message) {
    const socket = serverProxy.getSocket();
    if (!socket?.connected) return false;
    const output = String(message || '').slice(0, 16384);
    if (!output) return false;
    socket.emit('bot-output', agentName, output);
    return true;
}
