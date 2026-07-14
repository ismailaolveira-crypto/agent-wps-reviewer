(function () {
  const pendingStatuses = new Set(['pending', 'conflict', 'stale']);
  const acceptStatuses = new Set(['pending']);
  const UNDO_TOAST_VISIBLE_MS = 4500;
  const COMMENT_OPERATION_LOG_KEY = 'agent-wps-reviewer.comment-operations.v1';
  const COMMENT_FINGERPRINT_KEY = 'agent-wps-reviewer.comment-fingerprints.v1';
  const COMMENT_RECONCILE_MS = 3000;

  const state = {
    baseUrl: window.location.origin,
    docSessionId: 'default',
    documentKey: '',
    connectionCode: '',
    documents: [],
    suggestions: [],
    activeId: null,
    filter: 'pending',
    detailOpen: false,
    selectionCleared: false,
    eventSource: null,
    adapter: null,
    sessionMeta: null,
    connected: false,
    focused: document.hasFocus(),
    undoRejectStack: [],
    undoToastVisible: false,
    undoToastTimer: null,
    actionLockedId: null,
    commentOperations: {},
    commentFingerprints: {},
    commentReconcileTimer: null
  };

  const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    currentDocument: document.getElementById('currentDocument'),
    connectionCode: document.getElementById('connectionCode'),
    copyConnectionCodeButton: document.getElementById('copyConnectionCodeButton'),
    connectionCodeStatus: document.getElementById('connectionCodeStatus'),
    refreshButton: document.getElementById('refreshButton'),
    pendingCount: document.getElementById('pendingCount'),
    filterPending: document.getElementById('filterPending'),
    filterAll: document.getElementById('filterAll'),
    offlineNotice: document.getElementById('offlineNotice'),
    suggestionList: document.getElementById('suggestionList'),
    detailSheet: document.getElementById('detailSheet'),
    detailCard: document.getElementById('detailCard'),
    emptyDetail: document.getElementById('emptyDetail'),
    closeDetailButton: document.getElementById('closeDetailButton'),
    detailStatus: document.getElementById('detailStatus'),
    detailTitle: document.getElementById('detailTitle'),
    detailDocument: document.getElementById('detailDocument'),
    detailAnchor: document.getElementById('detailAnchor'),
    detailComment: document.getElementById('detailComment'),
    actionResult: document.getElementById('actionResult'),
    locateButton: document.getElementById('locateButton'),
    rejectButton: document.getElementById('rejectButton'),
    acceptButton: document.getElementById('acceptButton'),
    undoToast: document.getElementById('undoToast'),
    undoRejectButton: document.getElementById('undoRejectButton')
  };

  function statusLabel(status) {
    const labels = {
      pending: '待处理',
      commented: '已接受',
      rejected: '已拒绝',
      conflict: '冲突',
      stale: '已过期',
      applied: '已应用'
    };
    return labels[status] || status;
  }

  function categoryOf(suggestion) {
    const value = String(suggestion.metadata?.category || suggestion.category || suggestion.severity || '建议').trim();
    const labels = {
      'duplicate-compression': '重复与压缩',
      'numbering-figure-table': '图表编号',
      'structure-logic': '结构逻辑',
      'data-fact': '事实核验',
      'style-consistency': '风格一致性',
      minor: '文字优化',
      major: '重点问题'
    };
    return labels[value] || (value && /^[\u4e00-\u9fff]/u.test(value) ? value : '审阅建议');
  }

  function anchorTextOf(suggestion) {
    return String(suggestion.anchor?.text || suggestion.anchorText || '').trim();
  }

  function titleOf(suggestion) {
    return String(suggestion.title || suggestion.comment || anchorTextOf(suggestion) || '审阅建议')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function summaryOf(suggestion) {
    const anchor = anchorTextOf(suggestion);
    if (anchor) return anchor.replace(/\s+/g, ' ').trim();
    return String(suggestion.comment || '').replace(/\s+/g, ' ').trim();
  }

  function documentForSuggestion(suggestion) {
    const documentKey = suggestionDocumentKey(suggestion);
    if (documentKey) {
      const byKey = state.documents.find((item) => item.documentKey === documentKey);
      if (byKey) return byKey;
    }
    const handle = String(suggestion?.metadata?.documentHandle || suggestion?.docSessionId || '').trim();
    return state.documents.find((item) => item.documentHandle === handle) || null;
  }

  function documentLabel(suggestion) {
    const document = documentForSuggestion(suggestion);
    return document?.title || suggestion?.metadata?.documentTitle || '目标文档';
  }

  function sortedSuggestions(items) {
    return [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function currentSuggestions() {
    const visible = state.filter === 'pending'
      ? state.suggestions.filter((item) => pendingStatuses.has(item.status))
      : state.suggestions;
    return sortedSuggestions(visible);
  }

  function pendingSuggestions() {
    return sortedSuggestions(state.suggestions.filter((item) => pendingStatuses.has(item.status)));
  }

  function activeSuggestion() {
    return state.suggestions.find((item) => item.id === state.activeId) || null;
  }

  function loadCommentOperations() {
    try {
      const raw = window.localStorage?.getItem(COMMENT_OPERATION_LOG_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      state.commentOperations = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      state.commentOperations = {};
    }
  }

  function persistCommentOperations() {
    try {
      window.localStorage?.setItem(COMMENT_OPERATION_LOG_KEY, JSON.stringify(state.commentOperations));
    } catch {
      // A storage restriction must not prevent document review actions.
    }
  }

  function loadCommentFingerprints() {
    try {
      const raw = window.localStorage?.getItem(COMMENT_FINGERPRINT_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      state.commentFingerprints = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      state.commentFingerprints = {};
    }
  }

  function persistCommentFingerprints() {
    try {
      window.localStorage?.setItem(COMMENT_FINGERPRINT_KEY, JSON.stringify(state.commentFingerprints));
    } catch {
      // A storage restriction must not prevent document review actions.
    }
  }

  function saveCommentFingerprint(suggestionId, fingerprint) {
    if (!fingerprint || !Number.isFinite(Number(fingerprint.start)) || !Number.isFinite(Number(fingerprint.end))) return;
    state.commentFingerprints[suggestionId] = {
      suggestionId: String(fingerprint.suggestionId || suggestionId),
      start: Number(fingerprint.start),
      end: Number(fingerprint.end),
      anchorText: String(fingerprint.anchorText || ''),
      text: String(fingerprint.text || ''),
      textSummary: String(fingerprint.textSummary || fingerprint.text || '').slice(0, 160),
      savedAt: new Date().toISOString()
    };
    persistCommentFingerprints();
  }

  function clearCommentFingerprint(suggestionId) {
    if (!state.commentFingerprints[suggestionId]) return;
    delete state.commentFingerprints[suggestionId];
    persistCommentFingerprints();
  }

  function newOperationId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `comment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function clearCommentOperation(suggestionId) {
    if (!state.commentOperations[suggestionId]) return;
    delete state.commentOperations[suggestionId];
    persistCommentOperations();
  }

  function persistStartedCommentOperation(suggestion, operationId) {
    state.commentOperations[suggestion.id] = {
      status: 'started',
      operationId,
      documentHandle: suggestionDocumentHandle(suggestion),
      startedAt: new Date().toISOString()
    };
    persistCommentOperations();
  }

  function persistCreatedCommentOperation(suggestion, operationId, result) {
    state.commentOperations[suggestion.id] = {
      status: 'comment-created',
      operationId,
      documentHandle: suggestionDocumentHandle(suggestion),
      start: result.start,
      end: result.end,
      commentFingerprint: result.commentFingerprint || null,
      createdAt: new Date().toISOString()
    };
    persistCommentOperations();
  }

  async function addCommentOnce(suggestion) {
    const existing = state.commentOperations[suggestion.id];
    if (existing?.status === 'comment-created') {
      const commentFingerprint = existing.commentFingerprint || state.commentFingerprints[suggestion.id];
      return {
        ok: true,
        start: existing.start,
        end: existing.end,
        operationId: existing.operationId,
        commentFingerprint,
        message: '已恢复批注写入状态，未重复生成批注'
      };
    }

    const operationId = existing?.operationId || newOperationId();
    if (!existing) persistStartedCommentOperation(suggestion, operationId);

    if (existing?.status === 'started') {
      if (typeof state.adapter.findComment !== 'function') {
        return { ok: false, reason: 'comment_recovery_unavailable', message: '无法确认批注是否已写入，请稍后重试' };
      }

      let recovery;
      try {
        recovery = await state.adapter.findComment(
          suggestion,
          existing.commentFingerprint || state.commentFingerprints[suggestion.id] || {},
          { activateTarget: true }
        );
      } catch {
        return { ok: false, reason: 'comment_recovery_unavailable', message: '无法确认批注是否已写入，请稍后重试' };
      }

      if (!recovery || recovery.ok !== true || typeof recovery.present !== 'boolean') {
        return { ok: false, reason: 'comment_recovery_unavailable', message: '无法确认批注是否已写入，请稍后重试' };
      }
      if (recovery.present) {
        const recovered = {
          ok: true,
          start: recovery.fingerprint?.start,
          end: recovery.fingerprint?.end,
          commentFingerprint: recovery.fingerprint,
          message: '检测到已有批注，未重复生成'
        };
        persistCreatedCommentOperation(suggestion, operationId, recovered);
        return { ...recovered, operationId };
      }
    }

    const result = await state.adapter.addComment(suggestion);
    if (!result?.ok) return result;

    persistCreatedCommentOperation(suggestion, operationId, result);
    return { ...result, operationId };
  }

  function setConnectionStatus(text, connected) {
    state.connected = connected;
    elements.connectionStatus.textContent = text;
    elements.connectionStatus.style.color = connected ? '#6e6e73' : '#8a5a00';
    elements.offlineNotice.hidden = connected;
    renderActionState();
  }

  function setCurrentDocument(document) {
    state.connectionCode = String(document?.connectionCode || '').trim();
    if (elements.currentDocument) elements.currentDocument.textContent = document?.title
      ? `当前文档：${document.title}`
      : '当前文档：等待 WPS 文档';
    if (elements.connectionCode) {
      elements.connectionCode.textContent = state.connectionCode
        ? `连接码：${state.connectionCode}`
        : '连接码：等待生成';
    }
    if (elements.copyConnectionCodeButton) elements.copyConnectionCodeButton.disabled = !state.connectionCode;
  }

  async function copyConnectionCode() {
    if (!state.connectionCode) return;
    try {
      if (window.navigator?.clipboard?.writeText) {
        await window.navigator.clipboard.writeText(state.connectionCode);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = state.connectionCode;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand('copy')) throw new Error('剪贴板不可用');
        textarea.remove();
      }
      if (elements.connectionCodeStatus) elements.connectionCodeStatus.textContent = '已复制，可发给 Agent';
    } catch (error) {
      if (elements.connectionCodeStatus) elements.connectionCodeStatus.textContent = '复制失败，请手动选择';
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(`${state.baseUrl}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || response.statusText);
    return body;
  }

  async function resolveWpsDocumentSession() {
    let lastError = new Error('WPS 插件未连接，请确认 Agent 审阅加载项已启用');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const body = await api('/api/wps/documents');
        state.documents = Array.isArray(body.documents) ? body.documents : [];
        const active = state.documents.find((item) => item.isActive) || state.documents[0];
        if (!active) throw new Error('当前没有可用的 WPS 文档');
        setCurrentDocument(active);
        state.docSessionId = active.documentHandle;
        state.documentKey = active.documentKey || '';
        state.sessionMeta = {
          docTitle: active.title,
          docFingerprint: active.revisionToken,
          textLength: active.textLength,
          documentKey: state.documentKey,
          connectionCode: state.connectionCode,
          identityKind: active.identityKind || 'session'
        };
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw lastError;
  }

  async function resolveDocumentSession() {
    if (state.adapter.mode === 'wps') {
      // Never fall back to the generic session store in WPS mode: that could show
      // another document's suggestions before the connector has registered the target.
      await resolveWpsDocumentSession();
      return;
    }

    const meta = await state.adapter.getSessionMeta();
    state.sessionMeta = meta;
    const docSessionId = meta.documentHandle || meta.docSessionId || 'default';
    const body = await api('/api/sessions/register', {
      method: 'POST',
      body: JSON.stringify({
        docSessionId,
        docTitle: meta.docTitle,
        docFingerprint: meta.docFingerprint,
        client: state.adapter.mode
      })
    });
    state.docSessionId = body.session.docSessionId;
  }

  function upsertSuggestion(suggestion) {
    suggestion = bindSuggestionToCurrentDocument(suggestion);
    const index = state.suggestions.findIndex((item) => item.id === suggestion.id);
    if (index === -1) state.suggestions.push(suggestion);
    else state.suggestions[index] = suggestion;
  }

  async function loadSuggestions() {
    await resolveDocumentSession();
    const suffix = suggestionQuerySuffix();
    const body = await api(`/api/suggestions${suffix}`);
    state.selectionCleared = false;
    state.suggestions = (body.suggestions || []).map(bindSuggestionToCurrentDocument);
    await reconcileCommentState();
    render();
  }

  async function updateStatus(id, status, resultMessage) {
    const body = await api(`/api/suggestions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resultMessage })
    });
    upsertSuggestion(body.suggestion);
    return body.suggestion;
  }

  async function syncActiveWpsSession(expectedHandle = '') {
    if (state.adapter?.mode !== 'wps') return false;
    const expected = String(expectedHandle || '').trim();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const body = await api('/api/wps/documents/active');
        const active = body.document;
        if (active?.documentHandle && (!expected || active.documentHandle === expected)) {
          setCurrentDocument(active);
          state.docSessionId = active.documentHandle;
          state.documentKey = active.documentKey || '';
          state.sessionMeta = {
            docTitle: active.title,
            docFingerprint: active.revisionToken,
            textLength: active.textLength,
            documentKey: state.documentKey,
            connectionCode: state.connectionCode,
            identityKind: active.identityKind || 'session'
          };
          return true;
        }
      } catch {
        // The connector heartbeat may need a moment after WPS activates a document.
      }
      if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  async function prepareTargetDocument(suggestion, operationId) {
    if (state.adapter?.mode !== 'wps') {
      return typeof state.adapter?.prepareTarget === 'function'
        ? state.adapter.prepareTarget(suggestion)
        : { ok: true, message: '模拟文档已确认' };
    }

    const expectedHandle = suggestionDocumentHandle(suggestion);
    const prepared = typeof state.adapter.prepareTarget === 'function'
      ? await state.adapter.prepareTarget(suggestion)
      : { ok: true, message: '目标文档已确认' };
    if (!prepared?.ok) return prepared || { ok: false, reason: 'target_not_open' };

    if (prepared.documentIdentityConfirmed === true) {
      await postAcceptanceEvent('suggestion.target.confirmed', suggestion, prepared, { operationId });
      return prepared;
    }

    const synced = await syncActiveWpsSession(expectedHandle);
    if (!synced) {
      return {
        ok: false,
        reason: 'target_identity_mismatch',
        message: '目标 WPS 文档未确认，请重新定位'
      };
    }
    await postAcceptanceEvent('suggestion.target.confirmed', suggestion, prepared, { operationId });
    return prepared;
  }

  function suggestionDocumentHandle(suggestion) {
    return String(suggestion?.metadata?.documentHandle || suggestion?.docSessionId || '').trim();
  }

  function suggestionDocumentKey(suggestion) {
    return String(suggestion?.metadata?.documentKey || '').trim();
  }

  function bindSuggestionToCurrentDocument(suggestion) {
    if (
      state.adapter?.mode !== 'wps' ||
      !state.documentKey ||
      suggestionDocumentKey(suggestion) !== state.documentKey
    ) return suggestion;
    return {
      ...suggestion,
      docSessionId: state.docSessionId,
      metadata: {
        ...(suggestion.metadata || {}),
        documentHandle: state.docSessionId,
        documentKey: state.documentKey
      }
    };
  }

  function suggestionQuerySuffix() {
    if (state.adapter.mode === 'wps') {
      if (state.documentKey) return `?documentKey=${encodeURIComponent(state.documentKey)}`;
      return `?docSessionId=${encodeURIComponent(state.docSessionId)}`;
    }
    return `?docSessionId=${encodeURIComponent(state.docSessionId)}`;
  }

  async function reconcileCommentState() {
    if (state.adapter?.mode !== 'wps' || typeof state.adapter.findComment !== 'function') return;
    const activeHandle = String(state.docSessionId || '').trim();
    if (!activeHandle) return;

    const candidates = state.suggestions.filter((suggestion) =>
      suggestion.status === 'commented' && (
        (state.documentKey && suggestionDocumentKey(suggestion) === state.documentKey) ||
        (!state.documentKey && suggestionDocumentHandle(suggestion) === activeHandle)
      )
    );

    for (const suggestion of candidates) {
      const existingFingerprint = state.commentFingerprints[suggestion.id] || {};
      let check;
      try {
        check = await state.adapter.findComment(suggestion, existingFingerprint);
      } catch {
        continue;
      }

      // An unavailable WPS collection is not evidence that a comment was deleted.
      if (!check || check.ok !== true || typeof check.present !== 'boolean') continue;
      if (check.present) {
        if (!existingFingerprint && check.fingerprint) saveCommentFingerprint(suggestion.id, check.fingerprint);
        continue;
      }

      try {
        await updateStatus(suggestion.id, 'pending', 'WPS 中的批注已被撤销，已恢复为待处理');
        clearCommentFingerprint(suggestion.id);
        if (state.activeId === suggestion.id || !state.activeId) {
          state.activeId = suggestion.id;
          state.detailOpen = true;
          state.filter = 'pending';
        }
      } catch {
        // Keep the fingerprint so a later reconciliation can retry the status update.
      }
    }
  }

  function startCommentReconciliation() {
    if (state.adapter?.mode !== 'wps' || typeof window.setInterval !== 'function') return;
    if (state.commentReconcileTimer) window.clearInterval(state.commentReconcileTimer);
    state.commentReconcileTimer = window.setInterval(() => {
      reconcileCommentState().then(() => render()).catch(() => {});
    }, COMMENT_RECONCILE_MS);
  }

  function connectEvents() {
    if (state.eventSource) state.eventSource.close();

    const suffix = suggestionQuerySuffix();
    state.eventSource = new EventSource(`/api/events${suffix}`);
    state.eventSource.addEventListener('open', () => setConnectionStatus('已连接本地 bridge', true));
    state.eventSource.addEventListener('error', () => setConnectionStatus('bridge 连接中断，正在重试', false));
    state.eventSource.addEventListener('hello', (event) => {
      const payload = JSON.parse(event.data);
      if (Array.isArray(payload.suggestions)) {
        state.suggestions = payload.suggestions;
        render();
      }
    });
    state.eventSource.addEventListener('suggestion.created', (event) => {
      upsertSuggestion(JSON.parse(event.data));
      render();
    });
    state.eventSource.addEventListener('suggestion.updated', (event) => {
      upsertSuggestion(JSON.parse(event.data));
      render();
    });
  }

  async function refreshAll() {
    await loadSuggestions();
    connectEvents();
  }

  function renderTabs() {
    const pendingCount = state.suggestions.filter((item) => pendingStatuses.has(item.status)).length;
    elements.pendingCount.textContent = String(pendingCount);
    elements.filterPending.classList.toggle('is-active', state.filter === 'pending');
    elements.filterAll.classList.toggle('is-active', state.filter === 'all');
    elements.filterPending.setAttribute('aria-selected', state.filter === 'pending' ? 'true' : 'false');
    elements.filterAll.setAttribute('aria-selected', state.filter === 'all' ? 'true' : 'false');
  }

  function renderList() {
    const list = currentSuggestions();
    elements.suggestionList.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = state.filter === 'pending' ? '暂无待处理建议' : '暂无建议';
      elements.suggestionList.appendChild(empty);
      return;
    }

    if (!state.selectionCleared && (!state.activeId || !list.some((item) => item.id === state.activeId))) {
      state.activeId = list[0].id;
      if (state.filter === 'pending') state.detailOpen = true;
    }

    for (const suggestion of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `suggestion-card ${suggestion.id === state.activeId ? 'is-active' : ''}`;
      button.dataset.id = suggestion.id;

      const category = document.createElement('div');
      category.className = 'category-label';
      category.textContent = categoryOf(suggestion);

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = titleOf(suggestion);

      const summary = document.createElement('div');
      summary.className = 'summary-line';
      summary.textContent = summaryOf(suggestion);

      const meta = document.createElement('div');
      meta.className = 'meta-line';
      meta.textContent = `${documentLabel(suggestion)} · ${statusLabel(suggestion.status)} · ${suggestion.sourceAgent || 'agent'}`;

      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');

      button.append(category, chevron, title, summary, meta);
      button.addEventListener('click', () => {
        state.activeId = suggestion.id;
        state.detailOpen = true;
        state.selectionCleared = false;
        hideUndoToast({ renderNow: false });
        render();
      });
      elements.suggestionList.appendChild(button);
    }
  }

  function renderDetail() {
    const suggestion = activeSuggestion();
    const visible = Boolean(suggestion && state.detailOpen);
    elements.detailCard.hidden = !visible;
    elements.emptyDetail.hidden = visible;

    if (!visible) return;

    elements.detailStatus.textContent = statusLabel(suggestion.status);
    elements.detailStatus.dataset.status = suggestion.status;
    elements.detailTitle.textContent = titleOf(suggestion);
    if (elements.detailDocument) elements.detailDocument.textContent = documentLabel(suggestion);
    elements.detailAnchor.textContent = anchorTextOf(suggestion) || '未提供正文片段';
    elements.detailComment.textContent = suggestion.comment || '';
    elements.actionResult.textContent = suggestion.resultMessage || '';
    elements.actionResult.classList.remove('is-error');
    renderActionState();
  }

  function renderActionState() {
    const suggestion = activeSuggestion();
    const busy = Boolean(suggestion && state.actionLockedId === suggestion.id);
    const actionable = Boolean(suggestion && pendingStatuses.has(suggestion.status) && state.connected && !busy);
    const acceptable = Boolean(suggestion && acceptStatuses.has(suggestion.status) && state.connected && !busy);
    elements.locateButton.disabled = !suggestion || !state.connected || busy || suggestion.status === 'rejected';
    elements.rejectButton.disabled = !actionable;
    elements.acceptButton.disabled = !acceptable;
  }

  function showActionError(message) {
    elements.actionResult.textContent = message;
    elements.actionResult.classList.add('is-error');
  }

  function locationErrorMessage(reason, next = false) {
    const messages = {
      anchor_not_found: '未找到对应正文',
      ambiguous_anchor: '正文中存在多个相同片段，前后文不足以唯一定位',
      context_mismatch: '提供的前后文与锚点不相邻，已停止猜测定位',
      target_not_open: '目标文章未打开或已关闭，请先打开目标文章',
      target_identity_mismatch: '当前打开的不是目标文章，请切换到目标文章后重试',
      runtime_error: 'WPS 操作失败，请稍后重试并复制诊断信息',
      range_text_mismatch: '定位范围与原文不一致，已停止写入',
      unsupported_structure: '当前版本暂不支持此类文档结构',
      selection_failed: '已找到原文，但 WPS 未能选中该范围',
      comments_api_unavailable: '当前 WPS 未提供可用的批注接口',
      comment_unverified: '批注写入结果无法确认，未重复写入',
      stale_document: '文章已发生变化，请刷新后重新读取',
      closed_document: '目标文章已关闭，请重新选择文章',
      comment_recovery_unavailable: '无法确认已有批注状态，请稍后重试'
    };
    const prefix = next ? '下一个建议' : '当前建议';
    return `${prefix}${messages[reason] || reason || '无法定位'}`;
  }

  function clearUndoToastTimer() {
    if (!state.undoToastTimer) return;
    clearTimeout(state.undoToastTimer);
    state.undoToastTimer = null;
  }

  function hideUndoToast({ renderNow = true } = {}) {
    clearUndoToastTimer();
    state.undoToastVisible = false;
    if (renderNow) renderUndoToast();
  }

  function showUndoToast() {
    clearUndoToastTimer();
    state.undoToastVisible = true;
    state.undoToastTimer = setTimeout(() => {
      state.undoToastTimer = null;
      state.undoToastVisible = false;
      renderUndoToast();
    }, UNDO_TOAST_VISIBLE_MS);
  }

  function renderUndoToast() {
    elements.undoToast.hidden = !state.undoToastVisible || state.undoRejectStack.length === 0;
  }

  function render() {
    renderTabs();
    renderList();
    renderDetail();
    renderUndoToast();
  }

  function nextPendingSuggestionAfter(previousId, pendingBeforeAction = []) {
    const previousIndex = pendingBeforeAction.findIndex((item) => item.id === previousId);
    const after = pendingSuggestions();
    if (!after.length) return null;
    if (previousIndex >= 0) return after[previousIndex] || null;
    return after[0];
  }

  async function advanceToNextPending(previousId, pendingBeforeAction, operationId = newOperationId()) {
    const next = nextPendingSuggestionAfter(previousId, pendingBeforeAction);
    if (!next) {
      state.activeId = null;
      state.detailOpen = false;
      state.selectionCleared = true;
      return '';
    }

    state.filter = 'pending';
    state.activeId = next.id;
    state.detailOpen = true;
    state.selectionCleared = false;
    state.actionLockedId = next.id;
    render();

    try {
      await postAcceptanceEvent('suggestion.auto_advance.started', next, {}, { operationId });
      const target = await prepareTargetDocument(next, operationId);
      if (!target?.ok) {
        await postAcceptanceEvent('suggestion.auto_advance.failed', next, target, {
          operationId,
          step: 'target.prepare',
          reason: target.reason
        });
        return locationErrorMessage(target.reason, true);
      }
      const result = await state.adapter.locateSuggestion(next);
      if (!result.ok) {
        await postAcceptanceEvent('suggestion.location.failed', next, result, {
          operationId,
          step: 'next.locate',
          reason: result.reason
        });
        await postAcceptanceEvent('suggestion.auto_advance.failed', next, result, {
          operationId,
          step: 'next.locate',
          reason: result.reason
        });
        return locationErrorMessage(result.reason, true);
      }
      await postAcceptanceEvent('suggestion.location.resolved', next, result, { operationId });
      await postAcceptanceEvent('suggestion.located', next, result, { operationId });
      await postAcceptanceEvent('suggestion.action.completed', next, result, { operationId, step: 'next.locate' });
      return '';
    } catch (error) {
      await postAcceptanceEvent('suggestion.auto_advance.failed', next, {
        ok: false,
        reason: 'runtime_error',
        message: error.message
      }, { operationId, step: 'next.locate', reason: 'runtime_error' });
      return error.message || String(error);
    }
  }

  function diagnosticHash(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  async function postAcceptanceEvent(eventType, suggestion, result = {}, extra = {}) {
    if (state.adapter.mode !== 'wps' && !extra.includeMock) return;
    try {
      const meta = await state.adapter.getSessionMeta();
      await api('/api/acceptance/events', {
        method: 'POST',
        body: JSON.stringify({
          eventType,
          adapterMode: state.adapter.mode,
          docSessionId: suggestion?.docSessionId || state.docSessionId,
          docTitle: meta.docTitle,
          docFingerprint: meta.docFingerprint,
          wpsVersion: meta.wpsVersion || '',
          suggestionId: suggestion?.id || '',
          resultMessage: result?.message || '',
          location: result && Number.isFinite(result.start) ? { start: result.start, end: result.end } : null,
          operationId: extra.operationId || '',
          step: extra.step || result?.step || '',
          reason: extra.reason || result?.reason || '',
          errorCode: extra.errorCode || result?.code || result?.errorCode || '',
          documentKeyHash: diagnosticHash(suggestionDocumentKey(suggestion) || state.documentKey),
          actualRevisionToken: result?.revisionToken || meta.docFingerprint || '',
          structureType: extra.structureType || result?.structureType || '',
          anchorLength: Number.isFinite(Number(result?.anchorLength))
            ? Number(result.anchorLength)
            : anchorTextOf(suggestion || {}).length,
          candidateCount: Number.isFinite(Number(result?.candidateCount)) ? Number(result.candidateCount) : undefined,
          rangeCorrection: Number.isFinite(Number(result?.rangeCorrection)) ? Number(result.rangeCorrection) : undefined
        })
      });
    } catch {
      // Telemetry must never block document review actions.
    }
  }

  async function runAction(actionName, action, nextStatus, acceptanceEventType, advanceAfterAction = true) {
    const suggestion = activeSuggestion();
    if (!suggestion) return;
    if (nextStatus === 'commented' && !acceptStatuses.has(suggestion.status)) {
      showActionError(suggestion.status === 'stale'
        ? '文章已发生变化，请刷新并重新读取后再接受'
        : '当前建议无法接受，请先重新定位或刷新建议');
      return;
    }

    const pendingBeforeAction = pendingSuggestions();
    state.actionLockedId = suggestion.id;
    elements.actionResult.textContent = '处理中';
    elements.actionResult.classList.remove('is-error');
    renderActionState();

    let actionError = '';
    let advanceError = '';
    let successMessage = '';
    const operationId = newOperationId();
    try {
      await postAcceptanceEvent('suggestion.action.started', suggestion, {}, {
        operationId,
        step: nextStatus === 'commented' ? 'comment.start' : 'locate.start'
      });
      const target = await prepareTargetDocument(suggestion, operationId);
      if (!target?.ok) {
        actionError = locationErrorMessage(target.reason);
        await postAcceptanceEvent('suggestion.action.failed', suggestion, target, {
          operationId,
          step: 'target.prepare',
          reason: target.reason
        });
        return;
      }
      if (nextStatus === 'commented') {
        await postAcceptanceEvent('suggestion.comment.started', suggestion, {}, { operationId, step: 'comment.start' });
      }
      const result = await action(suggestion);
      if (!result.ok) {
        if (result.reason === 'comment_recovery_unavailable') {
          actionError = result.message || locationErrorMessage(result.reason);
          await postAcceptanceEvent('suggestion.comment.failed', suggestion, result, {
            operationId,
            step: 'comment.recovery',
            reason: result.reason
          });
          await postAcceptanceEvent('suggestion.action.failed', suggestion, result, {
            operationId,
            step: 'comment.recovery',
            reason: result.reason
          });
          return;
        }
        const message = locationErrorMessage(result.reason);
        if (['ambiguous_anchor', 'context_mismatch'].includes(result.reason)) {
          await updateStatus(suggestion.id, 'conflict', message);
        }
        actionError = message;
        await postAcceptanceEvent(nextStatus === 'commented' ? 'suggestion.comment.failed' : 'suggestion.location.failed', suggestion, result, {
          operationId,
          step: nextStatus === 'commented' ? 'comment.resolve' : 'locate.resolve',
          reason: result.reason
        });
        await postAcceptanceEvent('suggestion.action.failed', suggestion, result, {
          operationId,
          step: nextStatus === 'commented' ? 'comment.resolve' : 'locate.resolve',
          reason: result.reason
        });
        return;
      }
      successMessage = result.message || actionName;
      if (nextStatus === 'commented' && result.commentFingerprint) {
        // Persist before PATCH so a network failure cannot cause a second Comments.Add.
        saveCommentFingerprint(suggestion.id, result.commentFingerprint);
      }
      if (suggestion.status !== nextStatus) {
        await updateStatus(suggestion.id, nextStatus, result.message || actionName);
      }
      if (nextStatus === 'commented') clearCommentOperation(suggestion.id);
      if (nextStatus === 'commented') {
        await postAcceptanceEvent('suggestion.comment.verified', suggestion, result, { operationId, step: 'comment.verify' });
      } else {
        await postAcceptanceEvent('suggestion.location.resolved', suggestion, result, { operationId, step: 'locate.verify' });
      }
      if (acceptanceEventType) await postAcceptanceEvent(acceptanceEventType, suggestion, result, { operationId });
      if (advanceAfterAction) {
        advanceError = await advanceToNextPending(suggestion.id, pendingBeforeAction, operationId);
      }
      await postAcceptanceEvent('suggestion.action.completed', suggestion, result, { operationId, step: 'action.completed' });
    } catch (error) {
      actionError = error.message || String(error);
      await postAcceptanceEvent('suggestion.action.failed', suggestion, {
        ok: false,
        reason: 'runtime_error',
        message: actionError,
        code: error.code
      }, { operationId, step: 'action.exception', reason: 'runtime_error' });
    } finally {
      state.actionLockedId = null;
      render();
      if (actionError) showActionError(actionError);
      else if (advanceError) showActionError(advanceError);
      else if (successMessage && !advanceAfterAction) elements.actionResult.textContent = successMessage;
    }
  }

  async function rejectActiveSuggestion() {
    const suggestion = activeSuggestion();
    if (!suggestion) return;

    const pendingBeforeAction = pendingSuggestions();
    const operationId = newOperationId();
    state.actionLockedId = suggestion.id;
    renderActionState();
    let actionError = '';
    let advanceError = '';
    try {
      await postAcceptanceEvent('suggestion.action.started', suggestion, {}, { operationId, step: 'reject.start' });
      await updateStatus(suggestion.id, 'rejected', '用户拒绝');
      state.undoRejectStack.push({ id: suggestion.id });
      showUndoToast();
      await postAcceptanceEvent('suggestion.action.completed', suggestion, { ok: true, message: '用户拒绝' }, { operationId, step: 'reject.completed' });
      advanceError = await advanceToNextPending(suggestion.id, pendingBeforeAction, operationId);
    } catch (error) {
      actionError = error.message || String(error);
      await postAcceptanceEvent('suggestion.action.failed', suggestion, {
        ok: false,
        reason: 'runtime_error',
        message: actionError,
        code: error.code
      }, { operationId, step: 'reject.exception', reason: 'runtime_error' });
    } finally {
      state.actionLockedId = null;
      render();
      if (actionError) showActionError(actionError);
      else if (advanceError) showActionError(advanceError);
    }
  }

  async function undoLastReject() {
    const item = state.undoRejectStack.pop();
    if (!item) return;

    let actionError = '';
    try {
      const restored = await updateStatus(item.id, 'pending', '已撤销拒绝');
      state.activeId = restored.id;
      state.detailOpen = true;
      state.filter = 'pending';
      state.selectionCleared = false;
      if (!state.undoRejectStack.length) hideUndoToast({ renderNow: false });
    } catch (error) {
      state.undoRejectStack.push(item);
      state.undoToastVisible = true;
      actionError = error.message || String(error);
    } finally {
      render();
      if (actionError) showActionError(actionError);
    }
  }

  function bindEvents() {
    elements.refreshButton.addEventListener('click', () => {
      refreshAll().catch((error) => setConnectionStatus(error.message, false));
    });
    elements.copyConnectionCodeButton.addEventListener('click', copyConnectionCode);

    elements.filterPending.addEventListener('click', () => {
      state.filter = 'pending';
      state.selectionCleared = false;
      hideUndoToast({ renderNow: false });
      render();
    });

    elements.filterAll.addEventListener('click', () => {
      state.filter = 'all';
      state.selectionCleared = false;
      hideUndoToast({ renderNow: false });
      render();
    });

    elements.closeDetailButton.addEventListener('click', () => {
      state.detailOpen = false;
      renderDetail();
    });

    elements.locateButton.addEventListener('click', () =>
      runAction(
        '已定位',
        (suggestion) => state.adapter.locateSuggestion(suggestion),
        activeSuggestion()?.status || 'pending',
        'suggestion.located',
        false
      )
    );

    elements.rejectButton.addEventListener('click', rejectActiveSuggestion);
    elements.acceptButton.addEventListener('click', () =>
      runAction('已接受', addCommentOnce, 'commented', 'suggestion.commented')
    );
    elements.undoRejectButton.addEventListener('click', undoLastReject);

    window.addEventListener('focus', () => {
      state.focused = true;
    });
    window.addEventListener('blur', () => {
      state.focused = false;
    });
    window.addEventListener('keydown', (event) => {
      if (state.focused && event.metaKey && event.key.toLowerCase() === 'z' && state.undoRejectStack.length) {
        event.preventDefault();
        undoLastReject();
      }
    });
  }

  async function main() {
    state.adapter = window.WpsReviewAdapters.createAdapter();
    loadCommentOperations();
    loadCommentFingerprints();
    bindEvents();
    await refreshAll();
    startCommentReconciliation();
    await postAcceptanceEvent('taskpane.opened');
    setConnectionStatus(
      state.adapter.mode === 'wps' ? '已连接 WPS 与本地 bridge' : '浏览器验收模式已连接本地 bridge',
      true
    );
  }

  main().catch((error) => {
    setConnectionStatus(error.message, false);
  });
})();
