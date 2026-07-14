import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBridgeServer } from '../src/bridge/server.mjs';

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PACKAGE_JSON,
    'playwright/package.json',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')
  ].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try {
      const require = candidate === 'playwright/package.json'
        ? createRequire(import.meta.url)
        : createRequire(path.resolve(candidate));
      return require('playwright');
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`未找到 Playwright。请设置 PLAYWRIGHT_PACKAGE_JSON 指向 playwright/package.json。${lastError ? ` ${lastError.message}` : ''}`);
}

const { chromium } = loadPlaywright();
const outputDir = path.resolve('output/playwright');
await mkdir(outputDir, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-responsive-'));
const { server, store } = await createBridgeServer({ dataDir });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

await store.addSuggestion({
  docSessionId: 'default',
  sourceAgent: 'responsive-check',
  anchorText: '提升文档审阅效率',
  contextAfter: '同时保留人工审核。',
  comment: '这里把方案效果写成确定性结论，建议补充适用条件或改为审慎表述。'.repeat(8),
  metadata: { category: '样本边界', reviewStatus: 'browser-fixture' }
});

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [280, 300, 320, 360, 420, 480, 640]) {
    for (const height of [480, 640, 900]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1.5 });
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${port}/addin/taskpane.html?mock=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.suggestion-card');
    const layout = await page.evaluate(() => {
      const all = [...document.querySelectorAll('body *')];
      const overflow = all.filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
        .map((el) => ({ tag: el.tagName, className: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      const rightOverflow = all.filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > innerWidth + 1;
      }).map((el) => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right }));
      return {
        bodyWidth: document.body.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        overflow,
        rightOverflow,
        pending: document.querySelector('#pendingCount')?.textContent,
        cards: document.querySelectorAll('.suggestion-card').length
      };
    });
    await page.screenshot({ path: path.join(outputDir, `quality-gate-${width}x${height}.png`), fullPage: true });
    results.push({ width, height, ...layout, consoleErrors, ok: layout.bodyWidth <= width && layout.documentWidth <= width && layout.overflow.length === 0 && layout.rightOverflow.length === 0 && consoleErrors.length === 0 });
    await page.close();
    }
  }

  await store.addSuggestion({
    docSessionId: 'default',
    sourceAgent: 'responsive-check',
    anchorText: '保留人工审核',
    contextBefore: '提升文档审阅效率，同时',
    comment: '建议说明人工复核的责任边界和触发条件，避免把流程要求留在口号层面。'.repeat(6),
    metadata: { category: '流程边界', reviewStatus: 'browser-fixture' }
  });

  const interactionPage = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const interactionErrors = [];
  interactionPage.on('console', (message) => { if (message.type() === 'error') interactionErrors.push(message.text()); });
  await interactionPage.goto(`http://127.0.0.1:${port}/addin/taskpane.html?mock=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await interactionPage.waitForSelector('.suggestion-card');
  await interactionPage.waitForFunction(() => document.querySelector('#pendingCount')?.textContent === '2', null, { timeout: 10000 }).catch(async (error) => {
    const state = await interactionPage.evaluate(() => ({
      pending: document.querySelector('#pendingCount')?.textContent,
      cards: [...document.querySelectorAll('.suggestion-card')].map((card) => card.textContent)
    }));
    throw new Error(`${error.message}; interaction state=${JSON.stringify(state)}`);
  });
  await interactionPage.click('#locateButton');
  await interactionPage.waitForFunction(() => {
    const input = document.querySelector('#mockDocument');
    return input?.value.slice(input.selectionStart, input.selectionEnd) === '保留人工审核'
      && document.querySelector('#actionResult')?.textContent === '已定位到模拟文档';
  }, null, { timeout: 10000 });
  const firstSelection = await interactionPage.evaluate(() => {
    const input = document.querySelector('#mockDocument');
    return { start: input.selectionStart, end: input.selectionEnd, text: input.value.slice(input.selectionStart, input.selectionEnd) };
  });
  await interactionPage.click('#acceptButton');
  await interactionPage.waitForFunction(() => document.querySelector('#pendingCount')?.textContent === '1', null, { timeout: 10000 });
  const afterAccept = await interactionPage.evaluate(() => ({
    detailVisible: !document.querySelector('#detailCard')?.hidden,
    anchor: document.querySelector('#detailAnchor')?.textContent,
    selection: document.querySelector('#mockDocument') ? {
      start: document.querySelector('#mockDocument').selectionStart,
      end: document.querySelector('#mockDocument').selectionEnd,
      text: document.querySelector('#mockDocument').value.slice(document.querySelector('#mockDocument').selectionStart, document.querySelector('#mockDocument').selectionEnd)
    } : null
  }));
  await interactionPage.click('#rejectButton');
  await interactionPage.waitForFunction(() => document.querySelector('#pendingCount')?.textContent === '0', null, { timeout: 10000 });
  const afterReject = await interactionPage.evaluate(() => ({
    detailHidden: document.querySelector('#detailCard')?.hidden === true,
    emptyVisible: document.querySelector('#emptyDetail')?.hidden === false,
    listEmpty: document.querySelector('.empty-list')?.textContent
  }));
  const interactionOk = interactionErrors.length === 0
    && firstSelection.text === '保留人工审核'
    && afterAccept.detailVisible
    && afterAccept.anchor === '提升文档审阅效率'
    && afterAccept.selection?.text === '提升文档审阅效率'
    && afterReject.detailHidden
    && afterReject.emptyVisible
    && afterReject.listEmpty === '暂无待处理建议';
  results.push({
    width: 420,
    interaction: {
      firstSelection,
      afterAccept,
      afterReject,
      consoleErrors: interactionErrors
    },
    ok: interactionOk
  });
  await interactionPage.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}

const report = { ok: results.every((item) => item.ok), results };
await writeFile(path.join(outputDir, 'quality-gate-responsive.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
