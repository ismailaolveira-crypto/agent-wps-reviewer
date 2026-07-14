import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createBridgeServer } from '../src/bridge/server.mjs';
import { ensureAgentToken } from '../src/install/agentToken.mjs';
import { makeFormalBatch, makeFormalSuggestion } from './helpers/whitepaper-review-fixture.mjs';

const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

async function withBridge(fn, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-mcp-'));
  const { server, commandBroker } = await createBridgeServer({ dataDir, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl, { commandBroker });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function withMcpProcess(baseUrl, fn, env = {}) {
  const child = spawn(process.execPath, ['bin/wps-reviewer-mcp.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      WPS_REVIEWER_URL: baseUrl,
      ...env
    },
    stdio: ['pipe', 'pipe', 'pipe']
  }, { allowLegacySubmission: true });

  const lines = [];
  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) lines.push(JSON.parse(line));
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });

  try {
    await fn({
      child,
      async request(method, params = {}) {
        const id = lines.length + 1;
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        const started = Date.now();
        while (Date.now() - started < 3000) {
          const response = lines.find((line) => line.id === id);
          if (response) return response;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Timed out waiting for MCP response to ${method}`);
      }
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit').catch(() => undefined);
    }
  }
}

test('MCP server exposes WPS reviewer tools and can submit a suggestion', async () => {
  await withBridge(async (baseUrl) => {
    await withMcpProcess(baseUrl, async (mcp) => {
      const initialize = await mcp.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'node-test', version: '0.0.0' }
      });
      assert.equal(initialize.result.serverInfo.name, 'agent-wps-reviewer');
      assert.equal(initialize.result.serverInfo.version, packageManifest.version);

      const tools = await mcp.request('tools/list');
      const names = tools.result.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        'get_active_wps_document',
        'get_wps_document_by_code',
        'list_wps_documents',
        'list_wps_suggestions',
        'read_wps_document',
        'submit_wps_suggestion',
        'submit_wps_suggestions'
      ]);

      const schema = JSON.parse(await readFile('schemas/wps-legacy-suggestion.schema.json', 'utf8'));
      const submitTool = tools.result.tools.find((tool) => tool.name === 'submit_wps_suggestion');
      assert.equal(submitTool.inputSchema.title, schema.title);
      assert.deepEqual(submitTool.inputSchema.properties.severity.enum, schema.properties.severity.enum);
      assert.ok(submitTool.inputSchema.required.includes('comment'));

      const submitted = await mcp.request('tools/call', {
        name: 'submit_wps_suggestion',
        arguments: {
          docSessionId: 'doc-mcp',
          sourceAgent: 'codex',
          anchorText: '原文',
          comment: '作为批注进入 WPS',
          replacement: '新文本'
        }
      });
      assert.equal(submitted.result.content[0].type, 'text');
      assert.match(submitted.result.content[0].text, /已提交/);

      const submittedWithAnchorObject = await mcp.request('tools/call', {
        name: 'submit_wps_suggestion',
        arguments: {
          docSessionId: 'doc-mcp',
          sourceAgent: 'codex',
          anchor: {
            text: '另一段原文',
            before: '上文',
            after: '下文'
          },
          comment: '对象形态锚点也应进入 WPS'
        }
      });
      assert.match(submittedWithAnchorObject.result.content[0].text, /已提交/);

      const list = await mcp.request('tools/call', {
        name: 'list_wps_suggestions',
        arguments: { docSessionId: 'doc-mcp' }
      });
      assert.match(list.result.content[0].text, /作为批注进入 WPS/);
      assert.match(list.result.content[0].text, /对象形态锚点也应进入 WPS/);
    });
  }, { allowLegacySubmission: true });
});

test('MCP active-document tools can read chunks and submit a targeted batch', async () => {
  await withBridge(async (baseUrl, { commandBroker }) => {
    await fetch(`${baseUrl}/api/wps/documents/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'wps-1',
        documentHandle: 'doc-active',
        title: 'Active.docx',
        textLength: 12,
        revisionToken: 'sha256:active',
        lastActiveAt: Date.now()
      })
    });

    commandBroker.subscribe('wps-1', (command) => {
      assert.equal(command.type, 'document.read');
      commandBroker.resolve(command.id, {
        text: '当前正文片段',
        nextOffset: 6,
        done: true,
        revisionToken: 'sha256:active'
      });
    });

    await withMcpProcess(baseUrl, async (mcp) => {
      await mcp.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'node-test', version: '0.0.0' }
      });

      const active = await mcp.request('tools/call', {
        name: 'get_active_wps_document',
        arguments: {}
      });
      assert.match(active.result.content[0].text, /doc-active/);

      const documents = await mcp.request('tools/call', {
        name: 'list_wps_documents',
        arguments: {}
      });
      assert.match(documents.result.content[0].text, /doc-active/);
      const listedDocuments = JSON.parse(documents.result.content[0].text);
      const connectionCode = listedDocuments[0].connectionCode;
      assert.match(connectionCode, /^WPS-/);

      const resolved = await mcp.request('tools/call', {
        name: 'get_wps_document_by_code',
        arguments: { connectionCode }
      });
      assert.match(resolved.result.content[0].text, /doc-active/);

      const codeOnlyBatch = makeFormalBatch({
        documentHandle: undefined,
        revisionToken: undefined,
        suggestions: [makeFormalSuggestion({
          candidateId: 'candidate-code',
          anchorText: '当前正文',
          contextBefore: '',
          contextAfter: '片段',
          keyTerm: '当前正文'
        })]
      });
      delete codeOnlyBatch.documentHandle;
      delete codeOnlyBatch.revisionToken;
      codeOnlyBatch.connectionCode = connectionCode;
      const submittedByCode = await mcp.request('tools/call', {
        name: 'submit_wps_suggestions',
        arguments: codeOnlyBatch
      });
      assert.match(submittedByCode.result.content[0].text, /提交 1 条/);

      const read = await mcp.request('tools/call', {
        name: 'read_wps_document',
        arguments: { documentHandle: 'doc-active', offset: 0, limit: 12 }
      });
      assert.match(read.result.content[0].text, /当前正文片段/);

      const submitted = await mcp.request('tools/call', {
        name: 'submit_wps_suggestions',
        arguments: makeFormalBatch({
            documentHandle: 'doc-active',
            revisionToken: 'sha256:active',
            suggestions: [
              makeFormalSuggestion({
                candidateId: 'candidate-1',
                anchorText: '当前正文',
                contextAfter: '片段',
                contextBefore: '',
                keyTerm: '当前正文'
              }),
              makeFormalSuggestion({
                candidateId: 'candidate-2',
                anchorText: '正文片段',
                contextBefore: '当前',
                contextAfter: '',
                keyTerm: '正文片段'
              })
            ]
          })
      });
      assert.match(submitted.result.content[0].text, /提交 2 条/);

      const list = await mcp.request('tools/call', {
        name: 'list_wps_suggestions',
        arguments: { docSessionId: 'doc-active' }
      });
      assert.match(list.result.content[0].text, /当前正文|正文片段/);
      assert.match(list.result.content[0].text, /revisionToken/);
    });
  });
});

test('MCP server can submit suggestions with an agent token', async () => {
  await withBridge(
    async (baseUrl) => {
      await withMcpProcess(
        baseUrl,
        async (mcp) => {
          await mcp.request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'node-test', version: '0.0.0' }
          });

          const submitted = await mcp.request('tools/call', {
            name: 'submit_wps_suggestion',
            arguments: {
              docSessionId: 'token-doc',
              anchorText: '原文',
              comment: '带 token 的 MCP 投递'
            }
          });
          assert.match(submitted.result.content[0].text, /已提交/);
        },
        { WPS_REVIEWER_TOKEN: 'secret-token' }
      );
    },
    { agentToken: 'secret-token', allowLegacySubmission: true }
  );
});

test('MCP reads the installed token file when no token environment value is supplied', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-review-mcp-token-file-'));
  const tokenPath = path.join(root, 'agent-token');
  const tokenInfo = await ensureAgentToken({ tokenPath });

  try {
    await withBridge(
      async (baseUrl) => {
        await withMcpProcess(baseUrl, async (mcp) => {
          await mcp.request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'node-test', version: '0.0.0' }
          });
          const listed = await mcp.request('tools/call', {
            name: 'list_wps_suggestions',
            arguments: {}
          });
          assert.equal(listed.result.isError, undefined);
          assert.match(listed.result.content[0].text, /^\[/);
        }, { WPS_REVIEWER_TOKEN_FILE: tokenPath, WPS_REVIEWER_TOKEN: '' });
      },
      { agentToken: tokenInfo.token }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
