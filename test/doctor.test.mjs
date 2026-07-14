import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inspectReleaseArtifact, runDoctor } from '../src/install/doctor.mjs';

test('runDoctor reports missing production skills and WPS configuration without starting WPS', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-doctor-'));
  const manifestPath = path.join(root, 'product-manifest.json');
  const skillRoot = path.join(root, 'skills');
  const jsaddonsDir = path.join(root, 'jsaddons');

  try {
    await writeFile(manifestPath, JSON.stringify({
      productionSkills: [{ name: 'whitepaper-chief-editor', source: 'skills/whitepaper-chief-editor' }]
    }));
    await mkdir(skillRoot, { recursive: true });

    const result = await runDoctor({
      manifestPath,
      skillRoots: [skillRoot],
      jsaddonsDir,
      bridgeOptions: {
        runtimeDir: path.join(root, 'runtime'),
        dataDir: path.join(root, 'data'),
        pidFile: path.join(root, 'runtime/bridge.pid'),
        logFile: path.join(root, 'runtime/bridge.log'),
        port: 0
      },
      wpsAppPath: path.join(root, 'missing-wpsoffice.app'),
      checkWpsProcess: false
    });

    assert.equal(result.ok, false);
    assert.equal(result.checks.skills.ok, false);
    assert.equal(result.checks.wpsConfig.ok, false);
    assert.equal(result.checks.bridge.ok, false);
    assert.equal(result.checks.wpsRuntime.installed, false);
    assert.equal(result.checks.wpsDocuments.checked, false);
    assert.match(result.nextSteps.join('\n'), /npm run install:skill/);
    assert.match(result.nextSteps.join('\n'), /npm run setup/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctor detects installed Skill source drift and gives a sync action', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-doctor-drift-'));
  const manifestPath = path.join(root, 'product-manifest.json');
  const sourceSkill = path.join(root, 'source', 'whitepaper-wps-reviewer');
  const skillRoot = path.join(root, 'installed');
  const installedSkill = path.join(skillRoot, 'whitepaper-wps-reviewer');

  try {
    await mkdir(path.join(sourceSkill, 'references'), { recursive: true });
    await writeFile(path.join(sourceSkill, 'SKILL.md'), 'source version');
    await writeFile(path.join(sourceSkill, 'references', 'contract.md'), 'contract');
    await cp(sourceSkill, installedSkill, { recursive: true });
    await writeFile(manifestPath, JSON.stringify({
      productionSkills: [{ name: 'whitepaper-wps-reviewer', source: 'source/whitepaper-wps-reviewer' }]
    }));

    const options = {
      manifestPath,
      skillSourceRoot: root,
      skillRoots: [skillRoot],
      jsaddonsDir: path.join(root, 'jsaddons'),
      bridgeOptions: {
        runtimeDir: path.join(root, 'runtime'),
        dataDir: path.join(root, 'data'),
        pidFile: path.join(root, 'runtime/bridge.pid'),
        logFile: path.join(root, 'runtime/bridge.log'),
        port: 0
      },
      wpsAppPath: path.join(root, 'missing-wpsoffice.app'),
      checkWpsProcess: false
    };

    const clean = await runDoctor(options);
    assert.equal(clean.checks.skills.ok, true);
    assert.equal(clean.checks.skills.items[0].drift, false);

    await writeFile(path.join(installedSkill, 'SKILL.md'), 'drifted installation');
    const drifted = await runDoctor(options);
    assert.equal(drifted.checks.skills.ok, false);
    assert.equal(drifted.checks.skills.items[0].error, 'source-drift');
    assert.match(drifted.nextSteps.join('\n'), /Skill 与仓库源文件不一致/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctor detects a retired top-level executor left beside the user-facing Skill', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-doctor-retired-'));
  const manifestPath = path.join(root, 'product-manifest.json');
  const sourceSkill = path.join(root, 'source', 'whitepaper-chief-editor');
  const skillRoot = path.join(root, 'installed');

  try {
    await mkdir(sourceSkill, { recursive: true });
    await writeFile(path.join(sourceSkill, 'SKILL.md'), 'chief editor');
    await cp(sourceSkill, path.join(skillRoot, 'whitepaper-chief-editor'), { recursive: true });
    await mkdir(path.join(skillRoot, 'whitepaper-wps-reviewer'), { recursive: true });
    await writeFile(path.join(skillRoot, 'whitepaper-wps-reviewer', 'SKILL.md'), 'retired executor');
    await writeFile(manifestPath, JSON.stringify({
      productionSkills: [{ name: 'whitepaper-chief-editor', source: 'source/whitepaper-chief-editor' }],
      retiredTopLevelSkills: ['whitepaper-wps-reviewer']
    }));

    const result = await runDoctor({
      manifestPath,
      skillSourceRoot: root,
      skillRoots: [skillRoot],
      jsaddonsDir: path.join(root, 'jsaddons'),
      bridgeOptions: {
        runtimeDir: path.join(root, 'runtime'),
        dataDir: path.join(root, 'data'),
        pidFile: path.join(root, 'runtime/bridge.pid'),
        logFile: path.join(root, 'runtime/bridge.log'),
        port: 0
      },
      wpsAppPath: path.join(root, 'missing-wpsoffice.app'),
      checkWpsProcess: false
    });

    assert.equal(result.checks.skills.ok, true);
    assert.equal(result.checks.retiredSkills.ok, false);
    assert.equal(result.checks.retiredSkills.items[0].error, 'retired-top-level-skill');
    assert.match(result.nextSteps.join('\n'), /旧的顶层 whitepaper-wps-reviewer/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctor rejects stale public replacement promises', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-doctor-docs-'));
  const manifestPath = path.join(root, 'product-manifest.json');

  try {
    await writeFile(manifestPath, JSON.stringify({ productionSkills: [] }));
    await writeFile(path.join(root, 'README.md'), '# Test\n用户可以应用替换到正文。');

    const result = await runDoctor({
      manifestPath,
      skillRoots: [],
      projectRoot: root,
      jsaddonsDir: path.join(root, 'jsaddons'),
      bridgeOptions: {
        runtimeDir: path.join(root, 'runtime'),
        dataDir: path.join(root, 'data'),
        pidFile: path.join(root, 'runtime/bridge.pid'),
        logFile: path.join(root, 'runtime/bridge.log'),
        port: 0
      },
      wpsAppPath: path.join(root, 'missing-wpsoffice.app'),
      checkWpsProcess: false
    });

    assert.equal(result.checks.documentation.ok, false);
    assert.deepEqual(result.checks.documentation.violations, ['应用替换']);
    assert.match(result.nextSteps.join('\n'), /README.*正文替换/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inspectReleaseArtifact reports an active release lock instead of reading a partial artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-doctor-release-lock-'));
  try {
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'agent-wps-reviewer', version: '0.2.0' }));
    const lockPath = path.join(root, 'dist', '.agent-wps-reviewer-0.2.0.lock');
    await writeFile(lockPath, JSON.stringify({ pid: 123, createdAt: new Date().toISOString() }));

    const result = await inspectReleaseArtifact(root);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'release-build-in-progress');
    assert.equal(result.releaseLockPath, lockPath);
    assert.match(result.error, /release build in progress/);

    const staleTime = new Date('2020-01-01T00:00:00.000Z');
    await utimes(lockPath, staleTime, staleTime);
    const staleResult = await inspectReleaseArtifact(root);
    assert.equal(staleResult.status, 'stale-lock');
    assert.match(staleResult.error, /stale release lock/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctor treats missing LaunchAgent as an actionable optional setup step', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-doctor-launch-agent-'));
  const manifestPath = path.join(root, 'product-manifest.json');
  try {
    await writeFile(manifestPath, JSON.stringify({ productionSkills: [] }));
    const result = await runDoctor({
      manifestPath,
      skillRoots: [],
      jsaddonsDir: path.join(root, 'jsaddons'),
      launchAgentPath: path.join(root, 'missing-launch-agent.plist'),
      checkLaunchAgent: true,
      bridgeOptions: {
        runtimeDir: path.join(root, 'runtime'),
        dataDir: path.join(root, 'data'),
        pidFile: path.join(root, 'runtime/bridge.pid'),
        logFile: path.join(root, 'runtime/bridge.log'),
        port: 0
      },
      wpsAppPath: path.join(root, 'missing-wpsoffice.app'),
      checkWpsProcess: false
    });

    assert.equal(result.checks.launchAgent.ok, true);
    assert.equal(result.checks.launchAgent.configured, false);
    assert.match(result.nextSteps.join('\n'), /LaunchAgent/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
