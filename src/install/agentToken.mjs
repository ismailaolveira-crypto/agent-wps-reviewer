import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TOKEN_ENV = 'WPS_REVIEWER_TOKEN_FILE';
const TOKEN_BYTES = 32;

export function defaultAgentTokenPath({
  homeDir = process.env.HOME || os.homedir(),
  platform = process.platform
} = {}) {
  if (!homeDir) throw new Error('HOME is not set; pass tokenPath explicitly.');
  return platform === 'darwin'
    ? path.join(homeDir, 'Library/Application Support/Agent WPS Reviewer/agent-token')
    : path.join(homeDir, '.config/agent-wps-reviewer/agent-token');
}

export function resolveAgentTokenPath(tokenPath = process.env[TOKEN_ENV]) {
  return tokenPath || defaultAgentTokenPath();
}

function normalizeToken(value) {
  const token = String(value ?? '').trim();
  return token.length >= 32 ? token : '';
}

function secureParentMode(parentPath) {
  mkdirSync(parentPath, { recursive: true, mode: 0o700 });
  chmodSync(parentPath, 0o700);
}

function secureFileMode(filePath) {
  chmodSync(filePath, 0o600);
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

export async function ensureAgentToken({ tokenPath = resolveAgentTokenPath() } = {}) {
  const resolvedPath = path.resolve(tokenPath);
  const parentPath = path.dirname(resolvedPath);
  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  await chmod(parentPath, 0o700);

  const existing = await readAgentToken({ tokenPath: resolvedPath });
  if (existing) {
    await chmod(resolvedPath, 0o600);
    return {
      tokenPath: resolvedPath,
      token: existing,
      created: false,
      fileMode: '600',
      directoryMode: '700',
      rollback: async () => {},
      cleanup: async () => {}
    };
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, resolvedPath);
  await chmod(resolvedPath, 0o600);
  return {
    tokenPath: resolvedPath,
    token,
    created: true,
    fileMode: '600',
    directoryMode: '700',
    rollback: async () => {
      if ((await readAgentToken({ tokenPath: resolvedPath })) === token) {
        await rm(resolvedPath, { force: true });
      }
    },
    cleanup: async () => {}
  };
}

export function ensureAgentTokenSync({ tokenPath = resolveAgentTokenPath() } = {}) {
  const resolvedPath = path.resolve(tokenPath);
  const parentPath = path.dirname(resolvedPath);
  secureParentMode(parentPath);
  const existing = readAgentTokenSync({ tokenPath: resolvedPath });
  if (existing) {
    secureFileMode(resolvedPath);
    return { tokenPath: resolvedPath, token: existing, created: false, fileMode: '600', directoryMode: '700' };
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  secureFileMode(temporaryPath);
  renameSync(temporaryPath, resolvedPath);
  secureFileMode(resolvedPath);
  return { tokenPath: resolvedPath, token, created: true, fileMode: '600', directoryMode: '700' };
}

export function tokenEnvName() {
  return TOKEN_ENV;
}
