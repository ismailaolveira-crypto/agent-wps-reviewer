import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildColleagueDelivery } from '../scripts/build-colleague-delivery.mjs';
import { REQUIRED_COLLEAGUE_FILES } from '../scripts/validate-platform-releases.mjs';

test('colleague delivery builds two complete platform packages and an aligned index', async () => {
  const result = await buildColleagueDelivery();
  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true);
  assert.equal(result.installModel, 'one-platform-zip-one-installer');
  assert.equal(result.userFacingSkill, 'whitepaper-chief-editor');
  assert.equal(result.wpsPlugin, 'WpsAgentReviewer');
  assert.equal(result.validation.checks.length, 2);
  for (const check of result.validation.checks) {
    assert.equal(check.passed, true, JSON.stringify(check));
    assert.equal(check.missing.length, 0);
    assert.equal(check.forbidden.length, 0);
    assert.equal(check.versionsAligned, true);
    assert.equal(check.productContract, true);
  }
  const index = JSON.parse(await readFile(result.indexPath, 'utf8'));
  assert.equal(index.productVersion, result.productVersion);
  assert.equal(index.packages.macos.sha256.length, 64);
  assert.equal(index.packages.windows.sha256.length, 64);
  for (const required of [
    'skills/whitepaper-chief-editor/agents/openai.yaml',
    'public/WpsAgentReviewer/ribbon.xml',
    'public/addin/taskpane.html'
  ]) assert.ok(REQUIRED_COLLEAGUE_FILES.includes(required));
});
