import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteWindowsArgument, windowsCommandShell } from '../platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DEFAULT_MCP_NAME = 'agent-wps-reviewer';

export function quoteWindowsCommandArg(value) {
  return quoteWindowsArgument(value);
}

function runCommand({ command, args, env = process.env, cwd = PROJECT_ROOT, timeoutMs = 10000, platform = process.platform }) {
  const useShell = platform === 'win32' && (/\.(?:cmd|bat)$/i.test(command) || !path.isAbsolute(command));
  const executable = useShell ? windowsCommandShell({ env }) : command;
  const commandArgs = useShell
    ? ['/d', '/s', '/c', [quoteWindowsCommandArg(command), ...args.map(quoteWindowsCommandArg)].join(' ')]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  });
  return {
    code: result.status,
    signal: result.signal,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error || null
  };
}

function isMissingCommand(result) {
  return result.error?.code === 'ENOENT';
}

export function buildCodexMcpAddArgs({
  name = DEFAULT_MCP_NAME,
  nodePath = process.execPath,
  mcpPath = path.join(PROJECT_ROOT, 'bin/wps-reviewer-mcp.mjs'),
  tokenPath
} = {}) {
  const args = ['mcp', 'add'];
  if (tokenPath) args.push('--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`);
  args.push(name, '--', nodePath, mcpPath);
  return args;
}

export function buildClaudeMcpAddArgs({
  name = DEFAULT_MCP_NAME,
  nodePath = process.execPath,
  mcpPath = path.join(PROJECT_ROOT, 'bin/wps-reviewer-mcp.mjs'),
  tokenPath
} = {}) {
  const args = ['mcp', 'add', name];
  if (tokenPath) args.push('--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`);
  args.push('--', nodePath, mcpPath);
  return args;
}

export function buildWorkBuddyMcpAddArgs({
  name = DEFAULT_MCP_NAME,
  nodePath = process.execPath,
  mcpPath = path.join(PROJECT_ROOT, 'bin/wps-reviewer-mcp.mjs')
} = {}) {
  // The MCP server reads the product token from its standard per-user file,
  // so WorkBuddy does not need a copied secret in its CLI configuration.
  return ['mcp', 'add', name, nodePath, mcpPath];
}

const CLIENTS = [
  { id: 'codex', command: 'codex', add: buildCodexMcpAddArgs },
  { id: 'claude', command: 'claude', add: buildClaudeMcpAddArgs },
  { id: 'workbuddy', command: 'codebuddy', add: buildWorkBuddyMcpAddArgs }
];

function clientDefinition(client, cliPaths = {}) {
  return { ...client, command: cliPaths[client.id] || client.command };
}

async function run(runner, request) {
  return await runner(request);
}

export async function inspectMcpClients({
  name = DEFAULT_MCP_NAME,
  cliPaths = {},
  runner = runCommand,
  env = process.env,
  cwd = PROJECT_ROOT,
  platform = process.platform
} = {}) {
  const clients = [];
  for (const baseClient of CLIENTS) {
    const client = clientDefinition(baseClient, cliPaths);
    const result = await run(runner, {
      command: client.command,
      args: [client.id === 'codex' ? 'mcp' : 'mcp', 'get', name, ...(client.id === 'codex' ? ['--json'] : [])],
      env,
      cwd,
      platform
    });
    clients.push({
      id: client.id,
      command: client.command,
      available: !isMissingCommand(result),
      configured: result.code === 0,
      status: result.code === 0 ? 'configured' : isMissingCommand(result) ? 'unavailable' : 'not-configured'
    });
  }
  return { name, clients };
}

export async function installMcpClients({
  name = DEFAULT_MCP_NAME,
  nodePath = process.execPath,
  mcpPath = path.join(PROJECT_ROOT, 'bin/wps-reviewer-mcp.mjs'),
  tokenPath,
  cliPaths = {},
  runner = runCommand,
  env = process.env,
  cwd = PROJECT_ROOT,
  platform = process.platform
} = {}) {
  const results = [];
  const mutations = [];
  for (const baseClient of CLIENTS) {
    const client = clientDefinition(baseClient, cliPaths);
    const getArgs = ['mcp', 'get', name, ...(client.id === 'codex' ? ['--json'] : [])];
    const existing = await run(runner, { command: client.command, args: getArgs, env, cwd, platform });
    if (isMissingCommand(existing)) {
      results.push({ id: client.id, command: client.command, ok: true, configured: false, skipped: true, reason: 'cli-not-found' });
      continue;
    }

    if (existing.code === 0) {
      const removed = await run(runner, { command: client.command, args: ['mcp', 'remove', name], env, cwd, platform });
      if (removed.code !== 0) {
        results.push({ id: client.id, command: client.command, ok: false, configured: false, error: 'remove-existing-failed' });
        continue;
      }
    }

    const added = await run(runner, {
      command: client.command,
      args: client.add({ name, nodePath, mcpPath, tokenPath }),
      env,
      cwd,
      platform
    });
    mutations.push({
      client,
      hadExisting: existing.code === 0,
      addArgs: client.add({ name, nodePath, mcpPath, tokenPath }),
      added: added.code === 0,
      removedExisting: existing.code === 0
    });
    results.push({
      id: client.id,
      command: client.command,
      ok: added.code === 0,
      configured: added.code === 0,
      skipped: false,
      ...(added.code === 0 ? {} : { error: 'add-failed' })
    });
  }

  return {
    ok: results.every((result) => result.ok),
    name,
    clients: results,
    configured: results.filter((result) => result.configured).map((result) => result.id),
    skipped: results.filter((result) => result.skipped).map((result) => result.id),
    rollback: async () => {
      for (const mutation of [...mutations].reverse()) {
        if (!mutation.removedExisting && !mutation.added) continue;
        if (mutation.hadExisting) {
          await run(runner, { command: mutation.client.command, args: ['mcp', 'remove', name], env, cwd, platform }).catch(() => undefined);
          await run(runner, { command: mutation.client.command, args: mutation.addArgs, env, cwd, platform }).catch(() => undefined);
        } else if (mutation.added) {
          await run(runner, { command: mutation.client.command, args: ['mcp', 'remove', name], env, cwd, platform }).catch(() => undefined);
        }
      }
    },
    cleanup: async () => {}
  };
}

export async function uninstallMcpClients({
  name = DEFAULT_MCP_NAME,
  cliPaths = {},
  runner = runCommand,
  env = process.env,
  cwd = PROJECT_ROOT,
  platform = process.platform
} = {}) {
  const results = [];
  for (const baseClient of CLIENTS) {
    const client = clientDefinition(baseClient, cliPaths);
    const existing = await run(runner, {
      command: client.command,
      args: ['mcp', 'get', name, ...(client.id === 'codex' ? ['--json'] : [])],
      env,
      cwd,
      platform
    });
    if (isMissingCommand(existing) || existing.code !== 0) {
      results.push({ id: client.id, command: client.command, ok: true, removed: false, skipped: true });
      continue;
    }
    const removed = await run(runner, { command: client.command, args: ['mcp', 'remove', name], env, cwd, platform });
    results.push({ id: client.id, command: client.command, ok: removed.code === 0, removed: removed.code === 0, skipped: false });
  }
  return {
    ok: results.every((result) => result.ok),
    name,
    clients: results,
    removed: results.filter((result) => result.removed).map((result) => result.id)
  };
}

export { runCommand };
