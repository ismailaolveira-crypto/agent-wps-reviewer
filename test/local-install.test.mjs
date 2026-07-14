import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installLocalProduct } from '../src/install/localInstall.mjs';
import { statusBridge, stopBridge } from '../src/bridge/processControl.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('installLocalProduct installs config and verifies local resources without leaving bridge running', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-local-install-test-'));
  const port = await getFreePort();
  const bridgeOptions = {
    port,
    detached: false,
    ownerKind: 'test',
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'data'),
    agentTokenPath: path.join(dir, 'agent-token'),
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };

  try {
    const result = await installLocalProduct({
      jsaddonsDir: path.join(dir, 'jsaddons'),
      port,
      backup: false,
      runReadiness: true,
      checkInstalledUrls: false,
      skillTargetRoots: [path.join(dir, 'agent-skills')],
      bridgeOptions
    });

    assert.equal(result.ok, true);
    assert.equal(result.config.installed, true);
    assert.equal(result.skill.ok, true);
    assert.deepEqual(result.skill.skills, ['whitepaper-chief-editor']);
    assert.equal(result.skill.installations[0].path, path.join(dir, 'agent-skills', 'whitepaper-chief-editor'));
    assert.deepEqual(result.skill.internalSkills, [{
      name: 'whitepaper-wps-reviewer',
      target: 'whitepaper-chief-editor/references/executors/whitepaper-wps-reviewer'
    }]);
    assert.equal(result.readiness.ok, true);
    assert.match(result.pluginUrl, new RegExp(`:${port}/WpsAgentReviewer/$`));
    assert.equal(Object.hasOwn(result.agentToken, 'token'), false);

    const status = await statusBridge({ ...bridgeOptions, port });
    assert.equal(status.running, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installLocalProduct can install the production Skill set and keep a persistent bridge running', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-local-setup-test-'));
  const port = await getFreePort();
  const bridgeOptions = {
    port,
    detached: false,
    ownerKind: 'test',
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'data'),
    agentTokenPath: path.join(dir, 'agent-token'),
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };

  try {
    const result = await installLocalProduct({
      jsaddonsDir: path.join(dir, 'jsaddons'),
      port,
      backup: false,
      runReadiness: false,
      startBridgeAfterInstall: true,
      configureLaunchAgent: true,
      launchAgentOptions: {
        launchAgentsDir: path.join(dir, 'LaunchAgents'),
        projectRoot: path.resolve('.'),
        dataDir: path.join(dir, 'data'),
        pidFile: path.join(dir, 'runtime/bridge.pid')
      },
      checkInstalledUrls: false,
      skillTargetRoots: [path.join(dir, 'agent-skills')],
      bridgeOptions
    });

    assert.equal(result.ok, true);
    assert.equal(result.skill.skills.includes('whitepaper-chief-editor'), true);
    assert.equal(result.bridge.running, true);
    assert.equal(result.readiness.mode, 'persistent-bridge');
    assert.equal(result.readiness.ok, true);
    assert.equal(result.launchAgent.status.exists, true);
    assert.equal(result.launchAgent.status.label, 'com.agent-wps-reviewer.bridge');
  } finally {
    await stopBridge(bridgeOptions);
    await rm(dir, { recursive: true, force: true });
  }
});

test('product setup re-enables only a disabled Agent WPS auth entry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-local-auth-repair-'));
  const port = await getFreePort();
  const jsaddonsDir = path.join(dir, 'jsaddons');
  const pluginUrl = `http://127.0.0.1:${port}/WpsAgentReviewer/`;
  const bridgeOptions = {
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'data'),
    agentTokenPath: path.join(dir, 'agent-token'),
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };

  try {
    await mkdir(jsaddonsDir, { recursive: true });
    await writeFile(path.join(jsaddonsDir, 'authaddin.json'), JSON.stringify({
      wps: {
        agentReviewer: {
          name: 'WpsAgentReviewer',
          path: pluginUrl,
          enable: false,
          isload: false
        },
        otherPlugin: { name: 'OtherPlugin', path: 'http://127.0.0.1:9/other', enable: false }
      }
    }));

    const result = await installLocalProduct({
      jsaddonsDir,
      pluginUrl,
      port,
      backup: false,
      runReadiness: false,
      skillTargetRoots: [path.join(dir, 'agent-skills')],
      bridgeOptions
    });
    const auth = JSON.parse(await readFile(path.join(jsaddonsDir, 'authaddin.json'), 'utf8'));

    assert.equal(result.ok, true);
    assert.equal(result.authorization.authorized, true);
    assert.equal(auth.wps.agentReviewer.enable, true);
    assert.equal(auth.wps.otherPlugin.enable, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installLocalProduct rolls back local files and token when MCP setup fails', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-local-install-rollback-'));
  const port = await getFreePort();
  const jsaddonsDir = path.join(dir, 'jsaddons');
  const skillRoot = path.join(dir, 'agent-skills');
  const tokenPath = path.join(dir, 'agent-token');
  const bridgeOptions = {
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'data'),
    agentTokenPath: tokenPath,
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };
  const originalPlugins = '<jsplugins>\n  <jspluginonline name="OtherPlugin" type="wps" url="http://127.0.0.1:9/other"/>\n</jsplugins>\n';

  try {
    await mkdir(jsaddonsDir, { recursive: true });
    await writeFile(path.join(jsaddonsDir, 'jsplugins.xml'), originalPlugins);

    await assert.rejects(
      installLocalProduct({
        jsaddonsDir,
        port,
        backup: false,
        runReadiness: false,
        skillTargetRoots: [skillRoot],
        bridgeOptions,
        configureMcp: true,
        mcpOptions: {
          cliPaths: { codex: 'codex-test', claude: 'claude-test' },
          runner: async ({ args }) => args[1] === 'get'
            ? { code: 0, error: null, stdout: '', stderr: '' }
            : args[1] === 'remove'
              ? { code: 0, error: null, stdout: '', stderr: '' }
              : { code: 1, error: null, stdout: '', stderr: 'simulated add failure' }
        }
      }),
      (error) => error.code === 'MCP_CONFIG_FAILED'
    );

    assert.equal(await readFile(path.join(jsaddonsDir, 'jsplugins.xml'), 'utf8'), originalPlugins);
    await assert.rejects(access(path.join(jsaddonsDir, 'publish.xml')));
    await assert.rejects(access(path.join(skillRoot, 'whitepaper-wps-reviewer')));
    await assert.rejects(access(path.join(skillRoot, 'whitepaper-chief-editor')));
    await assert.rejects(access(tokenPath));
    const bridge = await statusBridge({ ...bridgeOptions, port });
    assert.equal(bridge.running, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
