import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readPluginConfigStatus, defaultJsaddonsDir } from './pluginConfig.mjs';
import { readPluginAuthStatus } from './pluginAuth.mjs';
import { defaultWpsJsaddonsDir, platformSummary } from '../platform.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_WPS_APP_PATH = '/Applications/wpsoffice.app';
export const DEFAULT_WINDOWS_WPS_PATHS = [
  path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'WPS Office/office6/wps.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'WPS Office/office6/wps.exe')
];

function windowsWpsCandidates(env = process.env) {
  return [
    path.join(env.LOCALAPPDATA || '', 'Kingsoft/WPS Office/ksolaunch.exe'),
    path.join(env.PROGRAMFILES || '', 'WPS Office/office6/wps.exe'),
    path.join(env['PROGRAMFILES(X86)'] || '', 'WPS Office/office6/wps.exe')
  ].filter((candidate) => candidate && !candidate.startsWith('Kingsoft'));
}

async function readPlistValue(plistPath, key) {
  try {
    const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath]);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function readWindowsFileVersion(filePath, commandRunner = execFileAsync) {
  try {
    const { stdout } = await commandRunner('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item -LiteralPath '${String(filePath).replaceAll("'", "''")}').VersionInfo | ConvertTo-Json -Compress`
    ], { windowsHide: true });
    const info = JSON.parse(String(stdout || '{}'));
    return { version: String(info.ProductVersion || info.FileVersion || ''), build: String(info.FileVersion || '') };
  } catch {
    return { version: '', build: '' };
  }
}

async function getWpsAppInfo(wpsAppPath, { platform = process.platform, env = process.env, commandRunner = execFileAsync } = {}) {
  if (platform === 'win32') {
    let discovered = [];
    if (!wpsAppPath) {
      try {
        const result = await commandRunner('where.exe', ['wps.exe'], { windowsHide: true });
        discovered = String(result.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      } catch {
        discovered = [];
      }
    }
    const candidates = wpsAppPath ? [wpsAppPath] : [...discovered, ...windowsWpsCandidates(env), ...DEFAULT_WINDOWS_WPS_PATHS];
    for (const candidate of candidates) {
      if (!candidate || !existsSync(candidate)) continue;
      const version = await readWindowsFileVersion(candidate, commandRunner);
      return { path: candidate, exists: true, ...version };
    }
    return { path: wpsAppPath || candidates[0] || '', exists: false, version: '', build: '', discovery: discovered.length ? 'where.exe' : 'known-paths' };
  }
  const infoPath = path.join(wpsAppPath, 'Contents/Info.plist');
  const exists = existsSync(wpsAppPath) && existsSync(infoPath);
  if (!exists) {
    return { path: wpsAppPath, exists: false, version: '', build: '' };
  }

  return {
    path: wpsAppPath,
    exists: true,
    version: await readPlistValue(infoPath, 'CFBundleShortVersionString'),
    build: await readPlistValue(infoPath, 'CFBundleVersion')
  };
}

async function getBridgeStatus(bridgeUrl) {
  try {
    const response = await fetch(new URL('/health', bridgeUrl), { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    return {
      checked: true,
      running: response.ok && body.ok === true,
      url: bridgeUrl,
      health: body
    };
  } catch (error) {
    return {
      checked: true,
      running: false,
      url: bridgeUrl,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseWindowsTasklist(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^"([^"]+)","(\d+)"/))
    .filter(Boolean)
    .filter(([, imageName]) => /^wps(?:\.exe)?$/i.test(imageName))
    .map(([, , pid]) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

export function parseWindowsNetstat(stdout, port) {
  const expected = new RegExp(`:${Number(port)}\\s`);
  return [...new Set(String(stdout || '')
    .split(/\r?\n/)
    .filter((line) => /\bLISTENING\b/i.test(line) && expected.test(line))
    .map((line) => line.trim().split(/\s+/).at(-1))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

async function getWpsProcessInfo({ platform = process.platform, commandRunner = execFileAsync } = {}) {
  if (platform === 'win32') {
    try {
      const { stdout } = await commandRunner('tasklist.exe', ['/FI', 'IMAGENAME eq wps.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });
      const pids = parseWindowsTasklist(stdout);
      return { checked: true, running: pids.length > 0, pids, imageName: 'wps.exe' };
    } catch {
      return { checked: true, running: false, pids: [], imageName: 'wps.exe' };
    }
  }
  try {
    const { stdout } = await execFileAsync('pgrep', ['-x', 'wpsoffice']);
    const pids = stdout
      .trim()
      .split(/\s+/)
      .map((item) => Number(item))
      .filter(Boolean);
    return { checked: true, running: pids.length > 0, pids };
  } catch {
    return { checked: true, running: false, pids: [] };
  }
}

async function newestMtime(paths) {
  let newest = 0;
  for (const item of paths) {
    try {
      const info = await stat(item);
      newest = Math.max(newest, info.mtimeMs);
    } catch {
      // Missing files are handled by plugin status.
    }
  }
  return newest ? new Date(newest).toISOString() : '';
}

function buildRecommendations({ plugin, auth, bridge, processInfo, platform }) {
  const recommendations = [];
  if (!plugin.installed) {
    recommendations.push('Run npm run wps:install to install WPS plugin config.');
  }
  if (auth.valid === false) {
    recommendations.push('WPS authaddin.json 格式损坏；请恢复该文件备份后再运行 npm run doctor。');
  }
  if (auth.exists && auth.disabled) {
    recommendations.push(platform === 'win32'
      ? 'WPS 已禁用加载项；不要直接改 authaddin.json，请重新执行 WPS 官方 publish/trust 安装并记录 build。'
      : 'Run npm run wps:authorize because WPS has disabled this JS add-in in authaddin.json.');
  }
  if (auth.blockedByFile) {
    recommendations.push(platform === 'win32'
      ? '检测到 jsaddinblockhost.ini；请在允许的窗口完成 WPS 官方信任安装，不要强行覆盖禁用记录。'
      : '检测到 WPS 加载项禁用记录；请恢复 WPS 配置后再重试。');
  }
  if (plugin.installed && auth.exists && auth.matchedCount === 0) {
    recommendations.push('WPS authaddin.json exists but has no matching Agent add-in entry; restart WPS once so it can discover the add-in.');
  }
  if (bridge.checked && !bridge.running) {
    recommendations.push('Run npm run bridge:start before using the WPS task pane.');
  }
  if (plugin.installed && processInfo.checked && processInfo.running) {
    recommendations.push('WPS is currently running; restart WPS during an allowed test window if the Agent tab is not visible.');
  }
  return recommendations;
}

export async function runWpsDiagnostics({
  jsaddonsDir = undefined,
  wpsAppPath,
  bridgeUrl = 'http://127.0.0.1:17531',
  checkBridge = true,
  checkProcess = true,
  platform = process.platform,
  env = process.env,
  commandRunner = execFileAsync
} = {}) {
  const resolvedJsaddonsDir = jsaddonsDir || defaultWpsJsaddonsDir({ platform, env });
  const plugin = await readPluginConfigStatus({ jsaddonsDir: resolvedJsaddonsDir, platform });
  const auth = await readPluginAuthStatus({ jsaddonsDir: resolvedJsaddonsDir });
  const blockedFile = path.join(resolvedJsaddonsDir, 'jsaddinblockhost.ini');
  const blockedByFile = platform === 'win32' && existsSync(blockedFile);
  const wpsApp = await getWpsAppInfo(wpsAppPath || (platform === 'darwin' ? DEFAULT_WPS_APP_PATH : undefined), { platform, env, commandRunner });
  const bridge = checkBridge
    ? await getBridgeStatus(bridgeUrl)
    : { checked: false, running: false, url: bridgeUrl };
  const processInfo = checkProcess
    ? await getWpsProcessInfo({ platform, commandRunner })
    : { checked: false, running: false, pids: [] };
  const pluginConfigUpdatedAt = await newestMtime([plugin.filePath, plugin.publishPath]);

  const diagnostics = {
    ok: plugin.installed && auth.valid !== false && auth.disabled !== true && !blockedByFile && (!bridge.checked || bridge.running),
    generatedAt: new Date().toISOString(),
    platform: platformSummary({ platform, env }),
    wpsApp,
    plugin,
    auth: { ...auth, blockedByFile, blockedFile },
    pluginConfigUpdatedAt,
    bridge,
    process: processInfo,
    recommendations: []
  };
  diagnostics.recommendations = buildRecommendations({
    plugin,
    auth: diagnostics.auth,
    bridge,
    processInfo,
    platform
  });

  return diagnostics;
}
