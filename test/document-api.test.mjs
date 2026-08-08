import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DocumentCommandBroker } from '../src/bridge/documentCommandBroker.mjs';
import { DocumentRegistry } from '../src/bridge/documentRegistry.mjs';
import { createBridgeServer } from '../src/bridge/server.mjs';
import { makeFormalBatch, makeFormalSuggestion } from './helpers/whitepaper-review-fixture.mjs';

async function withServer(fn, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-document-api-'));
  const documentRegistry = new DocumentRegistry();
  const commandBroker = new DocumentCommandBroker();
  const { server, store } = await createBridgeServer({
    dataDir,
    agentToken: 'secret-token',
    documentRegistry,
    commandBroker,
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn({ baseUrl, dataDir, store, documentRegistry, commandBroker });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

function authHeaders(extra = {}) {
  return { authorization: 'Bearer secret-token', ...extra };
}

async function postJson(baseUrl, pathname, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(), ...headers },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

test('agent reads only the registered active WPS document through a request-scoped broker command', async () => {
  await withServer(async ({ baseUrl, commandBroker }) => {
    const registered = await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-1',
      documentHandle: 'doc-a',
      title: 'A.docx',
      textLength: 6,
      revisionToken: 'sha256:a',
      lastActiveAt: Date.now()
    });
    assert.equal(registered.response.status, 200);

    const unauthorized = await fetch(`${baseUrl}/api/agent/documents/active`);
    assert.equal(unauthorized.status, 401);

    const activeResponse = await fetch(`${baseUrl}/api/agent/documents/active`, {
      headers: authHeaders()
    });
    const active = await activeResponse.json();
    assert.equal(activeResponse.status, 200);
    assert.equal(active.document.documentHandle, 'doc-a');
    assert.equal(active.document.title, 'A.docx');

    const byCodeResponse = await fetch(
      `${baseUrl}/api/agent/documents/by-code/${encodeURIComponent(registered.body.document.connectionCode)}`,
      { headers: authHeaders() }
    );
    const byCode = await byCodeResponse.json();
    assert.equal(byCodeResponse.status, 200);
    assert.equal(byCode.document.documentHandle, 'doc-a');
    assert.equal(byCode.document.documentKey, registered.body.document.documentKey);

    commandBroker.subscribe('wps-1', (command) => {
      assert.equal(command.type, 'document.read');
      assert.deepEqual(command.payload, { documentHandle: 'doc-a', offset: 1, limit: 3 });
      commandBroker.resolve(command.id, {
        text: 'bcd',
        nextOffset: 4,
        done: false,
        revisionToken: 'sha256:a'
      });
    });

    const textResponse = await fetch(`${baseUrl}/api/agent/documents/doc-a/text?offset=1&limit=3`, {
      headers: authHeaders()
    });
    const textBody = await textResponse.json();

    assert.equal(textResponse.status, 200);
    assert.deepEqual(textBody, {
      documentHandle: 'doc-a',
      text: 'bcd',
      nextOffset: 4,
      done: false,
      revisionToken: 'sha256:a'
    });
  });
});

test('agent token authentication also accepts the WPS same-origin cookie', async () => {
  await withServer(async ({ baseUrl }) => {
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-cookie',
      documentHandle: 'doc-cookie',
      title: 'Cookie.docx',
      revisionToken: 'sha256:cookie',
      lastActiveAt: Date.now()
    });

    const response = await fetch(`${baseUrl}/api/agent/documents/active`, {
      headers: { cookie: 'wps-reviewer-token=secret-token' }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.document.documentHandle, 'doc-cookie');
  });
});

test('task pane can read active WPS metadata without exposing document text', async () => {
  await withServer(async ({ baseUrl }) => {
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-1',
      documentHandle: 'doc-pane',
      title: 'Pane.docx',
      textLength: 99,
      selectionText: '当前选中的段落',
      revisionToken: 'sha256:pane',
      lastActiveAt: Date.now()
    });

    const response = await fetch(`${baseUrl}/api/wps/documents/active`, { headers: authHeaders() });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.document.documentHandle, 'doc-pane');
    assert.equal(body.document.title, 'Pane.docx');
    assert.equal(body.document.selectionText, '当前选中的段落');
    assert.equal(Object.hasOwn(body.document, 'text'), false);
  });
});

test('WPS document heartbeats persist one logical session across changing runtime handles', async () => {
  await withServer(async ({ baseUrl, store }) => {
    for (const documentHandle of ['runtime-a', 'runtime-b', 'runtime-c']) {
      const registered = await postJson(baseUrl, '/api/wps/documents/active', {
        clientId: 'wps-heartbeat',
        documentHandle,
        documentKey: 'path:/docs/report.docx',
        identityKind: 'path',
        title: 'Report.docx',
        fullName: '/docs/Report.docx',
        lastSeenAt: Date.now(),
        lastActiveAt: Date.now()
      });
      assert.equal(registered.response.status, 200);
    }

    assert.deepEqual(store.listSessions().map((item) => item.docSessionId), ['path:/docs/report.docx']);
  });
});

test('bridge lists open background documents and activates the requested target by handle', async () => {
  await withServer(async ({ baseUrl, commandBroker }) => {
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-1',
      documentHandle: 'doc-active',
      title: 'Active.docx',
      fullName: '/tmp/Active.docx',
      lastSeenAt: Date.now(),
      lastActiveAt: Date.now()
    });
    await postJson(baseUrl, '/api/wps/documents/register', {
      clientId: 'wps-1',
      documentHandle: 'doc-background',
      title: 'Background.docx',
      fullName: '/tmp/Background.docx',
      isActive: false,
      lastSeenAt: Date.now(),
      lastActiveAt: 0
    });

    const documentsResponse = await fetch(`${baseUrl}/api/wps/documents`, { headers: authHeaders() });
    const documentsBody = await documentsResponse.json();
    assert.equal(documentsResponse.status, 200);
    assert.deepEqual(
      documentsBody.documents.map((item) => item.documentHandle),
      ['doc-active', 'doc-background']
    );
    assert.equal(documentsBody.documents[1].isActive, false);

    commandBroker.subscribe('wps-1', (command) => {
      assert.equal(command.type, 'document.activate');
      assert.deepEqual(command.payload, { documentHandle: 'doc-background' });
      commandBroker.resolve(command.id, {
        documentHandle: 'doc-background',
        title: 'Background.docx',
        fullName: '/tmp/Background.docx'
      });
    });

    const activation = await postJson(baseUrl, '/api/wps/documents/doc-background/activate', {});
    assert.equal(activation.response.status, 200);
    assert.equal(activation.body.document.documentHandle, 'doc-background');
    assert.equal(activation.body.document.isActive, true);

    const active = await (await fetch(`${baseUrl}/api/wps/documents/active`, { headers: authHeaders() })).json();
    assert.equal(active.document.documentHandle, 'doc-background');
  });
});

test('bridge resolves an old runtime handle to the reopened document automatically', async () => {
  await withServer(async ({ baseUrl, store, commandBroker }) => {
    await store.registerSession({ docSessionId: 'old-runtime-handle', docTitle: 'Report.docx' });
    await store.addValidatedSuggestions([{
      docSessionId: 'old-runtime-handle',
      anchorText: '目标原文',
      comment: '批注意见',
      metadata: {
        documentKey: 'path:/docs/report.docx',
        documentHandle: 'old-runtime-handle',
        documentTitle: 'Report.docx'
      }
    }]);

    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-reopened',
      documentHandle: 'new-runtime-handle',
      title: 'Report.docx',
      fullName: '/docs/Report.docx',
      lastSeenAt: Date.now(),
      lastActiveAt: Date.now()
    });

    commandBroker.subscribe('wps-reopened', (command) => {
      assert.equal(command.type, 'document.activate');
      assert.deepEqual(command.payload, { documentHandle: 'new-runtime-handle' });
      commandBroker.resolve(command.id, {
        documentHandle: 'new-runtime-handle',
        title: 'Report.docx',
        fullName: '/docs/Report.docx'
      });
    });

    const activation = await postJson(baseUrl, '/api/wps/documents/old-runtime-handle/activate', {});
    assert.equal(activation.response.status, 200);
    assert.equal(activation.body.document.documentHandle, 'new-runtime-handle');
  });
});

test('agent reads a registered background document by handle without requiring it to be active', async () => {
  await withServer(async ({ baseUrl, commandBroker }) => {
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-1',
      documentHandle: 'doc-active',
      title: 'Active.docx',
      revisionToken: 'sha256:active',
      lastSeenAt: Date.now(),
      lastActiveAt: Date.now()
    });
    await postJson(baseUrl, '/api/wps/documents/register', {
      clientId: 'wps-1',
      documentHandle: 'doc-background',
      title: 'Background.docx',
      isActive: false,
      revisionToken: 'sha256:background',
      lastSeenAt: Date.now(),
      lastActiveAt: 0
    });

    commandBroker.subscribe('wps-1', (command) => {
      assert.equal(command.type, 'document.read');
      assert.deepEqual(command.payload, { documentHandle: 'doc-background', offset: 0, limit: 32000 });
      commandBroker.resolve(command.id, {
        text: '后台文章正文',
        nextOffset: 6,
        done: true,
        revisionToken: 'sha256:background'
      });
    });

    const response = await fetch(`${baseUrl}/api/agent/documents/doc-background/text`, {
      headers: authHeaders()
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.documentHandle, 'doc-background');
    assert.equal(body.text, '后台文章正文');
  });
});

test('suggestions are isolated by durable document key across WPS runtime handles', async () => {
  await withServer(async ({ baseUrl, store }) => {
    await store.addValidatedSuggestions([
      {
        docSessionId: 'old-runtime-handle-a',
        anchorText: '文章 A 原文',
        comment: '文章 A 批注',
        metadata: { documentKey: 'path:/docs/a.docx', documentTitle: 'A.docx' }
      },
      {
        docSessionId: 'runtime-handle-b',
        anchorText: '文章 B 原文',
        comment: '文章 B 批注',
        metadata: { documentKey: 'path:/docs/b.docx', documentTitle: 'B.docx' }
      }
    ]);

    const response = await fetch(`${baseUrl}/api/suggestions?documentKey=path%3A%2Fdocs%2Fa.docx`, {
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.suggestions.length, 1);
    assert.equal(body.suggestions[0].comment, '文章 A 批注');
    assert.equal(body.suggestions[0].docSessionId, 'old-runtime-handle-a');
  });
});

test('batch submission rejects a stale revision without persisting suggestions', async () => {
  await withServer(async ({ baseUrl, store }) => {
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-1',
      documentHandle: 'doc-a',
      title: 'A.docx',
      fullName: '/docs/A.docx',
      revisionToken: 'sha256:fresh',
      lastActiveAt: Date.now()
    });

    const response = await postJson(
      baseUrl,
      '/api/agent/suggestions',
      {
        documentHandle: 'doc-a',
        revisionToken: 'sha256:old',
        sourceAgent: 'codex',
        suggestions: [{ anchorText: '原文', comment: '批注' }]
      },
      authHeaders()
    );

    assert.equal(response.response.status, 409);
    assert.match(response.body.error.message, /changed|变化|重新读取/i);
    assert.equal(store.listSuggestions().length, 0);
  });
});

test('batch submission maps suggestions to the active document without storing source document text', async () => {
  await withServer(async ({ baseUrl, dataDir, commandBroker }) => {
    const documentText = '前文一。第一处原文。后文一。前文二。第二处原文。后文二。';
    await postJson(baseUrl, '/api/wps/documents/active', {
      clientId: 'wps-1',
      documentHandle: 'doc-a',
      title: 'A.docx',
      fullName: '/docs/A.docx',
      textLength: documentText.length,
      revisionToken: 'sha256:fresh',
      lastActiveAt: Date.now()
    });

    commandBroker.subscribe('wps-1', (command) => {
      commandBroker.resolve(command.id, {
        text: documentText,
        nextOffset: documentText.length,
        done: true,
        revisionToken: 'sha256:fresh'
      });
    });

    const readResponse = await fetch(`${baseUrl}/api/agent/documents/doc-a/text`, {
      headers: authHeaders()
    });
    assert.equal(readResponse.status, 200);

    const submitted = await postJson(
      baseUrl,
      '/api/agent/suggestions',
      makeFormalBatch({
        suggestions: [
          makeFormalSuggestion({
            candidateId: 'candidate-1',
            anchorText: '第一处原文',
            contextBefore: '前文一。',
            contextAfter: '后文一。',
            keyTerm: '第一处原文'
          }),
          makeFormalSuggestion({
            candidateId: 'candidate-2',
            anchorText: '第二处原文',
            contextBefore: '前文二。',
            contextAfter: '后文二。',
            keyTerm: '第二处原文'
          })
        ]
      }),
      authHeaders()
    );

    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.documentHandle, 'doc-a');
    assert.equal(submitted.body.documentTitle, 'A.docx');
    assert.equal(submitted.body.suggestions.length, 2);
    assert.equal(submitted.body.suggestions[0].docSessionId, 'doc-a');
    assert.equal(submitted.body.suggestions[0].metadata.documentHandle, 'doc-a');
    assert.equal(submitted.body.suggestions[0].metadata.documentKey, 'path:/docs/a.docx');
    assert.equal(submitted.body.suggestions[0].metadata.revisionToken, 'sha256:fresh');
    assert.equal(submitted.body.suggestions[0].metadata.category, 'duplicate-compression');

    const persisted = await readFile(path.join(dataDir, 'review-store.json'), 'utf8');
    assert.equal(persisted.includes(documentText), false);
  });
});

test('json CORS headers are only emitted for trusted local add-in origins', async () => {
  await withServer(async ({ baseUrl }) => {
    const trusted = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'http://localhost:17531' }
    });
    assert.equal(trusted.headers.get('access-control-allow-origin'), 'http://localhost:17531');

    const untrusted = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'http://evil.example' }
    });
    assert.equal(untrusted.headers.get('access-control-allow-origin'), null);
  });
});
