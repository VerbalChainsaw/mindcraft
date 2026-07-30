async function capture(component, action) {
  try {
    const value = await action();
    const success = value?.success !== false;
    return {
      component,
      success,
      value: value ?? null,
      error: success ? null : String(value?.error || `${component} did not stop cleanly.`),
    };
  } catch (error) {
    return {
      component,
      success: false,
      value: null,
      error: String(error?.message || error),
    };
  }
}

export async function stopMindcraftRuntime({
  stopDirector,
  stopTaskRunners,
  stopAgents,
  stopMinecraft,
  stopLocalServices,
}) {
  const components = [];
  components.push(await capture('director', stopDirector));
  components.push(await capture('task-runners', stopTaskRunners));
  components.push(await capture('agents', stopAgents));
  components.push(await capture('minecraft', stopMinecraft));
  components.push(await capture('local-services', stopLocalServices));

  const failures = components.filter(({ success }) => !success);
  const minecraft = components.find(({ component }) => component === 'minecraft')?.value || null;
  return {
    success: failures.length === 0,
    error: failures.length
      ? failures.map(({ component, error }) => `${component}: ${error}`).join('; ')
      : null,
    server: minecraft,
    components,
  };
}
