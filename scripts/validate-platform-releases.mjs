#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildPlatformReleases } from './build-platform-releases.mjs';

function archiveEntries(zipPath) {
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Cannot inspect ${zipPath}`);
  return result.stdout.trim().split(/\r?\n/u).filter(Boolean);
}

const releases = await buildPlatformReleases();
const checks = [];
for (const [platform, release] of Object.entries(releases)) {
  const manifest = JSON.parse(await readFile(release.manifestPath, 'utf8'));
  const entries = archiveEntries(release.zipPath);
  const expectedInstaller = platform === 'macos' ? 'setup.command' : 'setup.cmd';
  const unexpectedInstaller = platform === 'macos' ? 'setup.cmd' : 'setup.command';
  const passed = manifest.platform === platform &&
    manifest.sha256 === release.sha256 &&
    entries.includes(expectedInstaller) &&
    !entries.includes(unexpectedInstaller) &&
    entries.includes('START_HERE.md') &&
    entries.includes('WORKBUDDY_SETUP.md') &&
    entries.includes('platform-config.json') &&
    entries.includes('bin/wps-reviewer-mcp.mjs') &&
    entries.includes('skills/whitepaper-chief-editor/SKILL.md') &&
    !entries.some((entry) => /^(?:data|output|node_modules)\//u.test(entry));
  checks.push({ platform, passed, zipPath: release.zipPath, sha256: release.sha256, fileCount: entries.length });
}

const result = { ok: checks.every((check) => check.passed), checks };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
