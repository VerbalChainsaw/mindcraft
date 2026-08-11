// Satisfies the rule-5 measurement gate for TD-IO-001 and TD-MEM-001:
// "Static presence of fsyncSync is not proof of a material gameplay stall."
// Run with: node tools/measure-persistence-cost.mjs
//
// Instrument note: a synchronous fsync does not cause separately-samplable loop
// lag -- it IS the lag, since the loop is stopped for exactly the write's
// duration and no sampler can run during it. A setInterval(1) probe measures
// Windows' ~15.6ms timer granularity instead (its idle baseline comes out
// HIGHER than the write cases, which is the tell), and perf_hooks'
// monitorEventLoopDelay returns NaN across a purely synchronous block. So the
// write duration is measured directly, and the realistic pattern -- persists at
// the arbiter's ~180ms cadence -- is measured across the gaps.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { writeJsonAtomicSync } from '../src/utils/atomic-file.js';

const REPO_VOLUME_DIR = path.resolve(path.join(process.cwd(), '..'));
const dir = mkdtempSync(path.join(REPO_VOLUME_DIR, 'io-measure-'));

const payload = (approxBytes) => {
    const entries = [];
    let size = 0;
    for (let i = 0; size < approxBytes; i += 1) {
        entries.push({
            id: `landmark-${i}`, name: `oak_log_cluster_${i}`, dimension: 'overworld',
            position: { x: 100 + i, y: 64, z: -200 - i },
            observedAt: 1760000000000 + i, kind: 'resource', confidence: 0.87,
            notes: 'seen while pathing to the workshop; verified against world state',
        });
        size = JSON.stringify(entries).length;
    }
    return { version: 1, entries };
};

const stats = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    return { min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
};
const fmt = (n) => `${n.toFixed(3)}ms`;

console.log(`platform: ${os.platform()} ${os.release()}  node: ${process.version}`);
console.log(`volume:   ${dir.slice(0, 3)}\n=== single write cost ===`);

for (const [label, bytes] of [
    ['goal-state (~2KB)', 2 * 1024],
    ['job-state (27KB, observed real size)', 27 * 1024],
    ['landmarks at MAX_STORE_BYTES cap (256KB)', 256 * 1024],
    ['landmarks at observed real size (1.1KB)', 1.1 * 1024],
]) {
    const value = payload(bytes);
    const file = path.join(dir, `${bytes}.json`);
    for (let i = 0; i < 5; i += 1) writeJsonAtomicSync(file, value); // warm up
    const samples = [];
    for (let i = 0; i < 60; i += 1) {
        const started = process.hrtime.bigint();
        writeJsonAtomicSync(file, value);
        samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    const s = stats(samples);
    console.log(`${label}  [on disk ${(statSync(file).size / 1024).toFixed(1)}KB]`);
    console.log(`  min ${fmt(s.min)}  median ${fmt(s.median)}  p95 ${fmt(s.p95)}  max ${fmt(s.max)}`);
}

console.log('\n=== realistic pattern: writes at the arbiter cadence ===');
async function measureTickPattern(label, writesPerTick, value, file) {
    const TICKS = 20;
    const CADENCE_MS = 180;
    const blocked = [];
    for (let tick = 0; tick < TICKS; tick += 1) {
        const started = process.hrtime.bigint();
        for (let w = 0; w < writesPerTick; w += 1) writeJsonAtomicSync(file, value);
        blocked.push(Number(process.hrtime.bigint() - started) / 1e6);
        await new Promise(resolve => setTimeout(resolve, CADENCE_MS));
    }
    const s = stats(blocked);
    const share = (blocked.reduce((a, b) => a + b, 0) / (TICKS * CADENCE_MS)) * 100;
    console.log(`${label}`);
    console.log(`  loop blocked per tick  median ${fmt(s.median)}  p95 ${fmt(s.p95)}  max ${fmt(s.max)}`);
    console.log(`  share of wall clock    ${share.toFixed(2)}%`);
    console.log(`  vs one 50ms MC tick    ${((s.median / 50) * 100).toFixed(1)}%\n`);
}

const goalValue = payload(2 * 1024);
await measureTickPattern('TD-IO-001 heavy tick: 12 goal/job persists', 12, goalValue, path.join(dir, 'a.json'));
await measureTickPattern('TD-IO-001 typical tick: 1 persist', 1, goalValue, path.join(dir, 'b.json'));
await measureTickPattern('TD-MEM-001 recall() write, 256KB cap', 1, payload(256 * 1024), path.join(dir, 'c.json'));
await measureTickPattern('TD-MEM-001 recall() write, real 1.1KB store', 1, payload(1.1 * 1024), path.join(dir, 'd.json'));

rmSync(dir, { recursive: true, force: true });
console.log('Note: LandmarkMemory.save() early-returns unless `dirty`, so an');
console.log('unchanged store performs NO write on recall. The recall figures');
console.log('above are the worst case where prune/verify actually changed state.');
