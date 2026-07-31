import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createMindServer } from '../../src/mindcraft/mindserver.js';
import { swarm } from '../../src/mindcraft/swarm/swarm.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicRoot = path.join(repoRoot, 'src', 'mindcraft', 'public');
const shellPath = path.join(publicRoot, 'index.html');
const sourceFiles = ['js/api.js', 'js/agents.js', 'js/dashboard.js', 'js/director.js', 'js/main.js', 'js/minecraft-server.js', 'js/profiles.js', 'js/swarm.js', 'js/utils.js', 'styles/console.css'];

function readShell() {
  return readFile(shellPath, 'utf8');
}

async function readPublicSources() {
  const entries = await Promise.all(sourceFiles.map(async (file) => [
    file,
    await readFile(path.join(publicRoot, file), 'utf8'),
  ]));
  return Object.fromEntries(entries);
}

function getText(server, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: 'localhost',
      port: server.address().port,
      path: requestPath,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    request.on('error', reject);
  });
}

async function closeMindServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  swarm.stop();
}

test('Given the loopback MindServer, when the unified shell is requested, then index.html serves the internal accessible workspace shell', async () => {
  // Given
  const server = await createMindServer(false, 0);

  try {
    // When
    const response = await getText(server, '/index.html');
    const shell = response.body;
    const primaryNav = shell.match(/<nav\b[^>]*id="primaryNav"[^>]*>([\s\S]*?)<\/nav>/i)?.[1] || '';

    // Then
    assert.equal(response.statusCode, 200);
    assert.match(shell, /<html\b[^>]*\blang="en"/i);
    assert.match(shell, /<meta\b[^>]*name="viewport"[^>]*>/i);
    assert.match(shell, /<div\b[^>]*id="liveRegion"[^>]*aria-live="polite"/i);
    assert.match(shell, /<nav\b/i);
    assert.match(shell, /<main\b/i);
    assert.match(shell, /<aside\b/i);

    // Rooms are named for what the operator is doing, not for the subsystem
    // behind them. Squads and Console are listed here so a future change cannot
    // quietly drop a room that has no other coverage.
    for (const [workspace, label] of [
      ['overview', 'Home'],
      ['server', 'World'],
      ['agents', 'Bots'],
      ['squads', 'Squads'],
      ['console', 'Console'],
      ['profiles', 'Bot Profiles'],
      ['director', 'Director'],
      ['swarm', 'Task Runners'],
      ['activity', 'Activity'],
    ]) {
      assert.match(primaryNav, new RegExp(`data-workspace="${workspace}"`));
      assert.match(primaryNav, new RegExp(`>${label}<`));
    }
    assert.doesNotMatch(primaryNav, /<a\b/i);
    assert.doesNotMatch(primaryNav, /(?:setup|director|swarm)\.html/i);
  } finally {
    await closeMindServer(server);
  }
});

test('Given the consolidated client modules, when their control-plane contracts are inspected, then profile, readiness, Director, and Task Runner calls remain wired', async () => {
  // Given
  const sources = await readPublicSources();
  const apiClient = sources['js/api.js'];
  const profiles = sources['js/profiles.js'];
  const main = sources['js/main.js'];
  const agents = sources['js/agents.js'];
  const dashboard = sources['js/dashboard.js'];
  const director = sources['js/director.js'];
  const swarmClient = sources['js/swarm.js'];
  const minecraftServer = sources['js/minecraft-server.js'];

  // Then
  for (const route of ['/profiles', '/launcher-config', '/local-models', '/local-services/ollama/start', '/quickstart/local', '/keys']) {
    assert.match(profiles, new RegExp(`api\\(['"]${route.replace('/', '\\/')}`), `profile/config contract ${route}`);
  }
  assert.match(apiClient, /export async function requestControlCenterRestart/);
  assert.match(apiClient, /timeoutMs:\s*120_000/);
  assert.match(apiClient, /location\.assign/);
  for (const source of [profiles, main, minecraftServer]) {
    assert.match(source, /requestControlCenterRestart\(\)/);
  }
  assert.match(
    minecraftServer,
    /const result = await requestControlCenterRestart\(\);[\s\S]*?if \(!result\.success\) \{[\s\S]*?return;[\s\S]*?\}\s*this\.busy = '';[\s\S]*?this\.render\(\);/,
    'a successful control-center restart must release the local action lock after the replacement is ready',
  );
  assert.match(main, /api\(['"]\/health['"]\)/);
  assert.match(main, /optionalApi\(['"]\/local-services['"]\)/);
  assert.match(main, /socket\.emit\(['"]create-agent['"]/);
  assert.match(
    main,
    /const minecraft=quick\.minecraft;/,
    'bot launch must use the explicitly configured target instead of hijacking any installed managed server',
  );
  assert.match(
    minecraftServer,
    /this\.onTargetSelected\?\.\(this\.status\)/,
    'a successful managed-server action must update the in-memory bot target immediately',
  );
  assert.match(
    minecraftServer,
    /if\s*\(response\.server\)\s*\{\s*this\.status\s*=\s*response\.server/,
    'failed lifecycle actions must render the server phase and logs returned by MindServer',
  );
  assert.match(minecraftServer, /api\(`\/minecraft-server\?logs=/);
  for (const route of [
    '/minecraft-server/install',
    '/minecraft-server/configure',
    '/minecraft-server/apply-settings',
    '/minecraft-server/start',
    '/minecraft-server/stop',
    '/minecraft-server/restart',
    '/minecraft-server/command',
  ]) {
    assert.match(minecraftServer, new RegExp(`['"]${route.replaceAll('/', '\\/')}['"]`));
  }
  assert.match(
    minecraftServer,
    /Stop Mindcraft Runtime/,
    'the server workspace must always expose a stack-wide stop control',
  );
  assert.match(
    minecraftServer,
    /Restart Control Center[\s\S]*Shut Down Control Center/,
    'control-center restart and shutdown must be visible beside stack controls',
  );
  assert.match(
    minecraftServer,
    /Bedrock.*19132|bedrockPort/,
    'the server workspace must expose the Bedrock join port when cross-play is installed',
  );
  assert.match(
    sources['js/profiles.js'],
    /autoStart:false/,
    'guided setup must not arm launcher auto-start before the Minecraft server is ready',
  );
  assert.match(
    sources['js/main.js'],
    /startLocalStack/,
    'guided setup must coordinate server readiness before bot startup',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /if\s*\(!quiet\s*\|\|\s*nextKey\s*!==\s*this\.renderKey\)\s*this\.render\(\);\s*else\s*this\.renderLogs/,
    'visible server status changes must rerender while log-only updates stay incremental',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /commandInput\.addEventListener\(['"]input['"]/,
    'console polling must preserve a command while the operator is typing',
  );
  const gameAdminHeading = sources['js/minecraft-server.js'].indexOf("'Game administration'");
  const serverOutputHeading = sources['js/minecraft-server.js'].indexOf("'Server output'");
  assert.ok(
    gameAdminHeading >= 0 && serverOutputHeading > gameAdminHeading,
    'live game administration must be labeled and rendered before the scrolling server output',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /list[\s\S]*save-all[\s\S]*time set day[\s\S]*weather clear[\s\S]*op[\s\S]*whitelist[\s\S]*gamemode/,
    'game administration must surface representative server and gameplay command examples',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /this\.root\.append\(this\.operatorPanel\(status\)\)[\s\S]*this\.settingsPanel\(status\)[\s\S]*this\.controlCenterPanel\(\)/,
    'live operation must render before settings and whole-control-center actions',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /MAX_COMMAND_HISTORY[\s\S]*ArrowUp[\s\S]*ArrowDown/,
    'the operator console must keep bounded in-memory command recall',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /All output[\s\S]*Commands[\s\S]*Warnings & errors[\s\S]*Players & chat/,
    'server output must expose operator-oriented local filters',
  );
  for (const setting of [
    'motd',
    'onlineMode',
    'whiteList',
    'enforceWhitelist',
    'hideOnlinePlayers',
    'logIps',
    'forceGameMode',
    'hardcore',
    'opPermissionLevel',
    'pauseWhenEmptySeconds',
    'entityBroadcastRangePercentage',
  ]) {
    assert.match(
      sources['js/minecraft-server.js'],
      new RegExp(`\\b${setting}\\b`),
      `managed setting ${setting} must be exposed by the server workspace`,
    );
  }
  assert.match(
    sources['styles/console.css'],
    /\.app-header\s*\{[^}]*position:sticky;[^}]*\}[\s\S]*\.primary-nav\s*\{[^}]*display:flex;[^}]*\}/,
    'the shell must keep the compact global workspace navigation available while the operator scrolls',
  );
  assert.match(
    sources['styles/console.css'],
    /@media \(max-width:900px\)[\s\S]*?\.server-overview-grid,\.operator-layout,\.settings-layout,\.overview-operations-grid,\.squad-list,\.director-layout\s*\{\s*grid-template-columns:1fr;/,
    'operator and settings layouts must collapse before the mobile breakpoint',
  );
  assert.match(
    main,
    /quick\.minecraft=\{host:status\.host,port:status\.port\};void refreshHealth\(\)/,
    'successful server actions must refresh reachability before Start Here offers bot launch',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /Mindcraft-compatible Paper \$\{status\.recommendedVersion\}/,
    'setup must describe the bot-compatible server version instead of promising Mojang latest',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /Geyser/,
    'the dashboard must explain that managed Bedrock access uses Geyser',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /status\.compatible\s*===\s*false[\s\S]*Replace with compatible cross-play server/,
    'an installed unsupported release must offer safe replacement instead of Start Server',
  );
  assert.match(
    sources['js/minecraft-server.js'],
    /cross-play/i,
    'the compatibility-repair state must surface the managed cross-play option',
  );
  assert.match(agents, /socket\.on\(['"]agents-status['"]/);
  assert.match(
    sources['js/utils.js'],
    /state === 'failed'[\s\S]*\/spawn\|launch\|process\|socket\|connection\|timeout\|temporary\|restart\|signal\|error\|path\|navigation\|cancel\/i/,
    'a canceled navigation failure must keep the page-level Retry Start action available',
  );
  assert.match(agents, /canStartAgent/);
  assert.match(agents, /file\.size===0\|\|file\.size>MAX_PROFILE_UPLOAD_BYTES[\s\S]*new FileReader\(\)/);
  assert.match(agents, /localServiceUrl\(port\)/);
  assert.match(sources['js/utils.js'], /window\.location\.hostname[\s\S]*numericPort/);
  assert.match(
    dashboard,
    /Restart Mindcraft[\s\S]*Shut Down Mindcraft[\s\S]*Stop Mindcraft Runtime/,
    'Dashboard must expose the whole-control-center lifecycle controls and emergency stop',
  );
  assert.match(dashboard, /Java World[\s\S]*Bedrock Bridge/);
  assert.match(apiClient, /API_REQUEST_TIMEOUT_MS[\s\S]*AbortController[\s\S]*API_MAX_RESPONSE_CHARS/);
  assert.match(sources['js/api.js'], /2e\|2f\|5c/);

  for (const route of [
    '/api/director/command',
    '/api/director/leash',
    '/api/director/unleash',
    '/api/director/program',
    '/api/director/programs',
    '/api/director/leashes',
    '/api/director/program/stop',
  ]) {
    assert.match(director, new RegExp(`api\\(['"]${route.replaceAll('/', '\\/')}`), `Director contract ${route}`);
  }
  for (const route of ['/swarm', '/swarm/deploy', '/swarm/pulse/', '/swarm/relocate/', '/swarm/recall/']) {
    assert.match(swarmClient, new RegExp("api\\(['\"`]" + route.replaceAll('/', '\\/')), `Swarm contract ${route}`);
  }
});

test('Given dynamic workspace data, when the unified client renders it, then DOM text and listeners are used instead of inline handlers', async () => {
  // Given
  const shell = await readShell();
  const sources = await readPublicSources();
  const clientSource = Object.values(sources).join('\n');

  // Then
  assert.match(sources['js/utils.js'], /el\.textContent\s*=\s*String\(value\)/);
  assert.match(sources['js/utils.js'], /el\.addEventListener\(['"]click['"], \(event\) =>/);
  assert.match(sources['js/utils.js'], /mindcraft-action-error/);
  assert.doesNotMatch(shell, /\son[a-z]+\s*=\s*["']/i);
  assert.doesNotMatch(clientSource, /\son(?:click|change|error|load|submit)\s*=\s*["']/i);
  assert.doesNotMatch(clientSource, /\b(?:innerHTML|outerHTML)\s*=/i);
  assert.match(sources['js/agents.js'], /dataset\.agentName\s*=\s*agent\.name/);
  assert.match(sources['js/agents.js'], /addEventListener\(['"]error['"']/);
});
