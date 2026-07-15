import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultProductDataDir } from '../platform.mjs';

const TOKEN_ENV = 'WPS_REVIEWER_TOKEN_FILE';
const TOKEN_BYTES = 32;

export function defaultAgentTokenPath({
  homeDir = process.env.HOME || os.homedir(),
  platform = process.platform
} = {}) {
  if (!homeDir) throw new Error('HOME is not set; pass tokenPath explicitly.');
  if (platform === 'win32') {
    return path.join(defaultProductDataDir({
      platform,
      env: {
        ...process.env,
        USERPROFILE: homeDir,
        LOCALAPPDATA: path.join(homeDir, 'AppData/Local')
      }
    }), 'agent-token');
  }
  return path.join(defaultProductDataDir({
    platform,
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir }
  }), 'agent-token');
}

export function resolveAgentTokenPath(tokenPath = process.env[TOKEN_ENV]) {
  return tokenPath || defaultAgentTokenPath();
}

function normalizeToken(value) {
  const token = String(value ?? '').trim();
  return token.length >= 32 ? token : '';
}

function secureParentMode(parentPath, platform = process.platform) {
  mkdirSync(parentPath, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') chmodSync(parentPath, 0o700);
}

function secureFileMode(filePath, platform = process.platform) {
  if (platform !== 'win32') chmodSync(filePath, 0o600);
}

export function readAgentTokenSync({ tokenPath = resolveAgentTokenPath() } = {}) {
  try {
    return normalizeToken(readFileSync(tokenPath, 'utf8')) || null;
  } catch {
    return null;
  }
}

export async function readAgentToken({ tokenPath = resolveAgentTokenPath() } = {}) {
  try {
    return normalizeToken(await readFile(tokenPath, 'utf8')) || null;
  } catch {
    return null;
  }
}

export async function ensureAgentToken({ tokenPath = resolveAgentTokenPath(), platform = process.platform } = {}) {
  const resolvedPath = path.resolve(tokenPath);
  const parentPath = path.dirname(resolvedPath);
  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') await chmod(parentPath, 0o700);

  const existing = await readAgentToken({ tokenPath: resolvedPath });
  if (existing) {
    if (platform !== 'win32') await chmod(resolvedPath, 0o600);
    return {
      tokenPath: resolvedPath,
      token: existing,
      created: false,
      fileMode: platform === 'win32' ? 'acl-user-only' : '600',
      directoryMode: platform === 'win32' ? 'acl-user-only' : '700',
      rollback: async () => {},
      cleanup: async () => {}
    };
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  if (platform !== 'win32') await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, resolvedPath);
  if (platform !== 'win32') await chmod(resolvedPath, 0o600);
  return {
    tokenPath: resolvedPath,
    token,
    created: true,
    fileMode: platform === 'win32' ? 'acl-user-only' : '600',
    directoryMode: platform === 'win32' ? 'acl-user-only' : '700',
    rollback: async () => {
      if ((await readAgentToken({ tokenPath: resolvedPath })) === token) {
        await rm(resolvedPath, { force: true });
      }
    },
    cleanup: async () => {}
  };
}

export function ensureAgentTokenSync({ tokenPath = resolveAgentTokenPath(), platform = process.platform } = {}) {
  const resolvedPath = path.resolve(tokenPath);
  const parentPath = path.dirname(resolvedPath);
  secureParentMode(parentPath, platform);
  const existing = readAgentTokenSync({ tokenPath: resolvedPath });
  if (existing) {
    secureFileMode(resolvedPath, platform);
    return { tokenPath: resolvedPath, token: existing, created: false, fileMode: platform === 'win32' ? 'acl-user-only' : '600', directoryMode: platform === 'win32' ? 'acl-user-only' : '700' };
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  secureFileMode(temporaryPath, platform);
  renameSync(temporaryPath, resolvedPath);
  secureFileMode(resolvedPath, platform);
  return { tokenPath: resolvedPath, token, created: true, fileMode: platform === 'win32' ? 'acl-user-only' : '600', directoryMode: platform === 'win32' ? 'acl-user-only' : '700' };
}

export function tokenEnvName() {
  return TOKEN_ENV;
}
