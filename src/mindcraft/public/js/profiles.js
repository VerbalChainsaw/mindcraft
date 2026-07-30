import { api, requestControlCenterRestart } from './api.js';
import { BotLibraryPanel } from './bot-library.js';
import { $, button, clear, gridField, input, node, select } from './utils.js';

export class ProfilesWorkspace {
  constructor(root, activity, announce, onApply) {
    this.root = root; this.activity = activity; this.announce = announce; this.onApply = onApply;
    this.catalog = []; this.selected = []; this.config = {}; this.providerKeys = {}; this.providerKeySources = {};
    this.settingsSpec = {}; this.localModels = { models: [], recommendation: {}, quickstart: {} }; this.botLibrary = new BotLibraryPanel(activity, announce);
  }

  mount() {
    clear(this.root);
    const advanced = document.createElement('details');
    advanced.className = 'advanced-setup';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced setup: cloud keys, profile files, and launcher settings';
    const content = node('div', 'advanced-setup-body');
    content.append(this.buildDefaultsCard(), this.buildProfilesCard(), this.buildKeysCard(), this.buildActionsCard());
    advanced.append(summary, content);
    this.root.append(this.heading(), this.buildLocalQuickstartCard(), this.botLibrary.mount(), advanced);
  }
  heading() {
    const wrap = node('div', 'workspace-heading'); const text = node('div');
    text.append(node('h1', '', 'Set Up Your Bot'), node('p', '', 'Use the local AI already on this computer, then point the bot at Minecraft.'));
    wrap.append(text); return wrap;
  }
  buildLocalQuickstartCard() {
    const card = node('section', 'panel quickstart-panel');
    const intro = node('div', 'quickstart-heading');
    const copy = node('div');
    copy.append(node('span', 'eyebrow', 'Recommended'), node('h2', '', 'Run a bot with local Ollama'), node('p', 'muted', 'No cloud key is required. Mindcraft found Ollama and can reuse an installed model.'));
    this.localAvailability = node('span', 'state-badge state-stopped', 'Checking local AI…');
    intro.append(copy, this.localAvailability);

    this.localBotName = input('local_bot_name', 'text', 'MindcraftBot');
    this.localChatModel = select('local_chat_model', []);
    this.localEmbeddingModel = select('local_embedding_model', []);
    this.localHost = input('local_minecraft_host', 'text', '127.0.0.1');
    this.localPort = input('local_minecraft_port', 'number', '55916');
    const grid = node('div', 'quickstart-grid');
    grid.append(
      gridField('Bot name', this.localBotName),
      gridField('Local chat model', this.localChatModel),
      gridField('Minecraft host', this.localHost),
      gridField('Minecraft LAN port', this.localPort),
    );
    const embedding = node('details', 'disclosure');
    const embeddingSummary = document.createElement('summary');
    embeddingSummary.textContent = 'Optional embedding model';
    embedding.append(embeddingSummary, gridField('Embedding model', this.localEmbeddingModel));
    this.quickResult = node('div', 'status-text muted');
    this.quickSave = button('Save Setup', () => this.configureLocal(false));
    this.quickStart = button('Save & Start Bot', () => this.configureLocal(true), 'success');
    this.quickOllama = button('Start Ollama', () => this.startOllama(), 'primary');
    const actions = node('div', 'actions');
    actions.append(this.quickOllama, this.quickStart, this.quickSave, this.quickResult);
    card.append(intro, grid, embedding, actions);
    this.fillQuickstart();
    return card;
  }
  buildProfilesCard() {
    const card = node('section', 'panel'); card.append(node('h2', '', 'Startup profiles'));
    const picker = node('div', 'profile-picker');
    this.availableEl = node('section', 'profile-panel available-panel');
    this.selectedEl = node('section', 'profile-panel selected-panel');
    this.availableEl.append(node('h3', '', 'Available Profiles'), node('div', 'muted small', 'Scroll to browse all profiles'));
    this.availableList = node('div', 'profile-list'); this.availableEl.append(this.availableList);
    this.selectedEl.append(node('h3', '', 'Selected Profiles'));
    this.selectedList = node('div', 'profile-list'); this.selectedEl.append(this.selectedList);
    picker.append(this.availableEl, this.selectedEl); card.append(picker); return card;
  }
  buildDefaultsCard() {
    const card = node('section', 'panel'); card.append(node('h2', '', 'Minecraft target and agent defaults'));
    this.defaults = {};
    const ids = [
      ['agent_host','Minecraft host','text'], ['agent_port','Minecraft port','number'], ['agent_auth','Auth type (offline / microsoft)','text'],
      ['agent_minecraft_version','Minecraft version','text'], ['agent_base_profile','Base profile','text'], ['agent_model','Default model','text'],
      ['agent_init_message','Initial bot message','text'],
    ];
    const grid = node('div', 'grid-2');
    ids.forEach(([id,label,type]) => { const field = gridField(label, input(id,type)); this.defaults[id] = field.querySelector('input'); grid.append(field); });
    [['agent_load_memory','Load memory on start'],['agent_speak','Speak in voice'],['agent_chat_ingame','Chat in game'],['agent_allow_vision','Let bot analyze its view'],['agent_render_bot_view','Show live bot camera']].forEach(([id,label]) => {
      const checkbox = input(id,'checkbox'); checkbox.checked = false; const wrap = node('label'); wrap.htmlFor=id; wrap.append(checkbox, document.createTextNode(` ${label}`)); this.defaults[id]=checkbox; grid.append(wrap);
    });
    card.append(grid); return card;
  }
  buildKeysCard() {
    const card = node('section', 'panel'); card.append(node('h2', '', 'Provider access'), node('p','muted small','Values are written to keys.json and never displayed. Local providers such as Ollama, LM Studio, and vLLM do not need cloud keys.'));
    this.keyProvider = select('key_provider', []); this.keyValue = input('key_value','password'); this.keyValue.autocomplete='off'; this.keyValue.placeholder='Paste key value';
    const grid = node('div','grid-2'); grid.append(gridField('Provider',this.keyProvider),gridField('Key value',this.keyValue));
    this.keyStatus = node('div','summary-grid'); this.keyResult = node('div','muted small');
    const save = button('Save Provider Key', () => this.saveKey(), 'primary');
    const actions = node('div','actions'); actions.append(save,this.keyResult);
    card.append(grid, actions, this.keyStatus); return card;
  }
  buildActionsCard() {
    const card = node('section','panel'); card.append(node('h2','','Apply changes'));
    this.lanNote = node('p','muted small','MindServer stays loopback-only. Public or LAN dashboard binding is not supported.');
    const grid = node('div','grid-3');
    this.runtime = {};
    [['mindserver_port','Mindserver port','number'],['port_scan_start','Port scan start','number'],['port_scan_max','Port scan attempts','number']].forEach(([id,label,type]) => { const el=input(id,type); this.runtime[id]=el; grid.append(gridField(label,el)); });
    this.autoOpen = input('auto_open_ui','checkbox'); this.autoStart=input('auto_start','checkbox');
    const flags=node('div','actions'); flags.append(this.checkboxLabel(this.autoOpen,'Auto-open UI'),this.checkboxLabel(this.autoStart,'Auto-start selected profiles')); grid.append(flags);
    const telemetryDisclosure=document.createElement('details');telemetryDisclosure.className='disclosure';
    const telemetrySummary=document.createElement('summary');telemetrySummary.textContent='Agent telemetry performance';
    const telemetryGrid=node('div','grid-3');this.telemetry={};
    [
      ['intervalMs','Sample interval (ms)',250,30000,'Healthy-bot readout cadence.'],
      ['requestTimeoutMs','Request timeout (ms)',250,30000,'How long one bot may take to answer.'],
      ['maxConcurrent','Parallel samples',1,12,'Maximum bots sampled at once.'],
      ['heartbeatMs','Unchanged heartbeat (ms)',250,30000,'Resend unchanged state so age remains visible.'],
      ['failureBackoffMs','Failure backoff (ms)',250,120000,'First retry delay for an unhealthy bridge.'],
      ['maxFailureBackoffMs','Maximum backoff (ms)',250,120000,'Caps repeated-failure retry delay.'],
    ].forEach(([id,label,min,max,hint])=>{const el=input(`telemetry_${id}`,'number');el.min=String(min);el.max=String(max);el.step='1';this.telemetry[id]=el;telemetryGrid.append(gridField(label,el,hint));});
    telemetryDisclosure.append(telemetrySummary,telemetryGrid);
    this.result = node('div','status-text muted');
    this.saveButton = button('Apply Configuration', () => this.save(false), 'primary');
    this.startButton = button('Apply & Start', () => this.save(true), 'success');
    const actions=node('div','actions'); actions.append(this.saveButton,this.startButton,this.result);
    card.append(this.lanNote,grid,telemetryDisclosure,actions); return card;
  }
  checkboxLabel(el,label) { const wrap=node('label'); wrap.append(el,document.createTextNode(` ${label}`)); return wrap; }
  async load() {
    const [profiles, config, spec, local] = await Promise.all([api('/profiles'),api('/launcher-config'),fetch(`${location.pathname.replace(/[^/]*$/,'')}settings_spec.json`).then(r=>r.json()).catch(()=>({})),api('/local-models')]);
    if (profiles.success) this.catalog=Array.isArray(profiles.profiles)?profiles.profiles:[];
    if (config.success) { this.config=config.config||{}; this.providerKeys=config.providerKeys||{}; this.providerKeySources=config.providerKeySources||{}; this.selected=Array.isArray(this.config.profiles)?[...this.config.profiles]:[]; }
    if (local.success) this.localModels=local;
    this.settingsSpec=spec||{}; this.mount(); this.fillConfig(); this.fillQuickstart(); this.renderProfiles(); this.renderKeys(); void this.botLibrary.load();
  }
  fillQuickstart() {
    if (!this.localAvailability) return;
    const models = Array.isArray(this.localModels.models) ? this.localModels.models : [];
    const chatModels = models.filter(m=>m.kind==='chat');
    const embeddingModels = models.filter(m=>m.kind==='embedding');
    const quick = this.localModels.quickstart || {};
    const recommended = this.localModels.recommendation || {};
    clear(this.localChatModel); clear(this.localEmbeddingModel);
    chatModels.forEach(({name})=>{const option=document.createElement('option');option.value=name;option.textContent=name;this.localChatModel.append(option);});
    const none=document.createElement('option');none.value='';none.textContent='Use chat model fallback';this.localEmbeddingModel.append(none);
    embeddingModels.forEach(({name})=>{const option=document.createElement('option');option.value=name;option.textContent=name;this.localEmbeddingModel.append(option);});
    this.localChatModel.value=quick.chatModel&&chatModels.some(m=>m.name===quick.chatModel)?quick.chatModel:recommended.chatModel||chatModels[0]?.name||'';
    this.localEmbeddingModel.value=quick.embeddingModel&&embeddingModels.some(m=>m.name===quick.embeddingModel)?quick.embeddingModel:recommended.embeddingModel||'';
    this.localBotName.value=quick.botName||'MindcraftBot';
    this.localHost.value=quick.minecraft?.host||this.config.agent_defaults?.host||'127.0.0.1';
    this.localPort.value=quick.minecraft?.port||this.config.agent_defaults?.port||55916;
    const available=Boolean(this.localModels.provider?.available&&chatModels.length);
    this.localAvailability.className=`state-badge ${available?'state-ready':'state-blocked'}`;
    this.localAvailability.textContent=available?`Ollama ready · ${chatModels.length} chat model${chatModels.length===1?'':'s'}`:'Ollama needs a chat model';
    this.quickOllama.hidden=available;
    this.quickSave.disabled=!available;this.quickStart.disabled=!available;
    this.quickResult.textContent=quick.configured
      ? `${quick.botName} is configured with ${quick.chatModel}.`
      : available?'Choose a name, confirm the Minecraft port, then start.':'Start the installed Ollama service, then Mindcraft will load your local models.';
  }
  fillConfig() {
    const c=this.config,d=c.agent_defaults||{},t={intervalMs:1000,requestTimeoutMs:1200,maxConcurrent:6,heartbeatMs:3000,failureBackoffMs:1500,maxFailureBackoffMs:15000,...(c.telemetry||{})};
    Object.entries({mindserver_port:c.mindserver_port,port_scan_start:c.port_scan_start,port_scan_max:c.port_scan_max}).forEach(([id,v])=>{if(this.runtime[id])this.runtime[id].value=v??'';});
    Object.entries(t).forEach(([id,v])=>{if(this.telemetry[id])this.telemetry[id].value=v??'';});
    this.autoOpen.checked=!!c.auto_open_ui; this.autoStart.checked=!!c.auto_start;
    Object.entries({agent_host:d.host,agent_port:d.port,agent_auth:d.auth,agent_minecraft_version:d.minecraft_version,agent_base_profile:d.base_profile,agent_model:d.model||d.model_name||'',agent_init_message:d.init_message,agent_load_memory:d.load_memory,agent_speak:d.speak,agent_chat_ingame:d.chat_ingame,agent_allow_vision:d.allow_vision,agent_render_bot_view:d.render_bot_view}).forEach(([id,v])=>{if(this.defaults[id])this.defaults[id][this.defaults[id].type==='checkbox'?'checked':'value']=v??'';});
    this.result.textContent=`Current target: ${c.runtime?.host||'localhost'}:${c.runtime?.port||c.mindserver_port||''}`;
  }
  profileInfo(file) { return this.catalog.find(p=>p.file===file)||{file,name:file.split('/').pop()?.replace(/\.json$/i,''),model:'',provider:''}; }
  renderProfiles() {
    clear(this.availableList); clear(this.selectedList);
    this.catalog.filter(p=>!this.selected.includes(p.file)).forEach(p=>this.availableList.append(this.profileItem(p,false,0)));
    this.selected.forEach((file,i)=>this.selectedList.append(this.profileItem(this.profileInfo(file),true,i)));
    if(!this.selected.length)this.selectedList.append(node('div','empty-state','No profiles selected. Add one from Available Profiles.'));
    if(!this.availableList.children.length)this.availableList.append(node('div','empty-state','No profiles available.'));
  }
  profileItem(profile,selected,index) {
    const item=node('div','profile-item'); const info=node('div','profile-info'); info.append(node('div','profile-name',profile.name||'Unnamed'));
    info.append(node('span','profile-badge',profile.model?`${profile.provider?profile.provider+' · ':''}${profile.model}`:'No model set'),node('div','profile-file',profile.file)); item.append(info);
    const controls=node('div','profile-controls');
    if(selected){
      controls.append(button('✕ Remove',()=>{this.selected.splice(index,1);this.announce(`${profile.name} removed.`);this.renderProfiles();},'danger'));
      [['↑ Move Up',-1],['↓ Move Down',1]].forEach(([label,d])=>{const b=button(label,()=>{[this.selected[index],this.selected[index+d]]=[this.selected[index+d],this.selected[index]];this.announce(`${profile.name} moved ${d<0?'up':'down'}.`);this.renderProfiles();});b.disabled=d<0?index===0:index===this.selected.length-1;b.setAttribute('aria-label',`${label} ${profile.name}`);controls.append(b);});
    } else { controls.append(button('Add →',()=>{this.selected.push(profile.file);this.announce(`${profile.name} added.`);this.renderProfiles();},'success')); }
    item.append(controls); return item;
  }
  renderKeys() {
    clear(this.keyStatus); clear(this.keyProvider); const names=Object.keys(this.providerKeys).sort();
    names.forEach(name=>{const o=document.createElement('option');o.value=name;o.textContent=name;this.keyProvider.append(o);const source=this.providerKeySources[name];const label=source==='environment'?'Available from system environment':source==='keys.json'?'Saved in Mindcraft':'Not configured';const card=node('div','summary-card');card.append(node('strong','',name),node('div','summary-value',label));this.keyStatus.append(card);});
    if(!names.length)this.keyStatus.append(node('div','muted small','Provider key status is unavailable.'));
  }
  async saveKey(){const provider=this.keyProvider.value,value=this.keyValue.value.trim();if(!provider||!value){this.keyResult.textContent='Choose a provider and paste a key first.';return;}this.keyResult.textContent='Saving…';const r=await api('/keys',{[provider]:value});if(r.success){this.keyValue.value='';this.providerKeys=r.providerKeys||this.providerKeys;this.renderKeys();this.keyResult.textContent=`Saved ${provider}. Restart Launcher to apply.`;this.activity?.add('CONFIG',`Provider key saved for ${provider}.`,'ok');}else this.keyResult.textContent=r.error||'Save failed';}
  async configureLocal(start){
    this.quickResult.textContent=start?'Saving local bot setup…':'Saving setup…';
    const payload={botName:this.localBotName.value.trim(),chatModel:this.localChatModel.value,embeddingModel:this.localEmbeddingModel.value,host:this.localHost.value.trim(),port:Number(this.localPort.value),autoStart:false};
    const r=await api('/quickstart/local',payload);
    if(!r.success){this.quickResult.textContent=r.error||'Local setup failed.';this.announce(this.quickResult.textContent);return;}
    this.config=r.config||this.config;this.selected=Array.isArray(this.config.profiles)?[...this.config.profiles]:this.selected;this.localModels.quickstart=r.quickstart||this.localModels.quickstart;
    this.activity?.add('CONFIG',`${payload.botName} configured with local Ollama.`,'ok');
    if(!start){this.quickResult.textContent='Setup saved. Use Start Bot when Minecraft is ready.';this.announce('Local bot setup saved.');return;}
    this.quickResult.textContent='Starting Minecraft first, then the bot…';
    const result=await this.onApply?.({startLocal:true});
    if(result?.success===false){this.quickResult.textContent=result.error||'Local stack could not be started.';this.announce(this.quickResult.textContent);return;}
    this.quickResult.textContent='Local stack start requested. Open Bots to watch the connection.';
  }
  async startOllama(){
    this.quickOllama.disabled=true;this.quickResult.textContent='Starting Ollama and checking installed models… this can take about 20 seconds the first time.';
    const result=await api('/local-services/ollama/start',{});
    if(!result.success){this.quickOllama.disabled=false;this.quickResult.textContent=result.error||'Ollama could not be started.';this.announce(this.quickResult.textContent);return;}
    this.localModels={...this.localModels,...result,quickstart:this.localModels.quickstart||{}};
    await this.botLibrary.load();
    this.activity?.add('SYSTEM','Ollama started and local models detected.','ok');this.fillQuickstart();this.announce('Ollama is ready. Choose a model and start your bot.');
  }
  payload(){const value=(id)=>this.defaults[id]?.type==='checkbox'?!!this.defaults[id].checked:(this.defaults[id]?.value||'').trim();const agent_defaults={host:value('agent_host'),port:Number(value('agent_port')),auth:value('agent_auth').toLowerCase(),minecraft_version:value('agent_minecraft_version'),base_profile:value('agent_base_profile'),init_message:value('agent_init_message'),load_memory:value('agent_load_memory'),speak:value('agent_speak'),chat_ingame:value('agent_chat_ingame'),allow_vision:value('agent_allow_vision'),render_bot_view:value('agent_render_bot_view')};const model=value('agent_model');if(model)agent_defaults.model=model;const telemetry=Object.fromEntries(Object.entries(this.telemetry||{}).map(([id,el])=>[id,Number(el.value)]));return {mindserver_port:Number(this.runtime.mindserver_port.value),port_scan_start:Number(this.runtime.port_scan_start.value),port_scan_max:Number(this.runtime.port_scan_max.value),mindserver_host_public:false,auto_open_ui:!!this.autoOpen.checked,auto_start:!!this.autoStart.checked,profiles:[...this.selected],agent_defaults,telemetry};}
  validatePayload(payload){
    const errors=[];
    if(!Number.isFinite(payload.mindserver_port)||payload.mindserver_port<1024||payload.mindserver_port>65535)errors.push('Mindserver port must be between 1024 and 65535.');
    if(!Number.isFinite(payload.agent_defaults.port)||payload.agent_defaults.port<1||payload.agent_defaults.port>65535)errors.push('Minecraft port must be between 1 and 65535.');
    if(payload.agent_defaults.auth&&payload.agent_defaults.auth!=='offline'&&payload.agent_defaults.auth!=='microsoft')errors.push('Auth type must be offline or microsoft.');
    if(payload.profiles.length===0&&payload.auto_start)errors.push('Add at least one profile when auto-start is enabled.');
    const ranges={intervalMs:[250,30000],requestTimeoutMs:[250,30000],maxConcurrent:[1,12],heartbeatMs:[250,30000],failureBackoffMs:[250,120000],maxFailureBackoffMs:[250,120000]};
    for(const [name,[min,max]] of Object.entries(ranges)){
      const value=payload.telemetry?.[name];
      if(!Number.isInteger(value)||value<min||value>max)errors.push(`${name} must be an integer between ${min} and ${max}.`);
    }
    if(Number.isFinite(payload.telemetry?.maxFailureBackoffMs)&&Number.isFinite(payload.telemetry?.failureBackoffMs)&&payload.telemetry.maxFailureBackoffMs<payload.telemetry.failureBackoffMs)errors.push('Maximum telemetry backoff cannot be lower than the initial failure backoff.');
    return errors;
  }
  async save(start){
    this.result.textContent='Saving configuration…';
    const payload=this.payload(),errors=this.validatePayload(payload);
    if(errors.length){this.result.textContent=errors.join(' ');this.announce(this.result.textContent);return;}
    const r=await api('/launcher-config',payload);
    if(!r.success){this.result.textContent=r.error||'Save failed';this.announce(this.result.textContent);return;}
    this.activity?.add('CONFIG','Launcher configuration saved.','ok');
    if(!start){this.result.textContent='Applied. Restart Launcher to apply runtime changes.';this.announce('Configuration applied.');return;}
    this.result.textContent='Restarting Launcher…';
    const restart=await requestControlCenterRestart();
    if(!restart.success){this.result.textContent=restart.error||'Restart failed';return;}
    this.activity?.add('CONFIG','Launcher restart requested.','ok');this.result.textContent='Starting selected profiles…';this.onApply?.();
  }
}
