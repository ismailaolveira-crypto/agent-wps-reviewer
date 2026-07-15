import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { startBridge, statusBridge, stopBridge } from '../bridge/processControl.mjs';
import { smokeWpsResourcesAtBaseUrl } from './resourceSmoke.mjs';
import { checkUrlConsistency } from './urlConsistency.mjs';

async function readBridgeHealth(baseUrl) {
  try {
    const response = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    if (response.ok && body.ok === true) return body;
  } catch {
    // A missing listener is handled by starting a temporary bridge below.
  }
  return null;
}

export async function validateDefaultPortReadiness({
  host = '127.0.0.1',
  port = 17531,
  runtimeDir = '',
  dataDir = '',
  pidFile = '',
  logFile = '',
  jsaddonsDir = undefined,
  pluginUrl = undefined,
  checkInstalledUrls = true,
  platform = process.platform
} = {}) {
  const ownedRuntimeDir = runtimeDir || (await mkdtemp(path.join(os.tmpdir(), 'wps-default-port-')));
  const options = {
    host,
    port,
    runtimeDir: ownedRuntimeDir,
    dataDir: dataDir || path.join(ownedRuntimeDir, 'data'),
    pidFile: pidFile || path.join(ownedRuntimeDir, 'bridge.pid'),
    logFile: logFile || path.join(ownedRuntimeDir, 'bridge.log'),
    platform
  };

  let startedByCheck = false;
  let started = null;
  let resources = null;
  let urls = null;

  try {
    const baseUrl = `http://${host}:${port}`;
    const existingHealth = await readBridgeHealth(baseUrl);
    const before = await statusBridge(options);
    if (existingHealth) {
      started = {
        running: true,
        changed: false,
        pid: before.pid,
        health: existingHealth
      };
    } else if (before.running && before.health?.ok) {
      started = { ...before, changed: false };
    } else {
      started = await startBridge(options);
      startedByCheck = started.changed === true;
    }

    resources = await smokeWpsResourcesAtBaseUrl(baseUrl);
    urls = checkInstalledUrls
      ? await checkUrlConsistency({ jsaddonsDir, pluginUrl, platform })
      : { ok: true, skipped: true };

    return {
      ok: started.running === true && resources.ok === true && urls.ok === true,
      host,
      port,
      baseUrl,
      startedByCheck,
      bridge: {
        running: started.running,
        changed: started.changed,
        pid: started.pid,
        health: started.health
      },
      resources,
      urlConsistency: urls
    };
  } finally {
    if (startedByCheck) {
      await stopBridge(options).catch(() => undefined);
    }
    if (!runtimeDir) {
      await rm(ownedRuntimeDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
