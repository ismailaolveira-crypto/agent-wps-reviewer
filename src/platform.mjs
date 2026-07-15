import { mkdir, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export function isWindows(platform = process.platform) {
  return platform === 'win32';
}

export function isMacOS(platform = process.platform) {
  return platform === 'darwin';
}

export function userHome({ platform = process.platform, env = process.env } = {}) {
  const home = platform === 'win32'
    ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? path.join(env.HOMEDRIVE, env.HOMEPATH) : '')
    : env.HOME || os.homedir();
  if (!home) throw new Error('Cannot resolve the current user home directory.');
  return home;
}

export function defaultWpsJsaddonsDir({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    if (!env.APPDATA) {
      const error = new Error('APPDATA is not set; cannot resolve the Windows WPS jsaddons directory.');
      error.code = 'WINDOWS_APPDATA_MISSING';
      throw error;
    }
    return path.join(env.APPDATA, 'kingsoft/wps/jsaddons');
  }
  return path.join(
    userHome({ platform, env }),
    'Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons'
  );
}

export function defaultProductDataDir({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) {
      const error = new Error('LOCALAPPDATA is not set; cannot resolve the Windows product data directory.');
      error.code = 'WINDOWS_LOCALAPPDATA_MISSING';
      throw error;
    }
    return path.join(env.LOCALAPPDATA, 'Agent WPS Reviewer');
  }
  return path.join(userHome({ platform, env }), 'Library/Application Support/Agent WPS Reviewer');
}

export function defaultProductInstallDir({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) {
      const error = new Error('LOCALAPPDATA is not set; cannot resolve the Windows product install directory.');
      error.code = 'WINDOWS_LOCALAPPDATA_MISSING';
      throw error;
    }
    return path.join(env.LOCALAPPDATA, 'Programs/Agent WPS Reviewer/app');
  }
  return '';
}

export function defaultProductRuntimeDir({ platform = process.platform, env = process.env } = {}) {
  const root = defaultProductDataDir({ platform, env });
  return platform === 'win32' ? path.join(root, 'runtime') : path.join(root, 'runtime');
}

export function defaultProductFilesDir({ platform = process.platform, env = process.env } = {}) {
  const root = defaultProductDataDir({ platform, env });
  return platform === 'win32' ? path.join(root, 'data') : path.join(root, 'data');
}

export function defaultProductLogsDir({ platform = process.platform, env = process.env } = {}) {
  const root = defaultProductDataDir({ platform, env });
  return platform === 'win32' ? path.join(root, 'logs') : path.join(root, 'logs');
}

export function windowsCommandShell({ env = process.env } = {}) {
  return env.ComSpec || env.COMSPEC || 'cmd.exe';
}

// Quote one argument for a Windows command-line consumer without exposing
// paths containing spaces, parentheses, ampersands, or trailing backslashes.
export function quoteWindowsArgument(value) {
  const text = String(value ?? '');
  let result = '"';
  let backslashes = 0;
  for (const character of text) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes);
    result += character;
    backslashes = 0;
  }
  result += '\\'.repeat(backslashes * 2);
  return `${result}"`;
}

/**
 * Replace a file while preserving the old target until the new file is ready.
 * Windows rename() refuses to replace an existing target, so the fallback
 * moves the old target aside and restores it if the second rename fails.
 */
export async function replaceFileAtomic(filePath, content, { encoding = 'utf8' } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const transactionId = `${process.pid}-${randomUUID()}`;
  const temporaryPath = `${filePath}.${transactionId}.tmp`;
  const previousPath = `${filePath}.${transactionId}.previous`;
  const temporaryHandle = await open(temporaryPath, 'w');
  try {
    await temporaryHandle.writeFile(content, { encoding });
    await temporaryHandle.sync();
  } finally {
    await temporaryHandle.close();
  }
  try {
    await rename(temporaryPath, filePath);
    return;
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EBUSY'].includes(error.code)) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  let movedPrevious = false;
  try {
    await rename(filePath, previousPath);
    movedPrevious = true;
    await rename(temporaryPath, filePath);
    await rm(previousPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (movedPrevious) {
      await rm(filePath, { force: true }).catch(() => undefined);
      await rename(previousPath, filePath).catch(() => undefined);
    }
    throw error;
  }
}

export function platformSummary({ platform = process.platform, arch = process.arch, env = process.env } = {}) {
  return {
    platform,
    arch,
    node: process.version,
    home: userHome({ platform, env }),
    appData: platform === 'win32' ? (env.APPDATA || '') : '',
    localAppData: platform === 'win32' ? (env.LOCALAPPDATA || '') : '',
    wpsJsaddonsDir: defaultWpsJsaddonsDir({ platform, env }),
    productDataDir: defaultProductDataDir({ platform, env }),
    productInstallDir: defaultProductInstallDir({ platform, env }),
    productRuntimeDir: defaultProductRuntimeDir({ platform, env }),
    productFilesDir: defaultProductFilesDir({ platform, env }),
    productLogsDir: defaultProductLogsDir({ platform, env })
  };
}
