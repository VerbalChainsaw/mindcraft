import settings from '../settings.js';

// The browser viewer is strictly optional diagnostics.  Loading it lazily keeps
// a missing/failed Prismarine installation from affecting connection, world
// readiness, perception, or the behavior loop.
export async function addBrowserViewer(bot, count_id) {
    if (settings.render_bot_view !== true) return { enabled: false, started: false };
    try {
        const module = await import('prismarine-viewer');
        const mineflayerViewer = (module.default || module).mineflayer;
        if (typeof mineflayerViewer !== 'function') {
            throw new Error('prismarine-viewer did not expose mineflayer().');
        }
        mineflayerViewer(bot, { port: 3000 + count_id, firstPerson: true });
        return { enabled: true, started: true };
    } catch (error) {
        console.warn(`[viewer] Browser viewer unavailable: ${String(error?.message || error).slice(0, 320)}`);
        return { enabled: true, started: false, error: String(error?.message || error).slice(0, 320) };
    }
}
