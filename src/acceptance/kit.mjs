import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export const SAMPLE_PARAGRAPHS = [
  '这是一段用于模拟 WPS 文档的内容。我们的方案可以提升文档审阅效率，同时保留人工审核。',
  '第二段用于测试重复锚点。我们的方案可以提升文档审阅效率，但如果没有上下文，定位可能出现歧义。',
  '验收时请打开 Agent 审阅侧边栏，先点击定位，再点击接受生成真实批注；正文不应被替换。'
];

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function paragraphXml(text) {
  return `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

async function writeDocxSource(rootDir, paragraphs) {
  await mkdir(path.join(rootDir, '_rels'), { recursive: true });
  await mkdir(path.join(rootDir, 'docProps'), { recursive: true });
  await mkdir(path.join(rootDir, 'word/_rels'), { recursive: true });

  await writeFile(
    path.join(rootDir, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
`
  );

  await writeFile(
    path.join(rootDir, '_rels/.rels'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
`
  );

  await writeFile(
    path.join(rootDir, 'docProps/core.xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Agent WPS Reviewer Acceptance Sample</dc:title>
  <dc:creator>agent-wps-reviewer</dc:creator>
  <cp:lastModifiedBy>agent-wps-reviewer</cp:lastModifiedBy>
</cp:coreProperties>
`
  );

  await writeFile(
    path.join(rootDir, 'docProps/app.xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>agent-wps-reviewer</Application>
</Properties>
`
  );

  await writeFile(
    path.join(rootDir, 'word/_rels/document.xml.rels'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
`
  );

  await writeFile(
    path.join(rootDir, 'word/document.xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map(paragraphXml).join('\n    ')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>
`
  );
}

export async function createDocx(filePath, paragraphs = SAMPLE_PARAGRAPHS) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-docx-'));
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeDocxSource(tempDir, paragraphs);
    const zip = spawnSync('zip', ['-q', '-r', filePath, '[Content_Types].xml', '_rels', 'docProps', 'word'], {
      cwd: tempDir,
      encoding: 'utf8'
    });
    if (zip.status !== 0) {
      throw new Error(zip.stderr || 'zip failed while creating acceptance docx');
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function createAcceptanceKit({
  outputDir = path.join(PROJECT_ROOT, 'output/acceptance-kit'),
  sampleSuggestionPath = path.join(PROJECT_ROOT, 'examples/development-legacy-suggestion.json')
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const docxPath = path.join(outputDir, 'wps-reviewer-acceptance.docx');
  const payloadPath = path.join(outputDir, 'sample-suggestion.json');
  const readmePath = path.join(outputDir, 'README.md');
  await createDocx(docxPath);
  await writeFile(payloadPath, await readFile(sampleSuggestionPath, 'utf8'));
  await writeFile(
    readmePath,
    [
      '# WPS Reviewer Acceptance Kit',
      '',
      'Use this kit only during an allowed foreground WPS validation window.',
      '',
      '1. Run `npm run acceptance:prepare` from the project root.',
      '2. Restart WPS if the `Agent 审阅` tab is not visible.',
      '3. Open `output/acceptance-kit/wps-reviewer-acceptance.docx` in WPS.',
      '4. Click `Agent 审阅` -> `审阅收件箱`.',
      '5. In the side pane, verify `定位`, then `接受`; confirm a real WPS comment is created and body text is unchanged.',
      '6. Run `npm run acceptance:wait`, `npm run acceptance:status`, and `npm run acceptance:audit` to confirm WPS events were recorded.',
      '7. Stop the bridge with `npm run bridge:stop` if it should not keep running.',
      ''
    ].join('\n')
  );

  return {
    ok: true,
    outputDir,
    docxPath,
    payloadPath,
    readmePath,
    paragraphs: SAMPLE_PARAGRAPHS
  };
}
