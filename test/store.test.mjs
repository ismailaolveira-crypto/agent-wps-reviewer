import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ReviewStore } from '../src/bridge/store.mjs';

async function createTempStore() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-store-'));
  const store = new ReviewStore({ dataDir });
  await store.load();
  return { dataDir, store };
}

test('ReviewStore registers sessions and persists suggestions', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    const session = await store.registerSession({
      docSessionId: 'doc-1',
      docTitle: 'Demo'
    });
    assert.equal(session.docSessionId, 'doc-1');

    const suggestion = await store.addSuggestion({
      docSessionId: 'doc-1',
      sourceAgent: 'codex',
      anchorText: '需要修改',
      comment: '加一条批注'
    });
    assert.equal(suggestion.status, 'pending');
    assert.equal(store.listSuggestions({ docSessionId: 'doc-1' }).length, 1);

    const nextStore = new ReviewStore({ dataDir });
    await nextStore.load();
    assert.equal(nextStore.listSuggestions({ docSessionId: 'doc-1' }).length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore rejects invalid suggestions', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    await assert.rejects(
      () => store.addSuggestion({ docSessionId: 'doc-1', comment: 'missing anchor' }),
      /Invalid suggestion/
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore atomically rejects a mixed valid and invalid batch', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    await assert.rejects(
      () =>
        store.addValidatedSuggestions([
          { docSessionId: 'doc-1', anchorText: '原文一', comment: '批注一' },
          { docSessionId: 'doc-1', comment: '缺少锚点' }
        ]),
      /Invalid suggestion/
    );
    assert.equal(store.listSuggestions().length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore persists a validated batch once and emits after saving', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    let saveCount = 0;
    const originalSave = store.save.bind(store);
    store.save = async () => {
      saveCount += 1;
      await originalSave();
    };
    const events = [];
    store.on('suggestion', (event) => events.push(event));

    const created = await store.addValidatedSuggestions([
      { docSessionId: 'doc-1', anchorText: '原文一', comment: '批注一' },
      { docSessionId: 'doc-1', anchorText: '原文二', comment: '批注二' }
    ]);

    assert.equal(created.length, 2);
    assert.equal(saveCount, 1);
    assert.equal(events.length, 2);
    assert.equal(store.listSuggestions({ docSessionId: 'doc-1' }).length, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore rolls back an atomic batch when persistence fails', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    store.save = async () => {
      throw new Error('disk unavailable');
    };

    await assert.rejects(
      () => store.addValidatedSuggestions([{ docSessionId: 'doc-1', anchorText: '原文', comment: '批注' }]),
      /disk unavailable/
    );
    assert.equal(store.listSuggestions().length, 0);
    assert.equal(store.listSessions().length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore updates status', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    const suggestion = await store.addSuggestion({
      docSessionId: 'doc-1',
      anchorText: '原文',
      comment: '批注'
    });

    const updated = await store.updateSuggestion(suggestion.id, {
      status: 'commented',
      resultMessage: 'done'
    });

    assert.equal(updated.status, 'commented');
    assert.equal(updated.resultMessage, 'done');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore binds legacy suggestions to a uniquely identified saved document', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    await store.registerSession({ docSessionId: 'old-handle', docTitle: '报告.docx' });
    const suggestion = await store.addSuggestion({
      docSessionId: 'old-handle',
      anchorText: '原文',
      comment: '批注'
    });
    const binding = await store.ensureDocumentBinding({
      documentKey: 'path:/docs/report.docx',
      title: '报告.docx',
      fullName: '/docs/report.docx',
      identityKind: 'path'
    });

    const rebound = await store.bindLegacySuggestions({
      documentHandle: 'new-handle',
      documentKey: 'path:/docs/report.docx',
      documentTitle: '报告.docx'
    });

    assert.equal(rebound, 1);
    assert.equal(store.listSuggestions({ documentKey: 'path:/docs/report.docx' })[0].id, suggestion.id);
    assert.equal(store.getSuggestion(suggestion.id).docSessionId, 'new-handle');
    assert.equal(store.getSuggestion(suggestion.id).metadata.documentHandle, 'new-handle');
    assert.deepEqual(store.getSuggestion(suggestion.id).metadata.previousDocumentHandles, ['old-handle']);
    assert.equal(store.getDocumentKeyByRuntimeHandle('old-handle'), 'path:/docs/report.docx');
    assert.equal(store.getSuggestion(suggestion.id).metadata.connectionCode, binding.connectionCode);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('ReviewStore gives each document key a stable unique connection code', async () => {
  const { dataDir, store } = await createTempStore();
  try {
    const first = await store.ensureDocumentBinding({
      documentKey: 'path:/docs/first.docx',
      title: '第一篇.docx',
      fullName: '/docs/first.docx',
      identityKind: 'path'
    });
    const same = await store.ensureDocumentBinding({
      documentKey: 'path:/docs/first.docx',
      title: '第一篇.docx',
      fullName: '/docs/first.docx',
      identityKind: 'path'
    });
    const second = await store.ensureDocumentBinding({
      documentKey: 'path:/docs/second.docx',
      title: '第二篇.docx',
      fullName: '/docs/second.docx',
      identityKind: 'path'
    });

    assert.match(first.connectionCode, /^WPS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(same.connectionCode, first.connectionCode);
    assert.notEqual(second.connectionCode, first.connectionCode);

    const reloaded = new ReviewStore({ dataDir });
    await reloaded.load();
    assert.equal(reloaded.getDocumentBindingByCode(first.connectionCode).documentKey, 'path:/docs/first.docx');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
