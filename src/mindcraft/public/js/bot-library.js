import { api } from './api.js';
import { button, clear, gridField, input, node, select } from './utils.js';

const TYPES = [
  ['companion', 'Companion'], ['defender', 'Defender'], ['attacker', 'Attacker'],
  ['builder', 'Builder'], ['miner', 'Miner'], ['scout', 'Scout'], ['lumberjack', 'Lumberjack'], ['custom', 'Custom'],
];
const AUTONOMY = [
  { value: 'command', label: 'Command only' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'autonomous', label: 'Autonomous' },
];
const VISION_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'on_demand', label: 'On request' },
  { value: 'hybrid', label: 'Hybrid sensing' },
];
const SURVIVAL_MODES = [
  { value: 'full', label: 'Full survival intelligence' },
  { value: 'basic', label: 'Food basics only' },
  { value: 'off', label: 'Off' },
];
const SHELTER_POLICIES = [
  { value: 'emergency', label: 'Seek or build emergency shelter' },
  { value: 'seek', label: 'Seek existing shelter' },
  { value: 'off', label: 'No autonomous shelter' },
];
const COMBAT_REFLEX_POLICIES = [
  { value: 'role', label: 'Use role policy' },
  { value: 'defend', label: 'Defend when threatened' },
  { value: 'avoid', label: 'Avoid combat' },
  { value: 'off', label: 'No combat reflex' },
];
const SLEEP_POLICIES = [
  { value: 'safe', label: 'Sleep when safely reachable' },
  { value: 'off', label: 'Do not sleep autonomously' },
];
const ARMOR_POLICIES = [
  { value: 'upgrade', label: 'Equip verified upgrades' },
  { value: 'off', label: 'Keep current equipment' },
];
const USEFUL_DROP_POLICIES = [
  { value: 'collect', label: 'Collect useful nearby drops' },
  { value: 'ignore', label: 'Ignore optional drops' },
];
const JOB_MODES = [
  { value: 'resumable', label: 'Resumable role jobs' },
  { value: 'simple', label: 'Simple role loop' },
  { value: 'off', label: 'No autonomous jobs' },
];
const DEPOSIT_POLICIES = [
  { value: 'inventory', label: 'Keep in inventory' },
  { value: 'leader', label: 'Deliver to leader' },
  { value: 'assigned', label: 'Assigned chest or barrel' },
];
const REACTION_MODES = [
  { value: 'natural', label: 'Natural awareness' },
  { value: 'minimal', label: 'Critical reactions only' },
  { value: 'off', label: 'Off' },
];
const NAMEPLATE_COLORS = [
  'gray', 'white', 'gold', 'yellow', 'green', 'dark_green', 'aqua', 'dark_aqua',
  'blue', 'dark_blue', 'red', 'dark_red', 'light_purple', 'dark_purple',
].map((value) => ({ value, label: value.replaceAll('_', ' ') }));
const CHARACTER_PRESETS = [
  { label: 'Knight', color: 'gold', name: 'Sir Rowan', agentName: 'Rowan_Guard', callSign: 'Aegis', title: 'Shield of the Ashen Guard', type: 'defender', role: 'Shield captain', job: 'Escort and defend', attitude: 'Disciplined, loyal, calm under pressure', style: 'Brief chivalric tactical callouts', specialties: 'escort, threat interception, formation discipline', appearance: 'Iron and gold knight with a weathered shield' },
  { label: 'Ninja', color: 'dark_purple', name: 'Kage', agentName: 'Kage_Shadow', callSign: 'Kage', title: 'The Quiet Step', type: 'scout', role: 'Silent pathfinder', job: 'Scout and protect', attitude: 'Observant, restrained, dry-witted', style: 'Sparse, precise reports', specialties: 'stealthy routes, reconnaissance, hazard avoidance', appearance: 'Charcoal traveler with a dark purple accent' },
  { label: 'Miner', color: 'aqua', name: 'Flint Deepdelver', agentName: 'Flint_Delve', callSign: 'Flint', title: 'Prospector of the Deep', type: 'miner', role: 'Cave prospector', job: 'Mine resources safely', attitude: 'Methodical, curious, safety-first', style: 'Practical resource and cave reports', specialties: 'ore recognition, tool selection, cave safety', appearance: 'Stone-gray work gear with torch-bright trim' },
  { label: 'Lumberjack', color: 'dark_green', name: 'Hew Ironbark', agentName: 'Hew_Ironbark', callSign: 'Hew', title: 'Foreman of Ironbark Timber', type: 'lumberjack', role: 'Timber foreman', job: 'Gather wood and replant', attitude: 'Hearty, organized, good-humored', style: 'Warm crew chatter and direct work reports', specialties: 'tree recognition, axe use, replanting', appearance: 'Green flannel, heavy boots, iron axe' },
  { label: 'Builder', color: 'yellow', name: 'Plumb', agentName: 'Plumb_Builder', callSign: 'Plumb', title: 'Master of Stone & Timber', type: 'builder', role: 'Master builder', job: 'Plan and construct', attitude: 'Exacting, inventive, resource-conscious', style: 'Clear spatial and material language', specialties: 'layout, material planning, placement verification', appearance: 'Copper-accented builder with a rolled blueprint' },
  { label: 'Scout', color: 'green', name: 'Vesper', agentName: 'Vesper_Scout', callSign: 'Vesper', title: 'Far Horizon Pathfinder', type: 'scout', role: 'Wilderness scout', job: 'Explore and report', attitude: 'Calm, alert, independent', style: 'Short verified terrain reports', specialties: 'navigation, biome recognition, threat spotting', appearance: 'Travel-worn green cloak with a brass compass' },
];

function textarea(id, value = '') {
  const control = document.createElement('textarea');
  control.id = id;
  control.value = value || '';
  control.maxLength = 520;
  control.rows = 3;
  return control;
}

function editorSection(eyebrow, title, detail = '') {
  const section = node('section', 'identity-editor-section');
  const heading = node('div', 'identity-editor-heading');
  const copy = node('div');
  copy.append(node('span', 'eyebrow', eyebrow), node('h4', '', title));
  if (detail) copy.append(node('p', 'muted small', detail));
  heading.append(copy);
  section.append(heading);
  return section;
}

export class BotLibraryPanel {
  constructor(activity, announce) {
    this.activity = activity;
    this.announce = announce;
    this.profiles = [];
    this.capabilities = { services: [], providers: [] };
    this.providerCatalog = [
      { id: 'openai', label: 'OpenAI / Codex', examples: ['gpt-5.4-mini', 'codex-mini-latest'] },
      { id: 'deepseek', label: 'DeepSeek', examples: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
      { id: 'anthropic', label: 'Anthropic / Claude', examples: ['claude-sonnet-4-5'] },
      { id: 'google', label: 'Google Gemini', examples: ['gemini-2.5-flash'] },
      { id: 'ollama', label: 'Ollama (local)', examples: ['qwen2.5:3b', 'llama3.2'] },
      { id: 'lmstudio', label: 'LM Studio (local)', examples: ['local model id'] },
      { id: 'vllm', label: 'vLLM (local)', examples: ['served model id'] },
      { id: 'groq', label: 'Groq', examples: ['llama-3.3-70b-versatile'] },
      { id: 'mistral', label: 'Mistral', examples: ['mistral-large-latest'] },
      { id: 'xai', label: 'xAI / Grok', examples: ['grok-3-mini'] },
      { id: 'qwen', label: 'Qwen', examples: ['qwen-max'] },
      { id: 'openrouter', label: 'OpenRouter', examples: ['provider/model-name'] },
      { id: 'openai-compatible', label: 'OpenAI-compatible endpoint', examples: ['provider/model-name'] },
      { id: 'custom', label: 'Custom OpenAI-compatible endpoint', examples: ['provider/model-name'] },
    ];
    this.storage = { writable: true, error: null };
    this.catalogDefaults = {
      provider: { id: 'ollama', chatModel: '' },
      connection: { host: '127.0.0.1', port: 25565 },
    };
    this.editingId = '';
    this.formStatus = '';
  }

  mount() {
    const panel = node('section', 'panel bot-library-panel');
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(
      node('span', 'eyebrow', 'Reusable characters'),
      node('h2', '', 'Bot Library'),
      node('p', 'muted small', 'Save a role, personality, provider, and Minecraft target once. Spawn it later without rebuilding settings.'),
    );
    heading.append(copy, node('span', 'state-badge state-ready', 'No secrets stored'));
    panel.append(heading);
    const layout = node('div', 'bot-library-layout');
    this.list = node('div', 'bot-library-list');
    this.form = node('div', 'bot-library-form');
    layout.append(this.list, this.form);
    panel.append(layout);
    this.root = panel;
    this.render();
    return panel;
  }

  async load() {
    const [library, capabilities, catalog] = await Promise.all([api('/bot-library'), api('/provider-capabilities'), api('/bot-library/catalog')]);
    if (library.success) {
      this.profiles = Array.isArray(library.profiles) ? library.profiles : [];
      this.storage = library.storage || this.storage;
    }
    if (capabilities.success) this.capabilities = capabilities;
    if (catalog.success && Array.isArray(catalog.providers) && catalog.providers.length) {
      this.providerCatalog = catalog.providers;
      this.catalogDefaults = {
        provider: { ...this.catalogDefaults.provider, ...(catalog.defaults?.provider || {}) },
        connection: { ...this.catalogDefaults.connection, ...(catalog.defaults?.connection || {}) },
      };
    }
    this.render();
  }

  render() {
    if (!this.root) return;
    this.renderList();
    this.renderForm();
  }

  renderList() {
    if (!this.list) return;
    clear(this.list);
    const header = node('div', 'bot-library-list-heading');
    header.append(node('strong', '', `${this.profiles.length} saved character${this.profiles.length === 1 ? '' : 's'}`));
    header.append(button('New Bot Type', () => { this.editingId = ''; this.formStatus = ''; this.renderForm(); }, 'primary compact'));
    this.list.append(header);
    if (!this.storage.writable) this.list.append(node('div', 'warning-copy small', this.storage.error || 'Saved bot library is read-only until its file is repaired.'));
    if (!this.profiles.length) {
      this.list.append(node('div', 'empty-state compact', 'No saved bot types yet. Create one on the right.'));
      return;
    }
    this.profiles.forEach((profile) => {
      const card = node('article', `bot-library-card ${profile.id === this.editingId ? 'is-selected' : ''}`);
      const identity = profile.identity || {};
      const character = node('div', 'bot-library-character');
      const glyph = node('span', 'character-glyph', (identity.callSign || profile.name || 'BOT').slice(0, 2).toUpperCase());
      const title = node('div', 'bot-library-card-title');
      const titleCopy = node('div');
      titleCopy.append(
        node('strong', '', identity.displayName || profile.name),
        node('span', 'muted small', identity.title || profile.role || 'General companion'),
      );
      title.append(titleCopy, node('span', 'profile-badge', profile.type || 'companion'));
      character.append(glyph, title);
      card.append(character);
      card.append(node('div', 'bot-library-card-detail', `${identity.callSign ? `${identity.callSign} · ` : ''}${profile.agentName} · ${profile.provider?.chatModel || 'No chat model selected'}`));
      const status = node('div', 'bot-library-status muted small', 'Provider not tested');
      card.append(status);
      const actions = node('div', 'actions');
      const checkButton = button('Check AI', async () => {
          if (checkButton.disabled) return;
          checkButton.disabled = true;
          checkButton.textContent = 'Checking…';
          status.textContent = 'Checking…';
          try {
            const result = await api(`/bot-library/${encodeURIComponent(profile.id)}/test`);
            status.textContent = result.success && result.readiness?.ready
              ? result.readiness?.verified === false ? 'Ready to start; endpoint validates on launch' : 'Ready to start'
              : result.readiness?.reason || result.error || 'Provider is not ready';
            status.className = `bot-library-status ${result.success && result.readiness?.ready ? 'success-copy' : 'warning-copy'} small`;
          } finally {
            if (checkButton.isConnected) {
              checkButton.disabled = false;
              checkButton.textContent = 'Check AI';
            }
          }
        }, 'compact');
      const deployButton = button('Deploy Bot', async () => {
          if (deployButton.disabled) return;
          deployButton.disabled = true;
          deployButton.textContent = 'Deploying…';
          status.textContent = 'Requesting deployment…';
          try {
            const result = await api(`/bot-library/${encodeURIComponent(profile.id)}/spawn`, { agentName: profile.agentName });
            status.textContent = result.success ? 'Deployment accepted · watch Bots for connection status' : result.error || 'Deployment failed';
            status.className = `bot-library-status ${result.success ? 'success-copy' : 'warning-copy'} small`;
            this.announce?.(result.success ? `${profile.name} is starting.` : result.error || 'Bot spawn failed.');
            this.activity?.add('AGENT', result.success ? `${profile.name}: library spawn accepted` : `${profile.name}: ${result.error || 'spawn failed'}`, result.success ? 'ok' : 'err');
          } finally {
            if (deployButton.isConnected) {
              deployButton.disabled = false;
              deployButton.textContent = 'Deploy Bot';
            }
          }
        }, 'success compact');
      actions.append(
        button('Edit', () => { this.editingId = profile.id; this.formStatus = ''; this.render(); }, 'compact'),
        checkButton,
        deployButton,
        button('Delete', async () => {
          if (!window.confirm(`Delete the saved bot type '${profile.name}'? Existing agents are not removed.`)) return;
          const result = await api('/bot-library/delete', { id: profile.id });
          if (result.success) {
            this.profiles = this.profiles.filter((entry) => entry.id !== profile.id);
            if (this.editingId === profile.id) this.editingId = '';
            this.render();
          } else this.announce?.(result.error || 'Bot profile could not be deleted.');
        }, 'danger compact'),
      );
      card.append(actions);
      this.list.append(card);
    });
  }

  renderForm() {
    if (!this.form) return;
    clear(this.form);
    const current = this.profiles.find((profile) => profile.id === this.editingId) || {};
    const heading = node('div', 'bot-library-form-heading');
    heading.append(node('h3', '', current.id ? 'Edit Bot Type' : 'Create Bot Type'), node('span', 'muted small', 'Provider keys stay server-side.'));
    this.form.append(heading);
    const capability = node('div', 'provider-capability-strip');
    const localServices = Array.isArray(this.capabilities.services) ? this.capabilities.services : [];
    ['ollama', 'lm-studio', 'vllm'].forEach((id) => {
      const service = localServices.find((entry) => entry.id === id);
      capability.append(node('span', service?.available ? 'is-ready' : 'needs-setup', `${service?.label || id}: ${service?.available ? 'ready' : 'offline'}`));
    });
    this.form.append(capability);
    const controls = {};
    const identity = current.identity || {};
    const runtime = current.runtime || {};
    const runtimeIdentity = runtime.identity || {};
    controls.name = input('libraryName', 'text', current.name || '');
    controls.agentName = input('libraryAgentName', 'text', current.agentName || '');
    let agentNameEdited = Boolean(current.agentName);
    controls.agentName.addEventListener('input', () => { agentNameEdited = true; });
    controls.name.addEventListener('input', () => {
      if (agentNameEdited) return;
      controls.agentName.value = controls.name.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    });
    controls.callSign = input('libraryCallSign', 'text', identity.callSign || '');
    controls.title = input('libraryTitle', 'text', identity.title || '');
    controls.badge = input('libraryBadge', 'text', identity.nameplate?.badge || '');
    controls.nameplateColor = select('libraryNameplateColor', NAMEPLATE_COLORS, identity.nameplate?.color || 'gray');
    controls.type = select('libraryType', TYPES.map(([value, label]) => ({ value, label })), current.type || 'companion');
    controls.role = input('libraryRole', 'text', current.role || '');
    controls.job = input('libraryJob', 'text', current.job || '');
    controls.persona = textarea('libraryPersona', current.persona || '');
    controls.appearance = input('libraryAppearance', 'text', current.appearance || '');
    controls.language = input('libraryLanguage', 'text', runtimeIdentity.language || 'en');
    controls.attitude = input('libraryAttitude', 'text', runtimeIdentity.attitude || '');
    controls.style = input('libraryStyle', 'text', runtimeIdentity.style || '');
    controls.specialties = input('librarySpecialties', 'text', (runtimeIdentity.specialties || []).join(', '));
    controls.autonomy = select('libraryAutonomy', AUTONOMY, runtime.autonomy || 'balanced');
    controls.combatReflex = select('libraryCombatReflex', COMBAT_REFLEX_POLICIES, runtime.reflexes?.combat || 'role');
    controls.survivalMode = select('librarySurvivalMode', SURVIVAL_MODES, runtime.survival?.mode || 'full');
    controls.shelterPolicy = select('libraryShelterPolicy', SHELTER_POLICIES, runtime.survival?.shelter || 'emergency');
    controls.sleepPolicy = select('librarySleepPolicy', SLEEP_POLICIES, runtime.survival?.sleep || 'safe');
    controls.armorPolicy = select('libraryArmorPolicy', ARMOR_POLICIES, runtime.survival?.armor || 'upgrade');
    controls.usefulDrops = select('libraryUsefulDrops', USEFUL_DROP_POLICIES, runtime.survival?.usefulDrops || 'collect');
    controls.eatAt = input('libraryEatAt', 'number', runtime.survival?.eatAt ?? 14);
    controls.criticalFood = input('libraryCriticalFood', 'number', runtime.survival?.criticalFood ?? 6);
    controls.reserveFood = input('libraryReserveFood', 'number', runtime.survival?.reserveFoodPoints ?? 12);
    controls.jobMode = select('libraryJobMode', JOB_MODES, runtime.jobs?.mode || 'resumable');
    controls.stockpileLimit = input('libraryStockpileLimit', 'number', runtime.jobs?.stockpileLimit || 128);
    controls.depositPolicy = select('libraryDepositPolicy', DEPOSIT_POLICIES, runtime.jobs?.deposit || 'inventory');
    controls.leader = input('libraryLeader', 'text', runtime.assignment?.leader || '');
    controls.depositName = input('libraryDepositName', 'text', runtime.assignment?.deposit?.name || 'assigned_deposit');
    controls.depositX = input('libraryDepositX', 'number', runtime.assignment?.deposit?.x ?? '');
    controls.depositY = input('libraryDepositY', 'number', runtime.assignment?.deposit?.y ?? '');
    controls.depositZ = input('libraryDepositZ', 'number', runtime.assignment?.deposit?.z ?? '');
    controls.reactionMode = select('libraryReactionMode', REACTION_MODES, runtime.reactions?.mode || 'natural');
    controls.maxSpeech = input('libraryMaxSpeech', 'number', runtime.reactions?.maxSpeechPerMinute ?? 4);
    controls.visionMode = select(
      'libraryVisionMode',
      VISION_MODES,
      runtime.vision?.mode || (current.id ? (current.behavior?.allowVision ? 'hybrid' : 'off') : 'hybrid'),
    );
    controls.teamMemory = select('libraryTeamMemory', [
      { value: 'explicit', label: 'Explicit squad facts' },
      { value: 'off', label: 'Private only' },
    ], runtime.memory?.team || 'explicit');
    controls.provider = select('libraryProvider', [
      ...this.providerCatalog.map((provider) => ({ value: provider.id, label: provider.label })),
    ], current.provider?.id || this.catalogDefaults.provider.id || 'ollama');
    const providerStatus = node('div', 'provider-selection-note');
    const updateProviderStatus = () => {
      const selected = this.providerCatalog.find((provider) => provider.id === controls.provider.value);
      if (!selected) { providerStatus.textContent = ''; return; }
      if (selected.credentialEnv && selected.credentialConfigured === false) {
        providerStatus.className = 'provider-selection-note needs-setup';
        providerStatus.textContent = `${selected.label} needs a key. Open “Advanced setup” below, save ${selected.credentialEnv}, then return here.`;
      } else if (selected.credentialEnv) {
        providerStatus.className = 'provider-selection-note is-ready';
        providerStatus.textContent = `${selected.label} is configured. Its key stays server-side and is never saved in this bot profile.`;
      } else if (selected.requiresBaseUrl) {
        providerStatus.className = 'provider-selection-note needs-setup';
        providerStatus.textContent = `${selected.label}: provide the HTTP(S) API base URL. The endpoint is checked when the bot starts.`;
      } else {
        const serviceId = selected.id === 'lmstudio' ? 'lm-studio' : selected.id;
        const service = localServices.find((entry) => entry.id === serviceId);
        providerStatus.className = `provider-selection-note ${service?.available ? 'is-ready' : 'needs-setup'}`;
        providerStatus.textContent = service?.available
          ? `${selected.label} is running on this computer.`
          : `${selected.label} is not currently reachable. Start it before deploying this bot.`;
      }
      const providerHints = selected.examples || [];
      if (!controls.chatModel.value.trim() || controls.chatModel.dataset.autoDefault === 'true') {
        controls.chatModel.value = providerHints[0] || '';
        controls.chatModel.dataset.autoDefault = 'true';
      }
      clear(modelHints);
      providerHints.forEach((example) => {
        const option = document.createElement('option');
        option.value = example;
        modelHints.append(option);
      });
      advancedProvider.open = Boolean(selected.requiresBaseUrl);
    };
    controls.chatModel = input('libraryChatModel', 'text', current.provider?.chatModel || this.catalogDefaults.provider.chatModel || '');
    controls.chatModel.dataset.autoDefault = current.provider?.chatModel ? 'false' : 'true';
    controls.chatModel.addEventListener('input', () => { controls.chatModel.dataset.autoDefault = 'false'; });
    controls.codeModel = input('libraryCodeModel', 'text', current.provider?.codeModel || '');
    controls.visionModel = input('libraryVisionModel', 'text', current.provider?.visionModel || '');
    controls.embeddingModel = input('libraryEmbeddingModel', 'text', current.provider?.embeddingModel || '');
    controls.baseUrl = input('libraryBaseUrl', 'url', current.provider?.baseUrl || '');
    controls.host = input('libraryHost', 'text', current.connection?.host || this.catalogDefaults.connection.host || '127.0.0.1');
    controls.port = input('libraryPort', 'number', current.connection?.port || this.catalogDefaults.connection.port || 25565);
    const modelHints = document.createElement('datalist');
    modelHints.id = 'libraryKnownModels';
    controls.chatModel.setAttribute('list', modelHints.id);
    controls.codeModel.setAttribute('list', modelHints.id);
    const advancedProvider = document.createElement('details');
    advancedProvider.className = 'library-disclosure';
    const advancedProviderSummary = document.createElement('summary');
    advancedProviderSummary.textContent = 'Advanced AI models and endpoint';
    advancedProvider.append(advancedProviderSummary);
    controls.provider.addEventListener('change', updateProviderStatus);
    const preview = node('div', 'identity-preview');
    const previewGlyph = node('span', 'character-glyph character-glyph-large', '');
    const previewCopy = node('div');
    const previewName = node('strong', '', '');
    const previewMeta = node('span', 'muted small', '');
    const previewRole = node('span', 'identity-preview-role', '');
    previewCopy.append(previewName, previewMeta, previewRole);
    preview.append(previewGlyph, previewCopy);
    const updatePreview = () => {
      const displayName = controls.name.value.trim() || 'Unnamed character';
      const callSign = controls.callSign.value.trim();
      const title = controls.title.value.trim();
      previewGlyph.textContent = (callSign || displayName || 'BOT').slice(0, 2).toUpperCase();
      previewName.textContent = displayName;
      previewMeta.textContent = [callSign, title].filter(Boolean).join(' · ') || 'Add a call sign or title';
      previewRole.textContent = `${controls.type.options[controls.type.selectedIndex]?.text || 'Companion'} · ${controls.job.value.trim() || controls.role.value.trim() || 'job not assigned'}`;
    };
    [controls.name, controls.callSign, controls.title, controls.type, controls.job, controls.role]
      .forEach((control) => control.addEventListener('input', updatePreview));
    controls.type.addEventListener('change', updatePreview);
    updatePreview();
    const presetRow = node('div', 'identity-preset-row');
    CHARACTER_PRESETS.forEach((preset) => {
      const applyPreset = button(preset.label, () => {
        controls.name.value = preset.name;
        controls.agentName.value = preset.agentName;
        controls.callSign.value = preset.callSign;
        controls.title.value = preset.title;
        controls.type.value = preset.type;
        controls.role.value = preset.role;
        controls.job.value = preset.job;
        controls.attitude.value = preset.attitude;
        controls.style.value = preset.style;
        controls.specialties.value = preset.specialties;
        controls.appearance.value = preset.appearance;
        controls.badge.value = preset.type.slice(0, 8).toUpperCase();
        controls.nameplateColor.value = preset.color;
        agentNameEdited = true;
        updatePreview();
      }, 'compact identity-preset');
      applyPreset.title = `Fill the editor with a ${preset.label.toLowerCase()} character starter. Every field remains editable.`;
      presetRow.append(applyPreset);
    });

    const characterSection = editorSection(
      'Character identity',
      'Who joins the world',
      'The friendly identity can be expressive. The Minecraft login remains a separate stable runtime key.',
    );
    const characterGrid = node('div', 'grid-2 identity-editor-grid');
    characterGrid.append(
      gridField('Display name', controls.name, 'Shown throughout the control center.'),
      gridField('Minecraft login name', controls.agentName, 'Stable 3–16 character process and world identity.'),
      gridField('Bot type', controls.type),
      gridField('Primary job', controls.job),
    );
    const personaField = gridField('Persona', controls.persona, 'Character affects language and priorities, never claimed world facts or action success.');
    personaField.classList.add('identity-editor-wide');
    const characterAdvanced = document.createElement('details');
    characterAdvanced.className = 'library-disclosure';
    const characterAdvancedSummary = document.createElement('summary');
    characterAdvancedSummary.textContent = 'Character details and nameplate';
    const characterAdvancedGrid = node('div', 'grid-2 identity-editor-grid');
    characterAdvancedGrid.append(
      gridField('Call sign', controls.callSign, 'Short name used in squad chatter.'),
      gridField('Title', controls.title, 'For example: Shield of the Ashen Guard.'),
      gridField('Role brief', controls.role),
      gridField('Appearance theme', controls.appearance, 'Descriptive only until a Paper-compatible skin path is configured.'),
      gridField('Nameplate badge', controls.badge, 'Up to 12 characters; future Paper nameplate presentation.'),
      gridField('Nameplate color', controls.nameplateColor),
    );
    characterAdvanced.append(characterAdvancedSummary, characterAdvancedGrid);
    characterSection.append(preview, presetRow, characterGrid, personaField, characterAdvanced);

    const behaviorSection = editorSection(
      'Behavior & voice',
      'How this character thinks and speaks',
      'These settings now travel with the saved bot instead of being discarded at launch.',
    );
    const behaviorGrid = node('div', 'grid-2 identity-editor-grid');
    behaviorGrid.append(
      gridField('Autonomy', controls.autonomy, 'Balanced follows orders, handles danger, and performs its assigned role.'),
      gridField('Survival', controls.survivalMode, 'Full survival handles food, recovery, armor, beds, weather, and shelter.'),
      gridField('Role jobs', controls.jobMode, 'Resumable jobs checkpoint verified phases and recover from blockers.'),
      gridField('Environmental reactions', controls.reactionMode, 'Natural awareness notices nearby players, danger, work, items, structures, and terrain.'),
      gridField('Speech style', controls.style, 'Concise tactical callouts, warm roleplay, dry humor…'),
    );
    const behaviorAdvanced = document.createElement('details');
    behaviorAdvanced.className = 'library-disclosure';
    const behaviorAdvancedSummary = document.createElement('summary');
    behaviorAdvancedSummary.textContent = 'Memory, perception, language, and specialties';
    const behaviorAdvancedGrid = node('div', 'grid-2 identity-editor-grid');
    behaviorAdvancedGrid.append(
      gridField('Language', controls.language, 'Examples: en, Spanish, pirate-flavored English.'),
      gridField('Attitude', controls.attitude, 'Calm, protective, sardonic, eager, formal…'),
      gridField('Specialties', controls.specialties, 'Comma-separated gameplay strengths.'),
      gridField('Vision policy', controls.visionMode, 'Hybrid uses structured state first and model vision only when needed.'),
      gridField('Squad memory', controls.teamMemory, 'Only explicit mission/world facts are shared.'),
      gridField('Combat reflex', controls.combatReflex, 'Role follows the selected character type; avoid, defend, and off are hard overrides.'),
      gridField('Eat at hunger', controls.eatAt, 'Starts normal food upkeep at this hunger level (1–20).'),
      gridField('Critical hunger', controls.criticalFood, 'May preempt lower-priority work at or below this level (0–20).'),
      gridField('Food reserve points', controls.reserveFood, 'Keeps this many carried food points before optional work (0–40).'),
      gridField('Sleep policy', controls.sleepPolicy, 'Safe sleep uses only a reachable bed without a nearby threat.'),
      gridField('Shelter policy', controls.shelterPolicy, 'Emergency permits only the fixed validated survival shelter blueprint.'),
      gridField('Armor policy', controls.armorPolicy, 'Upgrade equips only a stronger verified carried armor piece.'),
      gridField('Useful drops', controls.usefulDrops, 'Controls optional pickup of nearby food, tools, armor, and resources.'),
      gridField('Stockpile target', controls.stockpileLimit, 'Builders balance planks and cobblestone; miners and lumberjacks keep role materials.'),
      gridField('Delivery policy', controls.depositPolicy, 'Keep output, hand it to the leader, or use one exact assigned container.'),
      gridField('Leader name', controls.leader, 'Used by delivery and squad assignment policies.'),
      gridField('Ambient speech / minute', controls.maxSpeech, 'A hard budget; silence remains a valid response.'),
    );
    const depositGrid = node('div', 'grid-2 identity-editor-grid');
    depositGrid.append(
      gridField('Deposit label', controls.depositName),
      gridField('Deposit X', controls.depositX),
      gridField('Deposit Y', controls.depositY),
      gridField('Deposit Z', controls.depositZ),
    );
    const memory = document.createElement('input'); memory.type = 'checkbox'; memory.checked = current.id ? Boolean(current.behavior?.loadMemory) : true; memory.id = 'libraryLoadMemory';
    const chatInGame = document.createElement('input'); chatInGame.type = 'checkbox'; chatInGame.checked = current.behavior?.chatInGame !== false; chatInGame.id = 'libraryChatInGame';
    const flags = node('div', 'identity-toggle-row');
    flags.append(this.checkbox(memory, 'Load personal memory'), this.checkbox(chatInGame, 'Chat in game'));
    behaviorAdvanced.append(behaviorAdvancedSummary, behaviorAdvancedGrid, depositGrid, flags);
    behaviorSection.append(behaviorGrid, behaviorAdvanced);

    const providerSection = editorSection(
      'Brain & provider',
      'Choose the models',
      'Credentials remain server-side. Local providers are checked before launch.',
    );
    const providerGrid = node('div', 'grid-2 identity-editor-grid');
    providerGrid.append(
      gridField('Chat provider', controls.provider),
      gridField('Chat model', controls.chatModel, 'This bot’s reasoning model. Suggestions change with the provider.'),
    );
    const advancedProviderGrid = node('div', 'grid-2 identity-editor-grid');
    advancedProviderGrid.append(
      gridField('Code model (optional)', controls.codeModel, 'Used for code-capable tasks; leave blank to reuse the chat model.'),
      gridField('Vision model (optional)', controls.visionModel),
      gridField('Embedding model (optional)', controls.embeddingModel),
      gridField('Provider base URL (compatible/custom)', controls.baseUrl),
    );
    advancedProvider.append(advancedProviderSummary, advancedProviderGrid);
    providerSection.append(providerStatus, modelHints, providerGrid, advancedProvider);
    updateProviderStatus();

    const connectionSection = editorSection(
      'World connection',
      'Where this bot logs in',
      'These values are independent from the character and model choices above.',
    );
    const connectionGrid = node('div', 'grid-2 identity-editor-grid');
    connectionGrid.append(
      gridField('Minecraft host', controls.host),
      gridField('Minecraft port', controls.port),
    );
    connectionSection.append(connectionGrid);
    this.form.append(characterSection, behaviorSection, providerSection, connectionSection);
    const result = node('div', 'status-text muted', this.formStatus);
    const actions = node('div', 'actions');
    const buildPayload = () => {
      const depositCoordinates = [controls.depositX.value, controls.depositY.value, controls.depositZ.value];
      const deposit = depositCoordinates.every((value) => value !== '' && Number.isFinite(Number(value)))
        ? {
            name: controls.depositName.value.trim() || 'assigned_deposit',
            x: Number(controls.depositX.value),
            y: Number(controls.depositY.value),
            z: Number(controls.depositZ.value),
          }
        : null;
      return {
      ...(current.id ? { id: current.id } : {}),
      name: controls.name.value.trim(), agentName: controls.agentName.value.trim(), type: controls.type.value,
      role: controls.role.value.trim(), job: controls.job.value.trim(), persona: controls.persona.value.trim(), appearance: controls.appearance.value.trim(),
      identity: {
        displayName: controls.name.value.trim(),
        callSign: controls.callSign.value.trim(),
        title: controls.title.value.trim(),
        appearance: controls.appearance.value.trim(),
        nameplate: {
          badge: controls.badge.value.trim(),
          color: controls.nameplateColor.value,
        },
      },
      runtime: {
        schemaVersion: 1,
         role: controls.type.value,
         autonomy: controls.autonomy.value,
         reflexes: { combat: controls.combatReflex.value },
         survival: {
           ...(current.runtime?.survival || {}),
           mode: controls.survivalMode.value,
           eatAt: Number(controls.eatAt.value),
           criticalFood: Number(controls.criticalFood.value),
           reserveFoodPoints: Number(controls.reserveFood.value),
           sleep: controls.sleepPolicy.value,
           shelter: controls.shelterPolicy.value,
           armor: controls.armorPolicy.value,
           usefulDrops: controls.usefulDrops.value,
         },
         jobs: {
           ...(current.runtime?.jobs || {}),
           mode: controls.jobMode.value,
           stockpileLimit: Number(controls.stockpileLimit.value),
           deposit: controls.depositPolicy.value,
         },
         reactions: {
           ...(current.runtime?.reactions || {}),
           mode: controls.reactionMode.value,
           maxSpeechPerMinute: Number(controls.maxSpeech.value),
         },
         assignment: {
           ...(current.runtime?.assignment || {}),
           leader: controls.leader.value.trim(),
           deposit,
         },
        identity: {
          language: controls.language.value.trim() || 'en',
          attitude: controls.attitude.value.trim(),
          style: controls.style.value.trim(),
          specialties: controls.specialties.value.split(',').map((value) => value.trim()).filter(Boolean),
        },
        memory: {
          personal: memory.checked,
          team: controls.teamMemory.value,
        },
        vision: {
          ...(current.runtime?.vision || {}),
          mode: controls.visionMode.value,
        },
        loadout: current.runtime?.loadout || { mode: 'survival', items: [] },
        limits: current.runtime?.limits || {},
      },
      provider: { id: controls.provider.value, chatModel: controls.chatModel.value.trim(), codeModel: controls.codeModel.value.trim(), visionModel: controls.visionModel.value.trim(), embeddingModel: controls.embeddingModel.value.trim(), baseUrl: controls.baseUrl.value.trim() },
      connection: { host: controls.host.value.trim(), port: Number(controls.port.value), auth: current.connection?.auth || 'offline', minecraftVersion: current.connection?.minecraftVersion || 'auto' },
      behavior: {
        allowVision: controls.visionMode.value !== 'off',
        loadMemory: memory.checked,
        speak: Boolean(current.behavior?.speak),
        chatInGame: chatInGame.checked,
       },
      };
    };
    let savePending = false;
    let saveDeployButton;
    let saveOnlyButton;
    let resetButton;
    const setSavePending = (pending, deploy) => {
      savePending = pending;
      saveDeployButton.disabled = pending;
      saveOnlyButton.disabled = pending;
      resetButton.disabled = pending;
      saveDeployButton.textContent = pending && deploy ? 'Saving & deploying…' : 'Save & Deploy Bot';
      saveOnlyButton.textContent = pending && !deploy ? 'Saving…' : 'Save Only';
    };
    const saveProfile = async ({ deploy = false } = {}) => {
      if (savePending) return;
      if (!this.storage.writable) { result.textContent = this.storage.error || 'Saved bot library must be repaired before changes can be made.'; return; }
      const payload = buildPayload();
      if (!payload.name || !payload.agentName || !payload.provider.chatModel) { result.textContent = 'Name, Minecraft agent name, and chat model are required.'; return; }
      this.formStatus = '';
      result.textContent = deploy ? 'Saving character…' : 'Saving…';
      setSavePending(true, deploy);
      try {
        const response = await api('/bot-library', payload);
        if (!response.success) { result.textContent = response.error || 'Save failed.'; return; }
        const index = this.profiles.findIndex((entry) => entry.id === response.profile.id);
        if (index === -1) this.profiles.push(response.profile); else this.profiles[index] = response.profile;
        this.editingId = response.profile.id;
        this.activity?.add('CONFIG', `${response.profile.name}: bot type saved.`, 'ok');
        if (deploy) {
          result.textContent = 'Saved. Checking AI and requesting deployment…';
          const deployment = await api(`/bot-library/${encodeURIComponent(response.profile.id)}/spawn`, { agentName: response.profile.agentName });
          result.textContent = deployment.success
            ? 'Deployment accepted. Open Bots to watch it connect and begin its role.'
            : deployment.error || 'Saved, but deployment failed.';
          this.activity?.add('AGENT', deployment.success ? `${response.profile.name}: deployment accepted` : `${response.profile.name}: ${deployment.error || 'deployment failed'}`, deployment.success ? 'ok' : 'err');
          this.announce?.(deployment.success ? `${response.profile.name} is starting.` : result.textContent);
        } else {
          result.textContent = 'Saved. You can deploy this character from its card or the Dashboard.';
        }
        this.formStatus = result.textContent;
        this.render();
      } finally {
        setSavePending(false, deploy);
      }
    };
    saveDeployButton = button('Save & Deploy Bot', () => saveProfile({ deploy: true }), 'success');
    saveOnlyButton = button('Save Only', () => saveProfile(), 'primary');
    resetButton = button('Reset Form', () => { this.editingId = ''; this.formStatus = ''; this.renderForm(); }, 'compact');
    actions.append(saveDeployButton, saveOnlyButton, resetButton);
    this.form.append(actions, result);
  }

  checkbox(control, label) {
    const wrap = node('label', 'inline-check');
    wrap.append(control, document.createTextNode(` ${label}`));
    return wrap;
  }
}
