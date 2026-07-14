import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PRODUCT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'config/product-manifest.json');
export const BUNDLED_SKILL_NAME = 'whitepaper-wps-reviewer';

export function defaultSkillRoots({ homeDir = os.homedir() } = {}) {
  return [path.join(homeDir, '.codex', 'skills'), path.join(homeDir, '.claude', 'skills')];
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadProductManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.productionSkills) || manifest.productionSkills.length === 0) {
    throw new Error(`Product manifest has no production skills: ${manifestPath}`);
  }
  return manifest;
}

async function resolveSkillSources({ manifestPath, projectRoot = PROJECT_ROOT }) {
  const manifest = await loadProductManifest(manifestPath);
  const skills = manifest.productionSkills.map((entry) => ({
    name: entry.name,
    sourcePath: path.resolve(projectRoot, entry.source)
  }));

  const names = new Set();
  for (const skill of skills) {
    if (!skill.name || path.basename(skill.name) !== skill.name || names.has(skill.name)) {
      throw new Error(`Product manifest contains duplicate or empty skill name: ${skill.name || '<empty>'}`);
    }
    names.add(skill.name);
    if (!(await exists(path.join(skill.sourcePath, 'SKILL.md')))) {
      throw new Error(`Bundled skill is missing: ${skill.sourcePath}`);
    }
  }

  const userFacingSkill = String(manifest.userFacingSkill || skills[0]?.name || '').trim();
  if (!userFacingSkill || !skills.some((skill) => skill.name === userFacingSkill)) {
    throw new Error(`Product manifest userFacingSkill is not a production skill: ${userFacingSkill || '<empty>'}`);
  }

  const internalSkills = (manifest.internalSkills || []).map((entry) => ({
    name: entry.name,
    sourcePath: path.resolve(projectRoot, entry.source),
    target: String(entry.target || '')
  }));
  const internalNames = new Set();
  for (const skill of internalSkills) {
    if (!skill.name || path.basename(skill.name) !== skill.name || internalNames.has(skill.name)) {
      throw new Error(`Product manifest contains duplicate or empty internal skill name: ${skill.name || '<empty>'}`);
    }
    internalNames.add(skill.name);
    if (!skill.target || path.isAbsolute(skill.target) || skill.target.split('/').includes('..') ||
      !skill.target.startsWith(`${userFacingSkill}/`)) {
      throw new Error(`Product manifest contains an unsafe internal skill target: ${skill.target || '<empty>'}`);
    }
    if (!(await exists(path.join(skill.sourcePath, 'SKILL.md')))) {
      throw new Error(`Internal skill is missing: ${skill.sourcePath}`);
    }
  }

  const retiredTopLevelSkills = [...new Set(
    (manifest.retiredTopLevelSkills || []).map((name) => String(name || '').trim()).filter(Boolean)
  )];
  for (const name of retiredTopLevelSkills) {
    if (path.basename(name) !== name || skills.some((skill) => skill.name === name)) {
      throw new Error(`Product manifest contains an unsafe retired skill name: ${name}`);
    }
  }

  const resources = (manifest.resources || []).map((entry) => ({
    sourcePath: path.resolve(projectRoot, entry.source),
    target: entry.target
  }));
  for (const resource of resources) {
    if (!resource.target || path.isAbsolute(resource.target) || resource.target.split('/').includes('..')) {
      throw new Error(`Product manifest contains an unsafe resource target: ${resource.target || '<empty>'}`);
    }
    if (!(await exists(resource.sourcePath))) {
      throw new Error(`Bundled product resource is missing: ${resource.sourcePath}`);
    }
  }
  return { manifest, skills, internalSkills, retiredTopLevelSkills, resources, userFacingSkill };
}

function backupName(backupRoot, targetPath, stamp) {
  return path.join(backupRoot, `${path.basename(targetPath)}.backup-${stamp}`);
}

function backupRootFor(resolvedRoot) {
  return path.join(path.dirname(resolvedRoot), '.agent-wps-reviewer-backups', path.basename(resolvedRoot));
}

async function migrateLegacyBackups({ resolvedRoot, backupRoot, names, changes, now }) {
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const prefix = new Set(names.map((name) => `${name}.backup-`));
  const legacy = entries
    .filter((entry) => entry.isDirectory() && [...prefix].some((value) => entry.name.startsWith(value)))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (legacy.length === 0) return [];

  await mkdir(backupRoot, { recursive: true });
  const moved = [];
  for (const entry of legacy) {
    const sourcePath = path.join(resolvedRoot, entry.name);
    let targetPath = path.join(backupRoot, entry.name);
    if (await exists(targetPath)) {
      targetPath = path.join(backupRoot, `${entry.name}-${now().getTime()}`);
    }
    await rename(sourcePath, targetPath);
    changes.push({ targetPath: sourcePath, backupPath: targetPath });
    moved.push({ sourcePath, backupPath: targetPath });
  }
  return moved;
}

async function latestBackupFor({ resolvedRoot, name }) {
  const backupRoot = backupRootFor(resolvedRoot);
  try {
    const entries = await readdir(backupRoot, { withFileTypes: true });
    const prefix = `${name}.backup-`;
    const candidates = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => path.join(backupRoot, entry.name))
      .sort()
      .reverse();
    return candidates[0] || null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function installIntoRoot({ skills, internalSkills, retiredTopLevelSkills, resources, targetRoot, backup, now }) {
  const resolvedRoot = path.resolve(targetRoot);
  await mkdir(resolvedRoot, { recursive: true });
  const stageRoot = await mkdtemp(path.join(resolvedRoot, '.agent-wps-reviewer-stage-'));
  const stagedSkills = [];
  const changes = [];
  const backupRoot = backupRootFor(resolvedRoot);
  const stamp = now().toISOString().replaceAll(/[:.]/g, '-');

  const rollback = async () => {
    for (const change of [...changes].reverse()) {
      if (await exists(change.targetPath)) {
        await rm(change.targetPath, { recursive: true, force: true });
      }
      if (change.backupPath && (await exists(change.backupPath))) {
        await rename(change.backupPath, change.targetPath);
      }
    }
    await rm(stageRoot, { recursive: true, force: true });
  };

  try {
    await migrateLegacyBackups({
      resolvedRoot,
      backupRoot,
      names: [...skills.map((skill) => skill.name), ...retiredTopLevelSkills],
      changes,
      now
    });

    for (const skill of skills) {
      const stagedPath = path.join(stageRoot, skill.name);
      await cp(skill.sourcePath, stagedPath, { recursive: true });
      if (!(await exists(path.join(stagedPath, 'SKILL.md')))) {
        throw new Error(`Staged skill is missing SKILL.md: ${skill.name}`);
      }
      stagedSkills.push({ ...skill, stagedPath });
    }

    for (const skill of internalSkills) {
      const stagedPath = path.join(stageRoot, skill.target);
      await mkdir(path.dirname(stagedPath), { recursive: true });
      await cp(skill.sourcePath, stagedPath, { recursive: true });
      if (!(await exists(path.join(stagedPath, 'SKILL.md')))) {
        throw new Error(`Staged internal skill is missing SKILL.md: ${skill.name}`);
      }
    }

    for (const resource of resources) {
      const stagedPath = path.join(stageRoot, resource.target);
      await mkdir(path.dirname(stagedPath), { recursive: true });
      await cp(resource.sourcePath, stagedPath, { recursive: true });
    }

    const installations = [];
    for (const skill of stagedSkills) {
      const targetPath = path.join(resolvedRoot, skill.name);
      const hadExisting = await exists(targetPath);
      const backupPath = hadExisting ? backupName(backupRoot, targetPath, `${stamp}-${skill.name}`) : null;

      if (hadExisting) {
        await mkdir(backupRoot, { recursive: true });
        await rename(targetPath, backupPath);
      }
      try {
        await rename(skill.stagedPath, targetPath);
      } catch (error) {
        if (backupPath && (await exists(backupPath))) await rename(backupPath, targetPath);
        throw error;
      }

      changes.push({ targetPath, backupPath });
      installations.push({
        installed: true,
        name: skill.name,
        path: targetPath,
        backupRoot,
        backupPath: backup && backupPath ? backupPath : null
      });
    }

    const retired = [];
    for (const name of retiredTopLevelSkills) {
      const targetPath = path.join(resolvedRoot, name);
      if (!(await exists(targetPath))) continue;
      const backupPath = backupName(backupRoot, targetPath, `${stamp}-${name}`);
      await mkdir(backupRoot, { recursive: true });
      await rename(targetPath, backupPath);
      changes.push({ targetPath, backupPath });
      retired.push({ name, path: targetPath, backupPath: backup && backupPath ? backupPath : null });
    }

    await rm(stageRoot, { recursive: true, force: true });
    const cleanup = async () => {
      if (backup) return;
      for (const change of changes) {
        if (change.backupPath) await rm(change.backupPath, { recursive: true, force: true });
      }
    };

    return {
      targetRoot: resolvedRoot,
      backupRoot,
      installations,
      internalSkills: internalSkills.map((skill) => ({ name: skill.name, target: skill.target })),
      retiredSkills: retired,
      rollback,
      cleanup,
      ok: true
    };
  } catch (error) {
    await rollback();
    throw error;
  }
}

export async function installProductionSkills({
  manifestPath = PRODUCT_MANIFEST_PATH,
  projectRoot = PROJECT_ROOT,
  targetRoots = defaultSkillRoots(),
  backup = true,
  now = () => new Date(),
  deferCleanup = false
} = {}) {
  const { manifest, skills, internalSkills, retiredTopLevelSkills, resources, userFacingSkill } = await resolveSkillSources({ manifestPath, projectRoot });
  const roots = [...new Set(targetRoots.map((item) => path.resolve(item)))];
  const transactions = [];

  try {
    for (const targetRoot of roots) {
      transactions.push(await installIntoRoot({ skills, internalSkills, retiredTopLevelSkills, resources, targetRoot, backup, now }));
    }
  } catch (error) {
    for (const transaction of [...transactions].reverse()) {
      await transaction.rollback();
    }
    throw error;
  }

  const rollback = async () => {
    for (const transaction of [...transactions].reverse()) {
      await transaction.rollback();
    }
  };
  const cleanup = async () => {
    for (const transaction of transactions) {
      await transaction.cleanup();
    }
  };

  if (!deferCleanup) await cleanup();

  return {
    ok: transactions.every((transaction) => transaction.ok),
    manifestPath,
    manifestVersion: manifest.schemaVersion,
    userFacingSkill,
    skills: skills.map((skill) => skill.name),
    internalSkills: internalSkills.map((skill) => ({ name: skill.name, target: skill.target })),
    retiredTopLevelSkills,
    sourcePaths: skills.map((skill) => skill.sourcePath),
    resources: resources.map((resource) => ({ sourcePath: resource.sourcePath, target: resource.target })),
    installations: transactions.flatMap((transaction) => transaction.installations),
    retiredSkills: transactions.flatMap((transaction) => transaction.retiredSkills),
    rollback,
    cleanup
  };
}

export async function uninstallProductionSkills({
  manifestPath = PRODUCT_MANIFEST_PATH,
  projectRoot = PROJECT_ROOT,
  targetRoots = defaultSkillRoots(),
  restoreBackup = false
} = {}) {
  const { userFacingSkill, retiredTopLevelSkills } = await resolveSkillSources({ manifestPath, projectRoot });
  const names = [...new Set([userFacingSkill, ...retiredTopLevelSkills])];
  const roots = [...new Set(targetRoots.map((item) => path.resolve(item)))];
  const results = [];

  for (const targetRoot of roots) {
    const removed = [];
    const restored = [];
    for (const name of names) {
      const targetPath = path.join(targetRoot, name);
      if (await exists(targetPath)) {
        await rm(targetPath, { recursive: true, force: true });
        removed.push({ name, path: targetPath });
      }
    }
    if (restoreBackup) {
      for (const name of names) {
        const targetPath = path.join(targetRoot, name);
        if (await exists(targetPath)) continue;
        const backupPath = await latestBackupFor({ resolvedRoot: targetRoot, name });
        if (!backupPath) continue;
        await mkdir(path.dirname(targetPath), { recursive: true });
        await rename(backupPath, targetPath);
        restored.push({ name, path: targetPath, backupPath });
      }
    }
    results.push({ targetRoot, removed, restored, ok: true });
  }

  return {
    ok: results.every((result) => result.ok),
    manifestPath,
    userFacingSkill,
    retiredTopLevelSkills,
    restoreBackup,
    results
  };
}

// Backward-compatible name for callers that used the old single-skill installer.
// The production path now installs the complete user-facing Skill set.
export async function installBundledSkill(options = {}) {
  return installProductionSkills(options);
}
