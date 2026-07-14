#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const execFileAsync = promisify(execFile);
const FIX = process.argv.includes('--fix');
const COMMAND_MARKER = 'node src/bridge/server.mjs';
const TEST_DATA_PATTERN = /\/T\/wps-local-(?:setup|install)-test-[^/]+\/data(?:$|\/)/;

async function run(command, args) {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    return String(result.stdout || '');
  } catch (error) {
    return String(error.stdout || '');
  }
}

function parseProcessList(output) {
  return output.split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) return null;
    return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
  }).filter((item) => item && item.ppid === 1 && item.command.includes(COMMAND_MARKER));
}

function environmentValue(command, name) {
  const match = command.match(new RegExp(`${name}=([^ ]*)`));
  return match ? match[1] : '';
}

async function currentWorkingDirectory(pid) {
  const output = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = output.split('\n').find((item) => item.startsWith('n'));
  return line ? line.slice(1) : '';
}

async function listeningPort(pid) {
  const output = await run('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn']);
  const ports = [...output.matchAll(/n[^:]+:(\d+)(?:\s*\(LISTEN\))?/g)].map((match) => Number(match[1]));
  return ports.find((port) => Number.isInteger(port)) || 0;
}

async function isOwnedTestBridge(candidate) {
  const dataDir = environmentValue(candidate.command, 'DATA_DIR');
  const cwd = await currentWorkingDirectory(candidate.pid);
  const port = await listeningPort(candidate.pid);
  if (cwd !== PROJECT_ROOT) return { safe: false, reason: 'cwd-mismatch', dataDir, port };
  if (!TEST_DATA_PATTERN.test(dataDir)) return { safe: false, reason: 'data-dir-not-test-temp', dataDir, port };
  if (!port || port === 17531) return { safe: false, reason: 'port-not-test-random-port', dataDir, port };

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();
    if (body.service !== 'agent-wps-reviewer') return { safe: false, reason: 'health-service-mismatch', dataDir, port };
  } catch {
    return { safe: false, reason: 'health-unavailable', dataDir, port };
  }
  return { safe: true, reason: 'owned-test-bridge', dataDir, port };
}

async function stop(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  const started = Date.now();
  while (Date.now() - started < 3000) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

const processes = parseProcessList(await run('ps', ['-axo', 'pid=,ppid=,command=']));
const candidates = [];
for (const process of processes) {
  const environment = await run('ps', ['eww', '-p', String(process.pid), '-o', 'command=']);
  const enriched = { ...process, command: environment.trim() || process.command };
  const ownership = await isOwnedTestBridge(enriched);
  candidates.push({ ...enriched, ...ownership });
}

const actions = [];
if (FIX) {
  for (const candidate of candidates.filter((item) => item.safe)) {
    actions.push({ pid: candidate.pid, port: candidate.port, stopped: await stop(candidate.pid) });
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: FIX ? 'fix' : 'report',
  projectRoot: PROJECT_ROOT,
  scanned: processes.length,
  safeCandidates: candidates.filter((item) => item.safe).length,
  candidates,
  actions
}, null, 2));
