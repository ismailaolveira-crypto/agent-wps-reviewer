#!/usr/bin/env node
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { defaultWpsJsaddonsDir, platformSummary } from '../src/platform.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output' && argv[index + 1]) args.output = argv[++index];
  }
  return args;
}

function command(command, args = []) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    };
  } catch (error) {
    return { ok: false, error: error.code || String(error) };
  }
}

const args = parseArgs(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);
const outputDir = path.resolve(args.output || path.join('output/windows-probe', today));
const envNames = ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)'];
const env = Object.fromEntries(envNames.map((name) => [name, Boolean(process.env[name])]));
let jsaddonsDir = '';
try {
  jsaddonsDir = defaultWpsJsaddonsDir({ platform: process.platform, env: process.env });
} catch {
  jsaddonsDir = '';
}
let jsaddonsFiles = [];
if (jsaddonsDir) {
  try {
    jsaddonsFiles = (await readdir(jsaddonsDir)).filter((name) => /^(publish|jsplugins|authaddin|jsaddinblockhost)/i.test(name));
  } catch {
    jsaddonsFiles = [];
  }
}

const evidence = {
  generatedAt: new Date().toISOString(),
  supported: process.platform === 'win32',
  platform: platformSummary({ platform: process.platform, env: process.env }),
  node: process.version,
  npm: command(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']),
  os: { release: os.release(), version: typeof os.version === 'function' ? os.version() : '', arch: process.arch },
  environmentPresence: env,
  wps: {
    where: command('where.exe', ['wps.exe']),
    tasklist: command('tasklist.exe', ['/FI', 'IMAGENAME eq wps.exe', '/FO', 'CSV', '/NH']),
    jsaddonsDir,
    jsaddonsFiles,
    wpsjsVersion: command(process.platform === 'win32' ? 'wpsjs.cmd' : 'wpsjs', ['--version'])
  },
  networking: command('netstat.exe', ['-ano', '-p', 'tcp']),
  autostart: command('schtasks.exe', ['/Query', '/TN', 'Agent WPS Reviewer Bridge', '/FO', 'CSV', '/NH']),
  notes: [
    'This probe is read-only; it does not start, restart, focus, or edit WPS.',
    'Record the actual WPS trust page result, Comments.Add shape, detached console behavior, and clean-user install separately.'
  ]
};

await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'probe.json');
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputPath, supported: evidence.supported }, null, 2));
