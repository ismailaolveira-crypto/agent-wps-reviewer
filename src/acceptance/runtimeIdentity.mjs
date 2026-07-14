import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RUNTIME_ROOTS = ['bin', 'config', 'package-lock.json', 'package.json', 'public', 'schemas', 'scripts', 'skills', 'src'];
const IGNORED_DIRECTORIES = new Set(['.git', 'data', 'dist', 'docs', 'node_modules', 'output', 'test']);
const IGNORED_FILES = new Set(['scripts/record-product-demo-video.mjs', 'scripts/validate-responsive-ui.mjs']);

function collectFiles(projectRoot, relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) return [];
  if (statSync(absolutePath).isFile()) return [relativePath];

  const entries = readdirSync(absolutePath, { withFileTypes: true });

  const files = [];
  for (const entry of entries) {
    const childRelativePath = path.posix.join(relativePath, entry.name);
    if (IGNORED_FILES.has(childRelativePath)) continue;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) files.push(...collectFiles(projectRoot, childRelativePath));
      continue;
    }
    if (entry.isFile()) files.push(childRelativePath);
  }
  return files;
}

function runtimeFiles(projectRoot) {
  return [...new Set(RUNTIME_ROOTS.flatMap((root) => collectFiles(projectRoot, root)))].sort();
}

export function getRuntimeIdentity(projectRoot = PROJECT_ROOT) {
  const files = runtimeFiles(projectRoot);
  const hash = createHash('sha256');

  for (const relativePath of files) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) continue;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(absolutePath));
    hash.update('\0');
  }

  let productVersion = 'unknown';
  const packagePath = path.join(projectRoot, 'package.json');
  if (existsSync(packagePath)) {
    try {
      productVersion = String(JSON.parse(readFileSync(packagePath, 'utf8')).version || 'unknown');
    } catch {
      productVersion = 'unknown';
    }
  }

  return {
    productVersion,
    buildFingerprint: hash.digest('hex').slice(0, 32)
  };
}

export const CURRENT_RUNTIME_IDENTITY = getRuntimeIdentity();
