function commandNames(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => typeof entry === 'string' && entry.startsWith('!'));
}

export function resolveBlockedActions({
    configured = [],
    task = [],
    allowInsecureCoding = false,
} = {}) {
    const operatorOnly = ['!restart'];
    if (allowInsecureCoding !== true) operatorOnly.push('!newAction');
    return [...new Set([
        ...commandNames(configured),
        ...commandNames(task),
        ...operatorOnly,
    ])];
}
