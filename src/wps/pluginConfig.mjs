import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PLUGIN_NAME = 'WpsAgentReviewer';
export const DEFAULT_PLUGIN_URL = 'http://127.0.0.1:17531/WpsAgentReviewer/';

export function defaultMacJsaddonsDir(homeDir = process.env.HOME) {
  if (!homeDir) {
    throw new Error('Cannot resolve HOME for WPS jsaddons directory');
  }
  return path.join(
    homeDir,
    'Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons'
  );
}

export function buildPluginEntry(pluginUrl = DEFAULT_PLUGIN_URL, pluginName = DEFAULT_PLUGIN_NAME) {
  const escapedUrl = escapeXml(pluginUrl);
  return `<jspluginonline name="${escapeXml(pluginName)}" type="wps" url="${escapedUrl}" debug="" enable="enable_dev" install="${escapedUrl}"/>`;
}

export function buildPublishXml(pluginUrl = DEFAULT_PLUGIN_URL, pluginName = DEFAULT_PLUGIN_NAME) {
  return [
    '<jsplugins>',
    `  ${buildPluginEntry(pluginUrl, pluginName)}`,
    '</jsplugins>',
    ''
  ].join('\n');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function pluginLinePattern(pluginName) {
  return new RegExp(`^\\s*<jspluginonline\\b[^>]*\\bname=["']${escapeRegExp(pluginName)}["'][^>]*/>\\s*$`, 'm');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readExisting(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function maybeBackup(filePath, enabled) {
  if (!enabled) return '';
  const existing = await readExisting(filePath);
  if (!existing) return '';
  const backupPath = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await writeFile(backupPath, existing);
  return backupPath;
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content);
  await rename(tmpPath, filePath);
}

async function restoreText(filePath, content) {
  if (content) {
    await writeAtomic(filePath, content);
  } else {
    await rm(filePath, { force: true });
  }
}

export function addPluginEntry(xml, { pluginName = DEFAULT_PLUGIN_NAME, pluginUrl = DEFAULT_PLUGIN_URL } = {}) {
  const entry = `  ${buildPluginEntry(pluginUrl, pluginName)}`;
  const pattern = pluginLinePattern(pluginName);
  const current = String(xml || '').trim();

  if (!current) {
    return ['<jsplugins>', entry, '</jsplugins>', ''].join('\n');
  }

  if (pattern.test(current)) {
    return current.replace(pattern, entry) + '\n';
  }

  if (current.includes('</jsplugins>')) {
    return `${current.replace('</jsplugins>', `${entry}\n</jsplugins>`)}\n`;
  }

  return ['<jsplugins>', current, entry, '</jsplugins>', ''].join('\n');
}

export function removePluginEntry(xml, pluginName = DEFAULT_PLUGIN_NAME) {
  const pattern = pluginLinePattern(pluginName);
  return String(xml || '')
    .split('\n')
    .filter((line) => !pattern.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export async function installPluginConfig({
  jsaddonsDir = defaultMacJsaddonsDir(),
  pluginName = DEFAULT_PLUGIN_NAME,
  pluginUrl = DEFAULT_PLUGIN_URL,
  backup = true
} = {}) {
  const filePath = path.join(jsaddonsDir, 'jsplugins.xml');
  const publishPath = path.join(jsaddonsDir, 'publish.xml');
  const existing = await readExisting(filePath);
  const next = addPluginEntry(existing, { pluginName, pluginUrl });
  const publishExisting = await readExisting(publishPath);
  const publishNext = buildPublishXml(pluginUrl, pluginName);
  const changed = existing !== next || publishExisting !== publishNext;
  const backupPath = existing !== next ? await maybeBackup(filePath, backup) : '';
  const publishBackupPath = publishExisting !== publishNext ? await maybeBackup(publishPath, backup) : '';

  if (existing !== next) {
    try {
      await writeAtomic(filePath, next);
      if (publishExisting !== publishNext) await writeAtomic(publishPath, publishNext);
    } catch (error) {
      await restoreText(filePath, existing);
      await restoreText(publishPath, publishExisting);
      throw error;
    }
  } else if (publishExisting !== publishNext) {
    try {
      await writeAtomic(publishPath, publishNext);
    } catch (error) {
      await restoreText(publishPath, publishExisting);
      throw error;
    }
  }

  return {
    filePath,
    publishPath,
    backupPath,
    publishBackupPath,
    installed: true,
    changed,
    rollback: async () => {
      await restoreText(filePath, existing);
      await restoreText(publishPath, publishExisting);
    },
    cleanup: async () => {}
  };
}

export async function uninstallPluginConfig({
  jsaddonsDir = defaultMacJsaddonsDir(),
  pluginName = DEFAULT_PLUGIN_NAME,
  backup = true
} = {}) {
  const filePath = path.join(jsaddonsDir, 'jsplugins.xml');
  const publishPath = path.join(jsaddonsDir, 'publish.xml');
  const existing = await readExisting(filePath);
  const next = removePluginEntry(existing, pluginName);
  const publishExisting = await readExisting(publishPath);
  const publishNext = removePluginEntry(publishExisting, pluginName);
  const changed = existing !== next || publishExisting !== publishNext;
  const backupPath = existing !== next ? await maybeBackup(filePath, backup) : '';
  const publishBackupPath = publishExisting !== publishNext ? await maybeBackup(publishPath, backup) : '';

  if (existing !== next) {
    await writeAtomic(filePath, next.endsWith('\n') ? next : `${next}\n`);
  }
  if (publishExisting !== publishNext) {
    await writeAtomic(publishPath, publishNext.endsWith('\n') ? publishNext : `${publishNext}\n`);
  }

  return {
    filePath,
    publishPath,
    backupPath,
    publishBackupPath,
    installed: false,
    changed
  };
}

export async function readPluginConfigStatus({
  jsaddonsDir = defaultMacJsaddonsDir(),
  pluginName = DEFAULT_PLUGIN_NAME
} = {}) {
  const filePath = path.join(jsaddonsDir, 'jsplugins.xml');
  const publishPath = path.join(jsaddonsDir, 'publish.xml');
  const existing = await readExisting(filePath);
  const publishExisting = await readExisting(publishPath);
  return {
    filePath,
    publishPath,
    installed: pluginLinePattern(pluginName).test(existing) || pluginLinePattern(pluginName).test(publishExisting),
    exists: Boolean(existing),
    publishExists: Boolean(publishExisting),
    bytes: Buffer.byteLength(existing),
    publishBytes: Buffer.byteLength(publishExisting)
  };
}
