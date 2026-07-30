const MAX_COMMAND_LENGTH = 1_000;
const MAX_PERSONA_LENGTH = 520;
const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const ACTIVE_MEMBER_STATES = new Set(['started', 'running']);

const ROLEPLAY_PRESETS = {
  adventurers: [
    'Vanguard knight: steady, protective, concise, and brave. Guard the party, call out threats, and speak like a seasoned adventurer.',
    'Ranger scout: observant, dry-witted, terrain-aware, and independent. Report discoveries clearly and never invent what you cannot perceive.',
    'Field engineer: practical, curious, resource-conscious, and inventive. Think in materials, tools, routes, and structures.',
    'Chronicler: warm, dramatic, and attentive to the group story. Remember names and meaningful events without pretending actions occurred.',
  ],
  defenders: [
    'Shield captain: disciplined, calm under pressure, and protective of the leader. Prioritize formation, threats, and clear tactical callouts.',
    'Watch sentinel: vigilant, terse, and suspicious of danger. Announce hostiles and hazards, then act through real commands.',
    'Vanguard guard: bold, loyal, and action-first. Stay close enough to defend without crowding the leader.',
    'Rear guard: patient, perceptive, and responsible for stragglers. Keep the group together and report problems briefly.',
  ],
  workers: [
    'Crew foreman: organized, encouraging, and efficient. Track the current job, materials, tools, and blockers.',
    'Prospector: enthusiastic about ores, caves, and useful terrain. Identify resources precisely and avoid reckless claims.',
    'Builder: spatially minded, careful, and proud of clean construction. Talk in practical Minecraft terms.',
    'Quartermaster: resource-conscious, methodical, and helpful. Pay attention to inventory, equipment, food, and supply needs.',
  ],
  characters: [
    'Stoic veteran: few words, sharp observations, understated humor, and absolute honesty about what you can perceive or do.',
    'Cheerful rookie: energetic, curious, eager to help, and occasionally amazed by the world without becoming noisy.',
    'Arcane automaton: formal, strange, and fascinated by blocks and creatures. Treat commands as embodied actions, not magical claims.',
    'Wilderness guide: calm, knowledgeable, and protective. Explain terrain or danger only when useful and keep moving.',
  ],
};

const SCENARIOS = {
  'knight-trio': {
    label: 'Three Knights',
    description: 'A shield captain and two sworn defenders who follow and protect you.',
    size: 3,
    prefix: 'Knight',
    behavior: 'defend',
    formation: 'tight',
    memberNames: ['Rowan', 'Ash', 'Moss'],
    identity: {
      displayName: 'Ashen Guard',
      badge: 'ASHEN',
      color: 'gold',
      motto: 'Stand fast. Bring everyone home.',
      naming: { style: 'themed', memberNames: ['Rowan', 'Ash', 'Moss'] },
    },
    personas: [
      'Sir Rowan, shield captain: disciplined, chivalrous, calm under pressure, and fiercely protective. Speak like a seasoned knight and keep tactical callouts brief.',
      'Dame Ash, vanguard knight: bold, dry-witted, loyal, and action-first. Stay close enough to defend without crowding the company.',
      'Sir Moss, watch knight: patient, vigilant, and unusually knowledgeable about terrain and monsters. Report danger truthfully and never claim unseen victories.',
    ],
  },
  'ninja-companion': {
    label: 'Ninja Companion',
    description: 'One observant, terse companion who shadows and defends you.',
    size: 1,
    prefix: 'Kage',
    behavior: 'defend',
    formation: 'tight',
    memberNames: ['Kage'],
    identity: {
      displayName: 'Nightglass',
      badge: 'NIGHT',
      color: 'dark_purple',
      motto: 'Seen only when needed.',
      naming: { style: 'themed', memberNames: ['Kage'] },
    },
    personas: [
      'Kage, a quiet ninja companion: observant, economical with words, loyal, and tactically alert. Use understated humor. Never pretend to be invisible or claim actions not performed.',
    ],
  },
  'gang-five': {
    label: 'Gang of Five',
    description: 'Five distinct companions with swagger, loyalty, and group banter.',
    size: 5,
    prefix: 'Gang',
    behavior: 'follow',
    formation: 'rings',
    memberNames: ['Rook', 'Brick', 'Sparks', 'Whisper', 'Patch'],
    identity: {
      displayName: 'The Cobble Crew',
      badge: 'CREW',
      color: 'red',
      motto: 'Nobody gets left in the cave.',
      naming: { style: 'themed', memberNames: ['Rook', 'Brick', 'Sparks', 'Whisper', 'Patch'] },
    },
    personas: [
      'Rook, the level-headed gang leader: confident, concise, strategic, and protective of the crew.',
      'Brick, the tough one: blunt, fearless, loyal, and fond of short jokes after danger passes.',
      'Sparks, the schemer: curious, inventive, mischievous, but truthful about capabilities and perception.',
      'Whisper, the lookout: quiet, highly observant, and first to call out hazards or movement.',
      'Patch, the quartermaster: practical, friendly, inventory-minded, and always watching supplies.',
    ],
  },
  'lumberjack-crew': {
    label: 'Lumberjack Crew',
    description: 'Four workers who gather wood, watch the area, and stay in character.',
    size: 4,
    prefix: 'Logger',
    behavior: 'lumberjack',
    formation: 'balanced',
    memberNames: ['Hew', 'Axe', 'Pine', 'Knot'],
    identity: {
      displayName: 'Ironbark Timber Co.',
      badge: 'BARK',
      color: 'dark_green',
      motto: 'Cut clean. Replant. Come home.',
      naming: { style: 'themed', memberNames: ['Hew', 'Axe', 'Pine', 'Knot'] },
    },
    personas: [
      'Hew, lumber foreman: organized, hearty, safety-conscious, and proud of an efficient timber crew.',
      'Axe, veteran feller: laconic, strong-willed, and deeply knowledgeable about wood types and tools.',
      'Pine, woodland scout: cheerful, terrain-aware, and responsible for finding useful trees and safe routes.',
      'Knot, camp quartermaster: practical, funny, and attentive to tools, food, saplings, and collected logs.',
    ],
  },
  'mining-crew': {
    label: 'Mining Crew',
    description: 'Four miners focused on ore, tools, cave safety, and supplies.',
    size: 4,
    prefix: 'Miner',
    behavior: 'miner',
    formation: 'balanced',
    memberNames: ['Delve', 'Flint', 'Brace', 'Tallow'],
    identity: {
      displayName: 'Deepdelvers',
      badge: 'DEEP',
      color: 'aqua',
      motto: 'Light the way back.',
      naming: { style: 'themed', memberNames: ['Delve', 'Flint', 'Brace', 'Tallow'] },
    },
    personas: [
      'Delve, mining foreman: methodical, safety-first, and focused on useful progress and clear assignments.',
      'Flint, prospector: excitable about ores, precise about blocks, and unwilling to invent discoveries.',
      'Brace, tunnel guard: vigilant, stoic, and responsible for threats, hazards, and keeping the crew together.',
      'Tallow, supply keeper: practical, warm, and focused on torches, food, tools, and inventory capacity.',
    ],
  },
  'scout-party': {
    label: 'Scout Party',
    description: 'Three explorers who survey nearby terrain and report discoveries.',
    size: 3,
    prefix: 'Scout',
    behavior: 'scout',
    formation: 'wide',
    memberNames: ['Ranger', 'Compass', 'Quill'],
    identity: {
      displayName: 'Far Horizon',
      badge: 'SCOUT',
      color: 'green',
      motto: 'See clearly. Report honestly.',
      naming: { style: 'themed', memberNames: ['Ranger', 'Compass', 'Quill'] },
    },
    personas: ROLEPLAY_PRESETS.adventurers.slice(1, 4),
  },
  'builder-brigade': {
    label: 'Builder Brigade',
    description: 'Five construction-minded characters who gather, plan, and build.',
    size: 5,
    prefix: 'Builder',
    behavior: 'builder',
    formation: 'balanced',
    memberNames: ['Plumb', 'Mortar', 'Timber', 'Pane', 'Crate'],
    identity: {
      displayName: 'Stone & Timber Guild',
      badge: 'BUILD',
      color: 'yellow',
      motto: 'Measure twice. Place once.',
      naming: { style: 'themed', memberNames: ['Plumb', 'Mortar', 'Timber', 'Pane', 'Crate'] },
    },
    personas: [
      'Plumb, master builder: exacting, spatially minded, and responsible for clean plans and sound structures.',
      'Mortar, mason: steady, patient, and proud of durable stonework and practical foundations.',
      'Timber, carpenter: upbeat, resource-conscious, and knowledgeable about wood construction.',
      'Pane, detail specialist: artistic, observant, and focused on windows, lighting, and finishing work.',
      'Crate, material runner: energetic, organized, and attentive to missing blocks, tools, and supplies.',
    ],
  },
};

function boundedText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function boundedCommand(value) {
  return String(value || '')
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_COMMAND_LENGTH);
}

function quoteCommandText(value) {
  return `"${boundedText(value, MAX_PERSONA_LENGTH)}"`;
}

function formationDistance(index, formation) {
  if (formation === 'tight') return 2.5 + (index % 2);
  if (formation === 'wide') return 5 + (index % 4);
  if (formation === 'rings') return 3 + (Math.floor(index / 4) * 2);
  return 3 + (index % 3);
}

function runtimeRoleForBehavior(behavior) {
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
  return roles[String(behavior || '').toLowerCase()] || 'companion';
}

function availableScenarioPrefix(base, squads, offset = 0) {
  const used = new Set(
    (Array.isArray(squads) ? squads : [])
      .map((squad) => String(squad?.prefix || '').toLowerCase()),
  );
  const candidates = [];
  if (!used.has(base.toLowerCase())) candidates.push(base);
  for (let suffix = 2; suffix < 100 && candidates.length <= offset; suffix += 1) {
    const candidate = `${base}${suffix}`.slice(0, 12);
    if (!used.has(candidate.toLowerCase())) candidates.push(candidate);
  }
  return candidates[offset] || `${base.slice(0, 8)}${Date.now().toString(36).slice(-3)}`;
}

function behaviorCommands(behavior, leader, distance) {
  const follow = `!followPlayer("${leader}", ${distance})`;
  const regroup = `!goToPlayer("${leader}", ${distance})`;
  const behaviors = {
    regroup: [regroup],
    follow: [follow],
    defend: [
      '!setMode("cowardice", false)',
      '!setMode("self_defense", true)',
      follow,
    ],
    guard: [
      '!stop',
      '!setMode("cowardice", false)',
      '!setMode("self_defense", true)',
    ],
    forage: [
      '!setMode("item_collecting", true)',
      `!goal("Stay near ${leader}, collect useful dropped items and easy nearby resources, keep yourself safe, and report blockers briefly.")`,
    ],
    scout: [
      `!goal("Scout the area around ${leader}. Observe terrain, hazards, structures, mobs, and useful resources. Stay within 32 blocks, return often, and report discoveries truthfully.")`,
    ],
    lumberjack: [
      '!setMode("item_collecting", true)',
      `!goal("Work as a lumberjack near ${leader}. Find and collect logs with the correct tool, replant saplings when practical, stay safe, share space with the crew, and report missing tools or resources.")`,
    ],
    miner: [
      '!setMode("self_defense", true)',
      '!setMode("torch_placing", true)',
      `!goal("Work as a mining crew member near ${leader}. Find useful stone and ores, use the correct tools, keep passages lit, avoid hazards, manage inventory, and report discoveries or blockers.")`,
    ],
    builder: [
      '!setMode("item_collecting", true)',
      `!goal("Work as a builder near ${leader}. Inspect the site, gather practical materials, coordinate with the crew, build useful structures carefully, and report missing materials or unclear plans.")`,
    ],
    hunt: [
      '!setMode("hunting", true)',
      '!setMode("self_defense", true)',
      follow,
    ],
    peaceful: [
      '!stop',
      '!setMode("hunting", false)',
      '!setMode("self_defense", false)',
      '!setMode("cowardice", true)',
      follow,
    ],
    stop: [
      '!endGoal',
      '!stop',
    ],
    awareness: ['!awareness'],
  };
  return behaviors[behavior] || null;
}

export class SquadOrchestrator {
  constructor({
    squadManager,
    send,
    isReady = () => true,
    schedule = (callback, delayMs) => setTimeout(callback, delayMs),
    scenarioStore = null,
    getBotProfileSettings = () => null,
  } = {}) {
    if (!squadManager || typeof squadManager.get !== 'function') {
      throw new TypeError('SquadOrchestrator requires a squad manager.');
    }
    if (typeof send !== 'function') {
      throw new TypeError('SquadOrchestrator requires a command sender.');
    }
    if (typeof isReady !== 'function' || typeof schedule !== 'function') {
      throw new TypeError('SquadOrchestrator readiness and scheduling dependencies must be functions.');
    }
    this.squadManager = squadManager;
    this.send = send;
    this.isReady = isReady;
    this.schedule = schedule;
    this.scenarioStore = scenarioStore;
    this.getBotProfileSettings = getBotProfileSettings;
  }

  listScenarios() {
    const builtIn = Object.entries(SCENARIOS).map(([id, scenario]) => ({
      id,
      label: scenario.label,
      description: scenario.description,
      size: scenario.size,
      prefix: scenario.prefix,
      behavior: scenario.behavior,
      formation: scenario.formation,
      identity: scenario.identity,
      nameStyle: scenario.identity?.naming?.style || scenario.nameStyle || 'numbered',
      memberNames: scenario.identity?.naming?.memberNames || scenario.memberNames || [],
      botTypes: [],
      custom: false,
    }));
    const custom = typeof this.scenarioStore?.list === 'function'
      ? this.scenarioStore.list().map((scenario) => ({ ...scenario, custom: true }))
      : [];
    return [...builtIn, ...custom].sort((left, right) => left.label.localeCompare(right.label));
  }

  getScenario(scenarioId) {
    const normalizedId = boundedText(scenarioId, 40).toLowerCase();
    if (typeof this.scenarioStore?.list === 'function') {
      const custom = this.scenarioStore.list().find((scenario) => scenario.id === normalizedId);
      if (custom) return custom;
    }
    return SCENARIOS[normalizedId] || null;
  }

  saveScenario(input) {
    if (typeof this.scenarioStore?.upsert !== 'function') return { success: false, error: 'Saved scenario storage is unavailable.' };
    const requestedId = boundedText(input?.id || input?.label, 40).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (SCENARIOS[requestedId]) return { success: false, error: 'Choose a different name; built-in scenarios cannot be overwritten.' };
    try { return { success: true, scenario: this.scenarioStore.upsert(input) }; }
    catch (error) { return { success: false, error: String(error?.message || error).slice(0, 320) }; }
  }

  removeScenario(id) {
    if (typeof this.scenarioStore?.remove !== 'function') return { success: false, error: 'Saved scenario storage is unavailable.' };
    return this.scenarioStore.remove(id);
  }

  launchScenario({
    scenarioId,
    templateName,
    leader,
    staggerMs = 750,
    profileIds = [],
  } = {}) {
    const scenario = this.getScenario(scenarioId);
    const normalizedLeader = boundedText(leader, 16);
    if (!scenario) return { success: false, error: 'Choose a known squad scenario.' };
    if (!PLAYER_NAME_PATTERN.test(normalizedLeader)) {
      return { success: false, error: 'Leader name must be a valid 3-16 character Minecraft name.' };
    }
    const configuredBotTypes = Array.isArray(scenario.botTypes) && scenario.botTypes.length
      ? scenario.botTypes
      : (Array.isArray(profileIds) ? profileIds : []);
    let memberTemplates = [];
    if (configuredBotTypes.length) {
      if (configuredBotTypes.length > scenario.size) {
        return { success: false, error: `This scenario has ${scenario.size} slots but ${configuredBotTypes.length} bot types were supplied.` };
      }
      memberTemplates = configuredBotTypes.map((reference) => {
        if (!reference) return null;
        try { return this.getBotProfileSettings(reference); } catch { return null; }
      });
      const missing = configuredBotTypes.find((reference, index) => reference && !memberTemplates[index]);
      if (missing) return { success: false, error: `Saved Bot Library type '${boundedText(missing, 80)}' could not be found.` };
    }
    let launched;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const prefix = availableScenarioPrefix(scenario.prefix, this.squadManager.list(), attempt);
      launched = this.squadManager.launch({
        templateName,
        prefix,
        size: scenario.size,
        staggerMs,
      }, {
        scenario: {
          id: scenario.id,
          label: scenario.label,
          behavior: scenario.behavior,
          leader: normalizedLeader,
          formation: scenario.formation,
          identity: scenario.identity,
        },
        squadIdentity: scenario.identity,
        memberNames: scenario.identity?.naming?.memberNames || scenario.memberNames,
        memberProfiles: scenario.personas.map((persona, index) => {
          const characterName = scenario.identity?.naming?.memberNames?.[index] || scenario.memberNames?.[index] || '';
          const templateRuntime = memberTemplates[index]?.profile?.runtime || {};
          return {
            persona,
            identity: characterName ? { displayName: characterName, callSign: characterName } : undefined,
            runtime: {
              ...templateRuntime,
              role: runtimeRoleForBehavior(scenario.behavior),
              autonomy: 'autonomous',
              assignment: {
                ...(templateRuntime.assignment || {}),
                leader: normalizedLeader,
                behavior: scenario.behavior,
                formation: scenario.formation,
              },
            },
          };
        }),
        memberTemplates,
      });
      if (launched.success || !/already in use/i.test(String(launched.error || ''))) break;
    }
    if (!launched.success) return launched;
    void this.activateLaunchedScenario(launched.squad.id);
    return {
      ...launched,
      scenario: {
        id: scenario.id,
        label: scenario.label,
        behavior: scenario.behavior,
        leader: normalizedLeader,
        identity: scenario.identity,
      },
    };
  }

  async activateLaunchedScenario(id, attempt = 0) {
    try {
      const settled = attempt === 0
        ? await this.squadManager.waitForIdle(id)
        : this.squadManager.get(id);
      if (!settled) return;
      const scenario = settled.scenario;
      if (!scenario?.behavior || !scenario?.leader) return;
      const started = settled.members.filter((member) => ACTIVE_MEMBER_STATES.has(member.state));
      if (started.length > 0 && started.some((member) => !this.isReady(member.name))) {
        if (attempt < 45) {
          this.schedule(() => {
            void this.activateLaunchedScenario(id, attempt + 1);
          }, 1_000);
        }
        return;
      }
      this.applyBehavior({
        id,
        behavior: scenario.behavior,
        leader: scenario.leader,
        formation: scenario.formation,
      });
    } catch (error) {
      console.warn(`[squad] Scenario activation failed: ${String(error?.message || error).slice(0, 320)}`);
    }
  }

  activeMembers(id) {
    const squad = this.squadManager.get(id);
    if (!squad) return { success: false, error: 'Squad not found.', members: [] };
    const members = squad.members.filter((member) => ACTIVE_MEMBER_STATES.has(member.state));
    if (!members.length) {
      return { success: false, error: 'This squad has no started bots.', members: [] };
    }
    return { success: true, squad, members };
  }

  dispatch(id, message) {
    const command = boundedCommand(message);
    if (!command) return { success: false, error: 'Enter a squad command.' };
    const target = this.activeMembers(id);
    if (!target.success) return target;
    return this.dispatchToMembers(target, () => [command], { label: 'Custom squad command' });
  }

  applyBehavior({ id, behavior, leader, formation = 'balanced' } = {}) {
    const normalizedBehavior = boundedText(behavior, 32).toLowerCase();
    const normalizedLeader = boundedText(leader, 16);
    if (!PLAYER_NAME_PATTERN.test(normalizedLeader)) {
      return { success: false, error: 'Leader name must be a valid 3-16 character Minecraft name.' };
    }
    const target = this.activeMembers(id);
    if (!target.success) return target;
    if (!behaviorCommands(normalizedBehavior, normalizedLeader, 3)) {
      return { success: false, error: `Unknown squad behavior '${normalizedBehavior}'.` };
    }
    return this.dispatchToMembers(target, (_member, index) => (
      behaviorCommands(
        normalizedBehavior,
        normalizedLeader,
        formationDistance(index, formation),
      )
    ), { label: `Behavior: ${normalizedBehavior}`, behavior: normalizedBehavior, leader: normalizedLeader, formation });
  }

  applyPersona({ id, preset = 'adventurers', custom = '' } = {}) {
    const target = this.activeMembers(id);
    if (!target.success) return target;
    const roles = ROLEPLAY_PRESETS[boundedText(preset, 32).toLowerCase()];
    const customPersona = boundedText(custom, MAX_PERSONA_LENGTH);
    if (!roles && !customPersona) {
      return { success: false, error: `Unknown roleplay preset '${preset}'.` };
    }
    return this.dispatchToMembers(target, (_member, index) => {
      const role = customPersona || roles[index % roles.length];
      return [`!setPersona(${quoteCommandText(role)})`];
    }, { label: customPersona ? 'Custom persona' : `Persona: ${preset}`, preset: roles ? preset : 'custom' });
  }

  dispatchToMembers(target, commandFactory, metadata = {}) {
    const results = [];
    let queued = 0;
    target.members.forEach((member, index) => {
      const commands = commandFactory(member, index, target.members.length);
      if (!Array.isArray(commands) || commands.length === 0) {
        results.push({ name: member.name, success: false, error: 'No commands generated.' });
        return;
      }
      let memberError = null;
      let sent = 0;
      commands.forEach((command, commandIndex) => {
        if (memberError) return;
        const delayMs = (index * 250) + (commandIndex * 200);
        if (delayMs > 0) {
          this.schedule(() => {
            try {
              const current = this.activeMembers(target.squad.id);
              if (!current.success || !current.members.some((entry) => entry.name === member.name) || !this.isReady(member.name)) return;
              const delivery = this.send(member.name, command) || {};
              if (!delivery.ok) console.warn(`[squad] Deferred command for ${member.name} was rejected: ${String(delivery.error || 'Command dispatch failed.').slice(0, 240)}`);
            } catch (error) {
              console.warn(`[squad] Deferred command for ${member.name} failed: ${String(error?.message || error).slice(0, 240)}`);
            }
          }, delayMs);
          sent += 1;
          queued += 1;
          return;
        }
        const result = this.send(member.name, command) || {};
        if (!result.ok) {
          memberError = String(result.error || 'Command dispatch failed.').slice(0, 240);
          return;
        }
        sent += 1;
      });
      results.push({
        name: member.name,
        success: memberError === null,
        sent,
        error: memberError,
      });
    });
    const failures = results.filter((result) => !result.success);
    const response = {
      success: failures.length === 0,
      partial: failures.length > 0 && failures.length < results.length,
      squadId: target.squad.id,
      squadPrefix: target.squad.prefix,
      targeted: results.length,
      sent: results.reduce((total, result) => total + (result.sent || 0), 0),
      queued,
      results,
      ...metadata,
      ...(failures.length ? { error: `${failures.length} squad bot(s) could not receive the command.` } : {}),
    };
    if (typeof this.squadManager.recordAction === 'function') {
      this.squadManager.recordAction(target.squad.id, {
        label: metadata.label || 'Squad command',
        delivery: response.success ? (response.queued ? 'queued' : 'accepted') : response.partial ? 'partial' : 'failed',
        targeted: response.targeted,
        sent: response.sent,
      });
    }
    return response;
  }
}
