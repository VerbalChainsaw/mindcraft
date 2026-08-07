// Re-verifies every load-bearing factual claim behind the 9 published defect reports,
// against the CURRENT contents of the repo (files may have changed under concurrent edit).
import { readFileSync } from 'node:fs';
import mcData from 'minecraft-data';

const R = 'C:/Users/zerop/Development/minecraft-companion-brain-v2/';
const read = p => { try { return readFileSync(R + p, 'utf8'); } catch { return null; } };
const reg = mcData('1.21.11');

let pass = 0, fail = 0;
const check = (id, claim, ok) => {
  if (ok) { pass++; console.log(`  PASS  ${id}  ${claim}`); }
  else { fail++; console.log(`> FAIL  ${id}  ${claim}`); }
};

const skills = read('src/agent/library/skills.js');
const agenda = read('src/agent/runtime/agenda.js');
const agendaDir = read('src/agent/runtime/agenda-director.js');
const policy = read('src/agent/runtime/survival-policy.js');
const survDir = read('src/agent/runtime/survival-director.js');
const shelter = read('src/agent/runtime/emergency-shelter.js');
const safety = read('src/agent/runtime/gameplay-safety.js');
const site = read('src/agent/runtime/jobs/structure-site-selector.js');
const arbiter = read('src/agent/runtime/behavior-arbiter.js');
const agentJs = read('src/agent/agent.js');
const bed = read('node_modules/mineflayer/lib/plugins/bed.js');
const actions = read('src/agent/commands/actions.js');

console.log('\n--- SLEEP-01 ---');
// FIXED UPSTREAM in bdc7e81 — regression guards for the fix, not the defect.
check('S1.1', 'the 20s force-wake ceiling is gone', !/sleepTimeoutMs\s*=\s*20_000/.test(skills));
check('S1.2', 'standalone ceiling is at least 600_000', /standaloneSleepTimeoutMs = 600_000/.test(skills));
check('S1.3', 'floored so a caller cannot shrink it below 600_000', /Math\.max\(600_000, standaloneSleepTimeoutMs\)/.test(skills));
check('S1.4', 'no wall-clock deadline at all when a cancellation signal exists',
  /signal\s*\?\s*Number\.POSITIVE_INFINITY/.test(skills));
check('S1.5', 'isNightTime window is 12542..23460 (basis for the 573s sizing)', /time >= 12542 && time < 23460/.test(policy));

console.log('\n--- SLEEP-02 ---');
// FIXED UPSTREAM in bdc7e81 — the duplicate bot-relative gate was removed.
check('S2.1', 'no bot-relative hostile pre-check remains in goToBed',
  !/hostile\.position\.distanceTo\(bot\.entity\.position\)\s*<=\s*12/.test(skills));
check('S2.2', 'mineflayer does its own bed-anchored monster check', /monsterRange\s*=\s*\[7, -8, -8, 7\]/.test(bed));
check('S2.3', 'mineflayer throws "there are monsters nearby"', /there are monsters nearby/.test(bed));
check('S2.4', 'survival-director also measures threat from the bot', /safe:\s*threatDistance > 12/.test(survDir));

console.log('\n--- SLEEP-03 ---');
const strings = ['there are monsters nearby','the bed is occupied','the bed is too far',
  'wrong block : not a bed block',"there's only half bed",'already sleeping','already awake','cant click the bed'];
check('S3.1', `all ${strings.length} quoted mineflayer error strings still present`, strings.every(s => bed.includes(s)));
check('S3.2', 'outcome collapses to a single sleep_rejected', /outcome: 'sleep_rejected'/.test(skills));
check('S3.3', 'sleep_timeout has no consumer outside skills.js',
  !['src/agent/runtime/agenda-director.js','src/agent/runtime/survival-director.js','src/agent/runtime/goal-director.js']
    .some(f => (read(f) || '').includes('sleep_timeout')));

console.log('\n--- AGENDA-01 ---');
check('A1.1', "sleep is a 'direct' executor", /sleep:\s*Object\.freeze\(\{\s*executor:\s*'direct'/.test(agenda));
check('A1.2', 'MAX_ENTRY_ATTEMPTS = 2', /MAX_ENTRY_ATTEMPTS\s*=\s*2/.test(agendaDir));
check('A1.3', 'restored direct step settles as agenda_action_result_missing', /agenda_action_result_missing/.test(agendaDir));
check('A1.4', 'that fallback is retryable:true (so it charges an attempt)',
  /agenda_action_result_missing[\s\S]{0,300}?retryable:\s*true/.test(agendaDir));
check('A1.5', 'attempts increments then gates on MAX_ENTRY_ATTEMPTS',
  /const attempts = active\.attempts \+ 1/.test(agendaDir) && /attempts < MAX_ENTRY_ATTEMPTS/.test(agendaDir));
check('A1.6', "activeEntry() selects on state === 'active'", /find\(entry => entry\.state === 'active'\)/.test(agendaDir));
check('A1.7', 'replace() persists (so active survives restart)', /replace\(id, patch\)[\s\S]{0,220}?this\.persist\(\)/.test(agendaDir));
// AGENDA-01 still live: 7a99d81 added a restore-time resume, but only for jobs.
check('A1.8', "restore-time resume covers executor 'job' only, leaving 'direct' uncovered",
  /entry\.executor === 'job'/.test(agendaDir) && !/entry\.executor === 'direct'/.test(agendaDir));
check('A1.9', 'agenda_action_result_missing has no test coverage',
  !['tests/control-plane/agent-persistent-goal-handoff.test.js','tests/control-plane/job-director.test.js']
    .some(f => (read(f) || '').includes('agenda_action_result_missing')));

console.log('\n--- SURVIVAL-01 ---');
const hungerLine = policy.split('\n').findIndex(l => /hunger <= numeric\(policy\.eatAt, 14\)/.test(l)) + 1;
const sleepLine = policy.split('\n').findIndex(l => /policy\.sleep === 'safe'/.test(l)) + 1;
check('V1.1', `hunger branch (:${hungerLine}) precedes sleep branch (:${sleepLine})`,
  hungerLine > 0 && sleepLine > 0 && hungerLine < sleepLine);
check('V1.2', 'acquire_food dispatches !prepareFood(points, 64)', /prepareFood\(\$\{Math\.max\(6[\s\S]{0,60}?, 64\)/.test(survDir));
check('V1.3', "prepareFood's 2nd param is documented as a search radius", /'range':\s*\{[^}]*search radius/.test(actions));
check('V1.4', 'non-critical path returns null when not idle',
  /if \(situation\.idle !== true && !critical\) return null;/.test(policy));

console.log('\n--- SHELTER-01 ---');
check('H1.1', 'isSheltered is two upward probes only', /\[2, 3\]\.some\(height => solidCover/.test(survDir));
check('H1.2', 'solidCover accepts any boundingBox === block', /block\.boundingBox === 'block'/.test(survDir));
check('H1.3', 'oak_leaves is boundingBox block (tree counts as shelter)',
  reg.blocksByName.oak_leaves?.boundingBox === 'block');
check('H1.4', 'validator enforces the doorway stays open',
  /!occupied\.has\('0:0:-1'\) && !occupied\.has\('0:1:-1'\)/.test(shelter));
check('H1.5', 'blueprint declares 23 cells', /blueprint\.cells\.length !== 23/.test(shelter));
check('H1.6', 'sheltered===true suppresses the shelter branch', /situation\.sheltered !== true/.test(policy));

console.log('\n--- SAFETY-01 ---');
const hazBlock = safety.slice(safety.indexOf('HAZARDOUS_GAMEPLAY_BLOCKS'), safety.indexOf(']', safety.indexOf('HAZARDOUS_GAMEPLAY_BLOCKS')));
// FIXED in 3559afc — now a regression guard: these must STAY in the hazard set.
for (const n of ['sweet_berry_bush','wither_rose','pointed_dripstone']) {
  check(`F1.${n}`, `${n} present in hazard set (regression guard)`,
    hazBlock.includes(n) && Boolean(reg.blocksByName[n]));
}
check('F1.bb', 'berry bush + wither rose are boundingBox empty (pass occupancy)',
  reg.blocksByName.sweet_berry_bush.boundingBox === 'empty' && reg.blocksByName.wither_rose.boundingBox === 'empty');
check('F1.dr', 'pointed_dripstone is boundingBox block (passes support test)',
  reg.blocksByName.pointed_dripstone.boundingBox === 'block');
check('F1.pred', 'occupancy predicate uses hazard set on feet/head',
  /!isHazardousGameplayBlock\(feet\)[\s\S]{0,120}?!isHazardousGameplayBlock\(head\)/.test(skills));

console.log('\n--- SITE-01 ---');
// FIXED in 3abea39 — now a regression guard: the filter must STAY.
check('T1.1', 'entityOccupies skips non-obstructing entities (regression guard)',
  /NON_OBSTRUCTING_ENTITY_NAMES = new Set\(\['item', 'experience_orb', 'arrow'\]\)/.test(site) &&
  /!NON_OBSTRUCTING_ENTITY_NAMES\.has\(entity\?\.name\)/.test(site));
check('T1.2', 'inspectSite rejects the whole site on any occupying entity',
  /if \(entityOccupies\(bot, x, y, z\)\) return null;/.test(site));
check('T1.3', 'repo already owns the item discriminator', /entity\?\.name !== 'item'/.test(survDir));
check('T1.4', 'item / experience_orb / arrow all exist in registry',
  ['item','experience_orb','arrow'].every(n => Boolean(reg.entitiesByName[n])));

console.log('\n--- ARBITER-01 ---');
const aLines = arbiter.split('\n');
const setIdx = aLines.findIndex(l => /this\.updating = true/.test(l)) + 1;
const tryIdx = aLines.findIndex((l, i) => i > setIdx && /^\s{4}try \{/.test(l)) + 1;
// FIXED in 48c023b — regression guard: only non-throwing declarations may sit
// between the flag and the try, and the catch-visible ones must be out there.
const between = aLines.slice(setIdx, tryIdx - 1).filter(l => l.trim() && !l.trim().startsWith('//'));
check('B1.1', `only declarations between flag (:${setIdx}) and try (:${tryIdx}) — got ${between.length}`,
  between.length === 3 && between.every(l => /^\s*(const|let) /.test(l)));
check('B1.1b', 'perception declared outside the try (outer catch reads it)',
  /let perception = null;/.test(arbiter) && !/const perception = await this\.refreshPerception/.test(arbiter));
const resets = aLines.map((l,i)=>({l,i:i+1})).filter(x => /this\.updating = false/.test(x.l));
check('B1.2', `updating=false in exactly 2 places (got ${resets.length}: ${resets.map(r=>r.i).join(',')})`, resets.length === 2);
check('B1.3', 'gate returns early while updating', /if \(this\.updating\) return this\.snapshot\(\);/.test(arbiter));
check('B1.4', 'no watchdog resets updating in agent.js / behavior-director.js',
  !(read('src/agent/runtime/behavior-director.js')||'').includes('updating') && !agentJs.includes('.updating'));
check('B1.5', 'agent loop resets consecutiveFailures on a non-throwing update',
  /await this\.update\(start - last\);\s*\n\s*consecutiveFailures = 0;/.test(agentJs));
check('B1.6', 'watchdog only fires at 5 consecutive throws', /consecutiveFailures >= 5/.test(agentJs));
check('B1.7', 'refreshPerception is internally guarded (NOT the risk)',
  /async refreshPerception\(\)[\s\S]{0,1800}?catch \(error\) \{[\s\S]{0,200}?return \{/.test(arbiter));

console.log('\n--- VISION-01 (module-load hardening) ---');
const vi = read('src/agent/vision/vision_interpreter.js');
check('N1.1', 'Camera is not statically imported', !/^import \{ Camera \}/m.test(vi));
check('N1.2', 'camera module is loaded lazily', /cameraModulePromise = import\('\.\/camera\.js'\)/.test(vi));
check('N1.3', 'the load is settled before request validation', /if \(this\.cameraReady\) await this\.cameraReady;/.test(vi));
let visionLoads = true;
try { await import('../../../src/agent/vision/vision_interpreter.js'); } catch { visionLoads = false; }
check('N1.4', 'vision_interpreter imports cleanly whatever state the canvas binary is in', visionLoads);
let agentLoads = true;
try { await import('../../../src/agent/agent.js'); } catch { agentLoads = false; }
check('N1.5', 'agent.js imports cleanly (this is what took 4 test files down)', agentLoads);

console.log(`\n================ ${pass} passed, ${fail} failed ================`);
process.exit(fail ? 1 : 0);
