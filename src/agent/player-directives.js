import Vec3 from 'vec3';

import { classifyPlayerSpeechAuthority } from './player-speech-authority.js';
import { parseItemGoalRequest } from './runtime/goal-contract.js';

function commandString(value) {
    return JSON.stringify(String(value || ''));
}

export function routeCompoundToolGoal(playerName, command) {
    const match = /^!prepareTool\(\s*(["'])([a-z0-9_]{1,80})\1\s*\)\s*$/.exec(String(command || ''));
    if (!match) return command;
    return `!requestItemGoal("acquire", ${commandString(match[2])}, 1, ${commandString(playerName)}, "main_hand")`;
}

function normalizedMessage(message) {
    return String(message || '')
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/g, '');
}

function compatibleStandingCompanionDirective(playerName, context = {}) {
    const companion = context.companion;
    if (!['follow', 'guard'].includes(companion?.directive)) return null;
    const speaker = String(playerName || '').trim().toLowerCase();
    if (!speaker) return null;
    const identities = [
        companion.requestedName,
        companion.canonicalUsername,
        companion.alias,
    ]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    return identities.includes(speaker) ? companion.directive : null;
}

function namedPlaceLabel(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^(?:the|my|our)\s+/, '')
        .replace(/\s+(?:please|now)$/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 31);
}

function recalledUserPlaceLabel(context, value) {
    const label = namedPlaceLabel(value);
    return label && context.memoryBank?.recallUserPlaceDetails?.(label)
        ? label
        : null;
}

const CONSTRUCTION_SITE_RELATION = /\b(beside|near|next to|alongside|adjacent to|around)\s+(?:(?:the|our|my|your)\s+)?([a-z][a-z0-9 _-]{1,40}?)(?=\s*(?:[,.;]|$|\b(?:one|with|while|without|keep|keeping|do not|don't|dont|then|and then)\b))/;
const NON_LANDMARK_REFERENCES = new Set([
    'me',
    'us',
    'you',
    'it',
    'this',
    'that',
    'here',
    'there',
    'the_bot',
    'bot',
]);

function constructionDimension(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, '')
        .replace(/^the_nether$/, 'nether')
        .replace(/^the_end$/, 'end')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 32);
}

function constructionSiteRelation(message) {
    const match = CONSTRUCTION_SITE_RELATION.exec(String(message || '').toLowerCase());
    if (!match) return null;
    const name = namedPlaceLabel(match[2]);
    if (!name || NON_LANDMARK_REFERENCES.has(name)) return null;
    const relation = match[1] === 'near'
        ? 'near'
        : match[1] === 'around'
            ? 'around'
            : 'beside';
    return { name, relation };
}

function finiteConstructionPosition(value) {
    const position = {
        x: Math.floor(Number(value?.x)),
        y: Math.floor(Number(value?.y)),
        z: Math.floor(Number(value?.z)),
    };
    return Object.values(position).every(Number.isFinite) ? position : null;
}

function rememberedStructureMatchesReference(order, reference) {
    if (
        order?.phase !== 'complete'
        || !order?.target
        || !Array.isArray(order?.blueprint?.cells)
        || order.blueprint.cells.length === 0
    ) return false;
    const words = String(reference?.name || '').split('_').filter(word => word.length > 1);
    const identity = String(order.blueprint.id || '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .split('_')
        .filter(Boolean);
    if (words.length < 2 || !words.every(word => identity.includes(word))) return false;
    const bot = reference.bot;
    if (typeof bot?.blockAt !== 'function') return false;
    try {
        return order.blueprint.cells.every(cell => {
            const block = bot.blockAt(new Vec3(
                order.target.x + cell.x,
                order.target.y + cell.y,
                order.target.z + cell.z,
            ));
            return block?.name === cell.material;
        });
    } catch {
        return false;
    }
}

function constructionSiteConstraint(message, context = {}) {
    const reference = constructionSiteRelation(message);
    if (!reference) return { reference: null, constraint: null };
    const currentDimension = constructionDimension(context.bot?.game?.dimension);
    const rememberedHome = context.homeState?.snapshot?.() || {};
    const rememberedPlace = context.memoryBank?.recallUserPlaceDetails?.(reference.name);
    const rememberedPosition = finiteConstructionPosition(rememberedPlace);
    const rememberedDimension = constructionDimension(rememberedPlace?.dimension);
    if (rememberedPosition && rememberedDimension) {
        return {
            reference,
            constraint: {
                kind: 'remembered_place',
                name: reference.name,
                relation: reference.relation,
                position: rememberedPosition,
                dimension: rememberedDimension,
                radius: reference.relation === 'near' ? 12 : 8,
                sourceId: reference.name,
            },
        };
    }

    const farmPosition = finiteConstructionPosition(rememberedHome.farm?.water);
    const farmDimension = constructionDimension(rememberedHome.farm?.dimension);
    if (reference.name === 'farm' && farmPosition && farmDimension) {
        return {
            reference,
            constraint: {
                kind: 'remembered_farm',
                name: reference.name,
                relation: reference.relation,
                position: farmPosition,
                dimension: farmDimension,
                radius: reference.relation === 'near' ? 12 : 8,
                sourceId: 'home_state_farm',
            },
        };
    }

    const order = rememberedHome.structureOrder;
    if (
        currentDimension
        && rememberedStructureMatchesReference(order, { ...reference, bot: context.bot })
    ) {
        const width = Math.max(1, Number(order.blueprint.width) || 1);
        const depth = Math.max(1, Number(order.blueprint.depth) || 1);
        return {
            reference,
            constraint: {
                kind: 'remembered_structure',
                name: reference.name,
                relation: reference.relation,
                position: {
                    x: Math.floor(order.target.x + ((width - 1) / 2)),
                    y: Math.floor(order.target.y),
                    z: Math.floor(order.target.z + ((depth - 1) / 2)),
                },
                dimension: currentDimension,
                radius: reference.relation === 'near' ? 12 : 8,
                sourceId: String(order.id || '').slice(0, 96),
            },
        };
    }
    return { reference, constraint: null };
}

function constructionLayoutConstraint(message, siteConstraint) {
    if (!siteConstraint) return null;
    const text = String(message || '').toLowerCase();
    const oppositeSides = /\b(?:one on each side|on opposite sides|one (?:seat|chair|bench) (?:on|at) (?:either|each) side)\b/.test(text);
    const inward = /\b(?:facing|face|faced) inward\b|\bfacing each other\b/.test(text);
    if (!oppositeSides || !inward) return null;
    return {
        arrangement: 'opposite_sides',
        orientation: 'inward',
        clearance: /\b(?:walking|walk|access) ring clear\b/.test(text) ? 1 : 0,
    };
}

const SMALL_SPOKEN_COUNTS = Object.freeze({
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
});

const TENS_SPOKEN_COUNTS = Object.freeze({
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
});

function requestedCount(text, fallback) {
    const numeric = /\b(\d{1,4})\b/.exec(text);
    let candidate = numeric
        ? { index: numeric.index, value: Number.parseInt(numeric[1], 10) }
        : null;
    const words = [...String(text).toLowerCase().matchAll(/\b[a-z]+\b/g)];
    for (let index = 0; index < words.length; index += 1) {
        const [word] = words[index];
        const small = SMALL_SPOKEN_COUNTS[word];
        const tens = TENS_SPOKEN_COUNTS[word];
        if (small) {
            const spoken = { index: words[index].index, value: small };
            if (!candidate || spoken.index < candidate.index) candidate = spoken;
            break;
        }
        if (tens) {
            const next = SMALL_SPOKEN_COUNTS[words[index + 1]?.[0]] || 0;
            const spoken = {
                index: words[index].index,
                value: tens + (next < 10 ? next : 0),
            };
            if (!candidate || spoken.index < candidate.index) candidate = spoken;
            break;
        }
    }
    if (!candidate) return fallback;
    return Math.max(1, Math.min(2304, candidate.value));
}

const MINING_RESOURCES = Object.freeze([
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
]);

export function miningResources(text) {
    const normalized = String(text || '').toLowerCase();
    const matches = MINING_RESOURCES.flatMap(([label, target]) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = new RegExp(`\\b${escaped}\\b`).exec(normalized);
        return match ? [{ label, target, index: match.index }] : [];
    }).sort((left, right) => left.index - right.index || right.label.length - left.label.length);
    const seen = new Set();
    return matches.filter(match => {
        if (seen.has(match.target)) return false;
        seen.add(match.target);
        return true;
    });
}

function miningResource(text) {
    return miningResources(text)[0]?.target || null;
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

function clampInt(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function firstNumber(text, fallback) {
    const match = text.match(/-?\d{1,5}/);
    return match ? Number.parseInt(match[0], 10) : fallback;
}

function tunnelDirection(text) {
    if (/\b(?:forward|ahead|straight)\b/.test(text)) return 'forward';
    return ['north', 'south', 'east', 'west'].find(dir => new RegExp(`\\b${dir}\\b`).test(text)) || 'forward';
}

/**
 * Canonicalize a spoken item name. When the connected registry is available the
 * name must actually exist in it: emitting a command for an item the server has
 * never heard of produces a confident-sounding failure, where returning null
 * lets the message fall through to the model, which can ask what was meant.
 */
function canonicalItem(raw, bot) {
    const name = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/^(?:the|some|a|an|your|my|all|these|those|any)\s+/, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    if (!name || name.length > 40) return null;
    const registry = bot?.registry?.itemsByName;
    if (!registry) return name;
    if (registry[name]) return name;
    const singular = name.replace(/s$/, '');
    return singular && registry[singular] ? singular : null;
}

function carriedItemCount(bot, itemName) {
    const items = bot?.inventory?.items?.();
    if (!Array.isArray(items)) return 0;
    return items.reduce((total, item) => (
        item?.name === itemName ? total + Math.max(0, Number(item.count) || 0) : total
    ), 0);
}

/** Pull the object of a verb: "smelt 5 raw iron" -> "raw iron". */
function objectOf(text, verbs, stopWords = '') {
    const tail = stopWords ? `(?=\\s+(?:${stopWords})\\b|$)` : '$';
    const match = new RegExp(
        `\\b(?:${verbs})\\s+(?:\\d{1,4}\\s+)?([a-z][a-z_ ]{1,38}?)\\s*${tail}`,
    ).exec(text);
    return match ? match[1].trim() : null;
}

/** Longest labels first so "stone bricks" is not read as "stone". */
function structureMaterial(text) {
    const materials = [
        ['stone brick', 'stone_bricks'],
        ['cobblestone', 'cobblestone'],
        ['cobble', 'cobblestone'],
        ['sandstone', 'sandstone'],
        ['oak plank', 'oak_planks'],
        ['plank', 'oak_planks'],
        ['brick', 'bricks'],
        ['wood', 'oak_planks'],
        ['stone', 'stone'],
        ['dirt', 'dirt'],
    ];
    return materials.find(([label]) => text.includes(label))?.[1] || 'cobblestone';
}

/** "12 blocks tall" / "9 wide" -> the number, when the player gave one. */
function dimension(text, words) {
    const match = new RegExp(`(\\d{1,2})\\s*(?:blocks?\\s+)?(?:${words})`).exec(text);
    return match ? Number.parseInt(match[1], 10) : null;
}

// One shared construction-language boundary. These verbs authorize a bounded
// blueprint, never a stream of individual model-owned placement commands.
const CONSTRUCTION_VERB = /\b(?:build|construct|make|put up|set up|establish|erect|raise|assemble|lay out)\b/;

// Preservation clauses can name both a construction verb and a structure
// without granting construction authority: "do not damage any build" and
// "without changing the base" are constraints on another action. Remove only
// those bounded clauses before evaluating construction intent; a later
// explicit ", then build ..." clause remains actionable.
function constructionAuthorizationText(message) {
    return String(message || '').replace(
        /\b(?:do not|don't|dont|never|without)\b[\s\S]*?(?=(?:[.;]|,\s*(?:and\s+)?then\b)|$)/g,
        ' ',
    );
}

export function hasAuthorizedConstructionVerb(message) {
    return CONSTRUCTION_VERB.test(constructionAuthorizationText(message));
}

function parseCoordinates(text) {
    const matches = text.match(/-?\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 3) return null;
    const [x, y, z] = matches.slice(0, 3).map(Number);
    if (![x, y, z].every(Number.isFinite) || y < -64 || y > 320) return null;
    return { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
}

export function constructionRequiredFunctions(message) {
    const normalized = constructionAuthorizationText(String(message || '').toLowerCase());
    const constructionVerb = CONSTRUCTION_VERB.exec(normalized);
    const constructionClause = constructionVerb
        ? normalized.slice(constructionVerb.index)
        : normalized;
    const text = constructionClause.split(
        /,\s*(?:(?:and\s+)?(?:use|using|do not|don't|dont|without)\b)/,
        1,
    )[0];
    const required = new Set();
    const buildsShelter = new RegExp(`${CONSTRUCTION_VERB.source}.{0,96}\\b(?:shelter|house|hut|outpost)\\b`).test(text);
    if (buildsShelter || /\bovernight\b/.test(text)) {
        required.add('enclosure');
        required.add('weather_cover');
        required.add('access');
    }
    if (/\b(?:window|windows|daylight)\b/.test(text)) required.add('daylight');
    if (/\b(?:light|lighting|lit|torch|torches)\b/.test(text)) required.add('interior_light');
    if (/\b(?:fence|fenced|pen|paddock|corral)\b/.test(text)) required.add('containment');
    if (/\b(?:door|gate|gates|gated|entrance|entry)\b/.test(text)) required.add('access');
    if (/\b(?:bed|sleep|overnight)\b/.test(text)) required.add('rest');
    if (/\b(?:crafting table|workbench)\b/.test(text)) required.add('crafting');
    if (/\b(?:furnace|smelter|stove)\b/.test(text)) required.add('smelting');
    if (/\b(?:chest|storage)\b/.test(text)) required.add('storage');
    return [...required].sort();
}

function describesMultiBlockConstruction(text, requiredFunctions = []) {
    if (requiredFunctions.length > 0) return true;
    return /\b(?:structure|building|base|camp|shelter|house|hut|outpost|room|cabin|shack|lodge|tower|watchtower|lookout|bridge|walkway|catwalk|wall|barrier|rampart|pen|paddock|corral|enclosure|platform|deck|floor|pillar|column|post|stairs|staircase|steps|seat|seats|bench|benches|chair|chairs|furniture|roof|road|path|dock|pier|tunnel|loop|track|railway|windmill|mill|machine|contraption|statue|monument|gazebo|barn|workshop|worksite|workspace|work area)\b/.test(text);
}

function describesModelSelectedItemPlan(text) {
    // "Build up our supplies" is inventory work, not authorization to place
    // blocks. Keep this ordinary phrasal-verb form ahead of the generic
    // construction boundary so the existing capability engine owns it.
    const growsInventory = /\b(?:build|grow|bring|get|fill|top)\s+(?:(?:my|your|our|the)\s+)?(?:supplies|stock|inventory|resources|materials|provisions)\s+up\b/.test(text)
        || /\b(?:build|grow|bring|get|fill|top)\s+up\s+(?:(?:my|your|our|the)\s+)?(?:supplies|stock|inventory|resources|materials|provisions)\b/.test(text);
    const asksForInventoryWork = /\b(?:gather|collect|acquire|secure|prepare|make|craft|stock up on|restock)\b/.test(text)
        || growsInventory;
    const namesASet = /\b(?:supplies|resources|materials|provisions|gear|equipment|tools|items)\b/.test(text);
    const delegatesSelection = /\b(?:sensible|basic|essential|starter|useful|whatever|whichever|what you need|you need|needed)\b/.test(text);
    const explicitlyBuilds = new RegExp(`${CONSTRUCTION_VERB.source}.{0,80}\\b(?:structure|building|base|camp|shelter|house|hut|outpost|room|tower|bridge|wall|pen|platform|roof|dock|barn|workshop|worksite|workspace|work area)\\b`).test(constructionAuthorizationText(text));
    // Safety qualifiers commonly name nearby structures ("without damaging
    // the outpost"). They do not change the object of "build supplies up".
    if (growsInventory && namesASet) return true;
    return asksForInventoryWork && namesASet && delegatesSelection && !explicitlyBuilds;
}

function describesModelSelectedStoragePlan(text) {
    const asksForStorage = /\b(?:clean up|organize|sort|put|store|stash|deposit)\b/.test(text);
    const explicitlyCleansUp = /\b(?:clean up|organize|sort)\b/.test(text);
    const alsoAcquires = /\b(?:explore|find|search|gather|collect|mine|acquire|make|craft|prepare)\b/.test(text);
    const namesASet = /\b(?:inventory|ore|ores|stone|dirt|sand|materials|resources|supplies|gear|equipment|tools|items)\b/.test(text);
    const delegatesSelection = /\b(?:loose|worn|extra|spare|surplus|unneeded|useful|working|good|best|all but)\b/.test(text);
    const namesContainer = /\b(?:chest|barrel)\b/.test(text);
    return asksForStorage
        && namesASet
        && delegatesSelection
        && namesContainer
        && (explicitlyCleansUp || !alsoAcquires);
}

export function resolveTypedItemGoalDirective(playerName, message, context = {}) {
    const typedGoal = parseItemGoalRequest(playerName, message, context.bot);
    if (!typedGoal) return null;
    const target = typedGoal.target.family || typedGoal.target.requestedName;
    const workstationArguments = typedGoal.workstationName
        ? `, ${commandString(typedGoal.workstationName)}, ${commandString(typedGoal.request)}`
        : '';
    return {
        command: `!requestItemGoal(${commandString(typedGoal.kind)}, ${commandString(target)}, ${typedGoal.quantity}, ${commandString(typedGoal.requester)}, ${commandString(typedGoal.completion.kind)}${workstationArguments})`,
        response: typedGoal.kind === 'deliver'
            ? `I will acquire exactly ${typedGoal.quantity} ${target.replaceAll('_', ' ')} and deliver them to ${typedGoal.destinationPlayer}; I will report completion only after Minecraft confirms pickup.`
            : typedGoal.indefiniteBatch
                ? `I will make a recipe batch of ${target.replaceAll('_', ' ')} and keep working through its prerequisites until Minecraft verifies the output.`
                : typedGoal.completion.kind === 'inventory'
                    ? `I will acquire exactly ${typedGoal.quantity} additional ${target.replaceAll('_', ' ')} and verify the resulting inventory.`
                    : `I will acquire ${target.replaceAll('_', ' ')} and verify it in my ${typedGoal.completion.kind.replace('_', ' ')}.`,
        releasesHold: true,
    };
}

export function resolvePlayerDirective(playerName, message, context = {}) {
    const rawText = String(message || '').trim().replace(/[.!?]+$/g, '');
    const text = normalizedMessage(message);
    if (!playerName || !text || text.includes('!')) return null;

    // Item handoffs are observations, not assignments of new physical work.
    // Route them through the live body/world query before the conversation-only
    // authority guard so the model cannot infer pickup history from one current
    // snapshot or deny a tool that its own inventory already lists.
    if (/\b(?:i|we)\s+(?:just\s+)?(?:gave|gavae|handed|passed|threw|tossed|dropped)\s+you\b/.test(text)) {
        return {
            command: '!awareness',
            response: 'Checking my carried items and nearby drops now.',
            releasesHold: false,
        };
    }
    if (classifyPlayerSpeechAuthority(message) !== 'action_eligible') return null;

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
        || /^(?:please\s+)?come(?:\s+back)?\s+with\s+me\b/.test(text)) {
        return {
            command: `!followPlayer(${commandString(playerName)}, 3)`,
            response: 'I will follow you now.',
            releasesHold: true,
        };
    }

    if (/^(?:please\s+)?(?:come|walk|move|get|return|head)(?:\s+back)?\s+(?:here|to (?:me|us)|over here)\b/.test(text)) {
        const standingDirective = compatibleStandingCompanionDirective(playerName, context);
        if (standingDirective) {
            const commandName = standingDirective === 'guard' ? 'guardPlayer' : 'followPlayer';
            return {
                command: `!${commandName}(${commandString(playerName)}, 3)`,
                response: standingDirective === 'guard'
                    ? 'I am coming back to you and keeping guard.'
                    : 'I am coming back to you and staying with you.',
                releasesHold: true,
            };
        }
        return {
            command: `!goToPlayer(${commandString(playerName)}, 2)`,
            response: 'I will come to you now.',
            releasesHold: true,
        };
    }

    // Deictic gaze commands must bind "me" to the canonical speaker before
    // dialogue history can leak a previous player's identity into the turn.
    if (/^(?:(?:simon says|please|now)\s*,?\s*)*(?:look|face)\s+(?:right\s+)?at\s+me(?:\s+(?:now|please))?$/.test(text)) {
        return {
            command: `!lookAtPlayer(${commandString(playerName)}, "at")`,
            response: 'Looking at you now.',
            releasesHold: true,
        };
    }

    const namedReturn = /^(?:please\s+)?(?:come|return|head)(?:\s+back)?\s+home\s+to\s+([._a-z0-9]{1,32})\b/i.exec(rawText);
    if (namedReturn) {
        const requestedTarget = /^(?:me|us)$/i.test(namedReturn[1])
            ? playerName
            : namedReturn[1];
        return {
            command: `!goToPlayer(${commandString(requestedTarget)}, 2)`,
            response: `I will go to ${requestedTarget} now.`,
            releasesHold: true,
        };
    }

    // A bare "stop"/"cancel" halts everything. "cancel the job", "stop the goal",
    // and "cancel your plan" name a specific thing to cancel and are handled by
    // the dedicated branches further down, so they must not be swallowed here.
    if (/^(?:please\s+)?(?:stop|stop moving|cancel|hold on)\b/.test(text)
        && !/\b(?:job|work order|goal|plan|agenda|queue|task list|todo)\b/.test(text)) {
        return {
            command: '!stop',
            response: 'Stopping now.',
            releasesHold: false,
        };
    }

    if (/^(?:please\s+)?(?:stay|stay here|wait|wait here|do not move|don't move|dont move)\b/.test(text)) {
        return {
            command: '!stop',
            response: 'Staying here under hold until you give me another order.',
            releasesHold: false,
        };
    }

    if (/^(?:please\s+)?(?:resume|continue)(?:\s+(?:the\s+)?(?:last\s+)?(?:build|construction|structure|job|work order))?$/.test(text)) {
        return {
            command: '!resumeStructureJob',
            response: 'Re-auditing the remembered construction and continuing from its verified physical state.',
            releasesHold: true,
        };
    }

    // --- Navigation, mining, and self-maintenance ----------------------------
    // Common phrasings mapped straight onto existing skills so they never need a
    // model round trip. These are discrete one-shot actions (not agenda kinds),
    // so they run on the single-directive fast path.

    if (/\b(?:give us (?:a little |some )?(?:space|room)|give (?:both|all) of us (?:some )?(?:space|room)|make (?:some )?(?:space|room) for us|step back(?:\s+\w+){0,5}\s+from us)\b/.test(text)) {
        const distance = clampInt(requestedCount(text, 5), 1, 64, 5);
        return {
            command: `!moveAway(${distance}, false, ${commandString(playerName)})`,
            response: `Backing away from the group about ${distance} block${distance === 1 ? '' : 's'}.`,
            releasesHold: true,
        };
    }

    if (/\b(?:move away|back off|back up|step back|give me (?:some )?(?:space|room)|get away from me|make some room)\b/.test(text)) {
        const distance = clampInt(requestedCount(text, 5), 1, 64, 5);
        return {
            command: `!moveAway(${distance})`,
            response: `Backing off about ${distance} block${distance === 1 ? '' : 's'}.`,
            releasesHold: true,
        };
    }

    if (/\b(?:go (?:to )?(?:bed|sleep)|get to bed|get some sleep|time for bed|lie down|sleep now|go (?:in|inside) and sleep|sleep inside)\b/.test(text)) {
        return {
            command: '!goToBed',
            response: 'Finding the nearest bed to sleep.',
            releasesHold: true,
        };
    }

    if (/\b(?:to the surface|above ground|back up top|up top)\b/.test(text)) {
        return {
            command: '!goToSurface',
            response: 'Heading back up to the surface.',
            releasesHold: true,
        };
    }

    if (/\b(?:dig|tunnel|mine)\s+(?:straight\s+)?down\b/.test(text)) {
        const untilBlocked = /\b(?:until|till)\b.{0,48}\b(?:cannot|can't|unable|blocked|anymore|any more|further)\b/.test(text);
        const distance = untilBlocked
            ? 384
            : clampInt(firstNumber(text, 10), 1, 384, 10);
        return {
            command: `!digDown(${distance})`,
            response: untilBlocked
                ? 'Digging straight down until physically blocked, with the normal hazard checks on every block.'
                : `Digging straight down ${distance} block${distance === 1 ? '' : 's'}, stopping if I hit lava, water, or a drop.`,
            releasesHold: true,
        };
    }

    if (/\b(?:dig|cut|carve|bore|strip.?mine)\b.{0,20}\btunnel\b/.test(text)
        || /\btunnel\b.{0,16}\b(?:forward|ahead|straight|north|south|east|west)\b/.test(text)
        || /\bdig\s+(?:a\s+)?(?:corridor\s+)?(?:forward|ahead|straight|north|south|east|west)\b/.test(text)) {
        const direction = tunnelDirection(text);
        const length = clampInt(firstNumber(text, 8), 1, 64, 8);
        return {
            command: `!digTunnel("${direction}", ${length})`,
            response: `Cutting a ${length}-block tunnel ${direction === 'forward' ? 'straight ahead' : direction}, lighting it as I go and stopping at anything unsafe.`,
            releasesHold: true,
        };
    }

    if (/\b(?:recover|retrieve|go get|grab|collect)\b.{0,24}\b(?:death (?:items|drops|stuff|point|pile)|dropped (?:items|stuff|inventory|things)|(?:my|your) (?:stuff|items|things|gear) back|lost items|your body)\b/.test(text)) {
        return {
            command: '!recoverDeathItems',
            response: 'Heading back to where I died to recover my dropped items.',
            releasesHold: true,
        };
    }

    if (/\b(?:go fishing|do some fishing|catch (?:some |a few )?fish|fish for (?:some )?(?:fish|food)|start fishing)\b/.test(text)) {
        const count = clampInt(firstNumber(text, 8), 1, 64, 8);
        return {
            command: `!fish(${count})`,
            response: `Fishing until I land ${count} catch${count === 1 ? '' : 'es'}.`,
            releasesHold: true,
        };
    }

    if (/\b(?:go|walk|head|travel|run)\s+to\b/.test(text) || /\bcoord(?:inate)?s?\b/.test(text)) {
        const coords = parseCoordinates(text);
        if (coords) {
            return {
                command: `!goToCoordinates(${coords.x}, ${coords.y}, ${coords.z}, 2)`,
                response: `On my way to ${coords.x}, ${coords.y}, ${coords.z}.`,
                releasesHold: true,
            };
        }
    }

    // --- Items, containers, and gear ----------------------------------------
    // These verbs are unambiguous, so they resolve before the broader
    // acquisition parsing further down ever sees the message.

    const relationalPlacement = /^(?:please\s+)?(?:set|place|put)\s+(.+?)\s+(beside|near|next to|by|alongside|adjacent to)\s+(me|us|here|the family)\b/.exec(text);
    if (relationalPlacement) {
        const item = canonicalItem(relationalPlacement[1], context.bot);
        if (item) {
            const shared = relationalPlacement[3] === 'us'
                || relationalPlacement[3] === 'the family'
                || /\b(?:everyone|all (?:of )?us|all three)\b/.test(text);
            return {
                command: `!place(${commandString(playerName)}, ${commandString(item)}, 1, ${shared})`,
                response: shared
                    ? `Placing my ${item.replaceAll('_', ' ')} at a supported site the nearby family can share.`
                    : `Placing my ${item.replaceAll('_', ' ')} at a supported site near you.`,
                releasesHold: true,
            };
        }
    }

    if (describesModelSelectedStoragePlan(text)) {
        const shouldReturn = /\b(?:return|come back|head back|go back)\b/.test(text);
        return {
            command: null,
            response: '',
            releasesHold: true,
            deferToModel: true,
            assignmentKind: 'storage_plan',
            modelInstruction: `This player authorized one broad inventory-cleanup outcome whose concrete storage list requires bounded judgment. Compile the COMPLETE storage list before any physical work. Return exactly one !queueStoragePlan command in your first response, with 1-12 real carried canonical item names encoded as canonical_item:retain_quantity entries separated by |, requester ${commandString(playerName)}, and return_to_player ${shouldReturn}. The quantity is how many of that item must remain in the bot inventory after cleanup; zero means store all carried copies. Include only items the player authorized for storage and only when current INVENTORY contains surplus above the retained quantity. For duplicate durable tools, retain the requested best instances; the deterministic storage capability chooses which physical copies to preserve. Do not acquire, mine, craft, build, place, break, discard, or move anywhere except the selected existing container and the optional player return. Do not issue remember, search, inspection, individual chest-transfer, or conversational commands first.`,
        };
    }

    if (/\bchest\b/.test(text)) {
        if (/\b(?:what(?:'s| is) in|check|look in|peek in|show(?: me)?(?: the)? contents)\b/.test(text)) {
            return {
                command: '!viewChest',
                response: 'Checking what is in the nearest chest.',
                releasesHold: true,
            };
        }
        const stored = objectOf(text, 'put|store|stash|deposit|place', 'in|into|inside');
        if (stored && /\b(?:in|into|inside)\b/.test(text)) {
            const item = canonicalItem(stored, context.bot);
            if (item) {
                const count = clampInt(firstNumber(text, 64), 1, 2304, 64);
                return {
                    command: `!putInChest("${item}", ${count})`,
                    response: `Putting ${item.replaceAll('_', ' ')} into the nearest chest.`,
                    releasesHold: true,
                };
            }
        }
        const taken = objectOf(text, 'take|get|grab|withdraw|fetch|pull', 'from|out|outta');
        if (taken && /\b(?:from|out of)\b/.test(text)) {
            const item = canonicalItem(taken, context.bot);
            if (item) {
                const count = clampInt(firstNumber(text, 64), 1, 2304, 64);
                return {
                    command: `!takeFromChest("${item}", ${count})`,
                    response: `Taking ${item.replaceAll('_', ' ')} out of the nearest chest.`,
                    releasesHold: true,
                };
            }
        }
    }

    const smelted = objectOf(
        text,
        'smelt|cook|melt|refine',
        `you(?:'re| are) carrying|you (?:have|brought)|in your inventory`,
    );
    if (smelted) {
        const item = canonicalItem(smelted, context.bot);
        if (item) {
            const carryingReference = /\b(?:you(?:'re| are) carrying|you (?:have|brought)|in your inventory)\b/.test(text);
            const fallback = carryingReference
                ? Math.max(1, carriedItemCount(context.bot, item))
                : 8;
            const count = clampInt(firstNumber(text, fallback), 1, 2304, fallback);
            return {
                command: `!smeltItem("${item}", ${count})`,
                response: `Smelting ${count} ${item.replaceAll('_', ' ')}.`,
                releasesHold: true,
            };
        }
    }

    const crafted = objectOf(text, 'craft');
    if (crafted) {
        const item = canonicalItem(crafted, context.bot);
        if (item) {
            const count = clampInt(firstNumber(text, 1), 1, 64, 1);
            return {
                command: `!craftRecipe("${item}", ${count})`,
                response: `Crafting ${item.replaceAll('_', ' ')}.`,
                releasesHold: true,
            };
        }
    }

    const equipped = objectOf(
        text,
        'equip|wield|put on|wear|hold',
        'i|we|you|that|which|from|for|please|now',
    );
    const compoundEquipmentAcquisition = /\b(?:make|craft|prepare|get|build)\b/.test(text)
        && /\b(?:equip|wield|hold)\b/.test(text);
    if (equipped && !compoundEquipmentAcquisition) {
        const item = canonicalItem(equipped, context.bot);
        if (item) {
            return {
                command: `!equip("${item}")`,
                response: `Equipping my ${item.replaceAll('_', ' ')}.`,
                releasesHold: true,
            };
        }
    }

    const discarded = objectOf(text, 'drop|discard|throw away|get rid of|dump');
    if (discarded) {
        const item = canonicalItem(discarded, context.bot);
        if (item) {
            const count = clampInt(firstNumber(text, 64), 1, 2304, 64);
            return {
                command: `!discard("${item}", ${count})`,
                response: `Dropping ${item.replaceAll('_', ' ')}.`,
                releasesHold: true,
            };
        }
    }

    // --- Riding and depth ----------------------------------------------------

    const rideable = ['horse', 'boat', 'minecart', 'pig', 'strider', 'camel', 'donkey', 'mule']
        .find(name => new RegExp(`\\b${name}s?\\b`).test(text));
    const requestsMount = rideable && (
        /\b(?:get on|hop on|climb on)\b/.test(text)
        || new RegExp(`\\b(?:ride|mount)\\s+(?:(?:the|this|that|a|an|our|my|your)\\s+)?${rideable}s?\\b`).test(text)
    );
    if (requestsMount) {
        return {
            command: `!mountEntity("${rideable}", 32)`,
            response: `Looking for a ${rideable} to ride.`,
            releasesHold: true,
        };
    }

    if (/\b(?:get off|dismount|hop off|climb off|get down from)\b/.test(text)) {
        return {
            command: '!dismount',
            response: 'Dismounting.',
            releasesHold: true,
        };
    }

    if (/\b(?:mining depth|diamond level|deepslate level|go down to y|dig down to y)\b/.test(text)) {
        const depth = /\bdiamond level\b|\bdeepslate level\b/.test(text)
            ? -54
            : clampInt(firstNumber(text, -54), -60, 300, -54);
        return {
            command: `!goToMiningDepth(${depth}, 64)`,
            response: `Working my way down to Y ${depth} on a safe route.`,
            releasesHold: true,
        };
    }

    // --- Named places --------------------------------------------------------

    if (/^(?:please\s+)?(?:what (?:saved )?(?:places|locations|spots) do you remember|what (?:places|locations|spots) (?:have you|do you have) saved|(?:show|list|tell me) (?:me )?(?:your|my|our|the)?\s*(?:saved|remembered)?\s*(?:places|locations|spots))$/.test(text)) {
        return {
            command: '!savedPlaces',
            response: 'Checking my named-place memory.',
            releasesHold: false,
        };
    }

    const savedAs = /\b(?:remember|save|mark|call)\b.{0,24}\b(?:spot|place|location|here)\b\s*(?:as|called|named)\s+([a-z][a-z0-9_ ]{0,30})/.exec(text)
        || /\b(?:remember|save|mark)\s+(?:this\s+)?(?:as|called|named)\s+([a-z][a-z0-9_ ]{0,30})/.exec(text);
    if (savedAs) {
        const label = namedPlaceLabel(savedAs[1]);
        if (label && label !== 'home') {
            return {
                command: `!rememberHere("${label}")`,
                response: `Saving this spot as ${label.replaceAll('_', ' ')}.`,
                releasesHold: false,
            };
        }
    }

    const explicitForgottenPlace = /^(?:please\s+)?(?:forget|remove|delete)\s+(?:(?:the|my|our)\s+)?(?:(?:saved|remembered)\s+)?(?:spot|place|location)\s+(?:called\s+|named\s+)?([a-z][a-z0-9_ ]{0,30})$/.exec(text);
    const bareForgottenPlace = /^(?:please\s+)?(?:forget|remove|delete)\s+([a-z][a-z0-9_ ]{0,30})$/.exec(text);
    const forgottenLabel = explicitForgottenPlace
        ? namedPlaceLabel(explicitForgottenPlace[1])
        : bareForgottenPlace
            ? recalledUserPlaceLabel(context, bareForgottenPlace[1])
            : null;
    if (forgottenLabel) {
        return {
            command: `!forgetRememberedPlace("${forgottenLabel}")`,
            response: `Removing ${forgottenLabel.replaceAll('_', ' ')} from my named-place memory.`,
            releasesHold: false,
        };
    }

    const savedPlace = /\bgo\s+(?:back\s+)?to\s+(?:the\s+|my\s+|our\s+)?(?:saved\s+|remembered\s+)?(?:spot|place|location)\s+(?:called\s+|named\s+)?([a-z][a-z0-9_ ]{0,30})/.exec(text);
    const directSavedPlace = /^(?:please\s+)?(?:go|walk|head|travel|run|return)(?:\s+back)?\s+to\s+([a-z][a-z0-9_ ]{0,30})$/.exec(text);
    const savedLabel = savedPlace
        ? namedPlaceLabel(savedPlace[1])
        : directSavedPlace
            ? recalledUserPlaceLabel(context, directSavedPlace[1])
            : null;
    if (savedLabel) {
        return {
            command: `!goToRememberedPlace("${savedLabel}")`,
            response: `Checking ${savedLabel.replaceAll('_', ' ')} and heading there if it is in this dimension.`,
            releasesHold: true,
        };
    }

    // --- Plan (agenda) control ----------------------------------------------
    // The queue is only as usable as the words that steer it, so plan control
    // never depends on the model being reachable.

    if (/\b(?:what(?:'s| is) (?:your |the )?plan|show (?:me )?(?:your |the )?(?:plan|agenda|queue|todo)|what are you (?:doing|working on) next|what(?:'s| is) (?:next|left)|list your (?:plan|tasks))\b/.test(text)) {
        return {
            command: '!showAgenda',
            response: 'Here is what I have queued.',
            releasesHold: false,
        };
    }

    if (/\b(?:clear|cancel|scrap|forget|wipe|drop)\s+(?:your |the |my )?(?:whole |entire )?(?:(?:rest|remainder) of (?:your|the|my) )?(?:old |previous |remaining |current )?(?:plan|agenda|queue|todo list|task list|everything)\b/.test(text)) {
        return {
            command: '!clearAgenda',
            response: 'Clearing my whole plan.',
            releasesHold: false,
        };
    }

    if (/\b(?:skip|drop|forget|abandon|move past)\s+(?:that|this|the current|current|it)\b.{0,16}\b(?:step|task|one|job)?\b/.test(text)
        && /\b(?:step|task|one|job|that|this)\b/.test(text)) {
        return {
            command: '!skipAgendaItem',
            response: 'Skipping that step and moving to the next one.',
            releasesHold: false,
        };
    }

    if (/\b(?:cancel|stop|abandon|call off)\s+(?:the |your |that )?(?:current )?(?:job|work order|work|assignment)\b/.test(text)) {
        return {
            command: '!cancelJob',
            response: 'Cancelling my active work order.',
            releasesHold: false,
        };
    }

    if (/\b(?:cancel|stop|abandon|call off)\s+(?:the |your |that )?(?:current )?goal\b/.test(text)) {
        return {
            command: '!cancelGoal',
            response: 'Cancelling my active goal.',
            releasesHold: false,
        };
    }

    // --- Base, farm, and livestock ------------------------------------------

    if (/^(?:please\s+)?(?:go|walk|head|travel|run)\s+to\s+(?:the\s+)?(?:remembered\s+)?farm\b/.test(text)) {
        return {
            command: '!goToFarm',
            response: 'Heading to the remembered farm.',
            releasesHold: true,
        };
    }

    if (/\b(?:remember|save|mark|set)\b.{0,20}\b(?:this (?:spot|place|position|location) as )?(?:your |our |the )?home\b/.test(text)
        || /\bthis is (?:your|our) home\b/.test(text)) {
        return {
            command: '!rememberHome',
            response: 'Remembering this spot as my home.',
            releasesHold: false,
        };
    }

    if (/\b(?:repair|fix|patch|mend|rebuild)\b.{0,24}\b(?:the |your |our )?(?:home|house|base|building|structure|shelter)\b/.test(text)) {
        return {
            command: '!repairHome',
            response: 'Checking the remembered structure and repairing anything missing.',
            releasesHold: true,
        };
    }

    const crop = ['wheat', 'carrots', 'potatoes', 'beetroots']
        .find(name => new RegExp(`\\b${name.replace(/e?s$/, '')}`).test(text));
    if (/\b(?:make|build|start|set up|establish|plant|create)\b.{0,24}\b(?:farm|crops?|field)\b/.test(text)) {
        const size = clampInt(firstNumber(text, 3), 1, 4, 3);
        return {
            command: `!establishFarm("${crop || 'wheat'}", ${size}, ${size})`,
            response: `I will till and plant a ${size}x${size} ${crop || 'wheat'} farm beside water.`,
            releasesHold: true,
        };
    }

    if (/\b(?:harvest|tend|maintain|work|check on|look after|replant)\b.{0,28}\b(?:the |your |our )?(?:farm|crops?|field|wheat|carrots?|potatoes|beetroots?)\b/.test(text)) {
        return {
            command: '!maintainFarm',
            response: 'Harvesting what is ready, replanting, and verifying the farm.',
            releasesHold: true,
        };
    }

    const animal = ['cow', 'sheep', 'pig', 'chicken', 'rabbit']
        .find(name => new RegExp(`\\b${name}s?\\b`).test(text));
    if (animal && /\b(?:breed|bree?ding|mate|make more|raise)\b/.test(text)) {
        const pairs = clampInt(firstNumber(text, 2), 1, 4, 2);
        return {
            command: `!breedAnimals("${animal}", ${pairs})`,
            response: `I will breed ${pairs} pair${pairs === 1 ? '' : 's'} of ${animal}s and keep the breeding stock.`,
            releasesHold: true,
        };
    }

    // A connected-registry item is a manufactured outcome, not a structure,
    // even when the player uses the ambiguous verb "make" without a count.
    // Give the typed capability engine first refusal before the generic
    // construction fallback asks the model to compile a blueprint.
    const typedGoalDirective = resolveTypedItemGoalDirective(playerName, message, context);
    if (typedGoalDirective) return typedGoalDirective;

    // A broad delegated inventory outcome needs cognition to choose concrete
    // outputs, but it must not let cognition improvise physical actions one at
    // a time. Compile one complete registry-backed ordered plan first; the
    // existing Agenda and GoalDirector remain the durable planner/executor
    // boundary after that bounded semantic choice.
    if (describesModelSelectedItemPlan(text)) {
        const shouldReturn = /\b(?:return|come back|head back|go back)\b/.test(text);
        return {
            command: null,
            response: '',
            releasesHold: true,
            deferToModel: true,
            assignmentKind: 'item_plan',
            modelInstruction: `This player authorized one broad inventory outcome whose concrete outputs require bounded judgment. Compile the COMPLETE output list before any physical work. Return exactly one !queueItemPlan command in your first response, with 1-12 real connected-registry item or supported-family targets encoded as canonical_item:minimum_carried_quantity entries separated by |, requester ${commandString(playerName)}, and return_to_player ${shouldReturn}. Each quantity is the useful final inventory floor, so account for the authoritative current INVENTORY instead of asking for duplicate tools or redundant stock. Choose a conservative useful set that directly fits the player's request. The runtime re-verifies the entire final set, so list order is not a correctness mechanism. Do not invent umbrella targets such as starter_kit, basic_tools, supplies, or materials. Do not include recipe prerequisites merely because they are prerequisites; GoalDirector derives recipes, tools, fuel, and workstations. Do not issue search, inspection, collection, crafting, movement, Builder, or conversational questions first.`,
        };
    }

    // --- Designed structures from templates ----------------------------------
    // These fill in a design template and skip the model entirely. The model
    // still owns anything shaped unusually: it gets the same templates as a
    // starting point and appends its own steps. Deliberately does not claim
    // "shelter", "hut", or "house", which the survival shelter job already owns.

    const requiredFunctions = constructionRequiredFunctions(text);
    if (hasAuthorizedConstructionVerb(text)) {
        const material = structureMaterial(text);
        const tall = dimension(text, 'tall|high') ?? dimension(text, 'blocks?\\s+up');
        const wide = dimension(text, 'wide|across');
        const long = dimension(text, 'long|across|span');
        const design = (name, spec, label, providedFunctions = []) => {
            const provided = new Set(providedFunctions);
            if (requiredFunctions.some(required => !provided.has(required))) return null;
            return {
                command: `!designStructure("${name}", "${material}", "${spec}")`,
                response: `I will design and build ${label}, and I will check it can stand before I place anything.`,
                releasesHold: true,
            };
        };

        if (/\b(?:tower|watchtower|lookout)\b/.test(text)) {
            const direct = design(
                'tower',
                `@tower ${clampInt(wide ?? 5, 3, 12, 5)} ${clampInt(tall ?? 10, 3, 24, 10)}`,
                'a tower',
                ['enclosure', 'access', 'interior_light', 'weather_cover'],
            );
            if (direct) return direct;
        }
        if (/\b(?:bridge|walkway|catwalk)\b/.test(text)) {
            const direct = design('bridge', `@bridge ${clampInt(long ?? 10, 3, 32, 10)}`, 'a railed bridge');
            if (direct) return direct;
        }
        if (/\b(?:wall|barrier|rampart)\b/.test(text)) {
            const direct = design('wall', `@wall ${clampInt(long ?? 10, 2, 32, 10)} ${clampInt(tall ?? 3, 1, 12, 3)}`, 'a wall');
            if (direct) return direct;
        }
        if (/\b(?:pen|paddock|corral|enclosure)\b/.test(text)) {
            const direct = design(
                'pen',
                `@pen ${clampInt(wide ?? 7, 3, 16, 7)} ${clampInt(long ?? wide ?? 7, 3, 16, 7)}`,
                'a fenced pen with a gate',
                ['containment', 'access'],
            );
            if (direct) return direct;
        }
        if (/\b(?:platform|deck|floor)\b/.test(text)) {
            const direct = design('platform', `@platform ${clampInt(wide ?? 5, 1, 24, 5)} ${clampInt(long ?? wide ?? 5, 1, 24, 5)}`, 'a platform');
            if (direct) return direct;
        }
        if (/\b(?:pillar|column|post)\b/.test(text)) {
            const direct = design('pillar', `@pillar ${clampInt(tall ?? 6, 1, 24, 6)}`, 'a pillar');
            if (direct) return direct;
        }
        // “Spruce stairs as picnic seats” names a block palette for custom
        // furniture, not permission to replace the request with a six-block
        // traversal staircase. Leave furniture to the complete construction
        // compiler while retaining the deterministic @stairs route for actual
        // stairs, steps, and staircases.
        if (
            /\b(?:stairs|staircase|steps)\b/.test(text)
            && !/\b(?:seat|seats|bench|benches|chair|chairs|furniture)\b/.test(text)
        ) {
            const direct = design('stairs', `@stairs ${clampInt(tall ?? 6, 1, 16, 6)}`, 'a staircase');
            if (direct) return direct;
        }
        if (/\b(?:room|cabin|shack|lodge)\b/.test(text)) {
            const w = clampInt(wide ?? 7, 3, 16, 7);
            const direct = design(
                'room',
                `@room ${w} ${clampInt(long ?? w, 3, 16, w)} ${clampInt(tall ?? 4, 3, 8, 4)}`,
                'a room with a door and a light',
                ['enclosure', 'access', 'interior_light', 'weather_cover'],
            );
            if (direct) return direct;
        }
    }

    // A compound construction outcome owns its material clauses. Without this
    // boundary, "build it ... gather redstone" is reduced below to a redstone
    // mining quota and the durable blueprint is lost. Known deterministic
    // shapes above still route directly; unfamiliar designs fall through to
    // the model, whose !designStructure command persists one bounded blueprint.
    // Shelter remains on its dedicated survival-building route below.
    if (
        hasAuthorizedConstructionVerb(text)
        && !/\b(?:shelter|hut|small house|safe house)\b/.test(text)
        && describesMultiBlockConstruction(text, requiredFunctions)
    ) {
        const site = constructionSiteConstraint(text, context);
        const layout = constructionLayoutConstraint(text, site.constraint);
        const requiredFunctionContract = requiredFunctions.length > 0
            ? `The validator requires the completed blueprint to produce these functions: ${requiredFunctions.join(', ')}. Function names are metadata, never DSL arguments. `
            : '';
        const siteContract = site.constraint
            ? `The physical site is already durably bound ${site.constraint.relation} ${site.constraint.name.replaceAll('_', ' ')}; do not replace that landmark with the requester, the bot, or an invented coordinate. `
            : '';
        const layoutContract = layout
            ? 'The physical binder owns the grounded opposite-side translation. Design exactly two lowest-course stair fixtures facing inward; do not invent landmark coordinates or fill the space between them. '
            : '';
        return {
            command: null,
            response: site.reference && !site.constraint
                ? `I cannot identify the named place ${site.reference.name.replaceAll('_', ' ')} from verified memory, so I will not build at a guessed site.`
                : '',
            releasesHold: true,
            deferToModel: true,
            constructionSiteConstraint: site.constraint,
            constructionLayoutConstraint: layout,
            constructionSiteError: site.reference && !site.constraint
                ? 'construction_landmark_unresolved'
                : '',
            modelInstruction: `This is one player-authorized multi-block construction outcome. ${siteContract}${layoutContract}${requiredFunctionContract}Compile the complete bounded blueprint before acquiring materials. Return one complete !buildStructure or !designStructure command in the first response; do not mention a command name in prose before the executable command. The !designStructure design argument must use its exact compact DSL contract; descriptive prose is invalid. Start from a provided @template when it already supplies a requested function, then add only the missing functions. Every required function must be physically represented in the final blueprint: access uses put door, gate, or ladder; crafting uses put crafting; interior_light uses put torch; smelting uses put furnace; storage uses put chest; rest uses put bed; weather_cover uses roof; containment uses a closed fence or wall boundary with gated access; enclosure uses a closed wall boundary. Function names are validation metadata and must not be passed as DSL arguments. For a habitable building, prefer room or explicitly provide slab + shell + roof because shell contains walls only. Fixtures must use put, never block or bracketed block-state syntax. An exact stair item is a one-block fixture and requires this exact form: put X Y Z spruce_stairs north|south|east|west. Use nonnegative local coordinates from 0 through 31; translate a symmetric layout instead of writing negative coordinates. Fixture facing, when supplied, must be north, south, east, or west. Put ordinary ground fixtures above solid floor; a ground stair may be at y=0 because site selection proves its natural support. A torch may stand above a solid floor or attach beside a same-height solid wall; a ladder requires the wall. A door occupies its anchor plus the block directly above; leave both cells clear of every other fixture. A bed occupies its anchor plus one block in its facing direction; keep both cells over clear supported interior floor. Never replace the roof or required support with a fixture. A named exact fixture material such as spruce_stairs does not make the outer structural material "spruce"; for a fixture-only design use !designStructure material "auto" with lock_material false and put the exact item in the fixture operation. Otherwise use material "auto" with lock_material false when the player did not name a structural full-block material, and lock a connected-registry full-block material only when the player explicitly named it. The persistent Builder will derive and acquire every blueprint material, place supported cells, and verify the finished world state. Do not issue search, inventory, gathering, crafting, or individual placement commands first.`,
        };
    }

    // --- Search --------------------------------------------------------------

    const searchTarget = /\b(?:find|locate|search for|look for|go to)\s+(?:the\s+)?(?:nearest|closest)\s+([a-z_ ]{3,32})/.exec(text);
    if (searchTarget) {
        const raw = searchTarget[1].trim().replace(/\s+/g, '_').replace(/s$/, '');
        const entities = new Set(['cow', 'sheep', 'pig', 'chicken', 'villager', 'zombie', 'skeleton', 'creeper', 'horse', 'wolf', 'cat', 'rabbit', 'player']);
        if (entities.has(raw)) {
            return {
                command: `!searchForEntity("${raw}", 64)`,
                response: `Looking for the nearest ${raw.replaceAll('_', ' ')}.`,
                releasesHold: true,
            };
        }
        if (/^[a-z_]{3,32}$/.test(raw)) {
            return {
                command: `!searchForBlock("${raw}", 64)`,
                response: `Searching for the nearest ${raw.replaceAll('_', ' ')}.`,
                releasesHold: true,
            };
        }
    }

    if (/^(?:please\s+)?(?:attack|fight|engage|defend us from)\s+(?:the\s+)?(?:nearest\s+)?(?:enemy|enemies|hostile|hostiles|monster|monsters|mob|mobs|them|that)\b/.test(text)) {
        return {
            command: '!attackHostile',
            response: 'I will choose a safe tactical response to the live hostile and report the real outcome.',
            releasesHold: true,
        };
    }

    if (/\b(?:where are you|what are you doing|your position|your coordinates|show status|status report|are you stuck|what is blocking you|what's blocking you|why aren't you doing anything|why are you not doing anything)\b/.test(text)) {
        return {
            command: '!stats',
            response: 'Checking my live position, action, and blocker status.',
            releasesHold: false,
        };
    }

    // Inventory observation owns an utterance only when the player actually
    // asks for an inventory report. The former unanchored `your inventory`
    // alternative swallowed acquisition orders such as “make 16 stone bricks
    // and keep them in your inventory”, leaving a held bot to print its items
    // instead of accepting the durable goal.
    if (/^(?:please\s+)?(?:show(?: me)?\s+(?:(?:your|the)\s+)?inventory|(?:check|list)\s+(?:your\s+)?inventory|your inventory(?:\s+please)?|what do you have|what are you carrying|show(?: me)?\s+(?:your\s+)?tools)\b/.test(text)) {
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
            command: '!consume("best_food")',
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

    const tool = requestedTool(text);
    if (
        tool
        && /\b(?:make|craft|prepare|get|replace|equip|upgrade)\b/.test(text)
    ) {
        return {
            command: routeCompoundToolGoal(playerName, `!prepareTool(${commandString(tool)})`),
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
            command: `!assignHarvestJob("logs", ${quota}, ${commandString(playerName)})`,
            response: 'I will run a checkpointed timber job, replant when safe, and deliver it by policy.',
            releasesHold: true,
        };
    }

    return null;
}
