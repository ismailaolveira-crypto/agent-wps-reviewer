#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLaunchAgent, uninstallLaunchAgent } from '../src/install/launchAgent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wps-launch-agent-'));

try {
  const launchAgentsDir = path.join(tempDir, 'LaunchAgents');
  const dataDir = path.join(tempDir, 'data');
  const installed = await installLaunchAgent({
    launchAgentsDir,
    projectRoot: PROJECT_ROOT,
    dataDir,
    stdoutPath: path.join(tempDir, 'runtime/launch-agent.out.log'),
    stderrPath: path.join(tempDir, 'runtime/launch-agent.err.log')
  });
  const uninstalled = await uninstallLaunchAgent({ plistPath: installed.plistPath });
  const result = {
    ok:
      installed.ok === true &&
      installed.loaded === false &&
      installed.status.exists === true &&
      uninstalled.ok === true &&
      uninstalled.status.exists === false,
    tempDir,
    installed,
    uninstalled
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
