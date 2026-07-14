import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const profileRoot = path.resolve(import.meta.dirname, '../profiles/network-security-talent-2022-2024');
const evidenceMap = JSON.parse(await readFile(path.join(profileRoot, 'style-evidence-map.json'), 'utf8'));
const fingerprints = JSON.parse(await readFile(path.join(profileRoot, 'source-fingerprints.json'), 'utf8'));

test('network-security style evidence map covers every production style rule with bounded source pages', () => {
  const sourcePages = new Map(fingerprints.sources.map((source) => [source.sourceId, source.pageCount]));
  assert.equal(evidenceMap.rules.length, 8);
  for (const rule of evidenceMap.rules) {
    assert.match(rule.id, /^STYLE-0[1-8]$/);
    assert.ok(rule.summary);
    assert.ok(rule.scope);
    assert.ok(rule.evidence.length > 0);
    for (const item of rule.evidence) {
      assert.ok(sourcePages.has(item.sourceId), `${rule.id} references unknown ${item.sourceId}`);
      assert.ok(item.pdfPages.length > 0);
      for (const page of item.pdfPages) {
        assert.ok(Number.isInteger(page) && page >= 1 && page <= sourcePages.get(item.sourceId), `${rule.id} has invalid page ${page}`);
      }
    }
  }
});
