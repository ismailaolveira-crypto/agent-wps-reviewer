import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateDefaultPortReadiness } from '../src/acceptance/defaultPortReadiness.mjs';
import { statusBridge } from '../src/bridge/processControl.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('validateDefaultPortReadiness starts, checks, and stops a bridge it owns', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wps-default-readiness-'));
  const port = await getFreePort();
  const options = {
    port,
    runtimeDir,
    dataDir: path.join(runtimeDir, 'data'),
    pidFile: path.join(runtimeDir, 'bridge.pid'),
    logFile: path.join(runtimeDir, 'bridge.log'),
    checkInstalledUrls: false
  };

  try {
    const result = await validateDefaultPortReadiness(options);
    assert.equal(result.ok, true);
    assert.equal(result.startedByCheck, true);
    assert.equal(result.resources.ok, true);

    const after = await statusBridge(options);
    assert.equal(after.running, false);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
