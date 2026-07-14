import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createBridgeServer } from '../src/bridge/server.mjs';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const runtimeIdentity = getRuntimeIdentity();

async function withServer(fn, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-review-api-'));
  const { server } = await createBridgeServer({ dataDir, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('bridge health endpoint reports service', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'agent-wps-reviewer');
    assert.equal(body.productVersion, runtimeIdentity.productVersion);
    assert.equal(body.buildFingerprint, runtimeIdentity.buildFingerprint);
  });
});

test('bridge serves the WPS add-in directory entry', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/WpsAgentReviewer/`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(text, /WpsAgentReviewer/);
    assert.match(text, /ribbon\.xml/);
    assert.match(text, /main\.js/);
    assert.match(text, /<script src="\.\/main\.js"><\/script>/);
  });
});

test('bridge binds the task pane URL to the serving origin for custom ports', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/WpsAgentReviewer/main.js`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/addin/taskpane\\.html`));
    assert.doesNotMatch(text, /__WPS_REVIEWER_TASKPANE_URL__/);
  });
});

test('bridge binds the WPS document connector to the serving origin for custom ports', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/WpsAgentReviewer/document-connector.js`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, new RegExp(`var BRIDGE_ORIGIN = '${baseUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`));
    assert.doesNotMatch(text, /__WPS_REVIEWER_BRIDGE_ORIGIN__/);
    assert.doesNotMatch(text, /http:\/\/127\.0\.0\.1:17531/);
  });
});

test('configured bridge issues a same-origin HttpOnly credential for WPS pages', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/addin/taskpane.html`);
    const body = await response.text();
    const cookie = response.headers.get('set-cookie');

    assert.equal(response.status, 200);
    assert.match(cookie, /^wps-reviewer-token=secret-token;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(body, /secret-token/);
  }, { agentToken: 'secret-token' });
});

test('bridge accepts, lists, and updates suggestions', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        docSessionId: 'doc-1',
        sourceAgent: 'codex',
        anchorText: '原文片段',
        comment: '这里加批注',
        replacement: '替换文本'
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.suggestions.length, 1);

    const id = created.suggestions[0].id;
    const listResponse = await fetch(`${baseUrl}/api/suggestions?docSessionId=doc-1`);
    const listed = await listResponse.json();
    assert.equal(listed.suggestions.length, 1);

    const patchResponse = await fetch(`${baseUrl}/api/suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'commented', resultMessage: 'ok' })
    });
    const patched = await patchResponse.json();
    assert.equal(patched.suggestion.status, 'commented');
    assert.equal(patched.suggestion.resultMessage, 'ok');
  }, { allowLegacySubmission: true });
});

test('bridge records WPS acceptance events and ignores them for suggestion auth', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/acceptance/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer suggestions-only-token' },
      body: JSON.stringify({
        eventType: 'taskpane.opened',
        adapterMode: 'wps',
        docSessionId: 'doc-real',
        docTitle: 'Acceptance Test Document.docx',
        wpsVersion: '12.1.25895',
        productVersion: 'forged-version',
        buildFingerprint: 'forged-fingerprint'
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.event.eventType, 'taskpane.opened');
    assert.equal(created.event.adapterMode, 'wps');
    assert.equal(created.event.productVersion, runtimeIdentity.productVersion);
    assert.equal(created.event.buildFingerprint, runtimeIdentity.buildFingerprint);

    const listResponse = await fetch(`${baseUrl}/api/acceptance/events?docSessionId=doc-real`, {
      headers: { authorization: 'Bearer suggestions-only-token' }
    });
    const listed = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listed.events.length, 1);
  }, { agentToken: 'suggestions-only-token' });
});

test('bridge persists diagnostic action events without storing document text', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/acceptance/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer diagnostics-token' },
      body: JSON.stringify({
        eventType: 'suggestion.location.failed',
        adapterMode: 'wps',
        docSessionId: 'doc-real',
        suggestionId: 'sug-1',
        operationId: 'op-1',
        step: 'range.verify',
        reason: 'range_text_mismatch',
        errorCode: 'WPS_RANGE_MISMATCH',
        documentKeyHash: 'fnv1a:12345678',
        actualRevisionToken: 'sha256:revision',
        structureType: 'table',
        anchorLength: 12,
        candidateCount: 1,
        rangeCorrection: 0,
        resultMessage: '已停止写入',
        fullDocumentText: 'must not be persisted'
      })
    });
    const created = await response.json();
    assert.equal(response.status, 201);
    assert.equal(created.event.eventType, 'suggestion.location.failed');
    assert.equal(created.event.operationId, 'op-1');
    assert.equal(created.event.reason, 'range_text_mismatch');
    assert.equal(created.event.structureType, 'table');
    assert.equal('fullDocumentText' in created.event, false);

    const listResponse = await fetch(`${baseUrl}/api/acceptance/events?docSessionId=doc-real`, {
      headers: { authorization: 'Bearer diagnostics-token' }
    });
    const listed = await listResponse.json();
    assert.equal(listed.events.length, 1);
    assert.equal('fullDocumentText' in listed.events[0], false);
  }, { agentToken: 'diagnostics-token' });
});

test('bridge rejects invalid payloads with details', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: 'missing anchor' })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error.details.join('\n'), /anchor/);
  }, { allowLegacySubmission: true });
});

test('bridge can require an agent token for suggestion submission', async () => {
  await withServer(
    async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/api/suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          anchorText: '原文',
          comment: '批注'
        })
      });
      assert.equal(unauthorized.status, 401);

      const authorized = await fetch(`${baseUrl}/api/suggestions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-token'
        },
        body: JSON.stringify({
          anchorText: '原文',
          comment: '批注'
        })
      });
      const body = await authorized.json();
      assert.equal(authorized.status, 201);
      assert.equal(body.suggestions.length, 1);
    },
    { agentToken: 'secret-token', allowLegacySubmission: true }
  );
});

test('bridge protects WPS command stream and result endpoints when installed with a token', async () => {
  await withServer(async (baseUrl) => {
    const stream = await fetch(`${baseUrl}/api/wps/commands?clientId=wps-1`);
    const result = await fetch(`${baseUrl}/api/wps/commands/unknown/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true })
    });

    assert.equal(stream.status, 401);
    assert.equal(result.status, 401);
  }, { agentToken: 'secret-token' });
});

test('bridge protects WPS connector, task pane, and event routes with the installation token', async () => {
  await withServer(async (baseUrl) => {
    const requests = [
      fetch(`${baseUrl}/api/wps/documents`),
      fetch(`${baseUrl}/api/wps/documents/active`),
      fetch(`${baseUrl}/api/suggestions`),
      fetch(`${baseUrl}/api/events`),
      fetch(`${baseUrl}/api/acceptance/events`),
      fetch(`${baseUrl}/api/sessions`),
      fetch(`${baseUrl}/api/suggestions/unknown`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      })
    ];
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401, 401, 401, 401]);
  }, { agentToken: 'secret-token' });
});
