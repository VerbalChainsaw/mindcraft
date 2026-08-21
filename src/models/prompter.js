import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'fs';
import { Examples } from '../utils/examples.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';
import { containsCommand, getCommandDocs } from '../agent/commands/index.js';
import { identityPrompt } from '../agent/runtime/identity-config.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../agent/settings.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createModel, resolveConfiguredModel } from './_model_map.js';
import { createRoutedModel, FallbackRouter } from './fallback-router.js';
import { PROVIDER_FAILURE_TEXT } from './provider-failure.js';
import { buildPromptMemory } from '../agent/runtime/memory-recall.js';
import { getFullState } from '../agent/library/full_state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SENSITIVE_MODEL_CONFIGURATION_KEY = /(?:^|_)(?:api[_-]?key|access[_-]?token|token|secret|password)(?:$|_)/i;

function canonicalMeasurementValue(value, key = '') {
    if (SENSITIVE_MODEL_CONFIGURATION_KEY.test(key)) return '[redacted]';
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (Array.isArray(value)) return value.map(item => canonicalMeasurementValue(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value)
            .sort((left, right) => left.localeCompare(right))
            .map(nestedKey => [nestedKey, canonicalMeasurementValue(value[nestedKey], nestedKey)]));
    }
    return String(value);
}

export function fingerprintModelMeasurement(value) {
    return createHash('sha256')
        .update(JSON.stringify(canonicalMeasurementValue(value)))
        .digest('hex');
}

export function fingerprintConfiguredConversationModel(profile) {
    return fingerprintModelMeasurement({
        api: profile?.api ?? null,
        model: profile?.model ?? null,
        params: profile?.params ?? null,
        url: profile?.url ?? null,
    });
}

function selectedConversationModelRouteFingerprint(model) {
    let active = null;
    try {
        active = model?.snapshot?.()?.active ?? model?.lastUsed ?? null;
    } catch {
        active = null;
    }
    return fingerprintModelMeasurement(active || model?.constructor?.name || 'configured-model');
}

const ACTION_REQUEST_PATTERN = /\b(?:attack|break|brew|build|chop|collect|come|craft|dig|drop|eat|equip|explore|fight|find|follow|gather|give|go|harvest|jump|kill|look|mine|move|place|plant|recover|retrieve|run|search|stay|stop|turn|use|walk|wait)\b/i;
const UNSUPPORTED_CAPABILITY_PATTERN = /^\[UNSUPPORTED\]\s+([^\r\n]{1,220})$/i;
const GAMEPLAY_OPERATING_RULES = [
    'GAMEPLAY OPERATING RULES:',
    'Treat SITUATIONAL_AWARENESS, INVENTORY, command results, and the connected Minecraft registry as authoritative.',
    'Behave like a competent, considerate Minecraft player: prefer the nearby safe reversible route, preserve useful terrain and family builds, finish what you harvest, clean temporary access blocks, avoid needless holes and scaffolds, and do not waste tools or materials.',
    'Preserve every named player, item, quantity, custody relation, destination, sequence, and terminal instruction such as "then wait". Never replace an unspecified recipient with the requester, yourself, or another convenient player.',
    'If identity, custody, destination, destructive world change, safety, or major material/time cost has two materially different plausible meanings, take no action and ask exactly one short concrete question. Emit it as `[CLARIFY] Your question?` with no command. Do not ask about harmless details that have one safe reversible default.',
    'If the requested action is outside your actual capabilities or permissions, take no substitute action. Emit exactly `[UNSUPPORTED] concise missing capability or permission.` with no command.',
    'A physical task is complete only when current Minecraft state verifies its whole postcondition, including cleanup, exact custody/destination, and any final wait or return.',
    'Never claim that a carried item is absent or "did not register" when INVENTORY lists it. A current snapshot cannot prove whether an item is newly received; report only the exact carried and nearby-drop evidence.',
    'For an unfamiliar item or block, use !inspectMinecraft with its name; use !getCraftingPlan when a recipe chain is unclear.',
    'For an acquisition or delivery outcome, prefer one typed !requestItemGoal; its causal planner derives and verifies prerequisites one physical step at a time.',
    'For a natural-language promise whose final delivered item is charcoal, use exactly one !acceptCharcoalMission(quantity). Choose the exact promised quantity, using 8 as the safe bounded default for “some”; after acceptance the deterministic Mission owns prerequisites, custody, delivery, cleanup, and replanning, so do not sequence its primitive commands yourself.',
    'When one broad player outcome requires you to choose several concrete inventory outputs, compile the complete final inventory floors once with !queueItemPlan. Account for current inventory, use real registry-backed targets, and never invent an umbrella target such as starter_kit. A typed runtime barrier re-verifies the whole promised set after production.',
    'For complex work, compose available primitives: observe, preflight tools/materials/reachability/hazards, act once, verify the result, then adapt.',
    'Use canonical Minecraft names from inspection. Never invent an item, tool requirement, recipe, location, action result, or completed step.',
].join('\n');
const MAX_GENERATION_LOG_CHARS = 2_000;
const RECENT_ACTION_GROUNDING_MS = 120_000;
const ACTION_DENIAL_PATTERN = new RegExp([
    String.raw`\b(?:i|we|it|the bot)?\s*(?:have|has|had)?\s*not\s+(?:begun|started|collected|gathered|cut|chopped|harvested|finished|completed)\b`,
    String.raw`\b(?:i|we|it|the bot)?\s*(?:haven't|hasn't|hadn't)\s+(?:begun|started|collected|gathered|cut|chopped|harvested|finished|completed)\b`,
    String.raw`\bno\s+(?:[a-z0-9_-]+\s+){0,3}(?:(?:have|has|had|were|was)\s+)?(?:been\s+)?(?:collected|gathered|cut|chopped|harvested|completed|changed)\b`,
    String.raw`\b(?:nothing|no work)\s+(?:(?:has|had)\s+)?(?:been\s+)?(?:done|started|completed)\b`,
].join('|'), 'i');
const GROUNDING_STOP_WORDS = new Set([
    'about', 'action', 'after', 'again', 'been', 'before', 'blocks', 'bounded', 'complete',
    'completed', 'could', 'did', 'does', 'from', 'have', 'into', 'just', 'latest', 'nearby',
    'output', 'result', 'skill', 'that', 'their', 'there', 'these', 'they', 'this', 'those',
    'verified', 'were', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);
const CATEGORICAL_SAFETY_PATTERNS = [
    /\b(?:we(?:'re| are)|you(?:'re| are)|it(?:'s| is)|here is|this (?:spot|area|place) is)\s+(?:completely\s+|perfectly\s+|currently\s+|still\s+|quite\s+)?safe\b/gi,
    /\bsafe to (?:stand|stay|wait|pause|remain)\b/gi,
    /\bcan (?:stand|stay|wait|pause|remain)\b[^.!?\n]{0,32}\bsafely\b/gi,
];

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertsCategoricalSafety(text) {
    for (const pattern of CATEGORICAL_SAFETY_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const prefix = text.slice(Math.max(0, match.index - 56), match.index);
            const suffix = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
            if (/^\s+to say\b/i.test(suffix)) continue;
            if (/(?:\bnot\s+|\b(?:can't|cannot|won't|wouldn't|don't|do not)\s+(?:say|promise|guarantee|confirm)[^.!?\n]{0,20})$/i.test(prefix)) {
                continue;
            }
            return true;
        }
    }
    return false;
}

export function conversationGroundingViolation(generation, perception = {}, messages = []) {
    const text = String(generation || '').trim();
    if (!text) return null;

    const groundingState = perception?.perception
        ? perception
        : { perception };
    const recentAction = recentActionGrounding(groundingState);
    const latestPlayerMessage = latestUserContent(messages);
    if (
        recentAction?.result?.phase === 'succeeded'
        && latestPlayerMessage
        && groundingTermsOverlap(latestPlayerMessage, recentAction.searchText)
        && ACTION_DENIAL_PATTERN.test(text)
    ) {
        const result = recentAction.result;
        return {
            code: 'contradicts_recent_action_result',
            correction: `\nCRITICAL GROUNDING RETRY: The latest relevant structured action receipt is authoritative: phase=${result.phase}; code=${result.code}; detail=${result.detail || result.label || 'no additional detail'}. Do not say this work has not begun, that no progress occurred, or that nothing changed. Answer the player's question from the receipt and current inventory; do not invent unverified cleanup or delivery.`,
            fallback: groundedActionResultFallback(result),
        };
    }

    const activePerception = groundingState.perception || {};
    const hostiles = Array.isArray(activePerception?.hostiles) ? activePerception.hostiles : [];
    if (hostiles.length === 0) return null;

    const hostileNames = hostiles
        .map(hostile => escapeRegExp(hostile?.name))
        .filter(Boolean);
    const hostileSubject = ['neither', 'none', 'they', 'them', 'it', 'hostiles?', 'mobs?', ...hostileNames]
        .join('|');
    const routeClaim = new RegExp(
        `\\b(?:${hostileSubject})\\b[^.!?\\n]{0,40}\\b(?:has|have|had|finds?|can(?:not|'t)?|could(?:n't| not)?|will|won't|is able to|is unable to)\\b[^.!?\\n]{0,40}\\b(?:paths?|routes?|ways?|reach(?:es|ed|ing)?|get(?:s|ting)? to)\\b`,
        'i',
    );
    const expressesRouteUncertainty = /\b(?:unclear|unknown|not sure|can't tell|cannot tell|don't know|do not know|no (?:route|path|reachability) proof|can't confirm|cannot confirm)\b/i.test(text);
    if (routeClaim.test(text) && !expressesRouteUncertainty) {
        return {
            code: 'unsupported_hostile_route_claim',
            correction: '\nCRITICAL GROUNDING RETRY: SITUATIONAL_AWARENESS reports hostile line of sight, distance, direction, and motion; it does not prove whether a hostile has a navigable route. Occluded means out of line of sight only. Do not claim that a hostile can or cannot reach anyone, or that it has or lacks a path. State the observed facts and leave reachability unknown.',
        };
    }

    const primary = activePerception?.primaryThreat || hostiles[0] || null;
    const priority = String(primary?.threatPriority || '').toLowerCase();
    const motion = String(primary?.motion || '').toLowerCase();
    const distance = Number(primary?.distance);
    const materialThreat = (
        priority === 'high'
        || priority === 'critical'
        || (motion === 'approaching' && Number.isFinite(distance) && distance <= 16)
    );
    if (!materialThreat || !assertsCategoricalSafety(text)) return null;

    const evidence = [
        primary?.name || 'hostile',
        Number.isFinite(distance) ? `${distance} blocks ${primary?.direction || 'away'}` : null,
        motion || null,
        priority ? `threat=${priority}` : null,
        primary?.visible === false ? 'occluded' : primary?.visible === true ? 'visible' : 'visibility unknown',
    ].filter(Boolean).join(', ');
    return {
        code: 'unsupported_hostile_safety_claim',
        correction: `\nCRITICAL GROUNDING RETRY: Do not promise or categorically declare safety while authoritative perception reports ${evidence}. Report the exact observed threat and uncertainty. Occlusion alone is not route or safety proof.`,
    };
}

function latestUserContent(messages = []) {
    const latest = Array.isArray(messages)
        ? messages.findLast(message => message?.role === 'user')
        : null;
    return String(latest?.content || '').replace(/^[^:]{1,64}:\s*/, '').trim();
}

function groundingTerms(value) {
    return new Set(String(value || '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .match(/[a-z0-9-]{4,}/g)
        ?.filter(term => !GROUNDING_STOP_WORDS.has(term)) || []);
}

function groundingTermsOverlap(playerText, resultText) {
    const playerTerms = groundingTerms(playerText);
    const resultTerms = groundingTerms(resultText);
    return [...playerTerms].some(term => resultTerms.has(term));
}

function recentActionGrounding(state = {}) {
    const result = state?.action?.lastResult;
    if (!result || typeof result !== 'object') return null;
    const sampledAt = Number(state?._meta?.sampledAt);
    const finishedAt = Number(result.finishedAt);
    if (!Number.isFinite(sampledAt) || !Number.isFinite(finishedAt)) return null;
    const ageMs = sampledAt - finishedAt;
    if (ageMs < 0 || ageMs > RECENT_ACTION_GROUNDING_MS) return null;
    const target = result.target && typeof result.target === 'object'
        ? Object.values(result.target).filter(value => typeof value === 'string').join(' ')
        : '';
    return {
        result,
        ageMs,
        searchText: [result.code, result.label, result.detail, target].filter(Boolean).join(' '),
    };
}

export function recentActionGroundingPrompt(state = {}) {
    const recent = recentActionGrounding(state);
    if (!recent) return '';
    const { result, ageMs } = recent;
    return [
        'LATEST STRUCTURED ACTION RECEIPT (authoritative evidence about the completed attempt; current snapshots remain authoritative for current state):',
        `- Age: ${ageMs} ms`,
        `- Phase/code: ${result.phase}/${result.code || 'unknown'}`,
        `- Action: ${result.label || 'unknown'}`,
        result.target?.name ? `- Target: ${result.target.name}` : '',
        `- Verified detail: ${result.detail || 'no additional detail'}`,
        '- Do not infer that idle now means this action never started. Do not extend this receipt into unverified delivery, cleanup, or continuing-state claims.',
    ].filter(Boolean).join('\n');
}

export function groundedActionResultFallback(result = {}) {
    const detail = String(result?.detail || result?.label || 'The action completed.')
        .replace(/^Action output:\s*/i, '')
        .trim();
    return `The latest verified result is: ${detail}`;
}

export function groundedThreatFallback(perception = {}) {
    const hostiles = Array.isArray(perception?.hostiles) ? perception.hostiles : [];
    const primary = perception?.primaryThreat || hostiles[0] || null;
    if (!primary) {
        return "I don't have enough current threat evidence to promise this spot is safe.";
    }
    const distance = Number(primary.distance);
    const observed = [
        primary.threatPriority && primary.threatPriority !== 'none'
            ? `${primary.threatPriority}-threat`
            : null,
        primary.name || 'hostile',
        Number.isFinite(distance) ? `about ${distance} blocks ${primary.direction || 'away'}` : null,
        primary.motion && primary.motion !== 'unknown' ? primary.motion : null,
        primary.visible === false ? 'occluded' : primary.visible === true ? 'visible' : 'visibility unknown',
    ].filter(Boolean).join(', ');
    return `I can confirm ${observed}. Occlusion only proves line of sight; I have no route proof, so I can't promise this spot is safe.`;
}

function boundedGenerationLog(value) {
    const text = String(value ?? '');
    return text.length <= MAX_GENERATION_LOG_CHARS
        ? text
        : `${text.slice(0, MAX_GENERATION_LOG_CHARS)}… [generation log capped]`;
}

function ensurePromptContext(template, placeholders) {
    let result = String(template || '')
        .replaceAll('__STATS__', '$STATS')
        .replaceAll('__INVENTORY__', '$INVENTORY');
    for (const placeholder of placeholders) {
        if (!result.includes(placeholder)) result += `\n${placeholder}`;
    }
    return result;
}

export function latestMessageRequestsAction(messages) {
    const latestUserIndex = messages?.findLastIndex(message => message.role === 'user') ?? -1;
    const latest = latestUserIndex >= 0 ? messages[latestUserIndex] : null;
    if (!latest?.content) return false;
    const content = latest.content.replace(/^[^:]{1,64}:\s*/, '').trim();
    if (/^(?:how|what|where|when|why)\b/i.test(content)) return false;
    // Subject-led appearance statements use "look" as a linking verb, not an
    // instruction to aim the bot's camera. Treating praise such as "You look
    // awesome" as an action forced command-only retries and a gameplay-error
    // fallback instead of an ordinary companion response.
    if (/^(?:you|it|that|this)\s+look(?:s|ed)?\b/i.test(content)) return false;
    const laterTurns = messages.slice(latestUserIndex + 1);
    const commandIndex = laterTurns.findIndex(message =>
        message.role === 'assistant' && containsCommand(message.content)
    );
    if (commandIndex >= 0) {
        const hasActionOutcome = laterTurns.slice(commandIndex + 1).some(message =>
            message.role === 'system'
            && message.content
            && !/^Command \S+ does not exist\.$/.test(message.content)
        );
        if (hasActionOutcome) return false;
    }
    return ACTION_REQUEST_PATTERN.test(content);
}

export function clarificationQuestionFromGeneration(generation) {
    const text = String(generation || '').trim();
    if (containsCommand(text)) return null;
    const match = /^\[CLARIFY\]\s+([^\r\n]{1,200})$/i.exec(text);
    if (!match) return null;
    const question = match[1].trim();
    if (!question.endsWith('?') || (question.match(/\?/g) || []).length !== 1) return null;
    return question;
}

export function unsupportedCapabilityFromGeneration(generation) {
    const text = String(generation || '').trim();
    if (containsCommand(text)) return null;
    const match = UNSUPPORTED_CAPABILITY_PATTERN.exec(text);
    if (!match) return null;
    return match[1].trim();
}

export class Prompter {
    constructor(agent, profile) {
        this.agent = agent;
        this.profile = profile;
        const defaults_dir = path.join(__dirname, '../../profiles/defaults');
        let default_profile = JSON.parse(readFileSync(path.join(defaults_dir, '_default.json'), 'utf8'));
        let base_fp = '';
        if (settings.base_profile.includes('survival')) {
            base_fp = path.join(defaults_dir, 'survival.json');
        } else if (settings.base_profile.includes('assistant')) {
            base_fp = path.join(defaults_dir, 'assistant.json');
        } else if (settings.base_profile.includes('creative')) {
            base_fp = path.join(defaults_dir, 'creative.json');
        } else if (settings.base_profile.includes('god_mode')) {
            base_fp = path.join(defaults_dir, 'god_mode.json');
        }
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined)
                base_profile[key] = default_profile[key];
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined)
                this.profile[key] = base_profile[key];
        }
        // base overrides default, individual overrides base

        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.awaiting_coding = false;
        // Keyed by purpose and blocked-action set. A single slot would thrash,
        // because conversation and autonomy turns interleave and each would
        // evict the other's copy.
        this.command_docs_cache = new Map();
        this.performance = { conversation: null };
        // Hash only the configured conversation surface needed to
        // prove repeated runs used the same route setup. Secret-bearing keys
        // are redacted before hashing and no prompt or response text is exposed.
        this.conversation_model_fingerprint = fingerprintConfiguredConversationModel(this.profile);

        // for backwards compatibility, move max_tokens to params
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        // A model key may name one provider or several in preference order.
        // Several becomes a router, so a local model can cover for a hosted one
        // that is rate-limited, unpaid, or simply not running.
        const resolveEntry = (key, entry) => resolveConfiguredModel({ ...this.profile, [key]: entry }, key);
        const buildModel = (key) => {
            const configured = this.profile[key];
            const entries = Array.isArray(configured) ? configured : [configured];
            return createRoutedModel(entries, (entry) => createModel(resolveEntry(key, entry)));
        };

        // The embedding fallback below inherits transport settings from the
        // preferred chat provider, so resolve that one entry on its own.
        const chat_model_profile = resolveEntry(
            'model',
            Array.isArray(this.profile.model) ? this.profile.model[0] : this.profile.model,
        );

        this.chat_model = buildModel('model');

        if (this.profile.code_model) {
            this.code_model = buildModel('code_model');
        }
        else {
            this.code_model = this.chat_model;
        }

        if (this.profile.vision_model) {
            this.vision_model = buildModel('vision_model');
        }
        else {
            this.vision_model = this.chat_model;
        }

        // These jobs have genuinely different needs. Deciding whether to reply
        // at all is a yes/no classification a tiny local model handles fine;
        // compressing memory is summarization; choosing the next goal is the
        // reasoning that actually benefits from an expensive model. Each falls
        // back to `model`, so a profile that names none behaves exactly as it
        // did before.
        // A specialist named alone had no fallback at all: `reasoning_model` was
        // built from a single entry, so `createRoutedModel` returned a bare model
        // and one provider hiccup took reasoning (goal selection, self-prompting)
        // down completely while chat stayed healthy. Chain each specialist to the
        // chat model so it degrades to a working model instead of dying. The chat
        // model is usually a different model with its own capacity, so this helps
        // even when every tier lives behind one provider.
        const withChatBackstop = (key) => {
            if (!this.profile[key]) return this.chat_model;
            const primary = buildModel(key);
            if (!this.chat_model || primary === this.chat_model) return primary;
            return new FallbackRouter(
                [
                    { model: primary, label: key },
                    { model: this.chat_model, label: `${key}->model` },
                ],
                { log: console },
            );
        };

        this.reasoning_model = withChatBackstop('reasoning_model');
        this.memory_model = withChatBackstop('memory_model');
        this.triage_model = withChatBackstop('triage_model');
        // Choosing the next physical action is not the same job as choosing a
        // goal, and it happens orders of magnitude more often. Routing both
        // through `reasoning_model` meant a profile that named a deep reasoner
        // paid that latency before every single step of autonomous play, which
        // is felt as the bot being slow rather than the bot being thoughtful.
        // Defaults to the chat model; a profile may name something faster still.
        this.autonomy_model = withChatBackstop('autonomy_model');

        
        let embedding_model_profile = null;
        if (this.profile.embedding) {
            try {
                embedding_model_profile = resolveConfiguredModel(this.profile, 'embedding');
            } catch (e) {
                embedding_model_profile = null;
            }
        }
        if (embedding_model_profile) {
            this.embedding_model = createModel(embedding_model_profile);
        }
        else if (chat_model_profile.api === 'codex') {
            // Codex OAuth is chat-only. Keep the existing complete lexical
            // example and skill-doc ranking rather than attempting embeddings.
            this.embedding_model = null;
        }
        else {
            this.embedding_model = createModel({
                api: chat_model_profile.api,
                model: null,
                url: chat_model_profile.url,
                params: chat_model_profile.params,
            });
        }

        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeJsonAtomicSync(`./bots/${name}/last_profile.json`, this.profile, 4);
        console.log("Copy profile saved.");
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    // Every configured route, flattened to unique leaf providers. Lifecycle
    // ownership used to stop at the four general models, so a stopped agent left
    // reasoning, memory, triage, and autonomy generations running. Worse, a
    // profile that names several providers for one key gets a FallbackRouter,
    // and `model.cancelPending?.()` on a router silently did nothing -- optional
    // chaining turned "this wrapper has no such method" into "nothing to do",
    // so even the four listed routes were reached in name only.
    // Leaves are de-duplicated because specialists chain to the chat model, so
    // one provider is reachable through several routes but must be handled once.
    _lifecycleLeaves(routes) {
        const leaves = new Set();
        for (const route of routes.filter(Boolean)) {
            if (typeof route.leafModels === 'function') {
                for (const leaf of route.leafModels()) leaves.add(leaf);
            } else {
                leaves.add(route);
            }
        }
        return leaves;
    }

    _generalRoutes() {
        return [this.chat_model, this.code_model, this.vision_model, this.embedding_model];
    }

    _specialistRoutes() {
        return [this.reasoning_model, this.memory_model, this.triage_model, this.autonomy_model];
    }

    _allModelLeaves() {
        return [...this._lifecycleLeaves([...this._generalRoutes(), ...this._specialistRoutes()])];
    }

    async initExamples() {
        try {
            // The general routes keep their original fatal preflight: a bot that
            // cannot reach its chat model should fail loudly at startup.
            // Specialist-only leaves are preflighted but not made fatal --
            // withChatBackstop exists precisely so a specialist degrades to the
            // chat model instead of dying, and a fatal preflight here would
            // contradict that by turning a recoverable specialist into a failed
            // startup.
            const requiredLeaves = this._lifecycleLeaves(this._generalRoutes());
            const optionalLeaves = [...this._lifecycleLeaves(this._specialistRoutes())]
                .filter(leaf => !requiredLeaves.has(leaf));
            await Promise.all([...requiredLeaves].map(model => model.preflight?.()));
            const optionalResults = await Promise.allSettled(
                optionalLeaves.map(model => model.preflight?.()),
            );
            for (const result of optionalResults) {
                if (result.status === 'rejected') {
                    console.warn(
                        `[model-lifecycle] Specialist model preflight failed; it will fall back to the chat model: ${String(result.reason?.message || result.reason).slice(0, 240)}`,
                    );
                }
            }
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    cancelPendingModelGeneration() {
        // Deterministic player work (Stop, Agenda, direct directives) does not
        // start another promptConvo call, so provider cancellation alone would
        // leave the old turn's generation epoch valid. If a provider settles
        // late—or retries after cancellation—that stale turn could still issue
        // a physical command behind newer player authority.
        const previous = Number(this.most_recent_msg_time) || 0;
        this.most_recent_msg_time = Math.max(Date.now(), previous + 1);
        let cancelled = 0;
        for (const model of this._allModelLeaves()) {
            cancelled += Number(model.cancelPending?.() || 0);
        }
        return cancelled;
    }

    dispose() {
        if (this._disposePromise) return this._disposePromise;
        this._disposePromise = Promise
            .allSettled(this._allModelLeaves().map(model => model.dispose?.()))
            .then(() => undefined);
        return this._disposePromise;
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null, memoryPurpose='runtime') {
        const characterName = this.agent.runtime?.identity?.displayName || this.agent.name;
        prompt = prompt.replaceAll('$NAME', characterName);
        if (prompt.includes('$PERSONA')) {
            const persona = this.agent.getPersona?.();
            const runtime = this.agent.runtime;
            const characterIdentity = identityPrompt(runtime?.identity || this.profile.identity);
            const traits = [runtime?.role, runtime?.identity?.attitude, runtime?.identity?.style, ...(runtime?.identity?.specialties || [])]
                .filter(Boolean)
                .join('; ');
            const roleFocus = (runtime?.rolePreset?.focus || [])
                .map(focus => String(focus).replace(/_/g, ' '))
                .filter(Boolean)
                .join(', ');
            const characterLines = [
                characterIdentity,
                persona ? `Character brief: ${persona}` : '',
                traits ? `Role configuration: ${traits}` : '',
                roleFocus ? `Operational focus: ${roleFocus}.` : '',
            ].filter(Boolean);
            prompt = prompt.replaceAll(
                '$PERSONA',
                `CHARACTER AND ROLE:\n${characterLines.join('\n') || 'Be a concise, capable Minecraft companion.'}\nStay in character while remaining truthful about perception, capabilities, command results, and completed actions.\n${GAMEPLAY_OPERATING_RULES}`,
            );
        }

        if (prompt.includes('$STATS')) {
            const stats = await getCommand('!awareness')?.perform(this.agent) ?? '';
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory')?.perform(this.agent) ?? '';
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS')) {
            const key = [...(this.agent.blocked_actions || [])].sort().join('\u0000');
            prompt = prompt.replaceAll('$COMMAND_DOCS', this.commandDocsFor('all', key));
        }
        if (prompt.includes('$CODE_DOCS')) {
            const code_task_content = messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
            )?.content?.match(/!newAction\((.*?)\)/)?.[1] || '';

            prompt = prompt.replaceAll(
                '$CODE_DOCS',
                await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count)
            );
        }
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY')) {
            // Legacy prose is available only to its own compaction pass.
            // Runtime prompts receive authority-grounded structured recall;
            // obsolete task narration can never masquerade as a work queue.
            const memory = buildPromptMemory(this.agent, {
                purpose: memoryPurpose,
                focusText: messages?.slice(-2).map(message => message?.content || '').join(' ') || '',
            });
            prompt = prompt.replaceAll('$MEMORY', memory);
        }
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            let self_prompt = !this.agent.self_prompter.isStopped()
                ? [
                    `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"`,
                    this.agent.self_prompter.getProgressPrompt?.() || '',
                ].filter(Boolean).join('\n')
                : '';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`;
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`;
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async promptConvo(messages) {
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;
        const turnStartedAt = current_msg_time;
        const requiresActionCommand = latestMessageRequestsAction(messages);
        let actionCorrection = '';
        let groundingFallback = '';
        const measurementAttempts = [];
        this.performance.conversation = {
            sampledAt: turnStartedAt,
            attempt: 0,
            promptBuildMs: null,
            providerMs: null,
            totalMs: 0,
            outcome: 'pending',
            modelConfigFingerprint: this.conversation_model_fingerprint,
            inputFingerprint: null,
            outputFingerprint: null,
            modelRouteFingerprint: null,
            attempts: [],
        };

        const maxTurns = this.agent.runtime?.limits?.maxPromptTurns ?? 3;
        for (let i = 0; i < maxTurns; i++) { // retry only within this profile's budget
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }

            const promptBuildStartedAt = Date.now();
            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            const groundingState = getFullState(this.agent);
            const actionGrounding = recentActionGroundingPrompt(groundingState);
            if (actionGrounding) prompt += `\n${actionGrounding}`;
            prompt += actionCorrection;
            const promptBuiltAt = Date.now();
            const inputFingerprint = fingerprintModelMeasurement({ messages, prompt });
            let generation;
            let providerStartedAt = null;
            let providerFinishedAt = null;
            let measurementRecorded = false;

            try {
                providerStartedAt = Date.now();
                generation = await this.chat_model.sendRequest(messages, prompt);
                providerFinishedAt = Date.now();
                const outputFingerprint = fingerprintModelMeasurement(generation);
                const modelRouteFingerprint = selectedConversationModelRouteFingerprint(this.chat_model);
                measurementAttempts.push({
                    attempt: i + 1,
                    inputFingerprint,
                    outputFingerprint,
                    modelRouteFingerprint,
                    outcome: 'generated',
                });
                measurementRecorded = true;
                this.performance.conversation = {
                    sampledAt: providerFinishedAt,
                    attempt: i + 1,
                    promptBuildMs: Math.max(0, promptBuiltAt - promptBuildStartedAt),
                    providerMs: Math.max(0, providerFinishedAt - providerStartedAt),
                    totalMs: Math.max(0, providerFinishedAt - turnStartedAt),
                    outcome: 'generated',
                    modelConfigFingerprint: this.conversation_model_fingerprint,
                    inputFingerprint,
                    outputFingerprint,
                    modelRouteFingerprint,
                    attempts: measurementAttempts.map(attempt => ({ ...attempt })),
                };
                if (typeof generation !== 'string') {
                    console.error('Error: Generated response is not a string', boundedGenerationLog(generation));
                    throw new Error('Generated response is not a string');
                }
                console.log('Generated response:', boundedGenerationLog(generation));
                await this._saveLog(prompt, messages, generation, 'conversation');

            } catch (error) {
                const failedAt = Date.now();
                const outcome = providerFinishedAt === null ? 'provider_failed' : 'postprocess_failed';
                if (measurementRecorded) {
                    measurementAttempts[measurementAttempts.length - 1].outcome = outcome;
                } else {
                    measurementAttempts.push({
                        attempt: i + 1,
                        inputFingerprint,
                        outputFingerprint: null,
                        modelRouteFingerprint: null,
                        outcome,
                    });
                }
                const latestMeasurement = measurementAttempts[measurementAttempts.length - 1];
                this.performance.conversation = {
                    sampledAt: failedAt,
                    attempt: i + 1,
                    promptBuildMs: Math.max(0, promptBuiltAt - promptBuildStartedAt),
                    providerMs: providerStartedAt === null
                        ? null
                        : Math.max(0, (providerFinishedAt || failedAt) - providerStartedAt),
                    totalMs: Math.max(0, failedAt - turnStartedAt),
                    outcome,
                    modelConfigFingerprint: this.conversation_model_fingerprint,
                    inputFingerprint,
                    outputFingerprint: latestMeasurement.outputFingerprint,
                    modelRouteFingerprint: latestMeasurement.modelRouteFingerprint,
                    attempts: measurementAttempts.map(attempt => ({ ...attempt })),
                };
                console.error('Error during message generation or file writing:', error);
                // The model router already tried every configured provider
                // route before surfacing this failure. Re-entering the prompt
                // loop would repeat the same paid request and can neither fix
                // authentication/quota nor improve the response. Correctable
                // generated-answer failures continue to use later prompt turns.
                if (outcome === 'provider_failed') return PROVIDER_FAILURE_TEXT;
                continue;
            }

            // Check for hallucination or invalid output
            if (generation?.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }

            if (current_msg_time !== this.most_recent_msg_time) {
                console.warn(`${this.agent.name} received new message while generating, discarding old response.`);
                return '';
            }

            if (generation?.includes('</think>')) {
                const [_, afterThink] = generation.split('</think>');
                generation = afterThink;
            }

            const currentGroundingState = getFullState(this.agent);
            const perception = currentGroundingState?.perception;
            const groundingViolation = conversationGroundingViolation(
                generation,
                currentGroundingState,
                messages,
            );
            if (groundingViolation) {
                console.warn(`LLM response violated ${groundingViolation.code}. Trying again...`);
                actionCorrection = groundingViolation.correction;
                groundingFallback = groundingViolation.fallback || groundedThreatFallback(perception);
                continue;
            }

            const clarificationQuestion = clarificationQuestionFromGeneration(generation);
            const unsupportedCapability = unsupportedCapabilityFromGeneration(generation);
            if (requiresActionCommand && unsupportedCapability) {
                this.performance.conversation = {
                    ...this.performance.conversation,
                    outcome: 'unsupported',
                };
                return unsupportedCapability;
            }
            if (requiresActionCommand && !containsCommand(generation)) {
                if (clarificationQuestion) {
                    this.performance.conversation = {
                        ...this.performance.conversation,
                        outcome: 'clarification',
                    };
                    return clarificationQuestion;
                }
                console.warn('LLM described or answered an action request without a command. Trying again...');
                actionCorrection = '\nCRITICAL RETRY: The latest player message requests an action. Respond with a valid !command only when that command fulfills the request. If the request is outside your capabilities or permissions, respond exactly `[UNSUPPORTED] concise missing capability or permission.` with no command. Do not choose unrelated substitute work, promise, narrate, roleplay, or claim the action happened.';
                continue;
            }

            return clarificationQuestion || generation;
        }

        if (requiresActionCommand) {
            return 'I could not map that request to a safe gameplay command. Ask me to inspect with !awareness or use a specific available command.';
        }
        if (groundingFallback) return groundingFallback;
        return '';
    }

    async promptCoding(messages) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        try {
            await this.checkCooldown();
            let prompt = this.profile.coding;
            prompt = await this.replaceStrings(prompt, messages, this.coding_examples);

            let resp = await this.code_model.sendRequest(messages, prompt);
            await this._saveLog(prompt, messages, resp, 'coding');
            return resp;
        } finally {
            // The latch is ownership of an in-flight request, not a success
            // flag. Clearing it only on the success path meant one failure in
            // cooldown, prompt assembly, or the provider left every later
            // coding request answering "Already awaiting" until process restart.
            this.awaiting_coding = false;
        }
    }

    /**
     * Compact command documentation, built once per (purpose, blocked-actions)
     * pair. Autonomy rebuilt this string from scratch before every action --
     * 130 command entries and ~16KB of text per step of play -- because it did
     * its own substitution and never reached the cache below.
     */
    commandDocsFor(purpose = 'all', blockedKey = null) {
        const key = `${purpose}\u0000${blockedKey ?? [...(this.agent.blocked_actions || [])].sort().join('\u0000')}`;
        let docs = this.command_docs_cache.get(key);
        if (docs === undefined) {
            docs = getCommandDocs(this.agent, { compact: true, purpose });
            // Blocked actions change rarely, so this map stays tiny; the bound
            // only guards against an unexpected churn source.
            if (this.command_docs_cache.size >= 8) this.command_docs_cache.clear();
            this.command_docs_cache.set(key, docs);
        }
        return docs;
    }

    async promptAutonomy(messages) {
        // Drives continuous self-play. A profile may ship its own
        // 'autonomy' prompt; otherwise we derive one from the standard
        // 'conversing' prompt so behaviour stays consistent.
        // `_generateAutonomy` owns the per-generation cooldown. Applying it
        // here as well made every autonomous turn wait twice before its first
        // model request.
        const base = (this.profile.autonomy && this.profile.autonomy.trim())
            ? this.profile.autonomy
            : this.profile.conversing;
        let template = ensurePromptContext(base, [
            '$PERSONA',
            '$SELF_PROMPT',
            '$MEMORY',
            '$STATS',
            '$INVENTORY',
            '$COMMAND_DOCS',
            '$CONVO',
        ]);
        template = template.replaceAll('$COMMAND_DOCS', this.commandDocsFor('autonomy'));
        let prompt = await this.replaceStrings(template, messages, this.convo_examples);
        return await this._generateAutonomy(prompt);
    }

    async _generateAutonomy(prompt) {
        const requiresActionCommand = true; // autonomy turns MUST act
        let actionCorrection = '';
        const maxTurns = this.agent.runtime?.limits?.maxPromptTurns ?? 3;
        for (let i = 0; i < maxTurns; i++) {
            await this.checkCooldown();
            let generation = await (this.autonomy_model || this.chat_model).sendRequest([], prompt + actionCorrection);
            if (typeof generation !== 'string') {
                console.error('Error: Autonomy generation is not a string', boundedGenerationLog(generation));
                return '';
            }
            console.log(`${this.agent.name} autonomy response:`, boundedGenerationLog(generation));
            if (generation?.includes('</think>')) {
                const [_, afterThink] = generation.split('</think>');
                generation = afterThink;
            }
            if (!containsCommand(generation)) {
                console.warn('Autonomy turn produced no !command. Retrying with stronger instruction...');
                actionCorrection = '\nCRITICAL: Your previous response had no command. Respond with exactly one valid listed command that makes progress, such as !awareness, !inspectMinecraft("iron_ore"), !collectWood(8), or !goToPlayer("player", 4). Use double quotes for strings. Do not narrate.';
                continue;
            }
            return generation;
        }
        return 'I could not decide on a safe action this turn.';
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize, null, 'summary');
        let resp = await (this.memory_model || this.chat_model).sendRequest([], prompt);
        await this._saveLog(prompt, to_summarize, resp, 'memSaving');
        if (resp?.includes('</think>')) {
            const [_, afterThink] = resp.split('</think>');
            resp = afterThink;
        }
        return resp;
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let messages = this.agent.history.getHistory();
        messages.push({role: 'user', content: new_message});
        prompt = await this.replaceStrings(prompt, null, null, messages);
        let res = await (this.triage_model || this.chat_model).sendRequest([], prompt);
        return res.trim().toLowerCase() === 'respond';
    }

    async phraseReaction(reaction) {
        await this.checkCooldown();
        const facts = reaction?.event || {};
        const prompt = [
            'Write one natural Minecraft reaction using only the immutable facts in the JSON below.',
            'Do not add names, entities, directions, counts, coordinates, outcomes, or commands.',
            'Keep it under 140 characters. Return only the reaction text.',
            `Tone hint: ${String(reaction?.tone || 'steady').slice(0, 32)}`,
            `Facts: ${JSON.stringify(facts)}`,
        ].join('\n');
        let response = await this.chat_model.sendRequest([], prompt);
        if (typeof response !== 'string') return '';
        if (response.includes('</think>')) response = response.split('</think>').at(-1);
        return response.replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
    }

    async promptVision(messages, imageBuffer, { grounding = null } = {}) {
        await this.checkCooldown();
        let prompt = this.profile.image_analysis;
        if (grounding) {
            const structuredGrounding = [
                'STRUCTURED CAPTURE-TIME GROUNDING (authoritative):',
                JSON.stringify(grounding),
            ].join('\n');
            if (prompt.includes('$STATS')) prompt = prompt.replaceAll('$STATS', structuredGrounding);
            else prompt += `\n${structuredGrounding}`;
            prompt += [
                '\nGround the image description in the structured facts above.',
                'Use the screenshot only for visual properties that protocol state cannot establish, such as shape, layout, appearance, and visual obstruction.',
                'Never invent an entity, block identity, coordinate, count, visibility claim, action result, or plan state.',
                'When image pixels and protocol facts cannot be reconciled, state the uncertainty briefly.',
            ].join('\n');
        }
        prompt = await this.replaceStrings(prompt, messages, null, null, null);
        return await this.vision_model.sendVisionRequest(messages, prompt, imageBuffer);
    }

    async promptGoalSetting(messages, last_goals) {
        // deprecated
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO';
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await (this.reasoning_model || this.chat_model).sendRequest(user_messages, system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    async _saveLog(prompt, messages, generation, tag) {
        if (!settings.log_all_prompts)
            return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let logEntry;
        let task_id = this.agent.task.task_id;
        if (task_id == null) {
            logEntry = `[${timestamp}] \nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        } else {
            logEntry = `[${timestamp}] Task ID: ${task_id}\nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        }
        const logFile = `${tag}_${timestamp}.txt`;
        await this._saveToFile(logFile, logEntry);
    }

    async _saveToFile(logFile, logEntry) {
        let task_id = this.agent.task.task_id;
        let logDir;
        if (task_id == null) {
            logDir = path.join(__dirname, `../../bots/${this.agent.name}/logs`);
        } else {
            logDir = path.join(__dirname, `../../bots/${this.agent.name}/logs/${task_id}`);
        }

        await fs.mkdir(logDir, { recursive: true });

        logFile = path.join(logDir, logFile);
        await fs.appendFile(logFile, String(logEntry), 'utf-8');
    }
}
