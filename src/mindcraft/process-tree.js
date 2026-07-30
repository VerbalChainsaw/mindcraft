import { execFile } from 'node:child_process';
import process from 'node:process';

function exited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (didExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off?.('exit', onExit);
      child.off?.('close', onExit);
      resolve(didExit);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(exited(child)), timeoutMs);
    child.once?.('exit', onExit);
    child.once?.('close', onExit);
  });
}

function taskkill(pid, execFileImpl) {
  return new Promise((resolve) => {
    execFileImpl(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 10_000 },
      (error) => resolve({ success: !error, error: error?.message || null }),
    );
  });
}

export async function terminateOwnedProcessTree(child, {
  platform = process.platform,
  execFileImpl = execFile,
  timeoutMs = 5_000,
} = {}) {
  const pid = Number(child?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || exited(child)) {
    return { success: true, pid: Number.isInteger(pid) ? pid : null, alreadyExited: true, forced: false };
  }

  let forced = false;
  let error = null;
  if (platform === 'win32') {
    forced = true;
    const result = await taskkill(pid, execFileImpl);
    error = result.error;
  } else {
    try {
      child.kill('SIGTERM');
    } catch (signalError) {
      error = signalError?.message || String(signalError);
    }
    if (!(await waitForExit(child, timeoutMs))) {
      forced = true;
      try {
        child.kill('SIGKILL');
      } catch (killError) {
        error = killError?.message || String(killError);
      }
    }
  }

  const didExit = await waitForExit(child, timeoutMs);
  return {
    success: didExit,
    pid,
    alreadyExited: false,
    forced,
    error: didExit ? null : (error || `Process tree ${pid} did not exit.`),
  };
}
