import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startBridge, statusBridge, stopBridge } from '../src/bridge/processControl.mjs';
import { ensureAgentToken } from '../src/install/agentToken.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('process control starts, detects, and stops a detached bridge', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-process-'));
  const port = await getFreePort();
  const options = {
    port,
    runtimeDir,
    dataDir: path.join(runtimeDir, 'data'),
    pidFile: path.join(runtimeDir, 'bridge.pid'),
    logFile: path.join(runtimeDir, 'bridge.log')
  };

  try {
    const started = await startBridge(options);
    assert.equal(started.running, true);
    assert.equal(started.port, port);
    assert.ok(started.pid > 0);

    const status = await statusBridge(options);
    assert.equal(status.running, true);
    assert.equal(status.health.ok, true);

    const secondStart = await startBridge(options);
    assert.equal(secondStart.running, true);
    assert.equal(secondStart.changed, false);

    const stopped = await stopBridge(options);
    assert.equal(stopped.running, false);
  } finally {
    await stopBridge(options).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('detached bridge reads the configured token file for protected agent routes', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-process-token-'));
  const port = await getFreePort();
  const tokenPath = path.join(runtimeDir, 'agent-token');
  const token = await ensureAgentToken({ tokenPath });
  const options = {
    port,
    runtimeDir,
    dataDir: path.join(runtimeDir, 'data'),
    agentTokenPath: tokenPath,
    pidFile: path.join(runtimeDir, 'bridge.pid'),
    logFile: path.join(runtimeDir, 'bridge.log')
  };

  try {
    await startBridge(options);
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/agent/documents`);
    const authorized = await fetch(`http://127.0.0.1:${port}/api/agent/documents`, {
      headers: { authorization: `Bearer ${token.token}` }
    });

    assert.equal(unauthorized.status, 401);
    assert.equal(authorized.status, 200);
  } finally {
    await stopBridge(options).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('process status does not trust a pid file recorded for another port', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-process-mismatch-'));
  const pidFile = path.join(runtimeDir, 'bridge.pid');

  try {
    await writeFile(pidFile, JSON.stringify({ pid: process.pid, host: '127.0.0.1', port: 19999 }));
    const status = await statusBridge({
      port: 20000,
      runtimeDir,
      pidFile,
      logFile: path.join(runtimeDir, 'bridge.log')
    });

    assert.equal(status.running, false);
    assert.equal(status.pidFileMatchesTarget, false);
    assert.equal(status.pid, process.pid);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('process status detects an unmanaged listener without claiming ownership', async () => {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'agent-wps-reviewer' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-process-unmanaged-'));

  try {
    const status = await statusBridge({
      port,
      runtimeDir,
      pidFile: path.join(runtimeDir, 'missing.pid'),
      logFile: path.join(runtimeDir, 'bridge.log'),
      probeUnmanaged: true
    });

    assert.equal(status.running, true);
    assert.equal(status.managed, false);
    assert.ok(Array.isArray(status.listenerPids));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('managed bridge can be stopped and started again with the same runtime directory', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-process-restart-'));
  const port = await getFreePort();
  const options = {
    port,
    runtimeDir,
    dataDir: path.join(runtimeDir, 'data'),
    pidFile: path.join(runtimeDir, 'bridge.pid'),
    logFile: path.join(runtimeDir, 'bridge.log')
  };

  try {
    const first = await startBridge(options);
    assert.equal(first.running, true);
    await stopBridge(options);
    assert.equal((await statusBridge(options)).running, false);
    const second = await startBridge(options);
    assert.equal(second.running, true);
    assert.equal((await statusBridge(options)).health.ok, true);
  } finally {
    await stopBridge(options).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
