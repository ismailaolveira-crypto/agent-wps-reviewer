import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultProductFilesDir,
  defaultProductLogsDir,
  defaultProductRuntimeDir,
  windowsCommandShell
} from '../platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export function defaultRuntimeDir({ platform = process.platform, env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  return platform === 'win32'
    ? defaultProductRuntimeDir({ platform, env })
    : path.join(projectRoot, 'data/runtime');
}

function resolveOptions(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const runtimeDir = options.runtimeDir || defaultRuntimeDir({ platform, env, projectRoot });
  const dataDir = options.dataDir || (platform === 'win32'
    ? defaultProductFilesDir({ platform, env })
    : path.join(projectRoot, 'data'));
  const logFile = options.logFile || (platform === 'win32'
    ? path.join(defaultProductLogsDir({ platform, env }), 'bridge.log')
    : path.join(runtimeDir, 'bridge.log'));
  return {
    host: options.host || '127.0.0.1',
    port: Number(options.port || env.PORT || 17531),
    platform,
    env,
    projectRoot,
    nodePath: options.nodePath || process.execPath,
    runtimeDir,
    dataDir,
    agentToken: options.agentToken ?? '',
    agentTokenPath: options.agentTokenPath || '',
    allowLegacySubmission: options.allowLegacySubmission === true,
    detached: options.detached !== false,
    ownerKind: String(options.ownerKind || (options.detached === false ? 'test' : 'product')),
    runtimeInstanceId: options.runtimeInstanceId || randomUUID(),
    pidFile: options.pidFile || path.join(runtimeDir, 'bridge.pid'),
    logFile
  };
}

async function readPidRecord(pidFile) {
  try {
    const raw = await readFile(pidFile, 'utf8');
    try {
      const record = JSON.parse(raw);
      const pid = Number(record?.pid);
      return Number.isInteger(pid) && pid > 0
      ? {
        pid,
        host: String(record.host || ''),
        port: Number(record.port) || 0,
        runtimeInstanceId: String(record.runtimeInstanceId || ''),
        executable: String(record.executable || '')
      }
        : { pid: 0, host: '', port: 0, runtimeInstanceId: '', executable: '' };
    } catch {
      const pid = Number(raw.trim());
      return { pid: Number.isInteger(pid) && pid > 0 ? pid : 0, host: '', port: 0, runtimeInstanceId: '', executable: '' };
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { pid: 0, host: '', port: 0 };
    throw error;
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

export function findListeningPids(port, { platform = process.platform, runner = spawnSync } = {}) {
  try {
    const result = platform === 'win32'
      ? runner('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
      : runner('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) return [];
    if (platform === 'win32') return parseWindowsNetstat(result.stdout, port);
    return [...new Set(String(result.stdout || '')
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0))];
  } catch {
    return [];
  }
}

async function waitForHealth({ host, port }, timeoutMs = 5000) {
  const url = `http://${host}:${port}/health`;
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Timed out waiting for bridge health');
}

export async function statusBridge(options = {}) {
  const resolved = resolveOptions(options);
  const probeUnmanaged = options.probeUnmanaged ?? (!options.pidFile && !options.runtimeDir);
  const record = await readPidRecord(resolved.pidFile);
  const pid = record.pid;
  const pidFileMatchesTarget = !record.port || record.port === resolved.port;
  const managedProcessAlive = pidFileMatchesTarget && isProcessAlive(pid);
  let ownerMismatch = false;
  let health = null;

  if (managedProcessAlive) {
    try {
      health = await waitForHealth(resolved, 1000);
      if (health?.port && Number(health.port) !== resolved.port) health = null;
      if (record.runtimeInstanceId && health?.runtimeInstanceId && record.runtimeInstanceId !== health.runtimeInstanceId) {
        ownerMismatch = true;
      }
    } catch {
      health = null;
    }
  }

  // A bridge may survive after its pid file is removed by a previous process
  // or by a manual cleanup. Detect the listener so doctor can explain the
  // conflict instead of telling a novice that the service is simply stopped.
  if (!health && probeUnmanaged) {
    try {
      health = await waitForHealth(resolved, 250);
      if (health?.port && Number(health.port) !== resolved.port) health = null;
    } catch {
      health = null;
    }
  }

  const running = managedProcessAlive || Boolean(health?.ok);
  const managed = managedProcessAlive && !ownerMismatch && Boolean(health?.ok);
  const listenerPids = probeUnmanaged ? findListeningPids(resolved.port, { platform: resolved.platform }) : [];

  return {
    running,
    managed,
    pid,
    health,
    port: resolved.port,
    host: resolved.host,
    listenerPids,
    pidFileMatchesTarget: pid > 0 && pidFileMatchesTarget,
    pidFile: resolved.pidFile,
    logFile: resolved.logFile,
    runtimeInstanceId: record.runtimeInstanceId || '',
    ownerMismatch
  };
}

export async function startBridge(options = {}) {
  const resolved = resolveOptions(options);
  const current = await statusBridge(resolved);
  if (current.running && current.health?.ok) {
    if (!current.managed) {
      const listener = current.listenerPids?.length ? ` (listener PID: ${current.listenerPids.join(', ')})` : '';
      const error = new Error(`Bridge already listens on ${resolved.host}:${resolved.port}${listener} but is not managed by ${resolved.pidFile}`);
      error.code = 'BRIDGE_UNMANAGED_LISTENER';
      throw error;
    }
    // Bridges started before the port-aware health response are owned by this
    // pid file but cannot prove their runtime matches the current source.
    // Replace that legacy process on an explicit bridge start/setup action.
    if (current.health.port === undefined && current.pid > 0) {
      await stopBridge(resolved);
    } else {
      return { ...current, changed: false };
    }
  }

  await mkdir(resolved.runtimeDir, { recursive: true });
  await mkdir(path.dirname(resolved.logFile), { recursive: true });
  await mkdir(resolved.dataDir, { recursive: true });

  const logFd = openSync(resolved.logFile, 'a');
  let child;
  try {
    child = spawn(resolved.nodePath, [path.join(resolved.projectRoot, 'src/bridge/server.mjs')], {
      cwd: resolved.projectRoot,
      detached: resolved.detached,
      env: {
        ...resolved.env,
        HOST: resolved.host,
        PORT: String(resolved.port),
        DATA_DIR: resolved.dataDir,
        WPS_REVIEWER_OWNER_KIND: resolved.ownerKind,
        WPS_REVIEWER_AGENT_TOKEN: resolved.agentToken,
        WPS_REVIEWER_AGENT_TOKEN_FILE: resolved.agentTokenPath,
        WPS_REVIEWER_ALLOW_LEGACY_SUBMIT: resolved.allowLegacySubmission ? '1' : '0',
        WPS_REVIEWER_RUNTIME_INSTANCE_ID: resolved.runtimeInstanceId
      },
      windowsHide: resolved.platform === 'win32',
      stdio: ['ignore', logFd, logFd]
    });
  } finally {
    // Keep the descriptor only in the bridge child. Windows refuses to remove
    // a log file while the parent process still owns an open handle.
    closeSync(logFd);
  }

  await writeFile(resolved.pidFile, `${JSON.stringify({
    pid: child.pid,
    host: resolved.host,
    port: resolved.port,
      projectRoot: resolved.projectRoot,
    dataDir: resolved.dataDir,
    ownerKind: resolved.ownerKind,
    runtimeInstanceId: resolved.runtimeInstanceId,
    executable: process.execPath,
    startedAt: new Date().toISOString()
  })}\n`);
  if (resolved.detached) child.unref();
  try {
    await waitForHealth(resolved);
  } catch (error) {
    if (isProcessAlive(child.pid)) child.kill('SIGTERM');
    await rm(resolved.pidFile, { force: true });
    throw error;
  }

  return {
    running: true,
    changed: true,
    pid: child.pid,
    port: resolved.port,
    host: resolved.host,
    pidFile: resolved.pidFile,
    logFile: resolved.logFile,
    health: await waitForHealth(resolved, 1000)
  };
}

export async function stopBridge(options = {}) {
  const resolved = resolveOptions(options);
  const record = await readPidRecord(resolved.pidFile);
  const pid = record.pid;
  if (record.port && record.port !== resolved.port) {
    return {
      running: false,
      changed: false,
      pid,
      port: resolved.port,
      host: resolved.host,
      pidFileMatchesTarget: false,
      pidFile: resolved.pidFile,
      logFile: resolved.logFile
    };
  }

  if (!isProcessAlive(pid)) {
    await rm(resolved.pidFile, { force: true });
    return {
      running: false,
      changed: false,
      pid,
      port: resolved.port,
      host: resolved.host,
      pidFileMatchesTarget: true,
      pidFile: resolved.pidFile,
      logFile: resolved.logFile
    };
  }

  if (resolved.platform === 'win32') {
    if (!record.runtimeInstanceId) {
      const error = new Error(`Bridge PID ${pid} has no runtime identity; refusing to stop an unverified Windows process.`);
      error.code = 'BRIDGE_OWNER_UNCONFIRMED';
      throw error;
    }
    try {
      const health = await waitForHealth(resolved, 250);
      if (!health?.runtimeInstanceId || health.runtimeInstanceId !== record.runtimeInstanceId) {
        const error = new Error(`Bridge PID ${pid} no longer belongs to this installation.`);
        error.code = 'BRIDGE_PID_REUSED';
        throw error;
      }
    } catch (error) {
      if (error.code === 'BRIDGE_PID_REUSED') throw error;
      const ownerError = new Error(`Cannot verify ownership of bridge PID ${pid}; refusing to stop it.`);
      ownerError.code = 'BRIDGE_OWNER_UNCONFIRMED';
      throw ownerError;
    }
    const result = spawnSync(windowsCommandShell({ env: resolved.env }), ['/d', '/s', '/c', `taskkill.exe /PID ${pid} /T /F`], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.error || (result.status !== 0 && isProcessAlive(pid))) {
      const error = new Error(result.stderr || `Unable to stop managed bridge PID ${pid}`);
      error.code = 'BRIDGE_STOP_FAILED';
      throw error;
    }
  } else {
    process.kill(pid, 'SIGTERM');
  }
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (!isProcessAlive(pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (isProcessAlive(pid)) {
    if (resolved.platform === 'win32') {
      spawnSync(windowsCommandShell({ env: resolved.env }), ['/d', '/s', '/c', `taskkill.exe /PID ${pid} /T /F`], { windowsHide: true });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  }

  await rm(resolved.pidFile, { force: true });
  return {
    running: false,
    changed: true,
    pid,
    port: resolved.port,
    host: resolved.host,
    pidFileMatchesTarget: true,
    pidFile: resolved.pidFile,
    logFile: resolved.logFile
  };
}
