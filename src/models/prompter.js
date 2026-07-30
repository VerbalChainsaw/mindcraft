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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACTION_REQUEST_PATTERN = /\b(?:attack|break|build|chop|collect|come|craft|dig|drop|eat|equip|explore|fight|find|follow|gather|give|go|harvest|jump|kill|look|mine|move|place|plant|run|search|stay|stop|turn|use|walk|wait)\b/i;
const GAMEPLAY_OPERATING_RULES = [
    'GAMEPLAY OPERATING RULES:',
    'Treat SITUATIONAL_AWARENESS, INVENTORY, command results, and the connected Minecraft registry as authoritative.',
    'For an unfamiliar item or block, use !inspectMinecraft with its name; use !getCraftingPlan when a recipe chain is unclear.',
    'For an acquisition or delivery outcome, prefer one typed !requestItemGoal; its causal planner derives and verifies prerequisites one physical step at a time.',
    'For complex work, compose available primitives: observe, preflight tools/materials/reachability/hazards, act once, verify the result, then adapt.',
    'Use canonical Minecraft names from inspection. Never invent an item, tool requirement, recipe, location, action result, or completed step.',
].join('\n');

function ensurePromptContext(template, placeholders) {
    let result = String(template || '')
        .replaceAll('__STATS__', '$STATS')
        .replaceAll('__INVENTORY__', '$INVENTORY');
    for (const placeholder of placeholders) {
        if (!result.includes(placeholder)) result += `\n${placeholder}`;
    }
    return result;
}

function latestMessageRequestsAction(messages) {
    const latest = messages?.slice().reverse().find(message => message.role === 'user');
    if (!latest?.content) return false;
    const content = latest.content.replace(/^[^:]{1,64}:\s*/, '').trim();
    if (/^(?:how|what|where|when|why)\b/i.test(content)) return false;
    return ACTION_REQUEST_PATTERN.test(content);
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

        // for backwards compatibility, move max_tokens to params
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        let chat_model_profile = resolveConfiguredModel(this.profile, 'model');
        this.chat_model = createModel(chat_model_profile);

        if (this.profile.code_model) {
            let code_model_profile = resolveConfiguredModel(this.profile, 'code_model');
            this.code_model = createModel(code_model_profile);
        }
        else {
            this.code_model = this.chat_model;
        }

        if (this.profile.vision_model) {
            let vision_model_profile = resolveConfiguredModel(this.profile, 'vision_model');
            this.vision_model = createModel(vision_model_profile);
        }
        else {
            this.vision_model = this.chat_model;
        }

        
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

    async initExamples() {
        try {
            const preflightModels = [...new Set([
                this.chat_model,
                this.code_model,
                this.vision_model,
                this.embedding_model,
            ].filter(Boolean))];
            await Promise.all(preflightModels.map(model => model.preflight?.()));
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
        const models = new Set([
            this.chat_model,
            this.code_model,
            this.vision_model,
            this.embedding_model,
        ].filter(Boolean));
        let cancelled = 0;
        for (const model of models) {
            cancelled += Number(model.cancelPending?.() || 0);
        }
        return cancelled;
    }

    dispose() {
        if (this._disposePromise) return this._disposePromise;
        const models = [...new Set([
            this.chat_model,
            this.code_model,
            this.vision_model,
            this.embedding_model,
        ].filter(Boolean))];
        this._disposePromise = Promise.allSettled(models.map(model => model.dispose?.()))
            .then(() => undefined);
        return this._disposePromise;
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
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
            const stats = await getCommand('!awareness').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs(this.agent));
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
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', [
                this.agent.history.memory,
                this.agent.memory_bank?.personal?.getPromptSummary?.() || '',
            ].filter(Boolean).join('\n'));
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
        const requiresActionCommand = latestMessageRequestsAction(messages);
        let actionCorrection = '';

        const maxTurns = this.agent.runtime?.limits?.maxPromptTurns ?? 3;
        for (let i = 0; i < maxTurns; i++) { // retry only within this profile's budget
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }

            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            prompt += actionCorrection;
            let generation;

            try {
                generation = await this.chat_model.sendRequest(messages, prompt);
                if (typeof generation !== 'string') {
                    console.error('Error: Generated response is not a string', generation);
                    throw new Error('Generated response is not a string');
                }
                console.log("Generated response:", generation);
                await this._saveLog(prompt, messages, generation, 'conversation');

            } catch (error) {
                console.error('Error during message generation or file writing:', error);
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

            if (requiresActionCommand && !containsCommand(generation)) {
                console.warn('LLM described or answered an action request without a command. Trying again...');
                actionCorrection = '\nCRITICAL RETRY: The latest player message requests a physical gameplay action. Your previous attempt did not execute anything. Respond with a valid !command, or briefly state the exact missing capability. Do not promise, narrate, roleplay, or claim the action happened.';
                continue;
            }

            return generation;
        }

        if (requiresActionCommand) {
            return 'I could not map that request to a safe gameplay command. Ask me to inspect with !awareness or use a specific available command.';
        }
        return '';
    }

    async promptCoding(messages) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        await this.checkCooldown();
        let prompt = this.profile.coding;
        prompt = await this.replaceStrings(prompt, messages, this.coding_examples);

        let resp = await this.code_model.sendRequest(messages, prompt);
        this.awaiting_coding = false;
        await this._saveLog(prompt, messages, resp, 'coding');
        return resp;
    }

    async promptAutonomy(messages) {
        // Drives continuous self-play. A profile may ship its own
        // 'autonomy' prompt; otherwise we derive one from the standard
        // 'conversing' prompt so behaviour stays consistent.
        await this.checkCooldown();
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
        template = template.replaceAll('$COMMAND_DOCS', getCommandDocs(this.agent, { compact: true }));
        let prompt = await this.replaceStrings(template, messages, this.convo_examples);
        return await this._generateAutonomy(prompt);
    }

    async _generateAutonomy(prompt) {
        const requiresActionCommand = true; // autonomy turns MUST act
        let actionCorrection = '';
        const maxTurns = this.agent.runtime?.limits?.maxPromptTurns ?? 3;
        for (let i = 0; i < maxTurns; i++) {
            await this.checkCooldown();
            let generation = await this.chat_model.sendRequest([], prompt + actionCorrection);
            if (typeof generation !== 'string') {
                console.error('Error: Autonomy generation is not a string', generation);
                return '';
            }
            console.log(`${this.agent.name} autonomy response:`, generation);
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
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        let resp = await this.chat_model.sendRequest([], prompt);
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
        let res = await this.chat_model.sendRequest([], prompt);
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

    async promptVision(messages, imageBuffer) {
        await this.checkCooldown();
        let prompt = this.profile.image_analysis;
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

        let res = await this.chat_model.sendRequest(user_messages, system_message);

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
