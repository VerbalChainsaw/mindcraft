import { parseItemGoalRequest } from './runtime/goal-contract.js';

function commandString(value) {
    return JSON.stringify(String(value || ''));
}

function normalizedMessage(message) {
    return String(message || '')
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/g, '');
}

function requestedCount(text, fallback) {
    const match = text.match(/\b(\d{1,4})\b/);
    if (!match) return fallback;
    return Math.max(1, Math.min(2304, Number.parseInt(match[1], 10)));
}

function miningResource(text) {
    const resources = [
        ['ancient debris', 'ancient_debris'],
        ['cobblestone', 'cobblestone'],
        ['redstone', 'redstone_ore'],
        ['diamond', 'diamond_ore'],
        ['emerald', 'emerald_ore'],
        ['lapis', 'lapis_ore'],
        ['copper', 'copper_ore'],
        ['iron', 'iron_ore'],
        ['gold', 'gold_ore'],
        ['coal', 'coal_ore'],
        ['stone', 'stone'],
    ];
    return resources.find(([label]) => text.includes(label))?.[1] || null;
}

function requestedTool(text) {
    const family = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']
        .find(candidate => new RegExp(`\\b${candidate}\\b`).test(text));
    if (!family) return null;
    const material = [
        ['diamond', 'diamond'],
        ['iron', 'iron'],
        ['stone', 'stone'],
        ['wooden', 'wooden'],
        ['wood', 'wooden'],
    ].find(([label]) => new RegExp(`\\b${label}\\b`).test(text))?.[1] || 'stone';
    return `${material}_${family}`;
}

export function resolvePlayerDirective(playerName, message, context = {}) {
    const text = normalizedMessage(message);
    if (!playerName || !text || text.includes('!')) return null;

    if (/^(?:please\s+)?(?:do not|don't|dont)\s+follow\s+me\b/.test(text)) {
        return {
            command: '!stop',
            response: 'Okay, I stopped following you.',
            releasesHold: false,
        };
    }

    if (/^(?:please\s+)?(?:defend|protect|guard)\s+(?:me|us|my back)\b/.test(text)) {
        return {
            command: `!guardPlayer(${commandString(playerName)}, 3)`,
            response: 'I will stay close and guard you.',
            releasesHold: true,
        };
    }

    if (/^(?:please\s+)?(?:just\s+)?(?:follow|trail)\s+me\b/.test(text)
        || /^(?:please\s+)?come\s+with\s+me\b/.test(text)) {
        return {
            command: `!followPlayer(${commandString(playerName)}, 3)`,
            response: 'I will follow you now.',
            releasesHold: true,
        };
    }

    if (/^(?:please\s+)?(?:come|walk|move|get)\s+(?:here|to me|over here)\b/.test(text)) {
        return {
            command: `!goToPlayer(${commandString(playerName)}, 2)`,
            response: 'I will come to you now.',
            releasesHold: true,
        };
    }

    if (/^(?:please\s+)?(?:stop|stop moving|cancel|hold on)\b/.test(text)) {
        return {
            command: '!stop',
            response: 'Stopping now.',
            releasesHold: false,
        };
    }

    if (/^(?:please\s+)?(?:stay|stay here|wait here|do not move|don't move|dont move)\b/.test(text)) {
        return {
            command: '!stay(-1)',
            response: 'Staying here until you give me another order.',
            releasesHold: true,
        };
    }

    if (/^(?:please\s+)?(?:attack|fight|engage|defend us from)\s+(?:the\s+)?(?:nearest\s+)?(?:enemy|enemies|hostile|hostiles|monster|monsters|mob|mobs|them|that)\b/.test(text)) {
        return {
            command: '!attackHostile',
            response: 'I will engage the nearest combat-safe hostile and report the real outcome.',
            releasesHold: true,
        };
    }

    if (/\b(?:where are you|what are you doing|your position|your coordinates|show status|status report)\b/.test(text)) {
        return {
            command: '!stats',
            response: 'Checking my position and status.',
            releasesHold: false,
        };
    }

    if (/\b(?:show inventory|your inventory|what do you have|what are you carrying|show tools)\b/.test(text)) {
        return {
            command: '!inventory',
            response: 'Checking what I am carrying.',
            releasesHold: false,
        };
    }

    if (/\b(?:look around|scan the area|what is around you|what's around you|nearby blocks)\b/.test(text)) {
        return {
            command: '!nearbyBlocks',
            response: 'Scanning the blocks around me.',
            releasesHold: false,
        };
    }

    if (/^(?:please\s+)?(?:eat|have something to eat|feed yourself)\b/.test(text)) {
        return {
            command: '!consume("")',
            response: 'I will eat the best safe food I am carrying.',
            releasesHold: true,
        };
    }

    if (
        /\b(?:get|find|gather|prepare|secure|stockpile|stock up on|cook|make)\b.{0,32}\b(?:food|meals?|provisions?)\b/.test(text)
        || /\b(?:get|find|gather|prepare|secure|stockpile|stock up on)\b.{0,20}\b(?:something to eat)\b/.test(text)
    ) {
        const foodPoints = Math.max(12, Math.min(160, requestedCount(text, 24)));
        return {
            command: `!prepareFood(${foodPoints}, 64)`,
            response: 'I will secure a safe food reserve, replant mature crops, and cook what I gather.',
            releasesHold: true,
        };
    }

    const typedGoal = parseItemGoalRequest(playerName, message, context.bot);
    if (typedGoal) {
        const target = typedGoal.target.family || typedGoal.target.requestedName;
        return {
            command: `!requestItemGoal(${commandString(typedGoal.kind)}, ${commandString(target)}, ${typedGoal.quantity}, ${commandString(typedGoal.requester)})`,
            response: typedGoal.kind === 'deliver'
                ? `I will acquire exactly ${typedGoal.quantity} ${target.replaceAll('_', ' ')} and deliver them to ${typedGoal.destinationPlayer}; I will report completion only after Minecraft confirms pickup.`
                : `I will acquire exactly ${typedGoal.quantity} additional ${target.replaceAll('_', ' ')} and verify the resulting inventory.`,
            releasesHold: true,
        };
    }

    const tool = requestedTool(text);
    if (
        tool
        && /\b(?:make|craft|prepare|get|replace|equip|upgrade)\b/.test(text)
    ) {
        return {
            command: `!prepareTool(${commandString(tool)})`,
            response: `I will prepare and equip a usable ${tool.replaceAll('_', ' ')}.`,
            releasesHold: true,
        };
    }

    if (/\b(?:pick up|collect|grab)\b.{0,24}\b(?:items?|drops?|loot|gear)\b/.test(text)) {
        return {
            command: '!pickupUsefulItems(12)',
            response: 'I will pick up useful nearby supplies while the area is safe.',
            releasesHold: true,
        };
    }

    const resource = miningResource(text);
    if (
        resource
        && /\b(?:mine|collect|gather|find|get|bring)\b/.test(text)
    ) {
        const quota = requestedCount(text, resource === 'diamond_ore' ? 8 : 32);
        return {
            command: `!assignMiningJob(${commandString(resource)}, ${quota})`,
            response: `I will work that ${resource.replaceAll('_', ' ')} quota and keep the job checkpointed.`,
            releasesHold: true,
        };
    }

    if (
        /\b(?:stockpile|gather|collect|prepare)\b/.test(text)
        && /\b(?:planks?|cobblestone|dirt|building materials?)\b/.test(text)
    ) {
        const material = text.includes('cobblestone')
            ? 'cobblestone'
            : text.includes('dirt')
                ? 'dirt'
                : 'planks';
        const quota = requestedCount(text, 64);
        return {
            command: `!assignStockpileJob(${commandString(material)}, ${quota})`,
            response: `I will stockpile ${material} without treating that as permission to build.`,
            releasesHold: true,
        };
    }

    if (/\b(?:build|construct|make|put up)\b.{0,32}\b(?:shelter|hut|small house|safe house)\b/.test(text)) {
        return {
            command: '!assignFunctionalShelterJob("cobblestone")',
            response: 'I will gather what I need and build a supported, enclosed, lit shelter with access, storage, crafting, and smelting utilities.',
            releasesHold: true,
        };
    }

    if (/\b(?:harvest|collect|gather|chop|get)\b.{0,32}\b(?:wood|logs?|trees?)\b/.test(text)) {
        const quota = requestedCount(text, 32);
        return {
            command: `!assignHarvestJob("logs", ${quota})`,
            response: 'I will run a checkpointed timber job, replant when safe, and deliver it by policy.',
            releasesHold: true,
        };
    }

    return null;
}
