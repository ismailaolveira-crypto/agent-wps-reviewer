import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createBridgeServer } from '../src/bridge/server.mjs';
import { makeFormalBatch, makeFormalSuggestion } from './helpers/whitepaper-review-fixture.mjs';

async function withBridge(fn) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-active-acceptance-'));
  const { server, commandBroker } = await createBridgeServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn({ baseUrl, dataDir, commandBroker });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `${pathname} returned ${response.status}`);
  return response.json();
}

async function withMcp(baseUrl, fn) {
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

  try {
    let nextId = 1;
    await fn({
      async request(method, params = {}) {
        const id = nextId;
        nextId += 1;
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        const started = Date.now();
        while (Date.now() - started < 3000) {
          const response = lines.find((item) => item.id === id);
          if (response) return response;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Timed out waiting for ${method}`);
      }
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit').catch(() => undefined);
    }
  }
}

function readToolText(response) {
  assert.equal(response.result?.content?.[0]?.type, 'text');
  return response.result.content[0].text;
}

test('fake WPS connector active document flow reads B in chunks and targets suggestions only to B', async () => {
  await withBridge(async ({ baseUrl, dataDir, commandBroker }) => {
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-a',
      documentHandle: 'doc-a',
      title: 'A.docx',
      textLength: 4,
      revisionToken: 'sha256:a',
      lastActiveAt: Date.now() - 1000
    });
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-b',
      documentHandle: 'doc-b',
      title: 'B.docx',
      textLength: 16,
      revisionToken: 'sha256:b',
      lastActiveAt: Date.now()
    });

    commandBroker.subscribe('wps-b', (command) => {
      assert.equal(command.payload.documentHandle, 'doc-b');
      commandBroker.resolve(command.id, {
        text: 'B 文档正文片段',
        nextOffset: 9,
        done: true,
        revisionToken: 'sha256:b'
      });
    });

    await withMcp(baseUrl, async (mcp) => {
      await mcp.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'acceptance-test', version: '0.1.0' }
      });

      const active = JSON.parse(
        readToolText(await mcp.request('tools/call', { name: 'get_active_wps_document', arguments: {} }))
      );
      assert.equal(active.documentHandle, 'doc-b');

      const read = JSON.parse(
        readToolText(
          await mcp.request('tools/call', {
            name: 'read_wps_document',
            arguments: { documentHandle: 'doc-b', offset: 0, limit: 32000 }
          })
        )
      );
      assert.equal(read.text, 'B 文档正文片段');
      assert.equal(read.revisionToken, 'sha256:b');

      const submitted = readToolText(
        await mcp.request('tools/call', {
          name: 'submit_wps_suggestions',
          arguments: makeFormalBatch({
            documentHandle: 'doc-b',
            revisionToken: 'sha256:b',
            suggestions: [
              makeFormalSuggestion({
                candidateId: 'candidate-1',
                anchorText: 'B 文档',
                contextBefore: '',
                contextAfter: '正文片段',
                keyTerm: '正文片段'
              }),
              makeFormalSuggestion({
                candidateId: 'candidate-2',
                anchorText: '正文片段',
                contextBefore: 'B 文档',
                contextAfter: '',
                keyTerm: '正文片段'
              })
            ]
          })
        })
      );
      assert.match(submitted, /提交 2 条/);
    });

    const listB = await (await fetch(`${baseUrl}/api/suggestions?docSessionId=doc-b`)).json();
    const listA = await (await fetch(`${baseUrl}/api/suggestions?docSessionId=doc-a`)).json();
    assert.equal(listB.suggestions.length, 2);
    assert.equal(listA.suggestions.length, 0);

    const persisted = await readFile(path.join(dataDir, 'review-store.json'), 'utf8');
    assert.equal(persisted.includes('B 文档正文片段'), false);
  });
});
