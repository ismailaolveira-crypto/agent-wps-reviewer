#!/usr/bin/env node
import path from 'node:path';
import { ensureAgentToken } from '../src/install/agentToken.mjs';
import { installMcpClients, inspectMcpClients, uninstallMcpClients } from '../src/install/mcpConfig.mjs';

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = rest[index + 1];
    if (value && !value.startsWith('--')) {
      flags[key] = value;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

const { command, flags } = parseArgs(process.argv.slice(2));
const projectRoot = flags['project-root'] ? path.resolve(flags['project-root']) : process.cwd();
const nodePath = flags.node || process.execPath;
const mcpPath = flags['mcp-path']
  ? path.resolve(flags['mcp-path'])
  : path.resolve(projectRoot, 'bin/wps-reviewer-mcp.mjs');

if (command === 'install') {
  const token = await ensureAgentToken({ tokenPath: flags['token-file'] || undefined });
  const result = await installMcpClients({
    nodePath,
    mcpPath,
    tokenPath: token.tokenPath
  });
  console.log(JSON.stringify({
    ...result,
    tokenPath: token.tokenPath,
    tokenCreated: token.created
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === 'status') {
  const result = await inspectMcpClients();
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'uninstall') {
  const result = await uninstallMcpClients();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  console.error('Usage: node scripts/mcp-config.mjs [status|install|uninstall]');
  process.exitCode = 2;
}
