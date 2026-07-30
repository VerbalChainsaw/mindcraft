import { Viewer } from 'prismarine-viewer/viewer/lib/viewer.js';
import { WorldView } from 'prismarine-viewer/viewer/lib/worldView.js';
import { getBufferFromStream } from 'prismarine-viewer/viewer/lib/simpleUtils.js';

import THREE from 'three';
import { createCanvas } from 'node-canvas-webgl/lib/index.js';
import fs from 'fs/promises';
import { createRequire } from 'module';
import { Vec3 } from 'vec3';
import { EventEmitter } from 'events';

import worker_threads from 'worker_threads';
global.Worker = worker_threads.Worker;

const require = createRequire(import.meta.url);
const viewerEntityModels = require('prismarine-viewer/viewer/lib/entity/entities.json');

function findMalformedViewerModels(models) {
    const malformed = new Set();
    for (const [entityName, entityModel] of Object.entries(models || {})) {
        for (const geometry of Object.values(entityModel?.geometry || {})) {
            const bones = new Set((geometry?.bones || []).map(bone => bone?.name));
            if ((geometry?.bones || []).some(bone => bone?.parent && !bones.has(bone.parent))) {
                malformed.add(entityName);
                break;
            }
        }
    }
    return malformed;
}

const malformedViewerModels = findMalformedViewerModels(viewerEntityModels);

export function adaptEntityForViewer(entity) {
    if (!entity?.name || !malformedViewerModels.has(entity.name)) return entity;
    // prismarine-viewer already renders unnamed/unknown entities as a simple
    // fallback mesh. Removing only the broken model name avoids its noisy
    // parent-bone exception while preserving position, size and lifecycle.
    return { ...entity, name: undefined };
}

function installViewerEntityCompatibility(viewer) {
    const updateEntity = viewer.updateEntity.bind(viewer);
    viewer.updateEntity = entity => updateEntity(adaptEntityForViewer(entity));
}


export class Camera extends EventEmitter {
    constructor (bot, fp, { retainScreenshots = 12 } = {}) {
        super();
        this.bot = bot;
        this.fp = fp;
        this.retainScreenshots = Number.isInteger(retainScreenshots)
            ? Math.max(0, retainScreenshots)
            : 12;
        this.viewDistance = 12;
        this.width = 800;
        this.height = 512;
        this.ready = false;
        this.initError = null;
        this.canvas = createCanvas(this.width, this.height);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas });
        this.viewer = new Viewer(this.renderer);
        installViewerEntityCompatibility(this.viewer);
        this.readyPromise = this._init()
            .then(() => {
                this.ready = true;
                this.emit('ready');
                return this;
            })
            .catch(error => {
                this.initError = error;
                this.emit('failed', error);
                throw error;
            });
        // The request path observes this promise. Keep a constructor-time
        // rejection from becoming an unhandled process failure meanwhile.
        this.readyPromise.catch(() => {});
    }
  
    async _init () {
        const botPos = this.bot.entity.position;
        const center = new Vec3(botPos.x, botPos.y+this.bot.entity.height, botPos.z);
        this.viewer.setVersion(this.bot.version);
        // Load world
        const worldView = new WorldView(this.bot.world, this.viewDistance, center);
        this.viewer.listen(worldView);
        worldView.listenToBot(this.bot);
        await worldView.init(center);
        this.worldView = worldView;
    }
  
    async waitUntilReady(timeoutMs = 8_000) {
        if (this.ready) return true;
        if (this.initError) throw this.initError;
        const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8_000;
        let timeoutId;
        try {
            await Promise.race([
                this.readyPromise,
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('Camera initialization timed out.')), boundedTimeout);
                }),
            ]);
        } finally {
            clearTimeout(timeoutId);
        }
        if (!this.ready) throw new Error('Camera is not ready.');
        return true;
    }

    async capture() {
        await this.waitUntilReady();
        const center = new Vec3(this.bot.entity.position.x, this.bot.entity.position.y+this.bot.entity.height, this.bot.entity.position.z);
        this.viewer.camera.position.set(center.x, center.y, center.z);
        await this.worldView.updatePosition(center);
        this.viewer.setFirstPersonCamera(this.bot.entity.position, this.bot.entity.yaw, this.bot.entity.pitch);
        this.viewer.update();
        this.renderer.render(this.viewer.scene, this.viewer.camera);

        const imageStream = this.canvas.createJPEGStream({
            bufsize: 4096,
            quality: 100,
            progressive: false
        });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}`;

        const buf = await getBufferFromStream(imageStream);
        await this._ensureScreenshotDirectory();
        await fs.writeFile(`${this.fp}/${filename}.jpg`, buf);
        await this._retainScreenshots();
        console.log('saved', filename);
        return filename;
    }

    async _ensureScreenshotDirectory() {
        await fs.mkdir(this.fp, { recursive: true });
    }

    async _retainScreenshots() {
        const maximum = Math.max(1, this.retainScreenshots);
        try {
            const entries = await fs.readdir(this.fp, { withFileTypes: true });
            const screenshots = entries
                .filter(entry => entry.isFile() && /^screenshot_.*\.jpg$/i.test(entry.name))
                .map(entry => entry.name)
                .sort();
            const expired = screenshots.slice(0, Math.max(0, screenshots.length - maximum));
            await Promise.all(expired.map(async filename => {
                try {
                    await fs.unlink(`${this.fp}/${filename}`);
                } catch (error) {
                    if (error?.code !== 'ENOENT') {
                        console.warn(`Could not remove expired screenshot ${filename}: ${error.message}`);
                    }
                }
            }));
        } catch (error) {
            console.warn(`Could not apply screenshot retention: ${error.message}`);
        }
    }
}
  
