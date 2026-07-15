#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installStableWindowsBundle } from '../src/install/stableWindowsBundle.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wps-windows-install-'));
const source = path.join(root, 'Agent WPS Reviewer (下载)');
const target = path.join(root, 'LocalAppData', 'Programs', 'Agent WPS Reviewer', 'app');
try {
  for (const directory of ['config', 'src/bridge', 'scripts']) await mkdir(path.join(source, directory), { recursive: true });
  await writeFile(path.join(source, 'package.json'), '{"name":"agent-wps-reviewer","version":"0.2.0"}\n');
  await writeFile(path.join(source, 'config/product-manifest.json'), '{}\n');
  await writeFile(path.join(source, 'src/bridge/server.mjs'), 'export {};\n');
  await writeFile(path.join(source, 'scripts/setup.mjs'), 'export {};\n');
  await writeFile(path.join(source, 'setup.cmd'), '@echo off\r\n');
  const result = await installStableWindowsBundle({ platform: 'win32', sourceRoot: source, targetRoot: target });
  assert.equal(result.ok, true);
  await access(path.join(target, 'package.json'));
  await result.cleanup();
  console.log(JSON.stringify({ ok: true, targetRoot: target, rollbackAvailable: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
