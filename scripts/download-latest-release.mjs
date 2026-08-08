#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY = 'ismailaolveira-crypto/agent-wps-reviewer';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--platform' && argv[index + 1]) args.platform = argv[++index];
    else if (argv[index] === '--dir' && argv[index + 1]) args.outputDir = argv[++index];
    else if (argv[index] === '--repo' && argv[index + 1]) args.repository = argv[++index];
  }
  return args;
}

export function selectLatestRelease(releases = [], platform = '') {
  return releases
    .filter((release) => {
      if (!release || release.draft === true || !Array.isArray(release.assets)) return false;
      if (!platform) return true;
      try {
        selectPlatformAssets(release, platform);
        return true;
      } catch {
        return false;
      }
    })
    .sort((left, right) => String(right.published_at || right.created_at || '').localeCompare(String(left.published_at || left.created_at || '')))[0] || null;
}

export function selectPlatformAssets(release, platform) {
  const suffix = platform === 'windows' ? 'windows-x64' : platform === 'macos' ? 'macos' : '';
  if (!suffix) throw new Error(`Unsupported platform: ${platform}`);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zip = assets.find((asset) => String(asset.name || '').endsWith(`-${suffix}.zip`));
  const manifest = assets.find((asset) => String(asset.name || '').endsWith(`-${suffix}-manifest.json`));
  if (!zip || !manifest) throw new Error(`Release ${release?.tag_name || ''} is missing ${suffix} assets`);
  return { zip, manifest, suffix };
}

async function fetchOrThrow(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}

async function fetchBody(fetchImpl, url, headers, read, { attempts = 3, retryDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read(await fetchOrThrow(fetchImpl, url, headers));
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (2 ** (attempt - 1))));
      }
    }
  }
  throw new Error(`Download failed after ${attempts} attempts: ${url}: ${lastError?.message || 'unknown error'}`, {
    cause: lastError
  });
}

export async function downloadLatestRelease({
  platform = process.platform === 'win32' ? 'windows' : 'macos',
  outputDir = path.resolve('downloads'),
  repository = DEFAULT_REPOSITORY,
  token = process.env.GITHUB_TOKEN || '',
  fetchImpl = fetch,
  retryAttempts = 3,
  retryDelayMs = 500
} = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'agent-wps-reviewer-release-downloader',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
  const releases = await fetchBody(
    fetchImpl,
    `https://api.github.com/repos/${repository}/releases?per_page=20`,
    headers,
    (response) => response.json(),
    { attempts: retryAttempts, retryDelayMs }
  );
  const release = selectLatestRelease(releases, platform);
  if (!release) throw new Error(`No published GitHub release with ${platform} assets was found`);
  const assets = selectPlatformAssets(release, platform);
  const releaseDir = path.resolve(outputDir, release.tag_name);
  await mkdir(releaseDir, { recursive: true });

  const manifestText = await fetchBody(
    fetchImpl,
    assets.manifest.browser_download_url,
    headers,
    (response) => response.text(),
    { attempts: retryAttempts, retryDelayMs }
  );
  const manifest = JSON.parse(manifestText);
  if (manifest.platform !== platform) throw new Error(`Manifest platform mismatch: expected ${platform}`);
  if (manifest.zip !== assets.zip.name) throw new Error('Manifest ZIP name does not match the selected asset');

  const zipBytes = Buffer.from(await fetchBody(
    fetchImpl,
    assets.zip.browser_download_url,
    headers,
    (response) => response.arrayBuffer(),
    { attempts: retryAttempts, retryDelayMs }
  ));
  const actualHash = createHash('sha256').update(zipBytes).digest('hex');
  if (actualHash !== String(manifest.sha256 || '').toLowerCase()) {
    throw new Error(`SHA-256 mismatch: expected ${manifest.sha256}, received ${actualHash}`);
  }

  const zipPath = path.join(releaseDir, assets.zip.name);
  const manifestPath = path.join(releaseDir, assets.manifest.name);
  const zipTemp = `${zipPath}.${process.pid}.tmp`;
  const manifestTemp = `${manifestPath}.${process.pid}.tmp`;
  try {
    await writeFile(zipTemp, zipBytes);
    await writeFile(manifestTemp, manifestText, 'utf8');
    await rename(zipTemp, zipPath);
    await rename(manifestTemp, manifestPath);
  } finally {
    await rm(zipTemp, { force: true });
    await rm(manifestTemp, { force: true });
  }

  return {
    ok: true,
    repository,
    tag: release.tag_name,
    platform,
    zipPath,
    manifestPath,
    sha256: actualHash,
    nextCommand: platform === 'windows'
      ? `Expand-Archive -Path "${zipPath}" -DestinationPath "${releaseDir}" -Force`
      : `unzip -o "${zipPath}" -d "${releaseDir}"`
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const args = parseArgs(process.argv.slice(2));
  console.log(JSON.stringify(await downloadLatestRelease(args), null, 2));
}
