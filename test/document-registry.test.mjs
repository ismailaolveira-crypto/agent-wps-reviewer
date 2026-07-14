import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentRegistry } from '../src/bridge/documentRegistry.mjs';

test('registry returns the most recently active fresh document', () => {
  const registry = new DocumentRegistry();

  registry.upsert({
    clientId: 'wps-1',
    documentHandle: 'doc-a',
    title: 'A.docx',
    textLength: 12,
    revisionToken: 'sha256:a',
    lastActiveAt: 1000
  });
  registry.upsert({
    clientId: 'wps-1',
    documentHandle: 'doc-b',
    title: 'B.docx',
    textLength: 24,
    revisionToken: 'sha256:b',
    lastActiveAt: 2000
  });

  assert.equal(registry.getActive({ now: 2500, maxAgeMs: 10000 }).documentHandle, 'doc-b');
});

test('registry rejects stale clients and removes closed clients', () => {
  const registry = new DocumentRegistry();

  registry.upsert({ clientId: 'wps-1', documentHandle: 'doc-a', lastActiveAt: 1000 });
  registry.upsert({ clientId: 'wps-2', documentHandle: 'doc-b', lastActiveAt: 2000 });

  assert.equal(registry.getActive({ now: 12001, maxAgeMs: 10000 }), null);
  assert.equal(registry.getByHandle('doc-b').clientId, 'wps-2');

  registry.removeClient('wps-2');

  assert.equal(registry.getByHandle('doc-b'), null);
});

test('registry lists fresh background documents without confusing them with the active document', () => {
  const registry = new DocumentRegistry();

  registry.upsert({
    clientId: 'wps-1',
    documentHandle: 'doc-active',
    title: 'Active.docx',
    isActive: true,
    lastSeenAt: 3000,
    lastActiveAt: 3000
  });
  registry.upsert({
    clientId: 'wps-1',
    documentHandle: 'doc-background',
    title: 'Background.docx',
    isActive: false,
    lastSeenAt: 4000,
    lastActiveAt: 0
  });

  assert.equal(registry.getActive({ now: 4500, maxAgeMs: 10000 }).documentHandle, 'doc-active');
  assert.deepEqual(
    registry.getAvailable({ now: 4500, maxAgeMs: 10000 }).map((item) => item.documentHandle),
    ['doc-active', 'doc-background']
  );

  registry.markActive('doc-background', { now: 5000 });
  assert.equal(registry.getActive({ now: 5000, maxAgeMs: 10000 }).documentHandle, 'doc-background');
  assert.equal(registry.getByHandle('doc-active').isActive, false);
});

test('registry merges repeated runtime handles for the same durable document key', () => {
  const registry = new DocumentRegistry();

  registry.upsert({
    clientId: 'wps-1',
    documentHandle: 'old-handle',
    documentKey: 'path:/docs/report.docx',
    title: 'report.docx',
    lastSeenAt: 1000
  });
  registry.upsert({
    clientId: 'wps-1',
    documentHandle: 'new-handle',
    documentKey: 'path:/docs/report.docx',
    title: 'report.docx',
    lastSeenAt: 2000
  });

  assert.equal(registry.getByHandle('old-handle'), null);
  assert.equal(registry.getAvailable({ now: 2500, maxAgeMs: 10000 }).length, 1);
  assert.equal(registry.getAvailable({ now: 2500, maxAgeMs: 10000 })[0].documentHandle, 'new-handle');
});
