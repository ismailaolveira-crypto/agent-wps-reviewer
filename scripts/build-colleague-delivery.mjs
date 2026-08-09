#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlatformReleases } from './build-platform-releases.mjs';
import { validatePlatformReleaseArtifacts } from './validate-platform-releases.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildColleagueDelivery() {
  const pkg = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const productManifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'config/product-manifest.json'), 'utf8'));
  const releases = await buildPlatformReleases();
  const validation = await validatePlatformReleaseArtifacts(releases);
  if (!validation.ok) {
    throw new Error(`Colleague package validation failed: ${JSON.stringify(validation.checks)}`);
  }

  const distDir = path.join(PROJECT_ROOT, 'dist');
  const indexPath = path.join(distDir, `${pkg.name}-${pkg.version}-colleague-delivery.json`);
  const tempPath = path.join(distDir, `.${pkg.name}-${pkg.version}.${process.pid}.colleague-delivery.tmp`);
  const packages = Object.fromEntries(Object.entries(releases).map(([platform, release]) => [platform, {
    zip: path.basename(release.zipPath),
    manifest: path.basename(release.manifestPath),
    sha256: release.sha256,
    fileCount: release.fileCount
  }]));
  const index = {
    schemaVersion: 1,
    product: pkg.name,
    productVersion: pkg.version,
    release: productManifest.release,
    generatedAt: new Date().toISOString(),
    installModel: 'one-platform-zip-one-installer',
    userFacingSkill: productManifest.userFacingSkill,
    wpsPlugin: 'WpsAgentReviewer',
    mcpServer: 'agent-wps-reviewer',
    packages,
    validation
  };

  await mkdir(distDir, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await rename(tempPath, indexPath);
  return { ok: true, indexPath, ...index };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  console.log(JSON.stringify(await buildColleagueDelivery(), null, 2));
}
