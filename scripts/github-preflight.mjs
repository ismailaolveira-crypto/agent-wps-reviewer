#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReleaseFiles } from './build-release.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FILES = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'package-lock.json',
  '.gitignore',
  'ci/github-actions.yml',
  'config/product-manifest.json',
  'skills/whitepaper-chief-editor/SKILL.md',
  'skills/whitepaper-chief-editor/references/capability-manifest.json',
  'skills/whitepaper-wps-reviewer/SKILL.md',
  'docs/RELEASE.md'
];
const FORBIDDEN_CONTENT = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/private\/tmp\//,
  /\.cache\/codex-runtimes\//
];

async function exists(relativePath) {
  try {
    await access(path.join(PROJECT_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function gitState() {
  const root = spawnSync('git', ['-C', PROJECT_ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (root.status !== 0) return { initialized: false, status: 'not-initialized' };
  const status = spawnSync('git', ['-C', PROJECT_ROOT, 'status', '--short'], { encoding: 'utf8' });
  return {
    initialized: true,
    root: String(root.stdout || '').trim(),
    clean: status.status === 0 && !String(status.stdout || '').trim(),
    porcelain: String(status.stdout || '').trim().split('\n').filter(Boolean)
  };
}

const required = [];
for (const relativePath of REQUIRED_FILES) {
  required.push({ path: relativePath, ok: await exists(relativePath) });
}

const releaseFiles = await collectReleaseFiles();
const sensitiveFiles = [];
for (const relativePath of releaseFiles) {
  const content = await readFile(path.join(PROJECT_ROOT, relativePath), 'utf8');
  if (FORBIDDEN_CONTENT.some((pattern) => pattern.test(content))) sensitiveFiles.push(relativePath);
}

const git = gitState();
const sourceReady = required.every((item) => item.ok) && sensitiveFiles.length === 0;
const report = {
  ok: sourceReady && git.initialized,
  sourceReady,
  gitReady: git.initialized,
  generatedAt: new Date().toISOString(),
  required,
  release: {
    fileCount: releaseFiles.length,
    sensitiveFiles
  },
  git,
  nextSteps: git.initialized
    ? (git.clean ? [] : ['检查并整理 git status 中的变更后再提交。'])
    : ['确认用户允许后，再初始化 Git 仓库并设置远程 origin；本检查不会自动执行这一步。']
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
