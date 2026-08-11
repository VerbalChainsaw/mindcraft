// Read-only sweep for the defect class this codebase keeps producing:
// something fails or loses data, and nothing says so.
//
//   node tools/sweep-silent-failures.mjs
//
// Written 2026-08-11 after a manual pass found three real defects that had all
// shipped and none of which raised anything: rule removal silently matching
// nothing, history summaries silently overwriting each other, and three
// provider adapters silently never failing over.
//
// Buckets are ordered by how often they have actually paid out. The last two
// were swept once and came back clean; they are kept because a regression in
// them would be invisible, not because they are currently interesting.
//
// MEASUREMENT WARNING, learned the hard way: a naive per-line control-byte
// count reported 543 hits, of which 185 were carriage returns from CRLF line
// endings and the rest was double counting. The true figure was six bytes in
// two files. Tab, LF and CR are excluded below. Do not remove that filter.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SKIP = new Set([
    'node_modules', '.git', 'server_data', 'bots', 'tmp', 'docs', 'patches', 'packages',
]);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry) || entry.startsWith('node_modules')) continue;
        const full = path.join(dir, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full, out);
        else if (/\.(js|mjs)$/.test(entry)) out.push(full);
    }
    return out;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const files = walk(ROOT);
const findings = new Map();
const add = (bucket, item) => {
    if (!findings.has(bucket)) findings.set(bucket, []);
    findings.get(bucket).push(item);
};

const QUOTE = String.fromCharCode(34, 39);
const sentinelRe = new RegExp(`[${QUOTE}][^${QUOTE}]*brain disconnected[^${QUOTE}]*[${QUOTE}]`, 'i');

for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const isModel = rel(file).startsWith('src/models/');

    lines.forEach((line, index) => {
        const at = `${rel(file)}:${index + 1}`;

        // MALFORMATION: a control-character class written as literal bytes.
        // One such line was silently corrupted into [space-hyphen] by a copy
        // that lost the bytes, which broke rule removal entirely.
        const raw = [...line].filter((c) => {
            const n = c.codePointAt(0);
            return (n < 32 && n !== 9 && n !== 13) || n === 127;
        });
        if (raw.length) add('raw-control-bytes-in-source', `${at}  ${raw.length} byte(s)`);

        // SILENT LOSS: a provider failure string written by hand instead of
        // going through the shared helper, which silently opts that adapter
        // out of router failover.
        if (isModel
            && !rel(file).endsWith('provider-failure.js')
            && sentinelRe.test(line)
            && !/^\s*(\/\/|\*)/.test(line)) {
            add('hardcoded-provider-failure-text', `${at}  ${line.trim().slice(0, 90)}`);
        }

        // SILENT LOSS: a failure path returning prose the router cannot
        // recognise. 'Vision is only supported...' is legitimately a
        // capability answer, not a transport failure, and is excluded.
        if (isModel) {
            const m = line.match(/^\s*(?:res|result|output|response|finalRes|completionContent)\s*=\s*["']([^"']{12,})["']/);
            if (m && !/brain disconnected|vision is only supported/i.test(m[1])) {
                add('possible-unrecognised-failure-prose', `${at}  ${JSON.stringify(m[1]).slice(0, 80)}`);
            }
        }
    });
}

// Buckets swept clean on 2026-08-11 and kept only as regression detectors.
const CLEAN_WHEN_EMPTY = new Set([
    'raw-control-bytes-in-source',
    'hardcoded-provider-failure-text',
]);

let exitCode = 0;
console.log(`scanned ${files.length} source files under ${rel(ROOT) || '.'}\n`);
for (const bucket of [
    'raw-control-bytes-in-source',
    'hardcoded-provider-failure-text',
    'possible-unrecognised-failure-prose',
]) {
    const hits = findings.get(bucket) || [];
    console.log(`## ${bucket} -- ${hits.length}`);
    for (const hit of hits.slice(0, 20)) console.log(`   ${hit}`);
    if (hits.length > 20) console.log(`   ... and ${hits.length - 20} more`);
    if (hits.length && CLEAN_WHEN_EMPTY.has(bucket)) exitCode = 1;
    console.log('');
}

console.log(
    exitCode === 0
        ? 'No regressions in the buckets that are meant to stay empty.'
        : 'REGRESSION: a bucket that was swept clean has new entries.',
);
process.exit(exitCode);
