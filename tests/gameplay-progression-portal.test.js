import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGameplayProgression } from '../src/agent/runtime/gameplay-progression.js';

test('an immediate hostile routes progression through the tactical combat skill', () => {
    const progression = evaluateGameplayProgression({
        gameplay: {
            health: 20,
            hunger: 20,
            dimension: 'overworld',
        },
        inventory: { counts: {} },
        perception: {
            hostiles: [{ name: 'zombie', distance: 4, direction: 'ahead' }],
            hazards: [],
            usefulBlocks: [],
        },
    });

    assert.equal(progression.currentStage, 'survival_override');
    assert.equal(progression.safetyOverride.code, 'immediate_hostile');
    assert.equal(progression.recommendedCommand, '!resolveTacticalCombat(16)');
});

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
    assert.equal(progression.completedMilestones, progression.totalMilestones - 4);
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
    assert.equal(progression.completedMilestones, progression.totalMilestones - 3);
    assert.equal(progression.recommendedCommand, '!resolveTacticalCombat(16)');
    assert.equal(progression.blocker, null);
});

test('a verified tactical combat action advances progression to landmark exploration', () => {
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
        action: {
            lastResult: {
                label: 'action:resolveTacticalCombat',
                phase: 'succeeded',
                code: 'skill_secured',
            },
        },
    });

    assert.equal(progression.currentStage, 'exploration_route');
    assert.equal(progression.completedMilestones, progression.totalMilestones - 2);
    assert.equal(progression.recommendedCommand, '!completeExplorationRoute("echo_shard", 3, 96)');
    assert.equal(progression.blocker, null);
});

test('verified landmark memory advances progression to pending death recovery', () => {
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
        memory: {
            explorationRouteVerified: true,
            deathRecoveryVerified: true,
            deathRecoveryPending: true,
        },
    });

    assert.equal(progression.currentStage, 'death_recovery');
    assert.equal(progression.recommendedCommand, '!recoverDeathItems()');
});

test('verified death-item recovery completes the operational progression', () => {
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
        memory: {
            explorationRouteVerified: true,
            deathRecoveryVerified: true,
        },
    });

    assert.equal(progression.currentStage, 'operational');
    assert.equal(progression.completedMilestones, progression.totalMilestones);
    assert.equal(progression.recommendedCommand, null);
});

test('an already-secure tactical check does not claim a hostile encounter', () => {
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
        action: {
            lastResult: {
                label: 'action:resolveTacticalCombat',
                phase: 'succeeded',
                code: 'skill_area_already_secure',
            },
        },
    });

    assert.equal(progression.currentStage, 'tactical_combat');
    assert.equal(progression.recommendedCommand, '!resolveTacticalCombat(16)');
});
