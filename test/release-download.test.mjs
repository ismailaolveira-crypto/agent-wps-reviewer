import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { downloadLatestRelease, selectLatestRelease, selectPlatformAssets } from '../scripts/download-latest-release.mjs';

const execFile = promisify(execFileCallback);

test('release downloader selects the newest published release and platform assets', () => {
  const selected = selectLatestRelease([
    { tag_name: 'old', published_at: '2026-01-01T00:00:00Z', assets: [] },
    { tag_name: 'draft', draft: true, published_at: '2026-03-01T00:00:00Z', assets: [] },
    { tag_name: 'newer-without-macos', published_at: '2026-02-02T00:00:00Z', assets: [
      { name: 'agent-wps-reviewer-0.2.1-windows-x64.zip' },
      { name: 'agent-wps-reviewer-0.2.1-windows-x64-manifest.json' }
    ] },
    { tag_name: 'new', prerelease: true, published_at: '2026-02-01T00:00:00Z', assets: [
      { name: 'agent-wps-reviewer-0.2.1-macos.zip' },
      { name: 'agent-wps-reviewer-0.2.1-macos-manifest.json' }
    ] }
  ], 'macos');
  assert.equal(selected.tag_name, 'new');
  assert.equal(selectPlatformAssets(selected, 'macos').suffix, 'macos');
});

test('release downloader works without GitHub authentication and verifies SHA-256', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'wps-release-download-'));
  const zipBytes = Buffer.from('verified release bytes');
  const sha256 = createHash('sha256').update(zipBytes).digest('hex');
  const release = {
    tag_name: 'v0.2.1-beta.1',
    published_at: '2026-08-08T00:00:00Z',
    assets: [
      { name: 'agent-wps-reviewer-0.2.1-macos.zip', url: 'https://api.example.test/assets/zip', browser_download_url: 'https://example.test/macos.zip' },
      { name: 'agent-wps-reviewer-0.2.1-macos-manifest.json', url: 'https://api.example.test/assets/manifest', browser_download_url: 'https://example.test/macos-manifest.json' }
    ]
  };
  const manifest = {
    platform: 'macos',
    zip: 'agent-wps-reviewer-0.2.1-macos.zip',
    sha256
  };
  const requests = [];
  let zipAttempts = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/releases?')) return new Response(JSON.stringify([release]));
    if (url.endsWith('/manifest')) return new Response(JSON.stringify(manifest));
    zipAttempts += 1;
    if (zipAttempts === 1) throw new Error('temporary network failure');
    return new Response(zipBytes);
  };

  try {
    const result = await downloadLatestRelease({
      platform: 'macos',
      outputDir,
      fetchImpl,
      token: '',
      retryDelayMs: 0
    });
    assert.equal(result.ok, true);
    assert.equal(result.sha256, sha256);
    assert.deepEqual(await readFile(result.zipPath), zipBytes);
    assert.equal(requests.some((request) => request.options.headers.authorization), false);
    assert.equal(requests.some((request) => request.url.startsWith('https://github.com/')), false);
    assert.equal(requests.filter((request) => request.url.includes('/assets/')).every((request) => request.options.headers.accept === 'application/octet-stream'), true);
    assert.equal(zipAttempts, 2);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('release downloader CLI runs when invoked through a symlinked temporary path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-release-cli-'));
  const linkedScript = path.join(root, 'download.mjs');
  await symlink(path.resolve('scripts/download-latest-release.mjs'), linkedScript);
  try {
    await assert.rejects(
      execFile(process.execPath, [linkedScript, '--platform', 'unsupported'], { timeout: 5000 }),
      /Unsupported platform: unsupported/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
