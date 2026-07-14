#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createBridgeServer } from '../src/bridge/server.mjs';

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${stderr || stdout}`);
  }
  return stdout.trim();
}

async function callMcp(baseUrl) {
  const child = spawn(process.execPath, ['bin/wps-reviewer-mcp.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, WPS_REVIEWER_URL: baseUrl },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const lines = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) lines.push(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }
  });

  async function request(id, method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const started = Date.now();
    while (Date.now() - started < 3000) {
      const response = lines.find((line) => line.id === id);
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`MCP request timed out: ${method}`);
  }

  try {
    await request(1, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'background-validator', version: '0.1.0' }
    });
    await request(2, 'tools/call', {
      name: 'submit_wps_suggestion',
      arguments: {
        docSessionId: 'background-validation',
        sourceAgent: 'mcp-validator',
        anchorText: 'MCP 原文',
        comment: 'MCP 投递的后台验收建议'
      }
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit').catch(() => undefined);
    }
  }
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-background-'));
const { server } = await createBridgeServer({ dataDir, allowLegacySubmission: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const cliOutput = await runCommand(process.execPath, [
    'bin/wps-suggest.mjs',
    '--server',
    baseUrl,
    '--doc',
    'background-validation',
    '--agent',
    'cli-validator',
    '--anchor',
    'CLI 原文',
    '--comment',
    'CLI 投递的后台验收建议'
  ]);
  const cliSuggestion = JSON.parse(cliOutput).suggestions[0];

  await callMcp(baseUrl);

  const response = await fetch(`${baseUrl}/api/suggestions?docSessionId=background-validation`);
  const body = await response.json();
  if (body.suggestions.length !== 2) {
    throw new Error(`Expected 2 suggestions, received ${body.suggestions.length}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        bridge: baseUrl,
        cliSuggestionId: cliSuggestion.id,
        suggestionCount: body.suggestions.length,
        sources: body.suggestions.map((item) => item.sourceAgent).sort()
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
