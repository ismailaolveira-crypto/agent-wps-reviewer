import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

function fakeElement() {
  const handlers = {};
  return {
    handlers,
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    append() {},
    appendChild() {},
    addEventListener(name, handler) { handlers[name] = handler; }
  };
}

test('task pane uses the active-document inbox layout without session controls or replacement actions', async () => {
  const html = await readFile('public/addin/taskpane.html', 'utf8');

  assert.match(html, /Agent 审阅/);
  assert.match(html, /suggestionList/);
  assert.match(html, /detailSheet/);
  assert.match(html, /currentDocument/);
  assert.match(html, /connectionCode/);
  assert.match(html, /copyConnectionCodeButton/);
  assert.match(html, />定位</);
  assert.match(html, />拒绝</);
  assert.match(html, />接受</);
  assert.doesNotMatch(html, /sessionInput/);
  assert.doesNotMatch(html, /copySessionButton/);
  assert.doesNotMatch(html, /applyButton/);
  assert.doesNotMatch(html, /建议替换/);
  assert.doesNotMatch(html, /理由/);
});

test('task pane script implements pending/all views, reject undo, and accepts by adding comments only', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');

  assert.match(source, /pendingStatuses/);
  assert.match(source, /acceptStatuses = new Set\(\['pending'\]\)/);
  assert.match(source, /undoRejectStack/);
  assert.match(source, /undoToastVisible/);
  assert.match(source, /showUndoToast/);
  assert.match(source, /advanceToNextPending/);
  assert.match(source, /nextPendingSuggestionAfter/);
  assert.match(source, /selectionCleared/);
  assert.match(source, /COMMENT_OPERATION_LOG_KEY/);
  assert.match(source, /COMMENT_FINGERPRINT_KEY/);
  assert.match(source, /reconcileCommentState/);
  assert.match(source, /syncActiveWpsSession/);
  assert.match(source, /addCommentOnce/);
  assert.match(source, /未重复生成批注/);
  assert.match(source, /clearCommentOperation/);
  assert.match(source, /function pendingSuggestions\(\)/);
  assert.match(source, /state\.filter = 'pending'/);
  assert.match(source, /postAcceptanceEvent\('suggestion\.located', next, result, \{ operationId \}\)/);
  assert.match(source, /'suggestion\.located',\s*false/);
  assert.match(source, /ambiguous_anchor/);
  assert.match(source, /前后文不足以唯一定位/);
  assert.match(source, /\/api\/wps\/documents/);
  assert.match(source, /function suggestionQuerySuffix\(\)/);
  assert.match(source, /copyConnectionCode/);
  assert.match(source, /state\.connectionCode/);
  assert.match(source, /documentLabel/);
  assert.match(source, /metaKey && event\.key\.toLowerCase\(\) === 'z'/);
  assert.match(source, /addComment\(suggestion\)/);
  assert.match(source, /nextStatus === 'commented' && !acceptStatuses\.has/);
  assert.doesNotMatch(source, /applyReplacement\(suggestion\)/);
  assert.doesNotMatch(source, /sessionInput/);
});

test('task pane preserves action errors after rendering the latest state', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');

  assert.match(source, /let actionError = ''/);
  assert.match(source, /if \(actionError\) showActionError\(actionError\)/);
  assert.match(source, /else if \(advanceError\) showActionError\(advanceError\)/);
});

test('task pane keeps a successful locate message visible after rendering', async () => {
  const source = await readFile(path.resolve('public/addin/app.js'), 'utf8');
  assert.match(source, /successMessage = result\.message \|\| actionName/);
  assert.match(source, /successMessage && !advanceAfterAction/);
});

test('task pane does not fall back to another document when WPS registration is unavailable', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const storage = new Map();
  let suggestionCalls = 0;
  const adapter = {
    mode: 'wps',
    async getSessionMeta() {
      return { docTitle: '当前文章', docFingerprint: 'doc:1', textLength: 1, wpsVersion: 'test' };
    }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: {
        getItem(key) { return storage.get(key) || null; },
        setItem(key, value) { storage.set(key, value); }
      },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url) => {
      if (String(url).endsWith('/api/wps/documents')) {
        return { ok: true, status: 200, json: async () => ({ documents: [] }) };
      }
      if (String(url).endsWith('/api/suggestions')) suggestionCalls += 1;
      return { ok: true, status: 200, json: async () => ({ suggestions: [] }) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 1150));

  assert.equal(suggestionCalls, 0);
  assert.match(elements.connectionStatus.textContent, /当前没有可用的 WPS 文档/);
  assert.match(source, /async function resolveWpsDocumentSession\(\)/);
  assert.match(source, /Never fall back to the generic session store in WPS mode/);
  assert.match(source, /throw lastError/);
});

test('task pane stylesheet follows the cold gray single-accent visual spec', async () => {
  const css = await readFile('public/addin/styles.css', 'utf8');

  assert.match(css, /--bg:\s*#f5f5f7/i);
  assert.match(css, /--accent:\s*#0071e3/i);
  assert.match(css, /--danger:\s*#d70015/i);
  assert.match(css, /border-radius:\s*8px/);
  assert.match(css, /\.detail-sheet/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.doesNotMatch(css, /box-shadow:/i);
  assert.doesNotMatch(css, /gradient/i);
});

test('undo toast stays in normal layout instead of covering action buttons', async () => {
  const css = await readFile('public/addin/styles.css', 'utf8');
  const undoToastRule = css.match(/\.undo-toast\s*\{[^}]+\}/)?.[0] || '';

  assert.match(undoToastRule, /position:\s*static/);
  assert.doesNotMatch(undoToastRule, /position:\s*absolute/);
  assert.doesNotMatch(undoToastRule, /bottom:\s*/);
});

test('task pane does not call Comments.Add twice when status sync fails after comment creation', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const storage = new Map();
  let commentCalls = 0;
  let patchCalls = 0;
  let firstPatch = true;
  const suggestion = {
    id: 'suggestion-once',
    status: 'pending',
    createdAt: '2026-07-14T00:00:00.000Z',
    docSessionId: 'mock-doc',
    anchor: { text: '原文' },
    comment: '建议核验原文',
    sourceAgent: 'test'
  };
  const adapter = {
    mode: 'mock',
    async getSessionMeta() { return { docTitle: 'Mock', docFingerprint: 'mock:1', textLength: 1, wpsVersion: '' }; },
    async addComment() {
      commentCalls += 1;
      return { ok: true, start: 0, end: 2, message: '已生成批注' };
    },
    async locateSuggestion() { return { ok: true, start: 0, end: 2, message: '已定位' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      crypto: { randomUUID: () => 'operation-once' },
      localStorage: {
        getItem(key) { return storage.get(key) || null; },
        setItem(key, value) { storage.set(key, value); }
      },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).endsWith('/api/sessions/register')) {
        return { ok: true, status: 200, json: async () => ({ session: { docSessionId: 'mock-doc' } }) };
      }
      if (String(url).includes('/api/suggestions/')) {
        patchCalls += 1;
        if (firstPatch) {
          firstPatch = false;
          throw new Error('simulated status sync failure');
        }
        return { ok: true, status: 200, json: async () => ({ suggestion: { ...suggestion, status: 'commented' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ suggestions: [{ ...suggestion }] }) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  await elements.acceptButton.handlers.click();
  await elements.acceptButton.handlers.click();

  assert.equal(commentCalls, 1);
  assert.equal(patchCalls, 2);
  assert.deepEqual(JSON.parse(storage.get('agent-wps-reviewer.comment-operations.v1')), {});
});

test('task pane recovers a comment written before the adapter response was lost', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const storage = new Map();
  let commentCalls = 0;
  let recoveryCalls = 0;
  let commentExists = false;
  const suggestion = {
    id: 'suggestion-crash-recovery',
    status: 'pending',
    createdAt: '2026-07-14T00:00:00.000Z',
    docSessionId: 'mock-doc',
    anchor: { text: '原文' },
    comment: '建议核验原文',
    sourceAgent: 'test'
  };
  const adapter = {
    mode: 'mock',
    async getSessionMeta() {
      return { docTitle: 'Mock', docFingerprint: 'mock:1', textLength: 1, wpsVersion: '' };
    },
    async addComment() {
      commentCalls += 1;
      commentExists = true;
      throw new Error('模拟 WPS 已写入但响应丢失');
    },
    async findComment() {
      recoveryCalls += 1;
      return {
        ok: true,
        present: commentExists,
        fingerprint: commentExists
          ? { suggestionId: suggestion.id, start: 0, end: 2, anchorText: '原文', text: '建议核验原文' }
          : null
      };
    },
    async locateSuggestion() { return { ok: true, start: 0, end: 2, message: '已定位' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      crypto: { randomUUID: () => 'operation-crash-recovery' },
      localStorage: {
        getItem(key) { return storage.get(key) || null; },
        setItem(key, value) { storage.set(key, value); }
      },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url) => {
      const target = String(url);
      if (target.endsWith('/api/sessions/register')) {
        return { ok: true, status: 200, json: async () => ({ session: { docSessionId: 'mock-doc' } }) };
      }
      if (target.includes('/api/suggestions/suggestion-crash-recovery')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ suggestion: { ...suggestion, status: 'commented' } })
        };
      }
      return { ok: true, status: 200, json: async () => ({ suggestions: [{ ...suggestion }] }) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  await elements.acceptButton.handlers.click();
  await elements.acceptButton.handlers.click();

  assert.equal(commentCalls, 1);
  assert.equal(recoveryCalls, 1);
  assert.deepEqual(JSON.parse(storage.get('agent-wps-reviewer.comment-operations.v1')), {});
});

test('task pane keeps a pending suggestion when comment recovery cannot be confirmed', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const storage = new Map([
    ['agent-wps-reviewer.comment-operations.v1', JSON.stringify({
      'suggestion-recovery-unknown': { status: 'started', operationId: 'operation-unknown' }
    })]
  ]);
  let patchCalls = 0;
  const suggestion = {
    id: 'suggestion-recovery-unknown', status: 'pending', createdAt: '2026-07-14T00:00:00.000Z',
    docSessionId: 'mock-doc', anchor: { text: '原文' }, comment: '建议核验原文', sourceAgent: 'test'
  };
  const adapter = {
    mode: 'mock',
    async getSessionMeta() { return { docTitle: 'Mock', docFingerprint: 'mock:1', textLength: 1, wpsVersion: '' }; },
    async findComment() { return { ok: false, unknown: true, reason: 'comments_unavailable' }; },
    async addComment() { throw new Error('不应在未知状态下重复写入'); },
    async locateSuggestion() { return { ok: true, start: 0, end: 2, message: '已定位' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url) => {
      const target = String(url);
      if (target.endsWith('/api/sessions/register')) {
        return { ok: true, status: 200, json: async () => ({ session: { docSessionId: 'mock-doc' } }) };
      }
      if (target.includes('/api/suggestions/suggestion-recovery-unknown')) {
        patchCalls += 1;
        return { ok: true, status: 200, json: async () => ({ suggestion }) };
      }
      return { ok: true, status: 200, json: async () => ({ suggestions: [{ ...suggestion }] }) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  await elements.acceptButton.handlers.click();

  assert.equal(patchCalls, 0);
  assert.equal(elements.detailStatus.textContent, '待处理');
  assert.match(elements.actionResult.textContent, /无法确认批注是否已写入/);
});

test('task pane reopens a commented suggestion when WPS native undo removed its comment', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const storage = new Map();
  let patchCalls = 0;
  const suggestion = {
    id: 'comment-undone',
    status: 'commented',
    createdAt: '2026-07-14T00:00:00.000Z',
    docSessionId: 'wps-doc-1',
    anchor: { text: '原文' },
    comment: '建议核验原文',
    sourceAgent: 'test'
  };
  const adapter = {
    mode: 'wps',
    async getSessionMeta() {
      return { docTitle: '真实文章', docFingerprint: 'doc:4', textLength: 4, wpsVersion: 'test' };
    },
    async findComment() {
      return { ok: true, present: false };
    },
    async locateSuggestion() { return { ok: true, start: 0, end: 2, message: '已定位' }; },
    async addComment() { return { ok: true, start: 0, end: 2, message: '已生成批注' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: {
        getItem(key) { return storage.get(key) || null; },
        setItem(key, value) { storage.set(key, value); }
      },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).endsWith('/api/wps/documents')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ documents: [{ documentHandle: 'wps-doc-1', title: '真实文章', isActive: true, revisionToken: 'r1', textLength: 4 }] })
        };
      }
      if (String(url).includes('/api/suggestions/comment-undone')) {
        patchCalls += 1;
        return { ok: true, status: 200, json: async () => ({ suggestion: { ...suggestion, status: 'pending' } }) };
      }
      if (String(url).includes('/api/suggestions?docSessionId=wps-doc-1')) {
        return { ok: true, status: 200, json: async () => ({ suggestions: [{ ...suggestion }] }) };
      }
      return { ok: true, status: 201, json: async () => ({}) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(patchCalls, 1);
  assert.equal(elements.detailStatus.textContent, '待处理');
});

test('task pane confirms the target active handle and does not advance after locate', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const suggestionA = {
    id: 'locate-a', status: 'pending', createdAt: '2026-07-14T00:02:00.000Z',
    docSessionId: 'wps-doc-a', anchor: { text: '文章 A' }, comment: '核验 A', sourceAgent: 'test'
  };
  const suggestionB = {
    id: 'locate-b', status: 'pending', createdAt: '2026-07-14T00:01:00.000Z',
    docSessionId: 'wps-doc-b', anchor: { text: '文章 B' }, comment: '核验 B', sourceAgent: 'test'
  };
  const storage = new Map();
  let locateCalls = 0;
  let activeCalls = 0;
  const adapter = {
    mode: 'wps',
    async getSessionMeta() { return { docTitle: '文章 A', docFingerprint: 'a:1', textLength: 1, wpsVersion: 'test' }; },
    async findComment() { return { ok: true, present: true }; },
    async locateSuggestion() { locateCalls += 1; return { ok: true, start: 0, end: 3, message: '已定位' }; },
    async addComment() { return { ok: true, start: 0, end: 3, message: '已生成批注' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/api/wps/documents')) {
        return { ok: true, status: 200, json: async () => ({ documents: [
          { documentHandle: 'wps-doc-a', title: '文章 A', isActive: true, revisionToken: 'a:1', textLength: 1 },
          { documentHandle: 'wps-doc-b', title: '文章 B', isActive: false, revisionToken: 'b:1', textLength: 1 }
        ] }) };
      }
      if (target.endsWith('/api/wps/documents/active')) {
        activeCalls += 1;
        const documentHandle = activeCalls === 1 ? 'old-handle' : 'wps-doc-a';
        return { ok: true, status: 200, json: async () => ({ document: { documentHandle, title: '文章 A', revisionToken: 'a:1', textLength: 1 } }) };
      }
      if (target.endsWith('/api/suggestions?docSessionId=wps-doc-a')) {
        return { ok: true, status: 200, json: async () => ({ suggestions: [suggestionA, suggestionB] }) };
      }
      return { ok: true, status: 201, json: async () => ({}) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  await elements.locateButton.handlers.click();
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(locateCalls, 1);
  assert.equal(activeCalls, 2);
  assert.equal(elements.detailTitle.textContent, '核验 A');
});

test('task pane clears detail after processing the last pending item instead of looping backward', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  const listButtons = [];
  elements.suggestionList.appendChild = (button) => listButtons.push(button);
  const suggestionA = {
    id: 'next-a', status: 'pending', createdAt: '2026-07-14T00:02:00.000Z',
    docSessionId: 'mock-doc', anchor: { text: '原文 A' }, comment: '建议 A', sourceAgent: 'test'
  };
  const suggestionB = {
    id: 'next-b', status: 'pending', createdAt: '2026-07-14T00:01:00.000Z',
    docSessionId: 'mock-doc', anchor: { text: '原文 B' }, comment: '建议 B', sourceAgent: 'test'
  };
  let locateCalls = 0;
  const adapter = {
    mode: 'mock',
    async getSessionMeta() { return { docTitle: '文章', docFingerprint: 'mock:1', textLength: 10, wpsVersion: '' }; },
    async locateSuggestion() { locateCalls += 1; return { ok: true, start: 0, end: 2, message: '已定位' }; },
    async addComment() { return { ok: true, start: 0, end: 2, message: '已生成批注' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: { getItem() { return null; }, setItem() {} },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url) => {
      const target = String(url);
      if (target.endsWith('/api/sessions/register')) {
        return { ok: true, status: 200, json: async () => ({ session: { docSessionId: 'mock-doc' } }) };
      }
      if (target.endsWith('/api/suggestions?docSessionId=mock-doc')) {
        return { ok: true, status: 200, json: async () => ({ suggestions: [suggestionA, suggestionB] }) };
      }
      if (target.endsWith('/api/suggestions/next-b')) {
        return { ok: true, status: 200, json: async () => ({ suggestion: { ...suggestionB, status: 'rejected', resultMessage: '用户拒绝' } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  // A is the first item; choose B, the last pending item, then reject it.
  assert.equal(listButtons.length >= 2, true);
  listButtons[1].handlers.click();
  await elements.rejectButton.handlers.click();

  assert.equal(locateCalls, 0);
  assert.equal(elements.detailCard.hidden, true);
  assert.equal(elements.emptyDetail.hidden, false);
});

test('task pane locates and records the next pending suggestion after reject and accept', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  elements.suggestionList.appendChild = () => {};
  const suggestions = [
    {
      id: 'advance-a', status: 'pending', createdAt: '2026-07-14T00:03:00.000Z',
      docSessionId: 'wps-doc', anchor: { text: '原文 A' }, comment: '建议 A', sourceAgent: 'test'
    },
    {
      id: 'advance-b', status: 'pending', createdAt: '2026-07-14T00:02:00.000Z',
      docSessionId: 'wps-doc', anchor: { text: '原文 B' }, comment: '建议 B', sourceAgent: 'test'
    },
    {
      id: 'advance-c', status: 'pending', createdAt: '2026-07-14T00:01:00.000Z',
      docSessionId: 'wps-doc', anchor: { text: '原文 C' }, comment: '建议 C', sourceAgent: 'test'
    }
  ];
  const locateCalls = [];
  const commentCalls = [];
  const acceptanceEvents = [];
  const adapter = {
    mode: 'wps',
    async getSessionMeta() {
      return { docTitle: '文章', docFingerprint: 'doc:1', textLength: 20, wpsVersion: 'test' };
    },
    async locateSuggestion(suggestion) {
      locateCalls.push(suggestion.id);
      return { ok: true, start: 0, end: 3, message: '已定位' };
    },
    async addComment(suggestion) {
      commentCalls.push(suggestion.id);
      return {
        ok: true,
        start: 0,
        end: 3,
        commentFingerprint: { suggestionId: suggestion.id, start: 0, end: 3, anchorText: suggestion.anchor.text, text: suggestion.comment },
        message: '已生成批注'
      };
    },
    async findComment() { return { ok: true, present: false }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: { getItem() { return null; }, setItem() {} },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/api/wps/documents')) {
        return { ok: true, status: 200, json: async () => ({ documents: [{ documentHandle: 'wps-doc', title: '文章', isActive: true, revisionToken: 'doc:1', textLength: 20 }] }) };
      }
      if (target.endsWith('/api/wps/documents/active')) {
        return { ok: true, status: 200, json: async () => ({ document: { documentHandle: 'wps-doc', title: '文章', revisionToken: 'doc:1', textLength: 20 } }) };
      }
      if (target.endsWith('/api/suggestions?docSessionId=wps-doc')) {
        return { ok: true, status: 200, json: async () => ({ suggestions }) };
      }
      if (target.includes('/api/suggestions/')) {
        const id = target.split('/').pop();
        const body = id === 'advance-a'
          ? { ...suggestions[0], status: 'rejected', resultMessage: '用户拒绝' }
          : { ...suggestions[1], status: 'commented', resultMessage: '已生成批注' };
        return { ok: true, status: 200, json: async () => ({ suggestion: body }) };
      }
      if (target.endsWith('/api/acceptance/events')) {
        acceptanceEvents.push(JSON.parse(options.body));
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  await elements.rejectButton.handlers.click();
  assert.deepEqual(locateCalls, ['advance-b']);
  assert.equal(acceptanceEvents.filter((event) => event.eventType === 'suggestion.located')[0].suggestionId, 'advance-b');

  await elements.acceptButton.handlers.click();
  assert.deepEqual(commentCalls, ['advance-b']);
  assert.deepEqual(locateCalls, ['advance-b', 'advance-c']);
  assert.deepEqual(
    acceptanceEvents.filter((event) => event.eventType === 'suggestion.located').map((event) => event.suggestionId),
    ['advance-b', 'advance-c']
  );
});

test('task pane never accepts stale or conflicted suggestions', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');
  const ids = [
    'connectionStatus', 'refreshButton', 'pendingCount', 'filterPending', 'filterAll',
    'offlineNotice', 'suggestionList', 'detailSheet', 'detailCard', 'emptyDetail',
    'closeDetailButton', 'detailStatus', 'detailTitle', 'detailDocument', 'detailAnchor',
    'detailComment', 'actionResult', 'locateButton', 'rejectButton', 'acceptButton',
    'undoToast', 'undoRejectButton'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  let addCommentCalls = 0;
  const suggestion = {
    id: 'stale-suggestion', status: 'stale', createdAt: '2026-07-14T00:00:00.000Z',
    docSessionId: 'mock-doc', anchor: { text: '旧原文' }, comment: '旧建议', sourceAgent: 'test'
  };
  const adapter = {
    mode: 'mock',
    async getSessionMeta() { return { docTitle: '文章', docFingerprint: 'mock:1', textLength: 1, wpsVersion: '' }; },
    async locateSuggestion() { return { ok: true, start: 0, end: 2, message: '已定位' }; },
    async addComment() { addCommentCalls += 1; return { ok: true, start: 0, end: 2, message: '已生成批注' }; }
  };
  const context = {
    window: {
      location: { origin: 'http://mock' },
      localStorage: { getItem() { return null; }, setItem() {} },
      addEventListener() {},
      WpsReviewAdapters: { createAdapter: () => adapter }
    },
    document: {
      hasFocus: () => true,
      getElementById(id) { return elements[id] || (elements[id] = fakeElement()); },
      createElement: () => fakeElement()
    },
    EventSource: class { addEventListener() {} close() {} },
    fetch: async (url) => {
      const target = String(url);
      if (target.endsWith('/api/sessions/register')) {
        return { ok: true, status: 200, json: async () => ({ session: { docSessionId: 'mock-doc' } }) };
      }
      if (target.includes('/api/suggestions?')) {
        return { ok: true, status: 200, json: async () => ({ suggestions: [suggestion] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(elements.acceptButton.disabled, true);
  assert.equal(elements.rejectButton.disabled, false);
  await elements.acceptButton.handlers.click();
  assert.equal(addCommentCalls, 0);
  assert.match(elements.actionResult.textContent, /文章已发生变化/);
});
