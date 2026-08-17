function commandNames(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => typeof entry === 'string' && entry.startsWith('!'));
}

export function resolveBlockedActions({
    configured = [],
    task = [],
    allowInsecureCoding = false,
    allowed = [],
    registered = [],
} = {}) {
    const operatorOnly = ['!restart'];
    if (allowInsecureCoding !== true) operatorOnly.push('!newAction');
    // An allowlist blocks everything it does not name. Expressing a small
    // command surface as ~130 blocked names is unreadable and silently wrong the
    // moment a command is added -- the new one defaults to allowed, which is the
    // opposite of what a restricted surface means. Naming what is permitted
    // fails closed instead.
    //
    // This exists because ARCHITECTURE.md's design is ~10 primitives while 152
    // commands are registered. Steps 4 and 6 need to run the bot on a reduced
    // surface to find out whether the LLM can orchestrate primitives or is only
    // routing to pre-written procedures. An empty allowlist means no restriction.
    const allowedNames = new Set(commandNames(allowed));
    const disallowed = allowedNames.size === 0
        ? []
        : commandNames(registered).filter((name) => !allowedNames.has(name));
    return [...new Set([
        ...commandNames(configured),
        ...commandNames(task),
        ...disallowed,
        ...operatorOnly,
    ])];
}
