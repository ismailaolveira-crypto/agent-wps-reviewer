import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeServer } from '../src/bridge/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'output/playwright/demo-video');
const rawDir = path.join(outDir, 'raw');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PACKAGE_JSON,
    'playwright/package.json',
    path.join(
      os.homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'
    )
  ].filter(Boolean);
  let lastError;

  for (const candidate of candidates) {
    try {
      const playwrightRequire = candidate === 'playwright/package.json'
        ? createRequire(import.meta.url)
        : createRequire(candidate);
      return playwrightRequire('playwright');
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `未找到 Playwright。请设置 PLAYWRIGHT_PACKAGE_JSON 指向 playwright/package.json。${lastError ? ` ${lastError.message}` : ''}`
  );
}

const { chromium } = loadPlaywright();

const demoDocument = [
  '第四章：AI赋能网络安全人才能力分析',
  '',
  '当被问及AI安全工具操作中最能体现技术水平的环节时，受访者的选择分布如图4-1所示：结果校验（人工纠偏与真伪判定）以41%的占比位居首位，模型微调占27%，Prompt Engineering占22%，多工具集成与自动化流转占10%。这一发现与ISC²的调研结论方向一致，《2025年ISC²网络安全劳动力研究报告》（2025 ISC2 Cybersecurity Workforce Study，n=16,029）显示仅28%的企业真正集成了AI安全工具，69%仍处于评估或测试阶段，全球范围内AI工具尚处于早期渗透期。',
  '',
  '与国际数据相比，中国从业者对AI效率提升的满意度略高。需要指出的是，国际',
  '',
  '在效率提升满意度上，关基单位在全部四个维度的满意率均处于最低或次低水平，特别是在响应处置（61.4%）和威胁狩猎（63.4%）方面，与互联网与AI企业及安全厂商的差距超过8个百分点。政府部门样本量较小（11份），数据仅供趋势参考。',
  '',
  '中外均呈现出大型企业领先、政府与公共部门滞后的格局。',
  '',
  '即便有学习意愿，也因“没钱租GPU、没空看书”而被迫搁置。',
  '',
  '我们的方案可以提升文档审阅效率，同时保留人工审核。第二段用于测试重复锚点。我们的方案可以提升文档审阅效率，但如果没有上下文，定位可能出现歧义。'
].join('\n');

const suggestions = [
  {
    docSessionId: 'default',
    anchorText:
      '这一发现与ISC²的调研结论方向一致，《2025年ISC²网络安全劳动力研究报告》（2025 ISC2 Cybersecurity Workforce Study，n=16,029）显示仅28%的企业真正集成了AI安全工具，69%仍处于评估或测试阶段，全球范围内AI工具尚处于早期渗透期。',
    comment:
      '建议说明这里是“背景参照”而非同口径验证。前半句讨论能力认知，后半句讨论工具部署成熟度，两个指标需要一句过渡，否则容易被读者理解为直接因果或直接对标。',
    metadata: { category: '对标口径' }
  },
  {
    docSessionId: 'default',
    anchorText: '需要指出的是，国际',
    comment:
      '这里疑似断句或漏字。“国际”后缺少承接对象，建议补完整句，例如说明国际调研口径与本调研不同，满意度和集成率不能直接等同比较。',
    metadata: { category: '断句补全' }
  },
  {
    docSessionId: 'default',
    anchorText: '政府部门样本量较小（11份），数据仅供趋势参考。',
    comment:
      '这个提示很关键，建议同步放到图4-5或表格脚注中。后文继续比较政府部门比例时，小样本波动风险需要在读图位置就被看见。',
    metadata: { category: '样本提示' }
  },
  {
    docSessionId: 'default',
    anchorText: '中外均呈现出大型企业领先、政府与公共部门滞后的格局。',
    comment:
      '建议收窄表述边界。“政府与公共部门”不完全等同于前文“关键信息基础设施单位”，中外组织分类也不一致。可改为“公共部门和关键行业组织在采用与能力建设上相对承压”。',
    metadata: { category: '论证边界' }
  },
  {
    docSessionId: 'default',
    anchorText: '即便有学习意愿，也因“没钱租GPU、没空看书”而被迫搁置。',
    comment:
      '这句话口语感较强，和研究报告整体文风不一致。建议改为“即便具备学习意愿，也常因算力成本和工作时间约束而难以持续投入”。',
    metadata: { category: '文风统一' }
  },
  {
    docSessionId: 'default',
    anchorText: '不存在于正文中的演示锚点',
    comment:
      '用于演示锚点不存在时的冲突状态：系统不会生成批注，而是保留建议并提示“未找到对应正文”。',
    metadata: { category: '冲突演示' }
  }
];

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://${address.address}:${address.port}`;
}

async function caption(page, text) {
  await page.evaluate((value) => {
    let el = document.getElementById('demoCaption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demoCaption';
      Object.assign(el.style, {
        position: 'fixed',
        left: '12px',
        right: '12px',
        top: '10px',
        zIndex: '9999',
        padding: '9px 12px',
        borderRadius: '8px',
        background: 'rgba(29,29,31,0.88)',
        color: '#fff',
        font: '600 13px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        letterSpacing: '0',
        pointerEvents: 'none'
      });
      document.body.appendChild(el);
    }
    el.textContent = value;
  }, text);
  await page.waitForTimeout(900);
}

async function installDemoCursor(page) {
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.id = 'demoCursor';
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '16px',
      top: '16px',
      zIndex: '10000',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      border: '2px solid #fff',
      background: '#0071e3',
      boxShadow: '0 0 0 3px rgba(0,113,227,0.25)',
      pointerEvents: 'none',
      transition: 'left 220ms ease, top 220ms ease, transform 120ms ease'
    });
    document.body.appendChild(cursor);
  });
}

async function moveCursorTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(
    ({ x, y }) => {
      const cursor = document.getElementById('demoCursor');
      if (!cursor) return;
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    },
    { x: box.x + box.width / 2 - 9, y: box.y + box.height / 2 - 9 }
  );
  await page.waitForTimeout(260);
}

async function clickWithCursor(page, locator) {
  await moveCursorTo(page, locator);
  await page.evaluate(() => {
    const cursor = document.getElementById('demoCursor');
    if (cursor) cursor.style.transform = 'scale(0.78)';
  });
  await locator.click();
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const cursor = document.getElementById('demoCursor');
    if (cursor) cursor.style.transform = 'scale(1)';
  });
  await page.waitForTimeout(580);
}

function convertToMp4(webmPath, mp4Path) {
  const ffmpeg = spawnSync(
    'ffmpeg',
    ['-y', '-i', webmPath, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', mp4Path],
    { stdio: 'pipe', encoding: 'utf8' }
  );
  return {
    ok: ffmpeg.status === 0,
    stdout: ffmpeg.stdout,
    stderr: ffmpeg.stderr
  };
}

await rm(rawDir, { recursive: true, force: true });
await mkdir(rawDir, { recursive: true });

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-reviewer-demo-data-'));
const { server, store } = await createBridgeServer({ dataDir });
const baseUrl = await listen(server);

let browser;
try {
  await store.addSuggestions(suggestions);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 626, height: 1200 },
    recordVideo: { dir: rawDir, size: { width: 626, height: 1200 } },
    deviceScaleFactor: 1,
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });

  await page.goto(`${baseUrl}/addin/taskpane.html?mock=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#suggestionList .suggestion-card', { timeout: 10000 });
  await page.fill('#mockDocument', demoDocument);
  await page.addStyleTag({
    content: `
      html, body { min-height: auto !important; }
      .app-shell { min-height: 1200px !important; grid-template-rows: 470px 390px auto !important; overflow: hidden !important; }
      .inbox-panel { padding-top: 48px !important; }
      .detail-sheet { min-height: 390px !important; position: relative !important; z-index: 3 !important; }
      .detail-card { min-height: 0 !important; }
      textarea { min-height: 170px !important; max-height: 170px !important; resize: none !important; }
      .mock-pane { pointer-events: none !important; position: relative !important; z-index: 1 !important; }
      .mock-comments { max-height: 105px !important; overflow: auto !important; }
    `
  });
  await installDemoCursor(page);
  await page.waitForTimeout(900);

  await caption(page, '1/8 Agent 审阅收件箱：已连接本地 bridge，待处理建议自动进入队列');
  await page.screenshot({ path: path.join(outDir, '01-inbox.png'), fullPage: true });

  await caption(page, '2/8 列表按类别展示建议，顶部可刷新、切换“待处理 / 全部”');
  await clickWithCursor(page, page.locator('#refreshButton'));
  await clickWithCursor(page, page.locator('#filterAll'));
  await clickWithCursor(page, page.locator('#filterPending'));

  await caption(page, '3/8 点击建议卡片，底部详情展示正文片段和批注意见');
  await clickWithCursor(page, page.getByText('断句补全', { exact: false }).first());

  await caption(page, '4/8 定位：在文档中找到锚点并选中，不修改正文');
  await clickWithCursor(page, page.locator('#locateButton'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '02-located.png'), fullPage: true });

  await caption(page, '5/8 接受：生成一条批注，建议从待处理列表移除');
  await clickWithCursor(page, page.locator('#acceptButton'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, '03-accepted-comment.png'), fullPage: true });

  await caption(page, '6/8 拒绝：不写入批注，出现可撤销提示');
  await clickWithCursor(page, page.getByText('文风统一', { exact: false }).first());
  await clickWithCursor(page, page.locator('#rejectButton'));

  await caption(page, '7/8 撤销拒绝：点击撤销后恢复到待处理');
  await clickWithCursor(page, page.locator('#undoRejectButton'));

  await caption(page, '8/8 异常路径：锚点找不到时标记冲突，保留给 Agent/用户处理');
  await clickWithCursor(page, page.getByText('冲突演示', { exact: false }).first());
  await clickWithCursor(page, page.locator('#locateButton'));
  await clickWithCursor(page, page.locator('#filterAll'));
  await page.screenshot({ path: path.join(outDir, '04-conflict-all.png'), fullPage: true });

  await caption(page, '演示完成：收件箱、详情、定位、接受批注、拒绝、撤销、冲突和全部视图均已覆盖');
  await page.waitForTimeout(1600);

  const state = await page.evaluate(() => ({
    pending: document.querySelector('#pendingCount')?.textContent,
    comments: Array.from(document.querySelectorAll('#mockComments li')).map((item) => item.textContent),
    actionResult: document.querySelector('#actionResult')?.textContent,
    allCards: Array.from(document.querySelectorAll('.suggestion-card')).map((item) =>
      item.textContent.replace(/\s+/g, ' ').trim()
    )
  }));

  await context.close();
  await browser.close();
  browser = null;

  const rawFiles = await readdir(rawDir);
  const webm = rawFiles.find((name) => name.endsWith('.webm'));
  if (!webm) throw new Error('Playwright did not produce a video');

  const finalWebm = path.join(outDir, 'agent-reviewer-product-demo.webm');
  const finalMp4 = path.join(outDir, 'agent-reviewer-product-demo.mp4');
  await rename(path.join(rawDir, webm), finalWebm);
  const mp4 = convertToMp4(finalWebm, finalMp4);

  const summary = {
    baseUrl,
    finalWebm,
    finalMp4: mp4.ok ? finalMp4 : null,
    mp4Conversion: mp4.ok ? 'ok' : mp4.stderr,
    state,
    consoleMessages
  };
  await writeFile(path.join(outDir, 'demo-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
