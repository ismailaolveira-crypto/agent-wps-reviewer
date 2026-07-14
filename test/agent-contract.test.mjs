import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJson, validateAgentContract } from '../src/agent/contract.mjs';
import { validateWhitepaperReviewBatch } from '../src/agent/whitepaperReview.mjs';

test('agent contract validates schema files and example payloads', async () => {
  const result = await validateAgentContract();

  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.ok(result.schemas.includes('schemas/wps-suggestion.schema.json'));
  assert.ok(result.samples.includes('examples/batch-suggestions.json'));
});

test('sample payloads are complete formal whitepaper review batches', async () => {
  const single = await loadJson('examples/sample-suggestion.json');
  const batch = await loadJson('examples/batch-suggestions.json');

  assert.equal(validateWhitepaperReviewBatch(single).ok, true);
  assert.equal(validateWhitepaperReviewBatch(batch).ok, true);
  assert.equal(single.suggestions.length, 1);
  assert.equal(batch.suggestions.length, 2);
});

test('production examples never use legacy suggestion fields', async () => {
  for (const samplePath of ['examples/sample-suggestion.json', 'examples/batch-suggestions.json']) {
    const sample = await loadJson(samplePath);
    const serialized = JSON.stringify(sample);
    assert.doesNotMatch(serialized, /docSessionId|replacement|severity|legacy-unverified/);
    assert.equal(sample.reviewProfile, 'whitepaper-chief-editor-v1');
  }
});

test('suggestion schema documents required agent-facing fields', async () => {
  const schema = await loadJson('schemas/wps-suggestion.schema.json');

  assert.equal(schema.properties.candidateId.type, 'string');
  assert.equal(schema.properties.category.type, 'string');
  assert.equal(schema.properties.anchorText.type, 'string');
  assert.equal(schema.properties.comment.type, 'string');
  assert.ok(schema.required.includes('comment'));
  assert.equal(schema.properties.quality.type, 'object');
});

test('formal batch schema requires the complete whitepaper review envelope', async () => {
  const schema = await loadJson('schemas/wps-suggestion-batch.schema.json');

  assert.deepEqual(schema.required, [
    'revisionToken',
    'sourceAgent',
    'reviewProfile',
    'reviewScope',
    'workflow',
    'styleBaseline',
    'suggestions'
  ]);
  assert.deepEqual(schema.anyOf, [
    { required: ['documentHandle'] },
    { required: ['connectionCode'] }
  ]);
  assert.equal(schema.properties.reviewProfile.const, 'whitepaper-chief-editor-v1');
  assert.equal(schema.properties.suggestions.maxItems, 8);
  assert.ok(schema.properties.workflow.required.includes('approvedCandidateIds'));
});

test('formal suggestion schema requires purpose evidence action and grounding fields', async () => {
  const schema = await loadJson('schemas/wps-suggestion.schema.json');
  const quality = schema.properties.quality;

  assert.ok(schema.required.includes('candidateId'));
  assert.ok(schema.required.includes('category'));
  assert.ok(schema.required.includes('comment'));
  assert.ok(schema.anyOf.some((entry) => entry.required?.includes('contextBefore')));
  assert.ok(schema.anyOf.some((entry) => entry.required?.includes('contextAfter')));
  for (const field of [
    'issue',
    'impact',
    'action',
    'actionStatement',
    'purposeCodes',
    'keyTerms',
    'evidenceIds',
    'styleRuleIds',
    'verification'
  ]) {
    assert.ok(quality.required.includes(field), `quality must require ${field}`);
  }
});

test('legacy single suggestion schema is separate and marked unverified compatibility', async () => {
  const schema = await loadJson('schemas/wps-legacy-suggestion.schema.json');

  assert.match(schema.description, /legacy|compatibility|unverified/i);
  assert.ok(schema.required.includes('comment'));
  assert.ok(schema.anyOf.some((entry) => entry.required?.includes('anchorText')));
});
