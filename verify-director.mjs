// Ad-hoc verification of the Director subsystem (REST + unit-level).
// Boots the real mindserver on a scratch port, exercises every endpoint,
// and verifies the leash/program engines tick with a mock transport.
import { createMindServer } from './src/mindcraft/mindserver.js';
import { director } from './src/mindcraft/director.js';

const PORT = 39811;
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const base = `http://localhost:${PORT}`;
async function api(path, body) {
  const res = await fetch(base + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  return { status: res.status, json: await res.json().catch(() => null) };
}

const server = createMindServer(false, PORT);
await new Promise(r => setTimeout(r, 800));

// 1. director pages served
const dirPage = await fetch(base + '/director.html');
check('director.html served', dirPage.status === 200);
const idx = await (await fetch(base + '/')).text();
check('dashboard links director', idx.includes('/director.html'));

// 2. command with no agent -> clean 400, no crash
let r = await api('/api/director/command', { agent: 'ghost', message: '!stop' });
check('command to missing agent -> 400 + error', r.status === 400 && r.json.error);

// 3. command validation
r = await api('/api/director/command', { agent: '', message: '' });
check('command validation', r.status === 400);

// 4. install mock transport to capture dispatches
const sent = [];
director.setSender((agent, message) => { sent.push({ agent, message }); return { ok: true }; });

r = await api('/api/director/command', { agent: 'andy', message: '!stats' });
check('command dispatch ok', r.status === 200 && r.json.success && sent.length === 1);

// 5. program: 3 fast steps, no loop
r = await api('/api/director/program', {
  agent: 'andy', name: 'test-prog',
  steps: [
    { message: 'step-one', delayMs: 300 },
    { message: 'step-two', delayMs: 300 },
    { message: 'step-three', delayMs: 300 },
  ],
});
check('program starts', r.status === 200 && r.json.success);
const progId = r.json.program.id;
await new Promise(rs => setTimeout(rs, 1400));
r = await api('/api/director/programs');
const prog = r.json.programs.find(p => p.id === progId);
check('program ran all steps and finished', prog && prog.status === 'done', JSON.stringify(prog));
check('program dispatched 3 steps', sent.filter(s => s.message.startsWith('step-')).length === 3);

// 6. program validation
r = await api('/api/director/program', { agent: 'andy', steps: [] });
check('program empty steps -> 400', r.status === 400);

// 7. looping program stops on demand
r = await api('/api/director/program', {
  agent: 'andy', name: 'looper', loop: true,
  steps: [{ message: 'loop-step', delayMs: 300 }],
});
const loopId = r.json.program.id;
await new Promise(rs => setTimeout(rs, 700));
r = await api('/api/director/program/stop', { id: loopId });
check('loop program stops', r.status === 200 && r.json.success);
const loopCountAtStop = sent.filter(s => s.message === 'loop-step').length;
await new Promise(rs => setTimeout(rs, 700));
check('stopped program stays stopped', sent.filter(s => s.message === 'loop-step').length === loopCountAtStop);
check('loop actually looped', loopCountAtStop >= 2);

// 8. leash attach / tick / release
r = await api('/api/director/leash', { agent: 'andy', message: '!followPlayer("Director", 3)', intervalMs: 2000 });
check('leash attaches', r.status === 200 && r.json.success);
r = await api('/api/director/leashes');
check('leash listed', r.json.leashes.length === 1 && r.json.leashes[0].issued >= 1);
r = await api('/api/director/unleash', { agent: 'andy' });
check('leash releases', r.status === 200 && r.json.success);
r = await api('/api/director/leashes');
check('leash list empty after release', r.json.leashes.length === 0);
r = await api('/api/director/unleash', { agent: 'andy' });
check('double-unleash -> 404', r.status === 404);

// 9. agents endpoint
r = await api('/api/agents');
check('/api/agents responds', r.status === 200 && Array.isArray(r.json.agents));

// 10. swarm endpoints still intact (regression)
r = await api('/api/swarm');
check('swarm API intact', r.status === 200 && r.json.success);

// 11. health endpoint
r = await api('/api/health');
check('/api/health responds', r.status === 200 && r.json.success);
check('health reports problems array', Array.isArray(r.json.problems));
check('health flags missing MC server', r.json.checks && typeof r.json.checks.minecraftReachable === 'boolean');

// 12. keys endpoint: validation + write + presence + no-leak
r = await api('/api/keys', {});
check('keys empty body -> 400', r.status === 400);
const fsMod = await import('fs');
const keysPath = new URL('./keys.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const hadKeys = fsMod.existsSync(keysPath);
const backup = hadKeys ? fsMod.readFileSync(keysPath, 'utf8') : null;
r = await api('/api/keys', { OPENAI_API_KEY: 'sk-test-verify-123' });
check('keys save ok', r.status === 200 && r.json.success);
check('keys response never echoes value', !JSON.stringify(r.json).includes('sk-test-verify-123'));
const written = JSON.parse(fsMod.readFileSync(keysPath, 'utf8'));
check('keys.json actually written', written.OPENAI_API_KEY === 'sk-test-verify-123');
// restore original state so verification never pollutes real config
if (hadKeys) fsMod.writeFileSync(keysPath, backup, 'utf8');
else fsMod.unlinkSync(keysPath);
check('keys.json restored to pre-test state', fsMod.existsSync(keysPath) === hadKeys);

// 13. setup wizard page carries the key form
const setupPage = await (await fetch(base + '/setup.html')).text();
check('setup wizard has key form', setupPage.includes('saveKeyBtn') && setupPage.includes('/api/keys'));
const idx2 = await (await fetch(base + '/')).text();
check('dashboard has health banner', idx2.includes('healthBanner') && idx2.includes('api/health'));

console.log(`\n${pass} passed, ${fail} failed`);
director.shutdown();
server.close(() => process.exit(fail ? 1 : 0));
setTimeout(() => process.exit(fail ? 1 : 0), 1500);
