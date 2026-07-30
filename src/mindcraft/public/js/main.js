import { api, optionalApi, basePath, requestControlCenterRestart } from './api.js';
import { ACTIVITY_FILTERS, ActivityLog } from './activity.js';
import { AgentsWorkspace } from './agents.js';
import { DashboardWorkspace } from './dashboard.js';
import { DirectorWorkspace } from './director.js';
import { MinecraftServerWorkspace } from './minecraft-server.js';
import { ProfilesWorkspace } from './profiles.js';
import { SwarmWorkspace } from './swarm.js';
import { $, button, clear, input, node, normalizeState, stateLabels } from './utils.js';

const workspaceEl=$('workspace'), nav=$('primaryNav'), diagnostics=$('diagnostics'), live=$('liveRegion'), context=$('workspaceContext');
const socket=window.io({path:`${basePath}socket.io`});
const activity=new ActivityLog();
let settingsSpec={};let health={};let localServices={};let agents=[];let currentWorkspace='overview';let activityFilter='all';let activityQuery='';
let managedServer=null;
let refreshPromise=null;let refreshTimer=null;let lastLocalServicesAt=0;let botStartPromise=null;
const HEALTH_REFRESH_MS=7000,LOCAL_DISCOVERY_REFRESH_MS=60000,HIDDEN_REFRESH_MS=30000;
const profileRoot=node('div'),serverRoot=node('div'),agentRoot=node('div'),directorRoot=node('div'),swarmRoot=node('div');
const ALLOWED_WORKSPACES=new Set(['overview','server','agents','profiles','director','swarm','activity']);
const mobileMenu=$('mobileMenu');

function announce(message){live.textContent='';requestAnimationFrame(()=>{live.textContent=String(message||'');});}
function activityEvent(source,message,tone=''){activity.add(source,message,tone);}

const profiles=new ProfilesWorkspace(profileRoot,activity,announce,(request)=>{
  if(request?.startLocal)return startLocalStack();
  navigate('agents');announce('Configuration applied. Waiting for selected agents.');
  return {success:true};
});
const agentsView=new AgentsWorkspace(agentRoot,$('modalRoot'),socket,activity,announce,settingsSpec);
agentsView.onSetup=()=>navigate('profiles');
agentsView.onAgentsChanged=(list)=>{agents=Array.isArray(list)?[...list]:[];renderDiagnostics();renderDashboardIfVisible();};
agentsView.onSquadsChanged=()=>renderDashboardIfVisible();
const serverView=new MinecraftServerWorkspace(serverRoot,activity,announce,(status)=>{managedServer=status;renderDiagnostics();renderDashboardIfVisible();},(status)=>{const quick=profiles.localModels?.quickstart;if(quick)quick.minecraft={host:status.host,port:status.port};void refreshHealth();},requestShutdownControlCenter,()=>agentsView.states||{});
const director=new DirectorWorkspace(directorRoot,socket,activity,agents);
const swarm=new SwarmWorkspace(swarmRoot,socket,activity);
const dashboardView=new DashboardWorkspace(workspaceEl,{
  getState:()=>({
    controlOnline:socket.connected,
    health,
    localServices,
    agents,
    agentStates:agentsView.states,
    managedServer,
    bedrockClient:serverView.bedrockClient,
    quickstart:profiles.localModels?.quickstart||{},
    recommendation:profiles.localModels?.recommendation||{},
    localProviderAvailable:Boolean(profiles.localModels?.provider?.available),
    squads:[...agentsView.squads],
    scenarios:[...agentsView.scenarios],
    squadBusy:agentsView.squadBusy,
    templates:agentsView.templateAgents(),
  }),
  isActive:()=>currentWorkspace==='overview',
  navigate,
  refresh:()=>refreshHealth(),
  startBot:startConfiguredBot,
  startAgent:(agent)=>agentsView.start(agent),
  stopBot:(name)=>agentsView.stop(name),
  stopAllBots:()=>agentsView.disconnectAll(),
  startServer:()=>runManagedServerAction('Server start','/minecraft-server/start'),
  stopServer:()=>runManagedServerAction('Server stop','/minecraft-server/stop',{interrupt:true}),
  restartServer:()=>runManagedServerAction('Server restart','/minecraft-server/restart'),
  refreshSquads:()=>agentsView.refreshSquads(),
  launchSquad:(spec)=>agentsView.launchSquadSpec(spec),
  launchScenario:(scenario,spec)=>agentsView.launchScenarioSpec({
    scenarioId:scenario.id,
    ...spec,
  },scenario.label),
  controlSquad:(event,spec,successMessage)=>agentsView.runSquadControl(event,spec,successMessage),
  squadAction:(event,id,confirmation='')=>agentsView.runSquadAction(event,id,confirmation),
  stopEverything,
  restartControlCenter,
  shutdownControlCenter:requestShutdownControlCenter,
  announce,
});
agentsView.onStatesChanged=(states)=>{dashboardView.updateAgentStates(states);serverView.updateAgentStates(states);};

socket.on('connect',()=>{setServer(true);activityEvent('SYSTEM','MindServer connected.','ok');void refreshHealth();});
socket.on('disconnect',()=>{setServer(false);activityEvent('SYSTEM','MindServer disconnected.','err');});
socket.on('connect_error',()=>setServer(false));
window.addEventListener('mindcraft-action-error',(event)=>{
  const message=String(event.detail?.message||'Dashboard action failed.').slice(0,320);
  activityEvent('SYSTEM',message,'err');announce(message);
});

function setServer(online){const el=$('serverStatus');el.className=`server-status ${online?'online':'offline'}`;el.textContent=`● Control ${online?'online':'offline'}`;renderDashboardIfVisible();renderDiagnostics();}
function workspaceTitle(key){return ({overview:'Dashboard',server:'Minecraft Server',agents:'Bots',profiles:'Bot Profiles',director:'Director',swarm:'Task Runners',activity:'Activity'})[key]||'Dashboard';}
function normalizeWorkspace(key){return ALLOWED_WORKSPACES.has(key)?key:'overview';}
function closeMobileNav(){nav.dataset.open='false';mobileMenu.setAttribute('aria-expanded','false');}
function navigate(key){
  const next=normalizeWorkspace(key);
  if(location.hash!==`#${next}`){location.hash=next;return;}
  renderWorkspace(next);
}
function renderWorkspace(key,{focus=true}={}){
  currentWorkspace=normalizeWorkspace(key);
  if(location.hash!==`#${currentWorkspace}`)history.replaceState(null,'',`#${currentWorkspace}`);
  nav.querySelectorAll('[data-workspace]').forEach((control)=>{
    if(control.dataset.workspace===currentWorkspace)control.setAttribute('aria-current','page');
    else control.removeAttribute('aria-current');
  });
  context.textContent=workspaceTitle(currentWorkspace);
  diagnostics.hidden=currentWorkspace==='overview';
  clear(workspaceEl);
  if(currentWorkspace==='overview')dashboardView.mount();
  if(currentWorkspace==='server'){workspaceEl.append(serverRoot);serverView.mount();serverView.load();}
  if(currentWorkspace==='agents'){workspaceEl.append(agentRoot);agentsView.mount();}
  if(currentWorkspace==='profiles'){workspaceEl.append(profileRoot);profiles.mount();profiles.load();}
  if(currentWorkspace==='director'){workspaceEl.append(directorRoot);director.mount();}
  if(currentWorkspace==='swarm'){workspaceEl.append(swarmRoot);swarm.mount();}
  if(currentWorkspace==='activity'){renderActivity();}
  renderDiagnostics();
  if(focus)requestAnimationFrame(()=>workspaceEl.focus({preventScroll:true}));
}
function renderActivity(){
  clear(workspaceEl);
  const summary=activity.summary({filter:activityFilter,query:activityQuery});
  const heading=node('div','workspace-heading'),text=node('div');
  text.append(
    node('h1','','Activity'),
    node('p','','A browser-local operator timeline. Bot rows are verified game-state outcomes; Director delivery rows are not completion proof.'),
  );
  const headingActions=node('div','heading-actions');
  if(activityFilter!=='all'||activityQuery){
    const reset=button('Reset view',()=>{activityFilter='all';activityQuery='';renderActivity();});
    reset.title='Show every activity entry and clear the local search phrase.';
    headingActions.append(reset);
  }
  if(activity.entries.length){
    const clearTimeline=button('Clear timeline',()=>{activity.clear();announce('The browser-local activity timeline was cleared. Minecraft, bots, and saved data were not changed.');},'secondary');
    clearTimeline.title='Clear only the activity currently held in this browser. It does not stop bots or alter Minecraft history.';
    headingActions.append(clearTimeline);
  }
  if(headingActions.childElementCount)heading.append(text,headingActions);else heading.append(text);

  const summaryGrid=node('div','activity-summary-grid');
  [
    ['Verified bot outcomes',summary.botOutcomes,'Structured results reported by a bot.'],
    ['Needs attention',summary.attention,'Failures and warnings across this local timeline.'],
    ['Showing',`${summary.visible} of ${summary.total}`,'Entries matching the active view.'],
  ].forEach(([label,value,detail])=>{
    const card=node('div','activity-summary-card');
    card.append(node('span','activity-summary-label',label),node('strong','',value),node('small','muted',detail));
    summaryGrid.append(card);
  });

  const panel=node('section','panel activity-panel');
  const panelHeading=node('div','section-heading');
  const headingCopy=node('div');
  headingCopy.append(node('h2','','Unified activity'),node('p','muted','Filter the real record first; use the detailed tabs when you need to change the thing that produced it.'));
  panelHeading.append(headingCopy);
  const toolbar=node('div','activity-toolbar');
  const filters=node('div','activity-filter-group');
  filters.setAttribute('aria-label','Activity filters');
  ACTIVITY_FILTERS.forEach((filter)=>{
    const control=button(filter.label,()=>{activityFilter=filter.id;renderActivity();},'activity-filter');
    control.setAttribute('aria-pressed',String(activityFilter===filter.id));
    control.title=`Show ${filter.label.toLowerCase()}.`;
    filters.append(control);
  });
  const search=input('activity-search','search',activityQuery);
  search.className='activity-search';
  search.placeholder='Find a bot, action, or problem';
  search.setAttribute('aria-label','Search the activity timeline');
  search.addEventListener('input',()=>{activityQuery=search.value.slice(0,120);renderActivity();});
  toolbar.append(filters,search);
  const semantics=node('div','activity-semantics');
  semantics.append(
    node('span','activity-semantics-item','BOT = verified game-side result'),
    node('span','activity-semantics-item','DIRECTOR = delivery or schedule'),
    node('span','activity-semantics-item','SYSTEM / SWARM = local control state'),
  );
  const consoleEl=node('div','console activity-console');
  activity.render(consoleEl,{filter:activityFilter,query:activityQuery});
  panel.append(panelHeading,toolbar,semantics,consoleEl);
  workspaceEl.append(heading,summaryGrid,panel);
}
activity.subscribe(()=>{if(currentWorkspace==='activity')renderActivity();});

function startConfiguredBot(){
  if(botStartPromise)return botStartPromise;
  botStartPromise=startConfiguredBotOnce().finally(()=>{botStartPromise=null;});
  return botStartPromise;
}
async function startConfiguredBotOnce(){
  if(!socket.connected)return {success:false,error:'Mindcraft is reconnecting. Try again when the control center is online.'};
  const quick=profiles.localModels?.quickstart||{};
  const minecraft=quick.minecraft;
  const configured=await api('/quickstart/local',{
    botName:quick.botName,
    chatModel:quick.chatModel,
    embeddingModel:quick.embeddingModel||'',
    host:minecraft?.host,
    port:minecraft?.port,
    autoStart:false,
  });
  if(!configured.success){activityEvent('SYSTEM',configured.error||'Unable to enable bot startup.','err');announce(configured.error||'Unable to enable bot startup.');return {success:false,error:configured.error};}
  const effectiveQuick=configured.quickstart||quick;
  const effectiveMinecraft=effectiveQuick.minecraft||minecraft||{};
  if(!effectiveQuick.botName||!effectiveQuick.chatModel){
    const error='Mindcraft saved an incomplete local bot configuration.';
    activityEvent('SYSTEM',error,'err');announce(error);return {success:false,error};
  }
  profiles.localModels.quickstart=effectiveQuick;
  const defaults=Object.fromEntries(Object.entries(settingsSpec).filter(([,spec])=>'default' in spec).map(([key,spec])=>[key,structuredClone(spec.default)]));
  const profile={name:effectiveQuick.botName,model:`ollama/${effectiveQuick.chatModel}`};
  if(effectiveQuick.embeddingModel)profile.embedding=`ollama/${effectiveQuick.embeddingModel}`;
  const blockedActions=new Set(Array.isArray(defaults.blocked_actions)?defaults.blocked_actions:[]);
  blockedActions.add('!newAction');
  blockedActions.add('!restart');
  const agentSettings={...defaults,blocked_actions:[...blockedActions],profile,host:effectiveMinecraft.host||'127.0.0.1',port:Number(effectiveMinecraft.port)||25565,auth:'offline',minecraft_version:'auto',base_profile:'assistant'};
  activityEvent('SYSTEM',`Starting ${profile.name} without restarting the dashboard.`);
  const existing=agents.find((agent)=>agent.name===profile.name);
  const result=await new Promise((resolve)=>{
    let settled=false;
    let timeout=null;
    const finish=(response)=>{if(settled)return;settled=true;if(timeout)clearTimeout(timeout);resolve(response||{success:false,error:'No response from Mindcraft.'});};
    timeout=setTimeout(()=>finish({success:false,error:'Bot start request timed out after 60 seconds.'}),60_000);
    const callback=(response)=>finish(response);
    if(existing)socket.emit('start-agent',profile.name,callback);
    else socket.emit('create-agent',agentSettings,callback);
  });
  if(!result.success){activityEvent('SYSTEM',result.error||'Bot start failed.','err');announce(result.error||'Bot start failed.');return result;}
  activityEvent('SYSTEM',`${profile.name} is online and world-ready.`,'ok');
  announce(`${profile.name} is online. Open Bots to view its live state.`);
  navigate('agents');
  return {success:true};
}
async function runManagedServerAction(label,path,options={}){
  const server=await serverView.run(label,path,{},options);
  return server?{success:true,server}:{success:false,error:serverView.result||`${label} failed.`};
}
async function stopEverything(){
  const result=await api('/system/stop',{}, {timeoutMs:120_000});
  activityEvent('SYSTEM',result.success?'Mindcraft runtime stopped and verified.':result.error||'Runtime stop failed.',result.success?'ok':'err');
  if(result.success)announce('Bots, task runners, Minecraft, and Mindcraft-started local services are stopped. The dashboard remains online.');
  return result;
}
async function restartControlCenter(){
  const result=await requestControlCenterRestart();
  if(result.success){
    activityEvent('SYSTEM','Control center restart requested.','ok');
    announce('Mindcraft is restarting. This page will reconnect automatically.');
  }
  return result;
}
function requestShutdownControlCenter(){
  if(!socket.connected)return Promise.resolve({success:false,error:'Mindcraft is offline; the shutdown request was not sent.'});
  return new Promise((resolve)=>{
    let settled=false;
    let timeout=null;
    const finish=(result)=>{if(settled)return;settled=true;if(timeout)clearTimeout(timeout);resolve(result);};
    timeout=setTimeout(()=>finish({success:false,error:'Mindcraft did not finish shutdown within 120 seconds.'}),120_000);
    socket.emit('shutdown',(result)=>{
      const response=result||{success:false,error:'Mindcraft did not acknowledge shutdown.'};
      if(response.success)announce('Mindcraft is shutting down.');
      finish(response);
    });
  });
}
async function startLocalStack(){
  const current=await serverView.load({quiet:true});
  const quick=profiles.localModels?.quickstart||{};
  const target=quick.minecraft||{};
  const targetsManaged=(!target.host||['127.0.0.1','localhost','::1'].includes(target.host))
    && (!current?.installed||Number(target.port)===Number(current.port));
  if(targetsManaged){
    if(!current?.installed){
      const error='Install the local cross-play server first. Your bot setup is saved.';
      activityEvent('SYSTEM',error,'err');announce(error);navigate('server');return {success:false,error};
    }
    if(current.compatible===false||!current.crossplay?.ready){
      const error='Replace the local server with the compatible cross-play build before starting the bot.';
      activityEvent('SYSTEM',error,'err');announce(error);navigate('server');return {success:false,error};
    }
    if(current.phase!=='running'){
      const started=await serverView.run('Server start','/minecraft-server/start',{});
      if(!started)return {success:false,error:serverView.result||'Minecraft server did not start.'};
    }
  }
  await refreshHealth();
  if(!health.checks?.minecraftReachable){
    const error=`Minecraft is not reachable at ${target.host||'127.0.0.1'}:${target.port||25565}.`;
    activityEvent('SYSTEM',error,'err');announce(error);return {success:false,error};
  }
  return startConfiguredBot();
}
function renderDashboardIfVisible(){if(currentWorkspace==='overview')dashboardView.render();}

function renderDiagnostics(){
  clear(diagnostics);
  if(currentWorkspace==='overview'){diagnostics.hidden=true;return;}
  diagnostics.hidden=false;
  const stateCounts=agents.reduce((counts,agent)=>{const key=normalizeState(agent);counts[key]=(counts[key]||0)+1;return counts;},{});
  const botSummary=Object.entries(stateCounts).map(([key,count])=>`${count} ${stateLabels[key]||key}`).join(' · ')||'None';
  const crossplayReady=Boolean(managedServer?.phase==='running'&&managedServer?.crossplay?.ready&&managedServer?.crossplay?.runtimeReady===true);
  const bedrockJoinVerified=managedServer?.crossplay?.joinVerification?.verified===true;
  const samePcBedrockNeedsSetup=Boolean(
    crossplayReady
    && managedServer?.crossplay?.access==='this-computer'
    && serverView.bedrockClient?.installed
    && !serverView.bedrockClient.loopbackEnabled
  );
  const rail=node('section','status-rail');
  rail.append(node('h2','sr-only','System status'));
  [
    ['Control',socket.connected?'Online':'Offline',socket.connected?'status-good':'status-bad'],
    ['Java',health.checks?.minecraftReachable?'Reachable':managedServer?.phase||'Offline',health.checks?.minecraftReachable?'status-good':'status-warn'],
    ['Bedrock',samePcBedrockNeedsSetup?'Setup needed':bedrockJoinVerified?'Join verified':crossplayReady?`UDP ${managedServer.crossplay.bedrockPort} · test join`:'Offline',bedrockJoinVerified?'status-good':'status-warn'],
    ['Bots',agents.length?botSummary:'Not configured',agents.some((agent)=>agent.in_game)?'status-good':agents.some((agent)=>normalizeState(agent)==='failed')?'status-bad':'status-warn'],
  ].forEach(([label,value,tone])=>{
    const item=node('div',`status-rail-item ${tone}`);
    item.append(node('span','',label),node('strong','',value));
    rail.append(item);
  });
  diagnostics.append(rail);
}
function refreshHealth({forceServices=false}={}){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    const discover=forceServices||Date.now()-lastLocalServicesAt>=LOCAL_DISCOVERY_REFRESH_MS;
    const [h,local]=await Promise.all([
      api('/health'),
      discover?optionalApi('/local-services'):Promise.resolve(null),
      serverView.load({quiet:true}),
    ]);
    if(h.success)health=h;
    else health={...health,success:false,error:h.error||'Health status is unavailable.',stale:true};
    if(local){localServices=local;lastLocalServicesAt=Date.now();}
    renderDiagnostics();renderDashboardIfVisible();
  })().finally(()=>{refreshPromise=null;});
  return refreshPromise;
}

function scheduleRefresh(delay=HEALTH_REFRESH_MS){
  if(refreshTimer)clearTimeout(refreshTimer);
  refreshTimer=setTimeout(async()=>{
    try{
      if(!document.hidden)await refreshHealth();
    }finally{
      scheduleRefresh(document.hidden?HIDDEN_REFRESH_MS:HEALTH_REFRESH_MS);
    }
  },delay);
}

nav.addEventListener('click',(event)=>{
  const target=event.target instanceof Element?event.target.closest('[data-workspace]'):null;
  if(!target)return;
  closeMobileNav();
  navigate(target.dataset.workspace);
});
mobileMenu.addEventListener('click',()=>{
  const open=nav.dataset.open==='true';
  nav.dataset.open=String(!open);
  mobileMenu.setAttribute('aria-expanded',String(!open));
});
document.addEventListener('keydown',(event)=>{
  if(event.key==='Escape'&&nav.dataset.open==='true'){
    closeMobileNav();
    mobileMenu.focus();
  }
});
window.addEventListener('hashchange',()=>{
  closeMobileNav();
  renderWorkspace(location.hash.slice(1)||'overview');
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)scheduleRefresh(HIDDEN_REFRESH_MS);
  else void refreshHealth({forceServices:true}).finally(()=>scheduleRefresh());
});
async function loadSettingsSpec(){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(`${basePath}settings_spec.json`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(!response.ok)return {};
    const raw=await response.text();
    if(raw.length>500000)return {};
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{
    return {};
  }finally{
    clearTimeout(timeout);
  }
}
async function boot(){
  settingsSpec=await loadSettingsSpec();
  agentsView.settingsSpec=settingsSpec;
  profiles.mount();
  serverView.mount();
  agentsView.mount();
  setServer(socket.connected);
  await profiles.load();
  await refreshHealth({forceServices:true});
  renderWorkspace(location.hash.slice(1)||'overview',{focus:false});
  scheduleRefresh();
}
void boot();
