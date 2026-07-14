import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { checkMcpServer } from '../src/install/mcpHealth.mjs';

test('checkMcpServer completes MCP initialize without starting WPS or bridge', async () => {
  const result = await checkMcpServer({
    projectRoot: path.resolve(import.meta.dirname, '..')
  });

  assert.equal(result.ok, true);
  assert.equal(result.serverInfo.name, 'agent-wps-reviewer');
  assert.match(result.serverInfo.version, /^\d+\.\d+\.\d+$/);
});

test('checkMcpServer reports an incomplete release instead of throwing', async () => {
  const result = await checkMcpServer({ projectRoot: '/tmp/agent-wps-reviewer-missing' });

  assert.equal(result.ok, false);
  assert.equal(result.checked, false);
  assert.match(result.error, /missing/i);
});
