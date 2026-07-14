import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { authorizePluginAuthFile, readPluginAuthStatus } from '../src/wps/pluginAuth.mjs';

async function writeAuthFile(jsaddonsDir, enable = false) {
  await mkdir(jsaddonsDir, { recursive: true });
  await writeFile(
    path.join(jsaddonsDir, 'authaddin.json'),
    JSON.stringify(
      {
        wps: {
          agentKey: {
            enable,
            isload: true,
            mode: 2,
            name: 'WpsAgentReviewer',
            path: 'http://127.0.0.1:17531/WpsAgentReviewer'
          },
          namelist: 'agentKey'
        }
      },
      null,
      4
    )
  );
}

test('readPluginAuthStatus reports a disabled matching WPS add-in', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-plugin-auth-'));
  try {
    await writeAuthFile(dir, false);
    const status = await readPluginAuthStatus({ jsaddonsDir: dir });

    assert.equal(status.exists, true);
    assert.equal(status.matchedCount, 1);
    assert.equal(status.authorized, false);
    assert.equal(status.disabled, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('authorizePluginAuthFile enables the matching WPS add-in', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-plugin-auth-'));
  try {
    await writeAuthFile(dir, false);
    const result = await authorizePluginAuthFile({ jsaddonsDir: dir });
    const raw = await readFile(path.join(dir, 'authaddin.json'), 'utf8');
    const parsed = JSON.parse(raw);

    assert.equal(result.changed, true);
    assert.equal(result.authorized, true);
    assert.equal(parsed.wps.agentKey.enable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('authorizePluginAuthFile reports unknown before WPS creates authaddin.json', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-plugin-auth-'));
  try {
    const result = await authorizePluginAuthFile({ jsaddonsDir: dir });

    assert.equal(result.exists, false);
    assert.equal(result.changed, false);
    assert.equal(result.authorized, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupt authaddin.json is reported and never silently repaired', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-plugin-auth-corrupt-'));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'authaddin.json'), '{not-json');

    const status = await readPluginAuthStatus({ jsaddonsDir: dir });
    assert.equal(status.valid, false);
    assert.equal(status.error, 'invalid-json');
    await assert.rejects(
      authorizePluginAuthFile({ jsaddonsDir: dir }),
      (error) => error.code === 'WPS_AUTH_INVALID'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
