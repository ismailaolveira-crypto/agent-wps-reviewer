import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installBundledSkill, uninstallProductionSkills } from '../src/install/skillInstall.mjs';

test('installBundledSkill copies the complete production Skill set into each requested agent home', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-'));
  const codexRoot = path.join(root, 'codex-skills');
  const claudeRoot = path.join(root, 'claude-skills');

  try {
    const result = await installBundledSkill({ targetRoots: [codexRoot, claudeRoot] });

    assert.equal(result.ok, true);
    assert.equal(result.installations.length, 2);
    assert.deepEqual(result.skills, ['whitepaper-chief-editor']);
    assert.deepEqual(result.internalSkills, [{
      name: 'whitepaper-wps-reviewer',
      target: 'whitepaper-chief-editor/references/executors/whitepaper-wps-reviewer'
    }]);
    for (const installation of result.installations) {
      assert.equal(installation.installed, true);
      const skill = await readFile(path.join(installation.path, 'SKILL.md'), 'utf8');
      assert.match(skill, /name: whitepaper-chief-editor/);
      assert.match(await readFile(path.join(installation.path, 'references', 'capability-manifest.json'), 'utf8'), /wps-comment/);
      assert.match(await readFile(path.join(installation.path, 'references', 'profiles', 'generic-whitepaper', 'profile.json'), 'utf8'), /generic-whitepaper/);
      assert.match(await readFile(path.join(installation.path, 'references', 'executors', 'whitepaper-wps-reviewer', 'SKILL.md'), 'utf8'), /name: whitepaper-wps-reviewer/);
      assert.match(await readFile(path.join(installation.path, 'references', 'executors', 'whitepaper-wps-reviewer', 'references', 'submission-contract.md'), 'utf8'), /submit_wps_suggestions/);
      assert.equal(await access(path.join(installation.path, '..', 'whitepaper-wps-reviewer')).then(() => true).catch(() => false), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installBundledSkill rejects an incomplete manifest before changing targets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-manifest-'));
  const targetRoot = path.join(root, 'skills');
  const manifestPath = path.join(root, 'product-manifest.json');

  try {
    await writeFile(manifestPath, JSON.stringify({ productionSkills: [{ name: 'missing', source: 'not-there' }] }));
    await assert.rejects(
      () => installBundledSkill({ manifestPath, targetRoots: [targetRoot] }),
      /Bundled skill is missing/
    );
    assert.equal(await import('node:fs/promises').then(({ access }) => access(targetRoot).then(() => true).catch(() => false)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installBundledSkill backs up an existing different installation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-backup-'));
  const targetRoot = path.join(root, 'skills');
  const target = path.join(targetRoot, 'whitepaper-chief-editor');

  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(target, { recursive: true }));
    await writeFile(path.join(target, 'SKILL.md'), 'old installation');

    const result = await installBundledSkill({ targetRoots: [targetRoot] });
    const installation = result.installations[0];

    assert.ok(installation.backupPath);
    assert.equal(installation.backupPath.startsWith(`${targetRoot}/`), false);
    assert.equal(await readFile(path.join(installation.backupPath, 'SKILL.md'), 'utf8'), 'old installation');
    assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), /name: whitepaper-chief-editor/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installBundledSkill relocates legacy backups outside the discoverable Skill root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-backup-migration-'));
  const targetRoot = path.join(root, 'skills');
  const legacyBackup = path.join(targetRoot, 'whitepaper-wps-reviewer.backup-2026-07-14T00-00-00Z-whitepaper-wps-reviewer');

  try {
    await mkdir(legacyBackup, { recursive: true });
    await writeFile(path.join(legacyBackup, 'SKILL.md'), 'legacy backup');

    const result = await installBundledSkill({ targetRoots: [targetRoot] });
    const relocated = path.join(root, '.agent-wps-reviewer-backups', 'skills', path.basename(legacyBackup));

    assert.equal(await access(legacyBackup).then(() => true).catch(() => false), false);
    assert.equal(await readFile(path.join(relocated, 'SKILL.md'), 'utf8'), 'legacy backup');
    assert.equal(result.installations[0].backupRoot, path.join(root, '.agent-wps-reviewer-backups', 'skills'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deferred Skill upgrade can roll back to the previous installation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-deferred-rollback-'));
  const targetRoot = path.join(root, 'skills');
  const target = path.join(targetRoot, 'whitepaper-chief-editor');

  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(target, { recursive: true }));
    await writeFile(path.join(target, 'SKILL.md'), 'previous version');

    const result = await installBundledSkill({ targetRoots: [targetRoot], backup: false, deferCleanup: true });
    assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), /name: whitepaper-chief-editor/);
    await result.rollback();
    assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), 'previous version');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installBundledSkill migrates a retired top-level executor into the chief editor bundle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-migration-'));
  const targetRoot = path.join(root, 'skills');
  const retiredTarget = path.join(targetRoot, 'whitepaper-wps-reviewer');

  try {
    await mkdir(retiredTarget, { recursive: true });
    await writeFile(path.join(retiredTarget, 'SKILL.md'), 'old top-level executor');

    const result = await installBundledSkill({ targetRoots: [targetRoot] });
    const chief = path.join(targetRoot, 'whitepaper-chief-editor');

    assert.deepEqual(result.skills, ['whitepaper-chief-editor']);
    assert.equal(await access(path.join(chief, 'references', 'executors', 'whitepaper-wps-reviewer', 'SKILL.md')).then(() => true).catch(() => false), true);
    assert.equal(await access(path.join(targetRoot, 'whitepaper-wps-reviewer')).then(() => true).catch(() => false), false);
    assert.equal(result.retiredSkills.length, 1);
    assert.ok(result.retiredSkills[0].backupPath);
    assert.equal(await readFile(path.join(result.retiredSkills[0].backupPath, 'SKILL.md'), 'utf8'), 'old top-level executor');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uninstallProductionSkills removes only product entries and preserves unrelated Skills', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-uninstall-'));
  const targetRoot = path.join(root, 'skills');
  const unrelated = path.join(targetRoot, 'unrelated-skill');

  try {
    const installed = await installBundledSkill({ targetRoots: [targetRoot] });
    await mkdir(unrelated, { recursive: true });
    await writeFile(path.join(unrelated, 'SKILL.md'), 'keep me');

    const result = await uninstallProductionSkills({ targetRoots: [targetRoot] });

    assert.equal(result.ok, true);
    assert.equal(await access(path.join(targetRoot, 'whitepaper-chief-editor')).then(() => true).catch(() => false), false);
    assert.equal(await access(path.join(targetRoot, 'whitepaper-wps-reviewer')).then(() => true).catch(() => false), false);
    assert.equal(await readFile(path.join(unrelated, 'SKILL.md'), 'utf8'), 'keep me');
    assert.equal(installed.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uninstallProductionSkills restores backups only when explicitly requested', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-skill-restore-'));
  const targetRoot = path.join(root, 'skills');
  const target = path.join(targetRoot, 'whitepaper-chief-editor');

  try {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'SKILL.md'), 'previous version');
    await installBundledSkill({ targetRoots: [targetRoot] });
    await uninstallProductionSkills({ targetRoots: [targetRoot], restoreBackup: true });

    assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), 'previous version');
    assert.equal(await access(path.join(targetRoot, 'whitepaper-wps-reviewer')).then(() => true).catch(() => false), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
