import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAcceptanceKit, SAMPLE_PARAGRAPHS } from '../src/acceptance/kit.mjs';

test('createAcceptanceKit writes a docx, payload, and checklist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-kit-test-'));
  try {
    const result = await createAcceptanceKit({ outputDir: dir });

    assert.equal(result.ok, true);
    assert.equal(result.docxPath.endsWith('.docx'), true);
    assert.match(await readFile(result.payloadPath, 'utf8'), /我们的方案可以提升文档审阅效率/);
    assert.match(await readFile(result.readmePath, 'utf8'), /Agent 审阅/);

    const listed = spawnSync('unzip', ['-l', result.docxPath], { encoding: 'utf8' });
    assert.equal(listed.status, 0);
    assert.match(listed.stdout, /word\/document.xml/);

    const documentXml = spawnSync('unzip', ['-p', result.docxPath, 'word/document.xml'], {
      encoding: 'utf8'
    });
    assert.equal(documentXml.status, 0);
    assert.match(documentXml.stdout, new RegExp(SAMPLE_PARAGRAPHS[0]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
