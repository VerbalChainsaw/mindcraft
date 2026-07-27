function sanitizeProviderRoles(providerRoles) {
  if (!Array.isArray(providerRoles)) return [];
  return providerRoles.map(({ role, provider }) => ({
    role: typeof role === 'string' ? role : 'unknown',
    provider: typeof provider === 'string' ? provider : null,
  }));
}

function sanitizeSelectedProfiles(selectedProfiles) {
  if (!Array.isArray(selectedProfiles)) return [];
  return selectedProfiles.map((profile) => ({
    name: typeof profile?.name === 'string' ? profile.name : 'unnamed-profile',
    state: profile?.state === 'ready' ? 'ready' : 'blocked',
    providerRoles: sanitizeProviderRoles(profile?.providerRoles),
    reason: typeof profile?.reason === 'string' ? profile.reason : null,
  }));
}

const credentialFreeProviders = new Set(['lmstudio', 'ollama', 'vllm']);

function selectedProfilesNeedCredentials(selectedProfiles) {
  return selectedProfiles.some(({ providerRoles }) => providerRoles.some(
    ({ provider }) => provider !== null && !credentialFreeProviders.has(provider),
  ));
}

export function buildHealthStatus({
  anyApiKey,
  keysFileExists,
  minecraftReachable,
  minecraftTarget,
  agents,
  selectedProfiles,
}) {
  const agentList = Array.isArray(agents) ? agents : [];
  const sanitizedProfiles = sanitizeSelectedProfiles(selectedProfiles);
  const selectedProfilesReady = sanitizedProfiles.length > 0
    && sanitizedProfiles.every(({ state }) => state === 'ready');
  const problems = [];

  if (!anyApiKey && (sanitizedProfiles.length === 0 || selectedProfilesNeedCredentials(sanitizedProfiles))) {
    problems.push('No API key configured — add one in the Setup Wizard (API Keys card).');
  }
  if (!minecraftReachable) problems.push(`Minecraft server unreachable at ${minecraftTarget} — open a world to LAN on that port, or change it in Setup.`);
  if (agentList.length === 0) problems.push('No agents registered — start one from the dashboard or enable auto_start.');
  else if (!agentList.some(({ in_game }) => in_game)) problems.push('Agent(s) registered but none are in-game yet.');
  for (const profile of sanitizedProfiles) {
    if (profile.state === 'blocked') {
      problems.push(`Selected profile "${profile.name}" is blocked: ${profile.reason || 'Provider readiness check failed.'}`);
    }
  }

  return {
    success: true,
    ok: problems.length === 0,
    checks: {
      anyApiKey: Boolean(anyApiKey),
      keysFileExists: Boolean(keysFileExists),
      minecraftReachable: Boolean(minecraftReachable),
      minecraftTarget,
      agentsRegistered: agentList.length,
      agentsInGame: agentList.filter(({ in_game }) => in_game).length,
      selectedProfilesReady,
      selectedProfiles: sanitizedProfiles,
    },
    problems,
  };
}
