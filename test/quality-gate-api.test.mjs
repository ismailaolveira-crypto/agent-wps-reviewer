import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DocumentCommandBroker } from '../src/bridge/documentCommandBroker.mjs';
import { DocumentRegistry } from '../src/bridge/documentRegistry.mjs';
import { createBridgeServer } from '../src/bridge/server.mjs';

function makeSuggestion({
  candidateId = 'candidate-1',
  anchorText = '课程覆盖判断重复出现',
  contextBefore = '本节前文。',
  contextAfter = '本节后文。',
  keyTerm = '课程覆盖',
  comment = `这里重复说明${keyTerm}情况，建议删除重复的${keyTerm}说明。`
} = {}) {
  return {
    candidateId,
    category: 'duplicate-compression',
    anchorText,
    contextBefore,
    contextAfter,
    comment,
    quality: {
      issue: `${keyTerm}判断重复出现，没有推进本节对培养短板的分析。`,
      impact: `${keyTerm}重复内容拉长篇幅，削弱本节主要判断。`,
      action: 'delete',
      actionStatement: `建议删除重复的${keyTerm}说明。`,
      purposeCodes: ['compression', 'chapter-focus'],
      keyTerms: [keyTerm],
      evidenceIds: [],
      styleRuleIds: [],
      verification: {
        fullContextChecked: true,
        counterEvidenceChecked: true,
        result: 'supported',
        documentEvidenceExcerpt: anchorText,
        relatedExcerpts: [contextBefore]
      }
    }
  };
}

function makeBatch({ documentHandle = 'doc-a', revisionToken = 'sha256:fresh', suggestions } = {}) {
  const items = suggestions || [makeSuggestion()];
  return {
    documentHandle,
    revisionToken,
    sourceAgent: 'codex',
    reviewProfile: 'whitepaper-chief-editor-v1',
    reviewScope: {
      sectionId: '5.1.3',
      sectionTitle: '课程体系建设现状',
      sectionGoal: '说明课程、实训体系和师资建设的现状与主要短板'
    },
    workflow: {
      stage: 'final-previewed',
      candidateRoundId: 'round-1',
      approvedCandidateIds: items.map((item) => item.candidateId)
    },
    styleBaseline: {
      profile: 'network-security-talent-whitepaper-2022-2024',
      version: '1'
    },
    suggestions: items
  };
}

async function withServer(fn, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-quality-api-'));
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
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ baseUrl, dataDir, store, commandBroker });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function postJson(baseUrl, pathname, body, authorized = true) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { authorization: 'Bearer secret-token' } : {})
    },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function registerDocument(baseUrl, { textLength, revisionToken = 'sha256:fresh' }) {
  const result = await postJson(
    baseUrl,
    '/api/wps/documents/active',
    {
      clientId: 'wps-1',
      documentHandle: 'doc-a',
      title: 'A.docx',
      textLength,
      revisionToken,
      lastActiveAt: Date.now()
    },
    true
  );
  assert.equal(result.response.status, 200);
}

function serveDocument(commandBroker, documentText, { revisionToken = 'sha256:fresh' } = {}) {
  return commandBroker.subscribe('wps-1', (command) => {
    const offset = Number(command.payload.offset || 0);
    const limit = Number(command.payload.limit || 32000);
    const text = documentText.slice(offset, offset + limit);
    const nextOffset = offset + text.length;
    commandBroker.resolve(command.id, {
      text,
      nextOffset,
      done: nextOffset >= documentText.length,
      revisionToken
    });
  });
}

test('formal submission validates quality and current document text before atomic persistence', async () => {
  await withServer(async ({ baseUrl, dataDir, commandBroker, store }) => {
    const documentText = '本节前文。课程覆盖判断重复出现。本节后文。';
    await registerDocument(baseUrl, { textLength: documentText.length });
    serveDocument(commandBroker, documentText);

    const submitted = await postJson(baseUrl, '/api/agent/suggestions', makeBatch());

    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
    assert.equal(store.listSuggestions().length, 1);
    const stored = store.listSuggestions()[0];
    assert.equal(stored.metadata.reviewProfile, 'whitepaper-chief-editor-v1');
    assert.equal(stored.metadata.reviewScope.sectionId, '5.1.3');
    assert.equal(stored.metadata.quality.keyTerms[0], '课程覆盖');
    assert.equal(stored.metadata.location.strategy, 'exact');

    const persisted = await readFile(path.join(dataDir, 'review-store.json'), 'utf8');
    assert.equal(persisted.includes(documentText), false);
  });
});

test('formal submission rejects incomplete quality before reading or persisting', async () => {
  await withServer(async ({ baseUrl, store }) => {
    await registerDocument(baseUrl, { textLength: 20 });
    const input = makeBatch();
    input.suggestions[0].quality.issue = '';

    const submitted = await postJson(baseUrl, '/api/agent/suggestions', input);

    assert.equal(submitted.response.status, 400);
    assert.match(submitted.body.error.details.join('\n'), /quality\.issue/);
    assert.equal(store.listSuggestions().length, 0);
  });
});

test('one ungrounded item rejects the whole formal batch', async () => {
  await withServer(async ({ baseUrl, commandBroker, store }) => {
    const documentText = '本节前文。课程覆盖判断重复出现。本节后文。';
    await registerDocument(baseUrl, { textLength: documentText.length });
    serveDocument(commandBroker, documentText);
    const valid = makeSuggestion();
    const invalid = makeSuggestion({
      candidateId: 'candidate-2',
      anchorText: '正文不存在的师资判断',
      keyTerm: '师资判断',
      comment: '这里的师资判断没有正文依据，建议删除重复的师资判断说明。'
    });

    const submitted = await postJson(
      baseUrl,
      '/api/agent/suggestions',
      makeBatch({ suggestions: [valid, invalid] })
    );

    assert.equal(submitted.response.status, 400);
    assert.match(submitted.body.error.details.join('\n'), /未找到对应原文/);
    assert.equal(store.listSuggestions().length, 0);
  });
});

test('formal grounding reads documents in 32000-character chunks', async () => {
  await withServer(async ({ baseUrl, commandBroker }) => {
    const suffix = '本节前文。课程覆盖判断重复出现。本节后文。';
    const documentText = `${'占'.repeat(33000)}${suffix}`;
    await registerDocument(baseUrl, { textLength: documentText.length });
    const offsets = [];
    commandBroker.subscribe('wps-1', (command) => {
      offsets.push(command.payload.offset);
      const offset = Number(command.payload.offset || 0);
      const limit = Number(command.payload.limit || 32000);
      const text = documentText.slice(offset, offset + limit);
      const nextOffset = offset + text.length;
      commandBroker.resolve(command.id, {
        text,
        nextOffset,
        done: nextOffset >= documentText.length,
        revisionToken: 'sha256:fresh'
      });
    });

    const submitted = await postJson(baseUrl, '/api/agent/suggestions', makeBatch());

    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
    assert.deepEqual(offsets, [0, 32000]);
  });
});

test('formal grounding rejects a revision change during document reading', async () => {
  await withServer(async ({ baseUrl, commandBroker, store }) => {
    const documentText = '本节前文。课程覆盖判断重复出现。本节后文。';
    await registerDocument(baseUrl, { textLength: documentText.length });
    serveDocument(commandBroker, documentText, { revisionToken: 'sha256:changed' });

    const submitted = await postJson(baseUrl, '/api/agent/suggestions', makeBatch());

    assert.equal(submitted.response.status, 409);
    assert.match(submitted.body.error.message, /变化|changed|重新读取/i);
    assert.equal(store.listSuggestions().length, 0);
  });
});

test('legacy suggestion writes are disabled by default', async () => {
  await withServer(async ({ baseUrl, store }) => {
    const submitted = await postJson(baseUrl, '/api/suggestions', {
      docSessionId: 'legacy',
      anchorText: '原文',
      comment: '旧入口批注'
    });

    assert.equal(submitted.response.status, 410);
    assert.match(submitted.body.error.message, /正式|批量|Skill|停用/);
    assert.equal(store.listSuggestions().length, 0);
  });
});

test('legacy writes require an explicit development switch and stay unverified', async () => {
  await withServer(
    async ({ baseUrl, store }) => {
      const submitted = await postJson(baseUrl, '/api/suggestions', {
        docSessionId: 'legacy',
        anchorText: '原文',
        comment: '旧入口批注'
      });

      assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
      assert.equal(store.listSuggestions()[0].metadata.reviewStatus, 'legacy-unverified');
    },
    { allowLegacySubmission: true }
  );
});
