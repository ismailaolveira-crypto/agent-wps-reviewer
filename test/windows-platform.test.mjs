import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  defaultProductDataDir,
  defaultProductInstallDir,
  defaultProductFilesDir,
  defaultProductLogsDir,
  defaultProductRuntimeDir,
  defaultWpsJsaddonsDir,
  platformSummary,
  replaceFileAtomic
} from '../src/platform.mjs';
import { parseWindowsNetstat } from '../src/bridge/processControl.mjs';
import { buildWindowsTaskArgs, installLaunchAgent, uninstallLaunchAgent } from '../src/install/launchAgent.mjs';
import { quoteWindowsCommandArg } from '../src/install/mcpConfig.mjs';
import { runWpsDiagnostics } from '../src/wps/diagnostics.mjs';
import { authorizePluginAuthFile } from '../src/wps/pluginAuth.mjs';
import { installLocalProduct } from '../src/install/localInstall.mjs';
import { stopBridge } from '../src/bridge/processControl.mjs';
import { installStableWindowsBundle, readStableWindowsBundleStatus } from '../src/install/stableWindowsBundle.mjs';

const windowsEnv = {
  USERPROFILE: 'C:\\Users\\reviewer',
  APPDATA: 'C:\\Users\\reviewer\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\reviewer\\AppData\\Local'
};

test('Windows platform defaults use user-scoped WPS and product directories', () => {
  assert.equal(defaultWpsJsaddonsDir({ platform: 'win32', env: windowsEnv }), path.join(windowsEnv.APPDATA, 'kingsoft/wps/jsaddons'));
  assert.equal(defaultProductDataDir({ platform: 'win32', env: windowsEnv }), path.join(windowsEnv.LOCALAPPDATA, 'Agent WPS Reviewer'));
  assert.equal(defaultProductInstallDir({ platform: 'win32', env: windowsEnv }), path.join(windowsEnv.LOCALAPPDATA, 'Programs/Agent WPS Reviewer/app'));
  assert.equal(platformSummary({ platform: 'win32', env: windowsEnv }).platform, 'win32');
  assert.equal(defaultProductRuntimeDir({ platform: 'win32', env: windowsEnv }), path.join(windowsEnv.LOCALAPPDATA, 'Agent WPS Reviewer/runtime'));
  assert.equal(defaultProductFilesDir({ platform: 'win32', env: windowsEnv }), path.join(windowsEnv.LOCALAPPDATA, 'Agent WPS Reviewer/data'));
  assert.equal(defaultProductLogsDir({ platform: 'win32', env: windowsEnv }), path.join(windowsEnv.LOCALAPPDATA, 'Agent WPS Reviewer/logs'));
});

test('Windows platform defaults fail clearly when required profile roots are missing', () => {
  assert.throws(
    () => defaultWpsJsaddonsDir({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\reviewer' } }),
    (error) => error.code === 'WINDOWS_APPDATA_MISSING'
  );
  assert.throws(
    () => defaultProductDataDir({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\reviewer' } }),
    (error) => error.code === 'WINDOWS_LOCALAPPDATA_MISSING'
  );
});

test('Windows file replacement updates an existing target without leaving temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-platform-replace-'));
  const filePath = path.join(dir, 'nested/config.json');
  try {
    await replaceFileAtomic(filePath, 'first');
    await replaceFileAtomic(filePath, 'second');
    assert.equal(await readFile(filePath, 'utf8'), 'second');
    const nested = await (await import('node:fs/promises')).readdir(path.dirname(filePath));
    assert.deepEqual(nested, ['config.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows netstat parser returns only LISTENING PIDs for the requested port', () => {
  const output = [
    '  TCP    127.0.0.1:17531    0.0.0.0:0    LISTENING    4242',
    '  TCP    127.0.0.1:17531    0.0.0.0:0    TIME_WAIT    9999',
    '  TCP    127.0.0.1:17532    0.0.0.0:0    LISTENING    5252'
  ].join('\r\n');
  assert.deepEqual(parseWindowsNetstat(output, 17531), [4242]);
});

test('Windows auth repair is read-only and never changes authaddin.json', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-win-auth-'));
  const authPath = path.join(dir, 'authaddin.json');
  const original = JSON.stringify({ wps: { agent: { name: 'WpsAgentReviewer', enable: false } } });
  try {
    await writeFile(authPath, original);
    const result = await authorizePluginAuthFile({ jsaddonsDir: dir, platform: 'win32' });
    assert.equal(result.changed, false);
    assert.match(result.reason, /read-only/);
    assert.equal(await readFile(authPath, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows WPS diagnostics parse tasklist and file version without touching WPS', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-win-diagnostics-'));
  const wpsPath = path.join(dir, 'wps.exe');
  try {
    await writeFile(wpsPath, 'fake');
    const calls = [];
    const commandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === 'tasklist.exe') return { stdout: '"wps.exe","4242","Console","1","12,000 K"\r\n', status: 0 };
      return { stdout: '{"ProductVersion":"12.1.0.12345","FileVersion":"12.1.0.12345"}', status: 0 };
    };
    const result = await runWpsDiagnostics({
      platform: 'win32',
      env: windowsEnv,
      jsaddonsDir: dir,
      wpsAppPath: wpsPath,
      checkBridge: false,
      commandRunner
    });
    assert.equal(result.platform.platform, 'win32');
    assert.equal(result.wpsApp.exists, true);
    assert.equal(result.wpsApp.version, '12.1.0.12345');
    assert.deepEqual(result.process.pids, [4242]);
    assert.deepEqual(calls.map((call) => call.command), ['powershell.exe', 'tasklist.exe']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows WPS diagnostics use where.exe discovery and report block files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-win-discovery-'));
  const discoveredPath = path.join(dir, 'wps.exe');
  try {
    await writeFile(discoveredPath, 'fake');
    await writeFile(path.join(dir, 'jsaddinblockhost.ini'), '[blocked]\n');
    const calls = [];
    const commandRunner = async (command) => {
      calls.push(command);
      if (command === 'where.exe') return { stdout: `${discoveredPath}\r\n`, status: 0 };
      if (command === 'powershell.exe') return { stdout: '{"ProductVersion":"12.1.0.1"}', status: 0 };
      if (command === 'tasklist.exe') return { stdout: '', status: 0 };
      return { stdout: '', status: 0 };
    };
    const result = await runWpsDiagnostics({
      platform: 'win32',
      env: windowsEnv,
      jsaddonsDir: dir,
      checkBridge: false,
      commandRunner
    });
    assert.equal(result.wpsApp.path, discoveredPath);
    assert.equal(result.auth.blockedByFile, true);
    assert.equal(result.ok, false);
    assert.ok(calls.includes('where.exe'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows Task Scheduler command is user-level and reversible', async () => {
  const args = buildWindowsTaskArgs({ projectRoot: 'C:\\Agent WPS Reviewer', taskName: 'Agent WPS Reviewer Bridge' });
  assert.equal(args.create.includes('/RL') && args.create.includes('LIMITED'), true);
  assert.match(args.command, /cmd\.exe/);
  const calls = [];
  const runner = async (command, commandArgs) => {
    calls.push({ command, commandArgs });
    if (commandArgs[0] === '/Query') return { code: 0, stdout: '"Agent WPS Reviewer Bridge","Ready"', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const installed = await installLaunchAgent({
    platform: 'win32',
    env: windowsEnv,
    projectRoot: 'C:\\Agent WPS Reviewer',
    taskRunner: runner
  });
  assert.equal(installed.ok, true);
  await installed.rollback();
  const removed = await uninstallLaunchAgent({ platform: 'win32', taskRunner: runner });
  assert.equal(removed.ok, true);
  assert.ok(calls.some((call) => call.commandArgs[0] === '/Delete'));
});

test('Windows MCP command arguments are quoted for cmd.exe invocation', () => {
  assert.equal(quoteWindowsCommandArg('C:\\Program Files\\Codex\\codex.cmd'), '"C:\\Program Files\\Codex\\codex.cmd"');
  const special = quoteWindowsCommandArg('C:\\Users\\审阅者\\Agent (beta)&\\');
  assert.match(special, /^".*\&.*"$/);
  assert.notEqual(special, 'C:\\Users\\审阅者\\Agent (beta)&\\');
});

test('Windows local install uses publish-only config and Task Scheduler without changing auth', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-win-install-'));
  const port = 17631;
  const bridgeOptions = {
    port,
    detached: false,
    ownerKind: 'test',
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'data'),
    agentTokenPath: path.join(dir, 'agent-token'),
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };
  const taskRunner = async (_command, args) => args[0] === '/Query'
    ? { code: 0, stdout: '"Agent WPS Reviewer Bridge","Ready"', stderr: '' }
    : { code: 0, stdout: '', stderr: '' };
  try {
    const result = await installLocalProduct({
      platform: 'win32',
      jsaddonsDir: path.join(dir, 'jsaddons'),
      port,
      backup: false,
      startBridgeAfterInstall: true,
      runReadiness: false,
      checkInstalledUrls: true,
      installSkill: false,
      bridgeOptions,
      configureLaunchAgent: true,
      launchAgentOptions: { taskRunner }
    });
    assert.equal(result.ok, true);
    assert.equal(result.platform, 'win32');
    assert.equal(result.config.mode, 'publish');
    assert.equal(result.config.exists, undefined);
    assert.equal(result.authorization.changed, false);
    assert.equal(result.wpsTrustPending, true);
    assert.equal(result.wpsTrusted, false);
    assert.equal(result.ready, false);
    assert.equal(result.launchAgent.platform, 'win32');
    assert.equal(result.readiness.urlConsistency.ok, true);
  } finally {
    await stopBridge({ ...bridgeOptions, platform: process.platform }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows stable bundle swaps app.next and can roll back app.previous', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-stable-bundle-'));
  const source = path.join(root, 'download (测试)');
  const target = path.join(root, 'LocalAppData', 'Programs', 'Agent WPS Reviewer', 'app');
  try {
    await mkdir(path.join(source, 'config'), { recursive: true });
    await mkdir(path.join(source, 'src/bridge'), { recursive: true });
    await mkdir(path.join(source, 'scripts'), { recursive: true });
    await writeFile(path.join(source, 'package.json'), '{"name":"agent-wps-reviewer","version":"0.2.0"}\n');
    await writeFile(path.join(source, 'config/product-manifest.json'), '{}\n');
    await writeFile(path.join(source, 'src/bridge/server.mjs'), 'export {};\n');
    await writeFile(path.join(source, 'scripts/setup.mjs'), 'export {};\n');
    await writeFile(path.join(source, 'setup.cmd'), '@echo off\r\n');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'old.txt'), 'old\n');

    const transaction = await installStableWindowsBundle({ platform: 'win32', sourceRoot: source, targetRoot: target });
    assert.equal(transaction.ok, true);
    assert.equal(await readFile(path.join(target, 'package.json'), 'utf8'), '{"name":"agent-wps-reviewer","version":"0.2.0"}\n');
    assert.equal(await readFile(path.join(target, 'setup.cmd'), 'utf8'), '@echo off\r\n');
    assert.equal((await readStableWindowsBundleStatus({ platform: 'win32', targetRoot: target })).valid, true);
    await transaction.rollback();
    assert.equal(await readFile(path.join(target, 'old.txt'), 'utf8'), 'old\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
