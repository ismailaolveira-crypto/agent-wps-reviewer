#!/usr/bin/env node
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPRODUCIBLE_MTIME = new Date('2020-01-01T00:00:00.000Z');
const RELEASE_LOCK_TIMEOUT_MS = 60_000;
const RELEASE_LOCK_STALE_MS = 10 * 60_000;
const KNOWN_PROMOTION_BLOCKERS = new Set([
  'real-wps-acceptance',
  'novice-unassisted-install',
  'github-source-of-truth'
]);

export function validateReleaseMetadata(productManifest = {}) {
  const release = productManifest?.release || {};
  const errors = [];
  const channel = String(release.channel || '').trim();
  const productionReady = release.productionReady === true;
  const blockers = Array.isArray(release.promotionBlockers)
    ? release.promotionBlockers.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (!['beta', 'production'].includes(channel)) {
    errors.push('release.channel must be beta or production');
  }
  if (!Array.isArray(release.promotionBlockers)) {
    errors.push('release.promotionBlockers must be an array');
  }
  if (productionReady && blockers.length > 0) {
    errors.push('productionReady cannot be true while promotionBlockers is non-empty');
  }
  if (channel === 'production' && !productionReady) {
    errors.push('production channel requires productionReady=true');
  }
  if (productionReady && channel !== 'production') {
    errors.push('productionReady=true requires release.channel=production');
  }
  if (channel === 'beta' && productionReady) {
    errors.push('beta channel cannot be marked productionReady');
  }
  if (channel === 'beta' && blockers.some((blocker) => !KNOWN_PROMOTION_BLOCKERS.has(blocker))) {
    errors.push('beta promotionBlockers contains an unknown blocker');
  }

  return { ok: errors.length === 0, errors, channel, productionReady, promotionBlockers: blockers };
}

export const REQUIRED_RELEASE_FILES = [
  'AGENTS.md',
  'README.md',
  '.gitattributes',
  'setup.command',
  'setup.cmd',
  'package.json',
  'bin/wps-addon-config.mjs',
  'bin/wps-bridge-control.mjs',
  'bin/wps-diagnose.mjs',
  'scripts/build-wps-publish.mjs',
  'bin/wps-reviewer-mcp.mjs',
  'bin/wps-suggest.mjs',
  'public/jsplugins.xml',
  'public/WpsAgentReviewer/index.html',
  'public/WpsAgentReviewer/main.js',
  'public/WpsAgentReviewer/ribbon.xml',
  'public/addin/taskpane.html',
  'public/addin/app.js',
  'public/addin/wps-adapter.js',
  'public/addin/styles.css',
  'schemas/wps-suggestion.schema.json',
  'schemas/wps-document-code.schema.json',
  'schemas/wps-suggestion-batch.schema.json',
  'schemas/wps-legacy-suggestion.schema.json',
  'schemas/wps-suggestion-payload.schema.json',
  'scripts/acceptance-status.mjs',
  'scripts/create-acceptance-kit.mjs',
  'scripts/create-novice-install-kit.mjs',
  'scripts/prepare-foreground-acceptance.mjs',
  'scripts/record-manual-acceptance.mjs',
  'scripts/record-novice-install.mjs',
  'scripts/validate-manual-acceptance.mjs',
  'scripts/wait-manual-acceptance.mjs',
  'scripts/install-local.mjs',
  'scripts/install-skill.mjs',
  'scripts/uninstall-skill.mjs',
  'scripts/setup.mjs',
  'scripts/mcp-config.mjs',
  'scripts/doctor.mjs',
  'scripts/quarantine-unverified-suggestions.mjs',
  'scripts/install-launch-agent.mjs',
  'scripts/install-autostart.mjs',
  'scripts/validate-background.mjs',
  'scripts/validate-agent-contract.mjs',
  'scripts/validate-foreground-prep.mjs',
  'scripts/github-preflight.mjs',
  'scripts/validate-launch-agent.mjs',
  'scripts/validate-local-install.mjs',
  'scripts/validate-release-install.mjs',
  'scripts/validate-windows-install.mjs',
  'scripts/validate-windows-startup.mjs',
  'scripts/validate-default-port.mjs',
  'scripts/smoke-wps-resources.mjs',
  'scripts/check-url-consistency.mjs',
  'scripts/acceptance-audit.mjs',
  'src/bridge/auth.mjs',
  'src/bridge/server.mjs',
  'src/bridge/processControl.mjs',
  'src/agent/contract.mjs',
  'src/install/launchAgent.mjs',
  'src/install/agentToken.mjs',
  'src/install/mcpConfig.mjs',
  'src/install/doctor.mjs',
  'src/install/mcpHealth.mjs',
  'src/install/localInstall.mjs',
  'src/install/stableWindowsBundle.mjs',
  'src/install/skillInstall.mjs',
  'src/maintenance/quarantineSuggestions.mjs',
  'skills/whitepaper-wps-reviewer/SKILL.md',
  'skills/whitepaper-wps-reviewer/references/review-purpose.md',
  'skills/whitepaper-wps-reviewer/references/2022-2024-style-profile.md',
  'skills/whitepaper-wps-reviewer/references/submission-contract.md',
  'skills/whitepaper-wps-reviewer/references/source-fingerprints.json',
  'skills/whitepaper-chief-editor/SKILL.md',
  'skills/whitepaper-chief-editor/references/capability-manifest.json',
  'config/product-manifest.json',
  'src/acceptance/audit.mjs',
  'src/acceptance/defaultPortReadiness.mjs',
  'src/acceptance/foregroundPrep.mjs',
  'src/acceptance/kit.mjs',
  'src/acceptance/manualEvidence.mjs',
  'src/acceptance/noviceInstallEvidence.mjs',
  'src/acceptance/runtimeIdentity.mjs',
  'src/acceptance/resourceSmoke.mjs',
  'src/acceptance/status.mjs',
  'src/acceptance/urlConsistency.mjs',
  'src/wps/diagnostics.mjs',
  'src/wps/publish.mjs',
  'src/wps/pluginConfig.mjs',
  'src/wps/pluginAuth.mjs',
  'docs/WPS_INSTALL.md',
  'docs/AGENT_INTEGRATION.md',
  'docs/DESIGN.md',
  'docs/RELEASE.md',
  'docs/ACCEPTANCE.md',
  'docs/WPS_API_NOTES.md',
  'examples/sample-suggestion.json',
  'examples/batch-suggestions.json',
  'examples/development-legacy-suggestion.json'
];

const EXCLUDED_PREFIXES = [
  'data/',
  'output/',
  'dist/',
  '.playwright-cli/',
  '.superpowers/',
  'test/',
  'docs/superpowers/',
  'docs/evidence/',
  'node_modules/'
];
const EXCLUDED_FILES = new Set([
  // Internal execution records may contain local evidence paths and are not
  // part of the portable end-user package.
  'docs/2026-07-14-agent-wps-reviewer-productization-remediation-plan.md',
  'docs/2026-07-14-production-skill-suite-refactor-execution.md',
  'scripts/validate-responsive-ui.mjs',
  'scripts/record-product-demo-video.mjs'
]);
const INCLUDED_EXTENSIONS = new Set(['.md', '.json', '.mjs', '.js', '.css', '.html', '.xml']);

async function walk(dir, prefix = '') {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(path.join(PROJECT_ROOT, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const fullRelative = dir ? path.posix.join(dir, entry.name) : entry.name;
    if (EXCLUDED_PREFIXES.some((excluded) => fullRelative.startsWith(excluded))) continue;
    if (EXCLUDED_FILES.has(fullRelative)) continue;
    if (entry.isDirectory()) {
      files.push(...(await walk(fullRelative, relative)));
    } else if (INCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullRelative);
    }
  }
  return files;
}

export async function collectReleaseFiles() {
  const files = await walk('');
  return [...new Set([...files, ...REQUIRED_RELEASE_FILES])].sort();
}

async function sha256(filePath) {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function createReleaseStaging(files) {
  const stagingDir = await mkdtemp(path.join(tmpdir(), 'agent-wps-release-'));
  try {
    for (const relativePath of files) {
      const sourcePath = path.join(PROJECT_ROOT, relativePath);
      const targetPath = path.join(stagingDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      const sourceStat = await stat(sourcePath);
      await chmod(targetPath, sourceStat.mode & 0o777);
      await utimes(targetPath, REPRODUCIBLE_MTIME, REPRODUCIBLE_MTIME);
    }
    return stagingDir;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireReleaseLock(lockPath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RELEASE_LOCK_TIMEOUT_MS) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.close();
      return async () => { await rm(lockPath, { force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > RELEASE_LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      await delay(25);
    }
  }
  throw new Error(`Timed out waiting for release lock: ${lockPath}`);
}

export async function buildRelease() {
  const pkg = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const productManifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'config/product-manifest.json'), 'utf8'));
  const releaseMetadata = validateReleaseMetadata(productManifest);
  if (!releaseMetadata.ok) {
    throw new Error(`Invalid release metadata: ${releaseMetadata.errors.join('; ')}`);
  }
  const distDir = path.join(PROJECT_ROOT, 'dist');
  const releaseName = `${pkg.name}-${pkg.version}`;
  const zipPath = path.join(distDir, `${releaseName}.zip`);
  const manifestPath = path.join(distDir, `${releaseName}-manifest.json`);
  const files = await collectReleaseFiles();

  await mkdir(distDir, { recursive: true });
  const releaseLockPath = path.join(distDir, `.${releaseName}.lock`);
  const releaseTempZipPath = path.join(distDir, `.${releaseName}.${process.pid}.zip.tmp`);
  const releaseTempManifestPath = path.join(distDir, `.${releaseName}.${process.pid}.manifest.tmp`);
  const releaseLockRelease = await acquireReleaseLock(releaseLockPath);
  try {
    await rm(releaseTempZipPath, { force: true });
    await rm(releaseTempManifestPath, { force: true });

    const stagingDir = await createReleaseStaging(files);
    try {
      const zipResult = spawnSync('zip', ['-q', '-X', '-D', releaseTempZipPath, ...files], {
        cwd: stagingDir,
        encoding: 'utf8'
      });
      if (zipResult.status !== 0) {
        throw new Error(zipResult.stderr || 'zip failed');
      }
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }

    const manifest = {
      name: pkg.name,
      version: pkg.version,
      release: productManifest.release || { channel: 'beta', productionReady: false },
      createdAt: new Date().toISOString(),
      zip: path.basename(zipPath),
      sha256: await sha256(releaseTempZipPath),
      files
    };
    await writeFile(releaseTempManifestPath, JSON.stringify(manifest, null, 2));
    await rename(releaseTempZipPath, zipPath);
    await rename(releaseTempManifestPath, manifestPath);

    return {
      zipPath,
      manifestPath,
      fileCount: files.length,
      sha256: manifest.sha256
    };
  } finally {
    await rm(releaseTempZipPath, { force: true });
    await rm(releaseTempManifestPath, { force: true });
    await releaseLockRelease();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const result = await buildRelease();
  console.log(JSON.stringify(result, null, 2));
}
