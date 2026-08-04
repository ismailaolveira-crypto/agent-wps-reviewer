#!/usr/bin/env node
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReleaseFiles, validateReleaseMetadata } from './build-release.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPRODUCIBLE_MTIME = new Date('2020-01-01T00:00:00.000Z');

const PLATFORM_DEFINITIONS = {
  macos: {
    archiveSuffix: 'macos',
    installer: 'setup.command',
    excludedRootInstaller: 'setup.cmd',
    quickstart: 'docs/MACOS_QUICKSTART.md',
    supported: ['macOS arm64', 'macOS x64']
  },
  windows: {
    archiveSuffix: 'windows-x64',
    installer: 'setup.cmd',
    excludedRootInstaller: 'setup.command',
    quickstart: 'docs/WINDOWS_QUICKSTART.md',
    supported: ['Windows 10 x64', 'Windows 11 x64']
  }
};

function startHere({ platform, installer }) {
  const run = platform === 'macos' ? 'bash setup.command' : 'setup.cmd';
  return `# 开始使用\n\n这是 Agent WPS Reviewer ${platform === 'macos' ? 'macOS' : 'Windows x64'} 同事版。\n\n1. 确认已安装 WPS Office 和 Node.js 20+。\n2. 运行唯一安装入口：\`${run}\`。\n3. 安装完成后运行：\`npm run doctor\`。\n4. WorkBuddy 自助配置请读取：\`WORKBUDDY_SETUP.md\`。\n\n本包的安装入口是 \`${installer}\`。当前只发布 WPS 批注与数据对齐接口，不会自动替换正文。\n`;
}

async function digest(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function stageFiles(files, extras) {
  const staging = await mkdtemp(path.join(tmpdir(), 'agent-wps-platform-release-'));
  try {
    for (const relativePath of files) {
      const source = path.join(PROJECT_ROOT, relativePath);
      const target = path.join(staging, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      const sourceStat = await stat(source);
      await chmod(target, sourceStat.mode & 0o777);
      await utimes(target, REPRODUCIBLE_MTIME, REPRODUCIBLE_MTIME);
    }
    for (const [relativePath, content] of Object.entries(extras)) {
      const target = path.join(staging, relativePath);
      await writeFile(target, content, 'utf8');
      await utimes(target, REPRODUCIBLE_MTIME, REPRODUCIBLE_MTIME);
    }
    return staging;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function buildPlatformRelease(platform) {
  const definition = PLATFORM_DEFINITIONS[platform];
  if (!definition) throw new Error(`Unsupported release platform: ${platform}`);
  const pkg = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const productManifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'config/product-manifest.json'), 'utf8'));
  const releaseMetadata = validateReleaseMetadata(productManifest);
  if (!releaseMetadata.ok) throw new Error(`Invalid release metadata: ${releaseMetadata.errors.join('; ')}`);

  const sourceFiles = (await collectReleaseFiles()).filter((file) => file !== definition.excludedRootInstaller);
  const platformConfig = {
    schemaVersion: 1,
    product: pkg.name,
    productVersion: pkg.version,
    platform,
    supported: definition.supported,
    installer: definition.installer,
    quickstart: definition.quickstart,
    workbuddyGuide: 'WORKBUDDY_SETUP.md',
    mcpServerName: 'agent-wps-reviewer',
    capabilities: ['wps-comment', 'document-selection', 'data-evidence-alignment'],
    disabledCapabilities: ['docx-redline', 'pdf-replica'],
    release: productManifest.release
  };
  const generatedFiles = ['START_HERE.md', 'platform-config.json'];
  const archiveFiles = [...sourceFiles, ...generatedFiles].sort();
  const extras = {
    'START_HERE.md': startHere({ platform, installer: definition.installer }),
    'platform-config.json': `${JSON.stringify(platformConfig, null, 2)}\n`
  };

  const distDir = path.join(PROJECT_ROOT, 'dist');
  const basename = `${pkg.name}-${pkg.version}-${definition.archiveSuffix}`;
  const zipPath = path.join(distDir, `${basename}.zip`);
  const manifestPath = path.join(distDir, `${basename}-manifest.json`);
  const tempZip = path.join(distDir, `.${basename}.${process.pid}.zip.tmp`);
  const tempManifest = path.join(distDir, `.${basename}.${process.pid}.manifest.tmp`);
  await mkdir(distDir, { recursive: true });
  await rm(tempZip, { force: true });
  await rm(tempManifest, { force: true });

  const staging = await stageFiles(sourceFiles, extras);
  try {
    const result = spawnSync('zip', ['-q', '-X', '-D', tempZip, ...archiveFiles], { cwd: staging, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'zip failed');
    const manifest = {
      name: pkg.name,
      version: pkg.version,
      platform,
      release: productManifest.release,
      zip: path.basename(zipPath),
      sha256: await digest(tempZip),
      files: archiveFiles
    };
    await writeFile(tempManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(tempZip, zipPath);
    await rename(tempManifest, manifestPath);
    return { platform, zipPath, manifestPath, fileCount: archiveFiles.length, sha256: manifest.sha256 };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(tempZip, { force: true });
    await rm(tempManifest, { force: true });
  }
}

export async function buildPlatformReleases() {
  return {
    macos: await buildPlatformRelease('macos'),
    windows: await buildPlatformRelease('windows')
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  console.log(JSON.stringify(await buildPlatformReleases(), null, 2));
}
