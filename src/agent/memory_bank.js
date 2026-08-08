import { PersonalMemory } from './runtime/personal-memory.js';

function normalizedPlaceName(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9 _-]/g, '')
		.trim();
}

function isInternalPlaceName(value) {
	const name = normalizedPlaceName(value);
	return name === 'last_death_position'
		|| name === 'exploration_route_start'
		|| name.startsWith('exploration_landmark_');
}

export class MemoryBank {
	constructor(agentName = '', personalOptions = {}) {
		this.personal = new PersonalMemory(agentName, personalOptions);
		this.memory = {};
	}

	_syncPlaces() {
		this.memory = Object.fromEntries(Object.entries(this.personal.export().places)
			.map(([name, place]) => [name, [place.x, place.y, place.z]]));
	}

	load() {
		this.personal.load();
		this._syncPlaces();
		return this.memory;
	}

	rememberPlace(name, x, y, z, dimension = '') {
		if (!this.personal.rememberPlace(name, { x, y, z }, dimension)) return false;
		this._syncPlaces();
		return true;
	}

	recallPlace(name) {
		const place = this.personal.recallPlace(name);
		return place ? [place.x, place.y, place.z] : null;
	}

	recallPlaceDetails(name) {
		return this.personal.recallPlace(name);
	}

	rememberUserPlace(name, x, y, z, dimension = '') {
		if (isInternalPlaceName(name)) return false;
		return this.rememberPlace(name, x, y, z, dimension);
	}

	recallUserPlaceDetails(name) {
		if (isInternalPlaceName(name)) return null;
		return this.recallPlaceDetails(name);
	}

	forgetUserPlace(name) {
		if (isInternalPlaceName(name) || !this.personal.forgetPlace(name)) return false;
		this._syncPlaces();
		return true;
	}

	getPlaceNames() {
		return Object.keys(this.personal.export().places)
			.filter(name => !isInternalPlaceName(name))
			.sort((left, right) => left.localeCompare(right));
	}

	rememberFact(name, value) {
		return this.personal.rememberFact(name, value);
	}

	rememberOutcome(method, outcome) {
		return this.personal.rememberOutcome(method, outcome);
	}

	outcomePreference(method) {
		return this.personal.outcomePreference(method);
	}

	recallFact(name) {
		const normalized = String(name || '').toLowerCase();
		return this.personal.export().facts?.[normalized]?.value || null;
	}

	rememberDeath(position, dimension, inventory = {}) {
		if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return false;
		const counts = Object.fromEntries(Object.entries(inventory)
			.filter(([name, count]) => name && Number.isFinite(count) && count > 0)
			.slice(0, 36)
			.map(([name, count]) => [String(name).slice(0, 80), Math.floor(count)]));
		const recordedAt = Date.now();
		if (!this.rememberPlace(
			'last_death_position',
			position.x,
			position.y,
			position.z,
			dimension,
		)) return false;
		return this.rememberFact('last_death_manifest', JSON.stringify({
			dimension: String(dimension || ''),
			inventory: counts,
			recordedAt,
			recoveredAt: null,
		}));
	}

	recallDeath() {
		const position = this.recallPlaceDetails('last_death_position');
		const manifest = this.recallFact('last_death_manifest');
		if (!position || !manifest) return null;
		try {
			const parsed = JSON.parse(manifest);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			return {
				position: { x: position.x, y: position.y, z: position.z },
				dimension: String(parsed.dimension || position.dimension || ''),
				inventory: parsed.inventory && typeof parsed.inventory === 'object'
					? { ...parsed.inventory }
					: {},
				recordedAt: Number(parsed.recordedAt) || position.updatedAt || null,
				recoveredAt: Number(parsed.recoveredAt) || null,
			};
		} catch {
			return null;
		}
	}

	markDeathRecovered(evidence = {}) {
		const death = this.recallDeath();
		if (!death || death.recoveredAt) return false;
		const recoveredAt = Date.now();
		const stored = this.rememberFact('last_death_manifest', JSON.stringify({
			dimension: death.dimension,
			inventory: death.inventory,
			recordedAt: death.recordedAt,
			recoveredAt,
		}));
		if (!stored) return false;
		return this.rememberFact('death_recovery_verified', JSON.stringify({
			recoveredAt,
			recovered: Math.max(0, Number(evidence.recovered) || 0),
		}));
	}

	getJson() {
		return this.memory;
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
		return this.getPlaceNames().join(', ');
	}
}
