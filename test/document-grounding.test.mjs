import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGroundedReviewBatch } from '../src/agent/documentGrounding.mjs';

function suggestion(overrides = {}) {
  const base = {
    candidateId: 'candidate-1',
    anchorText: '多数院校已将AI安全纳入教学，独立课程占比较高。',
    contextBefore: '高校课程覆盖已较广。',
    contextAfter: '但实训体系与师资仍存在短板。',
    quality: {
      keyTerms: ['课程覆盖', '实训体系', '师资'],
      verification: {
        documentEvidenceExcerpt: '多数院校已将AI安全纳入教学，独立课程占比较高。',
        relatedExcerpts: ['高校课程覆盖已较广。']
      }
    }
  };
  return {
    ...base,
    ...overrides,
    quality: {
      ...base.quality,
      ...(overrides.quality || {}),
      verification: {
        ...base.quality.verification,
        ...(overrides.quality?.verification || {})
      }
    }
  };
}

function batch(item = suggestion()) {
  return { suggestions: [item] };
}

const DOCUMENT_TEXT = [
  '5.1.3 课程体系建设现状',
  '高校课程覆盖已较广。',
  '多数院校已将AI安全纳入教学，独立课程占比较高。',
  '但实训体系与师资仍存在短板。'
].join('\n');

test('grounds an exact anchor context evidence and key terms in the current document', () => {
  const result = validateGroundedReviewBatch(DOCUMENT_TEXT, batch());

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.locations[0].candidateId, 'candidate-1');
  assert.equal(result.locations[0].strategy, 'exact');
});

test('rejects an anchor that is absent from the current document', () => {
  const result = validateGroundedReviewBatch(DOCUMENT_TEXT, batch(suggestion({ anchorText: '不存在的原文' })));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /未找到对应原文/);
});

test('rejects repeated anchors when context does not select one occurrence', () => {
  const text = '甲处前文。重复原文。甲处后文。\n乙处前文。重复原文。乙处后文。';
  const item = suggestion({
    anchorText: '重复原文',
    contextBefore: '',
    contextAfter: '',
    quality: {
      keyTerms: ['重复原文'],
      verification: {
        documentEvidenceExcerpt: '重复原文',
        relatedExcerpts: []
      }
    }
  });
  const result = validateGroundedReviewBatch(text, batch(item));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /上下文|唯一定位/);
});

test('uses verified context to select one repeated anchor', () => {
  const text = '甲处前文。重复原文。甲处后文。\n乙处前文。重复原文。乙处后文。';
  const item = suggestion({
    anchorText: '重复原文',
    contextBefore: '乙处前文。',
    contextAfter: '乙处后文。',
    quality: {
      keyTerms: ['重复原文'],
      verification: {
        documentEvidenceExcerpt: '重复原文',
        relatedExcerpts: ['乙处前文。', '乙处后文。']
      }
    }
  });
  const result = validateGroundedReviewBatch(text, batch(item));

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.ok(result.locations[0].start > text.indexOf('甲处前文'));
});

test('rejects supplied context that is not adjacent to the located anchor', () => {
  const item = suggestion({ contextBefore: '另一章的无关前文。' });
  const result = validateGroundedReviewBatch(`${DOCUMENT_TEXT}\n另一章的无关前文。`, batch(item));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /contextBefore|前文/);
});

test('requires at least one context side for every formal suggestion', () => {
  const item = suggestion({ contextBefore: '', contextAfter: '' });
  const result = validateGroundedReviewBatch(DOCUMENT_TEXT, batch(item));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /至少提供一侧上下文/);
});

test('rejects document evidence excerpts that are not in the current text', () => {
  const item = suggestion({
    quality: { verification: { documentEvidenceExcerpt: '正文里不存在的证据。' } }
  });
  const result = validateGroundedReviewBatch(DOCUMENT_TEXT, batch(item));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /正文证据/);
});

test('rejects related excerpts that are not in the current text', () => {
  const item = suggestion({
    quality: { verification: { relatedExcerpts: ['虚构的相关段落。'] } }
  });
  const result = validateGroundedReviewBatch(DOCUMENT_TEXT, batch(item));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /relatedExcerpts/);
});

test('rejects key terms that do not appear in the grounded source material', () => {
  const item = suggestion({ quality: { keyTerms: ['全国行业结论'] } });
  const result = validateGroundedReviewBatch(DOCUMENT_TEXT, batch(item));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /keyTerms.*全国行业结论/);
});

test('supports whitespace-normalized anchors and evidence', () => {
  const text = '高校课程覆盖已较广。\n多数院校已将 AI 安全纳入教学，\n独立课程占比较高。\n但实训体系与师资仍存在短板。';
  const item = suggestion({
    anchorText: '多数院校已将 AI 安全纳入教学， 独立课程占比较高。',
    quality: {
      verification: {
        documentEvidenceExcerpt: '多数院校已将 AI 安全纳入教学， 独立课程占比较高。'
      }
    }
  });
  const result = validateGroundedReviewBatch(text, batch(item));

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.locations[0].strategy, 'normalized-whitespace');
});
