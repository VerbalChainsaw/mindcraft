import * as skills from '../library/skills.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { sendSquadRadio } from '../mindserver_proxy.js';
import { actionResultToMessage } from '../runtime/action-result.js';
import { createWorkOrder } from '../runtime/work-order.js';
import {
    createBuilderConstructionOrder,
    createBuilderFunctionalShelterOrder,
    createBuilderShelterOrder,
    createBuilderStockpileOrder,
} from '../runtime/jobs/builder-plan.js';
import {
    createStructureOrder,
    describeStructureCatalog,
    STRUCTURE_NAMES,
} from '../runtime/jobs/structure-catalog.js';
import { resolvePlayerTarget } from '../player-target.js';
import { normalizeRuntimeBehavior, runtimeBehaviorToProfile } from '../runtime/behavior-config.js';
import {
    createItemGoalContract,
    inventoryCountForGoalTarget,
    resolveItemGoalTarget,
} from '../runtime/goal-contract.js';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => actionFn(agent, ...args);
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        if (code_return.result?.phase && code_return.result.phase !== 'succeeded') {
            return actionResultToMessage(code_return.result);
        }
        return code_return.message || (code_return.result ? actionResultToMessage(code_return.result) : undefined);
    }
    // Direct player/dashboard use of a world skill is an explicit ownership
    // change. Agent.handleMessage reads this metadata before it starts the
    // action, so an older autonomous goal cannot wake up and compete with it.
    // Query/configuration/vision commands use different wrappers and retain
    // their existing non-takeover behavior.
    wrappedAction.manualAutonomyTakeover = true;

    return wrappedAction;
}

function setCompanionDirective(agent, directive, playerName) {
    agent.companion_context?.setDirective?.(directive, playerName);
    if (directive !== 'guard' && agent.runtime?.reflexes?.combat === 'off') {
        agent.bot?.modes?.setOn?.('self_defense', false);
    }
}

/**
 * Runtime configuration is a frozen normalized object, so a live change has to
 * go back through the same normalizer the profile did. That keeps one source of
 * truth for validation and means an invalid value is rejected here rather than
 * corrupting the running bot. The profile on disk is left alone: this changes
 * the session, not the saved character.
 */
function applyRuntimeChange(agent, patch) {
    const previous = agent.runtime;
    if (!previous) return { ok: false, detail: 'runtime configuration is unavailable.' };
    try {
        const source = runtimeBehaviorToProfile(previous);
        const merged = { ...source, ...patch };
        const runtime = normalizeRuntimeBehavior({ ...settings.profile, runtime: merged }, settings);
        // enumValue silently falls back on an unknown value, so confirm the
        // change actually took rather than reporting a success that did not.
        for (const [key, requested] of Object.entries(patch)) {
            const applied = key === 'comportment' ? runtime.comportment?.preset : runtime[key];
            const wanted = String(requested || '').trim().toLowerCase();
            if (wanted && String(applied || '').toLowerCase() !== wanted) {
                return { ok: false, detail: `'${requested}' is not a supported ${key} value.` };
            }
        }
        agent.runtime = runtime;
        return { ok: true, runtime };
    } catch (error) {
        return { ok: false, detail: String(error?.message || error).slice(0, 180) };
    }
}

function submitRoleOrder(agent, expectedRole, order) {
    const director = agent.job_director;
    if (!director || typeof director.submit !== 'function') {
        return `Work order was not accepted: ${expectedRole} job director unavailable.`;
    }
    const result = director.submit(order);
    if (result?.accepted !== true) {
        return `Work order was not accepted: ${result?.code || 'job director unavailable'}.`;
    }
    const defaultRole = agent.runtime?.role || 'companion';
    const roleContext = defaultRole === expectedRole
        ? ''
        : ` while keeping ${defaultRole} as the default role`;
    return `Accepted resumable ${expectedRole} work order ${result.id}${roleContext}.`;
}

function submitRememberedStructure(agent, order) {
    const response = submitRoleOrder(agent, 'builder', order);
    if (response.startsWith('Accepted resumable')) {
        try {
            agent.home_state?.rememberStructure?.(order);
        } catch (error) {
            return `${response} Warning: durable home tracking failed: ${String(error?.message || error).slice(0, 160)}.`;
        }
    }
    return response;
}

function persistFarmState(agent, farm, physicalOutcome) {
    try {
        if (!agent.home_state?.rememberFarm) throw new Error('home-state storage is unavailable');
        agent.home_state.rememberFarm(farm);
        return true;
    } catch (error) {
        agent.bot.lastActionEvidence = {
            ...(agent.bot.lastActionEvidence || {}),
            outcome: `${physicalOutcome}_unremembered`,
            persistenceError: String(error?.message || error).slice(0, 180),
            retryable: true,
        };
        skills.log(agent.bot, `The farm changed in Minecraft, but durable farm tracking failed: ${String(error?.message || error).slice(0, 160)}.`);
        return false;
    }
}

function persistentJobCommand(commandFn) {
    commandFn.persistentJobAssignment = true;
    return commandFn;
}

function persistentGoalCommand(commandFn) {
    commandFn.persistentJobAssignment = true;
    commandFn.persistentGoalAssignment = true;
    commandFn.manualAutonomyTakeover = true;
    return commandFn;
}

async function runVisionAction(agent, actionLabel, request) {
    if (!agent.vision_interpreter) {
        return 'Vision has not initialized yet. Structured game-state sensing is still available.';
    }
    let response = '';
    const result = await agent.actions.runAction(actionLabel, async () => {
        response = await request();
        return agent.vision_interpreter.lastOutcome?.success === true;
    });
    if (result.result?.phase && result.result.phase !== 'succeeded') {
        return response || actionResultToMessage(result.result);
    }
    return response || result.message || (result.result ? actionResultToMessage(result.result) : undefined);
}

export const actionsList = [
    {
        name: '!squadRadio',
        description: 'Send a short status, request, or warning to the other live members of your squad through MindServer.',
        params: {
            'message': { type: 'string', description: 'A concise squad update, request, or warning.' },
        },
        perform: async function (_agent, message) {
            const result = await sendSquadRadio(String(message || '').slice(0, 1200), 'status');
            return result.success
                ? `Squad radio delivered to ${result.delivered} member(s).`
                : `Squad radio failed: ${result.error || 'no live squad members.'}`;
        },
    },
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            const holdGeneration = agent.holdPosition('operator stop command');
            const stopOutcome = await agent.actions.stop({
                continueWhile: () => agent.isCurrentOperatorHold(holdGeneration),
            });
            if (stopOutcome.superseded) return null;
            agent.clearBotLogs();
            agent.actions.cancelResume();
            if (!stopOutcome.stopped) {
                return 'The bot is held, but its current action did not yield to Stop yet. It will not start another action; use an explicit restart only if it remains unresponsive.';
            }
            return 'Agent stopped. It will remain held until you give a new command or goal.';
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!leaveGame',
        description: 'Disconnect this bot from Minecraft and shut its process down. Use this when the player says to leave, log off, go away, get out, or that they are done with this bot. The bot stays gone until it is started again from the dashboard.',
        params: {
            'reason': { type: 'string', description: 'Short reason to say before leaving.' },
        },
        perform: function (agent, reason) {
            const note = String(reason || 'the player asked me to leave')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
            // teardownAndExit stops the runtime and ends the process, so nothing
            // can be said after it. Give the goodbye time to reach chat first.
            // Exit code 0 means the supervisor treats this as intended and does
            // not bring the bot back.
            setTimeout(() => {
                void agent.teardownAndExit(`Left the game: ${note}`, 0);
            }, 1_500);
            return `Leaving the game: ${note}. Start me again from the dashboard when you want me back.`;
        },
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            setCompanionDirective(agent, null, player_name);
            return await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            setCompanionDirective(agent, 'follow', player_name);
            return await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!guardPlayer',
        description: 'Stay close to a player and keep the existing self-defense reflex enabled while following them.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to guard.'},
            'guard_dist': {type: 'float', description: 'distance to keep from the guarded player.', domain: [1, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, guard_dist) => {
            setCompanionDirective(agent, 'guard', player_name);
            agent.bot.modes.setOn('self_defense', true);
            return await skills.followPlayer(agent.bot, player_name, guard_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            return await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!mountEntity',
        description: 'Approach and mount the nearest observed rideable entity. Use an exact entity type such as oak_boat, horse, camel, pig, or strider, or a family: boat, minecart, or mount.',
        params: {
            'entity_type': { type: 'string', description: 'Exact rideable entity type or the boat, minecart, or mount family.' },
            'search_range': { type: 'float', description: 'Maximum loaded-world search range.', domain: [4, 128] },
        },
        perform: runAsAction(async (agent, entity_type, search_range) => {
            return await skills.mountEntity(agent.bot, entity_type, search_range);
        }),
    },
    {
        name: '!rideToCoordinates',
        description: 'Steer the currently mounted boat, minecart, or rideable animal toward coordinates, stop vehicle input on arrival or interruption, and report missing steering prerequisites truthfully.',
        params: {
            'x': { type: 'float', description: 'Destination x coordinate.', domain: [-Infinity, Infinity] },
            'y': { type: 'float', description: 'Destination y coordinate.', domain: [-64, 320] },
            'z': { type: 'float', description: 'Destination z coordinate.', domain: [-Infinity, Infinity] },
            'closeness': { type: 'float', description: 'How close the mounted vehicle should get.', domain: [0, 32] },
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            return await skills.rideToPosition(agent.bot, x, y, z, closeness);
        }),
    },
    {
        name: '!dismount',
        description: 'Stop mounted vehicle input and dismount the current boat, minecart, or animal.',
        perform: runAsAction(async (agent) => {
            return await skills.dismountVehicle(agent.bot);
        }),
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                skills.log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            return await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!goToMiningDepth',
        description: 'Use existing safe cave and stair routes to reach a productive mining depth without breaking unrelated route blocks.',
        params: {
            'target_y': { type: 'int', description: 'Productive target Y level.', domain: [-60, 300] },
            'search_range': { type: 'int', description: 'Maximum loaded cave search radius.', domain: [16, 128] },
        },
        perform: runAsAction(async (agent, target_y, search_range) => {
            return await skills.goToMiningDepth(agent.bot, target_y, search_range);
        }, false, 10)
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            return await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            return await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
                skills.log(agent.bot, `No location named "${name}" saved.`);
                return false;
            }
            return await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!completeExplorationRoute',
        description: 'Visit and remember distinct observed landmarks, recover a target item from a bounded container search, and physically return to the saved entrance.',
        params: {
            'target_item': { type: 'ItemName', description: 'The item to recover during exploration.' },
            'landmark_count': { type: 'int', description: 'Number of distinct landmark types to visit.', domain: [1, 8] },
            'search_range': { type: 'int', description: 'Maximum loaded search radius for landmarks and containers.', domain: [16, 128] },
        },
        perform: runAsAction(async (agent, target_item, landmark_count, search_range) => {
            const unstuckWasEnabled = agent.bot.modes?.isOn?.('unstuck') === true;
            if (unstuckWasEnabled) agent.bot.modes.setOn('unstuck', false);
            try {
                return await skills.completeExplorationRoute(
                    agent.bot,
                    agent.memory_bank,
                    target_item,
                    landmark_count,
                    search_range,
                );
            } finally {
                if (unstuckWasEnabled) agent.bot.modes.setOn('unstuck', true);
            }
        }, false, 10)
    },
    {
        name: '!recoverDeathItems',
        description: 'Return to the recorded death site in the same dimension, collect the recorded dropped inventory, and verify the recovered item counts.',
        params: {},
        perform: runAsAction(async (agent) => {
            const death = agent.memory_bank.recallDeath();
            const recovered = await skills.recoverDeathItems(agent.bot, death);
            if (recovered) {
                agent.memory_bank.markDeathRecovered(agent.bot.lastActionEvidence);
            }
            return recovered;
        }, false, 10)
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            return await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!giveFamilyToPlayer',
        description: 'Deliver a verified quantity across every carried item type in a useful family, such as mixed logs, to a player.',
        params: {
            'family': { type: 'string', description: 'Supported family: logs, planks, food, ores, or building_blocks.' },
            'player_name': { type: 'string', description: 'The player who should receive the items.' },
            'num': { type: 'int', description: 'Maximum total family items to deliver.', domain: [1, 2304] },
        },
        perform: runAsAction(async (agent, family, player_name, num) => {
            return await skills.giveFamilyToPlayer(agent.bot, family, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            return await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            return await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            return await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!putInChestAt',
        description: 'Deposit items into the exact assigned loaded chest or barrel and verify the inventory transfer.',
        params: {
            'item_name': { type: 'ItemName', description: 'The item to deposit.' },
            'num': { type: 'int', description: 'The number of items to deposit.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
        },
        perform: runAsAction(async (agent, item_name, num, x, y, z) => {
            return await skills.putInChestAt(agent.bot, item_name, num, x, y, z);
        })
    },
    {
        name: '!putFamilyInChestAt',
        description: 'Deposit a verified total across every carried item type in a useful family into the exact assigned chest or barrel.',
        params: {
            'family': { type: 'string', description: 'Supported family: logs, planks, food, ores, or building_blocks.' },
            'num': { type: 'int', description: 'Maximum total family items to deposit.', domain: [1, 2304] },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
        },
        perform: runAsAction(async (agent, family, num, x, y, z) => {
            return await skills.putFamilyInChestAt(agent.bot, family, num, x, y, z);
        })
    },
    {
        name: '!depositInventoryOverflowAt',
        description: 'Free working slots at an assigned chest while preserving food, durable equipment, utility gear, and the current job target.',
        params: {
            'role': { type: 'string', description: 'Current job role.' },
            'protected_item': { type: 'string', description: 'Exact item or family currently being gathered.' },
            'reserve_slots': { type: 'int', description: 'Free slots required before work resumes.', domain: [1, 12] },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
        },
        perform: runAsAction(async (agent, role, protected_item, reserve_slots, x, y, z) => {
            return await skills.depositInventoryOverflowAt(
                agent.bot,
                role,
                protected_item,
                reserve_slots,
                x,
                y,
                z,
            );
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            return await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            return await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position.clone();
            if (!await skills.moveAway(agent.bot, 5)) return false;
            if (!await skills.discard(agent.bot, item_name, num)) return false;
            return await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            return await skills.collectBlock(
                agent.bot,
                type,
                num,
                agent.goal_director?.collectionExclusions?.() || null,
            );
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!pickupUsefulItems',
        description: 'Pick up nearby food, equipment, resources, and work materials when it is safe and inventory has room.',
        params: {
            'range': { type: 'int', description: 'Maximum pickup radius.', domain: [4, 32, '[]'] },
        },
        perform: runAsAction(async (agent, range) => {
            return await skills.pickupUsefulItems(agent.bot, range);
        })
    },
    {
        name: '!collectBlocksInRange',
        description: 'Collect a bounded number of exact target blocks within an explicit work-order search radius.',
        params: {
            'type': { type: 'BlockName', description: 'The exact block type to collect.' },
            'num': { type: 'int', description: 'Maximum number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'range': { type: 'int', description: 'Maximum search radius.', domain: [16, 512] },
        },
        perform: runAsAction(async (agent, type, num, range) => {
            return await skills.collectBlock(
                agent.bot,
                type,
                num,
                agent.goal_director?.collectionExclusions?.() || null,
                range,
            );
        }, false, 10)
    },
    {
        name: '!prepareMaterial',
        description: 'Survival-source useful building or mining supplies through verified gathering and crafting.',
        params: {
            'material_name': { type: 'string', description: 'Supported family or item: planks, a specific plank type, cobblestone, dirt, or torch.' },
            'num': { type: 'int', description: 'Additional number of items to prepare.', domain: [1, 2304, '[]'] },
            'range': { type: 'int', description: 'Maximum resource search radius.', domain: [16, 512, '[]'] },
        },
        perform: runAsAction(async (agent, material_name, num, range) => {
            return await skills.prepareMaterial(agent.bot, material_name, num, range);
        }, false, 10)
    },
    {
        name: '!prepareFood',
        description: 'Secure a safe food reserve by crafting carried ingredients, harvesting and replanting mature crops, cooking raw food, and sustainably hunting adult animals when needed.',
        params: {
            'target_food_points': { type: 'int', description: 'Safe carried food points to secure.', domain: [6, 160, '[]'] },
            'range': { type: 'int', description: 'Maximum crop, animal, and resource search radius.', domain: [16, 128, '[]'] },
        },
        perform: runAsAction(async (agent, target_food_points, range) => {
            return await skills.prepareFood(agent.bot, target_food_points, range);
        }, false, 10)
    },
    {
        name: '!prepareTool',
        description: 'Survival-bootstrap and equip a durable wooden, stone, iron, or diamond pickaxe, axe, shovel, hoe, or sword, replacing worn tools before they break.',
        params: {
            'tool_name': { type: 'ItemName', description: 'Supported tool such as stone_pickaxe, iron_pickaxe, diamond_pickaxe, or an axe of the same tiers.' }
        },
        perform: runAsAction(async (agent, tool_name) => {
            return await skills.prepareTool(agent.bot, tool_name);
        }, false, 10)
    },
    {
        name: '!prepareWoodenTool',
        description: 'Compatibility command for survival-bootstrapping a supported wooden job tool.',
        params: {
            'tool_name': { type: 'ItemName', description: 'Supported tool: wooden_pickaxe or wooden_axe.' }
        },
        perform: runAsAction(async (agent, tool_name) => {
            return await skills.prepareWoodenTool(agent.bot, tool_name);
        }, false, 10)
    },
    {
        name: '!collectWood',
        description: 'Find nearby trees of any wood type and collect their logs.',
        params: {
            'num': { type: 'int', description: 'The number of logs to collect.', domain: [1, 64, '[]'] }
        },
        perform: runAsAction(async (agent, num) => {
            return await skills.collectWood(
                agent.bot,
                num,
                64,
                agent.goal_director?.collectionExclusions?.() || null,
            );
        }, false, 10)
    },
    {
        name: '!collectWoodInRange',
        description: 'Collect a bounded number of safe reachable logs within an explicit work-order search radius.',
        params: {
            'num': { type: 'int', description: 'Maximum number of logs to collect.', domain: [1, 64, '[]'] },
            'range': { type: 'int', description: 'Maximum search radius.', domain: [16, 512] },
        },
        perform: runAsAction(async (agent, num, range) => {
            return await skills.collectWood(
                agent.bot,
                num,
                range,
                agent.goal_director?.collectionExclusions?.() || null,
            );
        }, false, 10)
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            return await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!requestItemGoal',
        description: 'Start one typed, resumable physical goal that acquires an exact quantity or delivers it to a canonical player. Use kind "acquire" or "deliver"; all subgoals use existing deterministic commands and overall completion is verified from Minecraft state.',
        params: {
            'kind': { type: 'string', description: 'Goal kind: acquire or deliver.' },
            'target': { type: 'string', description: 'Canonical item/block name or supported family: logs or planks.' },
            'quantity': { type: 'int', description: 'Exact requested quantity.', domain: [1, 2304, '[]'] },
            'requester_or_recipient': { type: 'string', description: 'Canonical requesting player name. For deliver goals this is also the recipient.' },
        },
        perform: persistentGoalCommand(function (agent, kind, targetName, quantity, requesterOrRecipient) {
            const normalizedKind = String(kind || '').trim().toLowerCase();
            if (!['acquire', 'deliver'].includes(normalizedKind)) {
                return 'Typed item goal was not accepted: kind must be acquire or deliver.';
            }
            const target = resolveItemGoalTarget(agent.bot, targetName);
            if (!target) {
                return `Typed item goal was not accepted: '${String(targetName || '').slice(0, 80)}' is not a supported connected-registry target.`;
            }
            if (target.acquisitionKind === 'unsupported') {
                return `Typed item goal was not accepted: ${target.requestedName} has no safe deterministic acquisition path.`;
            }
            const canonicalRequester = String(requesterOrRecipient || '').trim();
            if (!canonicalRequester) {
                return 'Typed item goal was not accepted: a canonical requesting player is required.';
            }
            const resolution = resolvePlayerTarget(agent.bot, canonicalRequester, {
                knownBotNames: agent.getKnownAgentNames?.() || [],
            });
            if (resolution.ambiguous) {
                return `Typed item goal was not accepted: player '${canonicalRequester}' is ambiguous.`;
            }
            if (resolution.canonical && resolution.canonical !== canonicalRequester) {
                return `Typed item goal was not accepted: use canonical player '${resolution.canonical}'.`;
            }
            const baselineInventory = inventoryCountForGoalTarget(agent.bot, target);
            const goal = createItemGoalContract({
                kind: normalizedKind,
                requester: canonicalRequester,
                target,
                quantity,
                destinationPlayer: normalizedKind === 'deliver' ? canonicalRequester : null,
                request: normalizedKind === 'deliver'
                    ? `deliver ${quantity} ${target.requestedName} to ${canonicalRequester}`
                    : `acquire ${quantity} ${target.requestedName}`,
                source: 'player',
                baselineInventory,
            });
            const accepted = agent.goal_director?.submit?.(goal);
            if (!accepted?.accepted) {
                return `Typed item goal was not accepted: ${accepted?.detail || accepted?.code || 'goal director unavailable'}.`;
            }
            const reused = accepted.procedureId
                ? ` Reusing proven procedure ${accepted.procedureId}.`
                : '';
            return `Accepted typed goal ${accepted.id}: ${goal.kind} ${goal.quantity} ${goal.target.family || goal.target.canonicalName}${goal.kind === 'deliver' ? ` to ${goal.destination.player}` : ''}.${reused}`;
        }),
    },
    {
        name: '!assignMiningJob',
        description: 'Assign this Miner a persistent, resumable resource quota using its full tool, safety, delivery, and recovery plan.',
        params: {
            'resource': { type: 'string', description: 'Canonical resource such as cobblestone, coal_ore, iron_ore, diamond_ore, or ancient_debris.' },
            'quota': { type: 'int', description: 'Verified output quota.', domain: [1, 2304, '[]'] },
        },
        perform: persistentJobCommand(async function (agent, resource, quota) {
            try {
                const order = createWorkOrder({
                    role: 'miner',
                    kind: 'mine',
                    source: 'player',
                    requester: 'player',
                    target: { name: String(resource || '').trim().toLowerCase() },
                    quota,
                });
                return submitRoleOrder(agent, 'miner', order);
            } catch (error) {
                return `Mining work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!assignHarvestJob',
        description: 'Assign this Lumberjack a persistent, resumable tree quota with tool preparation, safe collection, replanting, and delivery.',
        params: {
            'log': { type: 'string', description: 'Canonical log type such as oak_log, spruce_log, or the family name logs.' },
            'quota': { type: 'int', description: 'Verified log quota.', domain: [1, 2304, '[]'] },
        },
        perform: persistentJobCommand(async function (agent, log, quota) {
            try {
                const order = createWorkOrder({
                    role: 'lumberjack',
                    kind: 'harvest',
                    source: 'player',
                    requester: 'player',
                    target: { name: String(log || '').trim().toLowerCase() },
                    quota,
                });
                return submitRoleOrder(agent, 'lumberjack', order);
            } catch (error) {
                return `Harvest work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!assignStockpileJob',
        description: 'Assign this Builder a persistent material stockpile quota without authorizing construction.',
        params: {
            'material': { type: 'string', description: 'Supported stockpile material: planks, a specific plank type, cobblestone, or dirt.' },
            'quota': { type: 'int', description: 'Inventory stockpile target.', domain: [1, 2304, '[]'] },
        },
        perform: persistentJobCommand(async function (agent, material, quota) {
            try {
                const order = createBuilderStockpileOrder({
                    material: String(material || '').trim().toLowerCase(),
                    quota,
                    source: 'player',
                    requester: 'player',
                });
                return submitRoleOrder(agent, 'builder', order);
            } catch (error) {
                return `Stockpile work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!assignShelterJob',
        description: 'Build one small, verified survival shelter around the bot using gathered materials and a fixed safe doorway.',
        params: {},
        perform: persistentJobCommand(async function (agent) {
            try {
                const position = agent.bot?.entity?.position;
                if (!position) return 'Shelter work order was not accepted: Minecraft spawn state is unavailable.';
                const order = createBuilderShelterOrder({
                    x: Math.floor(position.x) - 1,
                    y: Math.floor(position.y),
                    z: Math.floor(position.z) - 1,
                    requester: 'player',
                });
                return submitRoleOrder(agent, 'builder', order);
            } catch (error) {
                return `Shelter work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!assignFunctionalShelterJob',
        description: 'Build a verified 5x5 functional shelter beside the bot from one solid wall material, in causal order: supported foundation, enclosure, door, roof, then interior light, storage, crafting table, and furnace.',
        params: {
            'wall_material': { type: 'BlockName', description: 'Solid full block used consistently for foundation, walls, and roof.' },
        },
        perform: persistentJobCommand(async function (agent, wall_material) {
            try {
                const material = String(wall_material || '').trim().toLowerCase();
                const block = agent.bot?.registry?.blocksByName?.[material];
                const item = agent.bot?.registry?.itemsByName?.[material];
                if (!block || !item || block.boundingBox !== 'block') {
                    return `Functional shelter work order was not accepted: ${material || 'the requested material'} is not a carried/placeable full support block in the connected registry.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Functional shelter work order was not accepted: Minecraft spawn state is unavailable.';
                const order = createBuilderFunctionalShelterOrder({
                    x: Math.floor(position.x) + 2,
                    y: Math.floor(position.y),
                    z: Math.floor(position.z) - 2,
                    material,
                    requester: 'player',
                });
                return submitRememberedStructure(agent, order);
            } catch (error) {
                return `Functional shelter work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!assignConstructionJob',
        description: 'Build or repair one operator-approved bounded platform, bridge, wall, column, or room through the persistent verified Builder work-order path.',
        params: {
            'shape': { type: 'string', description: 'Construction shape: platform, bridge, wall, column, or room.' },
            'width': { type: 'int', description: 'Width in blocks, 1-16.', domain: [1, 16, '[]'] },
            'depth': { type: 'int', description: 'Depth in blocks, 1-16. Walls, bridges, and columns use a safe fixed depth.', domain: [1, 16, '[]'] },
            'height': { type: 'int', description: 'Verified reachable height, 1-4. Platforms and bridges use one layer.', domain: [1, 4, '[]'] },
            'material': { type: 'BlockName', description: 'Canonical full support block for the structure.' },
        },
        perform: persistentJobCommand(async function (agent, shape, width, depth, height, material) {
            try {
                const canonicalMaterial = String(material || '').trim().toLowerCase();
                const block = agent.bot?.registry?.blocksByName?.[canonicalMaterial];
                const item = agent.bot?.registry?.itemsByName?.[canonicalMaterial];
                if (!block || !item || block.boundingBox !== 'block') {
                    return `Construction work order was not accepted: ${canonicalMaterial || 'the requested material'} is not a placeable full support block in the connected registry.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Construction work order was not accepted: Minecraft spawn state is unavailable.';
                const order = createBuilderConstructionOrder({
                    x: Math.floor(position.x) + 2,
                    y: Math.floor(position.y),
                    z: Math.floor(position.z) + 2,
                    shape,
                    width,
                    depth,
                    height,
                    material: canonicalMaterial,
                    requester: 'player',
                });
                return submitRememberedStructure(agent, order);
            } catch (error) {
                return `Construction work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!buildStructure',
        description: `Build one complete named building beside the bot. Use this when the player asks for a building by what it is rather than by its shape - a tower, a house, somewhere to store things, a pen for the animals. Known structures: ${describeStructureCatalog()}`,
        params: {
            'structure': { type: 'string', description: `Structure to build: ${STRUCTURE_NAMES.join(', ')}.` },
            'material': { type: 'BlockName', description: 'Canonical full support block for the walls, floor, and roof. Doors, glass, fences, chests, and torches are chosen by the structure.' },
        },
        perform: persistentJobCommand(function (agent, structure, material) {
            try {
                const canonicalMaterial = String(material || '').trim().toLowerCase();
                const block = agent.bot?.registry?.blocksByName?.[canonicalMaterial];
                const item = agent.bot?.registry?.itemsByName?.[canonicalMaterial];
                if (!block || !item || block.boundingBox !== 'block') {
                    return `Structure work order was not accepted: ${canonicalMaterial || 'the requested material'} is not a placeable full support block in the connected registry.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Structure work order was not accepted: Minecraft spawn state is unavailable.';
                const order = createStructureOrder({
                    name: structure,
                    // Offset so the bot is never standing inside its own worksite,
                    // which the blueprint audit reports as an occupied cell.
                    x: Math.floor(position.x) + 2,
                    y: Math.floor(position.y),
                    z: Math.floor(position.z) + 2,
                    material: canonicalMaterial,
                    requester: 'player',
                });
                return submitRememberedStructure(agent, order);
            } catch (error) {
                return `Structure work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!rememberHome',
        description: 'Remember the bot’s current verified position and dimension as its durable home across restarts.',
        params: {},
        perform: async function (agent) {
            const position = agent.bot?.entity?.position;
            if (!position || !agent.home_state) return 'Home was not remembered: live position or home-state storage is unavailable.';
            try {
                const state = agent.home_state.rememberHome(position, agent.bot?.game?.dimension);
                return `Remembered home at ${state.home.x}, ${state.home.y}, ${state.home.z} in ${state.home.dimension}.`;
            } catch (error) {
                return `Home was not remembered: ${String(error?.message || error).slice(0, 180)}.`;
            }
        },
    },
    {
        name: '!repairHome',
        description: 'Re-run verification and repair every missing cell in the most recently remembered player-built structure.',
        params: {},
        perform: persistentJobCommand(async function (agent) {
            const remembered = agent.home_state?.snapshot?.().structureOrder;
            if (!remembered) return 'Home repair was not accepted: no player-built structure is remembered.';
            try {
                const now = Date.now();
                const order = {
                    ...remembered,
                    id: `${remembered.id.slice(0, 68)}.repair.${now}`,
                    source: 'player',
                    requester: 'player',
                    phase: 'assess',
                    resumePhase: null,
                    attempts: 0,
                    checkpoint: {},
                    evidence: null,
                    createdAt: now,
                    updatedAt: now,
                };
                return submitRememberedStructure(agent, createWorkOrder(order));
            } catch (error) {
                return `Home repair work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!establishFarm',
        description: 'Till, plant, verify, and durably remember a hydrated 1-16 plot food farm beside loaded water.',
        params: {
            'crop': { type: 'string', description: 'Crop: wheat, carrots, potatoes, or beetroots.' },
            'width': { type: 'int', description: 'Farm width, 1-4.', domain: [1, 4, '[]'] },
            'depth': { type: 'int', description: 'Farm depth, 1-4.', domain: [1, 4, '[]'] },
        },
        perform: runAsAction(async function (agent, crop, width, depth) {
            const established = await skills.establishFarm(agent.bot, crop, width, depth);
            const farm = agent.bot?.lastActionEvidence?.farm;
            if (!established || !farm) return false;
            return persistFarmState(agent, farm, 'established');
        }),
    },
    {
        name: '!maintainFarm',
        description: 'Harvest mature crops, collect drops, replant missing plots, and verify the remembered farm.',
        params: {},
        perform: runAsAction(async function (agent) {
            const farm = agent.home_state?.snapshot?.().farm;
            if (!farm) {
                skills.log(agent.bot, 'No durable farm is remembered. Establish one first.');
                return false;
            }
            const maintained = await skills.maintainFarm(agent.bot, farm);
            if (!maintained) return false;
            return persistFarmState(agent, agent.bot?.lastActionEvidence?.farm, 'maintained');
        }),
    },
    {
        name: '!breedAnimals',
        description: 'Feed verified nearby adult animal pairs and confirm new offspring while preserving the breeding stock.',
        params: {
            'animal': { type: 'string', description: 'Animal: cow, sheep, pig, chicken, or rabbit.' },
            'pairs': { type: 'int', description: 'Number of pairs, 1-4.', domain: [1, 4, '[]'] },
        },
        perform: runAsAction(async function (agent, animal, pairs) {
            return await skills.breedAnimals(agent.bot, animal, pairs);
        }, false, 1),
    },
    {
        name: '!cancelJob',
        description: 'Cancel this bot’s active resumable work order without releasing unrelated operator safety controls.',
        params: {},
        perform: async function (agent) {
            return agent.job_director?.cancel?.('Cancelled by player.')
                ? 'Active work order cancelled.'
                : 'There is no active work order to cancel.';
        },
    },
    {
        name: '!cancelGoal',
        description: 'Cancel the active typed gameplay goal and its remaining subgoals.',
        params: {},
        perform: function (agent) {
            return agent.goal_director?.cancel?.('Cancelled by player.')
                ? 'Active typed gameplay goal cancelled.'
                : 'There is no active typed gameplay goal to cancel.';
        },
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            return success;
        })
    },
    {
        name: '!brewPotion',
        description: 'Brew one to three verified potions in a real brewing stand. Targets include strength, fire_resistance, healing, swiftness, regeneration, night_vision, water_breathing, slow_falling, poison, leaping, turtle_master, and weakness. Prefix a target with long_, strong_, splash_, or lingering_ when that vanilla combination exists.',
        params: {
            'potion': { type: 'string', description: 'Potion target such as strength, strong_strength, long_fire_resistance, splash_healing, or lingering_poison.' },
            'num': { type: 'int', description: 'Number of water bottles to brew in this batch.', domain: [1, 3, '[]'] },
        },
        perform: runAsAction(async (agent, potion, num) => {
            return await skills.brewPotion(agent.bot, potion, num);
        }, false, 10),
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            return await skills.clearNearestFurnace(agent.bot);
        })
    },
    {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            return await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!placeBlockAt',
        description: 'Place one block at an exact prevalidated blueprint coordinate without breaking any obstruction.',
        params: {
            'type': { type: 'BlockOrItemName', description: 'The exact block type to place.' },
            'x': { type: 'float', description: 'The validated x coordinate.' },
            'y': { type: 'float', description: 'The validated y coordinate.' },
            'z': { type: 'float', description: 'The validated z coordinate.' },
        },
        perform: runAsAction(async (agent, type, x, y, z) => {
            return await skills.placeBlock(agent.bot, type, x, y, z, 'bottom', true, false);
        })
    },
    {
        name: '!buildNetherPortal',
        description: 'Build and ignite one verified ten-obsidian Nether portal on a nearby clear supported footprint. Requires ten total frame obsidian, flint and steel or a fire charge, and three expendable scaffold blocks; missing dirt scaffolds are gathered through the normal collection skill.',
        params: {
            'range': { type: 'int', description: 'Maximum clear-site search radius.', domain: [6, 16, '[]'] },
        },
        perform: runAsAction(async (agent, range) => {
            return await skills.buildNetherPortal(agent.bot, range);
        }, false, 10)
    },
    {
        name: '!completeNetherQuartzRun',
        description: 'Use a nearby active portal to enter the Nether, collect new quartz through the normal bounded collection skill, and return alive to verified Overworld ground. Raised portals use two prepared bottom-slab ramps.',
        params: {
            'quartz_count': { type: 'int', description: 'New quartz items to bring back.', domain: [1, 8, '[]'] },
        },
        perform: runAsAction(async (agent, quartz_count) => {
            return await skills.completeNetherQuartzRun(agent.bot, quartz_count);
        }, false, 10)
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            return await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackHostile',
        description: 'Resolve nearby hostiles through the tactical combat loop, including threat priority, shield/range choice, retreat, and verified physical outcomes.',
        params: {},
        perform: runAsAction(async (agent) => {
            return await skills.resolveTacticalCombat(agent.bot, 16);
        })
    },
    {
        name: '!resolveTacticalCombat',
        description: 'Choose and execute one bounded tactical response loop from live health, equipment, hostile type, and distance. Prioritizes urgent threats, retreats when unsafe, uses bows against explosives, shields against projectile attackers, and verifies the physical outcome.',
        params: {
            'range': { type: 'int', description: 'Maximum loaded-hostile decision range.', domain: [4, 32, '[]'] },
        },
        perform: runAsAction(async (agent, range) => {
            return await skills.resolveTacticalCombat(agent.bot, range);
        }, false, 3)
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            if (agent.runtime?.role === 'companion') {
                skills.log(agent.bot, 'Companion policy does not permit targeting players.');
                return false;
            }
            const resolution = resolvePlayerTarget(agent.bot, player_name, {
                knownBotNames: convoManager.getInGameAgents(),
                isBotIdentity: identity => convoManager.isOtherAgent(identity),
            });
            const player = resolution.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            return await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            return await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!addToAgenda',
        description: 'Queue ONE step of a multi-part plan. When a player asks for several things in one sentence, call this once per step, in the order they said them, and the bot will work through the whole plan on its own. Kinds: acquire, deliver, mine, harvest, stockpile, shelter, goto.',
        params: {
            'kind': { type: 'string', description: 'One of: acquire, deliver, mine, harvest, stockpile, shelter, goto.' },
            'target': { type: 'string', description: 'Canonical item, block, or material name. Use "none" for shelter and goto.' },
            'quantity': { type: 'int', description: 'How many. Use 1 for shelter and goto.', domain: [1, 2304, '[]'] },
            'player_name': { type: 'string', description: 'The player this step is for: the recipient for deliver, the destination for goto, otherwise the requester.' },
        },
        perform: function (agent, kind, target, quantity, playerName) {
            const director = agent.agenda_director;
            if (!director?.add) return 'The agenda is unavailable on this bot.';
            const result = director.add({
                kind,
                target: String(target || '').toLowerCase() === 'none' ? '' : target,
                quantity,
                recipient: playerName,
                requester: playerName,
                note: `${kind} ${target}`,
            });
            if (!result.accepted) {
                return `That step was not queued: ${result.detail || result.code}.`;
            }
            return `Queued step ${result.position}: ${result.description}.`;
        }
    },
    {
        name: '!setAutonomy',
        description: 'Change how much this bot decides for itself: command (only does what it is told), balanced (works near its leader), or autonomous (pursues its own progression and role work).',
        params: {
            'mode': { type: 'string', description: 'command, balanced, or autonomous.' },
        },
        perform: function (agent, mode) {
            const result = applyRuntimeChange(agent, { autonomy: mode });
            return result.ok
                ? `Autonomy is now ${result.runtime.autonomy}.`
                : `Autonomy was not changed: ${result.detail}`;
        }
    },
    {
        name: '!setComportment',
        description: 'Change how this bot carries itself: neutral, npc_precise, npc_steady, human_focused, or human_casual. Affects pacing, hesitation, idle behavior, and persistence, never what it is allowed to do.',
        params: {
            'preset': { type: 'string', description: 'neutral, npc_precise, npc_steady, human_focused, or human_casual.' },
        },
        perform: function (agent, preset) {
            const result = applyRuntimeChange(agent, { comportment: preset });
            return result.ok
                ? `Comportment is now ${result.runtime.comportment.preset} (${result.runtime.comportment.label}).`
                : `Comportment was not changed: ${result.detail}`;
        }
    },
    {
        name: '!setTraversal',
        description: 'Change what this bot may do to the world to get somewhere: preserve (breaks nothing), careful (may tunnel through natural fill only), or full (also towers and parkours). Never lets it break anything a player built.',
        params: {
            'policy': { type: 'string', description: 'preserve, careful, or full.' },
        },
        perform: function (agent, policy) {
            const result = applyRuntimeChange(agent, { traversal: policy });
            if (!result.ok) return `Traversal was not changed: ${result.detail}`;
            // Route policy is read where Movements are built, which only sees the bot.
            agent.bot.traversalPolicy = result.runtime.traversal;
            return `Traversal is now ${result.runtime.traversal}.`;
        }
    },
    {
        name: '!showRuntime',
        description: 'Report this bot\'s current autonomy, comportment, traversal, and role.',
        perform: function (agent) {
            const runtime = agent.runtime;
            if (!runtime) return 'Runtime configuration is unavailable.';
            return [
                `Role: ${runtime.role}`,
                `Autonomy: ${runtime.autonomy}`,
                `Comportment: ${runtime.comportment?.preset || 'neutral'}`,
                `Traversal: ${runtime.traversal}`,
                `Jobs: ${runtime.jobs?.mode}`,
                `Reactions: ${runtime.reactions?.mode}`,
            ].join(' · ');
        }
    },
    {
        name: '!addRule',
        description: 'Create a standing order the bot follows on its own. Triggers: threat.detected, entity.hurt, self.damaged, self.died, player.approached, player.returned, player.joined, player.left, observation.item, observation.structure, observation.terrain, time.sunrise, time.sunset, weather.changed, job.completed, schedule. Actions: acquire, mine, harvest, stockpile, shelter, goto, visit, say.',
        params: {
            'trigger': { type: 'string', description: 'What starts the rule. Use "schedule" for a repeating patrol or chore.' },
            'action': { type: 'string', description: 'What the bot then queues: acquire, mine, harvest, stockpile, shelter, goto, visit, or say.' },
            'target': { type: 'string', description: 'Item or material for gathering actions; the sentence for say; "none" otherwise.' },
            'quantity': { type: 'int', description: 'How many for gathering actions, otherwise 1.', domain: [1, 2304, '[]'] },
            'player_name': { type: 'string', description: 'Restrict to one player, or the player to go to. Use "any" for anyone.' },
            'place': { type: 'string', description: 'Remembered place category to require or patrol: ore, workstation, storage, shelter, portal, hazard, water, or "none".' },
        },
        perform: function (agent, trigger, action, target, quantity, playerName, place) {
            const engine = agent.rule_engine;
            if (!engine?.add) return 'Standing orders are unavailable on this bot.';
            const none = value => (String(value || '').toLowerCase() === 'none' ? '' : value);
            const result = engine.add({
                trigger,
                action,
                target: none(target),
                quantity,
                player: String(playerName || '').toLowerCase() === 'any' ? '' : playerName,
                place: none(place),
            });
            return result.accepted
                ? `Standing order added: ${result.description}.`
                : `That rule was not accepted: ${result.detail}.`;
        }
    },
    {
        name: '!listRules',
        description: 'Report every standing order this bot follows on its own.',
        perform: function (agent) {
            const rules = agent.rule_engine?.list?.();
            if (!rules) return 'Standing orders are unavailable on this bot.';
            if (!rules.length) return 'I have no standing orders.';
            return rules
                .map((rule, index) => `${index + 1}. ${rule.description}${rule.enabled ? '' : ' (off)'} — fired ${rule.firedCount}x [${rule.id}]`)
                .join('\n');
        }
    },
    {
        name: '!removeRule',
        description: 'Delete a standing order by its id, as shown by !listRules.',
        params: {
            'rule_id': { type: 'string', description: 'The rule id to remove.' },
        },
        perform: function (agent, ruleId) {
            const result = agent.rule_engine?.remove?.(ruleId);
            if (!result) return 'Standing orders are unavailable on this bot.';
            return result.removed ? 'Standing order removed.' : 'No standing order matched that id.';
        }
    },
    {
        name: '!showAgenda',
        description: 'Report the queued plan: what is running now, what is waiting, and how the last steps ended.',
        perform: function (agent) {
            const snapshot = agent.agenda_director?.snapshot?.();
            if (!snapshot) return 'The agenda is unavailable on this bot.';
            if (!snapshot.remaining && !snapshot.recent.length) return 'My agenda is empty.';
            const lines = [];
            if (snapshot.active) lines.push(`Now: ${snapshot.active.description}`);
            if (snapshot.queue.length) {
                lines.push(`Next: ${snapshot.queue.map((entry, index) => `${index + 1}. ${entry.description}`).join('; ')}`);
            }
            if (snapshot.recent.length) {
                lines.push(`Recent: ${snapshot.recent.map(entry => `${entry.description} (${entry.state})`).join('; ')}`);
            }
            return lines.join('\n') || 'My agenda is empty.';
        }
    },
    {
        name: '!clearAgenda',
        description: 'Cancel every queued and running agenda step.',
        perform: function (agent) {
            const result = agent.agenda_director?.clear?.('Cleared by the player.');
            if (!result) return 'The agenda is unavailable on this bot.';
            return result.cleared
                ? `Cleared ${result.cleared} agenda step(s).`
                : 'My agenda was already empty.';
        }
    },
    {
        name: '!skipAgendaItem',
        description: 'Abandon the current agenda step and move on to the next one.',
        perform: function (agent) {
            const result = agent.agenda_director?.skipCurrent?.('Skipped by the player.');
            if (!result) return 'The agenda is unavailable on this bot.';
            return result.skipped
                ? `Skipped: ${result.skipped}.`
                : 'There is no agenda step to skip.';
        }
    },
    {
        name: '!fish',
        description: 'Fish in nearby water until the requested number of catches is verified.',
        params: {'count': { type: 'int', description: 'How many catches to verify.', domain: [1, 64] }},
        perform: runAsAction(async (agent, count) => {
            return await skills.fishForItems(agent.bot, count);
        })
    },
    {
        name: '!enchantItem',
        description: 'Enchant a carried item at a nearby enchanting table using lapis and experience levels.',
        params: {'item_name': { type: 'ItemName', description: 'The carried item to enchant.' }},
        perform: runAsAction(async (agent, itemName) => {
            return await skills.enchantItem(agent.bot, itemName);
        })
    },
    {
        name: '!repairItem',
        description: 'Repair a damaged tool, weapon, or armour piece at a nearby anvil using a duplicate or its base material.',
        params: {'item_name': { type: 'ItemName', description: 'The damaged item to repair.' }},
        perform: runAsAction(async (agent, itemName) => {
            return await skills.repairAtAnvil(agent.bot, itemName);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            return await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!setPersona',
        description: 'Set your character, role, voice, and roleplay priorities while preserving truthful gameplay behavior.',
        params: {
            'persona': { type: 'string', description: 'A concise character and role description.' }
        },
        perform: async function (agent, persona) {
            const applied = agent.setPersona(persona);
            return applied
                ? `Character role updated: ${applied}`
                : 'Character role cleared.';
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            prompt = String(prompt || '').trim();
            if (!prompt) {
                return 'Goal was not started because it needs a non-empty instruction.';
            }
            agent.goal_director?.cancel?.('Superseded by a new conversational goal.');
            agent.releaseOperatorHold('new goal');
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
                convoManager.deferGoalUntilConversationEnd();
                return 'Goal saved. It will resume after the current conversation ends.';
            }
            const result = agent.self_prompter.start(prompt);
            return result.started
                ? 'Goal started.'
                : result.reason || 'Goal was not started.';
        }
    },
    {
        name: '!endGoal',
        description: 'Request goal completion. Typed physical goals stop only when their deterministic Minecraft completion predicate is satisfied; legacy conversational goals stop self-prompting.',
        perform: async function (agent) {
            const typed = agent.goal_director?.requestCompletion?.();
            if (typed?.handled) return typed.message;
            await agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            return await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            return await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!inspectView',
        description: 'Analyze the current first-person view with the configured vision model, grounded by exact protocol detections and the active causal plan.',
        params: {},
        perform: async function(agent) {
            return await runVisionAction(agent, 'action:inspectView', () =>
                agent.vision_interpreter.inspectCurrentView());
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            return await runVisionAction(agent, 'action:lookAtPlayer', () =>
                agent.vision_interpreter.lookAtPlayer(player_name, direction));
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            return await runVisionAction(agent, 'action:lookAtPosition', () =>
                agent.vision_interpreter.lookAtPosition(x, y, z));
        }
    },
    {
        name: '!breakBlock',
        description: 'Break the block at the given coordinates. Use !goToCoordinates first to get nearby.',
        params: {
            'x': {type: 'float', description: 'The x coordinate of the block to break.'},
            'y': {type: 'float', description: 'The y coordinate of the block to break.'},
            'z': {type: 'float', description: 'The z coordinate of the block to break.'},
        },
        perform: runAsAction(async (agent, x, y, z) => {
            return await skills.breakBlockAt(agent.bot, x, y, z);
        })
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            return await skills.digDown(agent.bot, distance);
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            return await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useItem',
        description: 'Equip and activate any carried registered item in the main or off hand for a bounded duration, then release it. Use specialized skills when a stronger world outcome must be verified.',
        params: {
            'item_name': { type: 'ItemName', description: 'Canonical registered item name to activate.' },
            'duration_ms': { type: 'int', description: 'Use duration: 0 for one-shot items, or up to 5000 ms for bows, shields, spyglasses, tridents, food, and other held-use items.', domain: [0, 5000, '[]'] },
            'hand': { type: 'string', description: 'Equipment hand: "main" or "off".' },
        },
        perform: runAsAction(async (agent, item_name, duration_ms, hand) => {
            return await skills.useItem(agent.bot, item_name, duration_ms, hand);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) a carried tool or empty hand on the nearest block/entity target. Reports verified when Minecraft state changes, otherwise requested without claiming an effect.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            return await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
    {
        name: '!come',
        description: 'Come to the named player and stop within a comfortable companion distance. Use for requests such as "come here".',
        params: {'player_name': { type: 'string', description: 'Name of the player to approach.' }},
        perform: runAsAction(async (agent, player_name) => {
            setCompanionDirective(agent, null, player_name);
            return await skills.goToPlayer(agent.bot, player_name, 2);
        })
    },
    {
        name: '!follow',
        description: 'Continuously follow the named player until stopped or replaced by another player action. Use for "follow me".',
        params: {'player_name': { type: 'string', description: 'Name of the player to follow.' }},
        perform: runAsAction(async (agent, player_name) => {
            setCompanionDirective(agent, 'follow', player_name);
            return await skills.followPlayer(agent.bot, player_name, 3);
        }, true)
    },
    {
        name: '!collect',
        description: 'Collect a bounded quantity of a common block using the normal deterministic collection skill.',
        params: {
            'block_type': { type: 'BlockName', description: 'Canonical block name, such as oak_log.' },
            'quantity': { type: 'int', description: 'Number to collect.', domain: [1, 65] },
        },
        perform: runAsAction(async (agent, block_type, quantity) => {
            return await skills.collectBlock(agent.bot, block_type, quantity);
        })
    },
    {
        name: '!give',
        description: 'Approach a player and give an exact inventory item quantity. Reports only a Minecraft-confirmed pickup as delivered.',
        params: {
            'player_name': { type: 'string', description: 'Name of the receiving player.' },
            'item_name': { type: 'ItemName', description: 'Canonical inventory item name.' },
            'quantity': { type: 'int', description: 'Number to give.', domain: [1, 2305] },
        },
        perform: runAsAction(async (agent, player_name, item_name, quantity) => {
            return await skills.giveToPlayer(agent.bot, item_name, player_name, quantity);
        })
    },
    {
        name: '!defend',
        description: 'Guard the named player and retaliate only against a fresh combat-safe hostile attributed by Minecraft as hurting them.',
        params: {'player_name': { type: 'string', description: 'Name of the player to defend.' }},
        perform: runAsAction(async (agent, player_name) => {
            setCompanionDirective(agent, 'guard', player_name);
            agent.bot.modes.setOn('self_defense', true);
            return await skills.followPlayer(agent.bot, player_name, 3);
        }, true)
    },
    {
        name: '!place',
        description: 'Place a small bounded quantity of carried torches or blocks on safe nearby ground around the named player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the player to place near.' },
            'block_type': { type: 'BlockOrItemName', description: 'Canonical block or placeable item name, such as torch.' },
            'quantity': { type: 'int', description: 'Number to place.', domain: [1, 17] },
        },
        perform: runAsAction(async (agent, player_name, block_type, quantity) => {
            return await skills.placeNearPlayer(agent.bot, player_name, block_type, quantity);
        })
    },
];
