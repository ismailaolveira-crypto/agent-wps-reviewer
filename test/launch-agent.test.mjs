import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_AGENT_LABEL,
  buildLaunchAgentPlist,
  installLaunchAgent,
  readLaunchAgentStatus,
  uninstallLaunchAgent
} from '../src/install/launchAgent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

test('buildLaunchAgentPlist describes the local bridge without launchctl side effects', () => {
  const plist = buildLaunchAgentPlist({
    projectRoot: '/tmp/agent-wps-reviewer',
    nodePath: '/usr/local/bin/node',
    host: '127.0.0.1',
    port: 17531,
    dataDir: '/tmp/agent-wps-reviewer/data',
    stdoutPath: '/tmp/agent-wps-reviewer/data/runtime/launch-agent.out.log',
    stderrPath: '/tmp/agent-wps-reviewer/data/runtime/launch-agent.err.log',
    agentToken: 'internal-token'
  });

  assert.match(plist, new RegExp(`<string>${DEFAULT_LAUNCH_AGENT_LABEL}</string>`));
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>src\/bridge\/server\.mjs<\/string>/);
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/tmp\/agent-wps-reviewer<\/string>/);
  assert.match(plist, /<key>HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(plist, /<key>PORT<\/key>\s*<string>17531<\/string>/);
  assert.match(plist, /<key>DATA_DIR<\/key>\s*<string>\/tmp\/agent-wps-reviewer\/data<\/string>/);
  assert.match(plist, /<key>WPS_REVIEWER_PID_FILE<\/key>\s*<string>\/tmp\/agent-wps-reviewer\/data\/runtime\/bridge\.pid<\/string>/);
  assert.match(plist, /<key>WPS_REVIEWER_AGENT_TOKEN<\/key>\s*<string>internal-token<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test('launch-agent bridge writes a managed pid file and removes it on shutdown', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-launch-agent-runtime-'));
  const port = 18003;
  const pidFile = path.join(dir, 'runtime/bridge.pid');
  const child = spawn(process.execPath, ['src/bridge/server.mjs'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: path.join(dir, 'data'),
      WPS_REVIEWER_PID_FILE: pidFile,
      WPS_REVIEWER_AGENT_TOKEN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) break;
      } catch {
        // Wait for the detached-style entry point to bind.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const record = JSON.parse(await readFile(pidFile, 'utf8'));
    assert.equal(record.pid, child.pid);
    assert.equal(record.port, port);
    assert.match(record.runtimeInstanceId, /^[0-9a-f-]{36}$/i);
    assert.equal(typeof record.buildFingerprint, 'string');

    child.kill('SIGTERM');
    await once(child, 'exit');
    await assert.rejects(access(pidFile));
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});

test('installLaunchAgent rollback restores the previous plist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-launch-agent-rollback-'));
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  const plistPath = path.join(launchAgentsDir, `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`);
  const previous = '<plist><string>previous</string></plist>\n';

  try {
    await installLaunchAgent({ launchAgentsDir, plistPath, projectRoot: PROJECT_ROOT });
    await import('node:fs/promises').then(({ writeFile }) => writeFile(plistPath, previous));
    const installed = await installLaunchAgent({ launchAgentsDir, plistPath, projectRoot: PROJECT_ROOT, port: 18004 });
    await installed.rollback();
    assert.equal(await readFile(plistPath, 'utf8'), previous);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installLaunchAgent writes only the requested plist path and uninstall removes it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-launch-agent-test-'));
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  const projectRoot = path.join(dir, 'project');

  try {
    const installed = await installLaunchAgent({
      launchAgentsDir,
      projectRoot,
      nodePath: process.execPath,
      port: 18001,
      host: '127.0.0.1',
      dataDir: path.join(dir, 'data'),
      agentToken: ''
    });

    assert.equal(installed.ok, true);
    assert.equal(installed.loaded, false);
    assert.equal(installed.status.exists, true);
    assert.equal(installed.status.label, DEFAULT_LAUNCH_AGENT_LABEL);
    assert.equal(installed.status.containsLaunchctlInstruction, false);

    const plistText = await readFile(installed.plistPath, 'utf8');
    assert.match(plistText, /<key>PORT<\/key>\s*<string>18001<\/string>/);
    assert.doesNotMatch(plistText, /launchctl/);

    const status = await readLaunchAgentStatus({ plistPath: installed.plistPath });
    assert.equal(status.exists, true);
    assert.equal(status.label, DEFAULT_LAUNCH_AGENT_LABEL);

    const removed = await uninstallLaunchAgent({ plistPath: installed.plistPath });
    assert.equal(removed.ok, true);
    assert.equal(removed.status.exists, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate-launch-agent script uses a temporary LaunchAgents directory', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-launch-agent.mjs'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.installed.loaded, false);
  assert.equal(parsed.installed.status.exists, true);
  assert.equal(parsed.uninstalled.status.exists, false);
});

test('install-launch-agent CLI only writes and removes the requested plist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-launch-agent-cli-test-'));
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  const projectRoot = path.join(dir, 'project');

  try {
    const install = spawnSync(
      process.execPath,
      [
        'scripts/install-launch-agent.mjs',
        'install',
        '--dir',
        launchAgentsDir,
        '--project-root',
        projectRoot,
        '--port',
        '18002'
      ],
      { cwd: PROJECT_ROOT, encoding: 'utf8' }
    );
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const installed = JSON.parse(install.stdout);
    assert.equal(installed.ok, true);
    assert.equal(installed.loaded, false);
    assert.equal(installed.status.exists, true);

    const status = spawnSync(process.execPath, ['scripts/install-launch-agent.mjs', 'status', '--dir', launchAgentsDir], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    assert.equal(status.status, 0, status.stderr || status.stdout);
    const statusJson = JSON.parse(status.stdout);
    assert.equal(statusJson.exists, true);

    const uninstall = spawnSync(process.execPath, ['scripts/install-launch-agent.mjs', 'uninstall', '--dir', launchAgentsDir], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
    const removed = JSON.parse(uninstall.stdout);
    assert.equal(removed.ok, true);
    assert.equal(removed.status.exists, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
