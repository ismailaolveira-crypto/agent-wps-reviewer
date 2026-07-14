import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareForegroundAcceptance } from '../src/acceptance/foregroundPrep.mjs';
import { statusBridge, stopBridge } from '../src/bridge/processControl.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('prepareForegroundAcceptance creates kit, starts bridge, installs config, and submits sample', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-foreground-prep-test-'));
  const port = await getFreePort();
  const bridgeOptions = {
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'data'),
    agentTokenPath: path.join(dir, 'agent-token'),
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };

  try {
    const result = await prepareForegroundAcceptance({
      jsaddonsDir: path.join(dir, 'jsaddons'),
      kitOutputDir: path.join(dir, 'acceptance-kit'),
      port,
      bridgeOptions,
      backup: false,
      checkInstalledUrls: false
    });

    assert.equal(result.ok, true);
    assert.equal(result.bridge.running, true);
    assert.equal(result.installer.config.installed, true);
    assert.equal(result.kit.ok, true);
    assert.equal(result.sample.suggestions.length, 1);
    assert.match(result.pluginUrl, new RegExp(`:${port}/WpsAgentReviewer/$`));

    const token = await readFile(result.installer.agentToken.tokenPath, 'utf8');
    const listed = await fetch(`http://127.0.0.1:${port}/api/suggestions?docSessionId=default`, {
      headers: { authorization: `Bearer ${token.trim()}` }
    }).then((response) => response.json());
    assert.equal(listed.suggestions.length, 1);

    const status = await statusBridge({ ...bridgeOptions, port });
    assert.equal(status.running, true);
  } finally {
    await stopBridge({ ...bridgeOptions, port }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
