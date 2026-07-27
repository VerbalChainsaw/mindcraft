import { broadcastAgentStatus, createMindServer, registerAgent, unregisterAgent, numStateListeners } from './mindserver.js';
import { AgentProcess } from '../process/agent_process.js';
import { getServer } from './mcserver.js';
import open from 'open';
import process from 'node:process';
import { assessProfileSettings } from './profile-preflight.js';
import { describeModelProvider } from '../models/_model_map.js';
import { hasKey } from '../utils/keys.js';

let mindserver;
let connected = false;
let agent_processes = {};
let blocked_agents = {};
let pending_agent_starts = {};
let pending_agent_actions = {};
let selected_profile_records = [];
let agent_generations = {};
let next_agent_generation = 0;
let agent_count = 0;
let mindserver_port = 8080;

function nextAgentGeneration(agentName) {
    const generation = ++next_agent_generation;
    agent_generations[agentName] = generation;
    return generation;
}

function invalidateAgentGeneration(agentName) {
    delete agent_generations[agentName];
}

function isLaunchValid(agentName, generation) {
    return generation === undefined || agent_generations[agentName] === generation;
}

function cancelledLaunchResult(agentName) {
    return {
        success: false,
        cancelled: true,
        error: `Agent '${agentName}' startup cancelled`,
    };
}

function isCurrentBlockedRecord(agentName, blocked) {
    return blocked_agents[agentName] === blocked
        && agent_processes[agentName] === blocked.agentProcess
        && isLaunchValid(agentName, blocked.runtime.launchGeneration);
}

function removeCurrentBlockedRecord(agentName, blocked) {
    if (!isCurrentBlockedRecord(agentName, blocked)) return false;
    delete blocked_agents[agentName];
    return true;
}

function removePendingStartForBlockedRecord(agentName, blocked) {
    if (pending_agent_starts[agentName]?.blocked === blocked) {
        delete pending_agent_starts[agentName];
    }
}

function isCurrentLaunchProcess(agentName, generation, agentProcess) {
    return isLaunchValid(agentName, generation) && agent_processes[agentName] === agentProcess;
}

function cancelStaleLaunch(agentName, generation, agentProcess) {
    agentProcess.stop?.();
    return cancelledLaunchResult(agentName);
}

function isActiveProcess(agentProcess) {
    return Boolean(agentProcess && (agentProcess.isActive?.() || agentProcess.running));
}

function pendingActionResult(error) {
    return { success: false, pending: true, retryable: true, error };
}

function cloneSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
}

function selectedProfileIdentity(agentName, descriptor) {
    if (Number.isInteger(descriptor?.index) && descriptor.index >= 0) {
        return `launch:${descriptor.index}`;
    }
    return `agent:${agentName}`;
}

function recordSelectedProfile(agentName, settings, descriptor) {
    const identity = selectedProfileIdentity(agentName, descriptor);
    const privateSettings = cloneSettings(settings);
    const record = { identity, agentName, settings: privateSettings, descriptor };
    const existingIndex = selected_profile_records.findIndex((entry) => entry.identity === identity);
    if (existingIndex === -1) selected_profile_records.push(record);
    else selected_profile_records[existingIndex] = record;
    return record;
}

function updateSelectedProfile(agentName, settings, identity) {
    const privateSettings = cloneSettings(settings);
    const existingIndex = selected_profile_records.findIndex((entry) => entry.identity === identity);
    if (existingIndex !== -1) {
        selected_profile_records[existingIndex] = {
            ...selected_profile_records[existingIndex],
            settings: privateSettings,
            descriptor: null,
        };
    } else if (!selected_profile_records.some((entry) => entry.agentName === agentName)) {
        selected_profile_records.push({
            identity: selectedProfileIdentity(agentName),
            agentName,
            settings: privateSettings,
            descriptor: null,
        });
    }
}

function removeSelectedProfiles(agentName) {
    selected_profile_records = selected_profile_records.filter((entry) => entry.agentName !== agentName);
}

function isInactiveBlockedPlaceholder(agentName, blocked) {
    return Boolean(
        blocked
        && isCurrentBlockedRecord(agentName, blocked)
        && !isActiveProcess(blocked.agentProcess),
    );
}

function canReplaceBlockedPlaceholder(agentName, blocked) {
    return isInactiveBlockedPlaceholder(agentName, blocked)
        && agent_processes[agentName] === blocked.agentProcess;
}

function compareSelectedProfileRecords(first, second) {
    const firstIndex = first.descriptor?.index;
    const secondIndex = second.descriptor?.index;
    const firstHasIndex = Number.isInteger(firstIndex) && firstIndex >= 0;
    const secondHasIndex = Number.isInteger(secondIndex) && secondIndex >= 0;
    if (firstHasIndex && secondHasIndex) return firstIndex - secondIndex;
    if (firstHasIndex) return -1;
    if (secondHasIndex) return 1;
    return first.agentName.localeCompare(second.agentName);
}

function providerRole(role, description) {
    return {
        role,
        provider: description.ok ? description.provider : null,
    };
}

function describeProviderRoles(settings) {
    const profile = settings.profile;
    const chat = describeModelProvider(profile.model);
    const roles = [providerRole('chat model', chat)];
    if (profile.code_model) roles.push(providerRole('code model', describeModelProvider(profile.code_model)));
    if (profile.vision_model) roles.push(providerRole('vision model', describeModelProvider(profile.vision_model)));
    const embedding = profile.embedding ? describeModelProvider(profile.embedding) : chat;
    roles.push(providerRole('embedding model', embedding.ok ? embedding : chat));
    return roles;
}

function readinessKeyLookup(settings, keyLookup) {
    return keyLookup;
}

function installBlockedAgent(settings, descriptor, runtime = {}) {
    const agentName = descriptor.name;
    const launchGeneration = nextAgentGeneration(agentName);
    delete pending_agent_starts[agentName];
    const agentIndex = agent_count++;
    const viewerPort = 3000 + agentIndex;
    const agentProcess = {
        name: agentName,
        state: 'blocked',
        running: false,
        lastError: descriptor.lastError,
        process: null,
        isActive: () => false,
        stop: () => false,
    };
    agent_processes[agentName] = agentProcess;
    const selectedProfile = recordSelectedProfile(agentName, settings, descriptor);
    blocked_agents[agentName] = {
        settings: selectedProfile.settings,
        descriptor,
        runtime: { ...runtime, agentIndex, viewerPort, launchGeneration, selectedProfileIdentity: selectedProfile.identity },
        agentProcess,
    };
    registerAgent(createBlockedPublicSettings(agentName), viewerPort);
    broadcastAgentStatus();
    return agentProcess;
}

function finalizePendingAction(agentName, owner) {
    const pending = pending_agent_actions[agentName];
    if (!pending || pending.owner !== owner || agent_processes[agentName] !== owner) return;
    delete pending_agent_actions[agentName];
    delete agent_processes[agentName];
    unregisterAgent(agentName);
    removeSelectedProfiles(agentName);
    if (pending.action.type === 'replace') {
        installBlockedAgent(pending.action.settings, pending.action.descriptor, pending.action.runtime);
    }
}

function queuePendingAction(agentName, owner, action) {
    const current = pending_agent_actions[agentName];
    if (current && current.owner === owner) {
        if (current.action.type === 'destroy' && action.type === 'replace') {
            return pendingActionResult(`Agent '${agentName}' destruction is pending.`);
        }
        current.action = action.type === 'destroy' ? action : current.action;
        if (action.type === 'replace' && current.action.type === 'replace') current.action = action;
        return pendingActionResult(`Agent '${agentName}' finalization is pending.`);
    }
    if (typeof owner.waitForExit !== 'function') {
        return { success: false, error: `Cannot replace agent '${agentName}': active process cannot confirm exit.` };
    }
    let exitWait;
    try {
        exitWait = owner.waitForExit();
    } catch (error) {
        return { success: false, error: `Cannot replace agent '${agentName}': active process cannot confirm exit.` };
    }
    if (!exitWait || typeof exitWait.then !== 'function') {
        return { success: false, error: `Cannot replace agent '${agentName}': active process cannot confirm exit.` };
    }
    invalidateAgentGeneration(agentName);
    pending_agent_actions[agentName] = { owner, action };
    Promise.resolve(exitWait).then(
        () => finalizePendingAction(agentName, owner),
        () => {},
    );
    try {
        owner.stop?.();
    } catch (error) {
        console.error(`Error stopping agent ${agentName} for finalization:`, error);
    }
    return pendingActionResult(`Agent '${agentName}' finalization is pending.`);
}

export async function init(host_public=false, port=8080, auto_open_ui=true, port_scan_max=1) {
    if (connected) {
        console.error('Already initiliazed!');
        return;
    }
    const startedMindServer = await createMindServer(host_public, port, port_scan_max);
    mindserver = startedMindServer;
    mindserver_port = startedMindServer.address().port;
    connected = true;
    if (auto_open_ui) {
        setTimeout(() => {
            // check if browser listener is already open
            if (numStateListeners() === 0) {
                open('http://localhost:'+mindserver_port);
            }
        }, 3000);
    }
    return mindserver_port;
}

export async function createAgent(settings, runtime) {
    const resolveServer = runtime?.resolveServer || getServer;
    const createAgentProcess = runtime?.createAgentProcess || ((name, port) => new AgentProcess(name, port));
    if (!settings.profile.name) {
        console.error('Agent name is required in profile');
        return {
            success: false,
            error: 'Agent name is required in profile'
        };
    }
    const agent_name = settings.profile.name;
    const launchGeneration = runtime?.launchGeneration;
    const launchIsValid = () => isLaunchValid(agent_name, launchGeneration);
    const blockedPlaceholder = launchGeneration === undefined ? blocked_agents[agent_name] : null;
    if (!launchIsValid()) {
        return cancelledLaunchResult(agent_name);
    }
    settings = JSON.parse(JSON.stringify(settings));
    let load_memory = settings.load_memory || false;
    let init_message = settings.init_message || null;

    try {
        try {
            if (!launchIsValid()) {
                return cancelledLaunchResult(agent_name);
            }
            const server = await resolveServer(settings.host, settings.port, settings.minecraft_version);
            if (!launchIsValid()) {
                return cancelledLaunchResult(agent_name);
            }
            settings.host = server.host;
            settings.port = server.port;
            settings.minecraft_version = server.version;
        } catch (error) {
            if (!launchIsValid()) {
                return cancelledLaunchResult(agent_name);
            }
            console.warn(`Error getting server:`, error);
            if (settings.minecraft_version === "auto") {
                settings.minecraft_version = null;
            }
            console.warn(`Attempting to connect anyway...`);
        }

        if (!launchIsValid()) {
            return cancelledLaunchResult(agent_name);
        }
        const existingProcess = agent_processes[agent_name];
        if (existingProcess && (existingProcess.isActive?.() || existingProcess.running)) {
            return {
                success: false,
                error: `Agent '${agent_name}' already exists`
            };
        }
        if (blockedPlaceholder) {
            if (!canReplaceBlockedPlaceholder(agent_name, blockedPlaceholder)) {
                return {
                    success: false,
                    error: `Agent '${agent_name}' already exists`
                };
            }
        } else if (blocked_agents[agent_name]) {
            return {
                success: false,
                error: `Agent '${agent_name}' already exists`
            };
        }

        const agentIndex = runtime?.agentIndex ?? agent_count++;
        const viewer_port = runtime?.viewerPort ?? 3000 + agentIndex;
        if (!launchIsValid()) {
            return cancelledLaunchResult(agent_name);
        }
        const agentProcess = createAgentProcess(agent_name, mindserver_port);
        if (!launchIsValid()) {
            agentProcess.stop?.();
            return cancelledLaunchResult(agent_name);
        }
        if (blockedPlaceholder) {
            if (!canReplaceBlockedPlaceholder(agent_name, blockedPlaceholder)) {
                agentProcess.stop?.();
                return {
                    success: false,
                    error: `Agent '${agent_name}' already exists`
                };
            }
            removeCurrentBlockedRecord(agent_name, blockedPlaceholder);
            removePendingStartForBlockedRecord(agent_name, blockedPlaceholder);
        }
        agent_processes[settings.profile.name] = agentProcess;
        if (!launchIsValid()) {
            if (agent_processes[agent_name] === agentProcess) {
                delete agent_processes[agent_name];
            }
            agentProcess.stop?.();
            return cancelledLaunchResult(agent_name);
        }
        updateSelectedProfile(agent_name, settings, runtime?.selectedProfileIdentity);
        registerAgent(settings, viewer_port);
        try {
            await agentProcess.start(load_memory, init_message, agentIndex);
        } catch (error) {
            if (!isCurrentLaunchProcess(agent_name, launchGeneration, agentProcess)) {
                return cancelStaleLaunch(agent_name, launchGeneration, agentProcess);
            }
            throw error;
        }
        if (!isCurrentLaunchProcess(agent_name, launchGeneration, agentProcess)) {
            return cancelStaleLaunch(agent_name, launchGeneration, agentProcess);
        }
    } catch (error) {
        console.error(`Error creating agent ${agent_name}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
    return {
        success: true,
        error: null
    };
}

export function getAgentProcess(agentName) {
    return agent_processes[agentName];
}

export function getSelectedProfileReadiness(keyLookup = hasKey) {
    const pendingAgentNames = new Set();
    const pendingRecords = [];
    for (const [agentName, pending] of Object.entries(pending_agent_actions)) {
        if (pending.action.type !== 'replace') continue;
        pendingAgentNames.add(agentName);
        pendingRecords.push({
            identity: `pending:${agentName}`,
            agentName,
            settings: pending.action.settings,
            descriptor: pending.action.descriptor,
        });
    }
    const selectedRecords = [
        ...selected_profile_records.filter(({ agentName }) => !pendingAgentNames.has(agentName)),
        ...pendingRecords,
    ].sort(compareSelectedProfileRecords);
    return selectedRecords.map(({ settings, descriptor }) => {
        const readiness = descriptor?.state === 'blocked' && !descriptor.retryable
            ? descriptor
            : assessProfileSettings(settings, {
            hasKey: readinessKeyLookup(settings, keyLookup),
        });
        return {
            name: readiness.name,
            state: readiness.state,
            providerRoles: describeProviderRoles(settings),
            reason: readiness.lastError,
        };
    });
}

function createBlockedPublicSettings(agentName) {
    return { profile: { name: agentName } };
}

export function registerBlockedAgent(settings, descriptor, runtime = {}) {
    const agentName = descriptor.name;
    const displacedProcess = agent_processes[agentName];
    const action = { type: 'replace', settings, descriptor, runtime };
    if (displacedProcess?.state !== 'blocked' && isActiveProcess(displacedProcess)) {
        return queuePendingAction(agentName, displacedProcess, action);
    }
    if (displacedProcess?.state !== 'blocked') {
        if (agent_processes[agentName] === displacedProcess) delete agent_processes[agentName];
        unregisterAgent(agentName);
    }
    return installBlockedAgent(settings, descriptor, runtime);
}

export async function startAgent(agentName, runtime = {}) {
    if (pending_agent_starts[agentName]) {
        return pending_agent_starts[agentName].startup;
    }

    const pendingAction = pending_agent_actions[agentName];
    if (pendingAction && agent_processes[agentName] === pendingAction.owner) {
        return pendingActionResult(`Agent '${agentName}' finalization is pending.`);
    }

    const blocked = blocked_agents[agentName];
    if (blocked) {
        const launchGeneration = blocked.runtime.launchGeneration;
        const startup = Promise.resolve().then(() => {
            if (!isCurrentBlockedRecord(agentName, blocked)) {
                return cancelledLaunchResult(agentName);
            }
            if (!blocked.descriptor.retryable) {
                return { success: false, error: blocked.descriptor.lastError };
            }
            const keyLookup = runtime.hasKey || blocked.runtime.hasKey || hasKey;
            const readiness = assessProfileSettings(blocked.settings, {
                hasKey: readinessKeyLookup(blocked.settings, keyLookup),
            });
            if (!isCurrentBlockedRecord(agentName, blocked)) {
                return cancelledLaunchResult(agentName);
            }
            if (readiness.state === 'blocked') {
                blocked.descriptor = readiness;
                blocked.agentProcess.lastError = readiness.lastError;
                broadcastAgentStatus();
                return { success: false, error: readiness.lastError };
            }
            if (!isCurrentBlockedRecord(agentName, blocked)) {
                return cancelledLaunchResult(agentName);
            }
            if (!removeCurrentBlockedRecord(agentName, blocked)) {
                return cancelledLaunchResult(agentName);
            }
            return createAgent(blocked.settings, {
                ...blocked.runtime,
                ...runtime,
                agentIndex: blocked.runtime.agentIndex,
                viewerPort: blocked.runtime.viewerPort,
                launchGeneration: blocked.runtime.launchGeneration,
                selectedProfileIdentity: blocked.runtime.selectedProfileIdentity,
            });
        });
        const pendingStart = { blocked, startup };
        pending_agent_starts[agentName] = pendingStart;
        try {
            return await startup;
        } finally {
            if (pending_agent_starts[agentName] === pendingStart && isLaunchValid(agentName, launchGeneration)) {
                delete pending_agent_starts[agentName];
            }
        }
    }
    if (agent_processes[agentName]) {
        try {
            await agent_processes[agentName].forceRestart();
        } catch (error) {
            console.error(`Error restarting agent ${agentName}:`, error);
            return { success: false, error: error?.message || String(error) };
        }
        return { success: true, error: null };
    }
    console.error(`Cannot start agent ${agentName}; not found`);
    return { success: false, error: `Agent '${agentName}' not found` };
}

export function stopAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].stop();
    }
}

export function destroyAgent(agentName) {
    const owner = agent_processes[agentName];
    if (owner && isActiveProcess(owner)) {
        return queuePendingAction(agentName, owner, { type: 'destroy' });
    }
    invalidateAgentGeneration(agentName);
    delete pending_agent_starts[agentName];
    delete pending_agent_actions[agentName];
    if (agent_processes[agentName] === owner) {
        owner?.stop?.();
        delete agent_processes[agentName];
    }
    delete blocked_agents[agentName];
    removeSelectedProfiles(agentName);
    unregisterAgent(agentName);
    return { success: true, pending: false, error: null };
}

export function shutdown() {
    console.log('Shutting down');
    for (let agentName in agent_processes) {
        agent_processes[agentName].stop();
    }
    setTimeout(() => {
        process.exit(0);
    }, 2000);
}
