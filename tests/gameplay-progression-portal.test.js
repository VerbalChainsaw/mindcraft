import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGameplayProgression } from '../src/agent/runtime/gameplay-progression.js';

test('an active portal preserves consumed material and assembly milestones', () => {
    const progression = evaluateGameplayProgression({
        gameplay: {
            health: 20,
            hunger: 20,
            dimension: 'overworld',
        },
        inventory: {
            counts: {
                oak_planks: 4,
                crafting_table: 1,
                stone_pickaxe: 1,
                furnace: 1,
                coal: 2,
                torch: 4,
                iron_ingot: 4,
                iron_pickaxe: 1,
                shield: 1,
                bucket: 1,
                diamond: 3,
                diamond_pickaxe: 1,
            },
        },
        perception: {
            hostiles: [],
            hazards: [],
            usefulBlocks: [
                { name: 'nether_portal', count: 6 },
            ],
        },
    });

    assert.equal(progression.currentStage, 'nether_round_trip');
    assert.equal(progression.completedMilestones, progression.totalMilestones - 1);
    assert.equal(progression.recommendedCommand, '!completeNetherQuartzRun(1)');
});

test('carried quartz in the Nether does not claim a safe return', () => {
    const progression = evaluateGameplayProgression({
        gameplay: {
            health: 20,
            hunger: 20,
            dimension: 'the_nether',
        },
        inventory: {
            counts: {
                oak_planks: 4,
                crafting_table: 1,
                stone_pickaxe: 1,
                furnace: 1,
                coal: 2,
                torch: 4,
                iron_ingot: 4,
                iron_pickaxe: 1,
                quartz: 1,
                diamond_pickaxe: 1,
                shield: 1,
                bucket: 1,
            },
        },
        perception: {
            hostiles: [],
            hazards: [],
            usefulBlocks: [
                { name: 'nether_portal', count: 6 },
            ],
        },
    });

    assert.equal(progression.currentStage, 'nether_round_trip');
    assert.deepEqual(progression.missingPrerequisites, ['verified Overworld return']);
    assert.equal(progression.recommendedCommand, '!completeNetherQuartzRun(1)');
});

test('quartz carried alive in the Overworld completes the round trip milestone', () => {
    const progression = evaluateGameplayProgression({
        gameplay: {
            health: 20,
            hunger: 20,
            dimension: 'minecraft:overworld',
        },
        inventory: {
            counts: {
                oak_planks: 4,
                crafting_table: 1,
                stone_pickaxe: 1,
                furnace: 1,
                coal: 2,
                torch: 4,
                iron_ingot: 4,
                iron_pickaxe: 1,
                quartz: 1,
                diamond_pickaxe: 1,
                shield: 1,
                bucket: 1,
            },
        },
        perception: {
            hostiles: [],
            hazards: [],
            usefulBlocks: [
                { name: 'nether_portal', count: 6 },
            ],
        },
    });

    assert.equal(progression.currentStage, 'tactical_combat');
    assert.equal(progression.completedMilestones, progression.totalMilestones);
    assert.match(progression.blocker, /tactical combat/);
});
