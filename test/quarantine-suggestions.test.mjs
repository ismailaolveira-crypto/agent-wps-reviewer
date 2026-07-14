import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyQuarantine, inspectUnverifiedSuggestions, restoreQuarantine } from '../src/maintenance/quarantineSuggestions.mjs';

function fixture() {
  const legacy = Array.from({ length: 17 }, (_, index) => ({ id: `legacy-${index}`, metadata: {} }));
  return {
    sessions: [{ docSessionId: 'default' }],
    suggestions: [...legacy, { id: 'formal-1', metadata: { reviewProfile: 'whitepaper-chief-editor-v1' } }],
    acceptanceEvents: [
      { id: 'linked', suggestionId: 'legacy-1' },
      { id: 'formal-event', suggestionId: 'formal-1' },
      { id: 'unlinked', suggestionId: '' }
    ]
  };
}

test('quarantine dry-run does not mutate the store and reports legacy records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-quarantine-'));
  const storePath = path.join(dir, 'review-store.json');
  try {
    await writeFile(storePath, JSON.stringify(fixture(), null, 2));
    const before = await readFile(storePath);
    const report = await inspectUnverifiedSuggestions({ storePath });
    assert.equal(report.unverifiedSuggestions, 17);
    assert.deepEqual(await readFile(storePath), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('apply backs up legacy records and linked events, restore merges them without duplicates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-quarantine-apply-'));
  const storePath = path.join(dir, 'review-store.json');
  try {
    await writeFile(storePath, JSON.stringify(fixture(), null, 2));
    const applied = await applyQuarantine({ storePath, backupDir: path.join(dir, 'backups') });
    const active = JSON.parse(await readFile(storePath, 'utf8'));
    const backup = JSON.parse(await readFile(applied.backupPath, 'utf8'));
    assert.equal(active.suggestions.length, 1);
    assert.equal(active.suggestions[0].id, 'formal-1');
    assert.deepEqual(active.acceptanceEvents.map((item) => item.id), ['formal-event', 'unlinked']);
    assert.equal(backup.sourceSha256, applied.sourceSha256);
    assert.equal(backup.suggestions.length, 17);
    assert.deepEqual(backup.acceptanceEvents.map((item) => item.id), ['linked']);

    await restoreQuarantine({ storePath, backupPath: applied.backupPath });
    await restoreQuarantine({ storePath, backupPath: applied.backupPath });
    const restored = JSON.parse(await readFile(storePath, 'utf8'));
    assert.equal(restored.suggestions.length, 18);
    assert.equal(restored.acceptanceEvents.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
