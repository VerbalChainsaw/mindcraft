import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGameplayProgression } from '../src/agent/runtime/gameplay-progression.js';

test('an active portal preserves consumed material and assembly milestones', () => {
    const progression = evaluateGameplayProgression({
        gameplay: {
            health: 20,
            hunger: 20,
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

    assert.equal(progression.currentStage, 'nether_entry');
    assert.equal(progression.completedMilestones, progression.totalMilestones);
    assert.match(progression.blocker, /Nether entry and return/);
});
