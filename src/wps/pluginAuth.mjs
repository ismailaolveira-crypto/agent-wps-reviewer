import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PLUGIN_NAME,
  DEFAULT_PLUGIN_URL,
  defaultJsaddonsDir
} from './pluginConfig.mjs';
import { replaceFileAtomic } from '../platform.mjs';

function normalizePluginPath(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function authFilePath(jsaddonsDir = defaultJsaddonsDir()) {
  return path.join(jsaddonsDir, 'authaddin.json');
}

async function readAuthFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return { exists: true, raw, data: JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { exists: false, raw: '', data: null };
    }
    if (error instanceof SyntaxError) {
      return { exists: true, raw: await readFile(filePath, 'utf8'), data: null, parseError: 'invalid-json' };
    }
    throw error;
  }
}

async function restoreRaw(filePath, raw) {
  if (raw) {
    await replaceFileAtomic(filePath, raw);
  } else {
    await rm(filePath, { force: true });
  }
}

function findPluginAuthEntries(data, { pluginName = DEFAULT_PLUGIN_NAME, pluginUrl = DEFAULT_PLUGIN_URL } = {}) {
  const entries = [];
  const expectedPath = normalizePluginPath(pluginUrl);
  const root = data && typeof data === 'object' ? data : {};

  for (const [appType, section] of Object.entries(root)) {
    if (!section || typeof section !== 'object') continue;
    for (const [key, entry] of Object.entries(section)) {
      if (!entry || typeof entry !== 'object') continue;
      const matchesName = entry.name === pluginName;
      const matchesPath = normalizePluginPath(entry.path) === expectedPath;
      if (matchesName || matchesPath) {
        entries.push({ appType, key, entry });
      }
    }
  }

  return entries;
}

export async function readPluginAuthStatus({
  jsaddonsDir = defaultJsaddonsDir(),
  pluginName = DEFAULT_PLUGIN_NAME,
  pluginUrl = DEFAULT_PLUGIN_URL
} = {}) {
  const filePath = authFilePath(jsaddonsDir);
  const auth = await readAuthFile(filePath);
  const entries = auth.exists ? findPluginAuthEntries(auth.data, { pluginName, pluginUrl }) : [];
  const matched = entries.map(({ appType, key, entry }) => ({
    appType,
    key,
    name: entry.name || '',
    path: entry.path || '',
    enable: entry.enable,
    isload: entry.isload,
    mode: entry.mode
  }));
  const hasDisabledMatch = matched.some((entry) => entry.enable === false);
  const hasEnabledMatch = matched.some((entry) => entry.enable === true);

  return {
    filePath,
    exists: auth.exists,
    valid: !auth.exists || auth.data !== null,
    ...(auth.parseError ? { error: auth.parseError } : {}),
    matched,
    matchedCount: matched.length,
    authorized: matched.length === 0 ? null : hasEnabledMatch && !hasDisabledMatch,
    disabled: hasDisabledMatch
  };
}

export async function authorizePluginAuthFile({
  jsaddonsDir = defaultJsaddonsDir(),
  pluginName = DEFAULT_PLUGIN_NAME,
  pluginUrl = DEFAULT_PLUGIN_URL,
  platform = process.platform
} = {}) {
  const filePath = authFilePath(jsaddonsDir);
  const auth = await readAuthFile(filePath);
  const currentStatus = await readPluginAuthStatus({ jsaddonsDir, pluginName, pluginUrl });
  if (platform === 'win32') {
    return {
      ...currentStatus,
      changed: false,
      wpsTrusted: currentStatus.authorized === true,
      trustPending: currentStatus.authorized !== true,
      reason: 'Windows production install is read-only; complete WPS official trust installation before retrying.',
      rollback: async () => {},
      cleanup: async () => {}
    };
  }
  if (auth.parseError) {
    const error = new Error('WPS authaddin.json 不是有效 JSON，无法安全修复。');
    error.code = 'WPS_AUTH_INVALID';
    throw error;
  }
  if (!auth.exists) {
    return {
      filePath,
      exists: false,
      changed: false,
      authorized: null,
      matchedCount: 0,
      reason: 'authaddin.json not found; WPS creates it after first seeing the add-in',
      rollback: async () => {},
      cleanup: async () => {}
    };
  }

  const entries = findPluginAuthEntries(auth.data, { pluginName, pluginUrl });
  let changed = false;
  for (const { entry } of entries) {
    if (entry.enable !== true) {
      entry.enable = true;
      changed = true;
    }
  }

  if (changed) {
    await replaceFileAtomic(filePath, `${JSON.stringify(auth.data, null, 4)}\n`);
  }

  const status = await readPluginAuthStatus({ jsaddonsDir, pluginName, pluginUrl });
  return {
    filePath,
    exists: true,
    changed,
    wpsTrusted: status.authorized === true,
    trustPending: false,
    authorized: status.authorized,
    matchedCount: status.matchedCount,
    matched: status.matched,
    rollback: async () => {
      if (changed) await restoreRaw(filePath, auth.raw);
    },
    cleanup: async () => {}
  };
}
