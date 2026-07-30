import assert from 'node:assert/strict';
import test from 'node:test';

const bedrockModule = await import('../../src/mindcraft/bedrock-client.js')
  .catch((loadError) => ({ loadError }));

function controllerFactory() {
  assert.ifError(bedrockModule.loadError);
  assert.equal(typeof bedrockModule.createBedrockClientController, 'function');
  return bedrockModule.createBedrockClientController;
}

const releasePackage = {
  Name: 'Microsoft.MinecraftUWP',
  PackageFamilyName: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  Version: '1.26.3301.0',
};

test('Given Minecraft for Windows without a loopback exemption, when inspected, then the exact client blocker is reported', async () => {
  const createController = controllerFactory();
  const calls = [];
  const controller = createController({
    platform: 'win32',
    runCommand: (file, args) => {
      calls.push({ file, args });
      if (file === 'powershell.exe') return { stdout: JSON.stringify(releasePackage), stderr: '' };
      return {
        stdout: 'List Loopback Exempted AppContainers\nName: microsoft.edgedevtoolsplugin_cw5n1h2txyewy\nOK.',
        stderr: '',
      };
    },
  });

  const status = await controller.getStatus({ refresh: true });

  assert.equal(status.supported, true);
  assert.equal(status.installed, true);
  assert.equal(status.loopbackEnabled, false);
  assert.equal(status.packageFamilyName, releasePackage.PackageFamilyName);
  assert.equal(status.version, releasePackage.Version);
  assert.equal(status.actionRequired, 'enable-loopback');
  assert.deepEqual(calls.map(({ file }) => file), ['powershell.exe', 'CheckNetIsolation.exe']);
  assert.match(
    String(calls[0].args.at(-1)),
    /Get-AppxPackage\s*\|\s*Where-Object[\s\S]*\|\s*Select-Object[\s\S]*\|\s*ConvertTo-Json/,
  );
});

test('Given the installed fixed Minecraft package, when loopback is enabled, then elevation targets only that package and the result is rechecked', async () => {
  const createController = controllerFactory();
  const calls = [];
  let exempt = false;
  const controller = createController({
    platform: 'win32',
    runCommand: (file, args) => {
      calls.push({ file, args: [...args] });
      const command = String(args.at(-1) || '');
      if (file === 'powershell.exe' && command.includes('Get-AppxPackage')) {
        return { stdout: JSON.stringify(releasePackage), stderr: '' };
      }
      if (file === 'powershell.exe' && command.includes('Start-Process')) {
        exempt = true;
        return { stdout: '0', stderr: '' };
      }
      return {
        stdout: exempt
          ? `Name: ${releasePackage.PackageFamilyName}\nOK.`
          : 'List Loopback Exempted AppContainers\nOK.',
        stderr: '',
      };
    },
  });

  const result = await controller.setLoopbackEnabled(true);

  assert.equal(result.success, true);
  assert.equal(result.status.loopbackEnabled, true);
  const elevation = calls.find(({ file, args }) => (
    file === 'powershell.exe' && String(args.at(-1)).includes('Start-Process')
  ));
  assert.ok(elevation);
  assert.match(String(elevation.args.at(-1)), /Microsoft\.MinecraftUWP_8wekyb3d8bbwe/);
  assert.match(String(elevation.args.at(-1)), /LoopbackExempt/);
  assert.match(String(elevation.args.at(-1)), /-a/);
});

test('Given a non-Windows host, when Bedrock client state is inspected, then it degrades without executing host commands', async () => {
  const createController = controllerFactory();
  let calls = 0;
  const controller = createController({
    platform: 'linux',
    runCommand: () => {
      calls += 1;
      return { stdout: '', stderr: '' };
    },
  });

  const status = await controller.getStatus({ refresh: true });

  assert.deepEqual(status, {
    supported: false,
    installed: false,
    loopbackEnabled: false,
    actionRequired: null,
    packageName: null,
    packageFamilyName: null,
    version: null,
    error: null,
  });
  assert.equal(calls, 0);
});

test('Given malformed action input or a failed elevation, when loopback is changed, then the error is bounded and no false success is returned', async () => {
  const createController = controllerFactory();
  const controller = createController({
    platform: 'win32',
    runCommand: (file, args) => {
      const command = String(args.at(-1) || '');
      if (file === 'powershell.exe' && command.includes('Get-AppxPackage')) {
        return { stdout: JSON.stringify(releasePackage), stderr: '' };
      }
      if (file === 'powershell.exe' && command.includes('Start-Process')) {
        throw new Error('The operation was canceled by the user. secret-detail');
      }
      return { stdout: 'OK.', stderr: '' };
    },
  });

  await assert.rejects(
    () => controller.setLoopbackEnabled('yes'),
    /must be true or false/i,
  );
  const result = await controller.setLoopbackEnabled(true);
  assert.equal(result.success, false);
  assert.match(result.error, /could not change the Windows loopback exemption/i);
  assert.doesNotMatch(result.error, /secret-detail/);
});
