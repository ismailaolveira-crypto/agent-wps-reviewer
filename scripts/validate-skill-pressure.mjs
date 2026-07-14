#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cases = [
  {
    id: 'direct-submit',
    file: 'docs/evidence/skill-pressure/01-direct-submit.md',
    required: [/不能直接提交/, /3[–-]7 条候选/, /用户选择|你选择|回复编号/, /无法生成可定位、可核验/]
  },
  {
    id: 'title-counterevidence',
    file: 'docs/evidence/skill-pressure/02-counterevidence-title.md',
    required: [/4\.3\.4/, /本身就是三级标题/, /问题不成立/, /不提交/]
  },
  {
    id: 'invented-history',
    file: 'docs/evidence/skill-pressure/03-invented-style.md',
    required: [/STYLE-02/, /STYLE-04/, /三段宏观背景.*(?:冲突|并无)/s, /不得直接提交|不能.*直接提交/s]
  }
];

const results = [];
for (const item of cases) {
  const text = await readFile(path.resolve(item.file), 'utf8');
  const checks = item.required.map((pattern) => ({ pattern: String(pattern), passed: pattern.test(text) }));
  results.push({ id: item.id, file: item.file, passed: checks.every((check) => check.passed), checks });
}
const report = { ok: results.every((item) => item.passed), generatedAt: new Date().toISOString(), results };
await mkdir('output/skill-pressure', { recursive: true });
await writeFile('output/skill-pressure/report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
