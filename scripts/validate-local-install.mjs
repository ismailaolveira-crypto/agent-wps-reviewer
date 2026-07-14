#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { installLocalProduct } from '../src/install/localInstall.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wps-local-install-'));

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

try {
  const port = await getFreePort();
  const result = await installLocalProduct({
    jsaddonsDir: path.join(tempDir, 'jsaddons'),
    port,
    backup: false,
    skillTargetRoots: [path.join(tempDir, 'agent-skills')],
    runReadiness: true,
    bridgeOptions: {
      runtimeDir: path.join(tempDir, 'runtime'),
      dataDir: path.join(tempDir, 'data'),
      pidFile: path.join(tempDir, 'runtime/bridge.pid'),
      logFile: path.join(tempDir, 'runtime/bridge.log')
    }
  });

  console.log(JSON.stringify({ ...result, tempDir }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
