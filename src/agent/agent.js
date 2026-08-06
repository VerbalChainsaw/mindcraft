import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandAssignsPersistentGoal, commandAssignsPersistentJob, commandExists, commandTakesManualAutonomy, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { requestPlayerPosition, serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import { resolveBlockedActions } from './command-policy.js';
import { addressesAgent } from './chat-address.js';
import { resolvePlayerDirective, routeCompoundToolGoal } from './player-directives.js';
import { parsePlayerAgenda } from './player-agenda.js';
import { normalizeRuntimeBehavior } from './runtime/behavior-config.js';
import { JobDirector } from './runtime/job-director.js';
import { GoalDirector } from './runtime/goal-director.js';
import { SurvivalDirector } from './runtime/survival-director.js';
import { BehaviorEventBus } from './runtime/behavior-event.js';
import { ReactionDirector } from './runtime/reaction-director.js';
import { EnvironmentObserver } from './runtime/environment-observer.js';
import * as mc from '../utils/mcdata.js';
import { CompanionContext } from './runtime/companion-context.js';
import { HomeStateStore } from './runtime/home-state-store.js';
import { LandmarkMemory } from './runtime/landmark-memory.js';
import { PlayerMemory } from './runtime/player-memory.js';
import { KnowledgeStore } from './runtime/knowledge-store.js';
import { ProgressionDirector } from './runtime/progression-director.js';
import { AgendaDirector } from './runtime/agenda-director.js';
import { RuleEngine } from './runtime/rule-engine.js';
import { BehaviorArbiter } from './runtime/behavior-arbiter.js';
import { signalInterrupt } from './runtime/interruptible-delay.js';

const HOLD_SAFE_COMMANDS = new Set([
    '!stop',
    '!endGoal',
    '!stfu',
    '!restart',
    '!clearChat',
    '!setPersona',
    '!setMode',
    '!squadRadio',
    '!cancelJob',
    '!cancelGoal',
]);
const COMPANION_CONTINUATION_COMMANDS = new Set(['!follow', '!followPlayer', '!guardPlayer', '!defend']);
const MAX_INGAME_CHAT_CHARS = 240;
const MIN_INGAME_CHAT_INTERVAL_MS = 450;
// One bounded entity read at roughly 7Hz. Cheap enough to run continuously and
// the only way an already-loaded hostile closing the distance becomes an edge.
const THREAT_SENSOR_INTERVAL_MS = 150;
const THREAT_SENSOR_DISTANCE = 12;
const STARTUP_MILESTONES = new Set([
    'settings_profile_ready',
    'mineflayer_created',
    'login_callback',
    'spawn_callback',
    'handlers_ready',
]);

export function emitStartupMilestone(milestone) {
    if (!STARTUP_MILESTONES.has(milestone)) return false;
    try {
        process.stderr.write(`[mindcraft-startup] ${milestone}\n`);
        return true;
    } catch {
        return false;
    }
}

function boundedChatText(message) {
    const normalized = String(message || '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalized.length <= MAX_INGAME_CHAT_CHARS) return normalized;
    return `${normalized.slice(0, MAX_INGAME_CHAT_CHARS - 3).trimEnd()}...`;
}

function commandReleasesOperatorHold(commandName) {
    return isAction(commandName) && !HOLD_SAFE_COMMANDS.has(commandName);
}

function inventorySnapshot(bot) {
    const counts = {};
    for (const slot of bot?.inventory?.slots || []) {
        if (!slot?.name || !Number.isFinite(slot.count) || slot.count <= 0) continue;
        counts[slot.name] = (counts[slot.name] || 0) + slot.count;
    }
    return counts;
}

function identityMatchKeys(identity) {
    const value = String(identity || '');
    if (!value) return [];
    const keys = [value.toLowerCase()];
    // Floodgate may add one leading dot that Mineflayer's chat source omits.
    // Do not strip or normalize punctuation anywhere else in the username.
    if (value.startsWith('.') && value.length > 1) keys.push(value.slice(1).toLowerCase());
    return keys;
}

export function resolveCanonicalPlayerIdentity(source, bot, { isBotAgent = () => false } = {}) {
    const sourceIdentity = String(source || '');
    if (!sourceIdentity || !bot) return null;

    const records = new Map();
    const selfKeys = new Set(identityMatchKeys(bot.username));
    const addPlayer = (canonicalValue, aliases = []) => {
        const canonical = String(canonicalValue || '');
        if (!canonical) return;
        const names = [...new Set([canonical, ...aliases.map(alias => String(alias || '')).filter(Boolean)])];
        if (names.some(name => identityMatchKeys(name).some(key => selfKeys.has(key)))) return;
        if (names.some(name => isBotAgent(name))) return;
        const record = records.get(canonical) || { canonical, aliases: new Set() };
        for (const name of names) record.aliases.add(name);
        records.set(canonical, record);
    };

    const indexedPlayerEntities = new Set();
    for (const [playerKey, player] of Object.entries(bot.players || {})) {
        const entity = player?.entity;
        if (entity?.type === 'player') indexedPlayerEntities.add(entity);
        addPlayer(playerKey || entity?.username || player?.username, [playerKey, player?.username, entity?.username]);
    }
    for (const entity of Object.values(bot.entities || {})) {
        if (entity?.type !== 'player' || indexedPlayerEntities.has(entity)) continue;
        addPlayer(entity.username, [entity.username]);
    }

    const exactMatches = new Set();
    for (const record of records.values()) {
        if ([...record.aliases].some(alias => alias === sourceIdentity)) exactMatches.add(record.canonical);
    }
    if (exactMatches.size === 1) return [...exactMatches][0];
    if (exactMatches.size > 1) return null;

    const sourceKey = sourceIdentity.toLowerCase();
    const conservativeMatches = new Set();
    for (const record of records.values()) {
        if ([...record.aliases].some(alias => identityMatchKeys(alias).includes(sourceKey))) {
            conservativeMatches.add(record.canonical);
        }
    }
    return conservativeMatches.size === 1 ? [...conservativeMatches][0] : null;
}

export function shouldSeedLegacyDefaultGoal(profile, runtime, activeSettings = settings) {
    const goal = typeof activeSettings?.default_goal === 'string'
        ? activeSettings.default_goal.trim()
        : '';
    if (!goal) return false;
    const hasExplicitRuntime = Boolean(
        profile?.runtime
        && typeof profile.runtime === 'object'
        && !Array.isArray(profile.runtime),
    );
    if (hasExplicitRuntime) return false;
    if (runtime?.autonomy === 'command') return false;
    return true;
}

export function configureSurvivalOwnership(bot) {
    if (!bot?.autoEat || typeof bot.autoEat.disable !== 'function') {
        throw new Error('Auto-eat plugin is unavailable; survival ownership cannot be established.');
    }
    bot.autoEat.options = {
        priority: 'foodPoints',
        startAt: 14,
        bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken'],
    };
    bot.autoEat.disable();
}

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;
        this._runtimeStopped = false;
        this._teardownPromise = null;
        this._updateLoopTimer = null;
        this._idleResumeTimer = null;
        this._spawnTimeoutTimer = null;
        this._deathCleanupPromise = null;
        this._lastAliveInventorySnapshot = {};
        this._lastAliveInventorySnapshotAt = 0;
        this._playerPositionLookup = null;
        this._playerPositionLookupGeneration = 0;
        this._requestPlayerPosition = requestPlayerPosition;

        const nameCheck = validateNameFormat(settings?.profile?.name);
        if (!nameCheck.success) {
            this.name = typeof settings?.profile?.name === 'string' ? settings.profile.name.trim() : '';
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        settings.profile.name = nameCheck.name;
        this.runtime = normalizeRuntimeBehavior(settings.profile, settings);
        settings.language = this.runtime.identity.language;
        this.persona = String(settings.profile.persona || '').trim().slice(0, 520);
        this.operator_hold = false;
        this.operator_hold_reason = '';
        this.operator_hold_generation = 0;
        this._chatDelivery = Promise.resolve();
        this._lastChatSentAt = 0;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = nameCheck.name;
        console.log(`Initializing agent ${this.name}...`);
        
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank(this.name);
        this.memory_bank.load();
        this.home_state = new HomeStateStore(this.name);
        if (this.home_state.lastError) {
            console.warn(`[home-state] Could not restore ${this.name}: ${this.home_state.lastError}`);
        }
        this.behavior_events = new BehaviorEventBus(this.name);
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();
        emitStartupMilestone('settings_profile_ready');

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        if (save_data?.operator_hold === true) {
            this.operator_hold = true;
            this.operator_hold_reason = save_data.operator_hold_reason || 'operator stop restored after restart';
            this.operator_hold_generation += 1;
            console.log('[operator] Persisted stop restored before world control became available.');
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = resolveBlockedActions({
            configured: settings.blocked_actions,
            task: this.task.blocked_actions,
            allowInsecureCoding: settings.allow_insecure_coding,
        });
        if (this.runtime?.role === 'companion' && !this.blocked_actions.includes('!attackPlayer')) {
            this.blocked_actions.push('!attackPlayer');
        }
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        // Route policy is read where Movements are built, which only ever
        // receives the bot. A plain string keeps LLM-reachable objects free of
        // any agent reference.
        this.bot.traversalPolicy = this.runtime?.traversal || 'preserve';
        this.companion_context = new CompanionContext(this, {
            onReappeared: () => this.behavior_arbiter?.requestDirectiveResume?.(),
        });
        emitStartupMilestone('mineflayer_created');
        this.job_director = new JobDirector(this);
        this.goal_director = new GoalDirector(this);
        // Compatibility telemetry and older call sites share the same scheduler;
        // RoleDirector never runs independently beside JobDirector.
        this.role_director = this.job_director;
        this.survival_director = new SurvivalDirector(this);
        this.reaction_director = new ReactionDirector(this);
        this.environment_observer = new EnvironmentObserver(this);
        this.progression_director = new ProgressionDirector(this);
        this.agenda_director = new AgendaDirector(this);
        const rememberedPlayerGoal = this.goal_director.activeGoal || this.goal_director.lastGoal;
        const rememberedPlayer = rememberedPlayerGoal?.destination?.kind === 'player'
            ? rememberedPlayerGoal.destination.player
            : null;
        const rememberedPosition = rememberedPlayerGoal?.memory?.deliveryTarget;
        if (rememberedPlayer && rememberedPosition?.position && rememberedPosition?.dimension) {
            this.companion_context.observeAuthoritativePosition(rememberedPlayer, {
                success: true,
                found: true,
                ...rememberedPosition,
            });
        } else if (rememberedPlayer) {
            this.companion_context.observeResolution(
                rememberedPlayer,
                this.companion_context.resolve(rememberedPlayer),
                { dimension: this.bot.game?.dimension, notify: false },
            );
        }
        try {
            this.rule_engine = new RuleEngine(this);
        } catch (error) {
            // Standing orders are an enhancement, never a spawn prerequisite.
            this.rule_engine = null;
            console.warn(`[rules] Standing orders are unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
        try {
            this.player_memory = new PlayerMemory(this.name);
            this.knowledge_store = new KnowledgeStore(this.name);
        } catch (error) {
            // Remembering people and facts is an enhancement, never a spawn
            // prerequisite.
            this.player_memory = null;
            this.knowledge_store = null;
            console.warn(`[memory] Player and knowledge memory are unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
        try {
            this.landmark_memory = new LandmarkMemory(this.name);
        } catch (error) {
            // Spatial recall is an enhancement, never a spawn prerequisite.
            this.landmark_memory = null;
            console.warn(`[landmark] Spatial recall is unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
        this.behavior_arbiter = new BehaviorArbiter(this);
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { msg } = handleDisconnection(this.name, reason);
            void this.teardownAndExit(msg, 1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);
        this.bot._client.on('set_passengers', ({ entityId, passengers }) => {
            const vehicle = this.bot.vehicle;
            if (
                !vehicle
                || vehicle.id !== entityId
                || passengers.includes(this.bot.entity.id)
            ) return;
            const passengerIndex = vehicle.passengers?.indexOf?.(this.bot.entity) ?? -1;
            if (passengerIndex >= 0) vehicle.passengers.splice(passengerIndex, 1);
            if (this.bot.entity.vehicle === vehicle) delete this.bot.entity.vehicle;
            this.bot.vehicle = null;
            this.bot.emit('dismount', vehicle);
        });

        this.bot.on('login', () => {
            emitStartupMilestone('login_callback');
            console.log(this.name, 'logged in!');
            serverProxy.login();
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });
		const spawnTimeoutDuration = settings.spawn_timeout;
        this._spawnTimeoutTimer = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            void this.teardownAndExit(msg, 1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            emitStartupMilestone('spawn_callback');
            try {
                clearTimeout(this._spawnTimeoutTimer);
                this._spawnTimeoutTimer = null;
                // Prismarine Viewer is optional diagnostics, never a startup
                // dependency. Keep it outside the world-ready path.
                void addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
              
                const startupDialogue = await this._setupEventHandlers(save_data, init_message);
                this.startEvents();
                emitStartupMilestone('handlers_ready');
                await serverProxy.ready();
                serverProxy.startStateStream();

                // A startup prompt can legitimately choose an endless action
                // such as follow or guard. Start it only after the bridge has
                // declared world readiness so that action duration cannot make
                // the control plane kill a healthy spawned agent.
                if (startupDialogue.initMessage) {
                    void this.handleMessage('system', startupDialogue.initMessage, 2)
                        .catch(error => console.error('Startup message failed:', error));
                } else if (startupDialogue.greet) {
                    void this.openChat(`Hello world! I am ${this.name}`);
                }

                if (settings.task) {
                    if (!load_mem) this.task.initBotTask();
                    this.task.setAgentGoal();
                } else if (shouldSeedLegacyDefaultGoal(this.prompter.profile, this.runtime, settings) && !this.self_prompter.prompt) {
                    // No scripted task: seed a self-prompt goal so the bot
                    // autonomously pursues gameplay instead of only reacting to chat.
                    // Runtime-configured role bots use RoleDirector instead; seeding
                    // the legacy self-prompter here would block that lane entirely.
                    // Register a reseed handler so a paused goal (e.g. no verified
                    // progress, or a transient model failure that backed off) is
                    // automatically restarted instead of the bot going idle forever.
                    this.self_prompter.setGoalEndedHandler((_endedPrompt, endState) => {
                        if (endState === 0) return null; // explicit stop: do not reseed
                        const reseed = typeof settings.default_goal === 'string'
                            ? settings.default_goal.trim()
                            : '';
                        return reseed || null;
                    });
                    this.self_prompter.start(settings.default_goal, { source: 'default' });
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                void this.teardownAndExit(`Spawn initialization failed: ${String(error?.message || error).slice(0, 500)}`, 1);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const startupDialogue = { initMessage: null, greet: false };
        const resumeTypedGoal = Boolean(this.goal_director?.activeGoal);
        const restoreHeld = this.isOperatorHeld();
        const lifecycleRestart = init_message === 'Agent process restarted.';
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        const respondToMinecraftChat = (username, message) => {
            if (username === this.name) return;
            const canonicalPlayer = resolveCanonicalPlayerIdentity(username, this.bot, {
                isBotAgent: identity => {
                    if (convoManager.isOtherAgent(identity)) return true;
                    const keys = new Set(identityMatchKeys(identity));
                    return convoManager.getInGameAgents().some(agentName =>
                        identityMatchKeys(agentName).some(key => keys.has(key))
                    );
                },
            });
            if (!canonicalPlayer) {
                console.warn(`Ignoring Minecraft chat from untrusted source: ${String(username).slice(0, 80)}`);
                return;
            }
            respondFunc(username, message);
        };

        this.bot.on('whisper', respondToMinecraftChat);
        
        this.bot.on('chat', (username, message) => {
            // Alone, every open message is obviously for this bot. In company,
            // answering everything means the whole squad talks over the player,
            // so a bot answers only when it is addressed -- by name, by its
            // squad prefix, or by a word meant for everyone. Requiring a
            // whisper instead made playing with more than one bot a chore.
            if (
                serverProxy.getNumOtherAgents() > 0
                && !addressesAgent(message, this.name)
            ) return;
            respondToMinecraftChat(username, message);
        });

        // SurvivalDirector owns eating so equipment restoration, interruption, and
        // action evidence stay inside the normal command/action pipeline.
        configureSurvivalOwnership(this.bot);

        if (save_data?.self_prompt) {
            if (init_message && !lifecycleRestart && !restoreHeld && !resumeTypedGoal) {
                this.history.add('system', init_message);
            }
            // A persisted player goal is already a complete deterministic work
            // contract. Keep any lower-priority saved self-prompt stopped until
            // that contract reaches a truthful terminal state.
            await this.self_prompter.handleLoad(
                save_data.self_prompt,
                (resumeTypedGoal || restoreHeld) ? 0 : save_data.self_prompting_state,
            );
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
        }
        if (restoreHeld) {
            console.log('[operator] Restart remains held; startup dialogue and autonomy are suppressed.');
        }
        else if (resumeTypedGoal) {
            console.log('[goal] Persisted typed goal will resume without model restoration.');
        }
        else if (lifecycleRestart) {
            console.log('[startup] Lifecycle restart acknowledged without model dialogue.');
        }
        else if (save_data?.last_sender) {
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            startupDialogue.initMessage = init_message;
        }
        else {
            startupDialogue.greet = true;
        }
        return startupDialogue;
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        // Release any skill parked on an interruptible wait immediately, so the
        // handoff is bounded by this call rather than by that skill's own poll
        // period.
        signalInterrupt(this.bot);
        try { this.bot.stopDigging(); } catch { /* no active dig */ }
        try {
            const cancellation = this.bot.collectBlock?.cancelTask?.();
            if (cancellation && typeof cancellation.catch === 'function') {
                void cancellation.catch(() => { /* best-effort collection cancellation */ });
            }
        } catch { /* no collection task */ }
        try { this.bot.pathfinder.setGoal(null); } catch { /* no pathfinder goal */ }
        try { this.bot.pvp.stop(); } catch { /* no combat target */ }
        try { this.bot.deactivateItem(); } catch { /* no active item */ }
        // An open container or crafting window survives every other
        // cancellation here, and a bot holding one cannot be moved. Closing it
        // is what lets a reflex actually take the body back mid-craft.
        try { if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow); } catch { /* no open window */ }
        try { this.bot.moveVehicle?.(0, 0); } catch { /* no mounted vehicle */ }
        try { this.bot.clearControlStates(); } catch { /* disconnected body */ }
    }

    isOperatorHeld() {
        return this.operator_hold === true;
    }

    getKnownAgentNames() {
        return [this.name, ...convoManager.getInGameAgents()];
    }

    async locatePlayerPosition(playerName) {
        const normalized = String(playerName || '').trim().toLowerCase();
        if (this._playerPositionLookup?.player === normalized) {
            return this._playerPositionLookup.promise;
        }
        const generation = Math.max(0, Number(this._playerPositionLookupGeneration) || 0) + 1;
        this._playerPositionLookupGeneration = generation;
        const request = this._requestPlayerPosition || requestPlayerPosition;
        const promise = Promise.resolve(request(playerName))
            .then(observation => {
                if (
                    this._playerPositionLookupGeneration !== generation
                    || this._playerPositionLookup?.player !== normalized
                ) return observation;
                this.companion_context?.observeAuthoritativePosition?.(playerName, observation);
                return observation;
            });
        this._playerPositionLookup = { player: normalized, generation, promise };
        try {
            return await promise;
        } finally {
            if (this._playerPositionLookup?.promise === promise) this._playerPositionLookup = null;
        }
    }

    resumeCompanionDirective() {
        if (this._runtimeStopped || this.isOperatorHeld() || !this.isIdle()) return false;
        const command = this.companion_context?.resumeCommand?.();
        if (!command) return false;
        this.self_prompter?.interruptForManualCommand?.();
        this.role_director?.deferForManualCommand?.('Resuming an explicitly authorized companion directive.');
        void executeCommand(this, command, { owner: 'player', routeOrigin: 'directive-resume' })
            .catch(error => console.error(`[companion] Could not resume explicit directive: ${String(error?.message || error).slice(0, 240)}`));
        return true;
    }

    holdPosition(reason = 'operator stop') {
        this.operator_hold_generation += 1;
        this.operator_hold = true;
        this.operator_hold_reason = String(reason || 'operator stop').slice(0, 160);
        this.companion_context?.clearControl?.();
        this.actions?.cancelResume?.();
        this.goal_director?.cancel?.(this.operator_hold_reason);
        if (/operator stop/i.test(this.operator_hold_reason)) {
            this.job_director?.cancel?.(this.operator_hold_reason);
            this.prompter?.cancelPendingModelGeneration?.();
        }
        this.self_prompter?.stop(false);
        this.requestInterrupt();
        try { this.history?.save?.(); } catch (error) {
            console.warn(`[operator] Could not persist hold state: ${String(error?.message || error).slice(0, 240)}`);
        }
        return this.operator_hold_generation;
    }

    releaseOperatorHold(reason = 'explicit command') {
        if (!this.operator_hold) return false;
        this.operator_hold_generation += 1;
        this.operator_hold = false;
        this.operator_hold_reason = String(reason || 'explicit command').slice(0, 160);
        try { this.history?.save?.(); } catch (error) {
            console.warn(`[operator] Could not persist released hold state: ${String(error?.message || error).slice(0, 240)}`);
        }
        return true;
    }

    isCurrentOperatorHold(generation) {
        return this.operator_hold === true && this.operator_hold_generation === generation;
    }

    async takePersistentJobControl() {
        this.self_prompter?.interruptForManualCommand?.();
        this.actions?.cancelResume?.();
        const stopOutcome = await this.actions.stop();
        if (stopOutcome.stopped) return { ready: true, detail: '' };

        const detail = `The current action '${this.actions.currentActionLabel || 'unknown'}' did not yield, so the new work order was not accepted.`;
        this.holdPosition('persistent job handoff failed');
        return { ready: false, detail };
    }

    async takePersistentGoalControl() {
        const handoff = await this.takePersistentJobControl();
        if (!handoff.ready) return handoff;

        this.job_director?.cancel?.('Superseded by an explicit player item goal.');
        return handoff;
    }

    recordActionResult(result) {
        this.last_action_result = result || null;
        this.behavior_arbiter?.recordOutcome?.(result);
        // A terminal result is an edge, not durable state: the next automatic
        // action can replace it before a debounced/heartbeat sample is sent.
        // Flush it immediately so observers can correlate the exact action ID.
        serverProxy.requestStatePush?.({ force: true, immediate: true, authoritative: true });
        if (!result) return;
        // GoalDirector owns the player-facing lifecycle for typed goals. Their
        // physical sub-actions remain fully visible in ActionResult and decision
        // telemetry, but must not become delayed standalone reaction speech.
        if (result.evidence?.request?.routeOrigin === 'goal-director') return;
        this.publishBehaviorEvent({
            id: result.actionId,
            type: result.phase === 'succeeded' ? 'action.completed' : 'action.failed',
            target: result.target || { name: String(result.label || 'action').replace(/[^A-Za-z0-9_ -]/g, '_').slice(0, 64) },
            evidence: {
                actionId: result.actionId,
                code: result.code,
                phase: result.phase,
            },
            salience: result.phase === 'succeeded' ? 1 : 3,
            timestamp: result.finishedAt || Date.now(),
        });
    }

    publishBehaviorEvent(event) {
        // Every coordinate-bearing sighting funnels through here, so this is the
        // one place spatial recall has to be fed.
        try {
            this.landmark_memory?.observe(event, { dimension: this.bot?.game?.dimension });
            this.rule_engine?.observe(event);
        } catch (error) {
            console.warn(`[landmark] Sighting was not recorded: ${String(error?.message || error).slice(0, 240)}`);
        }
        try {
            const published = this.behavior_events?.publish?.(event) === true;
            serverProxy.requestStatePush?.();
            return published;
        } catch (error) {
            console.warn(`[behavior-event] Rejected event: ${String(error?.message || error).slice(0, 240)}`);
            return false;
        }
    }

    recordPlayerOrder(source, commandName) {
        const player = String(source || '').replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 64);
        const code = String(commandName || '').replace(/^!/, '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
        if (!player || !code) return;
        this.publishBehaviorEvent({
            type: 'player.order',
            target: { name: player },
            evidence: { code },
            salience: 3,
        });
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    setPersona(persona) {
        this.persona = String(persona || '')
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 520);
        this.prompter.profile.persona = this.persona;
        return this.persona;
    }

    getPersona() {
        return this.persona || '';
    }

    /**
     * Route a plain-English multi-step plan into the existing Agenda queue
     * without a model round trip. Returns true when it fully handled the line,
     * so the caller can stop before the single-directive / LLM path.
     *
     * A lone task with no chain and no explicit interrupt is deliberately NOT
     * intercepted here: it keeps flowing through the fast single-directive path
     * below, preserving today's behavior exactly.
     */
    async dispatchPlayerAgenda(source, canonicalPlayer, message) {
        const director = this.agenda_director;
        if (!director?.add) return false;
        const plan = parsePlayerAgenda(canonicalPlayer || source, message, {
            role: this.runtime?.role,
            bot: this.bot,
        });
        if (!plan) return false;
        const agendaBusy = (director.snapshot?.().remaining || 0) > 0;
        // Only intercept a real chain, an explicit interrupt, or an append onto
        // work already queued. Anything else stays on the single-command path.
        if (!plan.multiStep && plan.disposition !== 'interrupt' && !agendaBusy) return false;

        await this.history.add(source, message);

        // A fresh plan (or an explicit interrupt) must free the body from any
        // standing directive or in-flight solo work so the agenda can claim the
        // next behavior tick. An append onto a running agenda leaves the current
        // step alone and simply extends the queue.
        const takeover = plan.disposition === 'interrupt' || !agendaBusy;
        if (takeover) {
            this.releaseOperatorHold('player agenda');
            this.actions.cancelResume();
            this.goal_director?.releaseProtectedCompletion?.('Released by a later player agenda.');
            this.goal_director?.cancel?.('Superseded by a player plan.');
            this.job_director?.cancel?.('Superseded by a player plan.');
            this.companion_context?.setDirective?.(null);
            this.self_prompter.interruptForManualCommand();
            this.role_director.deferForManualCommand('Player plan owns action control.');
        }
        if (plan.disposition === 'interrupt') {
            director.clear('Superseded by a new player plan.');
        }
        if (takeover) {
            // Yield whatever action currently holds the body; stop() is a no-op
            // when nothing is executing.
            try { await this.actions.stop(); } catch { /* best effort */ }
        }

        const queued = [];
        const rejected = [];
        for (const step of plan.steps) {
            const result = director.add(step.entry);
            if (result?.accepted) queued.push(result.description || step.segment);
            else rejected.push(`${step.segment} (${result?.detail || result?.code || 'rejected'})`);
        }

        let response;
        if (queued.length === 0) {
            response = `I couldn't queue that plan: ${rejected.join('; ') || 'no runnable steps'}.`;
        } else {
            // Claim the next behavior tick immediately rather than waiting out
            // whatever cadence the previously selected lane had scheduled.
            this.behavior_arbiter?.wake?.('player_plan_queued');
            response = plan.disposition === 'interrupt'
                ? `Okay, new plan — ${queued.join(', then ')}.`
                : `Queued ${queued.length} step${queued.length === 1 ? '' : 's'}: ${queued.join(', then ')}.`;
            const skipped = [...rejected, ...plan.unresolved.map(item => item.segment)];
            if (skipped.length) response += ` (Not queued: ${skipped.join('; ')}.)`;
        }
        await this.history.add(this.name, response);
        this.history.save();
        this.routeResponse(source, response);
        return true;
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);
        // ADMIN is the authenticated dashboard transport identity, not a
        // Minecraft player. Let it issue explicit commands, but never let it
        // replace the tracked companion or start authoritative player polling.
        const companionResolution = !self_prompt && !from_other_bot && source !== 'ADMIN'
            ? this.companion_context?.observeChat?.(source)
            : null;

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            message = routeCompoundToolGoal(source, message);
            const user_command_name = containsCommand(message);
                if (user_command_name) {
                    if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command ${user_command_name.substring(1)} is unavailable for this bot profile.`);
                    return false;
                }
                console.log(`${source} invoked ${user_command_name}.`);
                    const assignsTypedGoal = commandAssignsPersistentGoal(user_command_name);
                    if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                    }
                    if (commandReleasesOperatorHold(user_command_name)) {
                        this.releaseOperatorHold('player command');
                    }
                    if (commandTakesManualAutonomy(user_command_name)) {
                        this.actions.cancelResume();
                        this.goal_director?.releaseProtectedCompletion?.('Released by a later direct player command.');
                        if (!assignsTypedGoal) {
                            this.goal_director?.cancel?.('Superseded by a direct player command.');
                        }
                        if (!COMPANION_CONTINUATION_COMMANDS.has(user_command_name)) {
                            this.companion_context?.setDirective?.(null);
                        }
                        this.self_prompter.interruptForManualCommand();
                        this.role_director.deferForManualCommand('Direct player command owns action control.');
                    }
                    if (commandAssignsPersistentJob(user_command_name)) {
                        if (!assignsTypedGoal) {
                            this.goal_director?.cancel?.('Superseded by an explicit player work order.');
                        }
                        const handoff = assignsTypedGoal
                            ? await this.takePersistentGoalControl()
                            : await this.takePersistentJobControl();
                        if (!handoff.ready) {
                            this.routeResponse(source, handoff.detail);
                            return true;
                        }
                    }
                    if (isAction(user_command_name)) this.recordPlayerOrder(source, user_command_name);
                    const commandOwner = source === 'system' ? 'autonomy' : 'player';
                    let execute_res = await executeCommand(this, message, {
                        owner: commandOwner,
                        routeOrigin: 'explicit-command',
                    });
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }

            // Recognized player directives use the same deterministic command path
            // as explicit !commands; unrecognized conversation still reaches the LLM.
            const canonicalPlayer = companionResolution?.canonical || resolveCanonicalPlayerIdentity(source, this.bot, {
                isBotAgent: identity => {
                    if (convoManager.isOtherAgent(identity)) return true;
                    const keys = new Set(identityMatchKeys(identity));
                    return convoManager.getInGameAgents().some(agentName =>
                        identityMatchKeys(agentName).some(key => keys.has(key))
                    );
                },
            });
            // A multi-step plan ("get 5 logs then build a shelter") is routed
            // deterministically into the Agenda queue before the single-directive
            // path, so serial plans never need a model round trip. A lone task
            // returns false here and continues below unchanged.
            if (await this.dispatchPlayerAgenda(source, canonicalPlayer, message)) {
                return true;
            }

            // Keep `source` for history, replies, and player-order audit; canonical
            // identity resolution is scoped to deterministic command generation.
            const directive = resolvePlayerDirective(canonicalPlayer || source, message, {
                role: this.runtime?.role,
                bot: this.bot,
            });
            if (directive) {
                await this.history.add(source, message);
                await this.history.add(this.name, `${directive.response} ${directive.command}`);
                this.history.save();
                const directiveCommand = containsCommand(directive.command);
                const assignsTypedGoal = directiveCommand
                    ? commandAssignsPersistentGoal(directiveCommand)
                    : false;
                if (directiveCommand && commandReleasesOperatorHold(directiveCommand)) {
                    this.releaseOperatorHold('player directive');
                }
                if (directiveCommand && commandTakesManualAutonomy(directiveCommand)) {
                    this.actions.cancelResume();
                    this.goal_director?.releaseProtectedCompletion?.('Released by a later deterministic player order.');
                    if (!assignsTypedGoal) {
                        this.goal_director?.cancel?.('Superseded by a direct player order.');
                    }
                    if (!COMPANION_CONTINUATION_COMMANDS.has(directiveCommand)) {
                        this.companion_context?.setDirective?.(null);
                    }
                    this.self_prompter.interruptForManualCommand();
                    this.role_director.deferForManualCommand('Direct player order owns action control.');
                }
                if (directiveCommand && commandAssignsPersistentJob(directiveCommand)) {
                    if (!assignsTypedGoal) {
                        this.goal_director?.cancel?.('Superseded by an explicit player work order.');
                    }
                    const handoff = assignsTypedGoal
                        ? await this.takePersistentGoalControl()
                        : await this.takePersistentJobControl();
                    if (!handoff.ready) {
                        this.routeResponse(source, handoff.detail);
                        return true;
                    }
                }
                if (directiveCommand && isAction(directiveCommand)) this.recordPlayerOrder(source, directiveCommand);
                this.routeResponse(source, directive.response);
                const execute_res = await executeCommand(this, directive.command, {
                    owner: 'player',
                    routeOrigin: 'deterministic-nl',
                });
                if (execute_res)
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.isOperatorHeld() || this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

                let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                if (!self_prompt && !from_other_bot) {
                    const assignsTypedGoal = commandAssignsPersistentGoal(command_name);
                    this.releaseOperatorHold('player command');
                    if (commandTakesManualAutonomy(command_name)) {
                        this.actions.cancelResume();
                        this.goal_director?.releaseProtectedCompletion?.('Released by later player-authorized model work.');
                        if (!assignsTypedGoal) {
                            this.goal_director?.cancel?.('Superseded by a player-requested command.');
                        }
                        if (!COMPANION_CONTINUATION_COMMANDS.has(command_name)) {
                            this.companion_context?.setDirective?.(null);
                        }
                        this.role_director.deferForManualCommand('Player-requested model action owns control.');
                    }
                    if (commandAssignsPersistentJob(command_name)) {
                        if (!assignsTypedGoal) {
                            this.goal_director?.cancel?.('Superseded by a player-requested work order.');
                        }
                        const handoff = assignsTypedGoal
                            ? await this.takePersistentGoalControl()
                            : await this.takePersistentJobControl();
                        if (!handoff.ready) {
                            this.routeResponse(source, handoff.detail);
                            return true;
                        }
                    }
                    if (isAction(command_name)) this.recordPlayerOrder(source, command_name);
                }
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                const previousActionId = this.last_action_result?.actionId || null;
                const commandOwner = self_prompt || source === 'system' ? 'autonomy' : 'player';
                let execute_res = await executeCommand(this, res, {
                    owner: commandOwner,
                    routeOrigin: 'model-selected',
                });

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res);
                const terminalActionFailure = self_prompt
                    && isAction(command_name)
                    && this.last_action_result?.actionId
                    && this.last_action_result.actionId !== previousActionId
                    && this.last_action_result.phase !== 'succeeded'
                    && this.last_action_result.retryable === false;
                if (!execute_res || terminalActionFailure)
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    openChat(message, { priority = 'direct' } = {}) {
        const sourceMessage = String(message || '');
        if (!sourceMessage.trim()) return Promise.resolve(false);

        const deliver = async () => {
            let toTranslate = sourceMessage;
            const commandName = containsCommand(sourceMessage);
            const translateUpTo = commandName ? sourceMessage.indexOf(commandName) : -1;
            if (translateUpTo !== -1) {
                // Commands are an internal action protocol. Keep them in model
                // history and execute them, but never expose them through chat
                // or speech as if they were dialogue.
                toTranslate = sourceMessage.substring(0, translateUpTo);
            }

            let translated = toTranslate;
            try {
                translated = await handleTranslation(toTranslate);
            } catch (error) {
                console.warn(`[dialogue] Translation failed; sending original text: ${String(error?.message || error).slice(0, 240)}`);
            }
            const outgoing = boundedChatText(String(translated || '').trim());
            if (!outgoing) return false;

            const waitMs = Math.max(0, MIN_INGAME_CHAT_INTERVAL_MS - (Date.now() - this._lastChatSentAt));
            if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
            this._lastChatSentAt = Date.now();

            let delivered = false;
            if (settings.only_chat_with.length > 0) {
                for (const username of settings.only_chat_with) {
                    try {
                        this.bot.whisper(username, outgoing);
                        delivered = true;
                    } catch (error) {
                        console.warn(`[dialogue] Whisper to ${username} failed: ${String(error?.message || error).slice(0, 240)}`);
                    }
                }
            } else {
                if (settings.speak) {
                    void Promise.resolve()
                        .then(() => speak(toTranslate, this.prompter.profile.speak_model, { priority }))
                        .catch(error => console.warn(`[dialogue] Speech output failed: ${String(error?.message || error).slice(0, 240)}`));
                }
                if (settings.chat_ingame) {
                    try {
                        this.bot.chat(outgoing);
                        delivered = true;
                    } catch (error) {
                        console.warn(`[dialogue] In-game chat failed: ${String(error?.message || error).slice(0, 240)}`);
                    }
                }
                delivered = sendOutputToServer(this.name, outgoing) || delivered;
            }
            return delivered;
        };

        const delivery = this._chatDelivery.then(deliver, deliver);
        this._chatDelivery = delivery.catch(error => {
            console.error(`[dialogue] Failed to deliver in-game chat: ${String(error?.message || error).slice(0, 512)}`);
        });
        return delivery;
    }

    startEvents() {
        const refreshAliveInventorySnapshot = () => {
            if (Number(this.bot.health) <= 0) return;
            const now = Date.now();
            if (now - this._lastAliveInventorySnapshotAt < 250) return;
            this._lastAliveInventorySnapshot = inventorySnapshot(this.bot);
            this._lastAliveInventorySnapshotAt = now;
        };
        refreshAliveInventorySnapshot();
        this.bot.on('physicsTick', refreshAliveInventorySnapshot);

        // entitySpawn only fires when a hostile loads. A mob that was already
        // loaded and simply walks closer raises no event at all, so without a
        // cheap sampler that approach is noticed only on the next scheduled
        // evaluation, and an idle lane schedules half a second out.
        //
        // This deliberately does not decide anything. It samples one bounded
        // predicate and asks the arbiter to evaluate; all priority and control
        // arbitration stays in the one loop that owns it.
        this._lastThreatSampleAt = 0;
        this._threatWasNear = false;
        const sampleApproachingThreat = () => {
            const now = Date.now();
            if (now - this._lastThreatSampleAt < THREAT_SENSOR_INTERVAL_MS) return;
            this._lastThreatSampleAt = now;
            const origin = this.bot.entity?.position;
            if (!origin) return;
            let near = false;
            try {
                near = Boolean(this.bot.nearestEntity(entity => (
                    mc.isHostile(entity)
                    && entity?.position
                    && entity.position.distanceTo(origin) <= THREAT_SENSOR_DISTANCE
                )));
            } catch {
                return; // A transient entity-list read must never break the tick.
            }
            // Edge triggered. A hostile that merely loiters in range must not
            // keep requesting evaluations.
            if (near && !this._threatWasNear) this.behavior_arbiter?.wake?.('threat_approached');
            this._threatWasNear = near;
        };
        this.bot.on('physicsTick', sampleApproachingThreat);
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0) {
            this.bot.emit('sunrise');
            this.publishBehaviorEvent({
                id: `world-sunrise-${Math.floor(Number(this.bot.time.age || 0) / 24_000)}`,
                type: 'time.sunrise',
                salience: 2,
                witnesses: [this.name, ...convoManager.getInGameAgents()],
            });
            }
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000) {
            this.bot.emit('sunset');
            this.publishBehaviorEvent({
                id: `world-sunset-${Math.floor(Number(this.bot.time.age || 0) / 24_000)}`,
                type: 'time.sunset',
                salience: 3,
                witnesses: [this.name, ...convoManager.getInGameAgents()],
            });
            }
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
            const weather = this.bot.thunderState > 0 ? 'thunderstorm' : this.bot.rainState > 0 ? 'rain' : 'clear';
            if (this._lastBehaviorWeather && weather !== this._lastBehaviorWeather) {
                this.publishBehaviorEvent({
                    id: `weather-${weather}-${Math.floor(Date.now() / 5_000)}`,
                    type: 'weather.changed',
                    target: { name: weather },
                    salience: weather === 'thunderstorm' ? 4 : 2,
                    witnesses: [this.name, ...convoManager.getInGameAgents()],
                });
            }
            this._lastBehaviorWeather = weather;
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
                // Damage is the edge that raises urgency, and urgency is what
                // caps the cadence. Re-evaluate now instead of finishing a wait
                // that was scheduled while the bot was still calm.
                this.behavior_arbiter?.wake?.('self_damaged');
                this.publishBehaviorEvent({
                    type: 'self.damaged',
                    target: { name: 'health' },
                    evidence: { amount: this.bot.lastDamageTaken },
                    salience: this.bot.lastDamageTaken >= 4 ? 4 : 3,
                });
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            const position = this.bot.entity?.position;
            const dimension = this.bot.game?.dimension;
            const observedInventory = inventorySnapshot(this.bot);
            const inventory = Object.keys(observedInventory).length > 0
                ? observedInventory
                : { ...this._lastAliveInventorySnapshot };
            if (position) {
                this.memory_bank.rememberDeath(position, dimension, inventory);
            }
            this.publishBehaviorEvent({
                type: 'self.died',
                target: position ? { name: 'death', x: position.x, y: position.y, z: position.z } : { name: 'death' },
                evidence: {
                    dimension,
                    recoverableItems: Object.values(inventory).reduce((total, count) => total + count, 0),
                },
                salience: 5,
            });
            void this.cleanupAfterDeath();
        });
        this.bot.on('playerJoined', player => {
            const name = player?.username || player?.displayName;
            this.companion_context?.observeLoadedPlayer?.(name, player?.entity, {
                lineOfSight: null,
                dimension: this.bot.game?.dimension,
            });
            if (name && name !== this.name) {
                this.publishBehaviorEvent({
                    id: `player-joined-${String(name).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 48)}-${Math.floor(Date.now() / 5_000)}`,
                    type: 'player.joined',
                    target: { name },
                    salience: 2,
                    witnesses: [this.name, ...convoManager.getInGameAgents()],
                });
            }
        });
        this.bot.on('playerLeft', player => {
            const name = player?.username || player?.displayName;
            this.companion_context?.observeGone?.(player?.entity || name);
            if (name && name !== this.name) {
                this.publishBehaviorEvent({
                    id: `player-left-${String(name).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 48)}-${Math.floor(Date.now() / 5_000)}`,
                    type: 'player.left',
                    target: { name },
                    salience: 2,
                    witnesses: [this.name, ...convoManager.getInGameAgents()],
                });
            }
        });
        this.bot.on('entitySpawn', entity => {
            if (entity?.type === 'player') {
                this.companion_context?.observeLoadedPlayer?.(entity.username, entity, {
                    lineOfSight: null,
                    dimension: this.bot.game?.dimension,
                });
            }
            this.environment_observer?.observeEntitySpawn?.(entity);
            if (!mc.isHostile(entity) || !entity?.position || !this.bot.entity?.position) return;
            const distance = this.bot.entity.position.distanceTo(entity.position);
            if (distance > 24) return;
            // Close enough that the protection lanes may need the body now
            // rather than whenever the current cadence next comes around.
            if (distance <= 16) this.behavior_arbiter?.wake?.('threat_detected');
            this.publishBehaviorEvent({
                id: Number.isFinite(entity.id) ? `threat-${entity.id}` : undefined,
                type: 'threat.detected',
                target: {
                    name: entity.name || entity.displayName || 'hostile',
                    x: entity.position.x,
                    y: entity.position.y,
                    z: entity.position.z,
                    distance,
                },
                evidence: { code: 'hostile_spawn' },
                salience: distance <= 12 ? 5 : 4,
                witnesses: [this.name, ...convoManager.getInGameAgents()],
            });
        });
        this.bot.on('entityHurt', (entity, source) => {
            this.environment_observer?.observeEntityHurt?.(entity, source);
        });
        this.bot.on('entityDead', entity => {
            this.environment_observer?.observeEntityDead?.(entity);
        });
        this.bot.on('entityGone', entity => {
            if (entity?.type === 'player') this.companion_context?.observeGone?.(entity);
            this.environment_observer?.observeEntityGone?.(entity);
        });
        this.bot.on('blockUpdate', (oldBlock, newBlock) => {
            this.environment_observer?.observeBlockUpdate?.(oldBlock, newBlock);
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                // The death event above already records memory, cleans up the
                // active action, and publishes self.died into the one behavior
                // loop. Starting a second unrestricted model turn here caused
                // competing post-death plans and blocked respawn decisions.
            }
        });
        this.bot.on('idle', () => {
            try { this.bot.moveVehicle?.(0, 0); } catch { /* no mounted vehicle */ }
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            clearTimeout(this._idleResumeTimer);
            this._idleResumeTimer = null;
            // The body just came free. Claiming the next step now is the
            // difference between continuing a plan and visibly pausing between
            // every step of it.
            this.behavior_arbiter?.wake?.('action_finished');
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval.
        // The period is not fixed: the arbiter reports how soon it needs to be
        // re-evaluated based on the lane it selected, live urgency, and the
        // bot's comportment, so reflexes run tight while idle bots back off.
        const INTERVAL = 300;
        const MIN_INTERVAL = 60;
        const MAX_INTERVAL = 1000;
        let last = Date.now();
        this._updateLoopTimer = setTimeout(async () => {
            let consecutiveFailures = 0;
            while (!this._runtimeStopped) {
                let start = Date.now();
                try {
                    await this.update(start - last);
                    consecutiveFailures = 0;
                } catch (error) {
                    consecutiveFailures += 1;
                    const detail = String(error?.stack || error?.message || error).slice(0, 4096);
                    console.error(`[${this.name}] Agent update failed (${consecutiveFailures}/5): ${detail}`);
                    if (consecutiveFailures >= 5) {
                        this.cleanKill('Agent update loop failed repeatedly. Restarting is required.', 1);
                        return;
                    }
                }
                const requested = Number(this.behavior_arbiter?.nextTickDelayMs);
                const period = Number.isFinite(requested)
                    ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, requested))
                    : INTERVAL;
                let remaining = period - (Date.now() - start);
                if (remaining > 0) {
                    // Interruptible. A salient world edge cuts the wait short so
                    // the bot does not stay blind for the whole selected period;
                    // an idle lane selects half a second, which is long enough
                    // for a hostile to close the distance unobserved.
                    await (this.behavior_arbiter?.sleep?.(remaining)
                        ?? new Promise((resolve) => setTimeout(resolve, remaining)));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        return await this.behavior_arbiter.update(delta);
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    async teardownAndExit(msg='Killing agent process...', code=1) {
        if (this._teardownPromise) return this._teardownPromise;
        this._teardownPromise = (async () => {
            this._runtimeStopped = true;
            this.behavior_arbiter?.stop?.();
            clearTimeout(this._updateLoopTimer);
            clearTimeout(this._idleResumeTimer);
            clearTimeout(this._spawnTimeoutTimer);
            this._updateLoopTimer = null;
            this._idleResumeTimer = null;
            this._spawnTimeoutTimer = null;
            this.actions?.cancelResume?.();
            if (this.self_prompter?.stop) {
                await Promise.race([
                    this.self_prompter.stop(false),
                    new Promise(resolve => setTimeout(resolve, 2_000)),
                ]);
            }
            await this.actions?.stop?.({ timeoutMs: 2_000 });
            try { this.requestInterrupt(); } catch { /* best effort runtime cleanup */ }
            try { this.vision_interpreter?.dispose?.(); } catch { /* optional vision cleanup */ }
            await this.prompter?.dispose?.();
            this.history.add('system', String(msg || 'Killing agent process...').slice(0, 500));
            try { this.bot.chat(code > 1 ? 'Restarting.' : 'Exiting.'); } catch { /* disconnected bot */ }
            this.history.save();
            process.exit(code);
        })();
        return this._teardownPromise;
    }

    async cleanupAfterDeath() {
        if (this._deathCleanupPromise) return this._deathCleanupPromise;
        this._deathCleanupPromise = (async () => {
            this.actions?.cancelResume?.();
            if (this.self_prompter?.isActive?.()) {
                await this.self_prompter.pause();
            } else {
                await this.actions?.stop?.({ timeoutMs: 2_000 });
            }
            try { this.requestInterrupt(); } catch { /* best effort death cleanup */ }
            try { this.bot.clearControlStates(); } catch { /* best effort death cleanup */ }
        })().finally(() => {
            this._deathCleanupPromise = null;
        });
        return this._deathCleanupPromise;
    }

    cleanKill(msg='Killing agent process...', code=1) {
        void this.teardownAndExit(msg, code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
