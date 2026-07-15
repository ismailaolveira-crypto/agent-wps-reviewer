(function () {
  const MAX_RANGE_CORRECTION = 4;

  function hasWpsRuntime() {
    return Boolean(window.wps && typeof window.wps.WpsApplication === 'function');
  }

  function findAllOccurrences(text, needle) {
    const result = [];
    if (!needle) return result;
    let index = text.indexOf(needle);
    while (index !== -1) {
      result.push(index);
      index = text.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return result;
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
  }

  function rangeTextMatches(actual, expected) {
    return actual === expected || normalizeLineEndings(actual) === normalizeLineEndings(expected);
  }

  function isWhitespace(char) {
    return /\s/.test(char || '');
  }

  function buildNormalizedIndex(value) {
    const source = String(value || '');
    let text = '';
    const map = [];
    let pendingSpace = false;
    let pendingSpaceIndex = -1;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (isWhitespace(char)) {
        if (text.length > 0) {
          pendingSpace = true;
          if (pendingSpaceIndex === -1) pendingSpaceIndex = i;
        }
        continue;
      }

      if (pendingSpace) {
        text += ' ';
        map.push(pendingSpaceIndex);
        pendingSpace = false;
        pendingSpaceIndex = -1;
      }

      text += char;
      map.push(i);
    }

    return { text, map };
  }

  function findNormalizedOccurrences(documentText, needle) {
    const source = buildNormalizedIndex(documentText);
    const target = normalizeWhitespace(needle);
    const result = [];
    if (!target) return result;

    let index = source.text.indexOf(target);
    while (index !== -1) {
      const start = source.map[index];
      const lastMapped = source.map[index + target.length - 1];
      const end = typeof lastMapped === 'number' ? lastMapped + 1 : start + target.length;
      result.push({ start, end });
      index = source.text.indexOf(target, index + Math.max(target.length, 1));
    }

    return result;
  }

  function matchesContextBoundary(actual, expected, side) {
    const source = normalizeWhitespace(actual);
    const target = normalizeWhitespace(expected);
    if (!target) return true;
    if (side === 'before') {
      return source.endsWith(target) || source.replace(/[\s，。；：、,.!?！？“”‘’"'）)】]$/gu, '').endsWith(target);
    }
    return source.startsWith(target) || source.replace(/^[\s，。；：、,.!?！？“”‘’"'（(【[]+/gu, '').startsWith(target);
  }

  function contextScore(documentText, start, anchorText, before, after) {
    let score = 0;
    const prefix = documentText.slice(Math.max(0, start - 500), start);
    const suffix = documentText.slice(start + anchorText.length, start + anchorText.length + 500);

    const normalizedPrefix = normalizeWhitespace(prefix);
    const normalizedSuffix = normalizeWhitespace(suffix);
    const normalizedBefore = normalizeWhitespace(before);
    const normalizedAfter = normalizeWhitespace(after);

    if (normalizedBefore && normalizedPrefix.includes(normalizedBefore)) {
      score += 1;
    }
    if (normalizedAfter && normalizedSuffix.includes(normalizedAfter)) {
      score += 1;
    }
    if (normalizedBefore && matchesContextBoundary(prefix, before, 'before')) score += 8;
    if (normalizedAfter && matchesContextBoundary(suffix, after, 'after')) score += 8;

    return score;
  }

  function contextMatches(documentText, start, anchorText, before, after) {
    const prefix = documentText.slice(Math.max(0, start - 500), start);
    const suffix = documentText.slice(start + anchorText.length, start + anchorText.length + 500);
    const normalizedBefore = normalizeWhitespace(before);
    const normalizedAfter = normalizeWhitespace(after);
    return {
      before: !normalizedBefore || matchesContextBoundary(prefix, before, 'before'),
      after: !normalizedAfter || matchesContextBoundary(suffix, after, 'after')
    };
  }

  function rankCandidates(matches, text, before, after, strategy) {
    const enriched = matches.map((match) => ({
      ...match,
      score: contextScore(text, match.start, text.slice(match.start, match.end), before, after),
      context: contextMatches(text, match.start, text.slice(match.start, match.end), before, after)
    }));
    const hasContext = Boolean(normalizeWhitespace(before) || normalizeWhitespace(after));
    const contextual = hasContext
      ? enriched.filter((match) => match.context.before && match.context.after)
      : enriched;

    if (hasContext && !contextual.length) {
      return {
        ok: false,
        reason: 'context_mismatch',
        message: '前后文与锚点不相邻，已停止猜测定位'
      };
    }

    const ranked = (contextual.length ? contextual : enriched)
      .sort((a, b) => b.score - a.score || a.start - b.start);
    const best = ranked[0];
    return {
      ok: true,
      strategy,
      ambiguous: ranked.length > 1 && ranked[0].score === ranked[1]?.score,
      start: best.start,
      end: best.end,
      score: best.score
    };
  }

  function locateInText(documentText, suggestion) {
    const anchorText = String((suggestion.anchor && suggestion.anchor.text) || suggestion.anchorText || '').trim();
    if (!anchorText) return { ok: false, reason: 'missing_anchor_text' };

    const storedLocation = suggestion.location || suggestion.metadata?.location || null;
    const storedStart = Number(storedLocation?.start);
    const storedEnd = Number(storedLocation?.end);
    if (Number.isInteger(storedStart) && Number.isInteger(storedEnd) && storedStart >= 0 && storedEnd > storedStart) {
      const storedText = String(documentText || '').slice(storedStart, storedEnd);
      if (rangeTextMatches(storedText, anchorText)) {
        return {
          ok: true,
          strategy: 'stored-location',
          start: storedStart,
          end: storedEnd,
          score: Number(storedLocation.score) || 0,
          candidateCount: 1
        };
      }
    }

    const before = String(
      (suggestion.anchor && suggestion.anchor.before) || suggestion.contextBefore || suggestion.beforeText || ''
    ).trim();
    const after = String(
      (suggestion.anchor && suggestion.anchor.after) || suggestion.contextAfter || suggestion.afterText || ''
    ).trim();
    const starts = findAllOccurrences(documentText, anchorText);

    const exactMatches = starts.map((start) => ({
      start,
      end: start + anchorText.length
    }));
    const normalizedMatches = exactMatches.length
      ? []
      : findNormalizedOccurrences(documentText, anchorText).map((match) => ({
          start: match.start,
          end: match.end
        }));
    const candidates = exactMatches.length ? exactMatches : normalizedMatches;

    if (!candidates.length) return { ok: false, reason: 'anchor_not_found' };
    const located = rankCandidates(
      candidates,
      documentText,
      before,
      after,
      exactMatches.length ? 'exact' : 'normalized-whitespace'
    );
    if (!located.ok || !located.ambiguous) return located;
    return {
      ok: false,
      reason: 'ambiguous_anchor',
      message: '正文中存在多个相同锚点，前后文不足以唯一定位',
      candidateCount: located.candidateCount || candidates.length
    };
  }

  function buildCommentText(suggestion) {
    return [
      suggestion.comment,
      suggestion.replacement ? `建议替换：${suggestion.replacement}` : '',
      suggestion.reason ? `理由：${suggestion.reason}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  function getDocumentText(doc) {
    if (doc.Content && typeof doc.Content.Text === 'string') return doc.Content.Text;
    if (doc.Content && typeof doc.Content.Text !== 'undefined') return String(doc.Content.Text);
    if (typeof doc.GetDocumentRange === 'function') {
      const range = doc.GetDocumentRange();
      return String(range.Text || '');
    }
    return '';
  }

  function getRange(doc, start, end) {
    if (typeof doc.Range === 'function') return doc.Range(start, end);
    if (doc.Application && typeof doc.Application.Range === 'function') return doc.Application.Range(start, end);
    throw new Error('当前 WPS 运行时未暴露 Range(start, end)');
  }

  function getRangeText(range) {
    return range && typeof range.Text === 'string' ? range.Text : null;
  }

  function readRangePosition(range, key) {
    if (!range || typeof range[key] === 'undefined') return null;
    const raw = typeof range[key] === 'function' ? range[key]() : range[key];
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function configureFind(find) {
    if (!find) return;
    if (typeof find.ClearFormatting === 'function') find.ClearFormatting();
    const options = {
      Forward: true,
      Wrap: 0,
      Format: false,
      MatchCase: true,
      MatchWholeWord: false,
      MatchWildcards: false
    };
    for (const [key, value] of Object.entries(options)) {
      try {
        find[key] = value;
      } catch {
        // Older WPS builds expose only a subset of Find options.
      }
    }
  }

  function findNativeRanges(doc, targetText, limit = 100) {
    const content = doc && doc.Content;
    const contentStart = readRangePosition(content, 'Start') ?? 0;
    const contentEnd = readRangePosition(content, 'End');
    if (!targetText || contentEnd === null || contentEnd <= contentStart) return [];

    const ranges = [];
    let cursor = contentStart;
    while (cursor < contentEnd && ranges.length < limit) {
      const searchRange = getRange(doc, cursor, contentEnd);
      const find = searchRange && searchRange.Find;
      if (!find || typeof find.Execute !== 'function') return [];
      configureFind(find);

      let executed = false;
      try {
        executed = find.Execute(targetText);
      } catch {
        return [];
      }

      const start = readRangePosition(searchRange, 'Start');
      const end = readRangePosition(searchRange, 'End');
      const rangeText = getRangeText(searchRange);
      const found = executed !== false && start !== null && end !== null && end > start &&
        rangeText !== null && rangeTextMatches(rangeText, targetText);
      if (!found) break;

      ranges.push({ range: searchRange, start, end });
      cursor = end > cursor ? end : cursor + 1;
    }
    return ranges;
  }

  function resolveWithNativeFind(doc, documentText, location, targetText) {
    const textMatches = findAllOccurrences(documentText, targetText);
    const occurrenceIndex = textMatches.indexOf(location.start);
    const requiredMatches = occurrenceIndex >= 0
      ? occurrenceIndex + 1
      : Math.max(1, Math.min(textMatches.length, 100));
    const nativeRanges = findNativeRanges(doc, targetText, requiredMatches);
    if (!nativeRanges.length) return null;

    let selected = occurrenceIndex >= 0 ? nativeRanges[occurrenceIndex] : null;
    if (!selected && nativeRanges.length === 1) selected = nativeRanges[0];
    if (!selected) return null;

    return {
      range: selected.range,
      location: {
        ...location,
        start: selected.start,
        end: selected.end,
        textStart: location.start,
        textEnd: location.end,
        rangeCorrection: true,
        rangeStrategy: 'native-find'
      }
    };
  }

  function resolveRange(doc, documentText, location) {
    const targetText = String(documentText || '').slice(location.start, location.end);
    const directRange = getRange(doc, location.start, location.end);
    const directText = getRangeText(directRange);
    if (directText === null || rangeTextMatches(directText, targetText)) {
      return {
        range: directRange,
        location: { ...location, rangeCorrection: false, rangeStrategy: 'direct' }
      };
    }

    // Native Find crosses the WPS bridge once and avoids dozens of expensive
    // Range calls when hidden document markers create cumulative offsets.
    const nativeResolved = resolveWithNativeFind(doc, documentText, location, targetText);
    if (nativeResolved) return nativeResolved;

    for (let radius = 1; radius <= MAX_RANGE_CORRECTION; radius += 1) {
      for (let startDelta = -radius; startDelta <= radius; startDelta += 1) {
        for (let endDelta = -radius; endDelta <= radius; endDelta += 1) {
          if (Math.max(Math.abs(startDelta), Math.abs(endDelta)) !== radius) continue;
          const start = location.start + startDelta;
          const end = location.end + endDelta;
          if (start < 0 || end <= start || end > String(documentText || '').length) continue;
          const range = getRange(doc, start, end);
          const rangeText = getRangeText(range);
          if (rangeText === null || rangeTextMatches(rangeText, targetText)) {
            return {
              range,
              location: {
                ...location,
                start,
                end,
                rangeCorrection: true,
                rangeStrategy: 'bounded-correction'
              }
            };
          }
        }
      }
    }

    const error = new Error('WPS 定位范围与正文不一致，请重新定位');
    error.code = 'WPS_RANGE_MISMATCH';
    throw error;
  }

  function readCollectionCount(collection) {
    const keys = ['Count', 'count', 'Length', 'length'];
    for (const key of keys) {
      if (!collection || typeof collection[key] === 'undefined') continue;
      const raw = typeof collection[key] === 'function' ? collection[key]() : collection[key];
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function getCollectionItem(collection, index) {
    const methods = ['Item', 'item', 'GetItem', 'get_Item'];
    for (const method of methods) {
      if (!collection || typeof collection[method] !== 'function') continue;
      try {
        const item = collection[method](index);
        if (item) return item;
      } catch {
        // Some WPS builds expose one-based items while others expose zero-based items.
      }
    }
    try {
      if (collection && collection[index]) return collection[index];
    } catch {
      // Ignore unavailable index accessors.
    }
    return null;
  }

  function getCommentText(comment, anchorText = '') {
    const candidates = [
      comment && comment.Text,
      comment && comment.CommentText,
      comment && comment.text,
      comment && comment.commentText,
      comment && comment.Range && comment.Range.CommentText
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') return candidate;
    }
    const rangeText = comment && comment.Range && comment.Range.Text;
    if (typeof rangeText === 'string' && !sameCommentText(rangeText, anchorText)) return rangeText;
    return null;
  }

  function getCommentRanges(comment) {
    const candidates = [
      comment && comment.Scope,
      comment && comment.scope,
      comment && comment.Anchor,
      comment && comment.anchor,
      comment && comment.Reference,
      comment && comment.reference,
      comment && comment.TargetRange,
      comment && comment.targetRange,
      comment && comment.Range,
      comment && comment.range
    ];
    return candidates.filter(Boolean).map((range) => {
      const start = Number(range.Start ?? range.start);
      const end = Number(range.End ?? range.end);
      return {
        start: Number.isFinite(start) ? start : null,
        end: Number.isFinite(end) ? end : null,
        text: typeof range.Text === 'string' ? range.Text : null
      };
    });
  }

  function sameCommentText(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    return normalizeWhitespace(actual) === normalizeWhitespace(expected);
  }

  function commentMatches(comment, fingerprint) {
    const ranges = getCommentRanges(comment);
    const body = getCommentText(comment, fingerprint.anchorText);
    const rangeMatches = ranges.some((range) =>
      Number.isFinite(Number(fingerprint.start)) &&
      Number.isFinite(Number(fingerprint.end)) &&
      range.start === Number(fingerprint.start) &&
      range.end === Number(fingerprint.end)
    );
    const anchorMatches = ranges.some((range) =>
      typeof range.text === 'string' &&
      sameCommentText(range.text, fingerprint.anchorText)
    );
    const bodyReadable = typeof body === 'string';
    const bodyMatches = bodyReadable && sameCommentText(body, fingerprint.text);

    if (bodyReadable && bodyMatches && (rangeMatches || anchorMatches)) return true;
    if (!bodyReadable && (rangeMatches || anchorMatches)) return true;
    return false;
  }

  function scanComments(comments, fingerprint) {
    const count = readCollectionCount(comments);
    const items = [];
    const seen = new Set();

    const add = (comment) => {
      if (!comment || seen.has(comment)) return;
      seen.add(comment);
      items.push(comment);
    };

    if (count !== null) {
      for (let index = 0; index < count; index += 1) add(getCollectionItem(comments, index));
      for (let index = 1; index <= count; index += 1) add(getCollectionItem(comments, index));
    } else if (Array.isArray(comments)) {
      comments.forEach(add);
    } else {
      return { ok: false, unknown: true, reason: 'comments_collection_unreadable' };
    }

    return {
      ok: true,
      present: items.some((comment) => commentMatches(comment, fingerprint)),
      checked: items.length
    };
  }

  function normalizeDocumentName(value) {
    return String(value || '').replace(/\\/g, '/').toLowerCase();
  }

  function documentFullName(doc) {
    return String((doc && (doc.FullName || doc.Path)) || '');
  }

  function documentTitle(doc) {
    return String((doc && (doc.Name || doc.FullName || doc.Path)) || 'WPS Document');
  }

  function normalizeDocumentKey(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  }

  function suggestionTarget(suggestion) {
    const metadata = suggestion?.metadata || {};
    return {
      documentHandle: String(metadata.documentHandle || suggestion?.docSessionId || '').trim(),
      documentKey: normalizeDocumentKey(metadata.documentKey),
      connectionCode: String(metadata.connectionCode || '').trim().toUpperCase(),
      fullName: normalizeDocumentName(metadata.documentFullName),
      title: String(metadata.documentTitle || '').trim()
    };
  }

  function documentMatchesTarget(document, target, { allowTitle = false } = {}) {
    if (!document) return false;
    const actualFullName = normalizeDocumentName(document.fullName || documentFullName(document));
    const actualKey = normalizeDocumentKey(document.documentKey || (actualFullName ? `path:${actualFullName}` : ''));
    if (target.documentKey && actualKey) return target.documentKey === actualKey;
    if (target.fullName && actualFullName) return target.fullName === actualFullName;
    if (target.connectionCode && document.connectionCode) {
      return target.connectionCode === String(document.connectionCode).trim().toUpperCase();
    }
    if (allowTitle && target.title) return target.title === String(document.title || documentTitle(document)).trim();
    return false;
  }

  async function listLiveDocuments() {
    const response = await fetch(`${window.location.origin}/api/wps/documents`, {
      headers: { 'content-type': 'application/json' }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('正在恢复文档连接，请稍后再试');
    return Array.isArray(body.documents) ? body.documents : [];
  }

  function findLiveTarget(documents, target) {
    let matches = documents.filter((document) => documentMatchesTarget(document, target));
    if (matches.length === 1) return matches[0];

    if (target.documentHandle) {
      const byHandle = documents.find((document) => document.documentHandle === target.documentHandle);
      if (byHandle) return byHandle;
    }

    if (target.title) {
      matches = documents.filter((document) => documentMatchesTarget(document, target, { allowTitle: true }));
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function activateTargetDocument(app, suggestion) {
    const target = suggestionTarget(suggestion);
    const activeDocument = app.ActiveDocument;
    const hasStableIdentity = Boolean(target.documentKey || target.fullName || target.connectionCode);
    if (!hasStableIdentity && !target.documentHandle) return activeDocument;

    // The task pane normally belongs to the target document. Prefer the WPS object
    // already in hand instead of making users depend on a fresh bridge heartbeat.
    if (documentMatchesTarget(activeDocument, target, { allowTitle: !target.documentKey && !target.fullName })) {
      return activeDocument;
    }

    let expected = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const documents = await listLiveDocuments();
        expected = findLiveTarget(documents, target);
        if (!expected) break;

        const current = app.ActiveDocument;
        if (documentMatchesTarget(current, {
          ...target,
          documentKey: normalizeDocumentKey(expected.documentKey) || target.documentKey,
          fullName: normalizeDocumentName(expected.fullName) || target.fullName,
          title: String(expected.title || target.title).trim()
        }, { allowTitle: true })) {
          return current;
        }

        const response = await fetch(
          `${window.location.origin}/api/wps/documents/${encodeURIComponent(expected.documentHandle)}/activate`,
          { method: 'POST', headers: { 'content-type': 'application/json' } }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message || '文档切换失败');
        expected = body.document || expected;
        break;
      } catch (error) {
        lastError = error;
        expected = null;
        if (attempt < 2) await delay(150 * (attempt + 1));
      }
    }

    if (!expected) {
      const error = new Error(lastError ? '正在恢复文档连接，请稍后再试' : '没有找到这篇文章，请确认它仍在 WPS 中打开');
      error.code = lastError ? 'WPS_RECONNECTING' : 'WPS_TARGET_NOT_OPEN';
      throw error;
    }

    const expectedFullName = normalizeDocumentName(expected.fullName);
    const expectedTitle = String(expected.title || target.title || '').trim();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const active = app.ActiveDocument;
      const actualFullName = normalizeDocumentName(documentFullName(active));
      const sameFullName = expectedFullName && actualFullName && expectedFullName === actualFullName;
      const sameTitle = expectedTitle && documentTitle(active) === expectedTitle;
      if (sameFullName || (!expectedFullName && sameTitle)) return active;
      await delay(50);
    }

    throw new Error(`未能切换到“${expected.title || target.title || '目标文章'}”，请再试一次`);
  }

  function getSelectionRange(app, range) {
    if (range && typeof range.Select === 'function') range.Select();
    const selection = app && app.Selection;
    return selection && selection.Range ? selection.Range : null;
  }

  async function selectRangeNearViewportCenter(doc, app, range, location) {
    const activeWindow = doc?.ActiveWindow || app?.ActiveWindow || app?.ActiveDocument?.ActiveWindow;
    let viewportRange = range;
    const contentStart = readRangePosition(doc?.Content, 'Start') ?? 0;
    const contentEnd = readRangePosition(doc?.Content, 'End');

    if (contentEnd !== null && contentEnd > contentStart) {
      const anchorLength = Math.max(1, Number(location.end) - Number(location.start));
      const contextSize = Math.max(180, Math.min(360, anchorLength * 3));
      const viewportStart = Math.max(contentStart, Number(location.start) - contextSize);
      const viewportEnd = Math.min(contentEnd, Number(location.end) + contextSize);
      try {
        viewportRange = getRange(doc, viewportStart, viewportEnd);
      } catch {
        viewportRange = range;
      }
    }

    let scrolled = false;
    if (activeWindow && typeof activeWindow.ScrollIntoView === 'function') {
      try {
        await Promise.resolve(activeWindow.ScrollIntoView(viewportRange));
        scrolled = true;
      } catch {
        // Selection remains a complete fallback on older desktop builds.
      }
    }

    if (typeof range.Select === 'function') await Promise.resolve(range.Select());

    if (!scrolled && activeWindow && typeof activeWindow.ScrollIntoView === 'function') {
      try {
        await Promise.resolve(activeWindow.ScrollIntoView(range));
        scrolled = true;
      } catch {
        // Range.Select already provides the baseline positioning behavior.
      }
    }
    return scrolled;
  }

  async function addWpsComment(doc, app, range, location, text) {
    const comments = doc.Comments;
    const countIsReadable = readCollectionCount(comments) !== null;
    const attempts = [
      () => comments.Add({ Range: range, Text: text }),
      () => comments.Add(range, text),
      () => comments.Add({ Range: { Start: location.start, End: location.end }, Text: text }),
      () => {
        const selectionRange = getSelectionRange(app, range);
        if (!selectionRange) throw new Error('当前 WPS 运行时未暴露 Selection.Range');
        return comments.Add({ Range: selectionRange, Text: text });
      },
      () => {
        const selectionRange = getSelectionRange(app, range);
        if (!selectionRange) throw new Error('当前 WPS 运行时未暴露 Selection.Range');
        return comments.Add(selectionRange, text);
      }
    ];

    let firstError = null;
    for (const attempt of attempts) {
      try {
        const before = readCollectionCount(comments);
        const result = await attempt();
        const after = readCollectionCount(comments);
        if (before !== null && after !== null) {
          if (after > before) return result;
          continue;
        }
        return result;
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
    if (countIsReadable) throw new Error('WPS 批注 API 返回成功，但未确认批注已写入');
    throw firstError || new Error('当前 WPS 运行时未能添加批注');
  }

  function createWpsAdapter() {
    const app = window.wps.WpsApplication();
    const wpsVersion = String(app.Version || app.Build || app.version || 'WPS runtime detected');
    const wpsArch = String(app.Architecture || app.architecture || app.Arch || '');

    function currentDocument() {
      return app.ActiveDocument;
    }

    return {
      mode: 'wps',
      async getSessionMeta() {
        const doc = currentDocument();
        const text = getDocumentText(doc);
        return {
          docTitle: documentTitle(doc),
          docFingerprint: `${documentFullName(doc) || documentTitle(doc)}:${text.length}`,
          textLength: text.length,
          wpsVersion,
          wpsArch
        };
      },
      async prepareTarget(suggestion) {
        const doc = await activateTargetDocument(app, suggestion);
        const target = suggestionTarget(suggestion);
        const hasStableIdentity = Boolean(target.documentKey || target.fullName || target.connectionCode);
        return {
          ok: true,
          message: '目标文档已确认',
          documentIdentityConfirmed: hasStableIdentity && documentMatchesTarget(
            doc,
            target,
            { allowTitle: !target.documentKey && !target.fullName }
          ),
          documentHandle: String(suggestion?.metadata?.documentHandle || suggestion?.docSessionId || ''),
          documentTitle: documentTitle(doc),
          fullName: documentFullName(doc)
        };
      },
      async locateSuggestion(suggestion) {
        const doc = await activateTargetDocument(app, suggestion);
        const text = getDocumentText(doc);
        const location = locateInText(text, suggestion);
        if (!location.ok) return location;
        const resolved = resolveRange(doc, text, location);
        const centered = await selectRangeNearViewportCenter(doc, app, resolved.range, resolved.location);
        return {
          ...resolved.location,
          centered,
          message: location.ambiguous ? '已定位，存在重复片段' : '已定位'
        };
      },
      async addComment(suggestion) {
        const doc = await activateTargetDocument(app, suggestion);
        const text = getDocumentText(doc);
        const location = locateInText(text, suggestion);
        if (!location.ok) return location;
        const resolved = resolveRange(doc, text, location);
        const commentText = buildCommentText(suggestion);

        if (!doc.Comments || typeof doc.Comments.Add !== 'function') {
          throw new Error('当前 WPS 运行时未暴露 Comments.Add');
        }

        await addWpsComment(doc, app, resolved.range, resolved.location, commentText);

        return {
          ...resolved.location,
          commentFingerprint: {
            suggestionId: String(suggestion.id || ''),
            start: resolved.location.start,
            end: resolved.location.end,
            anchorText: getRangeText(resolved.range) || suggestion.anchor?.text || suggestion.anchorText || '',
            text: commentText,
            textSummary: commentText.slice(0, 160)
          },
          message: '已生成批注'
        };
      },
      async findComment(suggestion, fingerprint = {}, options = {}) {
        const doc = options.activateTarget
          ? await activateTargetDocument(app, suggestion)
          : currentDocument();
        const comments = doc && doc.Comments;
        if (!comments) return { ok: false, unknown: true, reason: 'comments_unavailable' };

        const documentText = getDocumentText(doc);
        const fingerprintStart = Number(fingerprint.start);
        const fingerprintEnd = Number(fingerprint.end);
        let location = { start: fingerprintStart, end: fingerprintEnd };
        const hasStoredLocation = Number.isFinite(location.start) && Number.isFinite(location.end);
        if (!hasStoredLocation) {
          const located = locateInText(documentText, suggestion);
          if (!located.ok) return { ok: false, unknown: true, reason: located.reason };
          location = located;
        }

        const buildFingerprint = (rangeLocation) => ({
          suggestionId: String(fingerprint.suggestionId || suggestion.id || ''),
          start: rangeLocation.start,
          end: rangeLocation.end,
          anchorText: String(
            (!hasStoredLocation || rangeLocation.start !== fingerprintStart || rangeLocation.end !== fingerprintEnd)
              ? documentText.slice(rangeLocation.start, rangeLocation.end)
              : fingerprint.anchorText || documentText.slice(rangeLocation.start, rangeLocation.end) || suggestion.anchorText || ''
          ),
          text: String(fingerprint.text || buildCommentText(suggestion)),
          textSummary: String(fingerprint.textSummary || fingerprint.text || buildCommentText(suggestion)).slice(0, 160)
        });

        const expected = buildFingerprint(location);
        const scan = scanComments(comments, expected);
        if (!scan.ok || scan.present || !hasStoredLocation) {
          return { ...scan, fingerprint: expected };
        }

        // A text edit can shift a comment's range while keeping the anchor and comment alive.
        // Re-locate the current anchor before treating the stored fingerprint as deleted.
        const relocated = locateInText(documentText, suggestion);
        if (!relocated.ok || (relocated.start === location.start && relocated.end === location.end)) {
          return { ...scan, fingerprint: expected };
        }
        const relocatedExpected = buildFingerprint(relocated);
        const relocatedScan = scanComments(comments, relocatedExpected);
        return {
          ...relocatedScan,
          fingerprint: relocatedExpected
        };
      },
      async applyReplacement(suggestion) {
        if (!suggestion.replacement) return { ok: false, reason: 'missing_replacement' };
        const doc = await activateTargetDocument(app, suggestion);
        const text = getDocumentText(doc);
        const location = locateInText(text, suggestion);
        if (!location.ok) return location;
        const resolved = resolveRange(doc, text, location);
        const range = resolved.range;
        const previousTrackRevisions = doc.TrackRevisions;
        try {
          if (typeof doc.TrackRevisions !== 'undefined') doc.TrackRevisions = true;
          range.Text = suggestion.replacement;
        } finally {
          if (typeof previousTrackRevisions !== 'undefined') doc.TrackRevisions = previousTrackRevisions;
        }
        return { ...resolved.location, message: '已应用修改' };
      }
    };
  }

  function createMockAdapter() {
    const doc = document.getElementById('mockDocument');
    const comments = document.getElementById('mockComments');
    const showMockPane = new URLSearchParams(window.location.search).get('mock') === '1';
    document.getElementById('mockPane').hidden = !showMockPane;

    function getText() {
      return doc.value;
    }

    function select(location) {
      doc.focus();
      doc.setSelectionRange(location.start, location.end);
    }

    return {
      mode: 'mock',
      async getSessionMeta() {
        return {
          docTitle: 'Browser Mock Document',
          docFingerprint: `mock:${getText().length}`,
          textLength: getText().length,
          wpsVersion: ''
        };
      },
      async prepareTarget() {
        return { ok: true, message: '模拟文档已确认' };
      },
      async locateSuggestion(suggestion) {
        const location = locateInText(getText(), suggestion);
        if (location.ok) select(location);
        return { ...location, message: location.ok ? '已定位到模拟文档' : '未找到片段' };
      },
      async addComment(suggestion) {
        const location = locateInText(getText(), suggestion);
        if (!location.ok) return location;
        select(location);
        const li = document.createElement('li');
        li.textContent = buildCommentText(suggestion);
        comments.appendChild(li);
        return {
          ...location,
          commentFingerprint: {
            suggestionId: String(suggestion.id || ''),
            start: location.start,
            end: location.end,
            anchorText: getText().slice(location.start, location.end),
            text: buildCommentText(suggestion),
            textSummary: buildCommentText(suggestion).slice(0, 160)
          },
          message: '已生成模拟批注'
        };
      },
      async findComment() {
        return { ok: true, present: true };
      },
      async applyReplacement(suggestion) {
        if (!suggestion.replacement) return { ok: false, reason: 'missing_replacement' };
        const location = locateInText(getText(), suggestion);
        if (!location.ok) return location;
        const next = `${getText().slice(0, location.start)}${suggestion.replacement}${getText().slice(location.end)}`;
        doc.value = next;
        doc.focus();
        doc.setSelectionRange(location.start, location.start + suggestion.replacement.length);
        return { ...location, message: '已应用到模拟文档' };
      }
    };
  }

  window.WpsReviewAdapters = {
    createAdapter: hasWpsRuntime() ? createWpsAdapter : createMockAdapter,
    hasWpsRuntime,
    locateInText
  };
})();
