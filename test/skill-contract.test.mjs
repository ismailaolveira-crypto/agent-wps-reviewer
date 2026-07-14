import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const SKILL_ROOT = path.resolve('skills/whitepaper-wps-reviewer');
const DISPATCH_ROOT = path.resolve('skills/whitepaper-chief-editor');

async function readSkill(relativePath) {
  return readFile(path.join(SKILL_ROOT, relativePath), 'utf8');
}

test('repository skill has discoverable frontmatter and the required human review sequence', async () => {
  const skill = await readSkill('SKILL.md');

  assert.match(skill, /^---\nname: whitepaper-wps-reviewer\n/m);
  assert.match(skill, /description: Use when/);
  assert.match(skill, /候选意见/);
  assert.match(skill, /3-7/);
  assert.match(skill, /用户选择/);
  assert.match(skill, /最终批注文本/);
  assert.match(skill, /反证/);
  assert.match(skill, /submit_wps_suggestions/);
  assert.match(skill, /点击.*接受|接受.*真实 WPS 批注/);
  assert.match(skill, /最短可核验句子/);
  assert.match(skill, /只覆盖该锚点/);
});

test('dispatcher skill is the only user-facing route and refuses disabled capabilities', async () => {
  const skill = await readFile(path.join(DISPATCH_ROOT, 'SKILL.md'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(DISPATCH_ROOT, 'references/capability-manifest.json'), 'utf8'));

  assert.match(skill, /^---\nname: whitepaper-chief-editor\n/m);
  assert.match(skill, /唯一.*入口/);
  assert.match(skill, /whitepaper-wps-reviewer/);
  assert.match(skill, /不能调用旧 DOCX 写入脚本/);
  assert.equal(manifest.capabilities['wps-comment'].status, 'production');
  assert.equal(manifest.capabilities['docx-redline'].status, 'disabled');
  assert.equal(manifest.capabilities['pdf-replica'].status, 'disabled');
});

test('repository skill encodes the modification purposes and reviewer-efficiency gate', async () => {
  const purpose = await readSkill('references/review-purpose.md');

  for (const code of [
    'chapter-focus',
    'evidence-accuracy',
    'structure-logic',
    'compression',
    'anti-ai-tone',
    'historical-style',
    'human-boundary'
  ]) {
    assert.match(purpose, new RegExp(code));
  }
  assert.match(purpose, /审稿.*效率|审稿人.*时间/);
  assert.match(purpose, /不进入.*候选|不得提交/);
});

test('2022-2024 style profile contains eight source-backed rules and no invented font claim', async () => {
  const profile = await readSkill('references/2022-2024-style-profile.md');
  const fingerprints = JSON.parse(await readSkill('references/source-fingerprints.json'));

  for (let index = 1; index <= 8; index += 1) {
    assert.match(profile, new RegExp(`STYLE-${String(index).padStart(2, '0')}`));
  }
  assert.match(profile, /判断.*解释.*数据|判断在前/);
  assert.match(profile, /受访样本/);
  assert.match(profile, /三级标题/);
  assert.match(profile, /历史.*基线|2022-2024/);
  assert.match(profile, /不声称精确提取历史 PDF 字体/);
  assert.doesNotMatch(profile, /(?:已经|已从).*精确提取.*字体|完全复刻.*字体/);

  assert.deepEqual(
    fingerprints.sources.map((source) => source.sha256),
    [
      '60c0d4ffbff01ef0990ea62305d4aee9164fa27d1b07a1adcab3063bb9905398',
      '7abaef7d0d351328e70c196045454abe3c3fb006daed1fccc7aa74b872a16a50',
      '3a50d3965de61195d8be9d070e8f44ab84858835bab3ad5414c824151095b046'
    ]
  );
});

test('submission reference documents every field enforced by the bridge', async () => {
  const contract = await readSkill('references/submission-contract.md');

  for (const field of [
    'reviewProfile',
    'reviewScope',
    'workflow',
    'styleBaseline',
    'candidateId',
    'actionStatement',
    'purposeCodes',
    'keyTerms',
    'documentEvidenceExcerpt',
    'relatedExcerpts'
  ]) {
    assert.match(contract, new RegExp(field));
  }
  assert.match(contract, /最多 8 条/);
  assert.match(contract, /同一.*小节/);
});

test('repository skill is portable and contains no developer-private absolute path', async () => {
  const files = await Promise.all([
    readSkill('SKILL.md'),
    readSkill('references/review-purpose.md'),
    readSkill('references/2022-2024-style-profile.md'),
    readSkill('references/submission-contract.md'),
    readSkill('references/source-fingerprints.json')
  ]);
  const joined = files.join('\n');

  assert.doesNotMatch(joined, /\/Users\/zhangboquan/);
  assert.doesNotMatch(joined, /Desktop\/技能管理中心/);
});
