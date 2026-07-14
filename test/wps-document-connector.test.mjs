import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

test('WPS document connector source subscribes to active-document and read command events', async () => {
  const source = await readFile('public/WpsAgentReviewer/document-connector.js', 'utf8');

  assert.match(source, /__WPS_REVIEWER_BRIDGE_ORIGIN__/);
  assert.match(source, /WindowActivate/);
  assert.match(source, /DocumentChange/);
  assert.match(source, /DocumentViewFocusIn/);
  assert.match(source, /HEARTBEAT_MS = 3000/);
  assert.match(source, /startHeartbeat/);
  assert.match(source, /heartbeat: true/);
  assert.match(source, /getOpenDocuments/);
  assert.match(source, /\/api\/wps\/documents\/register/);
  assert.match(source, /document\.activate/);
  assert.match(source, /Requested WPS document is not open/);
  assert.match(source, /document\.read/);
  assert.match(source, /crypto\.subtle\.digest/);
  assert.match(source, /typeof crypto === 'undefined'/);
  assert.match(source, /documentHandles: typeof WeakMap === 'function'/);
  assert.match(source, /\/api\/wps\/documents\/active/);
  assert.match(source, /\/api\/wps\/commands\?clientId=/);
  assert.match(source, /\/api\/wps\/commands\//);
});

test('WPS add-in loads document connector before bootstrap and starts it on add-in load', async () => {
  const index = await readFile('public/WpsAgentReviewer/index.html', 'utf8');
  const main = await readFile('public/WpsAgentReviewer/main.js', 'utf8');

  assert.ok(index.indexOf('./document-connector.js') < index.indexOf('./main.js'));
  assert.match(main, /WpsDocumentConnector\.start\(getApplication\(\)\)/);
});

async function loadConnector({ activateDocument, withoutWeakMap = false }) {
  const source = (await readFile('public/WpsAgentReviewer/document-connector.js', 'utf8'))
    .replaceAll('__WPS_REVIEWER_BRIDGE_ORIGIN__', 'http://bridge');
  const documentA = { Name: 'A.docx', FullName: '/docs/A.docx' };
  const documentB = { Name: 'B.docx', FullName: '/docs/B.docx', Activate: activateDocument };
  let activeDocument = documentA;
  const commandHandlers = {};
  const results = [];
  const documentHandles = new Map();
  const metadataByTitle = new Map();
  const selectionByTitle = new Map();
  const app = {
    get ActiveDocument() { return activeDocument; },
    Selection: { Range: { Text: '当前选中的段落' } },
    Documents: {
      Count: 2,
      Item(index) { return index === 0 || index === 1 ? documentA : documentB; }
    },
    ApiEvent: {
      AddApiEventListener() {}
    }
  };

  const bridgeFetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/wps/documents/register' || pathname === '/api/wps/documents/active') {
      const metadata = JSON.parse(options.body || '{}');
      documentHandles.set(metadata.title, metadata.documentHandle);
      metadataByTitle.set(metadata.title, metadata);
      selectionByTitle.set(metadata.title, metadata.selectionText || '');
    }
    if (pathname.startsWith('/api/wps/commands/') && pathname.endsWith('/result')) {
      results.push(JSON.parse(options.body));
    }
    return { ok: true, json: async () => ({ document: {} }) };
  };
  class FakeEventSource {
    addEventListener(name, handler) { commandHandlers[name] = handler; }
    close() {}
  }
  const context = {
    window: { fetch: bridgeFetch, EventSource: FakeEventSource },
    fetch: bridgeFetch,
    EventSource: FakeEventSource,
    setTimeout,
    clearTimeout,
    setInterval() { return 1; },
    clearInterval() {},
    Promise,
    Date,
    Math,
    console,
    URL
  };
  if (withoutWeakMap) context.WeakMap = undefined;
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'document-connector.js' });
  context.window.WpsDocumentConnector.start(app);
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    app,
    documentAHandle: documentHandles.get('A.docx'),
    documentB,
    documentBHandle: documentHandles.get('B.docx'),
    getDocumentBMetadata() { return metadataByTitle.get('B.docx'); },
    getDocumentBSelection() { return selectionByTitle.get('B.docx'); },
    sha256: context.window.WpsDocumentConnector.sha256,
    results,
    async send(command) {
      const before = results.length;
      await commandHandlers.command({ data: JSON.stringify(command) });
      const deadline = Date.now() + 1500;
      while (results.length === before && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return results.at(-1);
    },
    setActive(document) { activeDocument = document; }
  };
}

test('document connector confirms asynchronous activation even when WPS Activate returns undefined', async () => {
  let loaded = false;
  const connector = await loadConnector({
    activateDocument() {
      setTimeout(() => { loaded = true; }, 20);
    }
  });
  const originalActive = connector.app.ActiveDocument;
  assert.notEqual(connector.documentBHandle, undefined);
  connector.documentB.Activate = function () {
    setTimeout(() => {
      loaded = true;
      connector.setActive(connector.documentB);
    }, 20);
  };

  const result = await connector.send({ id: 'activate-1', type: 'document.activate', payload: { documentHandle: connector.documentBHandle } });
  assert.equal(connector.results.length > 0, true, JSON.stringify(connector.results));
  assert.equal(loaded, true);
  assert.notEqual(connector.app.ActiveDocument, originalActive);
  assert.equal(result.ok, true);
  assert.equal(typeof result.result.documentHandle, 'string');
  assert.equal(result.result.title, 'B.docx');
  assert.equal(connector.getDocumentBSelection(), '当前选中的段落');
});

test('document connector rejects a no-op activation instead of reporting success', async () => {
  const connector = await loadConnector({ activateDocument() {} });
  const result = await connector.send({ id: 'activate-2', type: 'document.activate', payload: { documentHandle: connector.documentBHandle } });
  assert.equal(result.ok, false);
  assert.match(result.error, /确认目标文档已激活/);
});

test('document connector keeps a document handle stable when its path changes', async () => {
  const connector = await loadConnector({ activateDocument() {} });
  const originalHandle = connector.documentBHandle;
  connector.documentB.FullName = '/docs/B-renamed-after-save.docx';

  const result = await connector.send({
    id: 'read-after-save',
    type: 'document.read',
    payload: { documentHandle: originalHandle, offset: 0, limit: 10 }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.revisionToken.startsWith(`sha256:${originalHandle}:`), true);
  assert.equal(connector.getDocumentBMetadata().documentKey, 'path:/docs/b.docx');
});

test('document connector falls back safely when WPS runtime has no crypto global', async () => {
  const connector = await loadConnector({ activateDocument() {} });
  const digest = await connector.sha256('stable fallback input');
  assert.match(digest, /^fallback-/);
});

test('document connector keeps stable handles without WeakMap support', async () => {
  const connector = await loadConnector({ activateDocument() {}, withoutWeakMap: true });
  const originalHandle = connector.documentBHandle;
  connector.documentB.FullName = '/docs/B-renamed-without-weakmap.docx';

  const result = await connector.send({
    id: 'read-after-save-without-weakmap',
    type: 'document.read',
    payload: { documentHandle: originalHandle, offset: 0, limit: 10 }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.revisionToken.startsWith(`sha256:${originalHandle}:`), true);
});

test('document connector reuses one handle when WPS returns repeated wrappers for a saved path', async () => {
  const connector = await loadConnector({ activateDocument() {} });
  const originalHandle = connector.documentAHandle;
  const duplicateA = { Name: 'A.docx', FullName: '/docs/A.docx' };
  const duplicateB = { Name: 'A.docx', FullName: '/docs/A.docx' };
  connector.app.Documents = {
    Count: 2,
    Item(index) { return index === 0 ? duplicateA : duplicateB; }
  };
  connector.setActive(duplicateA);

  const result = await connector.send({
    id: 'read-repeated-wrapper',
    type: 'document.read',
    payload: { documentHandle: originalHandle, offset: 0, limit: 10 }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.revisionToken.startsWith(`sha256:${originalHandle}:`), true);
});
