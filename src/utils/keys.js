import { readFileSync, statSync } from 'fs';
import { join } from 'path';

// Resolve keys.json relative to the process working directory (repo root).
// The launcher (.bat) and the /api/keys endpoint both write keys.json at cwd,
// so reading from cwd keeps hasKey() and the wizard in sync. (Outside review CRIT-2.)
const KEYS_PATH = join(process.cwd(), 'keys.json');

// Keys are hot-reloaded: we cache keys.json content but re-check the file's
// mtime on every access, so keys saved via the setup wizard (/api/keys)
// become visible immediately — no restart required. (Outside review CRIT-2.)
let keys = {};
let loadedMtimeMs = -1;

function refresh() {
    let mtimeMs = null;
    try {
        mtimeMs = statSync(KEYS_PATH).mtimeMs;
    } catch {
        // keys.json absent — env vars only
        if (loadedMtimeMs !== null) {
            keys = {};
            loadedMtimeMs = null;
        }
        return;
    }
    if (mtimeMs === loadedMtimeMs) return; // unchanged
    try {
        keys = JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
        loadedMtimeMs = mtimeMs;
    } catch (err) {
        // Unreadable/corrupt: keep previous cache, warn once per change
        console.warn('keys.json unreadable or invalid JSON; using previous keys/env.', String(err.message || err));
        loadedMtimeMs = mtimeMs;
    }
}

refresh();
if (loadedMtimeMs === null) {
    console.warn('keys.json not found. Defaulting to environment variables.'); // still works with local models
}

export function getKey(name) {
    refresh();
    let key = keys[name];
    if (!key) {
        key = process.env[name];
    }
    if (!key) {
        throw new Error(`API key "${name}" not found in keys.json or environment variables!`);
    }
    return key;
}

export function hasKey(name) {
    refresh();
    return Boolean(keys[name] || process.env[name]);
}
