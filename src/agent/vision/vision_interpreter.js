import { Vec3 } from 'vec3';
import { Camera } from "./camera.js";
import fs from 'node:fs/promises';
import { resolvePlayerTarget } from '../player-target.js';
import { getFullState } from '../library/full_state.js';

const CAMERA_READY_TIMEOUT_MS = 8_000;
const MINUTE_MS = 60_000;

export function buildVisionGrounding(agent, target = null, capturedAt = Date.now()) {
    const state = getFullState(agent, { deep: true });
    const perception = state.perception || {};
    const inFrame = entry => entry?.inView === true;
    return {
        capturedAt,
        authority: 'Minecraft protocol state is authoritative; image interpretation is advisory.',
        camera: {
            position: state.gameplay?.position || null,
            facing: state.body?.facing || null,
            yaw: state.body?.yaw ?? null,
            pitch: state.body?.pitch ?? null,
            target,
        },
        bodySpace: state.surroundings || null,
        protocolDetections: {
            status: perception.status || 'unknown',
            ageMs: perception.ageMs ?? null,
            entitiesLikelyInFrame: (perception.entities || []).filter(inFrame).slice(0, 12),
            hazardsLikelyInFrame: (perception.hazards || []).filter(inFrame).slice(0, 8),
            usefulBlocksLikelyInFrame: (perception.usefulBlocks || []).filter(inFrame).slice(0, 12),
            primaryThreat: perception.primaryThreat || null,
        },
        activeIntent: {
            assignedGoal: agent.self_prompter?.isStopped?.() === false
                ? String(agent.self_prompter?.prompt || '').slice(0, 500)
                : null,
            typedGoal: state.action?.goalDirector?.goal || null,
            causalPlan: state.action?.goalDirector?.plan || null,
            currentAction: state.action?.current || null,
        },
        learnedMethods: state.memory?.learnedOutcomes || [],
    };
}

export class VisionInterpreter {
    constructor(agent, allow_vision) {
        this.agent = agent;
        this.allow_vision = allow_vision === true;
        this.fp = './bots/'+agent.name+'/screenshots/';
        this.lastOutcome = null;
        this.inFlight = null;
        this.lastRequestAt = 0;
        const vision = agent.runtime?.vision || {};
        this.visionMode = vision.mode || (this.allow_vision ? 'hybrid' : 'off');
        this.maxRequestsPerMinute = Number.isInteger(vision.maxRequestsPerMinute)
            ? Math.max(0, vision.maxRequestsPerMinute)
            : 2;
        this.retainScreenshots = Number.isInteger(vision.retainScreenshots)
            ? Math.max(0, vision.retainScreenshots)
            : 12;
        if (this.allow_vision && this.visionMode !== 'off') {
            this.camera = new Camera(agent.bot, this.fp, {
                retainScreenshots: this.retainScreenshots,
            });
        }
    }

    _fallback() {
        return `Structured sensing remains available. ${this.getCenterBlockInfo()}`;
    }

    _record({ success, code, message, target = null, retryable = false }) {
        const recordedAt = Date.now();
        this.lastOutcome = { success, code, message, target, retryable, recordedAt };
        if (this.agent.bot) {
            this.agent.bot.lastActionEvidence = {
                kind: 'vision',
                outcome: code,
                target,
                retryable,
                recordedAt,
            };
        }
        return message;
    }

    _unavailable(code, message, target = null, retryable = false) {
        return this._record({
            success: false,
            code,
            message: `${message} ${this._fallback()}`,
            target,
            retryable,
        });
    }

    _requestDelayMs(now = Date.now()) {
        if (this.maxRequestsPerMinute <= 0) return Infinity;
        const minimumInterval = Math.ceil(MINUTE_MS / this.maxRequestsPerMinute);
        return Math.max(0, this.lastRequestAt + minimumInterval - now);
    }

    _validateRequest(target) {
        if (!this.allow_vision || this.visionMode === 'off') {
            return this._unavailable('vision_disabled', 'Vision is disabled for this bot profile.', target, false);
        }
        if (!this.agent.prompter?.vision_model?.sendVisionRequest) {
            return this._unavailable('vision_model_unavailable', 'No vision-capable model is connected.', target, false);
        }
        if (!this.camera) {
            return this._unavailable('camera_unavailable', 'The camera is not available.', target, true);
        }
        if (this.inFlight) {
            return this._unavailable('vision_busy', 'Another vision request is still running.', target, true);
        }
        const delay = this._requestDelayMs();
        if (delay === Infinity) {
            return this._unavailable('vision_rate_disabled', 'This profile disables model-vision requests.', target, false);
        }
        if (delay > 0) {
            const seconds = Math.ceil(delay / 1000);
            return this._unavailable('vision_rate_limited', `Vision is cooling down; try again in about ${seconds} second${seconds === 1 ? '' : 's'}.`, target, true);
        }
        return null;
    }

    async _runVision({ target, lookingMessage, aim }) {
        const unavailable = this._validateRequest(target);
        if (unavailable) return unavailable;

        this.lastRequestAt = Date.now();
        const request = (async () => {
            try {
                await this.camera.waitUntilReady(CAMERA_READY_TIMEOUT_MS);
                await aim();
                const capturedAt = Date.now();
                const filename = await this.camera.capture();
                const analysis = await this.analyzeImage(filename, { target, capturedAt });
                return this._record({
                    success: true,
                    code: 'analyzed',
                    target,
                    retryable: false,
                    message: `${lookingMessage}\nImage analysis (non-authoritative): "${analysis}"\n${this.getCenterBlockInfo()}`,
                });
            } catch (error) {
                const code = this.camera?.initError ? 'camera_unavailable' : 'vision_failed';
                console.warn(`[vision] ${code}: ${String(error?.message || error).slice(0, 512)}`);
                return this._unavailable(code, 'Vision could not complete; use structured sensing or retry.', target, true);
            }
        })();
        this.inFlight = request;
        try {
            return await request;
        } finally {
            if (this.inFlight === request) this.inFlight = null;
        }
    }

    lookAtPlayer(player_name, direction) {
        const bot = this.agent.bot;
        const resolution = resolvePlayerTarget(bot, player_name, {
            knownBotNames: this.agent.task?.agent_names || [],
        });
        const player = resolution.entity;
        if (!player) {
            return this._unavailable('lost_target', `Could not find player ${player_name}.`, {
                name: player_name,
                requestedName: resolution.requested,
                canonicalName: null,
                aliasesTried: resolution.aliasesTried,
            }, false);
        }
        const target = {
            name: player_name,
            requestedName: resolution.requested,
            canonicalName: resolution.canonical,
            id: player.id,
        };
        return this._runVision({
            target,
            lookingMessage: direction === 'with'
                ? `Looking in the same direction as ${player_name}.`
                : `Looking at ${player_name}.`,
            aim: async () => {
                if (direction === 'with') {
                    await bot.look(player.yaw, player.pitch);
                } else {
                    await bot.lookAt(new Vec3(player.position.x, player.position.y + player.height, player.position.z));
                }
            },
        });
    }

    lookAtPosition(x, y, z) {
        if (![x, y, z].every(Number.isFinite)) {
            return this._unavailable('invalid_target', 'Vision needs valid coordinates.', null, false);
        }
        const bot = this.agent.bot;
        const target = { x, y, z };
        return this._runVision({
            target,
            lookingMessage: `Looking at coordinate ${x}, ${y}, ${z}.`,
            aim: () => bot.lookAt(new Vec3(x, y + 2, z)),
        });
    }

    inspectCurrentView() {
        const bot = this.agent.bot;
        const target = {
            kind: 'current_view',
            yaw: Number(bot.entity?.yaw) || 0,
            pitch: Number(bot.entity?.pitch) || 0,
        };
        return this._runVision({
            target,
            lookingMessage: 'Inspecting the current first-person view.',
            aim: async () => {},
        });
    }

    getCenterBlockInfo() {
        const bot = this.agent.bot;
        const maxDistance = 128; // Maximum distance to check for blocks
        try {
            const targetBlock = bot.blockAtCursor(maxDistance);
            if (targetBlock) {
                return `Center block: ${targetBlock.name} at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z}).`;
            }
        } catch (error) {
            return `Center block unavailable: ${String(error?.message || error).slice(0, 160)}.`;
        }
        return 'No block is currently resolved at the center view.';
    }

    async analyzeImage(filename, { target = null, capturedAt = Date.now() } = {}) {
        const imageBuffer = await fs.readFile(`${this.fp}/${filename}.jpg`);
        const messages = this.agent.history.getHistory();
        const grounding = buildVisionGrounding(this.agent, target, capturedAt);
        const result = await this.agent.prompter.promptVision(messages, imageBuffer, { grounding });
        if (!String(result || '').trim()) {
            throw new Error('Vision model returned no analysis.');
        }
        return String(result).slice(0, 4_000);
    }
}
