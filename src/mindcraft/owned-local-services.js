import { spawn } from 'node:child_process';

import { discoverOllamaModels } from './local-service-discovery.js';
import { terminateOwnedProcessTree } from './process-tree.js';

export class OwnedLocalServices {
  constructor({
    spawnImpl = spawn,
    discoverOllama = discoverOllamaModels,
    terminateProcessTree = terminateOwnedProcessTree,
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.discoverOllama = discoverOllama;
    this.terminateProcessTree = terminateProcessTree;
    this.ollama = null;
  }

  async startOllama() {
    let models = await this.discoverOllama();
    if (models.length > 0) {
      return { models, owned: false, pid: null };
    }

    const child = this.spawnImpl('ollama', ['serve'], {
      detached: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    this.ollama = child;
    child.once?.('exit', () => {
      if (this.ollama === child) this.ollama = null;
    });
    try {
      await new Promise((resolve, reject) => {
        child.once?.('spawn', resolve);
        child.once?.('error', reject);
      });
    } catch (error) {
      if (this.ollama === child) this.ollama = null;
      throw error;
    }

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      models = await this.discoverOllama();
      if (models.length > 0) {
        return { models, owned: true, pid: child.pid || null };
      }
    }

    await this.stopAll();
    return { models: [], owned: false, pid: null };
  }

  async stopAll() {
    const child = this.ollama;
    if (!child) {
      return {
        success: true,
        ollama: { owned: false, stopped: true, pid: null, error: null },
      };
    }
    const result = await this.terminateProcessTree(child);
    if (this.ollama === child && result.success) this.ollama = null;
    return {
      success: result.success,
      ollama: {
        owned: true,
        stopped: result.success,
        pid: child.pid || null,
        error: result.error || null,
      },
    };
  }
}

export const ownedLocalServices = new OwnedLocalServices();
