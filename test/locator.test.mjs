import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findAllOccurrences, locateSuggestion, normalizeWhitespace } from '../src/bridge/locator.mjs';

test('normalizeWhitespace collapses whitespace', () => {
  assert.equal(normalizeWhitespace(' a\n  b\tc '), 'a b c');
});

test('findAllOccurrences returns all exact offsets', () => {
  assert.deepEqual(findAllOccurrences('abc abc abc', 'abc'), [0, 4, 8]);
});

test('locateSuggestion finds exact anchor', () => {
  const result = locateSuggestion('hello WPS reviewer', { anchorText: 'WPS' });
  assert.equal(result.ok, true);
  assert.equal(result.start, 6);
  assert.equal(result.end, 9);
});

test('locateSuggestion uses context to disambiguate repeated anchors', () => {
  const documentText = 'first target here. second target there.';
  const result = locateSuggestion(documentText, {
    anchorText: 'target',
    contextBefore: 'second',
    contextAfter: 'there'
  });

  assert.equal(result.ok, true);
  assert.equal(result.start, 26);
  assert.equal(result.ambiguous, false);
});

test('locateSuggestion reports missing anchor', () => {
  const result = locateSuggestion('document text', { anchorText: 'missing' });
  assert.deepEqual(result, { ok: false, reason: 'anchor_not_found' });
});

test('locateSuggestion refuses non-adjacent context instead of guessing a location', () => {
  const result = locateSuggestion('无关前文。中间句。target。', {
    anchorText: 'target',
    contextBefore: '无关前文。'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'context_mismatch');
});

test('locateSuggestion does not treat a trailing s as removable punctuation in context', () => {
  const result = locateSuggestion('prefixs target', {
    anchorText: 'target',
    contextBefore: 'prefix'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'context_mismatch');
});

test('locateSuggestion does not treat a leading s as removable punctuation in context', () => {
  const result = locateSuggestion('target sNext', {
    anchorText: 'target',
    contextAfter: 'Next'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'context_mismatch');
});

test('locateSuggestion maps whitespace-normalized anchors back to the original range', () => {
  const documentText = '上一节\n5.1.3\t课程体系建设现状\r下一节';
  const result = locateSuggestion(documentText, {
    anchorText: '5.1.3 课程体系建设现状',
    contextBefore: '上一节',
    contextAfter: '下一节'
  });

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'normalized-whitespace');
  assert.equal(documentText.slice(result.start, result.end), '5.1.3\t课程体系建设现状');
});
