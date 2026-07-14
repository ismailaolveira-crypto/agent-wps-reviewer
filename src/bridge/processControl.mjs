import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export function defaultRuntimeDir() {
  return path.join(PROJECT_ROOT, 'data/runtime');
}

function resolveOptions(options = {}) {
  const runtimeDir = options.runtimeDir || defaultRuntimeDir();
  return {
    host: options.host || '127.0.0.1',
    port: Number(options.port || process.env.PORT || 17531),
    runtimeDir,
    dataDir: options.dataDir || path.join(PROJECT_ROOT, 'data'),
    agentToken: options.agentToken ?? '',
    agentTokenPath: options.agentTokenPath || '',
    allowLegacySubmission: options.allowLegacySubmission === true,
    detached: options.detached !== false,
    ownerKind: String(options.ownerKind || (options.detached === false ? 'test' : 'product')),
    pidFile: options.pidFile || path.join(runtimeDir, 'bridge.pid'),
    logFile: options.logFile || path.join(runtimeDir, 'bridge.log')
  };
}

async function readPidRecord(pidFile) {
  try {
    const raw = await readFile(pidFile, 'utf8');
    try {
      const record = JSON.parse(raw);
      const pid = Number(record?.pid);
      return Number.isInteger(pid) && pid > 0
        ? { pid, host: String(record.host || ''), port: Number(record.port) || 0 }
        : { pid: 0, host: '', port: 0 };
    } catch {
      const pid = Number(raw.trim());
      return { pid: Number.isInteger(pid) && pid > 0 ? pid : 0, host: '', port: 0 };
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

export function findListeningPids(port) {
  try {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8'
    });
    if (result.error || result.status !== 0) return [];
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
  let health = null;

  if (managedProcessAlive) {
    try {
      health = await waitForHealth(resolved, 1000);
      if (health?.port && Number(health.port) !== resolved.port) health = null;
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
  const managed = managedProcessAlive && Boolean(health?.ok);
  const listenerPids = probeUnmanaged ? findListeningPids(resolved.port) : [];

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
    logFile: resolved.logFile
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
  const child = spawn(process.execPath, ['src/bridge/server.mjs'], {
    cwd: PROJECT_ROOT,
    detached: resolved.detached,
    env: {
      ...process.env,
      HOST: resolved.host,
      PORT: String(resolved.port),
      DATA_DIR: resolved.dataDir,
      WPS_REVIEWER_OWNER_KIND: resolved.ownerKind,
      WPS_REVIEWER_AGENT_TOKEN: resolved.agentToken,
      WPS_REVIEWER_AGENT_TOKEN_FILE: resolved.agentTokenPath,
      WPS_REVIEWER_ALLOW_LEGACY_SUBMIT: resolved.allowLegacySubmission ? '1' : '0'
    },
    stdio: ['ignore', logFd, logFd]
  });

  await writeFile(resolved.pidFile, `${JSON.stringify({
    pid: child.pid,
    host: resolved.host,
    port: resolved.port,
    projectRoot: PROJECT_ROOT,
    dataDir: resolved.dataDir,
    ownerKind: resolved.ownerKind,
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

  process.kill(pid, 'SIGTERM');
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (!isProcessAlive(pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (isProcessAlive(pid)) {
    process.kill(pid, 'SIGKILL');
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
