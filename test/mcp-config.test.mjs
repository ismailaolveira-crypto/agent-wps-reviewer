import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildClaudeMcpAddArgs,
  buildCodexMcpAddArgs,
  buildWorkBuddyMcpAddArgs,
  installMcpClients,
  inspectMcpClients,
  uninstallMcpClients
} from '../src/install/mcpConfig.mjs';

const tokenPath = '/tmp/agent-wps-reviewer-token';
const nodePath = '/tmp/node';
const mcpPath = '/tmp/agent-wps-reviewer/bin/wps-reviewer-mcp.mjs';

test('MCP add command construction keeps the token in a file and scopes the server name', () => {
  assert.deepEqual(buildCodexMcpAddArgs({ name: 'agent-wps-reviewer', nodePath, mcpPath, tokenPath }), [
    'mcp', 'add', '--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`, 'agent-wps-reviewer', '--', nodePath, mcpPath
  ]);
  assert.deepEqual(buildClaudeMcpAddArgs({ name: 'agent-wps-reviewer', nodePath, mcpPath, tokenPath }), [
    'mcp', 'add', 'agent-wps-reviewer', '--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`, '--', nodePath, mcpPath
  ]);
  assert.deepEqual(buildWorkBuddyMcpAddArgs({ name: 'agent-wps-reviewer', nodePath, mcpPath, tokenPath }), [
    'mcp', 'add', 'agent-wps-reviewer', nodePath, mcpPath
  ]);
});

test('MCP installer replaces only the product entry for available agent CLIs', async () => {
  const calls = [];
  const runner = async ({ command, args }) => {
    calls.push({ command, args });
    if (args[1] === 'get') {
      return { code: command === 'codex-test' ? 0 : 1, error: null, stdout: '', stderr: '' };
    }
    return { code: 0, error: null, stdout: '', stderr: '' };
  };

  const result = await installMcpClients({
    name: 'agent-wps-reviewer',
    nodePath,
    mcpPath,
    tokenPath,
    cliPaths: { codex: 'codex-test', claude: 'claude-test', workbuddy: 'workbuddy-test' },
    runner
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.configured, ['codex', 'claude', 'workbuddy']);
  assert.deepEqual(calls, [
    { command: 'codex-test', args: ['mcp', 'get', 'agent-wps-reviewer', '--json'] },
    { command: 'codex-test', args: ['mcp', 'remove', 'agent-wps-reviewer'] },
    { command: 'codex-test', args: ['mcp', 'add', '--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`, 'agent-wps-reviewer', '--', nodePath, mcpPath] },
    { command: 'claude-test', args: ['mcp', 'get', 'agent-wps-reviewer'] },
    { command: 'claude-test', args: ['mcp', 'add', 'agent-wps-reviewer', '--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`, '--', nodePath, mcpPath] },
    { command: 'workbuddy-test', args: ['mcp', 'get', 'agent-wps-reviewer'] },
    { command: 'workbuddy-test', args: ['mcp', 'add', 'agent-wps-reviewer', nodePath, mcpPath] }
  ]);
});

test('MCP installer treats missing CLIs as optional and does not fail setup', async () => {
  const result = await installMcpClients({
    cliPaths: { codex: 'missing-codex', claude: 'missing-claude', workbuddy: 'missing-workbuddy' },
    runner: async () => ({ code: null, error: { code: 'ENOENT' }, stdout: '', stderr: '' })
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skipped, ['codex', 'claude', 'workbuddy']);
  assert.deepEqual(result.configured, []);
});

test('MCP status and uninstall are read-only or scoped to the exact product name', async () => {
  const statusCalls = [];
  const status = await inspectMcpClients({
    name: 'agent-wps-reviewer',
    cliPaths: { codex: 'codex-test', claude: 'claude-test', workbuddy: 'workbuddy-test' },
    runner: async (request) => {
      statusCalls.push(request);
      return { code: 1, error: null, stdout: '', stderr: '' };
    }
  });
  assert.equal(status.clients.every((client) => client.configured === false), true);
  assert.equal(statusCalls.every((request) => request.args.includes('get')), true);

  const uninstallCalls = [];
  const removed = await uninstallMcpClients({
    name: 'agent-wps-reviewer',
    cliPaths: { codex: 'codex-test', claude: 'claude-test', workbuddy: 'workbuddy-test' },
    runner: async (request) => {
      uninstallCalls.push(request);
      return { code: 1, error: null, stdout: '', stderr: '' };
    }
  });
  assert.equal(removed.ok, true);
  assert.equal(uninstallCalls.every((request) => request.args.includes('get')), true);
  assert.equal(uninstallCalls.some((request) => request.args.includes('remove')), false);
});

test('MCP install transaction can roll back only the product entry', async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.args[1] === 'get') {
      return {
        code: request.command === 'codex-test' ? 0 : 1,
        error: null,
        stdout: '',
        stderr: ''
      };
    }
    return { code: 0, error: null, stdout: '', stderr: '' };
  };

  const result = await installMcpClients({
    name: 'agent-wps-reviewer',
    nodePath,
    mcpPath,
    tokenPath,
    cliPaths: { codex: 'codex-test', claude: 'claude-test', workbuddy: 'workbuddy-test' },
    runner
  });

  await result.rollback();
  const rollbackCalls = calls.slice(-4).map(({ command, args }) => ({ command, args }));
  assert.deepEqual(rollbackCalls, [
    { command: 'workbuddy-test', args: ['mcp', 'remove', 'agent-wps-reviewer'] },
    { command: 'claude-test', args: ['mcp', 'remove', 'agent-wps-reviewer'] },
    { command: 'codex-test', args: ['mcp', 'remove', 'agent-wps-reviewer'] },
    { command: 'codex-test', args: ['mcp', 'add', '--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`, 'agent-wps-reviewer', '--', nodePath, mcpPath] }
  ]);
});
