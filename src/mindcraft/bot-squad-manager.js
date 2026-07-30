import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createUniqueAgentNames,
  normalizeCharacterIdentity,
  normalizeSquadIdentity,
} from '../agent/runtime/identity-config.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';

const DEFAULT_MAX_SQUAD_SIZE = 12;
const DEFAULT_MAX_SESSION_AGENTS = 24;
const MIN_STAGGER_MS = 250;
const MAX_STAGGER_MS = 5_000;
const FINALIZATION_POLL_MS = 250;
const MAX_FINALIZATION_POLLS = 40;
const MAX_ERROR_LENGTH = 320;
const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,11}$/;
const AGENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,15}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CAPACITY_MEMBER_STATES = new Set(['queued', 'starting', 'started', 'running', 'stopping']);

function runtimeRoleForScenario(behavior) {
  const roles = {
    defend: 'defender',
    guard: 'defender',
    hunt: 'attacker',
    builder: 'builder',
    miner: 'miner',
    scout: 'scout',
    lumberjack: 'lumberjack',
    follow: 'companion',
    forage: 'companion',
    regroup: 'companion',
    peaceful: 'companion',
  };
  return roles[String(behavior || '').toLowerCase()] || null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedError(value, fallback) {
  const text = String(value || fallback).trim();
  return text.slice(0, MAX_ERROR_LENGTH) || fallback;
}

export class BotSquadManager {
  constructor({
    getAgentSettings,
    hasAgent,
    normalizeSettings,
    createAgent,
    startAgent,
    stopAgent,
    destroyAgent,
    prepareSettings = (settings) => settings,
    setAgentSettings = () => {},
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    onUpdate = () => {},
    persistencePath = null,
    maxSquadSize = DEFAULT_MAX_SQUAD_SIZE,
    maxSessionAgents = DEFAULT_MAX_SESSION_AGENTS,
  } = {}) {
    for (const [label, dependency] of Object.entries({
      getAgentSettings,
      hasAgent,
      normalizeSettings,
      createAgent,
      startAgent,
      stopAgent,
      destroyAgent,
      prepareSettings,
      setAgentSettings,
    })) {
      if (typeof dependency !== 'function') throw new TypeError(`${label} is required.`);
    }
    this.getAgentSettings = getAgentSettings;
    this.hasAgent = hasAgent;
    this.normalizeSettings = normalizeSettings;
    this.createAgent = createAgent;
    this.startAgent = startAgent;
    this.stopAgent = stopAgent;
    this.destroyAgent = destroyAgent;
    this.prepareSettings = prepareSettings;
    this.setAgentSettings = setAgentSettings;
    this.sleep = sleep;
    this.onUpdate = onUpdate;
    this.persistencePath = typeof persistencePath === 'string' && persistencePath.trim() ? persistencePath : null;
    this.maxSquadSize = maxSquadSize;
    this.maxSessionAgents = maxSessionAgents;
    this.squads = new Map();
    this.reservedNames = new Set();
    this.persistence = {
      enabled: Boolean(this.persistencePath),
      state: this.persistencePath ? 'loading' : 'disabled',
      lastSavedAt: null,
      lastLoadedAt: null,
      error: null,
      blocked: false,
    };
    this.loadPersisted();
  }

  async prepareMemberSettings(member) {
    const prepared = await Promise.resolve(this.prepareSettings(clone(member.settings), member.name));
    const normalized = this.normalizeSettings(prepared);
    member.settings = normalized;
    if (this.hasAgent(member.name)) {
      await Promise.resolve(this.setAgentSettings(member.name, clone(normalized)));
    }
    return clone(normalized);
  }

  persistenceSafeSettings(settings) {
    const copy = clone(settings || {});
    const redact = (value) => {
      if (!value || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(redact);
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !/(?:api[_-]?key|token|secret|password|credential|authorization|cookie|headers?)/i.test(key))
        .map(([key, child]) => [key, redact(child)]));
    };
    return redact(copy);
  }

  getPersistenceStatus() {
    const {
      enabled,
      state,
      lastSavedAt,
      lastLoadedAt,
      error,
    } = this.persistence;
    return {
      enabled,
      state,
      lastSavedAt,
      lastLoadedAt,
      error: error || null,
    };
  }

  setPersistenceStatus(next = {}) {
    this.persistence = {
      ...this.persistence,
      ...next,
    };
    return this.getPersistenceStatus();
  }

  persist() {
    if (!this.persistencePath) return this.getPersistenceStatus();
    // Never overwrite a saved squad file that could not be read. The current
    // lifecycle can continue, but an explicit repair is required before its
    // original durable state may be replaced.
    if (this.persistence.blocked) return this.getPersistenceStatus();
    try {
      const records = [...this.squads.values()].map((squad) => ({
        id: squad.id,
        templateName: squad.templateName,
        prefix: squad.prefix,
        identity: clone(squad.identity),
        targetSize: squad.targetSize,
        staggerMs: squad.staggerMs,
        scenario: squad.scenario ? clone(squad.scenario) : null,
        lastAction: squad.lastAction ? clone(squad.lastAction) : null,
        state: squad.state,
        createdAt: squad.createdAt,
        updatedAt: squad.updatedAt,
        members: squad.members.map((member) => ({
          id: member.id,
          name: member.name,
          identity: clone(member.identity),
          state: member.state,
          error: member.error || null,
          settings: this.persistenceSafeSettings(member.settings),
        })),
      }));
      writeJsonAtomicSync(this.persistencePath, records);
      return this.setPersistenceStatus({
        state: 'saved',
        lastSavedAt: new Date().toISOString(),
        error: null,
        blocked: false,
      });
    } catch (error) {
      const message = boundedError(error?.message, 'Could not save squad data.');
      console.error(`[squads] Could not persist squad state: ${message}`);
      return this.setPersistenceStatus({
        state: 'error',
        error: message,
        blocked: false,
      });
    }
  }

  loadPersisted() {
    if (!this.persistencePath) return this.getPersistenceStatus();
    let records;
    try {
      records = JSON.parse(readFileSync(this.persistencePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return this.setPersistenceStatus({
          state: 'missing',
          lastLoadedAt: new Date().toISOString(),
          error: null,
          blocked: false,
        });
      }
      const message = boundedError(error?.message, 'Could not load saved squad data.');
      console.error(`[squads] Could not load persisted squads: ${message}`);
      return this.setPersistenceStatus({
        state: 'error',
        lastLoadedAt: new Date().toISOString(),
        error: message,
        blocked: true,
      });
    }
    if (!Array.isArray(records)) {
      const message = 'Saved squad data is not a list.';
      console.error(`[squads] Could not load persisted squads: ${message}`);
      return this.setPersistenceStatus({
        state: 'error',
        lastLoadedAt: new Date().toISOString(),
        error: message,
        blocked: true,
      });
    }
    let restored = 0;
    let rejected = Math.max(0, records.length - 64);
    for (const record of records.slice(0, 64)) {
      try {
        if (!record || typeof record !== 'object' || !UUID_PATTERN.test(String(record.id || '')) || this.squads.has(record.id) || !Array.isArray(record.members)) {
          rejected += 1;
          continue;
        }
        const squadIdentity = normalizeSquadIdentity({
          ...(record.identity && typeof record.identity === 'object' ? record.identity : {}),
          id: record.id,
        }, {
          displayName: record.scenario?.label || record.prefix,
          badge: String(record.prefix || '').slice(0, 6).toUpperCase(),
        });
        const members = record.members
          .filter((member) => member && AGENT_NAME_PATTERN.test(String(member.name || '')) && member.settings && typeof member.settings === 'object')
          .slice(0, this.maxSquadSize)
          .map((member) => {
            const memberId = UUID_PATTERN.test(String(member.id || '')) ? member.id : randomUUID();
            const savedRuntime = member.settings.profile?.runtime && typeof member.settings.profile.runtime === 'object'
              ? member.settings.profile.runtime
              : {};
            const scenarioRole = runtimeRoleForScenario(record.scenario?.behavior);
            const identity = normalizeCharacterIdentity({
              ...(member.settings.profile?.identity || {}),
              ...(member.identity && typeof member.identity === 'object' ? member.identity : {}),
              instanceId: memberId,
              squad: squadIdentity,
            }, {
              displayName: member.name,
            });
            return {
              id: memberId,
              name: member.name,
              identity,
              state: 'stopped',
              error: null,
              settings: {
                ...member.settings,
                profile: {
                  ...(member.settings.profile || {}),
                  name: member.name,
                  identity,
                  runtime: {
                    ...savedRuntime,
                    ...(scenarioRole && !savedRuntime.role ? { role: scenarioRole } : {}),
                    ...(record.scenario && !savedRuntime.autonomy ? { autonomy: 'autonomous' } : {}),
                    assignment: {
                      ...(savedRuntime.assignment || {}),
                      ...(!savedRuntime.assignment?.leader && record.scenario?.leader
                        ? { leader: record.scenario.leader }
                        : {}),
                      ...(!savedRuntime.assignment?.behavior && record.scenario?.behavior
                        ? { behavior: record.scenario.behavior }
                        : {}),
                      ...(!savedRuntime.assignment?.formation && record.scenario?.formation
                        ? { formation: record.scenario.formation }
                        : {}),
                    },
                  },
                },
              },
            };
          });
        if (!members.length || members.some((member) => this.reservedNames.has(member.name) || this.hasAgent(member.name))) {
          rejected += 1;
          continue;
        }
        const squad = {
          id: record.id,
          templateName: String(record.templateName || ''),
          prefix: String(record.prefix || ''),
          identity: squadIdentity,
          targetSize: members.length,
          staggerMs: Number.isInteger(record.staggerMs) ? Math.max(MIN_STAGGER_MS, Math.min(MAX_STAGGER_MS, record.staggerMs)) : 750,
          scenario: record.scenario && typeof record.scenario === 'object' ? clone(record.scenario) : null,
          lastAction: record.lastAction && typeof record.lastAction === 'object' ? clone(record.lastAction) : null,
          state: 'stopped',
          cancelRequested: false,
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          members,
          job: null,
          settled: true,
        };
        this.squads.set(squad.id, squad);
        members.forEach(({ name }) => this.reservedNames.add(name));
        restored += 1;
      } catch {
        rejected += 1;
      }
    }
    if (rejected) {
      const message = `Restored ${restored} saved squad${restored === 1 ? '' : 's'}; ${rejected} invalid record${rejected === 1 ? '' : 's'} was preserved for repair.`;
      console.error(`[squads] ${message}`);
      return this.setPersistenceStatus({
        state: 'error',
        lastLoadedAt: new Date().toISOString(),
        error: message,
        blocked: true,
      });
    }
    return this.setPersistenceStatus({
      state: 'loaded',
      lastLoadedAt: new Date().toISOString(),
      error: null,
      blocked: false,
    });
  }

  snapshot(squad) {
    const members = squad.members.map(({ id, name, identity, state, error }) => ({
      id,
      name,
      identity: clone(identity),
      state,
      error: error || null,
    }));
    const startedCount = members.filter(({ state }) => ['started', 'running'].includes(state)).length;
    const failedCount = members.filter(({ state }) => state === 'failed').length;
    return {
      id: squad.id,
      templateName: squad.templateName,
      prefix: squad.prefix,
      identity: clone(squad.identity),
      targetSize: squad.targetSize,
      staggerMs: squad.staggerMs,
      scenario: squad.scenario ? clone(squad.scenario) : null,
      lastAction: squad.lastAction ? clone(squad.lastAction) : null,
      state: squad.state,
      cancelRequested: squad.cancelRequested,
      startedCount,
      failedCount,
      createdAt: squad.createdAt,
      updatedAt: squad.updatedAt,
      members,
      persistence: this.getPersistenceStatus(),
    };
  }

  emit(squad) {
    squad.updatedAt = new Date().toISOString();
    this.persist();
    const snapshot = this.snapshot(squad);
    try {
      this.onUpdate(snapshot);
    } catch {
      // UI notification failures must never own bot lifecycle.
    }
    return snapshot;
  }

  get(id) {
    const squad = this.squads.get(String(id || ''));
    return squad ? this.snapshot(squad) : null;
  }

  getByMember(name) {
    const candidate = String(name || '');
    for (const squad of this.squads.values()) {
      if (squad.members.some((member) => member.name === candidate)) return this.snapshot(squad);
    }
    return null;
  }

  list() {
    return [...this.squads.values()]
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .map((squad) => this.snapshot(squad));
  }

  activeMemberCount(excludingSquadId = null) {
    return [...this.squads.values()]
      .filter((squad) => squad.id !== excludingSquadId)
      .reduce((total, squad) => total + squad.members.filter((member) => CAPACITY_MEMBER_STATES.has(member.state)).length, 0);
  }

  launch(input = {}, options = {}) {
    const templateName = String(input.templateName || '').trim();
    const prefix = String(input.prefix || '').trim();
    const size = Number(input.size);
    const staggerMs = Number(input.staggerMs);
    if (!Number.isInteger(size) || size < 1 || size > this.maxSquadSize) {
      return { success: false, error: `Squad size must be between 1 and ${this.maxSquadSize}.` };
    }
    if (!PREFIX_PATTERN.test(prefix)) {
      return { success: false, error: 'Squad prefix must be 2-12 letters, numbers, or underscores and begin with a letter.' };
    }
    if (!Number.isInteger(staggerMs) || staggerMs < MIN_STAGGER_MS || staggerMs > MAX_STAGGER_MS) {
      return { success: false, error: 'Squad stagger must be between 250 and 5000 milliseconds.' };
    }
    const currentReserved = this.activeMemberCount();
    if (currentReserved + size > this.maxSessionAgents) {
      return { success: false, error: `Squad bots are limited to ${this.maxSessionAgents} in this control-center session.` };
    }
    const memberTemplates = Array.isArray(options.memberTemplates) ? options.memberTemplates : [];
    const template = templateName ? this.getAgentSettings(templateName) : null;
    if (!template && !memberTemplates.some(Boolean)) return { success: false, error: `Template bot '${templateName}' is unavailable.` };
    const squadId = randomUUID();
    const squadIdentity = normalizeSquadIdentity({
      ...(options.squadIdentity && typeof options.squadIdentity === 'object'
        ? options.squadIdentity
        : (input.identity && typeof input.identity === 'object' ? input.identity : (options.scenario?.identity || {}))),
      id: squadId,
      naming: {
        ...(options.squadIdentity?.naming || options.scenario?.identity?.naming || {}),
        memberNames: options.memberNames
          || input.memberNames
          || options.squadIdentity?.naming?.memberNames
          || options.scenario?.identity?.naming?.memberNames,
      },
    }, {
      displayName: options.scenario?.label || prefix,
      badge: prefix.slice(0, 6).toUpperCase(),
    });
    const roleBasedNames = Array.from({ length: size }, (_unused, index) => {
      const source = memberTemplates[index] || template;
      return source?.profile?.identity?.callSign
        || source?.profile?.role
        || source?.profile?.runtime?.role
        || source?.profile?.job
        || prefix;
    });
    const preferredNames = squadIdentity.naming.style === 'role'
      ? roleBasedNames
      : squadIdentity.naming.memberNames;
    // For the normal numbered naming flow, a requested prefix is part of the
    // operator's identity for the squad. Do not silently rename a new squad
    // around an occupied member: that makes a failed removal look successful
    // and leaves the operator controlling an unexpectedly named group.
    if (!preferredNames.some(Boolean)) {
      const occupiedRequestedName = Array.from({ length: size }, (_unused, index) => `${prefix}${index + 1}`)
        .find((name) => this.reservedNames.has(name) || this.hasAgent(name));
      if (occupiedRequestedName) {
        return { success: false, error: `Bot name '${occupiedRequestedName}' is already in use. Choose another prefix or finish removing the existing squad.` };
      }
    }
    const occupiedNames = new Set(this.reservedNames);
    let names;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      names = createUniqueAgentNames({
        prefix,
        size,
        preferredNames,
        occupiedNames,
      });
      const conflicts = names.filter((name) => this.hasAgent(name));
      if (!conflicts.length) break;
      conflicts.forEach((name) => occupiedNames.add(name));
    }
    if (!names || names.some((name) => this.hasAgent(name))) {
      return { success: false, error: 'Could not generate available Minecraft names for every squad member.' };
    }
    const duplicate = names.find((name) => this.reservedNames.has(name) || this.hasAgent(name));
    if (duplicate) return { success: false, error: `Bot name '${duplicate}' is already in use.` };

    let members;
    try {
      members = names.map((name, index) => {
        const settings = clone(memberTemplates[index] || template);
        const profileOverrides = options.memberProfiles?.[index] || {};
        const memberId = randomUUID();
        const preferredDisplayName = squadIdentity.naming.memberNames[index] || name;
        const identity = normalizeCharacterIdentity({
          ...(settings.profile?.identity || {}),
          ...(profileOverrides.identity && typeof profileOverrides.identity === 'object' ? profileOverrides.identity : {}),
          instanceId: memberId,
          squad: squadIdentity,
        }, {
          displayName: preferredDisplayName,
          callSign: preferredDisplayName,
        });
        const safeOverrides = clone(profileOverrides);
        delete safeOverrides.identity;
        const runtimeOverrides = safeOverrides.runtime && typeof safeOverrides.runtime === 'object'
          ? safeOverrides.runtime
          : {};
        delete safeOverrides.runtime;
        settings.profile = {
          ...settings.profile,
          ...safeOverrides,
          name,
          identity,
          runtime: {
            ...(settings.profile?.runtime || {}),
            ...runtimeOverrides,
            assignment: {
              ...(settings.profile?.runtime?.assignment || {}),
              ...(runtimeOverrides.assignment || {}),
            },
          },
        };
        return {
          id: memberId,
          name,
          identity,
          state: 'queued',
          error: null,
          settings: this.normalizeSettings(settings),
        };
      });
    } catch (error) {
      return {
        success: false,
        error: boundedError(error?.message, 'The squad template is invalid.'),
      };
    }

    names.forEach((name) => this.reservedNames.add(name));
    const timestamp = new Date().toISOString();
    const squad = {
      id: squadId,
      templateName,
      prefix,
      identity: squadIdentity,
      targetSize: size,
      staggerMs,
      scenario: options.scenario ? clone(options.scenario) : null,
      lastAction: null,
      state: 'launching',
      cancelRequested: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      members,
      job: null,
      settled: false,
    };
    this.squads.set(squad.id, squad);
    const initial = this.emit(squad);
    squad.job = this.runLaunch(squad);
    return { success: true, squad: initial };
  }

  async runLaunch(squad) {
    for (let index = 0; index < squad.members.length; index += 1) {
      if (squad.cancelRequested) break;
      if (index > 0) {
        await this.sleep(squad.staggerMs);
        if (squad.cancelRequested) break;
      }
      const member = squad.members[index];
      member.state = 'starting';
      member.error = null;
      let result;
      try {
        const settings = await this.prepareMemberSettings(member);
        this.emit(squad);
        result = await this.createAgent(settings);
      } catch (error) {
        this.emit(squad);
        result = { success: false, error: error?.message || String(error) };
      }
      if (result?.success) {
        if (squad.cancelRequested) {
          let stopResult;
          try {
            stopResult = await Promise.resolve(this.stopAgent(member.name));
          } catch (error) {
            stopResult = { success: false, error: error?.message || String(error) };
          }
          if (stopResult?.success) {
            member.state = 'stopped';
          } else {
            member.state = 'failed';
            member.error = boundedError(stopResult?.error, `${member.name} started late and could not be stopped.`);
          }
        } else {
          member.state = 'started';
        }
      } else {
        member.state = 'failed';
        member.error = boundedError(result?.error, `${member.name} failed to start.`);
      }
      this.emit(squad);
    }
    if (squad.cancelRequested) {
      squad.state = squad.members.some(({ state }) => state === 'failed') ? 'partial' : 'stopped';
    } else {
      const started = squad.members.filter(({ state }) => state === 'started').length;
      const failed = squad.members.filter(({ state }) => state === 'failed').length;
      if (started === squad.members.length) squad.state = 'running';
      else if (started > 0 && failed > 0) squad.state = 'partial';
      else if (failed === squad.members.length) squad.state = 'failed';
      else squad.state = 'partial';
    }
    squad.settled = true;
    this.emit(squad);
  }

  async waitForIdle(id) {
    const squad = this.squads.get(String(id || ''));
    if (!squad) return null;
    await squad.job;
    return this.snapshot(squad);
  }

  start(id) {
    const squad = this.squads.get(String(id || ''));
    if (!squad) return { success: false, error: 'Squad not found.' };
    if (!squad.settled || !['stopped', 'failed'].includes(squad.state)) {
      return { success: false, error: 'Only a settled stopped or failed squad can be started again.' };
    }
    if (this.activeMemberCount(squad.id) + squad.members.length > this.maxSessionAgents) {
      return { success: false, error: `Starting this squad would exceed the ${this.maxSessionAgents}-bot live session limit.` };
    }
    squad.cancelRequested = false;
    squad.state = 'starting';
    squad.settled = false;
    const initial = this.emit(squad);
    squad.job = this.runStart(squad);
    return { success: true, squad: initial };
  }

  async runStart(squad) {
    for (let index = 0; index < squad.members.length; index += 1) {
      if (squad.cancelRequested) break;
      if (index > 0) {
        await this.sleep(squad.staggerMs);
        if (squad.cancelRequested) break;
      }
      const member = squad.members[index];
      member.state = 'starting';
      member.error = null;
      let result;
      try {
        const settings = await this.prepareMemberSettings(member);
        this.emit(squad);
        result = this.hasAgent(member.name)
          ? await Promise.resolve(this.startAgent(member.name))
          : await this.createAgent(settings);
      } catch (error) {
        this.emit(squad);
        result = { success: false, error: error?.message || String(error) };
      }
      if (result?.success) {
        if (squad.cancelRequested) {
          let stopResult;
          try {
            stopResult = await Promise.resolve(this.stopAgent(member.name));
          } catch (error) {
            stopResult = { success: false, error: error?.message || String(error) };
          }
          if (stopResult?.success) {
            member.state = 'stopped';
          } else {
            member.state = 'failed';
            member.error = boundedError(stopResult?.error, `${member.name} restarted late and could not be stopped.`);
          }
        } else {
          member.state = 'started';
        }
      } else {
        member.state = 'failed';
        member.error = boundedError(result?.error, `${member.name} failed to restart.`);
      }
      this.emit(squad);
    }
    if (squad.cancelRequested) {
      squad.state = squad.members.some(({ state }) => state === 'failed') ? 'partial' : 'stopped';
    } else {
      const started = squad.members.filter(({ state }) => state === 'started').length;
      const failed = squad.members.filter(({ state }) => state === 'failed').length;
      if (started === squad.members.length) squad.state = 'running';
      else if (started > 0) squad.state = 'partial';
      else if (failed === squad.members.length) squad.state = 'failed';
      else squad.state = 'partial';
    }
    squad.settled = true;
    this.emit(squad);
  }

  async stop(id) {
    const squad = this.squads.get(String(id || ''));
    if (!squad) return { success: false, error: 'Squad not found.' };
    squad.cancelRequested = true;
    squad.state = 'stopping';
    this.emit(squad);
    const failures = [];
    for (const member of squad.members) {
      if (!this.hasAgent(member.name)) continue;
      let result;
      try {
        result = await Promise.resolve(this.stopAgent(member.name));
      } catch (error) {
        result = { success: false, error: error?.message || String(error) };
      }
      if (result?.success) {
        member.state = 'stopped';
        member.error = null;
      } else {
        member.state = 'failed';
        member.error = boundedError(result?.error, `${member.name} could not be stopped.`);
        failures.push(`${member.name}: ${member.error}`);
      }
    }
    squad.state = failures.length ? 'partial' : (squad.settled ? 'stopped' : 'stopping');
    const snapshot = this.emit(squad);
    if (failures.length) {
      return {
        success: false,
        error: boundedError(failures.join('; '), 'One or more squad bots could not be stopped.'),
        squad: snapshot,
      };
    }
    return { success: true, squad: snapshot };
  }

  async remove(id) {
    const key = String(id || '');
    const squad = this.squads.get(key);
    if (!squad) return { success: false, error: 'Squad not found.' };
    if (!squad.settled || !['stopped', 'failed'].includes(squad.state)) {
      return { success: false, error: 'Stop the squad and wait for it to settle before removing it.' };
    }
    squad.cancelRequested = true;
    const failures = [];
    const cleanupResults = await Promise.all(squad.members.map(async (member) => {
      if (!this.hasAgent(member.name)) return { member, result: { success: true } };
      let result;
      try {
        result = await this.destroyMember(member.name);
      } catch (error) {
        result = { success: false, error: error?.message || String(error) };
      }
      return { member, result };
    }));
    for (const { member, result } of cleanupResults) {
      if (!result?.success) {
        member.state = 'failed';
        member.error = boundedError(result?.error, `${member.name} could not be removed.`);
        failures.push(`${member.name}: ${member.error}`);
      }
    }
    if (failures.length) {
      squad.state = 'failed';
      return {
        success: false,
        error: boundedError(failures.join('; '), 'One or more squad bots could not be removed.'),
        squad: this.emit(squad),
      };
    }
    squad.members.forEach(({ name }) => this.reservedNames.delete(name));
    this.squads.delete(key);
    return { success: true, id: key, persistence: this.persist() };
  }

  recordAction(id, action = {}) {
    const squad = this.squads.get(String(id || ''));
    if (!squad) return null;
    squad.lastAction = {
      label: boundedError(action.label, 'Squad command'),
      delivery: action.delivery === 'partial' ? 'partial' : action.delivery === 'failed' ? 'failed' : 'accepted',
      completion: 'runtime status required',
      targeted: Math.max(0, Math.trunc(Number(action.targeted) || 0)),
      sent: Math.max(0, Math.trunc(Number(action.sent) || 0)),
      at: new Date().toISOString(),
    };
    return this.emit(squad);
  }

  async destroyMember(name) {
    const result = await Promise.resolve(this.destroyAgent(name));
    if (!result?.pending) return result;
    if (!this.hasAgent(name)) return { success: true, pending: false };
    for (let poll = 0; poll < MAX_FINALIZATION_POLLS; poll += 1) {
      await this.sleep(FINALIZATION_POLL_MS);
      if (!this.hasAgent(name)) return { success: true, pending: false };
    }
    return {
      success: false,
      error: `Agent '${name}' did not finish stopping within 10 seconds.`,
    };
  }
}
