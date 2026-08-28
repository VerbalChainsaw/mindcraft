import * as skills from '../library/skills.js';
import Vec3 from 'vec3';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { requestBotSpawn, sendSquadRadio, serverProxy } from '../mindserver_proxy.js';
import { actionResultToMessage } from '../runtime/action-result.js';
import { requesterTerrainCollectionExclusion } from '../runtime/collection-candidate-selector.js';
import {
    createWorkOrder,
    resumeFailedWorkOrder,
    workOrderCollectionExclusions,
    workOrderProtectedRegionExclusion,
} from '../runtime/work-order.js';
import {
    builderWorksiteCollectionExclusion,
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
import {
    createDesignedStructureOrder,
    designLanguageHelp,
} from '../runtime/jobs/structure-design.js';
import { bindSafeConstructionOrder } from '../runtime/jobs/construction-assignment.js';
import {
    bindStructureAccessoryMaterials,
} from '../runtime/jobs/structure-material-binder.js';
import { isApprovedPrimaryConstructionMaterial } from '../runtime/jobs/structural-material-contract.js';
import { resolvePlayerTarget } from '../player-target.js';
import { normalizeRuntimeBehavior, runtimeBehaviorToProfile } from '../runtime/behavior-config.js';
import { blockCanSupportPlacement } from '../runtime/block-placement-contract.js';
import { recordActionTerminal } from '../action_manager.js';
import {
    createItemGoalContract,
    inventoryCountForGoalTarget,
    resolveItemGoalTarget,
} from '../runtime/goal-contract.js';
import { logInventoryCount } from '../runtime/jobs/lumberjack-plan.js';
import { buildPrerequisitePlan } from '../runtime/prerequisite-planner.js';
import { mayBindExactWorkstation } from './workstation-command-policy.js';
import { createAccessRepairWorkOrder, selectExistingAccessRepair } from '../runtime/access-repair.js';


const RESPONSIVE_COLLECTION_ACTION_TIMEOUT_MINUTES = 0.5;
const RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES = 1;
const SURFACE_RECOVERY_ACTION_TIMEOUT_MINUTES = 10;
const FLUID_MECHANIC_ACTION_TIMEOUT_MINUTES = 5;
const MAX_ORDERED_ITEM_PLAN_STEPS = 12;

function woodCollectionActionTimeoutMinutes(count, completeStartedTree = true) {
    if (completeStartedTree !== true) return RESPONSIVE_COLLECTION_ACTION_TIMEOUT_MINUTES;
    // One connected natural tree is the stewardship transaction even when the
    // requested inventory remainder is small. Keep one propagated hard
    // deadline, but size it for native climbing and exact scaffold cleanup;
    // CollectBlock's per-target stall watchdog still fails silent routes in a
    // few seconds instead of waiting for this outer ceiling.
    const requested = Math.max(1, Math.min(64, Math.floor(Number(count) || 1)));
    // A minimum quantity may span two natural components because the final
    // started tree must also finish. This is only the absolute ownership
    // ceiling: target navigation still has a three-second no-progress
    // watchdog, so extra time is earned by real cutting, pickup, or cleanup.
    return Math.min(5, 2.5 + requested / 24);
}

function activeMiningReturnState(agent) {
    const jobCheckpoint = agent?.job_director?.activeOrder?.checkpoint;
    const goalCheckpoint = agent?.goal_director?.activeGoal?.checkpoint;
    const checkpoint = Array.isArray(jobCheckpoint?.miningReturnRoute)
        && jobCheckpoint.miningReturnRoute.length > 0
        ? jobCheckpoint
        : goalCheckpoint;
    const route = Array.isArray(checkpoint?.miningReturnRoute)
        ? checkpoint.miningReturnRoute
        : [];
    const index = Number.isFinite(Number(checkpoint?.miningReturnIndex))
        ? Math.min(route.length - 1, Math.floor(Number(checkpoint.miningReturnIndex)))
        : route.length - 1;
    return { route, index };
}

function activeMiningReturnRoute(agent) {
    const { route, index } = activeMiningReturnState(agent);
    // A checkpoint can retain cells beyond the body's current return index
    // while recovery walks backward. Outbound mechanics own only the active
    // prefix through that index; handing them the stale suffix makes local
    // route deltas splice against a point the body no longer occupies.
    return index >= 0 ? route.slice(0, index + 1) : [];
}

function queueOrderedItemPlan(agent, encodedPlan, playerName, returnToPlayer = false) {
    const request = agent.actions?.currentRequestContext?.() || null;
    const previousGeneration = Number(agent.last_agenda_plan_submission?.generation) || 0;
    const recordSubmission = ({ accepted, code, entryIds = [] }) => {
        const submissionReceipt = Object.freeze({
            submissionKind: 'agenda_submission',
            planKind: 'item_plan',
            generation: previousGeneration + 1,
            requestId: request?.requestId || null,
            selectedSkill: request?.selectedSkill || null,
            routeOrigin: request?.routeOrigin || null,
            missionId: request?.missionId || null,
            activityId: request?.activityId || null,
            accepted: accepted === true,
            code,
            entryIds: Object.freeze(entryIds.slice(0, MAX_ORDERED_ITEM_PLAN_STEPS + 2)),
        });
        agent.last_agenda_plan_submission = submissionReceipt;
        agent.actions?.recordDurableSubmissionReceipt?.(submissionReceipt);
    };
    const reject = (code, message) => {
        recordSubmission({ accepted: false, code });
        return message;
    };
    const director = agent.agenda_director;
    if (!director?.addMany) {
        return reject('agenda_unavailable', 'The durable agenda is unavailable on this bot.');
    }
    const tokens = String(encodedPlan || '')
        .split('|')
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length < 1 || tokens.length > MAX_ORDERED_ITEM_PLAN_STEPS) {
        return reject(
            'item_plan_size_invalid',
            `The item plan must contain between 1 and ${MAX_ORDERED_ITEM_PLAN_STEPS} concrete outputs.`,
        );
    }

    const entries = [];
    const inventoryRequirements = [];
    const seen = new Set();
    for (const token of tokens) {
        const match = /^([a-z0-9_]{1,80}):([1-9][0-9]{0,3})$/.exec(token);
        if (!match) {
            return reject('item_plan_entry_invalid', `The item plan was not queued: '${token.slice(0, 100)}' must use canonical_item:quantity.`);
        }
        const quantity = Number.parseInt(match[2], 10);
        if (quantity < 1 || quantity > 2304) {
            return reject('item_plan_quantity_invalid', `The item plan was not queued: ${match[1]} quantity must be between 1 and 2304.`);
        }
        const target = resolveItemGoalTarget(agent.bot, match[1]);
        if (!target || target.acquisitionKind === 'unsupported') {
            return reject('item_plan_target_unsupported', `The item plan was not queued: '${match[1]}' has no connected-registry deterministic acquisition path.`);
        }
        if (!target.family) {
            const preflight = buildPrerequisitePlan(agent.bot, {
                target: target.inventoryName,
                quantity,
                completion: 'inventory',
            });
            if (preflight.status === 'blocked') {
                return reject(
                    'item_plan_target_unplannable',
                    `The item plan was not queued: '${match[1]}' has an unresolved deterministic prerequisite (${preflight.detail}${preflight.blocker ? ` Blocking prerequisite: ${preflight.blocker}.` : ''}). Choose another useful output or omit it.`,
                );
            }
        }
        const canonicalTarget = target.family || target.canonicalName;
        if (seen.has(canonicalTarget)) {
            return reject('item_plan_target_duplicate', `The item plan was not queued: '${canonicalTarget}' appears more than once.`);
        }
        seen.add(canonicalTarget);
        inventoryRequirements.push({ target: canonicalTarget, quantity });
        entries.push({
            kind: 'acquire',
            target: canonicalTarget,
            quantity,
            // A model-compiled loadout describes the useful inventory state
            // the player should have when the plan finishes. Re-evaluate that
            // floor from fresh Minecraft state at dispatch; do not blindly add
            // the same quantity to stock already carried.
            quantityMode: 'minimum',
            requester: playerName,
            note: `ordered item plan: ${canonicalTarget}`,
        });
    }
    entries.push({
        kind: 'inventory_checklist',
        requester: playerName,
        inventoryRequirements,
        note: 'verify aggregate ordered item plan',
    });
    if (returnToPlayer === true) {
        entries.push({
            kind: 'goto',
            requester: playerName,
            recipient: playerName,
            note: 'return after ordered item plan',
        });
    }

    const result = director.addMany(entries, {
        replaceUnfinished: request?.agendaDisposition === 'interrupt',
        reason: 'Superseded by a player-requested item plan.',
    });
    if (result.accepted !== true) {
        return reject(result.code || 'item_plan_rejected', `The item plan was not queued: ${result.detail || result.code}.`);
    }
    recordSubmission({
        accepted: true,
        code: 'item_plan_accepted',
        entryIds: result.entries.map(entry => entry.id),
    });
    agent.behavior_arbiter?.wake?.('ordered_item_plan_queued');
    return `Queued one durable ${result.entries.length}-step item plan: ${result.entries.map(entry => entry.description).join(', then ')}.`;
}
queueOrderedItemPlan.manualAutonomyTakeover = true;

const STORAGE_CONTAINER_NAMES = new Set(['chest', 'trapped_chest', 'barrel']);

function currentStorageContainerConstraint(bot) {
    if (
        typeof bot?.findBlocks !== 'function'
        || typeof bot?.blockAt !== 'function'
    ) return null;
    const storageTypeIds = [...STORAGE_CONTAINER_NAMES]
        .map(name => bot.registry?.blocksByName?.[name]?.id)
        .filter(Number.isInteger);
    if (storageTypeIds.length === 0) return null;
    const positions = bot.findBlocks({
        matching: storageTypeIds,
        maxDistance: 32,
        count: 64,
    });
    const block = positions
        .map(position => bot.blockAt(position, false))
        .find(candidate => skills.isStorageContainerInteractionFeasible(bot, candidate));
    const dimension = String(bot?.game?.dimension || '')
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, '');
    if (
        !STORAGE_CONTAINER_NAMES.has(block?.name)
        || !block?.position
        || ![block.position.x, block.position.y, block.position.z].every(Number.isFinite)
        || !dimension
    ) return null;
    return {
        name: block.name,
        position: {
            x: Math.floor(block.position.x),
            y: Math.floor(block.position.y),
            z: Math.floor(block.position.z),
        },
        dimension,
        source: 'player_context_here',
        observedAt: Date.now(),
    };
}

function queueStoragePlan(agent, encodedPlan, playerName, returnToPlayer = false) {
    const request = agent.actions?.currentRequestContext?.() || null;
    const previousGeneration = Number(agent.last_agenda_plan_submission?.generation) || 0;
    const recordSubmission = ({ accepted, code, entryIds = [] }) => {
        const submissionReceipt = Object.freeze({
            submissionKind: 'agenda_submission',
            planKind: 'storage_plan',
            generation: previousGeneration + 1,
            requestId: request?.requestId || null,
            selectedSkill: request?.selectedSkill || null,
            routeOrigin: request?.routeOrigin || null,
            missionId: request?.missionId || null,
            activityId: request?.activityId || null,
            accepted: accepted === true,
            code,
            entryIds: Object.freeze(entryIds.slice(0, MAX_ORDERED_ITEM_PLAN_STEPS + 1)),
        });
        agent.last_agenda_plan_submission = submissionReceipt;
        agent.actions?.recordDurableSubmissionReceipt?.(submissionReceipt);
    };
    const reject = (code, message) => {
        recordSubmission({ accepted: false, code });
        return message;
    };
    const director = agent.agenda_director;
    if (!director?.addMany) {
        return reject('agenda_unavailable', 'The durable agenda is unavailable on this bot.');
    }
    const containerConstraint = currentStorageContainerConstraint(agent.bot);
    if (!containerConstraint) {
        return reject('storage_container_unavailable', 'The storage plan was not queued because no loaded chest or barrel could be bound.');
    }
    const tokens = String(encodedPlan || '')
        .split('|')
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length < 1 || tokens.length > MAX_ORDERED_ITEM_PLAN_STEPS) {
        return reject(
            'storage_plan_size_invalid',
            `The storage plan must contain between 1 and ${MAX_ORDERED_ITEM_PLAN_STEPS} carried item groups.`,
        );
    }

    const storageRequirements = [];
    const seen = new Set();
    for (const token of tokens) {
        const match = /^([a-z0-9_]{1,80}):(0|[1-9][0-9]{0,3})$/.exec(token);
        if (!match) {
            return reject('storage_plan_entry_invalid', `The storage plan was not queued: '${token.slice(0, 100)}' must use canonical_item:retain_quantity.`);
        }
        const target = match[1];
        const retain = Number.parseInt(match[2], 10);
        if (!agent.bot?.registry?.itemsByName?.[target]) {
            return reject('storage_plan_target_unknown', `The storage plan was not queued: '${target}' is not a connected-registry item.`);
        }
        if (seen.has(target)) {
            return reject('storage_plan_target_duplicate', `The storage plan was not queued: '${target}' appears more than once.`);
        }
        seen.add(target);
        const carried = (agent.bot?.inventory?.items?.() || [])
            .filter(item => item?.name === target)
            .reduce((total, item) => total + Math.max(0, Number(item.count) || 0), 0);
        if (carried <= retain) {
            return reject(
                'storage_plan_no_surplus',
                `The storage plan was not queued: '${target}' has ${carried} carried and retain ${retain}, so there is no authorized surplus to store.`,
            );
        }
        storageRequirements.push({ target, retain });
    }

    const entries = [{
        kind: 'storage_plan',
        requester: playerName,
        storageRequirements,
        containerConstraint,
        note: 'model-selected authorized inventory cleanup',
    }];
    if (returnToPlayer === true) {
        entries.push({
            kind: 'goto',
            requester: playerName,
            recipient: playerName,
            note: 'return after inventory cleanup',
        });
    }
    const result = director.addMany(entries, {
        replaceUnfinished: request?.agendaDisposition === 'interrupt',
        reason: 'Superseded by a player-requested storage plan.',
    });
    if (result.accepted !== true) {
        return reject(result.code || 'storage_plan_rejected', `The storage plan was not queued: ${result.detail || result.code}.`);
    }
    recordSubmission({
        accepted: true,
        code: 'storage_plan_accepted',
        entryIds: result.entries.map(entry => entry.id),
    });
    agent.behavior_arbiter?.wake?.('storage_plan_queued');
    return `Queued one durable ${result.entries.length}-step storage plan: ${result.entries.map(entry => entry.description).join(', then ')}.`;
}
queueStoragePlan.manualAutonomyTakeover = true;

/**
 * Collection is allowed to search the world, but it may not treat the active
 * Builder worksite as a resource deposit. Keep the policy here, where the
 * durable work order is visible, and pass one compact box to the physical
 * collector instead of teaching every material path what a building is.
 */
export function collectionExclusionsForAgent(agent, requestedName = null) {
    const goalExclusions = agent?.goal_director?.collectionExclusions?.();
    const exclusions = Array.isArray(goalExclusions) ? [...goalExclusions] : [];
    // Match GoalDirector's compact source-region exclusion: an unsafe mining
    // stance is evidence about the local vein/approach, not one block face.
    exclusions.push(...workOrderCollectionExclusions(agent?.job_director?.activeOrder, requestedName));
    const worksite = builderWorksiteCollectionExclusion(agent?.job_director?.activeOrder);
    if (worksite) exclusions.push(worksite);
    const protectedRegion = workOrderProtectedRegionExclusion(agent?.job_director?.activeOrder);
    if (protectedRegion) exclusions.push(protectedRegion);
    const requesterName = agent?.goal_director?.activeGoal?.requester
        || agent?.job_director?.activeOrder?.requester;
    const requesterPosition = requesterName
        ? agent?.bot?.players?.[requesterName]?.entity?.position
        : null;
    const requesterArea = requesterTerrainCollectionExclusion(requestedName, requesterPosition);
    if (requesterArea) exclusions.push(requesterArea);
    return exclusions;
}

/**
 * Activated collection commands still call legacy skills that publish their
 * final observation through `bot.lastActionEvidence`. Adapt only this command
 * boundary into the composed action ledger. Nested collection (for example,
 * tool bootstrapping) remains a child of its owning skill and cannot
 * accidentally claim the outer action's one terminal slot.
 *
 * Never promote an arbitrary last observation. A resolved collection must end
 * in a bounded collection or mining-search receipt, and a claimed success must
 * agree with a positive `collected` observation. Unknown or contradictory
 * evidence becomes an explicit, non-retryable terminal failure.
 */
export function recordCollectionActionTerminal(bot, actionValue) {
    const evidence = bot?.lastActionEvidence;
    const kind = String(evidence?.kind || '').trim();
    const outcome = String(evidence?.outcome || '').trim();
    const claimedCollection = (
        kind === 'collect'
        && outcome === 'collected'
        && Number(evidence?.count) > 0
    );
    const supportedTerminal = (
        Boolean(outcome)
        && (kind === 'collect' || kind === 'mining_search')
        && typeof actionValue === 'boolean'
        && (actionValue === true) === claimedCollection
    );
    const terminal = supportedTerminal
        ? evidence
        : {
            kind: 'collect',
            outcome: 'collection_terminal_invalid',
            observed: {
                kind: kind || null,
                outcome: outcome || null,
                count: Number.isFinite(Number(evidence?.count)) ? Number(evidence.count) : null,
                actionValue: typeof actionValue === 'boolean' ? actionValue : null,
            },
            retryable: false,
        };
    const recorded = recordActionTerminal(terminal);
    if (recorded.accepted && bot) bot.lastActionEvidence = recorded.snapshot;
    return Object.freeze({
        accepted: recorded.accepted === true,
        valid: supportedTerminal,
        code: recorded.code,
        snapshot: recorded.snapshot,
    });
}

async function runCollectionAction(agent, operation) {
    const actionValue = await operation();
    const receipt = recordCollectionActionTerminal(agent?.bot, actionValue);
    return actionValue === true && receipt.accepted === true && receipt.valid === true;
}

async function runWorkstationAction(agent, expectedKind, operation) {
    const actionValue = await operation();
    const evidence = agent?.bot?.lastActionEvidence;
    const valid = evidence
        && evidence.kind === expectedKind
        && typeof evidence.outcome === 'string'
        && evidence.outcome.length > 0;
    const terminal = valid
        ? evidence
        : {
            kind: expectedKind,
            outcome: 'workstation_terminal_receipt_invalid',
            observedKind: evidence?.kind || null,
            observedOutcome: evidence?.outcome || null,
            retryable: false,
        };
    const recorded = recordActionTerminal(terminal);
    if (recorded.accepted && agent?.bot) agent.bot.lastActionEvidence = recorded.snapshot;
    return actionValue === true && recorded.accepted === true && valid;
}

function runAsAction (actionFn, resume = false, timeout = -1, prepareAction = null, receiptMode = 'legacy', specialist = null) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        if (typeof prepareAction === 'function') {
            await prepareAction(agent, ...args);
        }
        const actionFnWithAgent = async () => actionFn(agent, ...args);
        const actionTimeout = typeof timeout === 'function' ? timeout(agent, ...args) : timeout;
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, {
            timeout: actionTimeout,
            resume,
            receiptMode,
            specialist,
        });
        agent.actions.recordCommandExecutionResult?.(code_return.result);
        if (code_return.interrupted && !code_return.timedout)
            return;
        if (code_return.result?.phase && code_return.result.phase !== 'succeeded') {
            return actionResultToMessage(code_return.result);
        }
        return code_return.message || (code_return.result ? actionResultToMessage(code_return.result) : undefined);
    };
    // Direct player/dashboard use of a world skill is an explicit ownership
    // change. Agent.handleMessage reads this metadata before it starts the
    // action, so an older autonomous goal cannot wake up and compete with it.
    // Query/configuration/vision commands use different wrappers and retain
    // their existing non-takeover behavior.
    wrappedAction.manualAutonomyTakeover = true;
    wrappedAction.receiptMode = receiptMode;

    return wrappedAction;
}

async function acceptCharcoalMission(agent, quantity = 8) {
    const request = agent.actions?.currentRequestContext?.() || null;
    if (request?.routeOrigin !== 'model-selected') {
        return 'Mission not accepted: !acceptCharcoalMission is a model-only interpretation command for natural-language player promises.';
    }
    const openRequest = agent.open_player_request;
    const requester = openRequest?.source || agent.last_sender || '';
    const result = await agent.charcoal_mission?.accept?.({
        requester,
        quantity,
        sourceMessage: openRequest?.message || '',
    });
    return result?.detail || 'Mission not accepted: the charcoal Mission controller is unavailable.';
}
acceptCharcoalMission.manualAutonomyTakeover = true;

export function updateCompanionDirectiveFromAction(agent, directive, playerName) {
    // A bounded approach may be used as one leg of survival, goal, job, or
    // autonomy orchestration. Those owners temporarily control the body; they
    // do not have authority to erase an existing player Follow/Guard promise.
    // Unknown owner evidence fails closed. The non-null Follow/Guard prepare
    // hooks run before action acquisition and are themselves explicit player
    // continuation commands, so only destructive null mutations are gated.
    if (directive === null && agent?.actions?.currentActionOwner !== 'player') return false;
    agent.companion_context?.setDirective?.(directive, playerName);
    if (directive !== 'guard' && agent.runtime?.reflexes?.combat === 'off') {
        agent.bot?.modes?.setOn?.('self_defense', false);
    }
    return true;
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

function submitRoleOrderResult(agent, expectedRole, order) {
    const director = agent.job_director;
    if (!director || typeof director.submit !== 'function') {
        return {
            result: { accepted: false, code: 'job_director_unavailable' },
            message: `Work order was not accepted: ${expectedRole} job director unavailable.`,
        };
    }
    const intentValidation = expectedRole === 'builder' && !director.activeOrder
        ? agent.agenda_director?.validateConstructionSubmission?.(order)
        : null;
    const result = intentValidation?.accepted === false
        ? intentValidation
        : director.submit(order);
    const request = agent.actions?.currentRequestContext?.() || null;
    const previousGeneration = Number(agent.last_persistent_job_submission?.generation) || 0;
    const submissionReceipt = Object.freeze({
        submissionKind: 'job_submission',
        generation: previousGeneration + 1,
        requestId: request?.requestId || null,
        selectedSkill: request?.selectedSkill || null,
        routeOrigin: request?.routeOrigin || null,
        missionId: request?.missionId || null,
        activityId: request?.activityId || null,
        submittedOrderId: order?.id || null,
        activeOrderId: director.activeOrder?.id || null,
        accepted: result?.accepted === true,
        code: result?.code || (result?.accepted === true ? 'job_accepted' : 'job_rejected'),
    });
    // Retain the last receipt for telemetry/debugging, but bind control flow to
    // the immutable receipt returned by this exact command execution envelope.
    agent.last_persistent_job_submission = submissionReceipt;
    agent.actions?.recordDurableSubmissionReceipt?.(submissionReceipt);
    if (result?.accepted !== true) {
        return {
            result,
            message: result?.detail
                ? `Work order was not accepted: ${result.detail}`
                : `Work order was not accepted: ${result?.code || 'job director unavailable'}.`,
        };
    }
    const defaultRole = agent.runtime?.role || 'companion';
    const roleContext = defaultRole === expectedRole
        ? ''
        : ` while keeping ${defaultRole} as the default role`;
    return {
        result,
        message: result.code === 'already_active'
            ? `Resuming already-active ${expectedRole} work order ${result.id}${roleContext}.`
            : `Accepted resumable ${expectedRole} work order ${result.id}${roleContext}.`,
    };
}

function submitRoleOrder(agent, expectedRole, order) {
    return submitRoleOrderResult(agent, expectedRole, order).message;
}

function submitRememberedStructure(agent, order, {
    structuralMaterialAlternatives = false,
    resumeAgenda = false,
} = {}) {
    const boundOrder = bindStructureAccessoryMaterials(order, agent.bot, {
        structuralMaterialAlternatives,
    });
    const submission = submitRoleOrderResult(agent, 'builder', boundOrder);
    if (submission.result?.accepted === true) {
        if (resumeAgenda) {
            agent.agenda_director?.resumeConstructionContinuation?.(boundOrder.id);
        }
        try {
            agent.home_state?.rememberStructure?.(boundOrder);
        } catch (error) {
            return `${submission.message} Warning: durable home tracking failed: ${String(error?.message || error).slice(0, 160)}.`;
        }
    }
    return submission.message;
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

function canonicalDimension(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, '')
        .replace(/^the_nether$/, 'nether')
        .replace(/^the_end$/, 'end');
    return normalized ? `minecraft:${normalized}` : null;
}

function exactWorkstationArguments(name, x, y, z, dimension) {
    const coordinates = [x, y, z].map(Number);
    const normalizedName = String(name || '').trim().toLowerCase();
    const normalizedDimension = canonicalDimension(dimension);
    if (!['furnace', 'crafting_table'].includes(normalizedName)
        || !coordinates.every(Number.isFinite)
        || !normalizedDimension) return null;
    return {
        name: normalizedName,
        position: {
            x: Math.floor(coordinates[0]),
            y: Math.floor(coordinates[1]),
            z: Math.floor(coordinates[2]),
        },
        dimension: normalizedDimension,
        source: 'player_explicit_here',
        observedAt: Date.now(),
    };
}

function workstationArgumentsForAction(agent, name, x, y, z, dimension) {
    const request = agent?.actions?.currentRequestContext?.() || null;
    // A model may choose the mechanic, but it does not own exact world-state
    // binding. Deterministic directors and explicit commands can pass a
    // verified workstation; model-selected calls must use the live resolver.
    if (!mayBindExactWorkstation(request)) return null;
    return exactWorkstationArguments(name, x, y, z, dimension);
}

function resolveExplicitWorkstation(agent, resolution, workstationName) {
    const name = String(workstationName || '').trim().toLowerCase();
    if (!name) return { constraint: null };
    if (!['furnace', 'crafting_table'].includes(name)) {
        return { error: `Typed item goal was not accepted: '${name}' is not a supported explicit workstation.` };
    }
    const playerPosition = resolution?.entity?.position;
    if (!playerPosition) {
        return { error: 'Typed item goal was not accepted: the requesting player must be visible to bind “here” to a workstation.' };
    }
    const blockId = agent.bot?.registry?.blocksByName?.[name]?.id;
    if (!Number.isInteger(blockId) || typeof agent.bot?.findBlocks !== 'function') {
        return { error: `Typed item goal was not accepted: ${name} is unavailable in the connected registry.` };
    }
    let candidates = [];
    try {
        candidates = agent.bot.findBlocks({
            point: playerPosition,
            matching: blockId,
            maxDistance: 8,
            count: 8,
        }) || [];
    } catch {
        candidates = [];
    }
    const ranked = candidates
        .filter(position => position && [position.x, position.y, position.z].every(Number.isFinite))
        .map(position => ({
            position,
            distanceSquared: playerPosition.distanceSquared(position),
        }))
        .sort((left, right) => left.distanceSquared - right.distanceSquared);
    if (ranked.length === 0) {
        return { error: `Typed item goal was not accepted: no ${name.replaceAll('_', ' ')} is visible within 8 blocks of the requesting player.` };
    }
    if (ranked.length > 1 && ranked[0].distanceSquared === ranked[1].distanceSquared) {
        return { error: `Typed item goal was not accepted: the nearest ${name.replaceAll('_', ' ')} is ambiguous.` };
    }
    return {
        constraint: exactWorkstationArguments(
            name,
            ranked[0].position.x,
            ranked[0].position.y,
            ranked[0].position.z,
            agent.bot?.game?.dimension,
        ),
    };
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
            const holdGeneration = agent.holdPosition('operator stop command', {
                preserveDurableWork: true,
            });
            const stopOutcome = await agent.actions.stop({
                continueWhile: () => agent.isCurrentOperatorHold(holdGeneration),
            });
            if (stopOutcome.superseded) return null;
            agent.clearBotLogs();
            agent.actions.cancelResume();
            serverProxy.requestStatePush({ force: true, immediate: true, authoritative: true });
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
        name: '!spawnBots',
        description: 'Bring more bots into the world. Use this when the player asks for help, for another bot, for a partner, or for a whole team or squad. Use count 1 for a single helper and a larger count for a squad. The new bots copy this bot\'s profile and are named from the prefix. There is a short cooldown and a limit on how many bots may be live at once.',
        params: {
            'prefix': { type: 'string', description: 'Name stem for the new bots, 2-12 letters or numbers, starting with a letter. Members are numbered from it, so "Miner" gives Miner1, Miner2.' },
            'count': { type: 'int', description: 'How many bots to bring in. 1 for a single helper.', domain: [1, 8, '[]'] },
        },
        perform: async function (agent, prefix, count) {
            const stem = String(prefix || '').trim();
            if (!/^[A-Za-z][A-Za-z0-9_]{1,11}$/.test(stem)) {
                return `'${stem}' will not work as a name: use 2 to 12 letters or numbers starting with a letter.`;
            }
            const size = Math.max(1, Math.min(8, Math.floor(Number(count) || 1)));
            const response = await requestBotSpawn({
                prefix: stem,
                size,
                displayName: stem,
            });
            if (!response?.success) {
                return `I could not bring anyone in: ${String(response?.error || 'the control centre refused the request.').slice(0, 180)}`;
            }
            const members = response.squad?.members?.map(member => member.name).filter(Boolean) || [];
            return members.length
                ? `Bringing in ${members.join(', ')}. They take a few seconds to load in.`
                : `Bringing in ${size} bot(s) named from ${stem}. They take a few seconds to load in.`;
        },
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
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]},
            'dry_only': {type: 'boolean', description: 'Require a complete Pathfinder route that does not enter water.', optional: true, default: false},
        },
        perform: runAsAction(async (agent, player_name, closeness, dry_only = false) => {
            updateCompanionDirectiveFromAction(agent, null, player_name);
            return await skills.goToPlayer(agent.bot, player_name, closeness, {
                locatePlayerPosition: name => agent.locatePlayerPosition(name),
                dryOnly: dry_only === true,
            });
        }, false, -1, null, 'composed')
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            return await skills.followPlayer(agent.bot, player_name, follow_dist, {
                locatePlayerPosition: name => agent.locatePlayerPosition(name),
            });
        }, true, -1, (agent, player_name) => {
            updateCompanionDirectiveFromAction(agent, 'follow', player_name);
        }, 'composed', 'pathfinder')
    },
    {
        name: '!followPlayerUntilNearBlock',
        description: 'Follow a player until both the player and bot are settled near the same named world block, then yield for the next queued action.',
        params: {
            'player_name': { type: 'string', description: 'Name of the player to follow.' },
            'block_name': { type: 'BlockName', description: 'World block that marks the requested destination capability.' },
            'radius': { type: 'float', description: 'Maximum distance both companions may be from the block.', domain: [2, 32] },
        },
        perform: runAsAction(async (agent, player_name, block_name, radius) => {
            updateCompanionDirectiveFromAction(agent, 'follow', player_name);
            return await skills.followPlayerUntilNearBlock(
                agent.bot,
                player_name,
                block_name,
                radius,
                3,
            );
        })
    },
    {
        name: '!guardPlayer',
        description: 'Stay close to a player and keep the existing self-defense reflex enabled while following them.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to guard.'},
            'guard_dist': {type: 'float', description: 'distance to keep from the guarded player.', domain: [1, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, guard_dist) => {
            return await skills.followPlayer(agent.bot, player_name, guard_dist, {
                locatePlayerPosition: name => agent.locatePlayerPosition(name),
            });
        }, true, -1, (agent, player_name) => {
            updateCompanionDirectiveFromAction(agent, 'guard', player_name);
            agent.bot.modes.setOn('self_defense', true);
        }, 'composed')
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]},
            'dry_only': {type: 'boolean', description: 'Require a complete Pathfinder route that does not enter water.', optional: true, default: false},
        },
        perform: runAsAction(async (agent, x, y, z, closeness, dry_only = false) => {
            return await skills.goToPosition(agent.bot, x, y, z, closeness, {
                dryOnly: dry_only === true,
            });
        })
    },
    {
        name: '!guidePlayerToCoordinates',
        description: 'Lead a physically present player to exact coordinates, pausing when they fall behind and completing only when both arrive.',
        params: {
            'player_name': { type: 'string', description: 'Name of the player Kevin should guide.' },
            'x': { type: 'float', description: 'Destination x coordinate.', domain: [-Infinity, Infinity] },
            'y': { type: 'float', description: 'Destination y coordinate.', domain: [-64, 320] },
            'z': { type: 'float', description: 'Destination z coordinate.', domain: [-Infinity, Infinity] },
            'closeness': { type: 'float', description: 'Kevin destination distance.', domain: [0, Infinity] },
            'leash_distance': { type: 'float', description: 'Separation at which Kevin pauses for the player.', domain: [4, Infinity] },
        },
        perform: runAsAction(async (agent, player_name, x, y, z, closeness, leash_distance) => {
            return await skills.guidePlayerToPosition(
                agent.bot,
                player_name,
                x,
                y,
                z,
                closeness,
                leash_distance,
            );
        }, false, -1, null, 'composed', 'pathfinder'),
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
        }, false, -1, null, 'legacy', 'vehicle'),
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
        description: 'Reach a productive mining depth through an existing safe route or carve a bounded supported natural-stone staircase.',
        params: {
            'target_y': { type: 'int', description: 'Productive target Y level.', domain: [-60, 300, '[]'] },
            'search_range': { type: 'int', description: 'Maximum loaded cave search radius.', domain: [16, 128, '[]'] },
            'protected_route_cells': { type: 'int', description: 'Expected persisted return-route cell count.', domain: [0, 513, '[]'], optional: true },
        },
        perform: runAsAction(async (agent, target_y, search_range, protected_route_cells = null) => {
            return await skills.goToMiningDepth(agent.bot, target_y, search_range, {
                preservedReturnRoute: activeMiningReturnRoute(agent),
                expectedProtectedRouteCells: protected_route_cells,
            });
        }, false, 10)
    },
    {
        name: '!traverseMiningRouteCell',
        description: 'Return through a bounded segment of the exact previously cleared mining route using native Pathfinder with digging disabled.',
        params: {
            'x': { type: 'int', description: 'Preserved route-cell x coordinate.' },
            'y': { type: 'int', description: 'Preserved route-cell y coordinate.' },
            'z': { type: 'int', description: 'Preserved route-cell z coordinate.' },
        },
        perform: runAsAction(async (agent, x, y, z) => {
            const { route, index } = activeMiningReturnState(agent);
            const segmentEndIndex = route.findLastIndex((cell, candidateIndex) => (
                candidateIndex <= index
                && Math.floor(Number(cell?.x)) === Math.floor(Number(x))
                && Math.floor(Number(cell?.y)) === Math.floor(Number(y))
                && Math.floor(Number(cell?.z)) === Math.floor(Number(z))
            ));
            if (index >= 0 && segmentEndIndex >= 0) {
                return await skills.traverseMiningRouteSegment(
                    agent.bot,
                    route,
                    index,
                    segmentEndIndex,
                );
            }
            return await skills.traverseMiningRouteCell(agent.bot, x, y, z);
        }, false, RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!digTunnel',
        description: 'Dig a straight person-speed corridor by breaking the two blocks directly ahead and stepping in, no per-block pathfinding. Use this to strip-mine or cut a path fast. Stops safely at liquid, a drop, or anything a player built, and lights the corridor as it goes.',
        params: {
            'direction': { type: 'string', description: 'north, south, east, west, or forward (the way the bot faces).' },
            'length': { type: 'int', description: 'How many blocks to dig forward.', domain: [1, 64] },
        },
        perform: runAsAction(async (agent, direction, length) => {
            return await skills.digTunnel(agent.bot, direction, length);
        }, false, 10)
    },
    {
        name: '!mineSearchTunnel',
        description: 'Advance a bounded supported two-block mining route toward known ore or along the current search heading, breaking only safe natural fill.',
        params: {
            'resource_name': { type: 'BlockName', description: 'The ore or block being searched for.' },
            'length': { type: 'int', description: 'Maximum tunnel advance for this search leg.', domain: [4, 32] },
            'protected_route_cells': { type: 'int', description: 'Expected persisted return-route cell count.', domain: [0, 513], optional: true },
        },
        perform: runAsAction(async (agent, resource_name, length, protected_route_cells = null) => {
            return await skills.mineSearchTunnel(agent.bot, resource_name, length, null, {
                preservedReturnRoute: activeMiningReturnRoute(agent),
                expectedProtectedRouteCells: protected_route_cells,
                excludedTargets: collectionExclusionsForAgent(agent, resource_name),
            });
        }, false, RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!fillWaterBucket',
        description: 'Fill one carried empty bucket from a connected renewable non-farm water source and verify the inventory change.',
        params: {
            'range': { type: 'int', description: 'Maximum loaded-source search range.', domain: [16, 192] },
        },
        perform: runAsAction(async (agent, range) => {
            return await skills.fillWaterBucket(agent.bot, range);
        }, false, FLUID_MECHANIC_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!castObsidianSource',
        description: 'Use a carried water bucket at a safe loaded lava shore to cast, water-shield, harvest, and collect obsidian before recovering the water, or advance one bounded returnable lava-access corridor.',
        params: {
            'quantity': { type: 'int', description: 'Requested number of obsidian source blocks.', domain: [1, 16] },
            'protected_route_cells': { type: 'int', description: 'Expected persisted return-route cell count.', domain: [0, 513], optional: true },
        },
        perform: runAsAction(async (agent, quantity, protected_route_cells = null) => {
            return await skills.castObsidianSource(agent.bot, quantity, {
                preservedReturnRoute: activeMiningReturnRoute(agent),
                expectedProtectedRouteCells: protected_route_cells,
            });
        }, false, FLUID_MECHANIC_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!lightCaveAt',
        description: 'Reach one exact catalogue-selected cave stance using native Pathfinder and verify the area is lit.',
        params: {
            'x': { type: 'int', description: 'Bound cave stance x coordinate.' },
            'y': { type: 'int', description: 'Bound cave stance y coordinate.' },
            'z': { type: 'int', description: 'Bound cave stance z coordinate.' },
        },
        perform: runAsAction(async (agent, x, y, z) => {
            return await skills.lightCaveAt(agent.bot, x, y, z);
        }, false, RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!collectExposedOreAt',
        description: 'Collect one exact catalogue-selected exposed ore block and settle on its bound home-returnable stance without route excavation.',
        params: {
            'block_name': { type: 'BlockName', description: 'Exact exposed ore block name.' },
            'x': { type: 'int', description: 'Bound ore x coordinate.' },
            'y': { type: 'int', description: 'Bound ore y coordinate.' },
            'z': { type: 'int', description: 'Bound ore z coordinate.' },
            'return_x': { type: 'int', description: 'Bound home-returnable stance x coordinate.' },
            'return_y': { type: 'int', description: 'Bound home-returnable stance y coordinate.' },
            'return_z': { type: 'int', description: 'Bound home-returnable stance z coordinate.' },
        },
        perform: runAsAction(async (agent, block_name, x, y, z, return_x, return_y, return_z) => {
            return await skills.collectExposedOreAt(
                agent.bot,
                block_name,
                x,
                y,
                z,
                return_x,
                return_y,
                return_z,
            );
        }, false, RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES)
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
        description: 'Move away from the current location. When group_requester is supplied, also increase spacing from that exact requester and every nearby loaded human player. Deterministic recovery may require a verified different loaded region after local relocation fails.',
        params: {
            'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] },
            'meaningful_region': { type: 'boolean', description: 'Bind a physically distinct safe loaded region instead of another local displacement.', optional: true, default: false },
            'group_requester': { type: 'string', description: 'Optional exact player who asked the bot to give the nearby human group room.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, distance, meaningful_region = false, group_requester = '') => {
            return await skills.moveAway(agent.bot, distance, {
                meaningfulRegion: meaningful_region === true,
                groupRequester: String(group_requester || ''),
                knownBotNames: agent.getKnownAgentNames?.() || convoManager.getInGameAgents(),
                isBotIdentity: identity => convoManager.isOtherAgent(identity),
            });
        }, false, RESPONSIVE_COLLECTION_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: function (agent, name) {
            const pos = agent.bot?.entity?.position;
            const dimension = canonicalDimension(agent.bot?.game?.dimension);
            if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite) || !dimension) {
                return `I could not save "${name}" because my current location is not available.`;
            }
            const saved = agent.memory_bank.rememberUserPlace(
                name,
                pos.x,
                pos.y,
                pos.z,
                dimension,
            );
            return saved
                ? `Location saved as "${name}" in ${dimension}.`
                : `I could not save "${name}" as a named place.`;
        }
    },
    {
        name: '!forgetRememberedPlace',
        description: 'Forget a player-named saved location.',
        params: {'name': { type: 'string', description: 'The name of the saved location to forget.' }},
        perform: function (agent, name) {
            return agent.memory_bank.forgetUserPlace(name)
                ? `Forgot the saved place "${name}".`
                : `I do not have a player-named place called "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const place = agent.memory_bank.recallUserPlaceDetails(name);
            if (!place) {
                skills.log(agent.bot, `No location named "${name}" saved.`);
                return false;
            }
            const savedDimension = canonicalDimension(place.dimension);
            const currentDimension = canonicalDimension(agent.bot?.game?.dimension);
            if (!savedDimension || !currentDimension) {
                skills.log(agent.bot, `I cannot safely navigate to "${name}" because its dimension is unknown.`);
                return false;
            }
            if (savedDimension !== currentDimension) {
                skills.log(
                    agent.bot,
                    `"${name}" is in ${savedDimension}, but I am in ${currentDimension}. I will not walk to the same coordinates in the wrong dimension.`,
                );
                return false;
            }
            return await skills.goToPosition(agent.bot, place.x, place.y, place.z, 1);
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
        description: 'Return to the newest pending death site in the same dimension, collect its recorded dropped inventory, and verify the recovered item counts. Internal callers may bind one exact persisted death identity.',
        params: {
            'recorded_at': { type: 'int', description: 'Optional exact persisted death identity; omitted player and Agenda commands prioritize the newest time-sensitive death.', domain: [1, Number.MAX_SAFE_INTEGER, '[]'], optional: true },
        },
        perform: runAsAction(async (agent, recorded_at = null) => {
            const requestedIdentity = Number(recorded_at);
            const hasExactIdentity = Number.isSafeInteger(requestedIdentity) && requestedIdentity > 0;
            const death = hasExactIdentity
                ? agent.memory_bank.recallDeath(requestedIdentity)
                : agent.memory_bank.recallLatestDeath();
            const recovered = await skills.recoverDeathItems(agent.bot, death);
            if (recovered) {
                agent.memory_bank.markDeathRecovered(
                    agent.bot.lastActionEvidence,
                    death?.recordedAt || requestedIdentity,
                );
            }
            return recovered;
        }, false, 10)
    },
    {
        name: '!givePlayer',
        description: 'Perform the terminal atomic handoff for an already-owned goal or agenda activity. For a player-requested acquisition or delivery outcome, select !requestItemGoal instead so the whole promise remains resumable and verified.',
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
            'family': { type: 'string', description: 'Supported family: logs, planks, food, raw_fish, cooked_fish, ores, or building_blocks.' },
            'player_name': { type: 'string', description: 'The player who should receive the items.' },
            'num': { type: 'int', description: 'Maximum total family items to deliver.', domain: [1, 2304] },
            'baseline_manifest': { type: 'string', description: 'Optional machine-generated item:count baseline; only carried family output above it is delivered.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, family, player_name, num, baseline_manifest = '') => {
            return await skills.giveFamilyToPlayer(agent.bot, family, player_name, num, baseline_manifest);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item, select the best safe carried food, or select a verified drinkable healing potion by semantic identity.',
        params: {'item_name': { type: 'ConsumableName', description: 'A Minecraft item name or the semantic selector best_food or healing_potion.' }},
        perform: runAsAction(async (agent, item_name) => {
            return await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item and verify it in its natural or explicitly requested hand.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to equip.' },
            'destination': { type: 'string', description: 'Optional equipment destination: main_hand or off_hand.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, item_name, destination = '') => {
            return await skills.equip(agent.bot, item_name, destination || null);
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
        }, false, -1, null, 'legacy', 'container')
    },
    {
        name: '!putInChestAt',
        description: 'Navigate to the exact assigned chest or barrel, load and validate it, then verify the inventory transfer.',
        params: {
            'item_name': { type: 'ItemName', description: 'The item to deposit.' },
            'num': { type: 'int', description: 'The number of items to deposit.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
            'dimension': { type: 'string', description: 'Optional assigned dimension; a mismatch is rejected before opening a container.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, item_name, num, x, y, z, dimension = '') => {
            return await skills.putInChestAt(agent.bot, item_name, num, x, y, z, dimension);
        }, false, -1, null, 'legacy', 'container')
    },
    {
        name: '!storeInventoryPlanAt',
        description: 'Execute one validated retained-inventory storage plan through a single exact chest or barrel session. Stackable items use native Mineflayer transfer; durable duplicates preserve the best requested copies.',
        params: {
            'encoded_plan': { type: 'string', description: 'Canonical_item:retain_quantity entries separated by |.' },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
            'dimension': { type: 'string', description: 'Assigned dimension.' },
        },
        perform: runAsAction(async (agent, encodedPlan, x, y, z, dimension = '') => {
            return await skills.storeInventoryPlanAt(agent.bot, encodedPlan, x, y, z, dimension);
        }, false, -1, null, 'legacy', 'container'),
    },
    {
        name: '!putFamilyInChestAt',
        description: 'Deposit a verified total across every carried item type in a useful family into the exact assigned chest or barrel.',
        params: {
            'family': { type: 'string', description: 'Supported family: logs, planks, food, ores, or building_blocks.' },
            'num': { type: 'int', description: 'Maximum total family items to deposit.', domain: [1, 2304, '[]'] },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
            'dimension': { type: 'string', description: 'Optional assigned dimension; a mismatch is rejected before opening a container.', optional: true, default: '' },
            'baseline_manifest': { type: 'string', description: 'Optional machine-generated item:count baseline; only carried family output above it is deposited.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, family, num, x, y, z, dimension = '', baseline_manifest = '') => {
            return await skills.putFamilyInChestAt(
                agent.bot,
                family,
                num,
                x,
                y,
                z,
                dimension,
                baseline_manifest,
            );
        }, false, -1, null, 'legacy', 'container')
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
        }, false, -1, null, 'legacy', 'container')
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
        }, false, -1, null, 'legacy', 'container')
    },
    {
        name: '!takeFromChestAt',
        description: 'Navigate to one exact assigned chest or barrel and withdraw a verified quantity from that container only.',
        params: {
            'item_name': { type: 'ItemName', description: 'The item to withdraw.' },
            'num': { type: 'int', description: 'The number of items to withdraw.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
            'dimension': { type: 'string', description: 'Optional assigned dimension; a mismatch is rejected before opening a container.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, item_name, num, x, y, z, dimension = '') => {
            const currentDimension = canonicalDimension(agent.bot?.game?.dimension);
            const assignedDimension = canonicalDimension(dimension);
            if (assignedDimension && assignedDimension !== currentDimension) {
                skills.log(agent.bot, `The assigned withdrawal is in ${assignedDimension}, not ${currentDimension || 'the current dimension'}.`);
                return false;
            }
            return await skills.takeFromChest(agent.bot, item_name, num, { x, y, z });
        }, false, -1, null, 'legacy', 'container')
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            return await skills.viewChest(agent.bot);
        }, false, -1, null, 'legacy', 'container')
    },
    {
        name: '!viewChestAt',
        description: 'Open and report the contents of one exact assigned chest or barrel without changing its inventory.',
        params: {
            'x': { type: 'float', description: 'Assigned container x coordinate.' },
            'y': { type: 'float', description: 'Assigned container y coordinate.' },
            'z': { type: 'float', description: 'Assigned container z coordinate.' },
            'dimension': { type: 'string', description: 'Assigned dimension.' },
        },
        perform: runAsAction(async (agent, x, y, z, dimension) => {
            return await skills.viewChest(agent.bot, { x, y, z, dimension });
        }, false, -1, null, 'legacy', 'container')
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
        name: '!releaseInventoryWorkingSlots',
        description: 'Free bounded working inventory slots while preserving every named job material, essential gear, food, and useful reserves. Does not place temporary debris.',
        params: {
            'protected_items': { type: 'string', description: 'Comma-separated canonical item names that the current durable job still needs.' },
            'reserve_slots': { type: 'int', description: 'Free working slots required before the job resumes.', domain: [1, 12] },
        },
        perform: runAsAction(async (agent, protected_items, reserve_slots) => {
            return await skills.releaseInventoryWorkingSlots(agent.bot, protected_items, reserve_slots);
        }),
    },
    {
        name: '!collectBlocks',
        description: 'Collect blocks of a given type, safely relocating and rescanning when the current area has no reachable source.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            return await skills.collectBlock(
                agent.bot,
                type,
                num,
                collectionExclusionsForAgent(agent, type),
                64,
                {
                    relocate: true,
                    preferredPosition: agent.goal_director?.collectionPreferredTarget?.(type),
                },
            );
        }, false, RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES, null, 'legacy', 'collectblock')
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
        name: '!pickupItem',
        description: 'Pick up an exact nearby dropped item and verify the requested inventory increase.',
        params: {
            'item_name': { type: 'ItemName', description: 'Exact canonical dropped item name.' },
            'quantity': { type: 'int', description: 'Required inventory increase.', domain: [1, 64] },
            'range': { type: 'int', description: 'Maximum pickup radius.', domain: [4, 32] },
            'baseline_inventory': { type: 'int', description: 'Inventory count observed when the player request was accepted.', domain: [0, 2304] },
        },
        perform: runAsAction(async (agent, item_name, quantity, range, baseline_inventory) => {
            return await skills.pickupItem(agent.bot, item_name, quantity, range, baseline_inventory);
        })
    },
    {
        name: '!harvestMatureCrop',
        description: 'Harvest only mature crops of one canonical type, collect the requested net output, and replant every exact farmland cell before completion.',
        params: {
            'crop': { type: 'BlockName', description: 'Exact mature crop block: wheat, carrots, potatoes, or beetroots.' },
            'output': { type: 'ItemName', description: 'Expected crop output item.' },
            'num': { type: 'int', description: 'Required net inventory increase after replanting.', domain: [1, 64] },
            'range': { type: 'int', description: 'Maximum source radius.', domain: [16, 512] },
        },
        perform: runAsAction(async (agent, crop, output, num, range) => {
            return await skills.harvestMatureCrop(agent.bot, crop, output, num, range);
        }, false, RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES),
    },
    {
        name: '!collectBlocksInRange',
        description: 'Collect a bounded number of exact target blocks using an explicit scan radius and optional bounded relocation.',
        params: {
            'type': { type: 'BlockName', description: 'The exact block type to collect.' },
            'num': { type: 'int', description: 'Maximum number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'range': { type: 'int', description: 'Maximum search radius.', domain: [16, 512] },
            'relocate': { type: 'boolean', description: 'Allow bounded movement to new search areas when the current scan is empty.', optional: true, default: false },
            'complete_started_tree': { type: 'boolean', description: 'Finish the bounded connected natural tree once harvesting starts.', optional: true, default: true },
        },
        perform: runAsAction((agent, type, num, range, relocate = false, complete_started_tree = true) => (
            runCollectionAction(agent, async () => {
                if (skills.isWoodBlockType(type)) {
                    return await skills.collectWood(
                        agent.bot,
                        num,
                        range,
                        collectionExclusionsForAgent(agent, type),
                        {
                            relocate: relocate === true,
                            woodType: type,
                            completeStartedTree: complete_started_tree === true,
                        },
                    );
                }
                return await skills.collectBlock(
                    agent.bot,
                    type,
                    num,
                    collectionExclusionsForAgent(agent, type),
                    range,
                    {
                        relocate: relocate === true,
                        preferredPosition: agent.goal_director?.collectionPreferredTarget?.(type),
                        preservedReturnRoute: activeMiningReturnRoute(agent),
                    },
                );
            })
        ), false, (_agent, type, num, _range, _relocate = false, complete_started_tree = true) => (
            skills.isWoodBlockType(type)
                ? woodCollectionActionTimeoutMinutes(num, complete_started_tree)
                : RESOURCE_COLLECTION_ACTION_TIMEOUT_MINUTES
        ), null, 'composed')
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
            return await skills.prepareMaterial(
                agent.bot,
                material_name,
                num,
                range,
                collectionExclusionsForAgent(agent),
            );
        }, false, RESPONSIVE_COLLECTION_ACTION_TIMEOUT_MINUTES)
    },
    {
        name: '!prepareFood',
        description: 'Secure a safe food reserve by crafting carried ingredients, harvesting and replanting mature crops, cooking raw food, and sustainably hunting adult animals when needed.',
        params: {
            'target_food_points': { type: 'int', description: 'Safe carried food points to secure; one point requests a bounded immediately edible emergency supply.', domain: [1, 160, '[]'] },
            'range': { type: 'int', description: 'Maximum crop, animal, and resource search radius.', domain: [16, 128, '[]'] },
            'workstation_x': { type: 'float', description: 'Optional exact furnace X coordinate.', optional: true },
            'workstation_y': { type: 'float', description: 'Optional exact furnace Y coordinate.', optional: true },
            'workstation_z': { type: 'float', description: 'Optional exact furnace Z coordinate.', optional: true },
            'workstation_dimension': { type: 'string', description: 'Optional exact furnace dimension.', optional: true },
            'baseline_food_points': { type: 'int', description: 'Optional durable starting food points; when supplied, prepare the requested amount above this fixed baseline.', domain: [0, 2304, '[]'], optional: true },
        },
        perform: runAsAction(async (agent, target_food_points, range, x, y, z, dimension, baseline_food_points) => {
            return await skills.prepareFood(
                agent.bot,
                target_food_points,
                range,
                workstationArgumentsForAction(agent, 'furnace', x, y, z, dimension),
                baseline_food_points,
            );
        }, false, 10)
    },
    {
        name: '!prepareTool',
        description: 'Survival-bootstrap and equip a durable wooden, stone, iron, or diamond pickaxe, axe, shovel, hoe, or sword, replacing worn tools before they break.',
        params: {
            'tool_name': { type: 'ItemName', description: 'Supported tool such as stone_pickaxe, iron_pickaxe, diamond_pickaxe, or an axe of the same tiers.' }
        },
        perform: runAsAction(async (agent, tool_name) => {
            return await skills.prepareTool(agent.bot, tool_name, collectionExclusionsForAgent(agent));
        }, false, 10)
    },
    {
        name: '!prepareWoodenTool',
        description: 'Compatibility command for survival-bootstrapping a supported wooden job tool.',
        params: {
            'tool_name': { type: 'ItemName', description: 'Supported tool: wooden_pickaxe or wooden_axe.' }
        },
        perform: runAsAction(async (agent, tool_name) => {
            return await skills.prepareWoodenTool(
                agent.bot,
                tool_name,
                collectionExclusionsForAgent(agent),
            );
        }, false, 10)
    },
    {
        name: '!collectWood',
        description: 'Find trees of any wood type, safely relocating and rescanning when the current area has no reachable trunk.',
        params: {
            'num': { type: 'int', description: 'The number of logs to collect.', domain: [1, 64, '[]'] }
        },
        perform: runAsAction((agent, num) => (
            runCollectionAction(agent, () => skills.collectWood(
                agent.bot,
                num,
                64,
                collectionExclusionsForAgent(agent),
                { relocate: true, completeStartedTree: true },
            ))
        ), false, (_agent, num) => woodCollectionActionTimeoutMinutes(num, true), null, 'composed')
    },
    {
        name: '!collectWoodInRange',
        description: 'Collect at least a bounded number of safe reachable logs, finishing every bounded connected natural tree that harvesting starts.',
        params: {
            'num': { type: 'int', description: 'Minimum log target; completing the final bounded tree may carry additional logs.', domain: [1, 64, '[]'] },
            'range': { type: 'int', description: 'Maximum search radius.', domain: [16, 512] },
            'relocate': { type: 'boolean', description: 'Allow bounded movement to new search areas when the current scan is empty.', optional: true, default: false },
            'complete_started_tree': { type: 'boolean', description: 'Finish the bounded connected natural tree once harvesting starts.', optional: true, default: true },
        },
        perform: runAsAction((agent, num, range, relocate = false, complete_started_tree = true) => (
            runCollectionAction(agent, () => skills.collectWood(
                agent.bot,
                num,
                range,
                collectionExclusionsForAgent(agent),
                {
                    relocate: relocate === true,
                    completeStartedTree: complete_started_tree === true,
                },
            ))
        ), false, (_agent, num, _range, _relocate = false, complete_started_tree = true) => (
            woodCollectionActionTimeoutMinutes(num, complete_started_tree)
        ), null, 'composed')
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times, automatically resolving a usable nearby crafting table. Model-selected actions must omit exact workstation coordinates.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'workstation_x': { type: 'float', description: 'Optional deterministically verified exact crafting table X coordinate; never guess.', optional: true },
            'workstation_y': { type: 'float', description: 'Optional deterministically verified exact crafting table Y coordinate; never guess.', optional: true },
            'workstation_z': { type: 'float', description: 'Optional deterministically verified exact crafting table Z coordinate; never guess.', optional: true },
            'workstation_dimension': { type: 'string', description: 'Optional deterministically verified exact crafting table dimension; never guess.', optional: true },
        },
        perform: runAsAction(async (agent, recipe_name, num, x, y, z, dimension) => {
            return await runWorkstationAction(agent, 'craft', () => skills.craftRecipe(
                agent.bot,
                recipe_name,
                num,
                workstationArgumentsForAction(agent, 'crafting_table', x, y, z, dimension),
            ));
        }, false, -1, null, 'composed', 'craft')
    },
    {
        name: '!requestItemGoal',
        description: 'Start one typed, resumable physical goal that acquires an exact quantity, equips one item in a requested hand, or delivers it to a canonical player. All subgoals use existing deterministic commands and overall completion is verified from Minecraft state.',
        params: {
            'kind': { type: 'string', description: 'Goal kind: acquire or deliver.' },
            'target': { type: 'string', description: 'Canonical item/block name or supported family: logs or planks.' },
            'quantity': { type: 'int', description: 'Exact requested quantity.', domain: [1, 2304, '[]'] },
            'requester_or_recipient': { type: 'string', description: 'Canonical requesting player name. For deliver goals this is also the recipient.' },
            'completion': { type: 'string', description: 'Optional completion requirement: inventory, main_hand, or off_hand. Delivery goals always verify delivery.', optional: true, default: 'inventory' },
            'workstation_name': { type: 'string', description: 'Optional explicit workstation named by the player: furnace or crafting_table.', optional: true, default: '' },
            'original_request': { type: 'string', description: 'Optional original natural-language request retained for durable intent.', optional: true, default: '' },
        },
        perform: persistentGoalCommand(function (agent, kind, targetName, quantity, requesterOrRecipient, completion = 'inventory', workstationName = '', originalRequest = '') {
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
            const completionKind = normalizedKind === 'deliver'
                ? 'delivery'
                : String(completion || 'inventory').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (
                normalizedKind === 'acquire'
                && !['inventory', 'main_hand', 'off_hand'].includes(completionKind)
            ) {
                return 'Typed item goal was not accepted: completion must be inventory, main_hand, or off_hand.';
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
            const workstationResolution = resolveExplicitWorkstation(agent, resolution, workstationName);
            if (workstationResolution.error) return workstationResolution.error;
            const baselineInventory = inventoryCountForGoalTarget(agent.bot, target);
            const goal = createItemGoalContract({
                kind: normalizedKind,
                requester: canonicalRequester,
                target,
                quantity,
                destinationPlayer: normalizedKind === 'deliver' ? canonicalRequester : null,
                request: String(originalRequest || '').trim() || (normalizedKind === 'deliver'
                    ? `deliver ${quantity} ${target.requestedName} to ${canonicalRequester}`
                    : `acquire ${quantity} ${target.requestedName}`),
                source: 'player',
                baselineInventory,
                completion: completionKind,
                workstationConstraint: workstationResolution.constraint,
            });
            const accepted = agent.goal_director?.submit?.(goal);
            const request = agent.actions?.currentRequestContext?.() || null;
            const previousGeneration = Number(agent.last_persistent_goal_submission?.generation) || 0;
            const submissionReceipt = Object.freeze({
                submissionKind: 'goal_submission',
                generation: previousGeneration + 1,
                requestId: request?.requestId || null,
                selectedSkill: request?.selectedSkill || null,
                routeOrigin: request?.routeOrigin || null,
                missionId: request?.missionId || null,
                activityId: request?.activityId || null,
                submittedGoalId: goal.id,
                activeGoalId: agent.goal_director?.activeGoal?.id || null,
                accepted: accepted?.accepted === true,
                code: accepted?.code || (accepted?.accepted === true ? 'goal_accepted' : 'goal_rejected'),
            });
            agent.last_persistent_goal_submission = submissionReceipt;
            agent.actions?.recordDurableSubmissionReceipt?.(submissionReceipt);
            if (!accepted?.accepted) {
                return `Typed item goal was not accepted: ${accepted?.detail || accepted?.code || 'goal director unavailable'}.`;
            }
            const reused = accepted.procedureId
                ? ` Reusing proven procedure ${accepted.procedureId}.`
                : '';
            const completionText = goal.kind === 'deliver'
                ? ` to ${goal.destination.player}`
                : goal.completion.kind === 'inventory'
                    ? ''
                    : ` and verify ${goal.completion.kind.replace('_', ' ')}`;
            return `Accepted typed goal ${accepted.id}: ${goal.kind} ${goal.quantity} ${goal.target.family || goal.target.canonicalName}${completionText}.${reused}`;
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
            'quota': { type: 'int', description: 'Number of new logs to gather after this order is accepted; pre-existing carried logs do not count.', domain: [1, 2304, '[]'] },
            'requester': { type: 'string', description: 'Exact canonical player who requested the harvest.', optional: true, default: '' },
        },
        perform: persistentJobCommand(async function (agent, log, quota, requester = '') {
            try {
                const targetName = String(log || '').trim().toLowerCase();
                const companion = agent.companion_context?.snapshot?.() || {};
                const boundRequester = String(
                    requester
                    || companion.canonicalUsername
                    || companion.requestedName
                    || 'player',
                ).trim();
                const baselineInventory = logInventoryCount(
                    agent.bot?.inventory?.items?.() || [],
                    targetName,
                );
                const order = createWorkOrder({
                    role: 'lumberjack',
                    kind: 'harvest',
                    source: 'player',
                    requester: boundRequester,
                    target: { name: targetName },
                    quota,
                    checkpoint: {
                        baselineInventory,
                        targetInventory: baselineInventory + quota,
                    },
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
                if (!block || !item || !isApprovedPrimaryConstructionMaterial(material)) {
                    return `Functional shelter work order was not accepted: ${material || 'the requested material'} is not an approved primary construction material. Use dirt, stone, cobblestone, or planks.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Functional shelter work order was not accepted: Minecraft spawn state is unavailable.';
                const provisional = createBuilderFunctionalShelterOrder({
                    x: 0,
                    y: 0,
                    z: 0,
                    material,
                    requester: 'player',
                });
                const order = bindSafeConstructionOrder(agent, provisional, position);
                return submitRememberedStructure(agent, order);
            } catch (error) {
                return `Functional shelter work order was not accepted: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!repairAccess',
        description: 'Repair the exact unsupported surface gap leading to the nearest loaded existing doorway. This preserves the existing door/building and delegates the bounded placements to Builder.',
        params: {
            'material': { type: 'BlockName', description: 'Carried full support block authorized for the exact gap cells.' },
        },
        perform: persistentJobCommand(function (agent, material) {
            try {
                const selected = selectExistingAccessRepair(
                    agent.bot,
                    `repair the gap at the existing door using ${String(material || '')}`,
                    agent.bot?.entity?.position,
                );
                if (!selected || selected.rejection) {
                    return `Access repair was not accepted: ${selected?.rejection || 'no loaded existing access gap was selected'}`;
                }
                const order = createAccessRepairWorkOrder({
                    kind: 'repair_access',
                    requester: 'player',
                    target: selected.material,
                    quantity: selected.constraint.cells.length,
                    accessRepairConstraint: selected.constraint,
                });
                return submitRememberedStructure(agent, order);
            } catch (error) {
                return `Access repair work order is invalid: ${String(error?.message || error).slice(0, 180)}.`;
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
                if (!block || !item || !isApprovedPrimaryConstructionMaterial(canonicalMaterial)) {
                    return `Construction work order was not accepted: ${canonicalMaterial || 'the requested material'} is not an approved primary construction material. Use dirt, stone, cobblestone, or planks.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Construction work order was not accepted: Minecraft spawn state is unavailable.';
                const provisional = createBuilderConstructionOrder({
                    x: 0,
                    y: 0,
                    z: 0,
                    shape,
                    width,
                    depth,
                    height,
                    material: canonicalMaterial,
                    requester: 'player',
                });
                const order = bindSafeConstructionOrder(agent, provisional, position);
                return submitRememberedStructure(agent, order);
            } catch (error) {
                return `Construction work order was not accepted: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!buildStructure',
        description: `Build one complete named building beside the bot. Use material auto unless the player named a material; Builder binds an approved feasible primary material and separately binds fixtures such as fences, gates, doors, and glass. Known structures: ${describeStructureCatalog()}`,
        params: {
            'structure': { type: 'string', description: `Structure to build: ${STRUCTURE_NAMES.join(', ')}.` },
            'material': { type: 'string', description: 'Use auto unless the player named dirt, stone, cobblestone, or a canonical *_planks primary material. Fixtures are chosen by the structure.' },
        },
        perform: persistentJobCommand(function (agent, structure, material) {
            try {
                const requestedMaterial = String(material || '').trim().toLowerCase();
                const canonicalMaterial = requestedMaterial === 'auto' ? 'oak_planks' : requestedMaterial;
                const block = agent.bot?.registry?.blocksByName?.[canonicalMaterial];
                const item = agent.bot?.registry?.itemsByName?.[canonicalMaterial];
                if (!block || !item || !isApprovedPrimaryConstructionMaterial(canonicalMaterial)) {
                    return `Structure work order was not accepted: ${canonicalMaterial || 'the requested material'} is not an approved primary construction material. Use auto, dirt, stone, cobblestone, or planks.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Structure work order was not accepted: Minecraft spawn state is unavailable.';
                const provisional = createStructureOrder({
                    name: structure,
                    x: 0,
                    y: 0,
                    z: 0,
                    material: canonicalMaterial,
                    requester: 'player',
                });
                const order = bindSafeConstructionOrder(agent, provisional, position);
                return submitRememberedStructure(agent, order, {
                    structuralMaterialAlternatives: requestedMaterial === 'auto',
                });
            } catch (error) {
                return `Structure work order was not accepted: ${String(error?.message || error).slice(0, 180)}.`;
            }
        }),
    },
    {
        name: '!designStructure',
        description: `Compile and persist one complete bounded multi-block arrangement that is NOT in the known list - a spiral tower, a bridge with railings, a machine layout, a track, or anything else a player describes. Call this BEFORE gathering or placing anything: the Builder derives and acquires every blueprint material through the shared prerequisite planner, then places and verifies the supported cells. Write the shape yourself as design data; never micromanage its materials or individual placements. ${designLanguageHelp()}`,
        compactDescription: 'Persist a validated blueprint before gathering. DESIGN MUST BE THIS DSL, NEVER PROSE. Separate steps with ;. Templates: @tower W H; @hut W D; @wall L H; @bridge L; @platform W D; @pen W D; @pillar H; @stairs H; @room W D H. @pen supplies containment/access and a floor-center support. Ops: box|shell|room X Y Z W H D [M]; slab|ring X Y Z W D [M]; line X1 Y1 Z1 X2 Y2 Z2 [M]; block X Y Z MATERIAL; roof X Y Z W D flat|gable|pyramid [M]; carve X Y Z W H D; put X Y Z door|glass|torch|chest|ladder|fence|gate|crafting|furnace|bed [FACING]; put X Y Z EXACT_STAIRS FACING. Fixtures MUST use put, never block or bracketed states. Coordinates are relative, 0..31; translate symmetric layouts so every coordinate is nonnegative. SUPPORT: a room floor at y=0 supports fixtures at y=1; a ground stair at y=0 uses natural terrain. A torch may stand above a solid floor or attach beside a same-height solid wall; a ladder requires a wall. A bed occupies its anchor plus one block in its facing direction; keep both supported and clear. A door occupies its anchor plus the block above. Use material "auto" and lock_material false unless the player named it.',
        params: {
            'name': { type: 'string', description: 'Short name for the building, such as watchtower or barn.' },
            'material': { type: 'string', description: 'Use auto unless the player named a material; otherwise use one canonical full support block. Fixtures are chosen automatically.' },
            'design': { type: 'string', description: 'The design steps, separated by semicolons. No commas or quotes inside.' },
            'lock_material': { type: 'boolean', description: 'True only when the player explicitly named this structural material; otherwise Builder may bind a cheaper feasible safe material.', optional: true, default: false },
        },
        perform: persistentJobCommand(function (agent, name, material, design, lock_material = false) {
            try {
                const requestedMaterial = String(material || '').trim().toLowerCase();
                if (requestedMaterial === 'auto' && lock_material === true) {
                    return 'Design was not accepted: auto cannot be locked; pass false or name the player-requested structural block.';
                }
                // `auto` is only provisional design data. The existing
                // structural-family binder replaces this universally present
                // support block with the cheapest feasible local material
                // before the durable order is accepted.
                const canonicalMaterial = requestedMaterial === 'auto'
                    ? 'oak_planks'
                    : requestedMaterial;
                const block = agent.bot?.registry?.blocksByName?.[canonicalMaterial];
                const item = agent.bot?.registry?.itemsByName?.[canonicalMaterial];
                if (!block || !item || !isApprovedPrimaryConstructionMaterial(canonicalMaterial)) {
                    return `Design was not accepted: ${canonicalMaterial || 'the requested material'} is not an approved primary construction material. Use auto, dirt, stone, cobblestone, or planks.`;
                }
                const position = agent.bot?.entity?.position;
                if (!position) return 'Design was not accepted: Minecraft spawn state is unavailable.';
                const provisional = createDesignedStructureOrder({
                    design,
                    name,
                    x: 0,
                    y: 0,
                    z: 0,
                    material: canonicalMaterial,
                    requester: 'player',
                    canSupportMaterial: name => blockCanSupportPlacement(agent.bot?.registry, name),
                });
                const order = bindSafeConstructionOrder(agent, provisional, position);
                return submitRememberedStructure(agent, order, {
                    structuralMaterialAlternatives: lock_material !== true,
                });
            } catch (error) {
                // The design language reports the exact step or the exact block
                // that cannot stand, which is what lets a rejected design be
                // corrected instead of guessed at again.
                return `Design was not accepted: ${String(error?.message || error).slice(0, 220)} Use the exact !designStructure DSL shown in the command contract; descriptive prose is not design data.`;
            }
        }),
    },
    {
        name: '!resumeLastJob',
        description: 'Revalidate and resume the exact last failed or completed persistent work order after its blocker was repaired or its completed world outcome changed. Preserves verified checkpoints; do not use as an unchanged blind retry.',
        params: {},
        perform: persistentJobCommand(function (agent) {
            const result = agent.job_director?.resumeLastOrder?.();
            if (result?.accepted !== true) {
                return `Terminal work was not resumed: ${result?.code || 'job director unavailable'}.`;
            }
            return `Revalidating work order ${result.id}; current Minecraft state will be audited before execution.`;
        }),
    },
    {
        name: '!resumeStructureJob',
        description: 'Resume the last explicitly authorized construction blueprint at its original bound site. The Builder re-audits Minecraft and continues only the cells that are still missing.',
        params: {},
        perform: persistentJobCommand(function (agent) {
            const order = agent.home_state?.snapshot?.().structureOrder;
            if (!order) return 'Construction was not resumed: there is no remembered structure blueprint.';
            return submitRememberedStructure(agent, resumeFailedWorkOrder(order), {
                resumeAgenda: true,
            });
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
                    recoveries: 0,
                    preemptions: 0,
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
        name: '!goToFarm',
        description: 'Use native Pathfinder to reach a verified service stance beside the remembered farm.',
        params: {},
        perform: runAsAction(async function (agent) {
            const farm = agent.home_state?.snapshot?.().farm;
            if (!farm) {
                skills.log(agent.bot, 'No durable farm is remembered. Establish one first.');
                return false;
            }
            return await skills.approachRememberedFarm(agent.bot, farm);
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
        name: '!settleLivestockAtPen',
        description: 'Lure verified adult livestock from a remembered source into one exact fence enclosure, breed the requested pairs, exit, close the gate, and verify the final animal count.',
        params: {
            'animal': { type: 'string', description: 'Animal: cow, sheep, pig, chicken, or rabbit.' },
            'adult_count': { type: 'int', description: 'Adults to relocate, 2-8.', domain: [2, 8, '[]'] },
            'breeding_pairs': { type: 'int', description: 'Pairs to breed, 1-4.', domain: [1, 4, '[]'] },
            'source_x': { type: 'int', description: 'Verified remembered source X.' },
            'source_y': { type: 'int', description: 'Verified remembered source Y.' },
            'source_z': { type: 'int', description: 'Verified remembered source Z.' },
            'gate_x': { type: 'int', description: 'Exact pen gate X.' },
            'gate_y': { type: 'int', description: 'Exact pen gate Y.' },
            'gate_z': { type: 'int', description: 'Exact pen gate Z.' },
            'inside_x': { type: 'int', description: 'Exact safe interior X.' },
            'inside_y': { type: 'int', description: 'Exact safe interior Y.' },
            'inside_z': { type: 'int', description: 'Exact safe interior Z.' },
            'outside_x': { type: 'int', description: 'Exact safe exterior X.' },
            'outside_y': { type: 'int', description: 'Exact safe exterior Y.' },
            'outside_z': { type: 'int', description: 'Exact safe exterior Z.' },
            'min_x': { type: 'int', description: 'Pen minimum X boundary.' },
            'max_x': { type: 'int', description: 'Pen maximum X boundary.' },
            'min_z': { type: 'int', description: 'Pen minimum Z boundary.' },
            'max_z': { type: 'int', description: 'Pen maximum Z boundary.' },
            'pen_y': { type: 'int', description: 'Pen boundary Y.' },
            'dimension': { type: 'string', description: 'Canonical pen dimension.' },
            'baseline_animals': { type: 'int', description: 'Same-species animals already inside before the request.' },
        },
        perform: runAsAction(async function (
            agent,
            animal,
            adult_count,
            breeding_pairs,
            source_x,
            source_y,
            source_z,
            gate_x,
            gate_y,
            gate_z,
            inside_x,
            inside_y,
            inside_z,
            outside_x,
            outside_y,
            outside_z,
            min_x,
            max_x,
            min_z,
            max_z,
            pen_y,
            dimension,
            baseline_animals,
        ) {
            return await skills.settleLivestockAtPen(agent.bot, {
                animal,
                adultCount: adult_count,
                breedingPairs: breeding_pairs,
                source: { x: source_x, y: source_y, z: source_z },
                gate: { x: gate_x, y: gate_y, z: gate_z },
                inside: { x: inside_x, y: inside_y, z: inside_z },
                outside: { x: outside_x, y: outside_y, z: outside_z },
                bounds: { minX: min_x, maxX: max_x, minZ: min_z, maxZ: max_z, y: pen_y },
                dimension,
                baselineAnimals: baseline_animals,
            });
        }, false, 3),
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
        name: '!acceptCharcoalMission',
        description: 'MODEL-ONLY: interpret a natural-language promise to make and deliver charcoal as one current in-memory Mission. Choose the exact promised quantity; use 8 as the safe bounded default when the player says only “some”. The deterministic Mission planner owns every prerequisite and next Activity after acceptance.',
        params: {
            'quantity': { type: 'int', description: 'Exact charcoal quantity promised to the requester, 1-64; default 8 for an unspecified bounded amount.', domain: [1, 64, '[]'], optional: true },
        },
        perform: acceptCharcoalMission,
    },
    {
        name: '!cancelMission',
        description: 'Cancel the current in-memory charcoal Mission without changing unrelated durable goals or jobs.',
        params: {},
        perform: function (agent) {
            return agent.charcoal_mission?.cancel?.('Cancelled by player.')
                ? 'Active charcoal Mission cancelled.'
                : 'There is no active charcoal Mission to cancel.';
        },
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'workstation_x': { type: 'float', description: 'Optional exact furnace X coordinate.', optional: true },
            'workstation_y': { type: 'float', description: 'Optional exact furnace Y coordinate.', optional: true },
            'workstation_z': { type: 'float', description: 'Optional exact furnace Z coordinate.', optional: true },
            'workstation_dimension': { type: 'string', description: 'Optional exact furnace dimension.', optional: true },
        },
        perform: runAsAction(async (agent, item_name, num, x, y, z, dimension) => {
            return await runWorkstationAction(agent, 'smelt', () => skills.smeltItem(
                agent.bot,
                item_name,
                num,
                workstationArgumentsForAction(agent, 'furnace', x, y, z, dimension),
            ));
        }, false, -1, null, 'composed', 'furnace')
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
        }, false, -1, null, 'legacy', 'placement')
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
        }, false, -1, null, 'legacy', 'placement')
    },
    {
        name: '!placeFixtureAt',
        description: 'Place one prevalidated logical door, bed, or stair fixture at an exact blueprint anchor and verify every occupied Minecraft block and facing state.',
        params: {
            'type': { type: 'BlockOrItemName', description: 'The exact door, bed, or stair item.' },
            'x': { type: 'float', description: 'The validated anchor X coordinate.' },
            'y': { type: 'float', description: 'The validated anchor Y coordinate.' },
            'z': { type: 'float', description: 'The validated anchor Z coordinate.' },
            'kind': { type: 'string', description: 'Logical fixture kind: door, bed, or stair.' },
            'facing': { type: 'string', description: 'Persisted horizontal facing.' },
        },
        perform: runAsAction(async (agent, type, x, y, z, kind, facing) => {
            return await skills.placeFixture(agent.bot, type, x, y, z, kind, facing);
        }, false, -1, null, 'legacy', 'placement')
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
        name: '!harvestEntityDrop',
        description: 'Harvest a verified entity drop with its registered shear or combat mechanic, using bounded native navigation and exact inventory verification.',
        params: {
            'source': { type: 'string', description: 'Registered source entity type.' },
            'output': { type: 'ItemName', description: 'Exact expected inventory item.' },
            'method': { type: 'string', description: 'Registered harvest mechanic.' },
            'count': { type: 'int', description: 'Minimum inventory increase to collect.', domain: [1, 64, '[]'] },
            'range': { type: 'int', description: 'Bounded source-search radius.', domain: [16, 512, '[]'] },
            'allow_alternative': { type: 'boolean', description: 'Allow the owning planner to bind a physically observed material-family alternative.', optional: true, default: false },
            'target_entity_id': { type: 'int', description: 'Optional exact loaded entity identity selected by deterministic retry judgment.', domain: [1, 2147483647, '[]'], optional: true },
        },
        perform: runAsAction(async (agent, source, output, method, count, range, allow_alternative=false, target_entity_id=null) => {
            return await skills.harvestEntityDrop(
                agent.bot,
                source,
                output,
                method,
                count,
                range,
                allow_alternative,
                target_entity_id,
            );
        }, false, 10)
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            return await skills.attackNearest(agent.bot, type, true);
        }, false, -1, null, 'legacy', 'pvp')
    },
    {
        name: '!attackHostile',
        description: 'Resolve nearby hostiles through the tactical combat loop, including threat priority, shield/range choice, retreat, and verified physical outcomes.',
        params: {},
        perform: runAsAction(async (agent) => {
            return await skills.resolveTacticalCombat(agent.bot, 16);
        }, false, -1, null, 'legacy', 'pvp')
    },
    {
        name: '!resolveTacticalCombat',
        description: 'Choose and execute one bounded tactical response loop from live health, equipment, hostile type, and distance. Prioritizes urgent threats, retreats when unsafe, uses bows against explosives, shields against projectile attackers, and verifies the physical outcome.',
        params: {
            'range': { type: 'int', description: 'Maximum loaded-hostile decision range.', domain: [4, 32, '[]'] },
        },
        perform: runAsAction(async (agent, range) => {
            return await skills.resolveTacticalCombat(agent.bot, range);
        }, false, 3, null, 'legacy', 'pvp')
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
        }, false, -1, null, 'legacy', 'pvp')
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            return await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!shelterInPlace',
        description: 'Emergency only: after proving a natural three-block shaft and one carried opaque building block, dig down and seal the pocket overhead. Needs no route, food, or weapon.',
        perform: runAsAction(async (agent) => {
            return await skills.shelterInPlace(agent.bot);
        })
    },
    {
        name: '!goToBedAt',
        description: 'Go to one exact persisted bed fixture in the required dimension and sleep there; never substitute a nearer bed.',
        params: {
            'x': { type: 'float', description: 'Exact bed foot X coordinate.' },
            'y': { type: 'float', description: 'Exact bed foot Y coordinate.' },
            'z': { type: 'float', description: 'Exact bed foot Z coordinate.' },
            'dimension': { type: 'string', description: 'Required Minecraft dimension.' },
        },
        perform: runAsAction(async (agent, x, y, z, dimension) => {
            return await skills.goToBed(agent.bot, {
                exactPosition: { x, y, z },
                expectedDimension: dimension,
            });
        })
    },
    {
        name: '!addToAgenda',
        description: 'Queue ONE step of a multi-part plan. When a player asks for several things in one sentence, call this once per step, in the order they said them, and the bot will work through the whole plan on its own. Kinds: acquire, deliver, mine, harvest, stockpile, shelter, goto, craft, smelt.',
        params: {
            'kind': { type: 'string', description: 'One of: acquire, deliver, mine, harvest, stockpile, shelter, goto, craft, smelt.' },
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
        name: '!queueItemPlan',
        description: 'Atomically queue an ordered list of concrete minimum inventory outcomes through the existing durable Agenda and GoalDirector. Use this when a broad request requires choosing several real items. Never invent an umbrella item such as starter_kit. The encoded plan is canonical_item:minimum_quantity entries separated by |. A typed final barrier re-verifies the complete promised inventory and restores a floor if later work consumed it. The optional return flag adds a final return to the requesting player.',
        compactDescription: 'Atomically queue a complete inventory-floor plan before any work starts. Syntax: !queueItemPlan("stone_axe:1|stone_pickaxe:1|torch:16|logs:16", "PlayerName", true). Each quantity is the minimum that should be carried, not an amount blindly added to current stock. Use only real connected-registry items or supported families. Never invent umbrella targets. GoalDirector derives recipes, tools, fuel, and workstations. A final typed check makes list order irrelevant to correctness; true queues a final return.',
        params: {
            'encoded_plan': { type: 'string', description: 'One to twelve canonical_item:quantity entries separated by |.' },
            'player_name': { type: 'string', description: 'Canonical requesting player name.' },
            'return_to_player': { type: 'boolean', description: 'Whether to return to the requesting player after every item outcome completes.' },
        },
        perform: queueOrderedItemPlan,
    },
    {
        name: '!requestResourceProject',
        description: 'Compile and atomically start one complete home-bound resource project through the existing deterministic Agenda: explore a cave, retain explicitly requested mined outputs, return to the bound home position, manufacture every listed output, deposit each output in one bound loaded chest or barrel, and return to the named player. The ordinary-language request must state all of those phases; this command never starts only a partial project.',
        compactDescription: 'Start one complete cave-to-workshop project from an ordinary-language contract. Syntax: !requestResourceProject("PlayerName", "find and explore a cave, mine eight iron ore and three coal, return here, make one iron pickaxe, one shield, and one bucket using this furnace and crafting table, store all three in this chest, then return to me", true). The current position becomes home and the loaded chest is bound before any phase starts.',
        params: {
            'player_name': { type: 'string', description: 'Canonical online player who requested the project and receives the final return.' },
            'request': { type: 'string', description: 'Complete ordinary-language cave, resource, return, manufacture, storage, and requester-return contract.' },
            'replace_current': { type: 'boolean', description: 'Replace unfinished agenda work atomically before starting this project.', optional: true, default: true },
        },
        perform: async function (agent, playerName, request, replaceCurrent = true) {
            const resolution = resolvePlayerTarget(agent.bot, playerName);
            if (!resolution?.canonical || !resolution.entity?.position) {
                return `Resource project was not started: ${playerName} is not a uniquely resolved online player.`;
            }
            const normalizedRequest = String(request || '').trim();
            if (!normalizedRequest) return 'Resource project was not started: the complete project request is empty.';
            const routedRequest = replaceCurrent === true
                ? `Now, ${normalizedRequest}`
                : normalizedRequest;
            const handled = await agent.dispatchPlayerAgenda(
                resolution.canonical,
                resolution.canonical,
                routedRequest,
                resolution.entity.position,
                {
                    historyMessage: normalizedRequest,
                    bypassModelSequencing: true,
                },
            );
            if (!handled) {
                return 'Resource project was not started: the complete request did not compile into the typed resource-project contract.';
            }
            const snapshot = agent.agenda_director?.snapshot?.();
            return snapshot?.remaining > 0
                ? `Resource project accepted as ${snapshot.remaining} durable Agenda phase(s); execution is starting from the bound home base.`
                : 'Resource project was handled, but no unfinished Agenda phases remain.';
        },
    },
    {
        name: '!queueStoragePlan',
        description: 'Atomically bind one existing chest or barrel and queue a complete retained-inventory cleanup plan. The encoded plan is canonical_item:retain_quantity entries separated by |. Zero stores every carried copy; positive quantities preserve that many best copies. The optional return flag adds a final player return.',
        compactDescription: 'Queue one complete storage cleanup before moving anything. Syntax: !queueStoragePlan("raw_iron:0|cobblestone:0|stone_pickaxe:1", "PlayerName", true). Include only carried authorized surplus. Counts mean how many to retain, not how many to deposit.',
        params: {
            'encoded_plan': { type: 'string', description: 'One to twelve canonical_item:retain_quantity entries separated by |.' },
            'player_name': { type: 'string', description: 'Canonical requesting player name.' },
            'return_to_player': { type: 'boolean', description: 'Whether to return to the requesting player after cleanup completes.' },
        },
        perform: queueStoragePlan,
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
        name: '!setNarration',
        description: 'Change how much this bot says about its own routine actions in chat. Use this when the player says to be quiet, stop narrating, stop announcing everything, or asks it to speak up again. quiet still answers questions and reports results; it only stops the running commentary.',
        params: {
            'policy': { type: 'string', description: 'quiet or chatty.' },
        },
        perform: function (agent, policy) {
            const result = applyRuntimeChange(agent, { narration: policy });
            if (!result.ok) return `Narration was not changed: ${result.detail}`;
            return result.runtime.narration === 'quiet'
                ? 'Going quiet. I will still answer you and report what I finish.'
                : 'I will call out what I am doing again.';
        }
    },
    {
        name: '!showRuntime',
        description: 'Report this bot\'s current role, autonomy, comportment, traversal, narration, jobs, and reactions.',
        perform: function (agent) {
            const runtime = agent.runtime;
            if (!runtime) return 'Runtime configuration is unavailable.';
            return [
                `Role: ${runtime.role}`,
                `Autonomy: ${runtime.autonomy}`,
                `Comportment: ${runtime.comportment?.preset || 'neutral'}`,
                `Traversal: ${runtime.traversal}`,
                `Narration: ${runtime.narration}`,
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
        name: '!resumeAgenda',
        description: 'Resume the exact failed Agenda entry and every linked unattempted continuation after a material repair. Preserves the original entry identities and does not create a replacement plan.',
        params: {},
        perform: function (agent) {
            const result = agent.agenda_director?.resumeFailedChain?.(
                'Explicit player authority resumed the linked chain after its owning mechanism changed.',
            );
            if (!result) return 'The agenda is unavailable on this bot.';
            return result.resumed > 0
                ? `Resumed ${result.resumed} linked agenda step(s) from ${result.rootId}.`
                : 'There is no failed agenda chain to resume.';
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
        description: 'Fish in nearby water until the requested number of newly caught cookable cod or salmon is verified.',
        params: {
            'count': { type: 'int', description: 'How many cookable fish to verify.', domain: [1, 64] },
            'baseline_manifest': { type: 'string', description: 'Optional machine-generated raw-fish item:count baseline.', optional: true, default: '' },
        },
        perform: runAsAction(async (agent, count, baseline_manifest = '') => {
            return await skills.fishForItems(agent.bot, count, { baselineManifest: baseline_manifest });
        })
    },
    {
        name: '!cookCaughtFish',
        description: 'Cook only the newly caught cod or salmon above a durable baseline in one exact existing furnace.',
        params: {
            'count': { type: 'int', description: 'How many newly caught fish to cook.', domain: [1, 64] },
            'x': { type: 'float', description: 'Assigned furnace x coordinate.' },
            'y': { type: 'float', description: 'Assigned furnace y coordinate.' },
            'z': { type: 'float', description: 'Assigned furnace z coordinate.' },
            'dimension': { type: 'string', description: 'Assigned furnace dimension.' },
            'baseline_raw_manifest': { type: 'string', description: 'Machine-generated raw-fish item:count baseline.' },
            'baseline_cooked_manifest': { type: 'string', description: 'Machine-generated cooked-fish item:count baseline.' },
        },
        perform: runAsAction((
            agent,
            count,
            x,
            y,
            z,
            dimension,
            baseline_raw_manifest,
            baseline_cooked_manifest,
        ) => skills.cookCaughtFish(
            agent.bot,
            count,
            x,
            y,
            z,
            dimension,
            baseline_raw_manifest,
            baseline_cooked_manifest,
        )),
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
        description: 'Digs down 1-384 blocks. Will stop early if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, 384] }},
        perform: runAsAction(async (agent, distance) => {
            return await skills.digDown(agent.bot, distance);
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to a verified usable surface stance, optionally requiring literal open sky for resource access.',
        params: {
            'require_open_surface': { type: 'boolean', description: 'Require the final occupied stance itself to be open to the sky instead of merely having a proved nearby surface egress.', optional: true, default: false },
        },
        perform: runAsAction(async (agent, require_open_surface=false) => {
            return await skills.goToSurface(agent.bot, {
                requireOpenSurface: require_open_surface === true,
            });
        }, false, SURFACE_RECOVERY_ACTION_TIMEOUT_MINUTES, null, 'legacy', 'pathfinder')
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
            updateCompanionDirectiveFromAction(agent, null, player_name);
            return await skills.goToPlayer(agent.bot, player_name, 2, {
                locatePlayerPosition: name => agent.locatePlayerPosition(name),
            });
        })
    },
    {
        name: '!follow',
        description: 'Continuously follow the named player until stopped or replaced by another player action. Use for "follow me".',
        params: {'player_name': { type: 'string', description: 'Name of the player to follow.' }},
        // Delegates identically to !followPlayer. It used to omit
        // locatePlayerPosition, so this command could only follow a player it
        // could already see -- and a model picking the shorter synonym got a
        // companion that stood still. Two commands promising the same thing must
        // not behave differently; the model chooses by description, not by
        // reading which one was wired properly.
        perform: runAsAction(async (agent, player_name) => {
            return await skills.followPlayer(agent.bot, player_name, 3, {
                locatePlayerPosition: name => agent.locatePlayerPosition(name),
            });
        }, true, -1, (agent, player_name) => {
            updateCompanionDirectiveFromAction(agent, 'follow', player_name);
        }, 'composed')
    },
    {
        name: '!collect',
        description: 'Collect a bounded quantity of a common block, safely relocating and rescanning when the current area has no reachable source.',
        params: {
            'block_type': { type: 'BlockName', description: 'Canonical block name, such as oak_log.' },
            'quantity': { type: 'int', description: 'Number to collect.', domain: [1, 65] },
        },
        perform: runAsAction(async (agent, block_type, quantity) => {
            return await skills.collectBlock(
                agent.bot,
                block_type,
                quantity,
                collectionExclusionsForAgent(agent),
                64,
                { relocate: true },
            );
        }, false, RESPONSIVE_COLLECTION_ACTION_TIMEOUT_MINUTES)
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
            return await skills.followPlayer(agent.bot, player_name, 3);
        }, true, -1, (agent, player_name) => {
            updateCompanionDirectiveFromAction(agent, 'guard', player_name);
            agent.bot.modes.setOn('self_defense', true);
        })
    },
    {
        name: '!place',
        description: 'Place a small bounded quantity of carried torches or blocks on safe nearby ground around the named player. Set shared true only when the player explicitly asks for a site usable by the nearby group.',
        params: {
            'player_name': { type: 'string', description: 'Name of the player to place near.' },
            'block_type': { type: 'BlockOrItemName', description: 'Canonical block or placeable item name, such as torch.' },
            'quantity': { type: 'int', description: 'Number to place.', domain: [1, 17] },
            'shared': { type: 'boolean', description: 'Require one supported site within the shared reach envelope of the named player and nearby loaded players.', optional: true, default: false },
        },
        perform: runAsAction(async (agent, player_name, block_type, quantity, shared) => {
            return await skills.placeNearPlayer(agent.bot, player_name, block_type, quantity, { shared });
        })
    },
];
