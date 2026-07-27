import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ActionManager } from '../src/agent/action_manager.js';
import { ItemNode } from '../src/agent/npc/item_goal.js';
import { Novita } from '../src/models/novita.js';
import { VLLM } from '../src/models/vllm.js';


test('item hunt execution handles the attack result without a ReferenceError', async () => {
    const bot = {
        interrupt_code: false,
        output: '',
        entities: {},
        entity: { position: { distanceTo: () => 0 } },
        modes: { pause: () => {} },
        inventory: { slots: [] },
    };
    const manager = {
        agent: { bot },
        goal: { name: 'different-goal' },
    };
    const node = new ItemNode(manager, null, 'raw_beef').setHuntable('cow');

    await node.execute();

    assert.equal(node.fails, 1);
    assert.match(bot.output, /Could not find any cow to attack/);
});


test('resume actions reject with the required-label assertion', async () => {
    const manager = new ActionManager({});

    await assert.rejects(
        manager.runAction(null, async () => {}, { resume: true }),
        { name: 'AssertionError', message: 'actionLabel is required for new resume' },
    );
});


test('action errors retain their stack in the returned message', async () => {
    const agent = {
        bot: { interrupt_code: false, output: '', emit: () => {} },
        clearBotLogs() {
            this.bot.output = '';
        },
    };
    const manager = new ActionManager(agent);
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        const result = await manager.runAction('throws', () => {
            throw new Error('boom');
        });

        assert.equal(result.success, false);
        assert.match(result.message, /Stack trace:\nError: boom/);
    } finally {
        console.error = originalConsoleError;
    }
});


test('Novita retries context-length failures through the model instance', async () => {
    const model = Object.create(Novita.prototype);
    let attempts = 0;
    model.openai = {
        chat: {
            completions: {
                create: () => {
                    attempts++;
                    if (attempts === 1) {
                        const error = new Error('Context length exceeded');
                        error.code = 'context_length_exceeded';
                        throw error;
                    }
                    return {
                        choices: [{ finish_reason: 'stop', message: { content: 'recovered' } }],
                    };
                },
            },
        },
    };

    const response = await model.sendRequest([
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
    ], 'system');

    assert.equal(response, 'recovered');
    assert.equal(attempts, 2);
});


test('VLLM saveToFile resolves its ESM directory and task log path', async () => {
    const testName = `.repair-vllm-${process.pid}-${Date.now()}`;
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const botRoot = path.join(repoRoot, 'bots', testName);

    try {
        for (const [taskId, relativeLogPath] of [
            ['task-123', path.join('logs', 'task-123', 'repair.log')],
            [null, path.join('logs', 'repair.log')],
        ]) {
            const model = Object.create(VLLM.prototype);
            model.agent = { name: testName, task: { task_id: taskId } };

            await model.saveToFile('repair.log', 'saved');
            assert.equal(await readFile(path.join(botRoot, relativeLogPath), 'utf8'), 'saved');
        }
    } finally {
        await rm(botRoot, { recursive: true, force: true });
    }
});
