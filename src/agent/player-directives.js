import { parseItemGoalRequest } from './runtime/goal-contract.js';
import { classifyPlayerSpeechAuthority } from './player-speech-authority.js';

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

function parseCoordinates(text) {
    const matches = text.match(/-?\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 3) return null;
    const [x, y, z] = matches.slice(0, 3).map(Number);
    if (![x, y, z].every(Number.isFinite) || y < -64 || y > 320) return null;
    return { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
}

export function constructionRequiredFunctions(message) {
    const normalized = String(message || '').toLowerCase();
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
    return /\b(?:structure|building|base|camp|shelter|house|hut|outpost|room|cabin|shack|lodge|tower|watchtower|lookout|bridge|walkway|catwalk|wall|barrier|rampart|pen|paddock|corral|enclosure|platform|deck|floor|pillar|column|post|stairs|staircase|steps|roof|road|path|dock|pier|tunnel|loop|track|railway|windmill|mill|machine|contraption|statue|monument|gazebo|barn|workshop|worksite|workspace|work area)\b/.test(text);
}

function describesModelSelectedItemPlan(text) {
    const asksForInventoryWork = /\b(?:gather|collect|acquire|secure|prepare|make|craft|stock up on)\b/.test(text);
    const namesASet = /\b(?:supplies|resources|materials|provisions|gear|equipment|tools|items)\b/.test(text);
    const delegatesSelection = /\b(?:sensible|basic|essential|starter|useful|whatever|whichever|what you need|you need|needed)\b/.test(text);
    const explicitlyBuilds = new RegExp(`${CONSTRUCTION_VERB.source}.{0,80}\\b(?:structure|building|base|camp|shelter|house|hut|outpost|room|tower|bridge|wall|pen|platform|roof|dock|barn|workshop|worksite|workspace|work area)\\b`).test(text);
    return asksForInventoryWork && namesASet && delegatesSelection && !explicitlyBuilds;
}

export function resolvePlayerDirective(playerName, message, context = {}) {
    const text = normalizedMessage(message);
    if (!playerName || !text || text.includes('!')) return null;
    if (classifyPlayerSpeechAuthority(message) === 'conversation_only') return null;

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

    if (/^(?:please\s+)?(?:come|walk|move|get|return|head)(?:\s+back)?\s+(?:here|to me|over here)\b/.test(text)) {
        return {
            command: `!goToPlayer(${commandString(playerName)}, 2)`,
            response: 'I will come to you now.',
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

    if (/^(?:please\s+)?(?:stay|stay here|wait here|do not move|don't move|dont move)\b/.test(text)) {
        return {
            command: '!stay(-1)',
            response: 'Staying here until you give me another order.',
            releasesHold: true,
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

    if (/\b(?:move away|back off|back up|step back|give me (?:some )?(?:space|room)|get away from me|make some room)\b/.test(text)) {
        const distance = clampInt(firstNumber(text, 5), 1, 64, 5);
        return {
            command: `!moveAway(${distance})`,
            response: `Backing off about ${distance} block${distance === 1 ? '' : 's'}.`,
            releasesHold: true,
        };
    }

    if (/\b(?:go to (?:bed|sleep)|get to bed|get some sleep|time for bed|lie down|sleep now|go (?:in|inside) and sleep|sleep inside)\b/.test(text)) {
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
        const distance = clampInt(firstNumber(text, 10), 1, 384, 10);
        return {
            command: `!digDown(${distance})`,
            response: `Digging straight down ${distance} block${distance === 1 ? '' : 's'}, stopping if I hit lava, water, or a drop.`,
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

    const equipped = objectOf(text, 'equip|wield|put on|wear|hold');
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
    if (rideable && /\b(?:get on|ride|mount|hop on|climb on)\b/.test(text)) {
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

    if (/\b(?:clear|cancel|scrap|forget|wipe|drop)\s+(?:your |the |my )?(?:whole |entire |rest of (?:your|the) )?(?:plan|agenda|queue|todo list|task list|everything)\b/.test(text)) {
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
    const typedGoal = parseItemGoalRequest(playerName, message, context.bot);
    if (typedGoal) {
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
    if (CONSTRUCTION_VERB.test(text)) {
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
        if (/\b(?:stairs|staircase|steps)\b/.test(text)) {
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
        CONSTRUCTION_VERB.test(text)
        && !/\b(?:shelter|hut|small house|safe house)\b/.test(text)
        && describesMultiBlockConstruction(text, requiredFunctions)
    ) {
        const requiredFunctionContract = requiredFunctions.length > 0
            ? `The validator requires the completed blueprint to produce these functions: ${requiredFunctions.join(', ')}. Function names are metadata, never DSL arguments. `
            : '';
        return {
            command: null,
            response: '',
            releasesHold: true,
            deferToModel: true,
            modelInstruction: `This is one player-authorized multi-block construction outcome. ${requiredFunctionContract}Compile the complete bounded blueprint before acquiring materials. Return one complete !buildStructure or !designStructure command in the first response; do not mention a command name in prose before the executable command. The !designStructure design argument must use its exact compact DSL contract; descriptive prose is invalid. Start from a provided @template when it already supplies a requested function, then add only the missing functions. Every required function must be physically represented in the final blueprint: access uses put door, gate, or ladder; crafting uses put crafting; interior_light uses put torch; smelting uses put furnace; storage uses put chest; rest uses put bed; weather_cover uses roof; containment uses a closed fence or wall boundary with gated access; enclosure uses a closed wall boundary. Function names are validation metadata and must not be passed as DSL arguments. For a habitable building, prefer room or explicitly provide slab + shell + roof because shell contains walls only. Fixtures must use put, never block. Fixture facing, when supplied, must be north, south, east, or west. Put ground fixtures above solid floor. A torch may stand above a solid floor or attach beside a same-height solid wall; a ladder requires the wall. A door occupies its anchor plus the block directly above; leave both cells clear of every other fixture. A bed occupies its anchor plus one block in its facing direction; keep both cells over clear supported interior floor. Never replace the roof or required support with a fixture. Use !designStructure material "auto" with lock_material false when the player did not name a structural material; Builder will bind one feasible safe material for the entire required quantity. Set lock_material true only if the player explicitly named the structural material. The persistent Builder will derive and acquire every blueprint material, place supported cells, and verify the finished world state. Do not issue search, inventory, gathering, crafting, or individual placement commands first.`,
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
            command: `!assignHarvestJob("logs", ${quota})`,
            response: 'I will run a checkpointed timber job, replant when safe, and deliver it by policy.',
            releasesHold: true,
        };
    }

    return null;
}
