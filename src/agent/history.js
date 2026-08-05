import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
} from 'fs';
import path from 'node:path';
import { NPCData } from './npc/data.js';
import settings from './settings.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';

const MAX_MEMORY_FILE_BYTES = 2 * 1024 * 1024;
// Session transcripts, newest kept. One bot had 89 of these and climbing.
const MAX_HISTORY_FILES = 20;
const MAX_STORED_TURNS = 100;
const MAX_STORED_TURN_CHARS = 32_000;
const MAX_STORED_MEMORY_CHARS = 4_000;
const MAX_STORED_PROMPT_CHARS = 4_000;

function validateStoredHistory(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Bot memory must contain a JSON object.');
    }
    if (!Array.isArray(value.turns) || value.turns.length > MAX_STORED_TURNS) {
        throw new TypeError('Bot memory contains an invalid turn list.');
    }
    const turns = value.turns.map((turn) => {
        if (
            !turn
            || typeof turn !== 'object'
            || !['assistant', 'system', 'user'].includes(turn.role)
            || typeof turn.content !== 'string'
            || turn.content.length > MAX_STORED_TURN_CHARS
        ) {
            throw new TypeError('Bot memory contains an invalid conversation turn.');
        }
        return { role: turn.role, content: turn.content };
    });
    if (value.memory !== undefined && typeof value.memory !== 'string') {
        throw new TypeError('Bot memory summary must be text.');
    }
    if (value.self_prompt !== undefined && value.self_prompt !== null && typeof value.self_prompt !== 'string') {
        throw new TypeError('Bot self-prompt memory must be text or null.');
    }
    if (
        value.self_prompting_state !== undefined
        && ![0, 1, 2].includes(value.self_prompting_state)
    ) {
        throw new TypeError('Bot self-prompt state is invalid.');
    }
    if (value.operator_hold !== undefined && typeof value.operator_hold !== 'boolean') {
        throw new TypeError('Bot operator-hold state is invalid.');
    }
    if (value.operator_hold_reason !== undefined && typeof value.operator_hold_reason !== 'string') {
        throw new TypeError('Bot operator-hold reason is invalid.');
    }
    return {
        ...value,
        memory: String(value.memory || '').slice(0, MAX_STORED_MEMORY_CHARS),
        turns,
        self_prompt: typeof value.self_prompt === 'string'
            ? value.self_prompt.slice(0, MAX_STORED_PROMPT_CHARS)
            : null,
        self_prompting_state: value.self_prompting_state ?? 0,
        last_sender: typeof value.last_sender === 'string' ? value.last_sender.slice(0, 64) : null,
        taskStart: Number.isFinite(value.taskStart) ? value.taskStart : null,
        operator_hold: value.operator_hold === true,
        operator_hold_reason: typeof value.operator_hold_reason === 'string'
            ? value.operator_hold_reason.slice(0, 160)
            : '',
    };
}


export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        this.memory = await this.agent.prompter.promptMemSaving(turns);

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
    }

    /**
     * Transcript files are written one per session and were never cleaned up,
     * so a bot that had been run often accumulated them indefinitely. Keep the
     * most recent sessions and delete the rest. Retention failures are logged
     * and ignored: losing an old transcript must never interrupt a live bot.
     */
    pruneHistories(directory) {
        try {
            const files = readdirSync(directory)
                .filter((name) => name.endsWith('.jsonl'))
                .map((name) => {
                    const filePath = path.join(directory, name);
                    let modifiedAt = 0;
                    try { modifiedAt = statSync(filePath).mtimeMs; } catch { modifiedAt = 0; }
                    return { filePath, modifiedAt };
                })
                .sort((left, right) => right.modifiedAt - left.modifiedAt);
            for (const stale of files.slice(MAX_HISTORY_FILES)) {
                try { unlinkSync(stale.filePath); } catch { /* another process may have removed it */ }
            }
        } catch (err) {
            console.warn(`Could not prune ${this.name}'s history files: ${err.message}`);
        }
    }

    appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const directory = `./bots/${this.name}/histories`;
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = path.join(directory, `${string_timestamp}.jsonl`);
            this.pruneHistories(directory);
        }
        try {
            const records = to_store.map((entry) => JSON.stringify(entry)).join('\n');
            if (records) appendFileSync(this.full_history_fp, `${records}\n`, 'utf8');
        } catch (err) {
            console.error(`Error appending ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            await this.summarizeMemories(chunk);
            await this.appendFullHistory(chunk);
        }
    }

    save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender,
                operator_hold: this.agent.isOperatorHeld?.() === true,
                operator_hold_reason: String(this.agent.operator_hold_reason || '').slice(0, 160),
            };
            writeJsonAtomicSync(this.memory_fp, data);
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            if (statSync(this.memory_fp).size > MAX_MEMORY_FILE_BYTES) {
                throw new TypeError('Bot memory file exceeds the 2 MB safety limit.');
            }
            const data = validateStoredHistory(JSON.parse(readFileSync(this.memory_fp, 'utf8')));
            this.memory = data.memory;
            this.turns = data.turns;
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            const recoverable = error instanceof SyntaxError || error instanceof TypeError;
            if (!recoverable) {
                console.error('Failed to load history:', error);
                throw error;
            }
            const quarantinePath = this.memory_fp.replace(
                /\.json$/i,
                `.corrupt-${Date.now()}.json`,
            );
            try {
                renameSync(this.memory_fp, quarantinePath);
                console.error(
                    `Ignored invalid bot memory for ${this.name}; preserved it at ${quarantinePath}: ${error.message}`,
                );
            } catch (quarantineError) {
                console.error(
                    `Ignored invalid bot memory for ${this.name}, but could not quarantine it: ${quarantineError.message}`,
                );
            }
            this.memory = '';
            this.turns = [];
            return null;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
    }
}
