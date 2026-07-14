import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readPluginConfigStatus, defaultMacJsaddonsDir } from './pluginConfig.mjs';
import { readPluginAuthStatus } from './pluginAuth.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_WPS_APP_PATH = '/Applications/wpsoffice.app';

async function readPlistValue(plistPath, key) {
  try {
    const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath]);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function getWpsAppInfo(wpsAppPath) {
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

async function getWpsProcessInfo() {
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

function buildRecommendations({ plugin, auth, bridge, processInfo }) {
  const recommendations = [];
  if (!plugin.installed) {
    recommendations.push('Run npm run wps:install to install WPS plugin config.');
  }
  if (auth.valid === false) {
    recommendations.push('WPS authaddin.json 格式损坏；请恢复该文件备份后再运行 npm run doctor。');
  }
  if (auth.exists && auth.disabled) {
    recommendations.push('Run npm run wps:authorize because WPS has disabled this JS add-in in authaddin.json.');
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
  jsaddonsDir = defaultMacJsaddonsDir(),
  wpsAppPath = DEFAULT_WPS_APP_PATH,
  bridgeUrl = 'http://127.0.0.1:17531',
  checkBridge = true,
  checkProcess = true
} = {}) {
  const plugin = await readPluginConfigStatus({ jsaddonsDir });
  const auth = await readPluginAuthStatus({ jsaddonsDir });
  const wpsApp = await getWpsAppInfo(wpsAppPath);
  const bridge = checkBridge
    ? await getBridgeStatus(bridgeUrl)
    : { checked: false, running: false, url: bridgeUrl };
  const processInfo = checkProcess
    ? await getWpsProcessInfo()
    : { checked: false, running: false, pids: [] };
  const pluginConfigUpdatedAt = await newestMtime([plugin.filePath, plugin.publishPath]);

  const diagnostics = {
    ok: plugin.installed && auth.valid !== false && auth.disabled !== true && (!bridge.checked || bridge.running),
    generatedAt: new Date().toISOString(),
    wpsApp,
    plugin,
    auth,
    pluginConfigUpdatedAt,
    bridge,
    process: processInfo,
    recommendations: []
  };
  diagnostics.recommendations = buildRecommendations({
    plugin,
    auth,
    bridge,
    processInfo
  });

  return diagnostics;
}
