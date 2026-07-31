import { actionTargetLabel, attentionStatusLabel, behaviorStatusLabel, button, canStartAgent, clear, dialogueStatusLabel, errorText, gridField, input, isCredentialReason, localServiceUrl, node, normalizeState, operatorControlLabel, runtimeRecoveryMessage, select, stateLabels, telemetryFreshness } from './utils.js';
import { api } from './api.js';
import { renderBotBrain } from './bot-brain.js';

const AGENT_REQUEST_TIMEOUT_MS = 15_000;
const AGENT_START_TIMEOUT_MS = 60_000;
const AGENT_STOP_TIMEOUT_MS = 30_000;
const AGENT_RESTART_TIMEOUT_MS = 75_000;
const AGENT_REMOVE_TIMEOUT_MS = 30_000;
const AGENT_STATUS_TIMEOUT_MS = 75_000;
const MAX_PROFILE_UPLOAD_BYTES = 256 * 1024;
const MAX_CHAT_ENTRIES = 100;
const SQUAD_COLORS = [
  'gray', 'white', 'gold', 'yellow', 'green', 'dark_green', 'aqua', 'dark_aqua',
  'blue', 'dark_blue', 'red', 'dark_red', 'light_purple', 'dark_purple',
].map((value)=>({value,label:value.replaceAll('_',' ')}));
const SQUAD_HUES = {
  gray: 200, white: 190, gold: 43, yellow: 55, green: 128, dark_green: 145,
  aqua: 187, dark_aqua: 178, blue: 210, dark_blue: 224, red: 4, dark_red: 350,
  light_purple: 306, dark_purple: 278,
};

function socketRequest(socket, event, args = [], timeoutMs = AGENT_REQUEST_TIMEOUT_MS) {
  if (!socket?.connected) return Promise.resolve({ success: false, error: 'Mindcraft is reconnecting.' });
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result || { success: false, error: 'Mindcraft returned no response.' });
    };
    timer = setTimeout(
      () => finish({ success: false, error: `Mindcraft did not finish ${event} within ${Math.ceil(timeoutMs/1000)} seconds.` }),
      timeoutMs,
    );
    socket.emit(event, ...args, finish);
  });
}

function readSettingValue(config, control) {
  if (control.type === 'checkbox') return control.checked;
  if (control.type === 'number') return Number(control.value);
  if (config.type === 'array' || config.type === 'object') {
    if (!control.value.trim() && config.default === null) return null;
    return JSON.parse(control.value);
  }
  return control.value;
}

function elapsedLabel(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'unknown age';
  if (milliseconds < 1_000) return 'just now';
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} sec ago`;
  return `${Math.round(milliseconds / 60_000)} min ago`;
}

function positionLabel(position) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return 'Unavailable';
  return `x ${position.x}, y ${position.y}, z ${position.z}`;
}

function namedList(entries, fallback = 'None detected') {
  if (!Array.isArray(entries) || entries.length === 0) return fallback;
  return entries.slice(0, 4).map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return 'unknown';
    const name = String(entry.name || entry.kind || 'unknown').replace(/_/g, ' ');
    const distance = Number.isFinite(entry.distance) ? ` · ${entry.distance}m` : '';
    const direction = entry.direction ? ` ${entry.direction}` : '';
    const disposition = entry.threatDisposition === 'avoid_only'
      ? ' · avoid only'
      : entry.threatDisposition === 'combat_safe'
        ? ' · engageable'
        : '';
    return `${name}${distance}${direction}${disposition}`;
  }).join(', ');
}

function pathGoalLabel(goal) {
  if (!goal || typeof goal !== 'object') return 'No active route';
  const coordinates = [goal.x, goal.y, goal.z].every(Number.isFinite)
    ? ` to ${goal.x}, ${goal.y}, ${goal.z}`
    : '';
  const range = Number.isFinite(goal.range) ? ` within ${goal.range}` : '';
  return `${goal.type || 'Goal'}${coordinates}${range}`;
}

function perceptionStatusLabel(perception) {
  const status = String(perception?.status || 'unsampled');
  if (status === 'fresh') return 'Fresh world scan';
  if (status === 'cached') return `Cached world scan · ${elapsedLabel(perception.ageMs)}`;
  if (status === 'stale') return `Stale world scan · ${elapsedLabel(perception.ageMs)}`;
  if (status === 'unavailable') return 'World scan unavailable';
  return 'World scan has not run yet';
}

function actionOutcomeLabel(result) {
  if (!result || typeof result !== 'object') return 'No completed action yet';
  const phase = String(result.phase || 'unknown').replace(/_/g, ' ');
  const code = result.code ? ` · ${String(result.code).replace(/_/g, ' ')}` : '';
  return `${phase}${code}`;
}

function squadDisplayName(squad) {
  const identity = squad?.identity || squad?.scenario?.identity || {};
  const label = identity.displayName || squad?.scenario?.label || squad?.prefix || 'Squad';
  const prefix = String(squad?.prefix || '').replace(/_+$/, '');
  return prefix && prefix.toLowerCase() !== String(label).toLowerCase()
    ? `${label} · ${prefix}`
    : label;
}

export class AgentsWorkspace {
  constructor(root, modalRoot, socket, activity, announce, settingsSpec = {}) {
    this.root=root;this.modalRoot=modalRoot;this.socket=socket;this.activity=activity;this.announce=announce;this.settingsSpec=settingsSpec;
    this.agents=[];this.settings={};this.messages={};this.states={};this.selected=null;this.tab='chat';this.onAgentsChanged=null;this.onStatesChanged=null;this.onSquadsChanged=null;this.pending=new Map();this.actionOutcomeKeys=new Map();
     this.squads=[];this.squadPersistence=null;this.scenarios=[];this.squadBusy='';this.squadDraft={templateName:'',prefix:'Squad_',size:3,staggerMs:750,displayName:'',badge:'',color:'aqua',motto:'',memberNames:'',nameStyle:'numbered'};this.squadRadioDraft={message:'',kind:'order'};
    this.scenarioDraft={templateName:'',leader:'Director',staggerMs:750};
     this.customScenarioDraft={label:'',description:'',size:3,prefix:'Crew',behavior:'follow',formation:'balanced',personas:'',botTypes:'',badge:'',color:'aqua',motto:'',memberNames:'',nameStyle:'themed'};
     this.libraryProfiles=[];
    this.squadControlDraft={id:'',leader:'Director',formation:'balanced',personaPreset:'adventurers',customPersona:'',command:'!awareness'};
    this.onSetup=null;
    socket.on('agents-status',(agents)=>{this.agents=Array.isArray(agents)?agents:[];this.settlePendingFromStatus();if(!this.selected&&this.agents[0])this.selected=this.agents[0].name;if(this.selected&&!this.agents.some(a=>a.name===this.selected))this.selected=this.agents[0]?.name||null;this.render();this.onAgentsChanged?.(this.agents);});
    socket.on('bot-output',(name,message)=>{
      this.appendMessage(name,'Bot',message);
      this.renderFocused();
      this.activity?.add('AGENT',`${name}: ${message}`);
    });
    socket.on('state-update',(states)=>{this.states=states||{};this.captureActionOutcomes(this.states);this.renderFocused();this.onStatesChanged?.(this.states);});
     socket.on('squad-update',(squad)=>{if(squad?.persistence)this.squadPersistence=squad.persistence;this.upsertSquad(squad);this.render();});
     socket.on('squad-radio-event',(event)=>{if(!event?.message)return;this.activity?.add('RADIO',`${event.from||'Director'} → squad: ${event.message}`, 'ok');if(event.from==='Director')this.announce?.(`Squad radio delivered to ${event.delivered||0} bot(s).`);});
    socket.on('connect',()=>{this.listenToAgentStates();void this.refreshSquads();});
    socket.on('disconnect',()=>{this.clearAllPending('Mindcraft disconnected before the bot action completed.');});
  }
  // Bots and squads are different jobs, so they get different rooms. One
  // instance still owns the sockets and state; only what it draws changes.
  mount(mode='bots'){this.mode=mode==='squads'?'squads':'bots';this.render();this.listenToAgentStates();void this.refreshSquads();}
  listenToAgentStates(){if(this.socket?.connected)this.socket.emit('listen-to-agents');}
  captureActionOutcomes(states){
    Object.entries(states||{}).forEach(([agentName,state])=>{
      const result=state?.action?.lastResult;
      if(!result?.phase)return;
      const key=[result.finishedAt||'',result.phase||'',result.code||'',result.detail||''].join('|');
      if(this.actionOutcomeKeys.get(agentName)===key)return;
      this.actionOutcomeKeys.set(agentName,key);
      const phase=String(result.phase).replace(/_/g,' ');
      const code=result.code?` · ${String(result.code).replace(/_/g,' ')}`:'';
      const detail=String(result.detail||result.label||'No detail returned.').slice(0,260);
      const tone=result.phase==='succeeded'?'ok':['failed','blocked'].includes(result.phase)?'err':'';
      this.activity?.add('BOT',`${agentName}: ${phase}${code} — ${detail}`,tone);
    });
  }
  beginPending(name,type){if(this.pending.has(name))return false;const timer=setTimeout(()=>{this.finishPending(name,`The ${type} request did not reach a stable bot state within ${Math.ceil(AGENT_STATUS_TIMEOUT_MS/1000)} seconds. Refresh status before retrying.`);},AGENT_STATUS_TIMEOUT_MS);this.pending.set(name,{type,timer});this.render();return true;}
  finishPending(name,error=''){const pending=this.pending.get(name);if(!pending)return;if(pending.timer)clearTimeout(pending.timer);this.pending.delete(name);if(error)this.announce(error);this.render();}
  clearAllPending(error=''){for(const pending of this.pending.values()){if(pending.timer)clearTimeout(pending.timer);}this.pending.clear();if(error)this.announce(error);this.render();}
  settlePendingFromStatus(){
    for(const [name,pending] of this.pending){
      const agent=this.agents.find((candidate)=>candidate.name===name);
      let settled=!agent;
      if(agent){
        const state=normalizeState(agent);
        if(pending.type==='start')settled=agent.in_game||agent.socket_connected||['failed','blocked'].includes(state);
        if(pending.type==='stop')settled=!agent.in_game&&!agent.socket_connected&&['ready','stopped','failed','blocked'].includes(state);
        if(pending.type==='restart')settled=agent.in_game||agent.socket_connected||['failed','blocked'].includes(state);
      }
      if(settled){if(pending.timer)clearTimeout(pending.timer);this.pending.delete(name);}
    }
  }
  async disconnectAll(){if(!this.agents.length)return {success:true};if(!window.confirm('Disconnect every bot from Minecraft? The server will keep running.'))return {success:false,cancelled:true,error:'Disconnect all cancelled.'};const result=await socketRequest(this.socket,'stop-all-agents',[],30_000);this.activity?.add('AGENT',result.success?'Every active bot stopped and exited.':result.error||'Disconnect all failed.',result.success?'ok':'err');this.announce(result.success?'Every active bot stopped and exited.':result.error||'Disconnect all failed.');return result;}
  heading(){const wrap=node('div','workspace-heading'),text=node('div');text.append(node('h1','','Bots'),node('p','','Start, stop, chat with, and inspect your Minecraft bots. Whole-stack power controls are on Dashboard.'));const actions=node('div','heading-actions');actions.append(button('Set Up a Bot',()=>this.onSetup?.(),'primary'),button('Create from JSON',()=>this.openCreate()),button('Disconnect All',()=>this.disconnectAll(),'danger'));wrap.append(text,actions);return wrap;}
  render(){
    clear(this.root);
    if(this.mode==='squads'){
      // Drop stale references so live updates cannot render into detached DOM.
      this.listEl=null;this.focusPanel=null;
      this.root.append(this.heading(),this.scenarioLauncher(),this.squadLauncher(),this.squadCommandDeck());
      this.renderSquads();
      return;
    }
    this.root.append(this.heading());
    const layout=node('div','grid-2');
    const listPanel=node('section','panel');
    listPanel.append(node('h2','','Agent list'));
    this.listEl=node('div','agent-list');
    listPanel.append(this.listEl);
    layout.append(listPanel);
    this.focusPanel=node('section','panel focused-agent');
    layout.append(this.focusPanel);
    this.root.append(layout);
    this.renderList();
    this.renderFocused();
    this.renderSquads();
  }
  templateAgents(){
    const memberNames=new Set(this.squads.flatMap((squad)=>Array.isArray(squad.members)?squad.members.map((member)=>member.name):[]));
    return this.agents.filter((agent)=>!memberNames.has(agent.name));
  }
  notifySquadsChanged(){
    try{
      this.onSquadsChanged?.({
        squads:[...this.squads],
        scenarios:[...this.scenarios],
        busy:this.squadBusy,
      });
    }catch{
      // A dashboard rendering failure must never interrupt squad lifecycle handling.
    }
  }
  upsertSquad(squad){
    if(!squad?.id)return;
    const index=this.squads.findIndex((candidate)=>candidate.id===squad.id);
    if(index===-1)this.squads.push(squad);else this.squads[index]=squad;
    this.notifySquadsChanged();
  }
  persistenceIssue(response){
    const persistence=response?.persistence||response?.squad?.persistence;
    if(persistence?.state!=='error')return '';
    return `Squad data needs attention: ${errorText(persistence.error||'The saved squad file could not be updated.')}`;
  }
  async refreshSquads(){
     const [response,scenarioResponse,libraryResponse]=await Promise.all([
       api('/squads'),
       api('/squads/scenarios'),
       api('/bot-library'),
     ]);
    if(response.success){
      this.squads=Array.isArray(response.squads)?response.squads:[];
      this.squadPersistence=response.persistence||this.squads[0]?.persistence||null;
    }
     if(scenarioResponse.success){
       this.scenarios=Array.isArray(scenarioResponse.scenarios)?scenarioResponse.scenarios:[];
     }
     if(libraryResponse.success){this.libraryProfiles=Array.isArray(libraryResponse.profiles)?libraryResponse.profiles:[];}
    if(response.success||scenarioResponse.success){
      this.notifySquadsChanged();
      this.render();
    }
  }
  scenarioLauncher(){
    const panel=node('section','panel scenario-launcher');
    const heading=node('div','section-heading'),copy=node('div');
    copy.append(
      node('span','eyebrow','One-click character casts'),
      node('h2','','Spawn a Scenario'),
      node('p','muted small','Choose a cast, then Mindcraft creates the right number of bots with distinct names, personalities, formation, and starting job.'),
    );
    heading.append(copy,node('span','state-badge state-ready','Character teams'));
    panel.append(heading);
    const templates=this.templateAgents();
    if(!templates.some((agent)=>agent.name===this.scenarioDraft.templateName)){
      this.scenarioDraft.templateName=templates[0]?.name||'';
    }
    const template=select('scenarioTemplate',templates.map((agent)=>({
      value:agent.name,
      label:`${agent.name} · template`,
    })),this.scenarioDraft.templateName);
    template.disabled=!templates.length;
    template.addEventListener('change',()=>{this.scenarioDraft.templateName=template.value;});
    const leader=input('scenarioLeader','text',this.scenarioDraft.leader);
    leader.maxLength=16;leader.placeholder='Your Minecraft name';
    leader.addEventListener('input',()=>{this.scenarioDraft.leader=leader.value;this.squadControlDraft.leader=leader.value;});
    const controls=node('div','grid-2');
    controls.append(
      gridField('Bot template',template,'Uses this bot’s local model and server connection.'),
      gridField('Player to follow',leader,'The cast forms around and responds to this Minecraft player.'),
    );
    panel.append(controls);
    const grid=node('div','scenario-grid');
    if(!this.scenarios.length){
      grid.append(node('div','empty-state compact','Loading scenario templates…'));
    }
    for(const scenario of this.scenarios){
      const card=node('article','scenario-card');
      const teamIdentity=scenario.identity||{};
      const teamColor=teamIdentity.color||'dark_purple';
      card.style.setProperty('--team-hue',String(SQUAD_HUES[teamColor]??278));
      const top=node('div','scenario-card-heading');
      const teamName=node('div','scenario-team-name');
      teamName.append(
        node('span','team-badge',teamIdentity.badge||scenario.prefix?.slice(0,6).toUpperCase()||'TEAM'),
        node('strong','',teamIdentity.displayName||scenario.label),
      );
      top.append(teamName,node('span','scenario-size',`${scenario.size} bot${scenario.size===1?'':'s'}`));
      const launch=button(
        this.squadBusy==='scenario'?'Spawning…':`Spawn ${scenario.label}`,
        ()=>this.launchScenario(scenario),
        'primary',
      );
      launch.disabled=!templates.length||Boolean(this.squadBusy);
      const memberNames=teamIdentity.naming?.memberNames||scenario.memberNames||[];
      const roster=node('div','scenario-name-roster');
      memberNames.slice(0,Number(scenario.size)||12).forEach((name)=>roster.append(node('span','',name)));
      card.append(top,node('p','muted small',scenario.description));
      if(teamIdentity.motto)card.append(node('div','team-motto',`“${teamIdentity.motto}”`));
      card.append(
        roster,
        node('div','summary-detail',`${scenario.behavior} · ${scenario.formation} formation${scenario.botTypes?.length?` · ${scenario.botTypes.length} mixed bot types`:''}`),
        launch,
      );
      if(scenario.custom){
        const remove=button('Delete saved squad',()=>this.deleteCustomScenario(scenario),'danger compact');
        remove.disabled=Boolean(this.squadBusy);
        card.append(remove);
      }
      grid.append(card);
    }
    panel.append(grid,this.customScenarioBuilder());
    return panel;
  }
  customScenarioBuilder(){
    const details=document.createElement('details');details.className='scenario-builder disclosure';
    const summary=document.createElement('summary');summary.textContent='Create a saved squad';details.append(summary);
    const body=node('div','scenario-builder-body');
    body.append(node('p','muted small','Save your own cast with a clear role, behavior, formation, and optional member personas. It remains available after restart.'));
    const fields={
      label:input('customScenarioLabel','text',this.customScenarioDraft.label),
      description:input('customScenarioDescription','text',this.customScenarioDraft.description),
      size:input('customScenarioSize','number',this.customScenarioDraft.size),
      prefix:input('customScenarioPrefix','text',this.customScenarioDraft.prefix),
      badge:input('customScenarioBadge','text',this.customScenarioDraft.badge),
      color:select('customScenarioColor',SQUAD_COLORS,this.customScenarioDraft.color),
      motto:input('customScenarioMotto','text',this.customScenarioDraft.motto),
      nameStyle:select('customScenarioNameStyle',[
        {value:'themed',label:'Themed names'},
        {value:'role',label:'Names from bot role'},
        {value:'numbered',label:'Numbered prefix'},
        {value:'custom',label:'Custom roster'},
      ],this.customScenarioDraft.nameStyle),
      behavior:select('customScenarioBehavior',[['follow','Follow'],['defend','Escort & Defend'],['guard','Hold & Defend'],['scout','Scout'],['lumberjack','Lumber'],['miner','Mine'],['builder','Build'],['hunt','Hunt'],['peaceful','Peaceful trail']].map(([value,label])=>({value,label})),this.customScenarioDraft.behavior),
      formation:select('customScenarioFormation',[['tight','Tight escort'],['balanced','Balanced group'],['rings','Defensive rings'],['wide','Wide patrol']].map(([value,label])=>({value,label})),this.customScenarioDraft.formation),
    };
    fields.size.min='1';fields.size.max='12';fields.prefix.maxLength='12';fields.badge.maxLength='12';fields.motto.maxLength='120';
    Object.entries(fields).forEach(([key,control])=>{
      const sync=()=>{this.customScenarioDraft[key]=control.type==='number'?Number(control.value):control.value;};
      control.addEventListener('input',sync);control.addEventListener('change',sync);
    });
     const personas=document.createElement('textarea');personas.id='customScenarioPersonas';personas.maxLength=3600;personas.rows=3;personas.placeholder='Optional personas, one line per bot.';personas.value=this.customScenarioDraft.personas;personas.addEventListener('input',()=>{this.customScenarioDraft.personas=personas.value;});
     const memberNames=document.createElement('textarea');memberNames.id='customScenarioMemberNames';memberNames.maxLength=600;memberNames.rows=3;memberNames.placeholder='One Minecraft-safe name per bot, such as Rowan, Ash, Moss.';memberNames.value=this.customScenarioDraft.memberNames;memberNames.addEventListener('input',()=>{this.customScenarioDraft.memberNames=memberNames.value;});
     const botTypes=document.createElement('textarea');botTypes.id='customScenarioBotTypes';botTypes.maxLength=1200;botTypes.rows=3;botTypes.placeholder='Optional saved Bot Library names, one per slot. Blank slots use the template.';botTypes.value=this.customScenarioDraft.botTypes;botTypes.addEventListener('input',()=>{this.customScenarioDraft.botTypes=botTypes.value;});
     const botTypeHints=document.createElement('datalist');botTypeHints.id='savedBotTypeNames';this.libraryProfiles.forEach((profile)=>{const option=document.createElement('option');option.value=profile.name;botTypeHints.append(option);});botTypes.setAttribute('list',botTypeHints.id);
    const grid=node('div','grid-2');
     grid.append(
       gridField('Team name',fields.label),
       gridField('Minecraft fallback prefix',fields.prefix),
       gridField('Badge',fields.badge,'Short team mark shown on squad cards.'),
       gridField('Team color',fields.color),
       gridField('Motto',fields.motto),
       gridField('Naming style',fields.nameStyle),
       gridField('Description',fields.description),
       gridField('Bots',fields.size),
       gridField('Starting behavior',fields.behavior),
       gridField('Formation',fields.formation),
     );
    const save=button(this.squadBusy==='scenario-save'?'Saving…':'Save Squad',()=>this.saveCustomScenario(),'primary');save.disabled=Boolean(this.squadBusy);
     body.append(
       grid,
       gridField('Named roster',memberNames,'Optional. Names are made unique safely if another squad already uses them.'),
       gridField('Bot Library mix',botTypes,'Optional. Use saved Bot Library names in slot order to mix providers and personalities.'),
       gridField('Member personas',personas,'Optional. Lines are assigned in order; remaining bots keep the template persona.'),
       botTypeHints,
       node('div','actions'),
     );
    body.lastChild.append(save);
    details.append(body);return details;
  }
  async saveCustomScenario(){
    if(this.squadBusy)return {success:false,error:'Another squad action is already running.'};
    const draft=this.customScenarioDraft;
     const memberNames=String(draft.memberNames||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
     const spec={
       label:String(draft.label||'').trim(),
       description:String(draft.description||'').trim(),
       size:Number(draft.size),
       prefix:String(draft.prefix||'').trim(),
       behavior:draft.behavior,
       formation:draft.formation,
       botTypes:String(draft.botTypes||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean),
       personas:String(draft.personas||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean),
       memberNames,
       nameStyle:draft.nameStyle,
       identity:{
         displayName:String(draft.label||'').trim(),
         badge:String(draft.badge||'').trim(),
         color:draft.color,
         motto:String(draft.motto||'').trim(),
         naming:{style:draft.nameStyle,memberNames},
       },
     };
    this.squadBusy='scenario-save';this.render();
    const response=await socketRequest(this.socket,'squad-save-scenario',[spec],30_000);
    this.squadBusy='';
     if(response.success){this.customScenarioDraft={label:'',description:'',size:3,prefix:'Crew',behavior:'follow',formation:'balanced',personas:'',botTypes:'',badge:'',color:'aqua',motto:'',memberNames:'',nameStyle:'themed'};this.activity?.add('SQUAD',`${response.scenario.label}: saved scenario created.`,'ok');this.announce(`${response.scenario.label} is ready to deploy.`);}
    else {this.activity?.add('SQUAD',response.error||'Saved squad could not be created.','err');this.announce(response.error||'Saved squad could not be created.');}
    await this.refreshSquads();return response;
  }
  async deleteCustomScenario(scenario){
    if(!scenario?.custom||!window.confirm(`Delete saved squad '${scenario.label}'?`))return {success:false,cancelled:true};
    this.squadBusy='scenario-delete';this.render();
    const response=await socketRequest(this.socket,'squad-delete-scenario',[scenario.id],30_000);
    this.squadBusy='';
    if(!response.success)this.announce(response.error||'Saved squad could not be deleted.');
    await this.refreshSquads();return response;
  }
  launchScenario(scenario){
    const spec={
      scenarioId:scenario.id,
      templateName:this.scenarioDraft.templateName,
      leader:this.scenarioDraft.leader.trim(),
      staggerMs:Number(this.scenarioDraft.staggerMs)||750,
    };
    return this.launchScenarioSpec(spec,scenario.label);
  }
  async launchScenarioSpec(spec,scenarioLabel='Scenario'){
    if(this.squadBusy)return {success:false,error:'Another squad action is already running.'};
    if(!spec.templateName){this.announce('Set up one template bot before spawning a scenario.');return {success:false,error:'Set up one template bot before spawning a scenario.'};}
    if(!/^[A-Za-z0-9_]{3,16}$/.test(spec.leader)){this.announce('Enter your 3-16 character Minecraft player name.');return {success:false,error:'Enter your 3-16 character Minecraft player name.'};}
    this.squadBusy='scenario';this.render();
    const response=await socketRequest(this.socket,'squad-launch-scenario',[spec],30_000);
    this.squadBusy='';
    if(response.success){
      this.upsertSquad(response.squad);
      this.squadControlDraft.id=response.squad.id;
      const persistenceIssue=this.persistenceIssue(response);
      this.activity?.add('SQUAD',persistenceIssue?`${scenarioLabel} is spawning around ${spec.leader}. ${persistenceIssue}`:`${scenarioLabel} is spawning around ${spec.leader}.`,persistenceIssue?'err':'ok');
      this.announce(persistenceIssue||`${scenarioLabel} accepted. Their characters and behavior activate when they enter the world.`);
    }else{
      this.activity?.add('SQUAD',response.error||`${scenarioLabel} failed to spawn.`,'err');
      this.announce(response.error||`${scenarioLabel} failed to spawn.`);
    }
    this.notifySquadsChanged();
    this.render();
    return response;
  }
  squadCommandDeck(){
    const panel=node('section','panel squad-command-deck');
    const heading=node('div','section-heading'),copy=node('div');
    copy.append(
      node('span','eyebrow','Live squad automation'),
      node('h2','','Squad Command Deck'),
      node('p','muted small','Give an entire active squad one tactical behavior, character set, or exact command.'),
    );
    heading.append(copy,node('span','state-badge state-ready','Squad-wide'));
    panel.append(heading);
    if(!this.squads.length){
      panel.append(node('div','empty-state compact','Spawn a scenario or launch a custom squad to unlock squad-wide controls.'));
      return panel;
    }
    if(!this.squads.some((squad)=>squad.id===this.squadControlDraft.id)){
      this.squadControlDraft.id=this.squads[0]?.id||'';
    }
    const squadSelect=select('squadControlTarget',this.squads.map((squad)=>({
      value:squad.id,
      label:`${squadDisplayName(squad)} · ${squad.targetSize} bots · ${squad.state}`,
    })),this.squadControlDraft.id);
    squadSelect.addEventListener('change',()=>{this.squadControlDraft.id=squadSelect.value;});
    const leader=input('squadLeader','text',this.squadControlDraft.leader);
    leader.maxLength=16;leader.placeholder='Your Minecraft name';
    leader.addEventListener('input',()=>{this.squadControlDraft.leader=leader.value;this.scenarioDraft.leader=leader.value;});
    const formation=select('squadFormation',[
      {value:'tight',label:'Tight escort'},
      {value:'balanced',label:'Balanced group'},
      {value:'rings',label:'Defensive rings'},
      {value:'wide',label:'Wide patrol'},
    ],this.squadControlDraft.formation);
    formation.addEventListener('change',()=>{this.squadControlDraft.formation=formation.value;});
    const top=node('div','squad-control-grid');
    top.append(
      gridField('Squad',squadSelect),
      gridField('Leader / player',leader),
      gridField('Formation spacing',formation),
    );
    panel.append(top,node('div','director-field-label','Quick behaviors'));
    const behaviors=node('div','squad-behavior-grid');
    [
      ['Regroup','regroup','Come to the leader once.'],
      ['Follow','follow','Continuously follow in formation.'],
      ['Escort & Defend','defend','Follow, fight threats, and hold formation.'],
      ['Hold & Defend','guard','Stop moving and defend the current area.'],
      ['Scout Area','scout','Autonomously survey and report nearby terrain.'],
      ['Lumber Work','lumberjack','Find trees, collect logs, and manage tools.'],
      ['Mining Work','miner','Mine useful blocks, light passages, and watch hazards.'],
      ['Build Crew','builder','Gather, coordinate, and work on practical structures.'],
      ['Hunt Together','hunt','Follow while hunting and defending.'],
      ['Peaceful Trail','peaceful','Avoid fights and follow the leader.'],
      ['Read Situations','awareness','Ask every member for current awareness.'],
      ['Stop Squad Work','stop','End goals and stop current squad actions.'],
    ].forEach(([label,behavior,title])=>{
      const control=button(label,()=>this.applySquadBehavior(behavior,label),'squad-behavior');
      control.title=title;
      control.disabled=Boolean(this.squadBusy);
      behaviors.append(control);
    });
    panel.append(behaviors);

    const roleSection=node('div','squad-roleplay-section');
    roleSection.append(node('h3','','Character & roleplay'));
    const preset=select('squadPersonaPreset',[
      {value:'adventurers',label:'Adventuring party'},
      {value:'defenders',label:'Defender company'},
      {value:'workers',label:'Working crew'},
      {value:'characters',label:'Colorful characters'},
    ],this.squadControlDraft.personaPreset);
    preset.addEventListener('change',()=>{this.squadControlDraft.personaPreset=preset.value;});
    const custom=input('squadCustomPersona','text',this.squadControlDraft.customPersona);
    custom.placeholder='Optional custom role for every member';
    custom.maxLength=520;
    custom.addEventListener('input',()=>{this.squadControlDraft.customPersona=custom.value;});
    const applyPersona=button('Apply Characters',()=>this.applySquadPersona(),'primary');
    applyPersona.title='Give each bot a distinct role from the selected cast, or apply the custom role to all members.';
    const roleGrid=node('div','grid-2');
    roleGrid.append(
      gridField('Character cast',preset,'Cycles distinct roles across the squad.'),
      gridField('Custom character override',custom,'Leave blank to use distinct preset characters.'),
    );
    const roleActions=node('div','actions');roleActions.append(applyPersona);
    roleSection.append(roleGrid,roleActions);
    panel.append(roleSection);

    const customSection=node('div','squad-custom-command');
    customSection.append(node('h3','','Exact squad command'));
    const command=input('squadExactCommand','text',this.squadControlDraft.command);
    command.maxLength=1000;
    command.addEventListener('input',()=>{this.squadControlDraft.command=command.value;});
    const send=button('Send to Whole Squad',()=>this.sendSquadCommand(),'primary');
    const commandRow=node('div','director-action-bar');
    commandRow.append(send);
     customSection.append(gridField('Command or message',command,'Sent once to every started member.'),commandRow);
     panel.append(customSection);
     const radioSection=node('div','squad-radio-section');
     radioSection.append(node('h3','','Shared squad radio'),node('p','muted small','A short human order or update delivered through MindServer to every live member, regardless of model provider.'));
     const radioKind=select('squadRadioKind',[
       {value:'order',label:'Order'}, {value:'status',label:'Status update'}, {value:'request',label:'Request'}, {value:'warning',label:'Warning'},
     ],this.squadRadioDraft.kind);
     radioKind.addEventListener('change',()=>{this.squadRadioDraft.kind=radioKind.value;});
     const radioMessage=input('squadRadioMessage','text',this.squadRadioDraft.message);
     radioMessage.maxLength=1200;radioMessage.placeholder='Example: Hold this position and report hostile mobs.';
     radioMessage.addEventListener('input',()=>{this.squadRadioDraft.message=radioMessage.value;});
     const radioSend=button('Transmit to squad',()=>this.sendSquadRadio(),'primary');
     radioSend.title='MindServer delivers this to every live member of the selected squad.';
     const radioGrid=node('div','grid-2'),radioActions=node('div','actions');
     radioGrid.append(gridField('Radio type',radioKind),gridField('Message',radioMessage));
     radioActions.append(radioSend);
     radioSection.append(radioGrid,radioActions);
     panel.append(radioSection);
     return panel;
  }
  async runSquadControl(event,spec,successMessage){
    if(this.squadBusy)return {success:false,error:'Another squad action is already running.'};
    this.squadBusy=event;this.render();
    const response=await socketRequest(this.socket,event,[spec],30_000);
    this.squadBusy='';
    this.activity?.add('SQUAD',response.success?successMessage:response.error||'Squad command failed.',response.success?'ok':'err');
    this.announce(response.success?successMessage:response.error||'Squad command failed.');
    this.notifySquadsChanged();
    this.render();
    return response;
  }
  applySquadBehavior(behavior,label){
    return this.runSquadControl('squad-behavior',{
      id:this.squadControlDraft.id,
      behavior,
      leader:this.squadControlDraft.leader.trim(),
      formation:this.squadControlDraft.formation,
    },`${label} sent to the squad.`);
  }
  applySquadPersona(){
    return this.runSquadControl('squad-persona',{
      id:this.squadControlDraft.id,
      preset:this.squadControlDraft.personaPreset,
      custom:this.squadControlDraft.customPersona.trim(),
    },'Character roles applied to the squad.');
  }
   sendSquadCommand(){
    return this.runSquadControl('squad-command',{
      id:this.squadControlDraft.id,
      message:this.squadControlDraft.command.trim(),
     },'Command sent to the whole squad.');
   }
   sendSquadRadio(){
     const message=this.squadRadioDraft.message.trim();
     if(!message){this.announce('Write a short squad radio message first.');return Promise.resolve({success:false,error:'Write a short squad radio message first.'});}
     return this.runSquadControl('squad-radio',{
       squadId:this.squadControlDraft.id,
       message,
       kind:this.squadRadioDraft.kind,
     },'Squad radio transmitted.');
   }
  squadLauncher(){
    const panel=node('section','panel squad-launcher');
    const heading=node('div','section-heading'),copy=node('div');
    copy.append(
      node('span','eyebrow','Controlled batch launch'),
      node('h2','','Squad Launcher'),
      node('p','muted small','Clone one configured bot into a named group. Launches are staggered and capped at 12 bots per squad.'),
    );
    heading.append(copy,node('span','state-badge state-ready','1–12 bots'));
    panel.append(heading);

    const templates=this.templateAgents();
    if(!templates.some((agent)=>agent.name===this.squadDraft.templateName)){
      this.squadDraft.templateName=templates[0]?.name||'';
    }
    const template=select('squadTemplate',templates.map((agent)=>({
      value:agent.name,
      label:`${agent.name} · ${agent.in_game?'in game':'configured'}`,
    })),this.squadDraft.templateName);
    template.disabled=!templates.length;
    template.addEventListener('change',()=>{this.squadDraft.templateName=template.value;});
    const prefix=input('squadPrefix','text',this.squadDraft.prefix);
    prefix.maxLength=12;
    prefix.pattern='[A-Za-z][A-Za-z0-9_]{1,11}';
    prefix.placeholder='Squad_';
    prefix.addEventListener('input',()=>{this.squadDraft.prefix=prefix.value;});
    const size=input('squadSize','number',this.squadDraft.size);
    size.min='1';size.max='12';size.step='1';
    size.addEventListener('input',()=>{
      this.squadDraft.size=Number(size.value);
      [...presets.querySelectorAll('button')].forEach((candidate)=>candidate.setAttribute('aria-pressed','false'));
      if(this.squadLaunchButton)this.squadLaunchButton.textContent=`Launch ${Number(this.squadDraft.size)||''} bots`;
    });
    const stagger=select('squadStagger',[
      {value:'500',label:'0.5 sec · fast'},
      {value:'750',label:'0.75 sec · recommended'},
      {value:'1000',label:'1 sec'},
      {value:'2000',label:'2 sec · gentle'},
    ],String(this.squadDraft.staggerMs));
    stagger.addEventListener('change',()=>{this.squadDraft.staggerMs=Number(stagger.value);});
    const controls=node('div','squad-control-grid');
    controls.append(
      gridField('Template bot',template,'Private model settings stay on the server.'),
      gridField('Name prefix',prefix,'Creates names such as Squad_1 and Squad_2.'),
      gridField('Squad size',size,'Hard limit: 12 in one launch.'),
      gridField('Start spacing',stagger,'Reduces connection and model startup spikes.'),
    );
    panel.append(controls);

    const identityDetails=document.createElement('details');
    identityDetails.className='squad-identity-builder disclosure';
    const identitySummary=document.createElement('summary');
    identitySummary.textContent='Team identity & custom roster';
    identityDetails.append(identitySummary);
    const identityBody=node('div','squad-identity-body');
    const displayName=input('squadDisplayName','text',this.squadDraft.displayName);
    const badge=input('squadBadge','text',this.squadDraft.badge);badge.maxLength='12';
    const color=select('squadColor',SQUAD_COLORS,this.squadDraft.color);
    const motto=input('squadMotto','text',this.squadDraft.motto);motto.maxLength='120';
    const nameStyle=select('squadNameStyle',[
      {value:'numbered',label:'Numbered prefix'},
      {value:'role',label:'Names from bot role'},
      {value:'custom',label:'Custom roster'},
    ],this.squadDraft.nameStyle);
    const memberNames=document.createElement('textarea');
    memberNames.id='squadMemberNames';memberNames.rows=2;memberNames.maxLength=600;
    memberNames.placeholder='Optional names, one per line: Rowan, Ash, Moss';
    memberNames.value=this.squadDraft.memberNames;
    [
      [displayName,'displayName'],
      [badge,'badge'],
      [color,'color'],
      [motto,'motto'],
      [nameStyle,'nameStyle'],
    ].forEach(([control,key])=>{
      const sync=()=>{this.squadDraft[key]=control.value;};
      control.addEventListener('input',sync);control.addEventListener('change',sync);
    });
    memberNames.addEventListener('input',()=>{this.squadDraft.memberNames=memberNames.value;});
    const identityGrid=node('div','grid-2');
    identityGrid.append(
      gridField('Team name',displayName,'Shown on squad cards; does not alter login identity.'),
      gridField('Badge',badge),
      gridField('Team color',color),
      gridField('Motto',motto),
      gridField('Naming style',nameStyle),
    );
    identityBody.append(identityGrid,gridField('Named roster',memberNames,'Names are sanitized, kept within 16 characters, and made unique automatically.'));
    identityDetails.append(identityBody);
    panel.append(identityDetails);

    const presets=node('div','squad-preset-row');
    for(const [label,value] of [['Small (3)',3],['Medium (5)',5],['Large (8)',8],['Maximum (12)',12]]){
      const preset=button(label,()=>{
        this.squadDraft.size=value;
        size.value=String(value);
        [...presets.querySelectorAll('button')].forEach((candidate)=>candidate.setAttribute('aria-pressed','false'));
        preset.setAttribute('aria-pressed','true');
        if(this.squadLaunchButton)this.squadLaunchButton.textContent=`Launch ${value} bots`;
      },'squad-preset');
      preset.setAttribute('aria-pressed',String(this.squadDraft.size===value));
      presets.append(preset);
    }
    const launch=button(
      this.squadBusy==='launch'?'Launching…':`Launch ${Number(this.squadDraft.size)||''} bots`,
      ()=>this.launchSquad(),
      'primary',
    );
    launch.classList.add('squad-launch-button');
    launch.disabled=!templates.length||Boolean(this.squadBusy);
    this.squadLaunchButton=launch;
    const actions=node('div','squad-launch-row');
    actions.append(presets,launch);
    panel.append(actions);
    this.squadListEl=node('div','squad-list');
    panel.append(this.squadListEl);
    return panel;
  }
  renderSquads(){
    if(!this.squadListEl)return;
    clear(this.squadListEl);
    if(!this.squads.length){
      this.squadListEl.append(node('div','empty-state compact','No squads launched in this control-center session.'));
      if(this.squadPersistence?.state==='error'){
        const warning=node('div','summary-detail',`Squad data needs attention: ${errorText(this.squadPersistence.error||'The saved squad file could not be read or updated.')}`);
        warning.title='Running squad actions are separate from durable squad data. Repair the saved squad data before relying on it after a restart.';
        this.squadListEl.append(warning);
      }
      return;
    }
    const ordered=[...this.squads].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    for(const squad of ordered){
      const card=node('article','squad-card'),head=node('div','squad-card-heading'),copy=node('div');
      const teamIdentity=squad.identity||squad.scenario?.identity||{};
      card.style.setProperty('--team-hue',String(SQUAD_HUES[teamIdentity.color||'aqua']??187));
      copy.append(
        node('span','team-badge',teamIdentity.badge||squad.prefix?.slice(0,6).toUpperCase()||'TEAM'),
        node('strong','',`${squadDisplayName(squad)} · ${squad.targetSize} bots`),
        node('div','summary-detail',squad.scenario
          ? `${squad.scenario.behavior} around ${squad.scenario.leader} · ${squad.scenario.formation} formation`
          : `Template: ${squad.templateName} · ${squad.staggerMs} ms spacing`),
      );
      const tone=['running'].includes(squad.state)?'state-running':['failed'].includes(squad.state)?'state-failed':['stopped'].includes(squad.state)?'state-stopped':'state-starting';
      head.append(copy,node('span',`state-badge ${tone}`,String(squad.state||'unknown')));
      card.append(head);
      if(teamIdentity.motto)card.append(node('div','team-motto',`“${teamIdentity.motto}”`));
      const completed=Math.min(Number(squad.targetSize)||0,(Number(squad.startedCount)||0)+(Number(squad.failedCount)||0));
      const progress=node('div','squad-progress');
      progress.setAttribute('role','progressbar');
      progress.setAttribute('aria-label',`${squad.prefix} launch progress`);
      progress.setAttribute('aria-valuemin','0');
      progress.setAttribute('aria-valuemax',String(squad.targetSize||0));
      progress.setAttribute('aria-valuenow',String(completed));
      const bar=node('span','');
      bar.style.width=`${squad.targetSize?Math.round((completed/squad.targetSize)*100):0}%`;
      progress.append(bar);
      card.append(progress,node('div','summary-detail',`${squad.startedCount||0} started · ${squad.failedCount||0} failed · ${squad.targetSize||0} requested`));
      const persistence=squad.persistence||this.squadPersistence;
      if(persistence?.state==='error'){
        const warning=node('div','summary-detail',`Squad data needs attention: ${errorText(persistence.error||'The saved squad file could not be updated.')}`);
        warning.title='This squad can still operate in the current control-center session, but its saved state is not reliable after restart.';
        card.append(warning);
      }
      const members=node('div','squad-members');
      for(const member of Array.isArray(squad.members)?squad.members:[]){
        const displayName=member.identity?.displayName||member.name;
        const chip=node('span',`squad-member member-${member.state}`,`${displayName} · ${member.state}`);
        if(displayName!==member.name)chip.title=`Minecraft login: ${member.name}`;
        if(member.error)chip.title=errorText(member.error);
        members.append(chip);
      }
      card.append(members);
      const actions=node('div','actions');
      const active=['launching','starting','running','partial','stopping'].includes(squad.state);
      if(active){
        const stop=button('Stop Squad',()=>this.runSquadAction('squad-stop',squad.id,`Stop ${squad.prefix} only?`),'danger');
        stop.disabled=Boolean(this.squadBusy);
        actions.append(stop);
      }
      if(['stopped','failed'].includes(squad.state)){
        const start=button('Start Again',()=>this.runSquadAction('squad-start',squad.id),'primary');
        start.disabled=Boolean(this.squadBusy);
        actions.append(start);
      }
      if(['stopped','failed'].includes(squad.state)){
        card.append(node('div','summary-detail','Removing this squad releases its names. Bot memory and history files are kept on disk.'));
        const remove=button('Remove Squad',()=>this.runSquadAction(
          'squad-remove',
          squad.id,
          `Remove ${squad.prefix} from this control-center session? Bot memory and history files are kept on disk.`,
        ),'danger');
        remove.disabled=Boolean(this.squadBusy);
        actions.append(remove);
      }
      card.append(actions);
      this.squadListEl.append(card);
    }
  }
  launchSquad(){
    const memberNames=String(this.squadDraft.memberNames||'').split(/\r?\n/).map((value)=>value.trim()).filter(Boolean);
    const spec={
      templateName:this.squadDraft.templateName,
      prefix:this.squadDraft.prefix.trim(),
      size:Number(this.squadDraft.size),
      staggerMs:Number(this.squadDraft.staggerMs),
      memberNames,
      identity:{
        displayName:this.squadDraft.displayName.trim(),
        badge:this.squadDraft.badge.trim(),
        color:this.squadDraft.color,
        motto:this.squadDraft.motto.trim(),
        naming:{
          style:memberNames.length?'custom':this.squadDraft.nameStyle,
          memberNames,
        },
      },
    };
    return this.launchSquadSpec(spec);
  }
  async launchSquadSpec(spec){
    if(this.squadBusy)return {success:false,error:'Another squad action is already running.'};
    if(!Number.isInteger(spec.size)||spec.size<1||spec.size>12){
      this.announce('Choose a squad size from 1 to 12.');
      return {success:false,error:'Choose a squad size from 1 to 12.'};
    }
    if(!spec.templateName){
      this.announce('Choose a configured template bot.');
      return {success:false,error:'Choose a configured template bot.'};
    }
    if(spec.size>=8&&!window.confirm(`Launch ${spec.size} bots from ${spec.templateName}?`)){
      return {success:false,cancelled:true,error:'Squad launch cancelled.'};
    }
    this.squadBusy='launch';this.render();
    const response=await socketRequest(this.socket,'squad-launch',[spec],30_000);
    this.squadBusy='';
    if(response.success){
      this.upsertSquad(response.squad);
      const persistenceIssue=this.persistenceIssue(response);
      this.activity?.add('SQUAD',persistenceIssue?`${spec.prefix}: ${spec.size}-bot launch accepted. ${persistenceIssue}`:`${spec.prefix}: ${spec.size}-bot launch accepted.`,persistenceIssue?'err':'ok');
      this.announce(persistenceIssue||`${spec.size}-bot squad launch accepted.`);
    }else{
      this.activity?.add('SQUAD',response.error||'Squad launch failed.','err');
      this.announce(response.error||'Squad launch failed.');
    }
    this.notifySquadsChanged();
    this.render();
    return response;
  }
  async runSquadAction(event,id,confirmation=''){
    if(this.squadBusy)return;
    if(confirmation&&!window.confirm(confirmation))return;
    this.squadBusy=`${event}:${id}`;this.renderSquads();
    const response=await socketRequest(this.socket,event,[id],30_000);
    this.squadBusy='';
    if(!response.success)this.announce(response.error||'Squad action failed.');
    await this.refreshSquads();
    const persistenceIssue=this.persistenceIssue(response);
    if(response.success&&persistenceIssue)this.announce(persistenceIssue);
    this.activity?.add('SQUAD',response.success?(persistenceIssue?`${event} completed. ${persistenceIssue}`:`${event} completed.`):response.error||`${event} failed.`,response.success&&!persistenceIssue?'ok':'err');
    this.notifySquadsChanged();
    return response;
  }
  renderList(){
    if(!this.listEl)return;
    clear(this.listEl);
    if(!this.agents.length){
      const empty=node('div','empty-state');
      empty.append(node('strong','','No bot is configured yet'),node('span','','Use Bot Setup to choose an installed Ollama model and Minecraft world.'));
      empty.append(button('Set Up My First Bot',()=>this.onSetup?.(),'primary'));
      this.listEl.append(empty);
      return;
    }
    this.agents.forEach((agent)=>{
      const state=normalizeState(agent),pending=this.pending.get(agent.name),row=node('div','agent-row');
      row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-selected',String(agent.name===this.selected));
      row.addEventListener('click',(event)=>{if(event.target instanceof Element&&event.target.closest('button'))return;this.selected=agent.name;this.tab='chat';this.render();});
      row.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.selected=agent.name;this.tab='chat';this.render();}});
      const main=node('div','agent-row-main');
       main.append(node('span','agent-row-name',agent.name),node('span','agent-row-detail',`${agent.in_game?'In game':agent.socket_connected?'Connecting…':'Offline'}${agent.provider?` · ${agent.provider}`:''}`));
      row.append(main,node('span',`state-badge state-${state}`,stateLabels[state]));
      const pendingLabel=pending?.type==='stop'?'Disconnecting…':pending?.type==='restart'?'Restarting…':'Starting…';
      const connecting=!agent.in_game&&(agent.socket_connected||['starting','restarting','running'].includes(state));
      const label=pending?pendingLabel:agent.in_game?'Disconnect':state==='stopping'?'Stopping…':connecting?'Connecting…':state==='failed'?'Retry Start':'Start';
      const action=button(label,()=>agent.in_game?this.stop(agent.name):this.start(agent),`agent-start-button ${agent.in_game?'danger':''}`);
      action.dataset.agentName=agent.name;
      action.disabled=Boolean(pending)||(!agent.in_game&&(connecting||state==='stopping'||!this.retryable(agent)));
      row.append(action);
      this.listEl.append(row);
    });
  }
  retryable(agent){
    const state=normalizeState(agent);
    if(['blocked','failed'].includes(state)&&typeof agent?.retryable==='boolean')return agent.retryable;
    const readinessTimedOut=state==='failed'&&/did not become world-ready within \d+ seconds/i.test(String(agent?.lastError||''));
    return readinessTimedOut||canStartAgent(agent);
  }
  appendMessage(name,source,message){
    const text=String(message||'').trim();
    if(!text)return;
    const entries=Array.isArray(this.messages[name])?this.messages[name]:[];
    entries.push({source:String(source||'Bot'),text:text.slice(0,2000)});
    this.messages[name]=entries.slice(-MAX_CHAT_ENTRIES);
  }
  renderFocused(){
    if(!this.focusPanel)return;
    clear(this.focusPanel);
    const agent=this.agents.find((candidate)=>candidate.name===this.selected);
    if(!agent){this.focusPanel.append(node('div','empty-state','Select a bot to inspect its workspace.'));return;}
    const state=normalizeState(agent),pending=this.pending.get(agent.name);
    const head=node('div','agent-header'),title=node('div');
    title.append(node('h2','',agent.name),node('span',`state-badge state-${state}`,stateLabels[state]));
    const actions=node('div','heading-actions');
    const pendingLabel=pending?.type==='stop'?'Disconnecting…':pending?.type==='restart'?'Restarting…':'Starting…';
    const connecting=!agent.in_game&&(agent.socket_connected||['starting','restarting','running'].includes(state));
    const startButton=button(pending?pendingLabel:agent.in_game?'Disconnect':state==='stopping'?'Stopping…':connecting?'Connecting…':state==='failed'?'Retry Start':'Start',()=>agent.in_game?this.stop(agent.name):this.start(agent),agent.in_game?'danger':'primary');
    startButton.classList.add('agent-start-button');
    startButton.dataset.agentName=agent.name;
    startButton.disabled=Boolean(pending)||(!agent.in_game&&(connecting||state==='stopping'||!this.retryable(agent)));
    actions.append(startButton,button('Settings',()=>this.openSettings(agent.name)));
    head.append(title,actions);
    this.focusPanel.append(head);
    if(agent.lastError){
      this.focusPanel.append(node('div',`agent-state-detail ${state==='failed'?'error-copy':'warning-copy'}`,errorText(agent.lastError)));
      const guidance=node('div','muted small');
      if(isCredentialReason(agent.lastError))guidance.textContent='Configure the required provider key in Bot Setup, then retry Start.';
      else if(this.retryable(agent))guidance.textContent='Review the reason above, then retry when ready.';
      else guidance.textContent='Review the profile or agent name in Bot Setup; retry is unavailable for this condition.';
      this.focusPanel.append(guidance);
    }
    const tabs=node('div','tab-list');
    ['chat','state','inventory','lifecycle','view'].forEach((tab)=>{
      const control=button(tab[0].toUpperCase()+tab.slice(1),()=>{this.tab=tab;this.renderFocused();},'tab');
      control.setAttribute('aria-selected',String(this.tab===tab));
      tabs.append(control);
    });
    this.focusPanel.append(tabs);
    const body=node('div');
    if(this.tab==='chat')this.renderChat(body,agent);
    if(this.tab==='state')this.renderState(body,agent);
    if(this.tab==='inventory')this.renderInventory(body,agent);
    if(this.tab==='lifecycle')this.renderLifecycle(body,agent);
    if(this.tab==='view')this.renderView(body,agent);
    this.focusPanel.append(body);
  }
  renderChat(body,agent){
    const log=node('div','chat-log');
    const entries=Array.isArray(this.messages[agent.name])?this.messages[agent.name]:[];
    if(entries.length){
      entries.forEach((entry)=>{
        const item=node('div','log-entry');
        item.append(node('strong','chat-source',`${entry.source}: `),node('span','',entry.text));
        log.append(item);
      });
    }else{
      log.append(node('div','empty-state','No bot messages captured since this page opened.'));
    }
    const row=node('div','actions');
    const field=input(`chat-${agent.name}`);
    field.placeholder='Message the agent…';
    const send=button('Send',async()=>{if(field.value.trim()){const result=await this.send(agent.name,field.value);if(result?.success)field.value='';}},'primary');
    field.addEventListener('keydown',e=>{if(e.key==='Enter')send.click();});
    row.append(field,send,button('Stop Action',()=>this.send(agent.name,'!stop')),button('Stay Still',()=>this.send(agent.name,'!stay(-1)')));
    body.append(log,row);
  }
  renderState(body,agent){
    const st=this.states[agent.name];
    if(!st||st.error){
      const reason=st?.error?`Live game telemetry is unavailable: ${st.error}.`:'Waiting for a live game sample. This is not the same as the bot being idle.';
      body.append(node('div','empty-state',reason));
      return;
    }
    const gp=st.gameplay||{},identity=st.identity||{},inv=st.inventory||{},eq=inv.equipment||{},action=st.action||{},attention=st.attention||{},dialogue=st.dialogue||{},bodyState=st.body||{},nearby=st.nearby||{},perception=st.perception||{},surroundings=st.surroundings||{},result=action.lastResult;
    const freshness=telemetryFreshness(st);
    const values=[
      ['Telemetry',freshness.label],
      ['Character',[identity.displayName,identity.callSign&&`call sign ${identity.callSign}`,identity.title].filter(Boolean).join(' · ')||agent.name],
      ['Role / job',[identity.role,identity.job].filter(Boolean).join(' · ')||'General companion'],
      ['Squad',identity.squad?.displayName||'No squad assignment'],
      ['Activity',action.current||'Unknown — no action state returned'],
      ['Behavior',behaviorStatusLabel(action)],
      ['Control',operatorControlLabel(action)],
      ['Attention',attentionStatusLabel(attention)],
      ['Dialogue',dialogueStatusLabel(dialogue)],
      ['Last outcome',actionOutcomeLabel(result)],
      ['Verified target',actionTargetLabel(result)],
      ['Position',positionLabel(gp.position)],
      ['Biome',gp.biome||'Unavailable'],
      ['Health',typeof gp.health==='number'?`${gp.health}/${gp.healthMax??20}`:'Unavailable'],
      ['Hunger',typeof gp.hunger==='number'?`${gp.hunger}/${gp.hungerMax??20}`:'Unavailable'],
      ['Equipment',eq.mainHand||bodyState.mainHand||'Empty hand'],
      ['Inventory',Number.isFinite(inv.stacksUsed)&&Number.isFinite(inv.totalSlots)?`${inv.stacksUsed}/${inv.totalSlots} slots`:'Unavailable'],
      ['Motion',bodyState.onGround===false?'Airborne':bodyState.onGround===true?'Grounded':'Unknown'],
      ['Route',pathGoalLabel(action.pathfinding)],
    ];
    const grid=node('div','telemetry-grid');
    values.forEach(([label,value])=>{const item=node('div','telemetry');item.append(node('div','telemetry-label',label),node('div','telemetry-value',value));grid.append(item);});
    if(freshness.stale){
      body.append(node('div','warning-copy small',freshness.error?`${freshness.label}: ${freshness.error}`:freshness.label));
    }
    const recoveryMessage=runtimeRecoveryMessage(action);
    if(recoveryMessage)body.append(node('div','warning-copy small',recoveryMessage));
    body.append(grid);

    if(result?.detail){
      const outcome=node('div','telemetry');
      outcome.append(node('div','telemetry-label','Verified action detail'),node('div','telemetry-value',result.detail));
      body.append(outcome);
    }

    // The runtime has always published why it chose what it chose; until now
    // nothing showed it.
    const brain=renderBotBrain(st,{
      send:(command)=>this.send(agent.name,command),
      onSkip:button('Skip step',()=>this.send(agent.name,'!skipAgendaItem')),
      onClear:button('Clear plan',()=>this.send(agent.name,'!clearAgenda')),
    });
    if(brain)body.append(brain);

    const world=node('div','stack');
    world.append(node('h3','','World around this bot'),node('div','muted small',perceptionStatusLabel(perception)));
    const scanUnavailable=['unsampled','unavailable'].includes(String(perception.status||'unsampled'));
    const worldValues=[
      ['Nearby players',namedList(nearby.humanPlayers,'No players in the local roster')],
      ['Other bots',namedList(nearby.botPlayers,'No other bots in the local roster')],
      ['Hostiles',scanUnavailable?perceptionStatusLabel(perception):namedList(perception.hostiles,'None in the latest scan')],
      ['Hazards',scanUnavailable?perceptionStatusLabel(perception):namedList(perception.hazards,'None in the latest scan')],
      ['Resources',scanUnavailable?perceptionStatusLabel(perception):namedList(perception.usefulBlocks,'None in the latest scan')],
      ['Dropped items',scanUnavailable?perceptionStatusLabel(perception):namedList(perception.droppedItems,'None in the latest scan')],
      ['Space ahead',surroundings.front?`${surroundings.front.bodyClear?'clear':'blocked'} body · ${surroundings.front.hasSupport?'supported':'no support'}`:'Unavailable'],
      ['Standing on',surroundings.below||'Unavailable'],
    ];
    const worldGrid=node('div','telemetry-grid');
    worldValues.forEach(([label,value])=>{const item=node('div','telemetry');item.append(node('div','telemetry-label',label),node('div','telemetry-value',value));worldGrid.append(item);});
    world.append(worldGrid);
    body.append(world);
  }
  renderInventory(body,agent){const inv=this.states[agent.name]?.inventory||{},counts=inv.counts||{},grid=node('div','inventory-grid');const entries=Object.entries(counts);if(!entries.length){body.append(node('div','empty-state','Inventory is empty or not available.'));return;}entries.sort((a,b)=>a[0].localeCompare(b[0])).forEach(([name,count])=>{const item=node('div','inventory-item');const img=document.createElement('img');img.alt=name.replace(/_/g,' ');img.src=`${location.pathname.replace(/[^/]*$/,'')}assets/item/${encodeURIComponent(agent.name)}/${encodeURIComponent(name)}.png`;img.addEventListener('error',()=>{img.remove();});item.append(img,node('div','inventory-count',count),node('div','inventory-name',name.replace(/_/g,' ')));grid.append(item);});body.append(grid);}
  renderLifecycle(body,agent){
    const list=node('div','stack');
    [['State',stateLabels[normalizeState(agent)]],['Socket',agent.socket_connected?'Connected':'Disconnected'],['In game',agent.in_game?'Yes':'No'],['Last error',agent.lastError||'None']].forEach(([l,v])=>{
      const row=node('div','telemetry');
      row.append(node('div','telemetry-label',l),node('div','telemetry-value',v));
      list.append(row);
    });
    const diagnostics=Array.isArray(agent.diagnostics)?agent.diagnostics.slice(-12):[];
    if(diagnostics.length){
      const diagnosticPanel=node('div','stack');
      diagnosticPanel.append(node('h3','','Recent failure details'));
      const output=node('pre','agent-diagnostics');
      output.textContent=diagnostics.join('\n');
      diagnosticPanel.append(output,node('div','muted small','Only bounded, redacted error output is retained. Bot chat and model responses are not captured here.'));
      list.append(diagnosticPanel);
    }
    const actions=node('div','actions');
    if(this.retryable(agent))actions.append(button('Retry Start',()=>this.start(agent),'primary'));
    if(agent.in_game)actions.append(button('Restart',()=>this.restart(agent.name)));
    actions.append(button('Remove Agent',()=>this.remove(agent.name),'danger'));
    body.append(list,actions);
  }
  renderView(body,agent){
    const port=Number(agent.viewerPort);
    if(!(agent.viewerAvailable===true&&Number.isInteger(port)&&port>0&&port<65536)){body.append(node('div','empty-state','Bot view is unavailable for this agent.'));return;}
    try{
      const frame=document.createElement('iframe');
      frame.className='viewer';frame.title=`${agent.name} bot view`;frame.src=localServiceUrl(port);
      body.append(frame);
    }catch{
      body.append(node('div','empty-state','The bot view address is invalid.'));
    }
  }
  async send(name,message){
    const value=String(message||'').trim();
    if(!value||value.length>2000){const error=value?'Bot messages must be 2,000 characters or fewer.':'Enter a bot message first.';this.announce(error);return {success:false,error};}
    const response=await socketRequest(this.socket,'send-message',[name,{from:'ADMIN',message:value}]);
    if(!response.success){
      const error=response.error||'Mindcraft could not relay that message.';
      this.announce(error);
      this.activity?.add('AGENT',`${name}: message rejected — ${error}`,'err');
      return {success:false,error};
    }
    this.appendMessage(name,'You',value);
    if(response.command==='model'&&response.message){
      this.appendMessage(name,'System',response.message);
      this.announce(response.message);
    }
    this.renderFocused();
    this.activity?.add(
      'AGENT',
      response.command==='model'?`${name}: ${response.message||'model command applied'}`:`${name}: message accepted for relay`,
      'ok',
    );
    return response;
  }
  async start(agent){
    const name=typeof agent==='string'?agent:agent?.name;
    if(!name||!this.beginPending(name,'start'))return {success:false,error:'A bot action is already pending.'};
    this.activity?.add('AGENT',`${name}: start requested`);
    const response=await socketRequest(this.socket,'start-agent',[name],AGENT_START_TIMEOUT_MS);
    if(!response.success){
      this.finishPending(name,response.error||'Bot start failed.');
      this.activity?.add('AGENT',`${name}: ${response.error||'start failed'}`,'err');
      return response;
    }
    this.activity?.add('AGENT',`${name}: start accepted`,'ok');
    return response;
  }
  async stop(name){
    if(!name||!this.beginPending(name,'stop'))return {success:false,error:'A bot action is already pending.'};
    this.activity?.add('AGENT',`${name}: disconnect requested`);
    const response=await socketRequest(this.socket,'stop-agent',[name],AGENT_STOP_TIMEOUT_MS);
    if(!response.success)this.finishPending(name,response.error||'Bot disconnect failed.');
    return response;
  }
  async restart(nameOrAgent){
    const name=typeof nameOrAgent==='string'?nameOrAgent:nameOrAgent?.name;
    if(!name||!this.beginPending(name,'restart'))return {success:false,error:'A bot action is already pending.'};
    this.activity?.add('AGENT',`${name}: restart requested`);
    const response=await socketRequest(this.socket,'restart-agent',[name],AGENT_RESTART_TIMEOUT_MS);
    if(!response.success)this.finishPending(name,response.error||'Bot restart failed.');
    return response;
  }
  async remove(name){
    if(!window.confirm(`Remove agent ${name}?`))return {success:false,cancelled:true};
    const result=await socketRequest(this.socket,'destroy-agent',[name],AGENT_REMOVE_TIMEOUT_MS);
    this.activity?.add('AGENT',result.success?`${name}: removed`:`${name}: ${result.error||'remove failed'}`,result.success?'ok':'err');
    if(!result.success)this.announce(result.error||'Bot removal failed.');
    return result;
  }
  async openSettings(name){const response=await socketRequest(this.socket,'get-settings',[name]);if(!response?.settings){this.announce(response?.error||'Bot settings are unavailable.');return;}const modal=new SettingsModal(this.modalRoot,this.socket,this.activity,this.announce,name,response.settings,this.settingsSpec);modal.open();}
  openCreate(){new CreateAgentModal(this.modalRoot,this.socket,this.activity,this.announce,this.settingsSpec).open();}
}

class BaseModal {
  constructor(root,announce){this.root=root;this.announce=announce;this.opener=document.activeElement;this.node=null;}
  close(){this.node?.remove();this.opener?.focus?.();}
  shell(title){const backdrop=node('div','modal-backdrop');backdrop.dataset.open='true';backdrop.setAttribute('role','dialog');backdrop.setAttribute('aria-modal','true');const modal=node('div','modal');modal.tabIndex=-1;const header=node('div','modal-header');header.append(node('h2','',title));const close=button('Close',()=>this.close(),'danger');header.append(close);const body=node('div','modal-body');const footer=node('div','modal-footer');modal.append(header,body,footer);backdrop.append(modal);this.root.append(backdrop);this.node=backdrop;this.body=body;this.footer=footer;requestAnimationFrame(()=>close.focus());backdrop.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();this.close();}if(e.key==='Tab'){const f=[...modal.querySelectorAll('button,input,textarea,select,[href]')].filter(x=>!x.disabled);if(f.length&&(e.shiftKey&&document.activeElement===f[0]||!e.shiftKey&&document.activeElement===f.at(-1))){e.preventDefault();(e.shiftKey?f.at(-1):f[0]).focus();}}});return {body,footer};}
}
class CreateAgentModal extends BaseModal { constructor(root,socket,activity,announce,spec){super(root,announce);this.socket=socket;this.activity=activity;this.spec=spec;}
  open(){
    const {body,footer}=this.shell('Create Agent');
    const textarea=document.createElement('textarea');
    textarea.placeholder='Paste profile JSON (must include "name").';
    textarea.maxLength=MAX_PROFILE_UPLOAD_BYTES;
    const error=node('div','error-copy');
    const settings=node('div','grid-2');
    const inputs={};
    Object.keys(this.spec||{}).filter((key)=>key!=='profile').forEach((key)=>{
      const config=this.spec[key];
      const control=input(`create-${key}`,config.type==='boolean'?'checkbox':config.type==='number'?'number':'text',config.default===null?'null':typeof config.default==='object'?JSON.stringify(config.default):config.default??'');
      if(control.type==='checkbox')control.checked=config.default===true;
      inputs[key]=control;
      settings.append(gridField(key,control));
    });
    const upload=document.createElement('input');
    upload.type='file';upload.accept='.json,application/json';upload.hidden=true;
    upload.addEventListener('change',()=>{
      const file=upload.files?.[0];
      if(!file)return;
      if(file.size===0||file.size>MAX_PROFILE_UPLOAD_BYTES){
        error.textContent=`Profile files must be between 1 byte and ${MAX_PROFILE_UPLOAD_BYTES/1024} KB.`;
        upload.value='';
        return;
      }
      const reader=new FileReader();
      reader.addEventListener('error',()=>{error.textContent='The selected profile file could not be read.';});
      reader.addEventListener('load',()=>{textarea.value=typeof reader.result==='string'?reader.result.slice(0,MAX_PROFILE_UPLOAD_BYTES):'';error.textContent='';});
      reader.readAsText(file);
    });
    body.append(gridField('Profile JSON',textarea),button('Choose JSON File',()=>upload.click()),upload,settings,error);
    const create=button('Create Agent',async()=>{
      let profile,result;
      try{
        profile=JSON.parse(textarea.value);
        if(!profile||typeof profile!=='object'||Array.isArray(profile)||!profile.name)throw new Error('Profile must be an object with a name.');
        result={profile};
        Object.entries(inputs).forEach(([key,control])=>{result[key]=readSettingValue(this.spec[key],control);});
      }catch(parseError){
        error.textContent=`Invalid setting: ${errorText(parseError?.message||parseError)}`;
        return;
      }
      create.disabled=true;
      error.textContent='Creating bot…';
      const response=await socketRequest(this.socket,'create-agent',[result],AGENT_START_TIMEOUT_MS);
      if(!response.success){
        create.disabled=false;
        error.textContent=response.error||'Create failed.';
        return;
      }
      this.activity?.add('AGENT',`${profile.name}: created`,'ok');
      this.close();
    },'primary');
    footer.append(create);
  }
}
class SettingsModal extends BaseModal { constructor(root,socket,activity,announce,name,settings,spec){super(root,announce);this.socket=socket;this.activity=activity;this.name=name;this.settings=settings;this.spec=spec;}
  open(){
    const {body,footer}=this.shell(`${this.name} Settings`);
    const form=node('div','grid-2');
    const inputs={};
    Object.keys(this.spec||{}).filter((key)=>key!=='profile').forEach((key)=>{
      const config=this.spec[key],value=this.settings[key]??config.default??'';
      const control=input(`edit-${key}`,config.type==='boolean'?'checkbox':config.type==='number'?'number':'text',typeof value==='object'?JSON.stringify(value):value);
      if(control.type==='checkbox')control.checked=!!value;
      inputs[key]=control;
      form.append(gridField(key,control));
    });
    body.append(form);
    const error=node('div','error-copy');
    body.append(error);
    const apply=button('Apply & Restart',async()=>{
      let next;
      try{
        next={profile:this.settings.profile||{}};
        Object.entries(inputs).forEach(([key,control])=>{next[key]=readSettingValue(this.spec[key],control);});
      }catch(parseError){
        error.textContent=`Invalid setting: ${errorText(parseError?.message||parseError)}`;
        return;
      }
      apply.disabled=true;
      error.textContent='Applying settings…';
      const result=await socketRequest(this.socket,'set-agent-settings',[this.name,next],AGENT_RESTART_TIMEOUT_MS);
      if(!result.success){
        apply.disabled=false;
        error.textContent=result.error||'Settings update failed.';
        return;
      }
      this.activity?.add('AGENT',`${this.name}: settings applied`,'ok');
      this.close();
    },'primary');
    footer.append(button('Discard',()=>this.close()),apply);
  }
}
