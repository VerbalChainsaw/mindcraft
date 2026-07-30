import { execFile } from 'node:child_process';
import process from 'node:process';

const STATUS_CACHE_MS = 10_000;
const COMMAND_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;
const RELEASE_PACKAGE_NAME = 'Microsoft.MinecraftUWP';
const PREVIEW_PACKAGE_NAME = 'Microsoft.MinecraftWindowsBeta';
const ALLOWED_PACKAGE_NAMES = new Set([RELEASE_PACKAGE_NAME, PREVIEW_PACKAGE_NAME]);
const ALLOWED_PACKAGE_FAMILIES = new Set([
  'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe',
]);

const APPX_QUERY = [
  "$names=@('Microsoft.MinecraftUWP','Microsoft.MinecraftWindowsBeta');",
  'Get-AppxPackage',
  '| Where-Object { $names -contains $_.Name }',
  '| Select-Object Name,PackageFamilyName,Version',
  '| ConvertTo-Json -Compress',
].join(' ');

function emptyStatus({ supported = true, error = null } = {}) {
  return {
    supported,
    installed: false,
    loopbackEnabled: false,
    actionRequired: null,
    packageName: null,
    packageFamilyName: null,
    version: null,
    error,
  };
}

function defaultRunCommand(file, args, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: 'utf8',
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parsePackages(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries
    .filter((entry) => (
      entry
      && ALLOWED_PACKAGE_NAMES.has(entry.Name)
      && ALLOWED_PACKAGE_FAMILIES.has(entry.PackageFamilyName)
    ))
    .map((entry) => ({
      name: entry.Name,
      familyName: entry.PackageFamilyName,
      version: String(entry.Version || ''),
    }))
    .sort((first, second) => {
      if (first.name === RELEASE_PACKAGE_NAME) return -1;
      if (second.name === RELEASE_PACKAGE_NAME) return 1;
      return first.name.localeCompare(second.name);
    });
}

function elevatedLoopbackScript(packageFamilyName, enabled) {
  if (!ALLOWED_PACKAGE_FAMILIES.has(packageFamilyName)) {
    throw new Error('Unsupported Minecraft package identity.');
  }
  const operation = enabled ? '-a' : '-d';
  return [
    '$exe=Join-Path $env:SystemRoot "System32\\CheckNetIsolation.exe"',
    `$args=@('LoopbackExempt','${operation}','-n=${packageFamilyName}')`,
    '$result=Start-Process -FilePath $exe -ArgumentList $args -Verb RunAs -WindowStyle Hidden -Wait -PassThru',
    'if($null -eq $result){exit 1}',
    'exit $result.ExitCode',
  ].join(';');
}

export function createBedrockClientController({
  platform = process.platform,
  runCommand = defaultRunCommand,
  now = () => Date.now(),
  cacheMs = STATUS_CACHE_MS,
} = {}) {
  let cachedStatus = null;
  let cachedAt = 0;
  let pendingInspection = null;

  async function inspect() {
    if (platform !== 'win32') return emptyStatus({ supported: false });
    try {
      const [packageResult, exemptionsResult] = await Promise.all([
        runCommand('powershell.exe', [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          APPX_QUERY,
        ], { timeoutMs: COMMAND_TIMEOUT_MS }),
        runCommand('CheckNetIsolation.exe', ['LoopbackExempt', '-s'], {
          timeoutMs: COMMAND_TIMEOUT_MS,
        }),
      ]);
      const selected = parsePackages(packageResult.stdout)[0];
      if (!selected) return emptyStatus();
      const exemptions = String(exemptionsResult.stdout || '').toLowerCase();
      const loopbackEnabled = exemptions.includes(selected.familyName.toLowerCase());
      return {
        supported: true,
        installed: true,
        loopbackEnabled,
        actionRequired: loopbackEnabled ? null : 'enable-loopback',
        packageName: selected.name,
        packageFamilyName: selected.familyName,
        version: selected.version || null,
        error: null,
      };
    } catch {
      return emptyStatus({
        error: 'Mindcraft could not inspect the installed Minecraft for Windows client.',
      });
    }
  }

  function getStatus({ refresh = false } = {}) {
    const fresh = cachedStatus && now() - cachedAt < cacheMs;
    if (!refresh && fresh) return Promise.resolve({ ...cachedStatus });
    if (!refresh && pendingInspection) return pendingInspection;
    pendingInspection = inspect().then((status) => {
      cachedStatus = status;
      cachedAt = now();
      return { ...status };
    }).finally(() => {
      pendingInspection = null;
    });
    return pendingInspection;
  }

  async function setLoopbackEnabled(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('Loopback enabled must be true or false.');
    }
    const current = await getStatus({ refresh: true });
    if (!current.supported) {
      return { success: false, error: 'Windows Bedrock loopback controls are unavailable on this system.', status: current };
    }
    if (!current.installed || !current.packageFamilyName) {
      return { success: false, error: 'Minecraft for Windows is not installed for this user.', status: current };
    }
    if (current.loopbackEnabled === enabled) {
      return { success: true, status: current };
    }
    try {
      await runCommand('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        elevatedLoopbackScript(current.packageFamilyName, enabled),
      ], { timeoutMs: ACTION_TIMEOUT_MS });
    } catch {
      return {
        success: false,
        error: 'Mindcraft could not change the Windows loopback exemption. Approve the administrator prompt and try again.',
        status: current,
      };
    }
    const status = await getStatus({ refresh: true });
    if (status.loopbackEnabled !== enabled) {
      return {
        success: false,
        error: 'Windows did not apply the requested Minecraft loopback setting.',
        status,
      };
    }
    return { success: true, status };
  }

  return {
    getStatus,
    setLoopbackEnabled,
  };
}
