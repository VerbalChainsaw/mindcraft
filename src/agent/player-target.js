function identity(value) {
    return typeof value === 'string' ? value : '';
}

function comparisonKeys(value) {
    const name = identity(value);
    if (!name) return [];
    const keys = [name.toLowerCase()];
    if (name.startsWith('.') && name.length > 1) keys.push(name.slice(1).toLowerCase());
    return keys;
}

function identitiesOverlap(left, right) {
    const rightKeys = new Set(comparisonKeys(right));
    return comparisonKeys(left).some(key => rightKeys.has(key));
}

function unresolved(requested, aliasesTried, { ambiguous = false } = {}) {
    return {
        requested,
        canonical: null,
        entity: null,
        matchedBy: null,
        ambiguous,
        aliasesTried,
    };
}

export function resolvePlayerTarget(bot, requestedName, {
    knownBotNames = [],
    isBotIdentity = () => false,
} = {}) {
    const requested = identity(requestedName);
    const aliasesTried = [...new Set([
        requested,
        ...(!requested.startsWith('.') && requested ? [`.${requested}`] : []),
    ])].slice(0, 2);
    if (!bot || !requested) return unresolved(requested, aliasesTried);

    const records = [];
    const recordsByEntity = new Map();
    const indexedEntities = new Set();
    const addRecord = (canonicalValue, entity, aliases = []) => {
        const canonical = identity(canonicalValue);
        if (!canonical || entity?.type !== 'player') return;
        let record = recordsByEntity.get(entity);
        if (!record) {
            record = { canonical, entity, aliases: new Set() };
            recordsByEntity.set(entity, record);
            records.push(record);
        }
        for (const alias of [canonical, ...aliases]) {
            const name = identity(alias);
            if (name) record.aliases.add(name);
        }
    };

    for (const [playerKey, player] of Object.entries(bot.players || {})) {
        const entity = player?.entity;
        if (entity?.type !== 'player') continue;
        indexedEntities.add(entity);
        addRecord(entity.username || player?.username || playerKey, entity, [
            playerKey,
            player?.username,
            entity.username,
        ]);
    }
    for (const entity of Object.values(bot.entities || {})) {
        if (entity?.type !== 'player' || indexedEntities.has(entity)) continue;
        addRecord(entity.username, entity, [entity.username]);
    }

    const botNames = [bot.username, ...knownBotNames].map(identity).filter(Boolean);
    const eligible = records.filter(record => {
        const names = [record.canonical, ...record.aliases];
        if (names.some(name => botNames.some(botName => identitiesOverlap(name, botName)))) return false;
        return !names.some(name => isBotIdentity(name));
    });

    const choose = (recordsForMatch, matchedBy) => {
        const unique = [...new Set(recordsForMatch)];
        if (unique.length === 1) {
            const [record] = unique;
            return {
                requested,
                canonical: record.canonical,
                entity: record.entity,
                matchedBy,
                ambiguous: false,
                aliasesTried,
            };
        }
        if (unique.length > 1) return unresolved(requested, aliasesTried, { ambiguous: true });
        return null;
    };

    const exact = choose(
        eligible.filter(record => [...record.aliases].some(alias => alias === requested)),
        'exact',
    );
    if (exact) return exact;

    const requestedKey = requested.toLowerCase();
    const fallbackRecords = eligible.filter(record => [...record.aliases].some(alias => {
        const aliasKey = alias.toLowerCase();
        return aliasKey === requestedKey
            || (!requested.startsWith('.') && alias.startsWith('.') && aliasKey.slice(1) === requestedKey);
    }));
    const fallback = choose(fallbackRecords, 'case_insensitive');
    if (!fallback?.canonical) return fallback || unresolved(requested, aliasesTried);
    const selected = fallbackRecords.find(record => record.canonical === fallback.canonical);
    if (!requested.startsWith('.') && [...selected.aliases].some(alias => alias === `.${requested}`)) {
        fallback.matchedBy = 'floodgate_prefix';
    }
    return fallback;
}

export function collectorMatchesPlayerTarget(resolution, collector, {
    expectedEntityId = null,
    collected = null,
} = {}) {
    return Boolean(
        resolution?.canonical
        && collector?.username
        && collector.username === resolution.canonical
        && (!Number.isFinite(expectedEntityId) || collected?.id === expectedEntityId)
    );
}
