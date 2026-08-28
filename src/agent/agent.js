import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandAssignsPersistentGoal, commandAssignsPersistentJob, commandExists, commandTakesManualAutonomy, executeCommand, truncCommandMessage, isAction, blacklistCommands, getCommandManifest } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank, hasPendingDeathRecovery } from './memory_bank.js';
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
import { addressesAgent, stripLeadingAgentAddress } from './chat-address.js';
import { resolvePlayerDirective, resolveTypedItemGoalDirective, routeCompoundToolGoal } from './player-directives.js';
import { classifyPlayerSpeechAuthority } from './player-speech-authority.js';
import {
    compilePlayerIntentLedger,
    detectMaterialPlayerClarification,
    parsePlayerAgenda,
    resolveMaterialPlayerClarification,
    resolvePlayerPlanDisposition,
} from './player-agenda.js';
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
import { OperatorControlStateStore } from './runtime/operator-control-state.js';
import { CompanionDirectiveStateStore } from './runtime/companion-directive-state.js';
import { LandmarkMemory } from './runtime/landmark-memory.js';
import { PlayerMemory } from './runtime/player-memory.js';
import { KnowledgeStore } from './runtime/knowledge-store.js';
import { ProgressionDirector } from './runtime/progression-director.js';
import { AgendaDirector } from './runtime/agenda-director.js';
import { CharcoalMissionController } from './runtime/charcoal-mission.js';
import { RuleEngine } from './runtime/rule-engine.js';
import { BehaviorArbiter } from './runtime/behavior-arbiter.js';
import { BehaviorFlightRecorder, isTelemetryBookmarkMessage } from './runtime/behavior-flight-recorder.js';
import { signalInterrupt } from './runtime/interruptible-delay.js';
import { minecraftWeather } from './runtime/weather-state.js';
import { observeReceivedDamageSource } from './runtime/combat-attribution.js';
import { randomUUID } from 'node:crypto';

const HOLD_SAFE_COMMANDS = new Set([
    '!stop',
    '!endGoal',
    '!stfu',
    '!restart',
    '!clearChat',
    '!setPersona',
    '!setMode',
    '!setAutonomy',
    '!setComportment',
    '!setTraversal',
    '!setNarration',
    '!showRuntime',
    '!squadRadio',
    '!cancelJob',
    '!cancelGoal',
    '!cancelMission',
    '!clearAgenda',
    '!rememberHere',
    '!forgetRememberedPlace',
]);
const COMPANION_CONTINUATION_COMMANDS = new Set(['!follow', '!followPlayer', '!guardPlayer', '!defend']);
const HELD_WORK_RESUME_COMMANDS = new Set([
    '!resumeAgenda',
    '!resumeStructureJob',
]);
const PLAYER_DESIGN_COMMANDS = new Set(['!buildStructure', '!designStructure']);
const PLAYER_ITEM_PLAN_COMMANDS = new Set(['!queueItemPlan']);
const PLAYER_STORAGE_PLAN_COMMANDS = new Set(['!queueStoragePlan']);
const DIRECT_AGENDA_PLAN_KINDS = new Map([
    ['!requestResourceProject', 'resource_project'],
]);
const MAX_CONSTRUCTION_COMPILATION_TURNS = 6;
const MAX_ITEM_PLAN_COMPILATION_TURNS = 3;
// How often a still-open player request is quoted back while the model is
// working, and how many times in total. Loose enough that an honest multi-step
// chain is not interrupted every turn, tight enough that drift is caught inside
// a minute rather than after twenty.
const COMMANDS_BETWEEN_REQUEST_REMINDERS = 6;
const MAX_REQUEST_REMINDERS = 5;
const MAX_INGAME_CHAT_CHARS = 240;
const CHAT_SEGMENT_PREFIX_RESERVE = 12;
const MIN_INGAME_CHAT_INTERVAL_MS = 450;
// One bounded entity read at roughly 7Hz. Cheap enough to run continuously and
// the only way an already-loaded hostile closing the distance becomes an edge.
const THREAT_SENSOR_INTERVAL_MS = 150;
const THREAT_SENSOR_DISTANCE = 12;
const MAX_MODEL_CLARIFICATION_AGE_MS = 120_000;
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

export function correlatedPersistentJobSubmissionAccepted({
    commandName,
    requestContext,
    submission,
    activeOrder,
} = {}) {
    return Boolean(
        commandAssignsPersistentJob(commandName)
        && requestContext?.requestId
        && submission?.submissionKind === 'job_submission'
        && submission?.requestId === requestContext.requestId
        && requestContext.selectedSkill === commandName
        && submission?.selectedSkill === commandName
        && submission?.routeOrigin === requestContext.routeOrigin
        && (submission?.missionId || null) === requestContext.missionId
        && (submission?.activityId || null) === requestContext.activityId
        && submission?.accepted === true
        && submission?.submittedOrderId
        && submission.submittedOrderId === submission.activeOrderId
        && submission.activeOrderId === activeOrder?.id
    );
}

export function correlatedPersistentGoalAssignmentAccepted({
    commandName,
    requestContext,
    submission,
    activeGoal,
} = {}) {
    return Boolean(
        commandAssignsPersistentGoal(commandName)
        && requestContext?.requestId
        && submission?.submissionKind === 'goal_submission'
        && submission.requestId === requestContext.requestId
        && requestContext.selectedSkill === commandName
        && submission.selectedSkill === commandName
        && submission.routeOrigin === requestContext.routeOrigin
        && (submission.missionId || null) === requestContext.missionId
        && (submission.activityId || null) === requestContext.activityId
        && submission.accepted === true
        && submission.submittedGoalId
        && submission.submittedGoalId === submission.activeGoalId
        && submission.activeGoalId === activeGoal?.id
    );
}

export function correlatedAgendaPlanSubmissionAccepted({
    deferredAssignment,
    commandName,
    requestContext,
    submission,
    agendaEntries,
} = {}) {
    const durableIds = new Set((Array.isArray(agendaEntries) ? agendaEntries : []).map(entry => entry?.id).filter(Boolean));
    const deferredPlanKind = ['item_plan', 'storage_plan'].includes(deferredAssignment?.kind)
        ? deferredAssignment.kind
        : null;
    const directPlanKind = DIRECT_AGENDA_PLAN_KINDS.get(commandName) || null;
    const expectedPlanKind = deferredPlanKind || directPlanKind;
    const commandAllowed = deferredPlanKind === 'storage_plan'
        ? PLAYER_STORAGE_PLAN_COMMANDS.has(commandName)
        : deferredPlanKind === 'item_plan'
            ? PLAYER_ITEM_PLAN_COMMANDS.has(commandName)
            : directPlanKind !== null;
    return Boolean(
        expectedPlanKind
        && commandAllowed
        && requestContext?.requestId
        && submission?.submissionKind === 'agenda_submission'
        && submission.planKind === expectedPlanKind
        && submission.requestId === requestContext.requestId
        && requestContext.selectedSkill === commandName
        && submission?.selectedSkill === commandName
        && submission.routeOrigin === requestContext.routeOrigin
        && (submission.missionId || null) === requestContext.missionId
        && (submission.activityId || null) === requestContext.activityId
        && submission?.accepted === true
        && Array.isArray(submission?.entryIds)
        && submission.entryIds.length > 0
        && submission.entryIds.every(id => durableIds.has(id))
    );
}

export function boundedChatSegments(message) {
    const normalized = String(message || '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return [];
    if (normalized.length <= MAX_INGAME_CHAT_CHARS) return [normalized];

    const contentLimit = MAX_INGAME_CHAT_CHARS - CHAT_SEGMENT_PREFIX_RESERVE;
    const parts = [];
    let remaining = normalized;
    while (remaining.length > contentLimit) {
        const window = remaining.slice(0, contentLimit + 1);
        const sentenceBoundary = Math.max(
            window.lastIndexOf('. '),
            window.lastIndexOf('! '),
            window.lastIndexOf('? '),
        );
        const wordBoundary = window.lastIndexOf(' ');
        const boundary = sentenceBoundary >= Math.floor(contentLimit * 0.55)
            ? sentenceBoundary + 1
            : wordBoundary >= Math.floor(contentLimit * 0.55)
                ? wordBoundary
                : contentLimit;
        parts.push(remaining.slice(0, boundary).trim());
        remaining = remaining.slice(boundary).trim();
    }
    if (remaining) parts.push(remaining);

    return parts.map((part, index) => `(${index + 1}/${parts.length}) ${part}`);
}

export function modelCommandAwaitsPlayerConfirmation(response, commandName = containsCommand(response)) {
    if (!commandName) return false;
    const text = String(response || '');
    const commandIndex = text.indexOf(commandName);
    if (commandIndex < 0) return false;
    const proposal = text.slice(0, commandIndex).trim();
    if (!proposal.endsWith('?')) return false;
    return /(?:\bshould\s+i\b|\bshall\s+i\b|\bmay\s+i\b|\bcan\s+i\b|\bwould\s+you\s+like\s+me\s+to\b|\bdo\s+you\s+want\s+me\s+to\b|\bwant\s+me\s+to\b|\bis\s+it\s+okay\s+if\s+i\b)/i.test(proposal);
}

function conversationFromOpenPlayerRequest(history, openRequest) {
    const turns = Array.isArray(history) ? history : [];
    const source = String(openRequest?.requester?.replySource || openRequest?.source || '').trim();
    const request = String(openRequest?.interpretedRequest || openRequest?.message || '').trim();
    if (!source || !request) return turns;
    // The request record is the authority boundary. Build a bounded view from
    // its literal turns rather than looking up text in history: a repeated
    // request sentence or a stale assistant command must not become current
    // action authority just because it happens to share the same text.
    const scoped = [{ role: 'user', content: `${source}: ${request}` }];
    const clarification = openRequest?.clarification;
    if (clarification?.question) {
        scoped.push({ role: 'assistant', content: clarification.question });
    }
    if (openRequest?.state === 'RESOLVING' && clarification?.interpretedAnswer) {
        const answerSource = String(clarification.replySource || source).trim();
        scoped.push({
            role: 'user',
            content: `${answerSource}: ${clarification.interpretedAnswer}`,
        });
    }
    return scoped;
}

function isExplicitClarificationSupersession(message) {
    return /^(?:actually\s+)?(?:new\s+request|new\s+task|change\s+of\s+plan|forget\s+(?:that|it)|instead\b)/i
        .test(String(message || '').trim());
}

function requestInterpretationPromptContext(openRequest) {
    if (!openRequest?.requestId || !openRequest?.clarification) return null;
    const clarification = openRequest.clarification;
    return Object.freeze({
        requestId: openRequest.requestId,
        clarificationToken: clarification.token,
        requester: openRequest.requester?.canonical || null,
        phase: openRequest.state,
        requiresActionCommand: true,
        instruction: 'This is a correlated clarification answer for the current player request. Re-interpret the literal request and answer together against current world state. Do not resume historical work or issue a command unless it fulfills this request.',
    });
}

// Plain language still reaches the model first. Once the model has interpreted a
// registry-valid item promise as physical work, deterministic policy binds the
// whole promise to GoalDirector before any primitive can take body ownership.
// This keeps provider choices such as !givePlayer or !prepareMaterial from
// bypassing acquisition, interruption recovery, and Mission resumption.
export function promoteModelItemGoalCommand(response, typedGoalDirective) {
    const selectedCommand = containsCommand(response);
    if (
        !selectedCommand
        || selectedCommand === '!requestItemGoal'
        || selectedCommand === '!acceptCharcoalMission'
        || !isAction(selectedCommand)
        || !typedGoalDirective?.command
    ) return null;
    const truncated = truncCommandMessage(response);
    const commandIndex = truncated.indexOf(selectedCommand);
    const prefix = commandIndex >= 0 ? truncated.slice(0, commandIndex).trim() : '';
    return prefix ? `${prefix} ${typedGoalDirective.command}` : typedGoalDirective.command;
}

// Director's call, 2026-08-17: "Yes, it should mine it. It can mine it. Why
// stop?" A companion that halts to ask permission for an obvious, reversible
// step is the polite form of stalling -- the charcoal run derived that it needed
// cobblestone, asked whether to mine it, and then sat for nine minutes.
//
// So a question no longer withholds the command. The question is still spoken,
// so the player can redirect; the work just does not stop while it waits. Only
// genuinely consequential actions still require an answer first: attacking
// someone, leaving, restarting, or bringing more bots into the world.
const CONFIRMATION_REQUIRED_COMMANDS = new Set([
    '!attackPlayer', '!attack', '!leaveGame', '!restart', '!spawnBots',
]);

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

export { hasPendingDeathRecovery };

export function idleSignalMayReleaseBody(agent) {
    if (!agent?.bot || !agent?.actions) return false;
    return agent.actions.executing !== true
        && (Number(agent.bot.mindcraftManagedNavigationDepth) || 0) <= 0;
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

export function shouldSeedLegacyDefaultGoal(
    profile,
    runtime,
    activeSettings = settings,
    { hasTypedGoal = false } = {},
) {
    if (hasTypedGoal) return false;
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
        // This marker is minted only by AgentProcess' restart path. It is set
        // before the durable directors are constructed so GoalDirector may
        // distinguish an explicit continuation of this runtime from an
        // ordinary fresh launch that happens to find old activity on disk.
        this.lifecycle_restart = init_message === 'Agent process restarted.';
        this._disconnectHandled = false;
        this._runtimeStopped = false;
        this._teardownPromise = null;
        this._updateLoopTimer = null;
        this._idleResumeTimer = null;
        this._spawnTimeoutTimer = null;
        this._deathCleanupPromise = null;
        this._lastAliveInventorySnapshot = {};
        this._lastAliveInventorySnapshotAt = 0;
        this._trackedDeathRecoveryRecordedAt = null;
        this._deathRecoveryObservationNotBefore = 0;
        this._playerPositionLookup = null;
        this._playerPositionLookupGeneration = 0;
        this._requestPlayerPosition = requestPlayerPosition;
        this.pending_player_clarification = null;
        // The player request currently being worked, held on the agent rather
        // than inside one handleMessage call. Measured 2026-08-18 on the
        // charcoal course: twenty-eight commands across FOUR handleMessage
        // invocations. Everything that knew what the player asked for lived in
        // the first one, so from the second onward nothing in the process could
        // still name the request -- which is how a run smelted the charcoal and
        // then wandered off to collect logs and craft an axe.
        this.open_player_request = null;
        this.commands_since_request_reminder = 0;
        this.request_reminders_sent = 0;

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
        this.internal_control_block = null;
        this.internal_control_generation = 0;
        this._chatDelivery = Promise.resolve();
        this._lastChatSentAt = 0;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = nameCheck.name;
        console.log(`Initializing agent ${this.name}...`);
        
        this.history = new History(this);
        this.operator_control = new OperatorControlStateStore(this.name);
        this.companion_directive_state = new CompanionDirectiveStateStore(this.name);
        if (this.companion_directive_state.lastError) {
            console.warn(`[companion] Standing directive was not restored: ${this.companion_directive_state.lastError}`);
        }
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
        const operatorControl = this.operator_control.snapshot();
        if (operatorControl.held) {
            this.operator_hold = true;
            this.operator_hold_reason = operatorControl.reason || 'operator stop restored after restart';
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
        // ARCHITECTURE.md Step 6, behind a flag. When true the deterministic
        // pre-LLM interceptors stand down and the model chooses the next command
        // itself. Default false, so ordinary bots are unchanged.
        //
        // A live run on 2026-08-17 showed a flag is the only way to ask the
        // question. "Go get some wood and make me some charcoal" never reached
        // the model: dispatchPlayerAgenda parsed it, queued "harvest 32 logs,
        // then get 1 additional charcoal", and returned handled. Blocking
        // !addToAgenda changed nothing, because the interception happens
        // upstream of command selection entirely.
        // Model-first is the ordinary behaviour, not an experiment. Defaulting
        // this off "so ordinary bots are unchanged" meant the fix shipped to
        // nobody: the scenario proved it while the played Kevin kept routing
        // plain English through the regex directive table. Legacy deterministic
        // routing is now the thing you opt into, by name.
        this.llm_sequencing = settings.legacy_deterministic_routing === true
            ? false
            : settings.llm_sequencing !== false;
        this.blocked_actions = resolveBlockedActions({
            configured: settings.blocked_actions,
            task: this.task.blocked_actions,
            allowInsecureCoding: settings.allow_insecure_coding,
            allowed: settings.allowed_commands,
            registered: getCommandManifest().map((command) => command.name),
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
        this.bot.preflightPolicy = this.runtime.preflight;
        this.companion_context = new CompanionContext(this, {
            onReappeared: () => this.behavior_arbiter?.requestDirectiveResume?.(),
            directiveState: this.companion_directive_state,
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
        this.charcoal_mission = new CharcoalMissionController(this, {
            mode: settings.charcoal_mission_mode || 'active',
        });
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
        this.behavior_arbiter = new BehaviorArbiter(this, {
            heldNoHumanUnloadGraceMs: settings.held_no_human_unload_grace_ms,
        });
        for (const commitmentProvider of [
            this.goal_director,
            this.charcoal_mission,
            this.job_director,
            this.agenda_director,
            this.companion_context,
        ]) {
            this.behavior_arbiter.registerControlCommitmentProvider(commitmentProvider);
        }
        try {
            this.flight_recorder = new BehaviorFlightRecorder(this);
        } catch (error) {
            // Diagnostics must never become a spawn prerequisite.
            this.flight_recorder = null;
            console.warn(`[telemetry] Flight recorder is unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
        
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
                this.companion_context?.reconcileLoadedPlayer?.({
                    lineOfSight: null,
                    dimension: this.bot.game?.dimension,
                });
                this.flight_recorder?.recordRuntimeEvent?.('runtime.started', {
                    loadMemory: load_mem === true,
                    lifecycleRestart: init_message === 'Agent process restarted.',
                });
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
                } else if (
                    shouldSeedLegacyDefaultGoal(
                        this.prompter.profile,
                        this.runtime,
                        settings,
                        { hasTypedGoal: Boolean(this.goal_director?.activeGoal) },
                    )
                    && !this.self_prompter.prompt
                ) {
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

                if (isTelemetryBookmarkMessage(message)) {
                    const recorded = this.flight_recorder?.bookmark?.(username, message) === true;
                    void this.openChat(recorded
                        ? 'Telemetry bookmark saved. Keep playing; I captured the current state and recent context.'
                        : 'Telemetry bookmark could not be saved; the recorder is unavailable.');
                    return;
                }

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
        // Sleeping is a physical Mineflayer owner just like digging,
        // Pathfinder, combat, and an open window. A noncritical sleep action
        // must yield to Stop even if the higher-level sleep loop has not yet
        // reached its next cancellation poll.
        try {
            if (this.bot.isSleeping) {
                const waking = this.bot.wake?.();
                if (waking && typeof waking.catch === 'function') {
                    void waking.catch(() => { /* entityWake remains authoritative */ });
                }
            }
        } catch { /* already awake or disconnected */ }
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

    beginInternalControlBlock(reason, { kind = 'assignment_wait', blocksBody = true } = {}) {
        const generation = ++this.internal_control_generation;
        this.internal_control_block = Object.freeze({
            generation,
            kind: String(kind || 'assignment_wait').slice(0, 48),
            reason: String(reason || 'internal control wait').slice(0, 160),
            blocksBody: blocksBody === true,
            startedAt: Date.now(),
        });
        this.behavior_arbiter?.wake?.('internal_control_block_started');
        return generation;
    }

    currentInternalControlBlock() {
        return this.internal_control_block ? { ...this.internal_control_block } : null;
    }

    isCurrentInternalControlBlock(generation) {
        return Number.isInteger(generation)
            && this.internal_control_block?.generation === generation;
    }

    releaseInternalControlBlock(reason = 'internal work settled', generation = null) {
        if (!this.internal_control_block) return false;
        if (Number.isInteger(generation) && !this.isCurrentInternalControlBlock(generation)) return false;
        this.internal_control_block = null;
        this.internal_control_generation += 1;
        this.behavior_arbiter?.wake?.(`internal_control_released:${String(reason || '').slice(0, 64)}`);
        return true;
    }

    supersedeOpenPlayerRequest(reason = 'superseded') {
        const openRequest = this.open_player_request;
        if (!openRequest) return null;
        this.prompter?.cancelPendingModelGeneration?.();
        this.open_player_request = null;
        this.commands_since_request_reminder = 0;
        this.request_reminders_sent = 0;
        this.publishBehaviorEvent?.({
            type: 'player.request_superseded',
            target: { name: openRequest.requester?.canonical || openRequest.requester?.replySource || '' },
            evidence: {
                requestId: openRequest.requestId,
                code: String(reason || 'superseded').slice(0, 96),
            },
            salience: 2,
        });
        return openRequest;
    }

    beginOpenPlayerRequest({ source, canonicalRequester, rawRequest, interpretedRequest }) {
        const canonical = String(canonicalRequester || '').trim();
        const request = String(interpretedRequest || '').trim();
        if (!canonical || !request) return null;
        const previous = this.open_player_request;
        if (
            previous?.state === 'INTERPRETING'
            && previous.requester?.canonical === canonical
            && previous.interpretedRequest === request
        ) return previous;
        if (previous) this.supersedeOpenPlayerRequest('later_player_request');
        const openedAt = Date.now();
        const openRequest = Object.freeze({
            requestId: `player-request-${randomUUID()}`,
            requester: Object.freeze({ canonical, replySource: String(source || '').trim() }),
            rawRequest: String(rawRequest || '').trim(),
            interpretedRequest: request,
            receivedAt: openedAt,
            state: 'INTERPRETING',
            clarification: null,
        });
        this.open_player_request = openRequest;
        this.commands_since_request_reminder = 0;
        this.request_reminders_sent = 0;
        return openRequest;
    }

    requestOpenPlayerClarification(requestId, question) {
        const openRequest = this.open_player_request;
        const trimmedQuestion = String(question || '').trim();
        if (
            !openRequest
            || openRequest.requestId !== requestId
            || !['INTERPRETING', 'RESOLVING'].includes(openRequest.state)
            || !trimmedQuestion
        ) return null;
        const askedAt = Date.now();
        const clarification = Object.freeze({
            token: `clarification-${randomUUID()}`,
            requestId,
            requesterCanonical: openRequest.requester.canonical,
            replySource: openRequest.requester.replySource,
            question: trimmedQuestion,
            scope: 'request_interpretation',
            activityId: null,
            askedAt,
            expiresAt: askedAt + MAX_MODEL_CLARIFICATION_AGE_MS,
            rawAnswer: null,
            interpretedAnswer: null,
        });
        const waiting = Object.freeze({
            ...openRequest,
            state: 'WAITING_FOR_INPUT',
            clarification,
        });
        this.open_player_request = waiting;
        return waiting;
    }

    resolveOpenPlayerClarification({ canonicalRequester, source, rawAnswer, interpretedAnswer }) {
        const openRequest = this.open_player_request;
        const clarification = openRequest?.clarification;
        const canonical = String(canonicalRequester || '').trim();
        if (!openRequest || openRequest.state !== 'WAITING_FOR_INPUT' || !clarification) {
            return Object.freeze({ state: 'none' });
        }
        if (Date.now() > clarification.expiresAt) {
            this.supersedeOpenPlayerRequest('clarification_expired');
            return Object.freeze({ state: 'expired' });
        }
        if (canonical !== clarification.requesterCanonical) {
            return Object.freeze({ state: 'other_requester' });
        }
        const answer = String(interpretedAnswer || '').trim();
        if (!answer) return Object.freeze({ state: 'empty' });
        const resolving = Object.freeze({
            ...openRequest,
            state: 'RESOLVING',
            clarification: Object.freeze({
                ...clarification,
                replySource: String(source || clarification.replySource || '').trim(),
                rawAnswer: String(rawAnswer || '').trim(),
                interpretedAnswer: answer,
                answeredAt: Date.now(),
            }),
        });
        this.open_player_request = resolving;
        return Object.freeze({
            state: 'resolved',
            requestId: resolving.requestId,
            token: resolving.clarification.token,
        });
    }

    isCurrentOpenPlayerClarification(requestId, token, state = null) {
        const openRequest = this.open_player_request;
        return Boolean(
            openRequest
            && openRequest.requestId === requestId
            && openRequest.clarification?.token === token
            && (!state || openRequest.state === state)
        );
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
        // Death replaces the body and drops the inventory that supported the
        // standing directive. Reappearing beside a loaded companion is not new
        // authority to abandon that pending recovery and walk away from the
        // drop site. A fresh player command may still replace the old order.
        const directive = this.companion_context?.snapshot?.();
        if (hasPendingDeathRecovery(this.memory_bank, {
            after: directive?.directiveAuthorizedAt,
        })) return false;
        const command = this.companion_context?.resumeCommand?.();
        if (!command) return false;
        this.self_prompter?.interruptForManualCommand?.();
        this.role_director?.deferForManualCommand?.('Resuming an explicitly authorized companion directive.');
        void executeCommand(this, command, { owner: 'player', routeOrigin: 'directive-resume' })
            .catch(error => console.error(`[companion] Could not resume explicit directive: ${String(error?.message || error).slice(0, 240)}`));
        return true;
    }

    holdPosition(reason = 'operator stop', { preserveDurableWork = false } = {}) {
        this.operator_hold_generation += 1;
        this.operator_hold = true;
        this.operator_hold_reason = String(reason || 'operator stop').slice(0, 160);
        try { this.operator_control?.hold?.(this.operator_hold_reason); } catch (error) {
            console.warn(`[operator] Could not persist dedicated hold state: ${String(error?.message || error).slice(0, 240)}`);
        }
        this.companion_context?.clearControl?.();
        this.actions?.cancelResume?.();
        if (!preserveDurableWork) {
            this.goal_director?.cancel?.(this.operator_hold_reason);
            this.charcoal_mission?.cancel?.(this.operator_hold_reason);
        }
        if (/operator stop/i.test(this.operator_hold_reason)) {
            if (!preserveDurableWork) this.job_director?.cancel?.(this.operator_hold_reason);
            this.prompter?.cancelPendingModelGeneration?.();
            // Stop means stand down, so the open request stops being open. It is
            // cleared here rather than on any hold: a clarification hold or a
            // compilation hold is a pause inside the work, not the end of it,
            // and forgetting the request there would be the same amnesia this
            // field exists to fix. Nothing here releases a hold.
            this.open_player_request = null;
            this.commands_since_request_reminder = 0;
            this.request_reminders_sent = 0;
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
        this.behavior_arbiter?.releaseHeldSurfaceStance?.('operator_hold_released');
        this.operator_hold_generation += 1;
        this.operator_hold = false;
        this.operator_hold_reason = String(reason || 'explicit command').slice(0, 160);
        try { this.operator_control?.release?.(this.operator_hold_reason); } catch (error) {
            console.warn(`[operator] Could not persist dedicated released state: ${String(error?.message || error).slice(0, 240)}`);
        }
        try { this.history?.save?.(); } catch (error) {
            console.warn(`[operator] Could not persist released hold state: ${String(error?.message || error).slice(0, 240)}`);
        }
        return true;
    }

    claimFreshPlayerActionAuthority(commandName, reason = 'player command') {
        if (!commandReleasesOperatorHold(commandName)) {
            return Object.freeze({ ready: true, released: false });
        }
        if (!this.isOperatorHeld()) {
            return Object.freeze({ ready: true, released: false });
        }

        const stoppedByPlayer = /operator stop/i.test(this.operator_hold_reason || '');
        const explicitlyResumingHeldWork = HELD_WORK_RESUME_COMMANDS.has(commandName);
        if (stoppedByPlayer && !explicitlyResumingHeldWork) {
            const director = this.agenda_director;
            const hasUnfinishedAgenda = director?.hasUnfinished?.() === true
                || Number(director?.snapshot?.().remaining) > 0;
            if (hasUnfinishedAgenda) {
                const clearing = director?.clear?.('Superseded by a fresh direct player action.');
                if (clearing?.persisted !== true) {
                    return Object.freeze({
                        ready: false,
                        released: false,
                        code: 'fresh_player_authority_persist_failed',
                        detail: 'I could not durably cancel the paused plan, so I am still holding position and did not start the new action.',
                    });
                }
            }
        }

        return Object.freeze({
            ready: true,
            released: this.releaseOperatorHold(reason),
        });
    }

    isCurrentOperatorHold(generation) {
        return this.operator_hold === true && this.operator_hold_generation === generation;
    }

    releaseFailedConstructionCompilationBlock(deferredAssignment, settlement) {
        if (
            deferredAssignment?.kind !== 'construction'
            || settlement?.settled !== true
            || settlement.state !== 'failed'
            || settlement.retryable !== false
            || !Number.isInteger(deferredAssignment.controlBlockGeneration)
            || !this.isCurrentInternalControlBlock(deferredAssignment.controlBlockGeneration)
            || this.agenda_director?.hasUnfinished?.() !== true
        ) return false;
        return this.releaseInternalControlBlock(
            'construction compilation settled with agenda continuation',
            deferredAssignment.controlBlockGeneration,
        );
    }

    async takePersistentJobControl() {
        this.self_prompter?.interruptForManualCommand?.();
        this.actions?.cancelResume?.();
        const stopOutcome = await this.actions.stop();
        if (stopOutcome.stopped) return { ready: true, detail: '' };

        const detail = `The current action '${this.actions.currentActionLabel || 'unknown'}' did not yield, so the new work order was not accepted.`;
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
        this.flight_recorder?.recordActionResult?.(result);
        this.survival_director?.observeActionResult?.(result);
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
        this.flight_recorder?.recordBehaviorEvent?.(event);
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
        this.survival_director?.observePlayerOrder?.(player, code);
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
     * A lone ordinary task with no chain and no explicit interrupt is
     * deliberately NOT intercepted here: it keeps flowing through the fast
     * single-directive path below. Model-compiled construction is the exception
     * because its typed barrier owns the player's required-function contract.
     */
    async dispatchPlayerAgenda(source, canonicalPlayer, message, requesterPosition = null, {
        historyMessage = message,
        bypassModelSequencing = false,
    } = {}) {
        const director = this.agenda_director;
        if (!director?.addMany || !director?.validateMany) return false;
        const plan = parsePlayerAgenda(canonicalPlayer || source, message, {
            role: this.runtime?.role,
            bot: this.bot,
            requesterPosition,
            memoryBank: this.memory_bank,
            homeState: this.home_state,
            companion: this.companion_context?.snapshot?.() || null,
        });
        if (!plan) return false;
        // These typed project compilers already own their complete player
        // promise. Sending one back through free-form model command selection
        // lets the provider split it into unrelated elemental commands and
        // discard durable dependency edges. Ordinary requests retain the
        // configured model-first sequencing path.
        if (
            this.llm_sequencing
            && !['scout', 'livestock', 'nether_expedition'].includes(plan.owner)
            && bypassModelSequencing !== true
        ) return false;
        if (plan.rejection) {
            await this.history.add(source, historyMessage);
            await this.history.add(this.name, plan.rejection);
            this.history.save();
            this.routeResponse(source, plan.rejection);
            return true;
        }
        const intentLedger = compilePlayerIntentLedger(canonicalPlayer || source, message, plan);
        if (intentLedger.status !== 'complete') {
            const unresolved = intentLedger.unresolved.slice(0, 3);
            const response = unresolved.length > 0
                ? `I did not start only part of that request. I could not bind ${unresolved.map(segment => `"${segment}"`).join(' or ')} to safe typed work; please restate that choice or clause.`
                : 'I did not start that request because its complete typed effect list could not be proved.';
            await this.history.add(source, historyMessage);
            await this.history.add(this.name, response);
            this.history.save();
            this.publishBehaviorEvent?.({
                type: 'player.intent_rejected',
                target: { name: intentLedger.requester },
                evidence: {
                    code: intentLedger.code,
                    effectCount: intentLedger.effects.length,
                    unresolvedCount: intentLedger.unresolved.length,
                    issues: intentLedger.issues,
                },
                salience: 3,
            });
            this.routeResponse(source, response);
            return true;
        }
        const agendaBusy = (director.snapshot?.().remaining || 0) > 0;
        // Stop deliberately preserves durable work so it can be resumed, but a
        // later player plan is fresh authority, not permission to replay the
        // held queue first. While an agenda is actively running, ordinary
        // additions still append. A construction compiler also holds the body
        // while its exact durable barrier is pending; a continuation received
        // in that interval must append behind the barrier rather than mistake
        // the internal hold for a dormant player-stopped queue. Explicit
        // interrupt disposition still clears either state below.
        const compilingConstruction = Boolean(director.activeConstructionIntent?.());
        const effectiveDisposition = resolvePlayerPlanDisposition(message, {
            agendaBusy,
            operatorHeld: this.isOperatorHeld?.() === true,
            compilingConstruction,
        });
        const compilesConstruction = plan.steps.some(step => step.requiresModelAssignment === true);
        const durableRendezvous = plan.steps.length === 1 && plan.steps[0]?.entry?.kind === 'goto';
        // Only intercept a real chain, an explicit interrupt, or an append onto
        // work already queued. Anything else stays on the single-command path.
        if (
            !plan.multiStep
            && plan.disposition !== 'interrupt'
            && !agendaBusy
            && !compilesConstruction
            && !durableRendezvous
        ) return false;

        const entries = plan.steps.map(step => step.dependency
            ? {
                ...step.entry,
                dependsOnPrevious: true,
                dependencyPolicy: step.dependency.policy,
                bindingRequest: step.dependency.bindingRequest,
            }
            : step.entry);
        const agendaAdmission = director.validateMany(entries, {
            replaceUnfinished: effectiveDisposition === 'interrupt',
        });
        if (agendaAdmission.accepted !== true) {
            const response = `I did not start that request because its complete effect list was rejected: ${agendaAdmission.detail || agendaAdmission.code}.`;
            await this.history.add(source, historyMessage);
            await this.history.add(this.name, response);
            this.history.save();
            this.publishBehaviorEvent?.({
                type: 'player.intent_rejected',
                target: { name: intentLedger.requester },
                evidence: {
                    code: agendaAdmission.code || 'agenda_plan_rejected',
                    effectCount: intentLedger.effects.length,
                    unresolvedCount: 0,
                },
                salience: 3,
            });
            this.routeResponse(source, response);
            return true;
        }

        await this.history.add(source, historyMessage);

        // A fresh plan (or an explicit interrupt) must free the body from any
        // standing directive or in-flight solo work so the agenda can claim the
        // next behavior tick. An append onto a running agenda leaves the current
        // step alone and simply extends the queue.
        const takeover = effectiveDisposition === 'interrupt' || !agendaBusy;
        if (takeover) {
            this.prompter?.cancelPendingModelGeneration?.();
            if (!compilesConstruction) this.releaseOperatorHold('player agenda');
            this.actions.cancelResume();
            this.goal_director?.releaseProtectedCompletion?.('Released by a later player agenda.');
            this.goal_director?.cancel?.('Superseded by a player plan.');
            this.job_director?.cancel?.('Superseded by a player plan.');
            this.companion_context?.setDirective?.(null);
            this.self_prompter.interruptForManualCommand();
            this.role_director.deferForManualCommand('Player plan owns action control.');
        }
        if (takeover) {
            let stopOutcome;
            try {
                stopOutcome = await this.actions.stop();
            } catch {
                stopOutcome = { stopped: false };
            }
            if (!stopOutcome?.stopped) {
                this.holdPosition?.('player agenda handoff failed', { preserveDurableWork: true });
                const response = 'I could not take control from the current action, so I did not queue or start the new plan.';
                await this.history.add(this.name, response);
                this.history.save();
                this.routeResponse(source, response);
                return true;
            }
        }
        const installed = director.addMany(entries, {
            replaceUnfinished: effectiveDisposition === 'interrupt',
            reason: 'Superseded by a new player plan.',
        });
        const queued = installed.accepted === true
            ? installed.entries.map(entry => entry.description)
            : [];
        const rejected = installed.accepted === true
            ? []
            : [`complete plan (${installed.detail || installed.code || 'rejected'})`];
        let deferredConstruction = null;
        if (installed.accepted === true) {
            const deferredIndex = plan.steps.findIndex(step => step.requiresModelAssignment === true);
            if (deferredIndex >= 0) {
                deferredConstruction = {
                    entryId: installed.entries[deferredIndex].id,
                    segment: plan.steps[deferredIndex].segment,
                    modelInstruction: plan.steps[deferredIndex].modelInstruction || '',
                };
            }
            this.publishBehaviorEvent?.({
                type: 'player.intent_installed',
                target: { name: intentLedger.requester },
                evidence: {
                    code: intentLedger.code,
                    effectCount: intentLedger.effects.length,
                    participantCount: intentLedger.participants.length,
                    preservationConstraintCount: intentLedger.preservationConstraints.length,
                    entryIds: installed.entries.map(entry => entry.id),
                },
                salience: 2,
            });
        }

        let response;
        if (queued.length === 0) {
            response = `I couldn't queue that plan: ${rejected.join('; ') || 'no runnable steps'}.`;
        } else {
            // Claim the next behavior tick immediately rather than waiting out
            // whatever cadence the previously selected lane had scheduled.
            this.behavior_arbiter?.wake?.('player_plan_queued');
            response = effectiveDisposition === 'interrupt'
                ? `Okay, new plan — ${queued.join(', then ')}.`
                : `Queued ${queued.length} step${queued.length === 1 ? '' : 's'}: ${queued.join(', then ')}.`;
            const skipped = rejected;
            if (skipped.length) response += ` (Not queued: ${skipped.join('; ')}.)`;
        }
        await this.history.add(this.name, response);
        this.history.save();
        this.routeResponse(source, response);
        return deferredConstruction ? { deferredConstruction } : true;
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        const rawIncomingMessage = String(message);

        let used_command = false;
        let deferredModelAssignment = null;
        let authorizedModelHoldGeneration = null;
        let playerMessageAlreadyRecorded = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        // src/agent/settings.js is an empty object populated at runtime, so
        // max_commands can legitimately be absent in a child agent process. A
        // null would leave max_responses null, and `for (i = 0; i < null; i++)`
        // never runs -- the model would be skipped with nothing said. settings.js
        // documents -1 as "no limit", so an absent value fails open to that
        // rather than silently meaning zero turns.
        //
        // (Not the cause of the 2026-08-17 silence: that was a crash in the
        // prompt builder. I misread Infinity as null here because JSON.stringify
        // prints Infinity as null. The guard is still correct on its own terms.)
        if (max_responses === null || max_responses === undefined || !Number.isFinite(Number(max_responses))) {
            if (max_responses !== Infinity) {
                console.warn(`[settings] max_commands is ${JSON.stringify(settings.max_commands)}; defaulting to no limit.`);
                max_responses = Infinity;
            }
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);
        let playerSpeechAuthority = !self_prompt && !from_other_bot
            ? classifyPlayerSpeechAuthority(message)
            : 'action_eligible';
        // ADMIN is the authenticated dashboard transport identity, not a
        // Minecraft player. Let it issue explicit commands, but never let it
        // replace the tracked companion or start authoritative player polling.
        const companionResolution = !self_prompt && !from_other_bot && source !== 'ADMIN'
            ? this.companion_context?.observeChat?.(source)
            : null;
        let canonicalPlayer = null;
        let requestClarificationResolution = null;

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            message = routeCompoundToolGoal(source, message);
            const user_command_name = containsCommand(message);
                if (user_command_name) {
                    this.supersedeOpenPlayerRequest('direct_player_command');
                    this.pending_player_clarification = null;
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
                        const authority = this.claimFreshPlayerActionAuthority(user_command_name, 'player command');
                        if (!authority.ready) {
                            this.routeResponse(source, authority.detail);
                            return true;
                        }
                    }
                    if (commandTakesManualAutonomy(user_command_name)) {
                        if (!['!acceptCharcoalMission', '!cancelMission'].includes(user_command_name)) {
                            this.charcoal_mission?.cancel?.('Superseded by a later direct player command.');
                        }
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
            canonicalPlayer = companionResolution?.canonical || resolveCanonicalPlayerIdentity(source, this.bot, {
                isBotAgent: identity => {
                    if (convoManager.isOtherAgent(identity)) return true;
                    const keys = new Set(identityMatchKeys(identity));
                    return convoManager.getInGameAgents().some(agentName =>
                        identityMatchKeys(agentName).some(key => keys.has(key))
                    );
                },
            });
            let deterministicMessage = stripLeadingAgentAddress(message, this.name);
            const clarificationContext = { bot: this.bot };
            const waitingRequest = this.open_player_request;
            if (
                waitingRequest?.state === 'WAITING_FOR_INPUT'
                && canonicalPlayer === waitingRequest.requester?.canonical
                && isExplicitClarificationSupersession(deterministicMessage)
            ) {
                this.supersedeOpenPlayerRequest('explicit_player_replacement');
            } else {
                requestClarificationResolution = this.resolveOpenPlayerClarification({
                    canonicalRequester: canonicalPlayer,
                    source,
                    rawAnswer: rawIncomingMessage,
                    interpretedAnswer: deterministicMessage,
                });
                if (requestClarificationResolution.state === 'resolved') {
                    playerSpeechAuthority = 'action_eligible';
                    this.publishBehaviorEvent?.({
                        type: 'player.clarification_resolved',
                        target: { name: canonicalPlayer },
                        evidence: {
                            code: 'model_request_clarified',
                            requestId: requestClarificationResolution.requestId,
                        },
                        salience: 3,
                    });
                }
            }
            if (requestClarificationResolution?.state !== 'resolved') {
            if (this.pending_player_clarification) {
                const resolution = resolveMaterialPlayerClarification(
                    this.pending_player_clarification,
                    canonicalPlayer || source,
                    deterministicMessage,
                    clarificationContext,
                );
                if (resolution.state === 'resolved') {
                    const pending = this.pending_player_clarification;
                    this.pending_player_clarification = null;
                    this.publishBehaviorEvent?.({
                        type: 'player.clarification_resolved',
                        target: { name: resolution.recipient },
                        evidence: {
                            code: 'clarified_delivery_recipient',
                            item: pending.target,
                            quantity: pending.quantity,
                        },
                        salience: 3,
                    });
                    const dispatched = await this.dispatchPlayerAgenda(
                        source,
                        canonicalPlayer,
                        resolution.message,
                        companionResolution?.entity?.position || null,
                        { historyMessage: message },
                    );
                    if (dispatched === true) return true;
                    this.holdPosition?.('clarified player intent could not be queued', { preserveDurableWork: true });
                    const response = 'I understood the answer but could not bind it to a safe typed action, so I am still holding position.';
                    await this.history.add(this.name, response);
                    this.history.save();
                    this.routeResponse(source, response);
                    return true;
                }
                if (resolution.state === 'reask') {
                    await this.history.add(source, message);
                    await this.history.add(this.name, resolution.question);
                    this.history.save();
                    this.routeResponse(source, resolution.question);
                    return true;
                }
                if (resolution.state === 'expired' || resolution.state === 'new_request') {
                    this.pending_player_clarification = null;
                }
            }
            const clarification = detectMaterialPlayerClarification(
                canonicalPlayer || source,
                deterministicMessage,
                clarificationContext,
            );
            if (clarification) {
                this.pending_player_clarification = clarification;
                this.holdPosition?.('player clarification pending', { preserveDurableWork: true });
                await this.history.add(source, message);
                await this.history.add(this.name, clarification.question);
                this.history.save();
                this.publishBehaviorEvent?.({
                    type: 'player.clarification_requested',
                    target: { name: clarification.target },
                    evidence: {
                        code: 'material_delivery_recipient_ambiguous',
                        quantity: clarification.quantity,
                        candidateCount: clarification.candidates.length,
                    },
                    salience: 3,
                });
                this.routeResponse(source, clarification.question);
                return true;
            }
            // A multi-step plan ("get 5 logs then build a shelter") is routed
            // deterministically into the Agenda queue before the single-directive
            // path, so serial plans never need a model round trip. A lone task
            // returns false here and continues below unchanged.
            const agendaDispatch = await this.dispatchPlayerAgenda(
                source,
                canonicalPlayer,
                deterministicMessage,
                companionResolution?.entity?.position || null,
            );
            if (agendaDispatch === true) {
                return true;
            }
            playerMessageAlreadyRecorded = Boolean(agendaDispatch?.deferredConstruction);

            // Keep `source` for history, replies, and player-order audit; canonical
            // identity resolution is scoped to deterministic command generation.
            const queuedConstruction = agendaDispatch?.deferredConstruction || null;
            const directive = queuedConstruction
                ? {
                    command: null,
                    response: '',
                    releasesHold: true,
                    deferToModel: true,
                    modelInstruction: queuedConstruction.modelInstruction,
                }
                // Step 6: the regex directive table is the second deterministic
                // interceptor and the one that actually silenced the model. It
                // maps plain language straight onto composite job commands --
                // "get ... wood" becomes !assignHarvestJob("logs", 32, player)
                // with a canned reply -- so for those phrasings the LLM is never
                // consulted. With sequencing on it stands down too.
                : this.llm_sequencing
                ? null
                : resolvePlayerDirective(canonicalPlayer || source, deterministicMessage, {
                    role: this.runtime?.role,
                    bot: this.bot,
                    memoryBank: this.memory_bank,
                    homeState: this.home_state,
                    companion: this.companion_context?.snapshot?.() || null,
                });
            if (directive?.constructionSiteError) {
                await this.history.add(source, message);
                await this.history.add(this.name, directive.response);
                this.history.save();
                this.routeResponse(source, directive.response);
                return true;
            }
            if (directive?.deferToModel === true) {
                const assignmentKind = ['item_plan', 'storage_plan'].includes(directive.assignmentKind)
                    ? directive.assignmentKind
                    : 'construction';
                const deferredAgendaDisposition = ['item_plan', 'storage_plan'].includes(assignmentKind)
                    ? resolvePlayerPlanDisposition(message, {
                        agendaBusy: (this.agenda_director?.snapshot?.().remaining || 0) > 0,
                        operatorHeld: this.isOperatorHeld?.() === true,
                        compilingConstruction: Boolean(this.agenda_director?.activeConstructionIntent?.()),
                    })
                    : 'append';
                // Blueprint/item-plan compilation is cognition, not physical ownership.
                // Retain an existing Stop while the model works; the eventual
                // validated construction command releases it at the same
                // ownership boundary as every other player action. Capturing
                // the generation lets a NEW Stop still cancel this prompt.
                if (queuedConstruction?.entryId) {
                    const compiling = this.agenda_director?.beginConstructionCompilation?.(
                        queuedConstruction.entryId,
                    );
                    if (compiling?.accepted !== true) {
                        this.routeResponse(source, 'I could not begin that construction assignment; no work was started.');
                        return true;
                    }
                }
                const controlBlockGeneration = this.isOperatorHeld()
                    ? null
                    : this.beginInternalControlBlock(
                        `${assignmentKind.replace('_', ' ')} assignment pending`,
                        { kind: 'assignment_compilation' },
                    );
                deferredModelAssignment = {
                    kind: assignmentKind,
                    controlBlockGeneration,
                    agendaEntryId: queuedConstruction?.entryId || null,
                    agendaDisposition: deferredAgendaDisposition,
                    lastFailureSignature: '',
                    repeatedFailures: 0,
                };
                max_responses = Math.min(
                    max_responses,
                    Math.max(
                        1,
                        Math.min(
                            ['item_plan', 'storage_plan'].includes(assignmentKind)
                                ? MAX_ITEM_PLAN_COMPILATION_TURNS
                                : MAX_CONSTRUCTION_COMPILATION_TURNS,
                            Number(this.runtime?.limits?.maxPromptTurns) || 3,
                        ),
                    ),
                );
                this.self_prompter.interruptForManualCommand();
                this.role_director.deferForManualCommand(
                    assignmentKind === 'item_plan'
                        ? 'Player item plan is being compiled.'
                        : assignmentKind === 'storage_plan'
                            ? 'Player storage plan is being compiled.'
                            : 'Player design request is being interpreted.',
                );
                if (directive.modelInstruction) {
                    await this.history.add('system', directive.modelInstruction);
                }
            } else if (directive) {
                await this.history.add(source, message);
                await this.history.add(this.name, `${directive.response} ${directive.command}`);
                this.history.save();
                const directiveCommand = containsCommand(directive.command);
                const assignsTypedGoal = directiveCommand
                    ? commandAssignsPersistentGoal(directiveCommand)
                    : false;
                if (directiveCommand && commandReleasesOperatorHold(directiveCommand)) {
                    const authority = this.claimFreshPlayerActionAuthority(directiveCommand, 'player directive');
                    if (!authority.ready) {
                        this.routeResponse(source, authority.detail);
                        return true;
                    }
                }
                if (directiveCommand && commandTakesManualAutonomy(directiveCommand)) {
                    if (!['!acceptCharcoalMission', '!cancelMission'].includes(directiveCommand)) {
                        this.charcoal_mission?.cancel?.('Superseded by a later deterministic player order.');
                    }
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
            // A persisted Stop holds the body, not the player's ability to
            // issue the next unfamiliar order. Permit cognition to interpret
            // this one action-eligible or response-only utterance against the
            // exact current Hold generation. Physical ownership remains held
            // until a validated action command crosses the normal release
            // boundary below. A newer Stop changes the generation and interrupts
            // the prompt.
            if (['action_eligible', 'response_only'].includes(playerSpeechAuthority) && this.isOperatorHeld()) {
                authorizedModelHoldGeneration = this.operator_hold_generation;
            }
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        if (requestClarificationResolution?.state === 'resolved') {
            const current = this.open_player_request;
            if (this.isCurrentOpenPlayerClarification(
                requestClarificationResolution.requestId,
                requestClarificationResolution.token,
                'RESOLVING',
            )) {
                this.open_player_request = Object.freeze({
                    ...current,
                    clarification: Object.freeze({
                        ...current.clarification,
                        interpretedAnswer: stripLeadingAgentAddress(message, this.name),
                    }),
                });
            }
        }
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => {
            const retainedCompilationBlock = Number.isInteger(deferredModelAssignment?.controlBlockGeneration)
                && this.isCurrentInternalControlBlock(deferredModelAssignment.controlBlockGeneration);
            const retainedPlayerPromptHold = Number.isInteger(authorizedModelHoldGeneration)
                && this.isCurrentOperatorHold(authorizedModelHoldGeneration);
            const compilationBlockSuperseded = Number.isInteger(deferredModelAssignment?.controlBlockGeneration)
                && !retainedCompilationBlock;
            return compilationBlockSuperseded
                || (this.isOperatorHeld() && !retainedPlayerPromptHold)
                || this.self_prompter.shouldInterrupt(self_prompt)
                || this.shut_up
                || convoManager.responseScheduledFor(source);
        };
        
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
        if (!playerMessageAlreadyRecorded) {
            await this.history.add(
                source,
                requestClarificationResolution?.state === 'resolved' ? rawIncomingMessage : message,
            );
        }
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        if (this.llm_sequencing) {
            // Temporary diagnostic, llm_sequencing only. Three live runs ended
            // with the message reaching this point and no command being issued,
            // and the remaining candidates are all runtime values that static
            // reading cannot settle.
            console.log('[llm-seq] entering model loop', JSON.stringify({
                max_responses,
                speechAuthority: playerSpeechAuthority,
                held: this.isOperatorHeld?.() === true,
                holdGeneration: this.operator_hold_generation,
                authorizedGeneration: authorizedModelHoldGeneration,
                shutUp: this.shut_up === true,
                selfPrompterActive: this.self_prompter?.isActive?.() === true,
                interruptNow: checkInterrupt(),
            }));
        }
        // Whether this stall has already been prodded. Re-armed by every command
        // that executes, so one nudge is available per stall rather than one per
        // request. See the conversation-response branch below.
        let stallNudged = false;
        // A fresh player request with action authority becomes THE open request,
        // replacing whatever came before it and resetting the reminder budget.
        // Held on the agent because a request outlives the call that received
        // it: the reminders below fired twice across twenty-eight commands
        // precisely because the counters, and the request text itself, died
        // with the first invocation.
        if (
            !self_prompt
            && !from_other_bot
            && playerSpeechAuthority === 'action_eligible'
            && requestClarificationResolution?.state !== 'resolved'
        ) {
            const requestText = String(message || '').trim();
            this.beginOpenPlayerRequest({
                source,
                canonicalRequester: canonicalPlayer || (source === 'ADMIN' ? 'ADMIN' : null),
                rawRequest: rawIncomingMessage,
                interpretedRequest: requestText,
            });
        }
        const agendaSnapshot = this.agenda_director?.snapshot?.();
        const scopeModelHistoryToOpenRequest = Boolean(
            this.llm_sequencing
            && this.open_player_request
            && !self_prompt
            && !from_other_bot
            && playerSpeechAuthority === 'action_eligible'
            && !this.goal_director?.activeGoal
            && !this.job_director?.activeOrder
            && !(agendaSnapshot?.remaining > 0)
        );
        try {
            for (let i=0; i<max_responses; i++) {
                if (checkInterrupt()) {
                    if (this.llm_sequencing) console.log('[llm-seq] broke on checkInterrupt at turn', i);
                    break;
                }
                let history = this.history.getHistory();
                // A fresh unowned physical request must not inherit executable
                // authority from commands generated for a cancelled request.
                // Keep the durable transcript for audit and conversation, but
                // expose only this request and its subsequent outcomes to the
                // model turn that is choosing physical work.
                if (scopeModelHistoryToOpenRequest) {
                    history = conversationFromOpenPlayerRequest(
                        history,
                        this.open_player_request,
                    );
                }
                const requestAtPrompt = this.open_player_request;
                const promptResult = await this.prompter.promptConvo(history, {
                    typedResult: true,
                    requestContext: requestInterpretationPromptContext(requestAtPrompt),
                });
                let res = String(promptResult?.text || '');

            console.log(`${this.name} full response to ${source}: ""${res}""`);
            if (this.llm_sequencing) console.log('[llm-seq] model returned', JSON.stringify(String(res || '').slice(0, 300)));

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

                const modelClarificationQuestion = promptResult?.kind === 'clarification'
                    ? String(promptResult.question || res).trim()
                    : '';
                if (
                    modelClarificationQuestion
                    && !self_prompt
                    && !from_other_bot
                    && playerSpeechAuthority === 'action_eligible'
                    && !deferredModelAssignment
                ) {
                    const waiting = this.requestOpenPlayerClarification(
                        requestAtPrompt?.requestId,
                        modelClarificationQuestion,
                    );
                    if (waiting) {
                        await this.history.add(this.name, modelClarificationQuestion);
                        this.history.save();
                        this.publishBehaviorEvent?.({
                            type: 'player.clarification_requested',
                            target: { name: waiting.requester.canonical },
                            evidence: {
                                code: 'model_request_ambiguous',
                                requestId: waiting.requestId,
                                token: waiting.clarification.token,
                            },
                            salience: 3,
                        });
                        this.routeResponse(waiting.requester.replySource || source, modelClarificationQuestion);
                        break;
                    }
                }

                if (
                    requestClarificationResolution?.state === 'resolved'
                    && !this.isCurrentOpenPlayerClarification(
                        requestClarificationResolution.requestId,
                        requestClarificationResolution.token,
                        'RESOLVING',
                    )
                ) break;

                let command_name = containsCommand(res);
                if (
                    command_name
                    && !self_prompt
                    && !from_other_bot
                    && playerSpeechAuthority === 'action_eligible'
                    && !deferredModelAssignment
                ) {
                    const requestText = requestClarificationResolution?.state === 'resolved'
                        ? this.open_player_request?.interpretedRequest || message
                        : message;
                    const typedGoalDirective = resolveTypedItemGoalDirective(source, requestText, { bot: this.bot });
                    const promoted = promoteModelItemGoalCommand(res, typedGoalDirective);
                    if (promoted) {
                        console.log(`[mission-policy] promoted player-origin item work from ${command_name} to !requestItemGoal`);
                        res = promoted;
                        command_name = containsCommand(res);
                    }
                }

            if (command_name) { // contains query or command
                if (
                    modelCommandAwaitsPlayerConfirmation(res, command_name)
                    && CONFIRMATION_REQUIRED_COMMANDS.has(command_name)
                ) {
                    const proposal = res.substring(0, res.indexOf(command_name)).trim();
                    await this.history.add(this.name, proposal);
                    await this.history.add(
                        'system',
                        `No command was executed: ${command_name} was presented as a proposal awaiting player confirmation.`,
                    );
                    this.routeResponse(source, proposal);
                    break;
                }
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);

                const allowedDeferredCommands = deferredModelAssignment?.kind === 'item_plan'
                    ? PLAYER_ITEM_PLAN_COMMANDS
                    : deferredModelAssignment?.kind === 'storage_plan'
                        ? PLAYER_STORAGE_PLAN_COMMANDS
                        : PLAYER_DESIGN_COMMANDS;
                if (deferredModelAssignment && !allowedDeferredCommands.has(command_name)) {
                    await this.history.add(
                        'system',
                        deferredModelAssignment.kind === 'item_plan'
                            ? `No command was executed: this item-plan assignment requires one !queueItemPlan, not ${command_name}.`
                            : deferredModelAssignment.kind === 'storage_plan'
                                ? `No command was executed: this storage-plan assignment requires one !queueStoragePlan, not ${command_name}.`
                                : `No command was executed: this construction assignment requires !buildStructure or !designStructure, not ${command_name}.`,
                    );
                    continue;
                }

                if (playerSpeechAuthority !== 'action_eligible') {
                    const conversationalPrefix = res.substring(0, res.indexOf(command_name)).trim();
                    await this.history.add(
                        'system',
                        'No command was executed because the player message did not grant the bot physical-action authority.',
                    );
                    this.routeResponse(source, conversationalPrefix || 'Understood. I will leave that work to you.');
                    break;
                }
                
                if (!commandExists(command_name)) {
                    // Naming the alternatives matters most when the surface is
                    // reduced: a live run spent two of its turns re-guessing
                    // !collectWoodInRange, which the allowlist had removed. The
                    // model recovered on its own, but only after wasting turns
                    // it did not have. Tell it what it may actually call.
                    const available = getCommandManifest({ blocked: this.blocked_actions })
                        .map((command) => command.name);
                    const hint = available.length && available.length <= 40
                        ? ` Available commands: ${available.join(' ')}.`
                        : '';
                    this.history.add('system', `Command ${command_name} does not exist.${hint}`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                if (!self_prompt && !from_other_bot) {
                    const assignsTypedGoal = commandAssignsPersistentGoal(command_name);
                    if (!deferredModelAssignment && commandReleasesOperatorHold(command_name)) {
                        const authority = this.claimFreshPlayerActionAuthority(command_name, 'player command');
                        if (!authority.ready) {
                            this.routeResponse(source, authority.detail);
                            return true;
                        }
                    }
                    if (commandTakesManualAutonomy(command_name)) {
                        if (!['!acceptCharcoalMission', '!cancelMission'].includes(command_name)) {
                            this.charcoal_mission?.cancel?.('Superseded by later player-authorized model work.');
                        }
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

                if (
                    requestClarificationResolution?.state === 'resolved'
                    && !this.isCurrentOpenPlayerClarification(
                        requestClarificationResolution.requestId,
                        requestClarificationResolution.token,
                        'RESOLVING',
                    )
                ) break;
                const commandOwner = self_prompt || source === 'system' ? 'autonomy' : 'player';
                const commandExecution = await executeCommand(this, res, {
                    owner: commandOwner,
                    routeOrigin: 'model-selected',
                    agendaDisposition: deferredModelAssignment?.agendaDisposition || 'append',
                    returnExecution: true,
                });
                const execute_res = commandExecution?.value;

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;
                // A command is real progress, so the stall nudge below re-arms.
                // One nudge per stall, not one per request: a dozen-step chain
                // stalls a dozen times and each one deserves the same single
                // prod, while a model that stops twice running has genuinely
                // stopped and is left alone.
                stallNudged = false;

                if (execute_res)
                    this.history.add('system', execute_res);
                if (command_name === '!acceptCharcoalMission' && this.charcoal_mission?.hasActiveMission?.()) {
                    this.history.save();
                    break;
                }
                const durableSubmission = commandExecution?.durableSubmission || null;
                if (correlatedPersistentGoalAssignmentAccepted({
                    commandName: command_name,
                    requestContext: commandExecution?.requestContext,
                    submission: durableSubmission,
                    activeGoal: this.goal_director?.activeGoal,
                })) {
                    // GoalDirector now owns the durable physical work and its
                    // terminal player handoff. Asking the model for another
                    // command here creates a second owner for the same request.
                    this.history.save();
                    break;
                }
                const submittedJob = durableSubmission;
                const persistentJobAccepted = correlatedPersistentJobSubmissionAccepted({
                    commandName: command_name,
                    requestContext: commandExecution?.requestContext,
                    submission: submittedJob,
                    activeOrder: this.job_director?.activeOrder,
                });
                if (persistentJobAccepted && !deferredModelAssignment) {
                    // JobDirector now owns durable progression for the order
                    // created by this exact request. Yield model-turn
                    // continuation; ActionManager remains the sole body owner.
                    this.history.save();
                    break;
                }
                const agendaPlanAccepted = correlatedAgendaPlanSubmissionAccepted({
                    deferredAssignment: deferredModelAssignment,
                    commandName: command_name,
                    requestContext: commandExecution?.requestContext,
                    submission: durableSubmission,
                    agendaEntries: this.agenda_director?.entries,
                });
                if (agendaPlanAccepted && !deferredModelAssignment) {
                    // A complete typed project is now durably installed. The
                    // model turn that selected it must end here: continuing the
                    // same player request can manufacture a second child plan
                    // that cancels the Agenda's active Job and strands every
                    // dependency behind it.
                    this.history.save();
                    break;
                }
                // Quote the player back every few commands while their request
                // is still open. Bounded, because a reminder that never stops
                // is just noise, and silent after the request is satisfied --
                // the model ends the loop by answering without a command, and
                // the stall nudge covers that.
                // Counted on the agent, not on this call, so a chain spread over
                // several invocations is still measured as one piece of work.
                // Fires regardless of what started THIS invocation -- an action
                // result or a system nudge does not mean the player's request
                // stopped being the job.
                this.commands_since_request_reminder += 1;
                const openRequest = this.open_player_request;
                if (
                    this.llm_sequencing
                    && openRequest
                    && !this.isOperatorHeld()
                    && this.commands_since_request_reminder >= COMMANDS_BETWEEN_REQUEST_REMINDERS
                    && this.request_reminders_sent < MAX_REQUEST_REMINDERS
                ) {
                    this.commands_since_request_reminder = 0;
                    this.request_reminders_sent += 1;
                    await this.history.add(
                        'system',
                        `Still open, in ${openRequest.requester?.replySource || source}'s own words: "${String(openRequest.interpretedRequest || '').slice(0, 300)}".`
                        + ' If you already have what was asked for, hand it over now and say so.'
                        + ' If a step remains, do that step. Gathering more than the request needs is not the request.',
                    );
                }
                const deferredAssignmentAccepted = ['item_plan', 'storage_plan'].includes(deferredModelAssignment?.kind)
                    ? agendaPlanAccepted
                    : persistentJobAccepted;
                if (deferredAssignmentAccepted) {
                    const acceptedAssignmentKind = deferredModelAssignment.kind;
                    const acceptedControlBlockGeneration = deferredModelAssignment.controlBlockGeneration;
                    if (acceptedAssignmentKind === 'construction' && deferredModelAssignment.agendaEntryId) {
                        const binding = this.agenda_director?.bindConstruction?.(
                            deferredModelAssignment.agendaEntryId,
                            submittedJob.activeOrderId,
                        );
                        if (binding?.accepted !== true) {
                            const detail = `The structure job was accepted, but its durable agenda barrier could not be bound (${binding?.code || 'unknown error'}). Further automatic body work is quarantined.`;
                            await this.history.add('system', detail);
                            this.beginInternalControlBlock('construction agenda binding failed', { kind: 'quarantine' });
                            this.routeResponse(source, detail);
                            break;
                        }
                    }
                    deferredModelAssignment = null;
                    this.releaseInternalControlBlock(
                        acceptedAssignmentKind === 'item_plan'
                            ? 'player item plan accepted'
                            : acceptedAssignmentKind === 'storage_plan'
                                ? 'player storage plan accepted'
                                : 'player design work order accepted',
                        acceptedControlBlockGeneration,
                    );
                    this.history.save();
                    break;
                }
                if (deferredModelAssignment && allowedDeferredCommands.has(command_name)) {
                    const failureSignature = String(execute_res || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 280);
                    if (failureSignature) {
                        deferredModelAssignment.repeatedFailures = failureSignature === deferredModelAssignment.lastFailureSignature
                            ? deferredModelAssignment.repeatedFailures + 1
                            : 1;
                        deferredModelAssignment.lastFailureSignature = failureSignature;
                        if (deferredModelAssignment.repeatedFailures >= 2) {
                            await this.history.add(
                                'system',
                                `${deferredModelAssignment.kind === 'item_plan' ? 'Item-plan' : deferredModelAssignment.kind === 'storage_plan' ? 'Storage-plan' : 'Construction'} compilation stopped because the same rejected result repeated without progress.`,
                            );
                            break;
                        }
                    }
                }
                const commandResult = commandExecution?.result || null;
                const terminalActionFailure = self_prompt
                    && isAction(command_name)
                    && commandResult?.actionId
                    && commandResult.phase !== 'succeeded'
                    && commandResult.retryable === false;
                if (!execute_res || terminalActionFailure)
                    break;
            }
            else { // conversation response
                if (deferredModelAssignment) {
                    const compilingItemPlan = deferredModelAssignment.kind === 'item_plan';
                    const compilingStoragePlan = deferredModelAssignment.kind === 'storage_plan';
                    const detail = compilingItemPlan
                        ? 'I did not produce a valid bounded item plan, so no work was queued. I am holding position.'
                        : compilingStoragePlan
                            ? 'I did not produce a valid bounded storage plan, so no work was queued. I am holding position.'
                            : 'I did not produce a valid bounded construction command, so no work order was created. I am holding position.';
                    await this.history.add(this.name, detail);
                    await this.history.add(
                        'system',
                        compilingItemPlan
                            ? 'The item request remains unassigned. Transcript claims are not durable work; only a correlated persisted Agenda plan may claim the checklist is queued.'
                            : compilingStoragePlan
                                ? 'The storage request remains unassigned. Transcript claims are not durable work; only a correlated persisted Agenda plan may claim cleanup is queued.'
                                : 'The construction request remains unassigned. Transcript claims are not durable work; only an active JobDirector order may claim construction is registered or underway.',
                    );
                    this.releaseInternalControlBlock(
                        'assignment compilation returned without durable work',
                        deferredModelAssignment.controlBlockGeneration,
                    );
                    this.history.save();
                    this.routeResponse(source, detail);
                } else {
                    this.history.add(this.name, res);
                    this.routeResponse(source, res);
                    // Nothing owns a plain-language multi-step request across
                    // turns. goal-director owns typed goals, self-prompter owns
                    // autonomous ones, agenda-director owns parsed plans -- but
                    // "Go get some wood and make me some charcoal" under
                    // llm_sequencing is owned by nobody, and this branch ends
                    // the loop the first time the model answers without a
                    // command. latestMessageRequestsAction stops requiring one
                    // as soon as any command has produced an outcome, so from
                    // turn two onward the companion is free to stop mid-chain.
                    //
                    // On 2026-08-17 both halves of the charcoal gate did exactly
                    // that. Direct crafted a stone pickaxe at t+95s and said
                    // "ready for use. Let me know what you want to do next!";
                    // natural language stopped at t+102s. Both then stood idle,
                    // not held, for eighteen of their twenty minutes. Answering
                    // questions does not reach this: neither stall was a
                    // question, and one had no question mark at all.
                    //
                    // So prod it once. If a step remains the model issues it and
                    // the chain continues; if it is genuinely finished it says
                    // so and the second command-less answer ends the loop. The
                    // cost of being wrong is one turn.
                    if (
                        this.llm_sequencing
                        && !stallNudged
                        && used_command
                        && !self_prompt
                        && playerSpeechAuthority === 'action_eligible'
                        && !this.isOperatorHeld()
                        && !checkInterrupt()
                    ) {
                        stallNudged = true;
                        await this.history.add(
                            'system',
                            // Quote it. Asked for charcoal, one run answered the
                            // nudge with "I have no outstanding steps now and
                            // have crafted 24 torches as confirmed by: Action
                            // output: Crafted 24 torch." That is real evidence
                            // for the wrong thing, and it happened because the
                            // nudge described the request instead of repeating
                            // it. The words the player used are the standard.
                            `This is what ${this.open_player_request?.requester?.replySource || source} asked for:`
                            + ` "${String(this.open_player_request?.interpretedRequest || message || '').slice(0, 300)}".`
                            + ' It is not finished and nothing is running.'
                            + ' If a step remains, issue the next command now.'
                            + ' If you are blocked, name exactly what is missing.'
                            // The first version of this offered "if it is
                            // complete, say so plainly and stop", and the model
                            // took that exit with no charcoal in its inventory:
                            // "No unfinished step remains from the last
                            // request." A bare completion claim is precisely
                            // what the rest of this prompt stack forbids, so the
                            // exit stays open but has to be paid for the same
                            // way every other success claim is.
                            + ' If you believe it is already complete, name the command output that confirms'
                            + ' the player got what they asked for; do not claim completion from memory.'
                            + ' Do not ask permission to continue work you were already asked to do.',
                        );
                        this.history.save();
                        continue;
                    }
                }
                break;
            }
            
            this.history.save();
            }
        } finally {
            if (deferredModelAssignment) {
                const interrupted = checkInterrupt();
                const compilingItemPlan = deferredModelAssignment.kind === 'item_plan';
                const compilingStoragePlan = deferredModelAssignment.kind === 'storage_plan';
                const compiledLabel = compilingItemPlan ? 'Item-plan' : compilingStoragePlan ? 'Storage-plan' : 'Construction';
                const assignmentState = interrupted ? 'interrupted' : 'compilation_exhausted';
                const code = interrupted
                    ? `${compilingItemPlan ? 'item_plan' : compilingStoragePlan ? 'storage_plan' : 'construction'}_compilation_interrupted`
                    : `${compilingItemPlan ? 'item_plan' : compilingStoragePlan ? 'storage_plan' : 'construction'}_compilation_exhausted`;
                const detail = interrupted
                    ? `${compiledLabel} compilation was interrupted before a correlated durable assignment was accepted.`
                    : `${compiledLabel} compilation ended without a correlated durable assignment.`;
                let constructionSettlement = null;
                if (!compilingItemPlan && !compilingStoragePlan && deferredModelAssignment.agendaEntryId) {
                    constructionSettlement = this.agenda_director?.failConstructionAssignment?.(
                        deferredModelAssignment.agendaEntryId,
                        assignmentState,
                        code,
                        detail,
                    );
                }
                const releasedForAgendaContinuation = this.releaseFailedConstructionCompilationBlock?.(
                    deferredModelAssignment,
                    constructionSettlement,
                ) === true;
                if (!releasedForAgendaContinuation) {
                    this.releaseInternalControlBlock(
                        'assignment compilation ended without durable work',
                        deferredModelAssignment.controlBlockGeneration,
                    );
                }
                await this.history.add('system', detail);
                deferredModelAssignment = null;
            }
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
            const outgoingSegments = boundedChatSegments(String(translated || '').trim());
            if (outgoingSegments.length === 0) return false;

            let delivered = false;
            if (settings.only_chat_with.length === 0 && settings.speak) {
                void Promise.resolve()
                    .then(() => speak(toTranslate, this.prompter.profile.speak_model, { priority }))
                    .catch(error => console.warn(`[dialogue] Speech output failed: ${String(error?.message || error).slice(0, 240)}`));
            }
            for (const outgoing of outgoingSegments) {
                const waitMs = Math.max(0, MIN_INGAME_CHAT_INTERVAL_MS - (Date.now() - this._lastChatSentAt));
                if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
                this._lastChatSentAt = Date.now();

                if (settings.only_chat_with.length > 0) {
                    for (const username of settings.only_chat_with) {
                        try {
                            this.bot.whisper(username, outgoing);
                            delivered = true;
                        } catch (error) {
                            console.warn(`[dialogue] Whisper to ${username} failed: ${String(error?.message || error).slice(0, 240)}`);
                        }
                    }
                    continue;
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
        const pendingDeath = this.memory_bank?.recallLatestDeath?.();
        const pendingDeathRecordedAt = Number(pendingDeath?.recordedAt);
        if (
            pendingDeath
            && !pendingDeath.recoveredAt
            && Number.isSafeInteger(pendingDeathRecordedAt)
            && Date.now() - pendingDeathRecordedAt <= 15 * 60_000
        ) this._trackedDeathRecoveryRecordedAt = pendingDeathRecordedAt;
        const refreshAliveInventorySnapshot = () => {
            if (Number(this.bot.health) <= 0) return;
            const now = Date.now();
            if (now - this._lastAliveInventorySnapshotAt < 250) return;
            this._lastAliveInventorySnapshot = inventorySnapshot(this.bot);
            this._lastAliveInventorySnapshotAt = now;
            if (
                Number.isSafeInteger(this._trackedDeathRecoveryRecordedAt)
                && now >= this._deathRecoveryObservationNotBefore
            ) {
                const recovery = this.memory_bank?.observeDeathRecoveryInventory?.(
                    this._lastAliveInventorySnapshot,
                    {
                        recordedAt: this._trackedDeathRecoveryRecordedAt,
                        dimension: this.bot.game?.dimension,
                        observedAt: now,
                        source: 'alive_inventory_observation',
                    },
                );
                if (recovery?.complete || recovery?.code === 'death_not_pending') {
                    this._trackedDeathRecoveryRecordedAt = null;
                }
            }
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
            const weather = minecraftWeather(this.bot).toLowerCase();
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
        this.bot.lastDamageSource = null;
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
            // Damage proximity authorizes command-mode self-defense only while
            // it belongs to the current living body. Mineflayer can retain the
            // old hostile for a few ticks while Paper replaces the player
            // entity on respawn; carrying this edge across death can start a
            // new engagement against a stale entity generation.
            this.bot.lastDamageTime = 0;
            this.bot.lastDamageTaken = 0;
            this.bot.lastDamageSource = null;
            const position = this.bot.entity?.position;
            const dimension = this.bot.game?.dimension;
            const observedInventory = inventorySnapshot(this.bot);
            const inventory = Object.keys(observedInventory).length > 0
                ? observedInventory
                : { ...this._lastAliveInventorySnapshot };
            const recoverableItems = Object.values(inventory)
                .reduce((total, count) => total + count, 0);
            const deathPersistence = position
                ? this.memory_bank.recordDeath(position, dimension, inventory)
                : Object.freeze({
                    stored: false,
                    code: 'death_position_missing',
                    record: null,
                });
            if (deathPersistence.stored && Number.isSafeInteger(Number(deathPersistence.record?.recordedAt))) {
                this._trackedDeathRecoveryRecordedAt = Number(deathPersistence.record.recordedAt);
                // Let Paper finish the respawn/inventory-clear edge before an
                // alive snapshot is allowed to count as recovered material.
                this._deathRecoveryObservationNotBefore = Date.now() + 1_000;
            }
            this.goal_director?.reconcileDeath?.({
                position,
                dimension,
                recoverableItems,
                deathRecord: deathPersistence.record,
                deathPersistenceCode: deathPersistence.code,
            });
            this.job_director?.reconcileDeath?.({
                position,
                dimension,
                recoverableItems,
                deathRecord: deathPersistence.record,
                deathPersistenceCode: deathPersistence.code,
            });
            this.agenda_director?.reconcileDeath?.({
                position,
                dimension,
            });
            this.survival_director?.reconcileDeath?.();
            this.publishBehaviorEvent({
                type: 'self.died',
                target: position ? { name: 'death', x: position.x, y: position.y, z: position.z } : { name: 'death' },
                evidence: {
                    amount: recoverableItems,
                    code: deathPersistence.code,
                    phase: deathPersistence.stored === true ? 'stored' : 'not_stored',
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
            const receipt = observeReceivedDamageSource(this.bot, entity, source, {
                requester: this.companion_context?.snapshot?.().canonicalUsername || '',
                isHostile: candidate => mc.isHostile(candidate),
            });
            if (receipt.matchesSelf) {
                this.bot.lastDamageSource = receipt;
                this.survival_director?.observeDamageSource?.(receipt);
                this.behavior_arbiter?.wake?.('self_damage_source_observed');
            }
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
            // `idle` is a wake-up edge, not body authority. Delayed legacy
            // emitters can publish it after ActionManager has already leased
            // the body to the next job. Clearing Pathfinder in that interval
            // terminalizes a valid route as PathStopped with no preemption
            // receipt. Only a physically unleased body may be normalized.
            if (!idleSignalMayReleaseBody(this)) {
                this.behavior_arbiter?.wake?.('stale_idle_signal_ignored');
                return;
            }
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
        const result = await this.behavior_arbiter.update(delta);
        this.flight_recorder?.observeRuntime?.();
        return result;
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
            await this.flight_recorder?.close?.(msg);
            this.history.add('system', String(msg || 'Killing agent process...').slice(0, 500));
            try { this.bot.chat(code > 1 ? 'Restarting.' : 'Exiting.'); } catch { /* disconnected bot */ }
            // Let an in-flight summary land before saving, so shutdown does not
            // persist a memory older than the transcript beside it. Bounded:
            // a stalled provider must not hold the process open.
            if (this.history.flush && !(await this.history.flush(2_000))) {
                console.warn(`[${this.name}] History summary did not settle before exit; memory may lag the transcript.`);
            }
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
