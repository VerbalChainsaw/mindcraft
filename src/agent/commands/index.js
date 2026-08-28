import { getBlockId, getItemId } from "../../utils/mcdata.js";
import { randomUUID } from 'node:crypto';
import { actionsList } from './actions.js';
import { queryList } from './queries.js';

let suppressNoDomainWarning = true;

const COMMAND_REQUEST_ROUTE_ORIGINS = new Set([
    'explicit-command',
    'deterministic-nl',
    'model-selected',
    'directive-resume',
    'agenda-director',
    'goal-director',
    'mission-director',
    'job-director',
    'internal',
]);
// Process lifecycle is operator authority. Prompt filtering keeps these controls
// out of normal autonomy context, while this dispatch boundary prevents a model
// from guessing one after a rejected or superseded action.
const AUTONOMY_DENIED_PROCESS_COMMANDS = new Set([
    '!stop',
    '!restart',
    '!leaveGame',
    '!spawnBots',
]);
const MAX_COMMAND_REQUEST_ARGS = 8;
const MAX_COMMAND_REQUEST_TEXT = 160;
const SEMANTIC_CONSUMABLE_NAMES = new Set(['best_food', 'healing_potion']);

function boundedRequestText(value, maxLength = MAX_COMMAND_REQUEST_TEXT) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeRequestArgument(value) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return boundedRequestText(value);
    return null;
}

export function normalizeCommandRouteOrigin(value) {
    const normalized = boundedRequestText(value, 40).toLowerCase();
    return COMMAND_REQUEST_ROUTE_ORIGINS.has(normalized) ? normalized : 'internal';
}

export function createCommandRequestContext({
    routeOrigin = 'internal',
    selectedSkill = '',
    args = [],
    requestedAt = Date.now(),
    agendaDisposition = 'append',
    missionId = null,
    activityId = null,
    materialToken = null,
} = {}) {
    const normalizedArgs = Object.freeze((Array.isArray(args) ? args : [])
        .slice(0, MAX_COMMAND_REQUEST_ARGS)
        .map(normalizeRequestArgument));
    const timestamp = Number(requestedAt);
    return Object.freeze({
        requestId: `command-request-${randomUUID()}`,
        routeOrigin: normalizeCommandRouteOrigin(routeOrigin),
        selectedSkill: boundedRequestText(selectedSkill, 80),
        args: normalizedArgs,
        requestedAt: Number.isFinite(timestamp) && timestamp >= 0 ? Math.floor(timestamp) : Date.now(),
        agendaDisposition: agendaDisposition === 'interrupt' ? 'interrupt' : 'append',
        missionId: boundedRequestText(missionId, 96) || null,
        activityId: boundedRequestText(activityId, 128) || null,
        materialToken: boundedRequestText(materialToken, 240) || null,
    });
}

const commandList = queryList.concat(actionsList);
const commandMap = {};
for (let command of commandList) {
    commandMap[command.name] = command;
}

export function getCommand(name) {
    return commandMap[name];
}

// Grouping is declared here rather than in the dashboard so the console and the
// model documentation cannot drift apart. First match wins; anything unmatched
// lands in Other, which is visible enough that a new command gets noticed.
const COMMAND_CATEGORIES = Object.freeze([
    Object.freeze({ category: 'Control', pattern: /^!(stop|stfu|restart|clearChat|stay|setMode|setPersona|endGoal|cancelJob|cancelGoal|cancelMission|goal|newAction)$/ }),
    Object.freeze({ category: 'Plan', pattern: /^!(acceptCharcoalMission|addToAgenda|queueItemPlan|showAgenda|clearAgenda|skipAgendaItem|requestItemGoal|assign\w*Job)$/ }),
    Object.freeze({ category: 'Movement', pattern: /^!(goTo\w*|follow\w*|moveAway|come|stay|searchFor\w*|completeExplorationRoute|goToSurface|goToMiningDepth|dismount|mountEntity|rideToCoordinates)$/ }),
    Object.freeze({ category: 'Combat', pattern: /^!(attack\w*|resolveTacticalCombat|guardPlayer|defend)$/ }),
    Object.freeze({ category: 'Gathering', pattern: /^!(collect\w*|pickup\w*|fish|prepare\w*|breakBlock|digDown)$/ }),
    Object.freeze({ category: 'Crafting', pattern: /^!(craftRecipe|smeltItem|brewPotion|clearFurnace|enchantItem|repairItem)$/ }),
    Object.freeze({ category: 'Building', pattern: /^!(place\w*|build\w*|resumeStructureJob|repairHome|establishFarm|goToFarm|maintainFarm|rememberHome)$/ }),
    Object.freeze({ category: 'Inventory', pattern: /^!(equip|consume|discard|give\w*|putIn\w*|putFamily\w*|takeFrom\w*|viewChest\w*|deposit\w*|useItem|useOn)$/ }),
    Object.freeze({ category: 'Memory', pattern: /^!(rememberHere|forgetRememberedPlace|goToRememberedPlace|savedPlaces|recoverDeathItems)$/ }),
    Object.freeze({ category: 'Social', pattern: /^!(startConversation|endConversation|squadRadio|lookAt\w*|showVillagerTrades|tradeWithVillager)$/ }),
    Object.freeze({ category: 'Survival', pattern: /^!(goToBed|breedAnimals)$/ }),
    Object.freeze({ category: 'Info', pattern: /^!(inspect\w*|check\w*|get\w*|search\w*|help|stats|inventory|entities|modes|savedPlaces)$/ }),
]);

function categoryFor(name) {
    for (const entry of COMMAND_CATEGORIES) {
        if (entry.pattern.test(name)) return entry.category;
    }
    return 'Other';
}

/**
 * Serializable description of every command, with no agent required. The
 * console renders forms from this, so a command added to actions.js shows up
 * without anyone remembering to update the dashboard.
 */
export function getCommandManifest({ blocked = [] } = {}) {
    const blockedSet = new Set(Array.isArray(blocked) ? blocked : []);
    return commandList
        .filter((command) => !blockedSet.has(command.name))
        .map((command) => ({
            name: command.name,
            description: String(command.description || '').replace(/\s+/g, ' ').trim(),
            category: categoryFor(command.name),
            isAction: typeof command.perform === 'function' && !queryList.includes(command),
            params: Object.entries(command.params || {}).map(([paramName, param]) => ({
                name: paramName,
                type: String(param?.type || 'string'),
                description: String(param?.description || '').replace(/\s+/g, ' ').trim(),
                domain: Array.isArray(param?.domain)
                    ? param.domain.filter((value) => typeof value === 'number' || typeof value === 'string')
                    : null,
            })),
        }))
        .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
}

export function blacklistCommands(commands) {
    const unblockable = ['!stop', '!stats', '!inventory', '!goal'];
    for (let command_name of commands) {
        if (unblockable.includes(command_name)){
            console.warn(`Command ${command_name} is unblockable`);
            continue;
        }
        delete commandMap[command_name];
    }
}

const commandRegex = /!(\w+)(?:\(((?:-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*')(?:\s*,\s*(?:-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*'))*)\))?/
const argRegex = /-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*'/g;
const bareArgRegex = /"[^"]*"|'[^']*'|\S+/g;

function parseBareCommand(message) {
    const trimmed = String(message || '').trim();
    const match = /^!(\w+)(?:\s+(.+))?$/.exec(trimmed);
    if (!match || trimmed.includes('(')) return null;
    return {
        commandName: `!${match[1]}`,
        args: match[2]?.match(bareArgRegex) || [],
    };
}

export function containsCommand(message) {
    const commandMatch = message.match(commandRegex);
    if (commandMatch)
        return "!" + commandMatch[1];
    return null;
}

export function commandExists(commandName) {
    if (!commandName.startsWith("!"))
        commandName = "!" + commandName;
    return commandMap[commandName] !== undefined;
}

/**
 * Converts a string into a boolean.
 * @param {string} input
 * @returns {boolean | null} the boolean or `null` if it could not be parsed.
 * */
function parseBoolean(input) {
    switch(input.toLowerCase()) {
        case 'false': //These are interpreted as flase;
        case 'f':
        case '0':
        case 'off':
            return false;
        case 'true': //These are interpreted as true;
        case 't':
        case '1':
        case 'on':
            return true;
        default:
            return null;
    }
}

/**
 * @param {number} value - the value to check
 * @param {number} lowerBound
 * @param {number} upperBound
 * @param {string} endpointType - The type of the endpoints represented as a two character string. `'[)'` `'()'` 
 */
function checkInInterval(number, lowerBound, upperBound, endpointType) {
    switch (endpointType) {
        case '[)':
            return lowerBound <= number && number < upperBound;
        case '()':
            return lowerBound < number && number < upperBound;
        case '(]':
            return lowerBound < number && number <= upperBound;
        case '[]':
            return lowerBound <= number && number <= upperBound;
        default:
            throw new Error('Unknown endpoint type:', endpointType)
    }
}



// todo: handle arrays?
/**
 * Returns an object containing the command, the command name, and the comand parameters.
 * If parsing unsuccessful, returns an error message as a string.
 * @param {string} message - A message from a player or language model containing a command.
 * @returns {string | Object}
 */
export function parseCommandMessage(message) {
    const bare = parseBareCommand(message);
    if (bare) {
        const command = getCommand(bare.commandName);
        if (!command) return `${bare.commandName} is not a command.`;
        return parseCommandArguments(command, bare.commandName, bare.args);
    }
    const commandMatch = message.match(commandRegex);
    if (!commandMatch) return `Command is incorrectly formatted`;

    const commandName = "!"+commandMatch[1];

    let args;
    if (commandMatch[2]) args = commandMatch[2].match(argRegex);
    else args = [];

    const command = getCommand(commandName);
    if(!command) return `${commandName} is not a command.`

    return parseCommandArguments(command, commandName, args);
}

function parseCommandArguments(command, commandName, args) {
    const params = commandParams(command);
    const paramNames = commandParamNames(command);
    if (!acceptsArgumentCount(command, args.length))
        return argumentCountError(command, args.length);

    for (let i = 0; i < args.length; i++) {
        const param = params[i];
        //Remove any extra characters
        let arg = args[i].trim();
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
            arg = arg.substring(1, arg.length-1);
        }
        
        //Convert to the correct type
        switch(param.type) {
            case 'int':
                arg = Number.parseInt(arg); break;
            case 'float':
                arg = Number.parseFloat(arg); break;
            case 'boolean':
                arg = parseBoolean(arg); break;
            case 'BlockName':
            case 'BlockOrItemName':
            case 'ItemName':
            case 'ConsumableName':
                if (arg.endsWith('plank') || arg.endsWith('seed'))
                    arg += 's'; // add 's' to for common mistakes like "oak_plank" or "wheat_seed"
            case 'string':
                break;
            default:
                throw new Error(`Command '${commandName}' parameter '${paramNames[i]}' has an unknown type: ${param.type}`);
        }
        if(arg === null || Number.isNaN(arg))
            return `Error: Param '${paramNames[i]}' must be of type ${param.type}.`

        if(typeof arg === 'number') { //Check the domain of numbers
            const domain = param.domain;
            if(domain) {
                /**
                 * Javascript has a built in object for sets but not intervals.
                 * Currently the interval (lowerbound,upperbound] is represented as an Array: `[lowerbound, upperbound, '(]']`
                 */
                if (!domain[2]) domain[2] = '[)'; //By default, lower bound is included. Upper is not.

                if(!checkInInterval(arg, ...domain)) {
                    return `Error: Param '${paramNames[i]}' must be an element of ${domain[2][0]}${domain[0]}, ${domain[1]}${domain[2][1]}.`;
                    //Alternatively arg could be set to the nearest value in the domain.
                }
            } else if (!suppressNoDomainWarning) {
                console.warn(`Command '${commandName}' parameter '${paramNames[i]}' has no domain set. Expect any value [-Infinity, Infinity].`)
                suppressNoDomainWarning = true; //Don't spam console. Only give the warning once.
            }
        } else if(param.type === 'BlockName') { //Check that there is a block with this name
            if(getBlockId(arg) == null) return  `Invalid block type: ${arg}.`
        } else if(param.type === 'ItemName') { //Check that there is an item with this name
            if(getItemId(arg) == null) return `Invalid item type: ${arg}.`
        } else if(param.type === 'ConsumableName') {
            if (!SEMANTIC_CONSUMABLE_NAMES.has(arg) && getItemId(arg) == null) {
                return `Invalid consumable type: ${arg}.`;
            }
        } else if(param.type === 'BlockOrItemName') {
            if(getBlockId(arg) == null && getItemId(arg) == null) return  `Invalid block or item type: ${arg}.`
        }
        args[i] = arg;
    }
    
    return { commandName, args };
}

export function truncCommandMessage(message) {
    const bare = parseBareCommand(message);
    if (bare && getCommand(bare.commandName)) return String(message).trim();
    const commandMatch = message.match(commandRegex);
    if (commandMatch) {
        return message.substring(0, commandMatch.index + commandMatch[0].length);
    }
    return message;
}

export function isAction(name) {
    return actionsList.find(action => action.name === name) !== undefined;
}

export function commandTakesManualAutonomy(name) {
    const commandName = String(name || '');
    return commandMap[commandName]?.perform?.manualAutonomyTakeover === true;
}

export function commandAssignsPersistentJob(name) {
    const commandName = String(name || '');
    return commandMap[commandName]?.perform?.persistentJobAssignment === true;
}

export function commandAssignsPersistentGoal(name) {
    const commandName = String(name || '');
    return commandMap[commandName]?.perform?.persistentGoalAssignment === true;
}

/**
 * @param {Object} command
 * @returns {Object[]} The command's parameters.
 */
function commandParams(command) {
    if (!command.params)
        return [];
    return Object.values(command.params);
}

/**
 * @param {Object} command
 * @returns {string[]} The names of the command's parameters.
 */
function commandParamNames(command) {
    if (!command.params)
        return [];
    return Object.keys(command.params);
}

function numParams(command) {
    return commandParams(command).length;
}

function minParams(command) {
    return commandParams(command).filter(param => param.optional !== true).length;
}

function acceptsArgumentCount(command, count) {
    return count >= minParams(command) && count <= numParams(command);
}

function argumentCountError(command, count) {
    const minimum = minParams(command);
    const maximum = numParams(command);
    const requirement = minimum === maximum ? `${minimum}` : `${minimum} to ${maximum}`;
    return `Command ${command.name} was given ${count} args, but requires ${requirement} args.`;
}

export async function executeCommand(agent, message, {
    owner = 'player',
    routeOrigin = 'internal',
    agendaDisposition = 'append',
    missionId = null,
    activityId = null,
    materialToken = null,
    returnExecution = false,
} = {}) {
    let parsed = parseCommandMessage(message);
    if (typeof parsed === 'string') {
        return returnExecution
            ? Object.freeze({ value: parsed, result: null, requestContext: null, durableSubmission: null })
            : parsed; //The command was incorrectly formatted or an invalid input was given.
    }
    else {
        console.log('parsed command:', parsed);
        const command = getCommand(parsed.commandName);
        let numArgs = 0;
        if (parsed.args) {
            numArgs = parsed.args.length;
        }
        if (!acceptsArgumentCount(command, numArgs)) {
            const value = argumentCountError(command, numArgs);
            return returnExecution
                ? Object.freeze({ value, result: null, requestContext: null, durableSubmission: null })
                : value;
        }
        else {
            const requestContext = createCommandRequestContext({
                routeOrigin,
                selectedSkill: parsed.commandName,
                args: parsed.args,
                agendaDisposition,
                missionId,
                activityId,
                materialToken,
            });
            const normalizedOwner = boundedRequestText(owner, 40).toLowerCase();
            if (normalizedOwner === 'autonomy' && AUTONOMY_DENIED_PROCESS_COMMANDS.has(parsed.commandName)) {
                const value = `Blocked (operator_authority_required): ${parsed.commandName} is an operator/player process control. Autonomous dialogue must yield to the active Director instead.`;
                return returnExecution
                    ? Object.freeze({ value, result: null, requestContext, durableSubmission: null })
                    : value;
            }
            const perform = () => command.perform(agent, ...parsed.args);
            const performWithRequestContext = typeof agent.actions?.runWithRequestContext === 'function'
                ? () => agent.actions.runWithRequestContext(requestContext, perform)
                : perform;
            const performWithOwner = typeof agent.actions?.runWithOwner === 'function'
                ? () => agent.actions.runWithOwner(owner, performWithRequestContext)
                : performWithRequestContext;
            if (typeof agent.actions?.runWithCommandExecution === 'function') {
                const execution = await agent.actions.runWithCommandExecution(performWithOwner, requestContext);
                return returnExecution ? execution : execution.value;
            }
            const value = await performWithOwner();
            return returnExecution
                ? Object.freeze({
                    value,
                    result: null,
                    requestContext,
                    durableSubmission: null,
                  })
                : value;
        }
    }
}

// Commands an autonomous turn must never pick. Every one of them is operator
// authority (session and runtime configuration), player-facing plan management,
// or an action whose meaning depends on a person having just asked for it --
// `!stay` and `!attackPlayer` are not decisions a bot playing by itself should
// be reaching for at all.
//
// Withholding them from the autonomy prompt is a boundary first and a saving
// second, but the saving is real: this context is rebuilt before every single
// action, so anything the bot cannot legitimately choose is latency it pays on
// every step of play. Documentation only -- an excluded command still executes
// normally if something else legitimately issues it.
const NON_AUTONOMY_COMMANDS = new Set([
    // Session and process control.
    '!spawnBots', '!leaveGame', '!restart', '!clearChat', '!stfu', '!squadRadio', '!newAction',
    // Runtime configuration belongs to the operator, not to a per-action tick.
    '!setAutonomy', '!setComportment', '!setTraversal', '!setNarration',
    '!setMode', '!setPersona', '!showRuntime', '!persona',
    // Standing orders and the plan queue are the player's steering wheel.
    '!addRule', '!listRules', '!removeRule',
    '!showAgenda', '!clearAgenda', '!skipAgendaItem', '!addToAgenda', '!queueItemPlan',
    // Goal lifecycle is owned by goal selection, not by the action loop.
    '!goal', '!endGoal', '!cancelJob', '!cancelGoal',
    '!acceptCharcoalMission', '!cancelMission',
    // A conversation is not something autonomy starts with itself.
    '!startConversation', '!endConversation', '!help',
    // Only ever correct as a reply to a person.
    '!attackPlayer', '!stay', '!stop',
]);

export function isAutonomyCommand(name) {
    return !NON_AUTONOMY_COMMANDS.has(String(name || ''));
}

export function getCommandDocs(agent, { compact = false, purpose = 'all' } = {}) {
    const omitted = purpose === 'autonomy' ? NON_AUTONOMY_COMMANDS : null;
    const typeTranslations = {
        //This was added to keep the prompt the same as before type checks were implemented.
        //If the language model is giving invalid inputs changing this might help.
        'float':             'number',
        'int':               'number',
        'BlockName':         'string',
        'ItemName':          'string',
        'BlockOrItemName':   'string',
        'boolean':           'bool'
    }
    if (compact) {
        let docs = '\n*COMPACT COMMANDS\nUse exactly one command. Strings require double quotes.\n';
        for (const command of commandList) {
            if (agent.blocked_actions.includes(command.name)) continue;
            if (omitted?.has(command.name)) continue;
            const params = command.params
                ? Object.entries(command.params)
                    .map(([name, param]) => `${name}:${typeTranslations[param.type] ?? param.type}`)
                    .join(', ')
                : '';
            // Most commands need only a short reminder. Data-compiling
            // commands may declare a bounded compact contract so their grammar
            // is not silently amputated by the ordinary 140-character summary.
            const description = String(command.compactDescription || command.description || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, command.compactDescription ? 1_100 : 140);
            docs += `${command.name}${params ? `(${params})` : ''} - ${description}\n`;
        }
        return docs + '*\n';
    }

    let docs = `\n*COMMAND DOCS\n You can use the following commands to perform actions and get information about the world. 
    Use the commands with the syntax: !commandName or !commandName("arg1", 1.2, ...) if the command takes arguments.\n
    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n`;
    for (let command of commandList) {
        if (agent.blocked_actions.includes(command.name)) {
            continue;
        }
        if (omitted?.has(command.name)) {
            continue;
        }
        docs += command.name + ': ' + command.description + '\n';
        if (command.params) {
            docs += 'Params:\n';
            for (let param in command.params) {
                docs += `${param}: (${typeTranslations[command.params[param].type]??command.params[param].type}) ${command.params[param].description}\n`;
            }
        }
    }
    return docs + '*\n';
}
