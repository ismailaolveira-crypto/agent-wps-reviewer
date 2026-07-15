import { access, copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.playwright-cli',
  '.superpowers',
  'data',
  'dist',
  'node_modules',
  'output',
  'test'
]);

function isExcluded(relativePath, entry) {
  if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) return true;
  return relativePath === 'docs/superpowers' || relativePath.startsWith('docs/superpowers/');
}

async function copyTree(sourceRoot, targetRoot, relativePath = '') {
  const sourceDir = path.join(sourceRoot, relativePath);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (isExcluded(childRelative, entry)) continue;
    const sourcePath = path.join(sourceRoot, childRelative);
    const targetPath = path.join(targetRoot, childRelative);
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyTree(sourceRoot, targetRoot, childRelative);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function exists(filePath) {
  return access(filePath).then(() => true).catch(() => false);
}

async function validateBundle(root) {
  const required = [
    'package.json',
    'config/product-manifest.json',
    'src/bridge/server.mjs',
    'scripts/setup.mjs',
    'setup.cmd'
  ];
  const missing = [];
  for (const relative of required) {
    if (!(await exists(path.join(root, relative)))) missing.push(relative);
  }
  if (missing.length) {
    const error = new Error(`Stable Windows bundle is missing required files: ${missing.join(', ')}`);
    error.code = 'WINDOWS_BUNDLE_INCOMPLETE';
    error.missing = missing;
    throw error;
  }
}

/**
 * Copy a release/runtime tree to the user-scoped Windows app directory.
 * The swap is deliberately platform-neutral so it can be fixture-tested on macOS.
 */
export async function installStableWindowsBundle({
  platform = process.platform,
  sourceRoot,
  targetRoot,
  transactionId = `${process.pid}-${Date.now()}`
} = {}) {
  if (platform !== 'win32') {
    return {
      ok: true,
      skipped: true,
      reason: 'stable Windows bundle is only used on win32',
      rollback: async () => {},
      cleanup: async () => {}
    };
  }
  if (!sourceRoot || !targetRoot) throw new Error('sourceRoot and targetRoot are required.');
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (source === target || target.startsWith(`${source}${path.sep}`)) {
    const error = new Error('Stable Windows target must be outside the source bundle.');
    error.code = 'WINDOWS_BUNDLE_TARGET_INVALID';
    throw error;
  }

  const nextPath = `${target}.next`;
  const previousPath = `${target}.previous`;
  const previousBackupPath = `${previousPath}.${transactionId}.backup`;
  await rm(nextPath, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await copyTree(source, nextPath);
  await validateBundle(nextPath);

  let hadTarget = await exists(target);
  let hadPrevious = await exists(previousPath);
  let movedTarget = false;
  let movedPrevious = false;
  try {
    if (hadPrevious) {
      await rename(previousPath, previousBackupPath);
      movedPrevious = true;
    }
    if (hadTarget) {
      await rename(target, previousPath);
      movedTarget = true;
    }
    await rename(nextPath, target);
  } catch (error) {
    await rm(nextPath, { recursive: true, force: true });
    if (movedTarget) {
      await rm(target, { recursive: true, force: true });
      await rename(previousPath, target).catch(() => undefined);
    }
    if (movedPrevious) await rename(previousBackupPath, previousPath).catch(() => undefined);
    throw error;
  }

  let finalized = false;
  return {
    ok: true,
    skipped: false,
    sourceRoot: source,
    targetRoot: target,
    nextPath,
    previousPath,
    hadTarget,
    hadPrevious,
    cleanup: async () => {
      if (finalized) return;
      finalized = true;
      await rm(previousPath, { recursive: true, force: true });
      await rm(previousBackupPath, { recursive: true, force: true });
    },
    rollback: async () => {
      if (finalized) return;
      finalized = true;
      await rm(target, { recursive: true, force: true });
      if (movedTarget) await rename(previousPath, target).catch(() => undefined);
      if (movedPrevious) await rename(previousBackupPath, previousPath).catch(() => undefined);
      await rm(nextPath, { recursive: true, force: true });
    }
  };
}

export async function readStableWindowsBundleStatus({ platform = process.platform, targetRoot } = {}) {
  if (platform !== 'win32') return { checked: false, platform, exists: false };
  const root = path.resolve(targetRoot || '');
  const packagePath = path.join(root, 'package.json');
  const existsNow = await exists(packagePath);
  return {
    checked: true,
    platform,
    root,
    exists: existsNow,
    packagePath,
    valid: existsNow && (await stat(packagePath)).isFile()
  };
}
