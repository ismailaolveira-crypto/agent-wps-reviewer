import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { buildRelease, collectReleaseFiles, REQUIRED_RELEASE_FILES, validateReleaseMetadata } from '../scripts/build-release.mjs';

const execFile = promisify(execFileCallback);

test('release file collection includes required product files', async () => {
  const files = await collectReleaseFiles();
  for (const required of REQUIRED_RELEASE_FILES) {
    assert.ok(files.includes(required), `missing ${required}`);
  }
});

test('release metadata blocks impossible production claims', () => {
  assert.equal(validateReleaseMetadata({
    release: {
      channel: 'beta',
      productionReady: false,
      promotionBlockers: ['real-wps-acceptance', 'novice-unassisted-install', 'github-source-of-truth']
    }
  }).ok, true);

  const invalid = validateReleaseMetadata({
    release: {
      channel: 'production',
      productionReady: true,
      promotionBlockers: ['real-wps-acceptance']
    }
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /promotionBlockers/);
});

test('release ZIP is reproducible across consecutive builds', async () => {
  const first = await buildRelease();
  const second = await buildRelease();
  assert.equal(first.sha256, second.sha256);
  const manifest = JSON.parse(await readFile(second.manifestPath, 'utf8'));
  assert.equal(manifest.sha256, second.sha256);
  assert.equal(first.fileCount, second.fileCount);
  assert.equal(second.fileCount, 111);

  const sourcePath = path.resolve('AGENTS.md');
  const sourceStat = await stat(sourcePath);
  try {
    const changedTime = new Date('2035-05-06T07:08:09.000Z');
    await utimes(sourcePath, changedTime, changedTime);
    const changedMtimeBuild = await buildRelease();
    assert.equal(changedMtimeBuild.sha256, second.sha256);
  } finally {
    await utimes(sourcePath, sourceStat.atime, sourceStat.mtime);
  }
});

test('concurrent release builds serialize and leave a matching manifest', async () => {
  const results = await Promise.all([buildRelease(), buildRelease()]);
  assert.equal(results[0].sha256, results[1].sha256);
  const manifest = JSON.parse(await readFile(results[0].manifestPath, 'utf8'));
  assert.equal(manifest.sha256, results[0].sha256);
  assert.equal(manifest.files.length, results[0].fileCount);
});

test('release explicitly includes the bundled review skill and formal schemas', () => {
  for (const file of [
    'skills/whitepaper-chief-editor/SKILL.md',
    'skills/whitepaper-chief-editor/references/capability-manifest.json',
    'skills/whitepaper-wps-reviewer/SKILL.md',
    'skills/whitepaper-wps-reviewer/references/review-purpose.md',
    'skills/whitepaper-wps-reviewer/references/2022-2024-style-profile.md',
    'skills/whitepaper-wps-reviewer/references/submission-contract.md',
    'schemas/wps-document-code.schema.json',
    'schemas/wps-suggestion-batch.schema.json',
    'schemas/wps-legacy-suggestion.schema.json'
  ]) assert.ok(REQUIRED_RELEASE_FILES.includes(file), `${file} must be explicitly required`);
});

test('downloaded agents get a portable project route and safety boundary', async () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('AGENTS.md'));
  const instructions = await readFile(path.resolve('AGENTS.md'), 'utf8');
  for (const marker of [
    'whitepaper-chief-editor',
    'capability-manifest.json',
    'docx-redline',
    'pdf-replica',
    'setup.command',
    'whitepaper-wps-reviewer'
  ]) assert.match(instructions, new RegExp(marker.replace('.', '\\.'), 'u'));
  assert.doesNotMatch(instructions, /\/Users\//u);
});

test('README exposes one novice installation route and hides component installers', async () => {
  const readme = await readFile(path.resolve('README.md'), 'utf8');
  assert.match(readme, /setup\.command/);
  assert.match(readme, /npm run setup/);
  assert.doesNotMatch(readme, /npm run (mcp:install|wps:install|install:skill|install:local)/u);
});

test('release explicitly includes the product manifest, doctor, MCP health check, release installer, skill uninstall, and GitHub preflight', () => {
  for (const file of ['config/product-manifest.json', 'src/install/doctor.mjs', 'src/install/mcpHealth.mjs', 'src/install/agentToken.mjs', 'src/install/mcpConfig.mjs', 'src/wps/pluginAuth.mjs', 'scripts/doctor.mjs', 'scripts/setup.mjs', 'scripts/mcp-config.mjs', 'scripts/uninstall-skill.mjs', 'scripts/validate-release-install.mjs', 'scripts/github-preflight.mjs']) {
    assert.ok(REQUIRED_RELEASE_FILES.includes(file), `${file} must be explicitly required`);
  }
});

test('release manifest keeps the product explicitly in beta until foreground gates are promoted', async () => {
  const productManifest = JSON.parse(await readFile(path.resolve('config/product-manifest.json'), 'utf8'));
  assert.equal(productManifest.release.channel, 'beta');
  assert.equal(productManifest.release.productionReady, false);
  assert.deepEqual(productManifest.release.promotionBlockers, [
    'real-wps-acceptance',
    'novice-unassisted-install'
  ]);
});

test('release includes the novice macOS setup entry point', () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('setup.command'));
});

test('novice setup checks npm and does not block non-interactive runs', async () => {
  const setup = await readFile(path.resolve('setup.command'), 'utf8');
  assert.match(setup, /command -v \"\$name\"/);
  assert.match(setup, /pause_for_exit\(\)/);
  assert.match(setup, /if \[ -t 0 \]/);
  assert.match(setup, /\.volta\/bin\/node/);
  assert.match(setup, /\.nvm\/versions\/node/);
  assert.match(setup, /\.local\/share\/mise\/shims\/node/);
});

test('novice setup finds Node and npm from a Finder-like minimal PATH', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-setup-runtime-'));
  const bin = path.join(home, '.volta', 'bin');
  const oldBin = path.join(home, 'old-bin');
  const fakeNode = path.join(bin, 'node');
  const fakeNpm = path.join(bin, 'npm');
  const oldNode = path.join(oldBin, 'node');
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(oldBin, { recursive: true });
    await writeFile(fakeNode, '#!/bin/sh\nif [ "$1" = "-p" ]; then printf "20\\n"; else printf "v20.0.0\\n"; fi\n');
    await writeFile(fakeNpm, '#!/bin/sh\nprintf "fake npm %s\\n" "$*"\nexit 0\n');
    await writeFile(oldNode, '#!/bin/sh\nif [ "$1" = "-p" ]; then printf "18\\n"; else printf "v18.0.0\\n"; fi\n');
    await chmod(fakeNode, 0o755);
    await chmod(fakeNpm, 0o755);
    await chmod(oldNode, 0o755);

    const result = await execFile('/bin/bash', [path.resolve('setup.command')], {
      cwd: path.resolve('.'),
      env: { ...process.env, HOME: home, PATH: `${oldBin}:/usr/bin:/bin` },
      timeout: 10000
    });
    assert.match(result.stdout, /fake npm run setup/);
    assert.match(result.stdout, /fake npm run doctor/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('development demo tooling resolves Playwright without a developer-private path', async () => {
  const demoScript = await readFile(path.resolve('scripts/record-product-demo-video.mjs'), 'utf8');
  assert.match(demoScript, /PLAYWRIGHT_PACKAGE_JSON/);
  assert.doesNotMatch(demoScript, /\/Users\/zhangboquan\//u);
});

test('release includes the public profiles without bundling runtime data', async () => {
  const files = await collectReleaseFiles();
  for (const file of [
    'profiles/generic-whitepaper/profile.json',
    'profiles/generic-whitepaper/editorial-rules.md',
    'profiles/network-security-talent-2022-2024/profile.json',
    'profiles/network-security-talent-2022-2024/style-rules.json',
    'profiles/network-security-talent-2022-2024/source-fingerprints.json',
    'profiles/network-security-talent-2022-2024/style-evidence-map.json'
  ]) assert.ok(files.includes(file), `${file} must be in the release file set`);
});

test('launch agent support is included in explicit release requirements', () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('src/install/launchAgent.mjs'));
  assert.ok(REQUIRED_RELEASE_FILES.includes('scripts/install-launch-agent.mjs'));
  assert.ok(REQUIRED_RELEASE_FILES.includes('scripts/validate-launch-agent.mjs'));
});

test('manual acceptance waiter is included in explicit release requirements', () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('scripts/wait-manual-acceptance.mjs'));
});

test('foreground acceptance preparation is included in explicit release requirements', () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('src/acceptance/foregroundPrep.mjs'));
  assert.ok(REQUIRED_RELEASE_FILES.includes('scripts/prepare-foreground-acceptance.mjs'));
  assert.ok(REQUIRED_RELEASE_FILES.includes('scripts/validate-foreground-prep.mjs'));
});

test('acceptance status command is included in explicit release requirements', () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('src/acceptance/status.mjs'));
  assert.ok(REQUIRED_RELEASE_FILES.includes('scripts/acceptance-status.mjs'));
});

test('release file collection excludes runtime artifacts', async () => {
  const files = await collectReleaseFiles();
  assert.equal(files.some((file) => file.startsWith('data/')), false);
  assert.equal(files.some((file) => file.startsWith('output/')), false);
  assert.equal(files.some((file) => file.startsWith('.playwright-cli/')), false);
  assert.equal(files.some((file) => file.startsWith('docs/superpowers/')), false);
  assert.equal(files.includes('docs/2026-07-14-production-skill-suite-refactor-execution.md'), false);
  assert.equal(files.includes('docs/2026-07-14-agent-wps-reviewer-productization-remediation-plan.md'), false);
  assert.equal(files.includes('scripts/cleanup-orphan-bridges.mjs'), true);
  assert.equal(files.includes('scripts/record-product-demo-video.mjs'), false);
  assert.equal(files.includes('scripts/validate-responsive-ui.mjs'), false);
});

test('release file collection contains no developer-private absolute paths', async () => {
  const files = await collectReleaseFiles();
  const offenders = [];
  for (const file of files) {
    const content = await readFile(path.resolve(file), 'utf8');
    if (content.includes('/Users/zhangboquan/')) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
