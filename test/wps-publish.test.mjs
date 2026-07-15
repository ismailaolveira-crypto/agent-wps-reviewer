import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WPSJS_VERSION, buildWpsPublishCommand, inspectWpsPublishArtifacts, runWpsPublish } from '../src/wps/publish.mjs';

test('WPS publish builder pins the expected tool version and keeps trust separate', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-publish-'));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'publish.html'), '<html></html>');
    await writeFile(path.join(dir, 'publish.xml'), '<jsplugins></jsplugins>');
    const command = buildWpsPublishCommand({ command: 'wpsjs.cmd', outputDir: dir, platform: 'win32' });
    assert.equal(command.expectedVersion, WPSJS_VERSION);
    assert.deepEqual(command.args, ['publish', '--output', dir]);
    const result = runWpsPublish({
      command: 'wpsjs.cmd',
      outputDir: dir,
      platform: 'win32',
      runner: () => ({ code: 0, stdout: 'published', stderr: '', error: null })
    });
    assert.equal(result.ok, true);
    assert.equal(result.trustPending, true);
    assert.equal(result.trusted, false);
    assert.equal(inspectWpsPublishArtifacts({ outputDir: dir }).publishReady, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
