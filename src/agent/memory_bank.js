import { PersonalMemory } from './runtime/personal-memory.js';

export function hasPendingDeathRecovery(memoryBank, { after = null } = {}) {
	const boundary = Number(after);
	const death = Number.isFinite(boundary)
		? memoryBank?.recallLatestDeath?.() || memoryBank?.recallDeath?.() || null
		: memoryBank?.recallDeath?.() || null;
	return Boolean(
		death
		&& !death.recoveredAt
		&& Object.values(death.inventory || {}).some(count => Number(count) > 0)
		&& (
			!Number.isFinite(boundary)
			|| !Number.isFinite(Number(death.recordedAt))
			|| Number(death.recordedAt) > boundary
		)
	);
}

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

	_recallLegacyDeath() {
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

	_rememberLegacyDeathProjection(death) {
		if (!death) return false;
		if (!this.rememberPlace(
			'last_death_position',
			death.position.x,
			death.position.y,
			death.position.z,
			death.dimension,
		)) return false;
		return this.rememberFact('last_death_manifest', JSON.stringify({
			dimension: death.dimension,
			inventory: death.inventory,
			recordedAt: death.recordedAt,
			recoveredAt: death.recoveredAt,
		}));
	}

	recordDeath(position, dimension, inventory = {}) {
		if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
			return Object.freeze({
				stored: false,
				code: 'death_position_invalid',
				record: null,
			});
		}
		const counts = Object.fromEntries(Object.entries(inventory)
			.filter(([name, count]) => name && Number.isFinite(count) && count > 0)
			.slice(0, 36)
			.map(([name, count]) => [String(name).slice(0, 80), Math.floor(count)]));
		const ledger = this.personal.recallDeathRecoveryLedger();
		const legacy = ledger.initialized ? null : this._recallLegacyDeath();
		const legacyPending = legacy
			&& !legacy.recoveredAt
			&& Object.values(legacy.inventory || {}).some(count => Number(count) > 0)
			? legacy
			: null;
		const pending = ledger.initialized
			? ledger.pending
			: (legacyPending ? [legacyPending] : []);
		if (Object.keys(counts).length === 0) {
			const stored = ledger.initialized || pending.length === 0
				? true
				: this.personal.replaceDeathRecoveryLedger({
					initialized: true,
					pending,
					lastSettled: ledger.lastSettled,
					lastDisplaced: ledger.lastDisplaced,
				});
			return Object.freeze({
				stored,
				code: stored ? 'death_empty_no_record' : 'death_recovery_persistence_rejected',
				record: null,
				pending: pending.length,
			});
		}
		const latestRecordedAt = pending.reduce(
			(latest, entry) => Math.max(latest, Number(entry?.recordedAt) || 0),
			0,
		);
		const recordedAt = Math.max(Date.now(), latestRecordedAt + 1);
		const death = {
			position: { x: position.x, y: position.y, z: position.z },
			dimension: String(dimension || ''),
			inventory: counts,
			recordedAt,
			recoveredAt: null,
		};
		let persistedPending = [...pending, death];
		let displaced = null;
		let stored = this.personal.replaceDeathRecoveryLedger({
			initialized: true,
			pending: persistedPending,
			lastSettled: ledger.lastSettled,
			lastDisplaced: ledger.lastDisplaced,
		});
		if (!stored && pending.length > 0) {
			displaced = {
				...pending[0],
				displacedAt: Date.now(),
				displacementCode: 'death_recovery_capacity_displaced',
			};
			persistedPending = [...pending.slice(1), death];
			stored = this.personal.replaceDeathRecoveryLedger({
				initialized: true,
				pending: persistedPending,
				lastSettled: ledger.lastSettled,
				lastDisplaced: displaced,
			});
		}
		if (!stored) {
			return Object.freeze({
				stored: false,
				code: 'death_recovery_persistence_rejected',
				record: null,
				pending: pending.length,
			});
		}
		this._rememberLegacyDeathProjection(persistedPending[0] || death);
		return Object.freeze({
			stored: true,
			code: displaced
				? 'death_recorded_after_capacity_displacement'
				: 'death_recorded',
			record: this.recallDeath(recordedAt),
			pending: persistedPending.length,
			...(displaced ? {
				displacedRecordedAt: displaced.recordedAt,
				displacementCode: displaced.displacementCode,
			} : {}),
		});
	}

	rememberDeath(position, dimension, inventory = {}) {
		return this.recordDeath(position, dimension, inventory).stored;
	}

	recallDeath(recordedAt = null) {
		const ledger = this.personal.recallDeathRecoveryLedger();
		const identity = Number(recordedAt);
		if (!ledger.initialized) {
			const legacy = this._recallLegacyDeath();
			if (recordedAt == null) return legacy;
			return legacy && Number(legacy.recordedAt) === identity ? legacy : null;
		}
		const death = recordedAt == null
			? ledger.pending[0] || ledger.lastSettled
			: ledger.pending.find(entry => Number(entry.recordedAt) === identity);
		if (!death) return null;
		return {
			position: { ...death.position },
			dimension: death.dimension,
			inventory: { ...death.inventory },
			recoveredInventory: { ...(death.recoveredInventory || {}) },
			recordedAt: death.recordedAt,
			recoveredAt: death.recoveredAt,
		};
	}

	recallLatestDeath() {
		const ledger = this.personal.recallDeathRecoveryLedger();
		if (!ledger.initialized) return this._recallLegacyDeath();
		const death = ledger.pending.at(-1) || ledger.lastSettled;
		if (!death) return null;
		return {
			position: { ...death.position },
			dimension: death.dimension,
			inventory: { ...death.inventory },
			recoveredInventory: { ...(death.recoveredInventory || {}) },
			recordedAt: death.recordedAt,
			recoveredAt: death.recoveredAt,
		};
	}

	observeDeathRecoveryInventory(inventory = {}, {
		recordedAt = null,
		dimension = '',
		observedAt = Date.now(),
		source = 'alive_inventory_observation',
	} = {}) {
		const ledger = this.personal.recallDeathRecoveryLedger();
		const identity = Number(recordedAt);
		if (!ledger.initialized || !Number.isSafeInteger(identity) || identity <= 0) {
			return Object.freeze({ stored: false, complete: false, code: 'death_identity_missing' });
		}
		const pendingIndex = ledger.pending.findIndex(entry => Number(entry.recordedAt) === identity);
		const death = ledger.pending[pendingIndex];
		if (!death) {
			return Object.freeze({ stored: false, complete: false, code: 'death_not_pending' });
		}
		if (dimension && death.dimension && String(dimension) !== String(death.dimension)) {
			return Object.freeze({ stored: false, complete: false, code: 'death_dimension_mismatch' });
		}
		const observationTime = Number(observedAt);
		if (!Number.isFinite(observationTime) || observationTime < Number(death.recordedAt)) {
			return Object.freeze({ stored: false, complete: false, code: 'death_observation_stale' });
		}

		const recoveredInventory = {};
		let recovered = 0;
		let expected = 0;
		let progressed = false;
		for (const [name, expectedCountRaw] of Object.entries(death.inventory || {})) {
			const expectedCount = Math.max(0, Math.floor(Number(expectedCountRaw) || 0));
			const priorCount = Math.max(0, Math.min(
				expectedCount,
				Math.floor(Number(death.recoveredInventory?.[name]) || 0),
			));
			const observedCount = Math.max(0, Math.min(
				expectedCount,
				Math.floor(Number(inventory?.[name]) || 0),
			));
			const recoveredCount = Math.max(priorCount, observedCount);
			if (recoveredCount > 0) recoveredInventory[name] = recoveredCount;
			if (recoveredCount > priorCount) progressed = true;
			recovered += recoveredCount;
			expected += expectedCount;
		}
		const complete = expected > 0 && recovered >= expected;
		if (!progressed && !complete) {
			return Object.freeze({
				stored: true,
				complete: false,
				code: 'death_recovery_unchanged',
				recovered,
				expected,
			});
		}

		const recoverySource = String(source || 'alive_inventory_observation').slice(0, 80);
		const observedDeath = {
			...death,
			recoveredInventory,
			recoveryObservedAt: observationTime,
			recoverySource,
		};
		const pending = complete
			? ledger.pending.filter((entry, index) => index !== pendingIndex)
			: ledger.pending.map((entry, index) => index === pendingIndex ? observedDeath : entry);
		const settled = complete
			? {
				...observedDeath,
				recoveredAt: observationTime,
				recovered,
			}
			: ledger.lastSettled;
		const stored = this.personal.replaceDeathRecoveryLedger({
			initialized: true,
			pending,
			lastSettled: settled,
			lastDisplaced: ledger.lastDisplaced,
		});
		if (!stored) {
			return Object.freeze({
				stored: false,
				complete: false,
				code: 'death_recovery_persistence_rejected',
				recovered,
				expected,
			});
		}
		if (complete) {
			this._rememberLegacyDeathProjection(pending[0] || settled);
			this.rememberFact('death_recovery_verified', JSON.stringify({
				recoveredAt: observationTime,
				recovered,
				source: recoverySource,
			}));
		}
		return Object.freeze({
			stored: true,
			complete,
			code: complete ? 'death_recovery_observed_complete' : 'death_recovery_progress_observed',
			recovered,
			expected,
			recordedAt: identity,
		});
	}

	markDeathRecovered(evidence = {}, recordedAt = null) {
		const ledger = this.personal.recallDeathRecoveryLedger();
		const legacy = ledger.initialized ? null : this._recallLegacyDeath();
		const identity = Number(recordedAt);
		const pendingIndex = ledger.initialized
			? (recordedAt == null
				? 0
				: ledger.pending.findIndex(entry => Number(entry.recordedAt) === identity))
			: -1;
		const death = ledger.initialized
			? ledger.pending[pendingIndex]
			: (recordedAt == null || Number(legacy?.recordedAt) === identity ? legacy : null);
		if (!death || death.recoveredAt) return false;
		const recoveredAt = Date.now();
		const settled = {
			...death,
			recoveredAt,
			recovered: Math.max(0, Number(evidence.recovered) || 0),
		};
		const remaining = ledger.initialized
			? ledger.pending.filter((entry, index) => index !== pendingIndex)
			: [];
		const stored = this.personal.replaceDeathRecoveryLedger({
			initialized: true,
			pending: remaining,
			lastSettled: settled,
			lastDisplaced: ledger.lastDisplaced,
		});
		if (!stored) return false;
		this._rememberLegacyDeathProjection(remaining[0] || settled);
		this.rememberFact('death_recovery_verified', JSON.stringify({
			recoveredAt,
			recovered: Math.max(0, Number(evidence.recovered) || 0),
		}));
		return true;
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
