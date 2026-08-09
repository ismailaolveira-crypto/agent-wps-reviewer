#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlatformReleases } from './build-platform-releases.mjs';

export const REQUIRED_COLLEAGUE_FILES = [
  'START_HERE.md',
  'WORKBUDDY_SETUP.md',
  'COLLEAGUE_DELIVERY.md',
  'platform-config.json',
  'package.json',
  'package-lock.json',
  'config/product-manifest.json',
  'setup.command',
  'setup.cmd',
  'bin/wps-reviewer-mcp.mjs',
  'scripts/setup.mjs',
  'scripts/doctor.mjs',
  'skills/whitepaper-chief-editor/SKILL.md',
  'skills/whitepaper-chief-editor/agents/openai.yaml',
  'skills/whitepaper-chief-editor/references/capability-manifest.json',
  'skills/whitepaper-wps-reviewer/SKILL.md',
  'skills/whitepaper-wps-reviewer/references/review-purpose.md',
  'skills/whitepaper-wps-reviewer/references/2022-2024-style-profile.md',
  'skills/whitepaper-wps-reviewer/references/submission-contract.md',
  'profiles/generic-whitepaper/profile.json',
  'profiles/network-security-talent-2022-2024/profile.json',
  'public/WpsAgentReviewer/index.html',
  'public/WpsAgentReviewer/main.js',
  'public/WpsAgentReviewer/ribbon.xml',
  'public/WpsAgentReviewer/document-connector.js',
  'public/addin/taskpane.html',
  'public/addin/app.js',
  'public/addin/wps-adapter.js',
  'public/addin/styles.css'
];

function archiveEntries(zipPath) {
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Cannot inspect ${zipPath}`);
  return result.stdout.trim().split(/\r?\n/u).filter(Boolean);
}

function archiveText(zipPath, entry) {
  const result = spawnSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Cannot read ${entry} from ${zipPath}`);
  return result.stdout;
}

function parseArchiveJson(zipPath, entry) {
  return JSON.parse(archiveText(zipPath, entry));
}

export async function validatePlatformRelease(platform, release) {
  const manifest = JSON.parse(await readFile(release.manifestPath, 'utf8'));
  const entries = archiveEntries(release.zipPath);
  const entrySet = new Set(entries);
  const expectedInstaller = platform === 'macos' ? 'setup.command' : 'setup.cmd';
  const unexpectedInstaller = platform === 'macos' ? 'setup.cmd' : 'setup.command';
  const required = REQUIRED_COLLEAGUE_FILES.filter((entry) => entry !== unexpectedInstaller);
  const missing = required.filter((entry) => !entrySet.has(entry));
  const forbidden = entries.filter((entry) => /^(?:data|output|node_modules|\.playwright-cli)\//u.test(entry));

  const pkg = parseArchiveJson(release.zipPath, 'package.json');
  const platformConfig = parseArchiveJson(release.zipPath, 'platform-config.json');
  const productManifest = parseArchiveJson(release.zipPath, 'config/product-manifest.json');
  const capabilityManifest = parseArchiveJson(
    release.zipPath,
    'skills/whitepaper-chief-editor/references/capability-manifest.json'
  );
  const manifestEntriesMatch = manifest.files.length === entries.length &&
    [...manifest.files].sort().every((entry, index) => entry === [...entries].sort()[index]);
  const versionsAligned = [manifest.version, platformConfig.productVersion, capabilityManifest.productVersion]
    .every((version) => version === pkg.version);
  const productContract = productManifest.userFacingSkill === 'whitepaper-chief-editor' &&
    productManifest.productionSkills?.length === 1 &&
    productManifest.internalSkills?.some((skill) => skill.name === 'whitepaper-wps-reviewer') &&
    platformConfig.userFacingSkill === 'whitepaper-chief-editor' &&
    platformConfig.wpsPlugin === 'WpsAgentReviewer' &&
    platformConfig.mcpServerName === 'agent-wps-reviewer' &&
    capabilityManifest.capabilities?.['wps-comment']?.status === 'production' &&
    capabilityManifest.capabilities?.['docx-redline']?.status === 'disabled' &&
    capabilityManifest.capabilities?.['pdf-replica']?.status === 'disabled';
  const passed = manifest.platform === platform &&
    manifest.sha256 === release.sha256 &&
    entrySet.has(expectedInstaller) &&
    !entrySet.has(unexpectedInstaller) &&
    missing.length === 0 &&
    forbidden.length === 0 &&
    manifestEntriesMatch &&
    versionsAligned &&
    productContract;

  return {
    platform,
    passed,
    zipPath: release.zipPath,
    manifestPath: release.manifestPath,
    sha256: release.sha256,
    fileCount: entries.length,
    expectedInstaller,
    missing,
    forbidden,
    manifestEntriesMatch,
    versionsAligned,
    productContract
  };
}

export async function validatePlatformReleaseArtifacts(releases) {
  const checks = [];
  for (const [platform, release] of Object.entries(releases)) {
    checks.push(await validatePlatformRelease(platform, release));
  }
  return { ok: checks.every((check) => check.passed), checks };
}

export async function buildAndValidatePlatformReleases() {
  return validatePlatformReleaseArtifacts(await buildPlatformReleases());
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const result = await buildAndValidatePlatformReleases();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
