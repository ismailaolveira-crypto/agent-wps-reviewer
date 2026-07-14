#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { prepareForegroundAcceptance } from '../src/acceptance/foregroundPrep.mjs';
import { stopBridge } from '../src/bridge/processControl.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wps-foreground-prep-'));
const port = await getFreePort();
const bridgeOptions = {
  runtimeDir: path.join(tempDir, 'runtime'),
  dataDir: path.join(tempDir, 'data'),
  pidFile: path.join(tempDir, 'runtime/bridge.pid'),
  logFile: path.join(tempDir, 'runtime/bridge.log')
};

try {
  const result = await prepareForegroundAcceptance({
    jsaddonsDir: path.join(tempDir, 'jsaddons'),
    kitOutputDir: path.join(tempDir, 'acceptance-kit'),
    port,
    backup: false,
    checkInstalledUrls: false,
    bridgeOptions
  });
  const stopped = await stopBridge({ ...bridgeOptions, port });
  const output = {
    ...result,
    stopped,
    tempDir,
    ok: result.ok === true && stopped.running === false
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exitCode = 1;
  }
} finally {
  await stopBridge({ ...bridgeOptions, port }).catch(() => undefined);
  await rm(tempDir, { recursive: true, force: true });
}
