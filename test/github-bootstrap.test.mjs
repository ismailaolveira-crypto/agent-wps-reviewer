import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFile = promisify(execFileCallback);

test('public bootstrap files connect GitHub download verification to unified setup', async () => {
  const mac = await readFile(path.resolve('install-from-github.command'), 'utf8');
  const windows = await readFile(path.resolve('install-from-github.ps1'), 'utf8');
  for (const marker of ['download-latest-release.mjs', '--platform macos', 'setup.command', 'sha256']) {
    assert.match(mac.toLowerCase(), new RegExp(marker.replaceAll('.', '\\.'), 'u'));
  }
  for (const marker of ['download-latest-release.mjs', '--platform windows', 'setup.cmd', 'sha256']) {
    assert.match(windows.toLowerCase(), new RegExp(marker.replaceAll('.', '\\.'), 'u'));
  }
  assert.doesNotMatch(mac, /eval\s/u);
  assert.doesNotMatch(windows, /Invoke-Expression|\biex\b/iu);
});

test('macOS GitHub bootstrap downloads an injected verified ZIP and runs its only setup entry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-wps-github-bootstrap-'));
  const fixture = path.join(root, 'fixture');
  const downloadDir = path.join(root, 'install', 'downloads', 'v-test');
  const zipPath = path.join(downloadDir, 'agent-wps-reviewer-test-macos.zip');
  const fetcher = path.join(root, 'fake-fetcher.mjs');
  const marker = path.join(root, 'setup-ran.txt');
  await mkdir(fixture, { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  const setup = path.join(fixture, 'setup.command');
  await writeFile(setup, '#!/bin/bash\nprintf "configured" > "$AGENT_WPS_BOOTSTRAP_TEST_MARKER"\n');
  await chmod(setup, 0o755);
  await execFile('zip', ['-q', zipPath, 'setup.command'], { cwd: fixture });
  await writeFile(fetcher, `console.log(JSON.stringify({ok:true,tag:"v-test",zipPath:${JSON.stringify(zipPath)},sha256:"${'a'.repeat(64)}"}));\n`);

  const result = await execFile('/bin/bash', [path.resolve('install-from-github.command')], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      HOME: root,
      AGENT_WPS_INSTALL_ROOT: path.join(root, 'install'),
      AGENT_WPS_FETCHER_PATH: fetcher,
      AGENT_WPS_BOOTSTRAP_TEST_MARKER: marker
    },
    timeout: 10000
  });
  assert.match(result.stdout, /校验通过：v-test/);
  assert.match(result.stdout, /一键安装完成/);
  assert.equal(await readFile(marker, 'utf8'), 'configured');
});
