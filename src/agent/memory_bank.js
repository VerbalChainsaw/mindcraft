import { PersonalMemory } from './runtime/personal-memory.js';

export class MemoryBank {
	constructor(agentName = '') {
		this.personal = new PersonalMemory(agentName);
		this.memory = {};
	}

	load() {
		this.personal.load();
		this.memory = Object.fromEntries(Object.entries(this.personal.export().places)
			.map(([name, place]) => [name, [place.x, place.y, place.z]]));
		return this.memory;
	}

	rememberPlace(name, x, y, z, dimension = '') {
		if (!this.personal.rememberPlace(name, { x, y, z }, dimension)) return false;
		this.memory[String(name || '').toLowerCase()] = [x, y, z];
		return true;
	}

	recallPlace(name) {
		const place = this.personal.recallPlace(name);
		return place ? [place.x, place.y, place.z] : null;
	}

	getJson() {
		return this.memory
	}

	loadJson(json) {
		if (!json || typeof json !== 'object' || Array.isArray(json)) return;
		this.memory = {};
		for (const [name, coordinates] of Object.entries(json)) {
			if (!Array.isArray(coordinates) || coordinates.length < 3) continue;
			this.rememberPlace(name, coordinates[0], coordinates[1], coordinates[2]);
		}
	}

	getKeys() {
		return Object.keys(this.memory).join(', ')
	}
}
