import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

async function loadWpsAdapterWithDoc(doc, { fetchImpl } = {}) {
  const source = await readFile('public/addin/wps-adapter.js', 'utf8');
  const app = {
    ActiveDocument: doc,
    Version: 'test-wps',
    Selection: { Range: { selection: true } }
  };
  const context = {
    window: {
      location: { origin: 'http://127.0.0.1:17531' },
      wps: {
        WpsApplication: () => app
      }
    },
    document: {
      getElementById() {
        throw new Error('mock DOM should not be used in WPS mode');
      }
    },
    URLSearchParams,
    fetch: fetchImpl || (async () => {
      throw new Error('unexpected bridge request');
    })
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'wps-adapter.js' });
  return context.window.WpsReviewAdapters.createAdapter();
}

test('WPS adapter ignores a stale runtime handle when the current document path matches', async () => {
  const selected = [];
  const doc = {
    Name: '报告.docx',
    FullName: '/docs/报告.docx',
    Content: { Text: '前文 目标原文 后文' },
    Range(start, end) {
      return {
        Start: start,
        End: end,
        Text: this.Content.Text.slice(start, end),
        Select() { selected.push({ start, end }); }
      };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({
    docSessionId: 'old-runtime-handle',
    anchorText: '目标原文',
    metadata: {
      documentHandle: 'old-runtime-handle',
      documentKey: 'path:/docs/报告.docx',
      documentFullName: '/docs/报告.docx',
      documentTitle: '报告.docx'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(selected.length, 1);
});

test('WPS adapter confirms current document identity without a bridge round trip', async () => {
  let bridgeCalls = 0;
  const doc = {
    Name: '报告.docx',
    FullName: '/docs/报告.docx',
    Content: { Text: '报告正文' }
  };
  const adapter = await loadWpsAdapterWithDoc(doc, {
    fetchImpl: async () => {
      bridgeCalls += 1;
      throw new Error('bridge should not be called');
    }
  });

  const result = await adapter.prepareTarget({
    docSessionId: 'old-runtime-handle',
    metadata: {
      documentKey: 'path:/docs/报告.docx',
      documentFullName: '/docs/报告.docx',
      documentTitle: '报告.docx'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.documentIdentityConfirmed, true);
  assert.equal(bridgeCalls, 0);
});

test('WPS adapter resolves the latest runtime handle from a durable document key', async () => {
  const sourceDoc = {
    Name: 'A.docx',
    FullName: '/docs/A.docx',
    Content: { Text: 'A 正文' }
  };
  const targetDoc = {
    Name: 'B.docx',
    FullName: '/docs/B.docx',
    Content: { Text: 'B 目标原文' },
    Range(start, end) {
      return {
        Start: start,
        End: end,
        Text: this.Content.Text.slice(start, end),
        Select() {}
      };
    }
  };
  const requests = [];
  let app;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/api/wps/documents')) {
      return {
        ok: true,
        json: async () => ({
          documents: [{
            documentHandle: 'new-runtime-handle',
            documentKey: 'path:/docs/b.docx',
            title: 'B.docx',
            fullName: '/docs/B.docx'
          }]
        })
      };
    }
    if (String(url).includes('/new-runtime-handle/activate')) {
      app.ActiveDocument = targetDoc;
      return {
        ok: true,
        json: async () => ({
          document: {
            documentHandle: 'new-runtime-handle',
            documentKey: 'path:/docs/b.docx',
            title: 'B.docx',
            fullName: '/docs/B.docx'
          }
        })
      };
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const source = await readFile('public/addin/wps-adapter.js', 'utf8');
  app = { ActiveDocument: sourceDoc, Version: 'test-wps', Selection: { Range: {} } };
  const context = {
    window: {
      location: { origin: 'http://127.0.0.1:17531' },
      wps: { WpsApplication: () => app }
    },
    document: { getElementById() { throw new Error('mock DOM should not be used'); } },
    URLSearchParams,
    fetch: fetchImpl
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'wps-adapter.js' });
  const adapter = context.window.WpsReviewAdapters.createAdapter();

  const result = await adapter.locateSuggestion({
    docSessionId: 'old-runtime-handle',
    anchorText: '目标原文',
    metadata: {
      documentHandle: 'old-runtime-handle',
      documentKey: 'path:/docs/b.docx',
      documentFullName: '/docs/B.docx',
      documentTitle: 'B.docx'
    }
  });

  assert.equal(result.ok, true);
  assert.ok(requests.some((item) => item.url.includes('/new-runtime-handle/activate')));
  assert.ok(requests.every((item) => !item.url.includes('/old-runtime-handle/activate')));
});

test('WPS bootstrap supports common task pane API spellings', async () => {
  const source = await readFile('public/WpsAgentReviewer/main.js', 'utf8');

  assert.match(source, /app\.CreateTaskPane/);
  assert.match(source, /app\.CreateTaskpane/);
  assert.match(source, /wps\.CreateTaskPane/);
  assert.match(source, /wps\.CreateTaskpane/);
  assert.match(source, /__WPS_REVIEWER_TASKPANE_URL__/);
});

test('WPS adapter supports documented and fallback comment API shapes', async () => {
  const source = await readFile('public/addin/wps-adapter.js', 'utf8');

  assert.match(source, /comments\.Add\(\{ Range: \{ Start:/);
  assert.match(source, /comments\.Add\(\{ Range: range, Text: text \}\)/);
  assert.match(source, /comments\.Add\(range, text\)/);
  assert.match(source, /doc\.TrackRevisions/);
  assert.match(source, /findComment\(suggestion, fingerprint/);
  assert.match(source, /commentFingerprint/);
});

test('WPS adapter can map normalized whitespace anchors back to original ranges', async () => {
  const source = await readFile('public/addin/wps-adapter.js', 'utf8');

  assert.match(source, /buildNormalizedIndex/);
  assert.match(source, /findNormalizedOccurrences/);
  assert.match(source, /normalized-whitespace/);
  assert.match(source, /MAX_RANGE_CORRECTION = 4/);
  assert.match(source, /WPS 定位范围与正文不一致/);
});

test('WPS adapter prefers a verified stored location when the document is unchanged', async () => {
  const selected = [];
  const doc = {
    Name: 'stored-location.docx',
    Content: { Text: '前文。目标原文。后文。另一个目标原文。' },
    Range(start, end) {
      return {
        Start: start,
        End: end,
        Text: this.Content.Text.slice(start, end),
        Select() { selected.push({ start, end }); }
      };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);
  const start = doc.Content.Text.indexOf('目标原文');
  const result = await adapter.locateSuggestion({
    anchorText: '目标原文',
    location: { start, end: start + '目标原文'.length, strategy: 'exact' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'stored-location');
  assert.deepEqual(selected, [{ start, end: start + '目标原文'.length }]);
});

test('WPS adapter corrects a bounded range offset before selecting or commenting', async () => {
  const ranges = [];
  const doc = {
    Name: 'real.docx',
    Content: { Text: 'prefix anchor suffix' },
    Range(start, end) {
      const range = {
        Start: start,
        End: end,
        Text: this.Content.Text.slice(start + 1, end + 1),
        Select() {}
      };
      ranges.push(range);
      return range;
    },
    Comments: {
      Count: 0,
      Add() {
        this.Count += 1;
        return {};
      }
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.addComment({ anchorText: 'anchor', comment: 'review note' });

  assert.equal(result.start, 6);
  assert.equal(result.end, 12);
  assert.ok(ranges.some((range) => range.Start === 6 && range.End === 12));
});

test('WPS adapter uses native Find when cumulative host offsets exceed bounded correction', async () => {
  const visibleText = 'prefix anchor suffix';
  const nativeText = `${'\u0007'.repeat(12)}${visibleText}`;
  const selected = [];
  let rangeCallCount = 0;

  function makeRange(initialStart, initialEnd) {
    let start = initialStart;
    let end = initialEnd;
    const range = {
      get Start() { return start; },
      get End() { return end; },
      get Text() { return nativeText.slice(start, end); },
      Select() { selected.push({ start, end }); }
    };
    range.Find = {
      ClearFormatting() {},
      Execute(needle) {
        const found = nativeText.indexOf(needle, start);
        if (found === -1 || found >= end) return false;
        start = found;
        end = found + needle.length;
        return true;
      }
    };
    return range;
  }

  const doc = {
    Name: 'cumulative-offset.docx',
    Content: { Text: visibleText, Start: 0, End: nativeText.length },
    Range(start, end) {
      rangeCallCount += 1;
      return makeRange(start, end);
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({ anchorText: 'anchor' });

  assert.equal(result.rangeStrategy, 'native-find');
  assert.equal(result.start, nativeText.indexOf('anchor'));
  assert.equal(result.end, nativeText.indexOf('anchor') + 'anchor'.length);
  // One direct probe, one native Find range, and one viewport-centering range.
  assert.equal(rangeCallCount, 3);
  assert.deepEqual(selected, [{
    start: nativeText.indexOf('anchor'),
    end: nativeText.indexOf('anchor') + 'anchor'.length
  }]);
});

test('WPS adapter scrolls surrounding context before selecting the exact anchor', async () => {
  const calls = [];
  const text = `${'前文'.repeat(120)}目标原文${'后文'.repeat(120)}`;
  const doc = {
    Name: 'centered.docx',
    Content: { Text: text, Start: 0, End: text.length },
    ActiveWindow: {
      ScrollIntoView(range) {
        calls.push({ type: 'scroll', start: range.Start, end: range.End });
      }
    },
    Range(start, end) {
      return {
        Start: start,
        End: end,
        Text: this.Content.Text.slice(start, end),
        Select() { calls.push({ type: 'select', start, end }); }
      };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({ anchorText: '目标原文' });
  const targetStart = text.indexOf('目标原文');

  assert.equal(result.centered, true);
  assert.equal(calls[0].type, 'scroll');
  assert.ok(calls[0].start < targetStart);
  assert.ok(calls[0].end > targetStart + '目标原文'.length);
  assert.deepEqual(calls[1], {
    type: 'select',
    start: targetStart,
    end: targetStart + '目标原文'.length
  });
});

test('WPS adapter accepts equivalent CRLF range text without widening the selected anchor', async () => {
  const ranges = [];
  const doc = {
    Name: 'line-ending.docx',
    Content: { Text: 'prefix\nanchor\nsuffix' },
    Range(start, end) {
      const range = {
        Start: start,
        End: end,
        Text: this.Content.Text.slice(start, end).replace(/\n/g, '\r\n'),
        Select() {}
      };
      ranges.push(range);
      return range;
    },
    Comments: {
      Count: 0,
      Add() {
        this.Count += 1;
        return {};
      }
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.addComment({ anchorText: 'anchor', comment: 'review note' });

  assert.equal(result.start, 7);
  assert.equal(result.end, 13);
  assert.ok(ranges.some((range) => range.Start === 7 && range.End === 13));
});

test('WPS adapter refuses repeated anchors when context cannot select one occurrence', async () => {
  const doc = {
    Name: 'repeated.docx',
    Content: { Text: '前文 重复片段 后文。另一处 重复片段 另一处后文。' },
    Range() {
      return { Select() {} };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({ anchorText: '重复片段' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ambiguous_anchor');
});

test('WPS adapter locates a repeated anchor only after context makes it unique', async () => {
  const selected = [];
  const doc = {
    Name: 'repeated.docx',
    Content: { Text: '前文 重复片段 后文。另一处 重复片段 另一处后文。' },
    Range(start, end) {
      return { Start: start, End: end, Select() { selected.push({ start, end }); } };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({
    anchorText: '重复片段',
    contextBefore: '前文',
    contextAfter: '后文'
  });

  assert.equal(result.ok, true);
  assert.equal(result.ambiguous, false);
  assert.equal(selected.length, 1);
});

test('WPS adapter refuses non-adjacent context instead of guessing a location', async () => {
  const doc = {
    Name: 'context-mismatch.docx',
    Content: { Text: '无关前文。中间句。target。' },
    Range() {
      return { Select() {} };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({ anchorText: 'target', contextBefore: '无关前文。' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'context_mismatch');
});

test('WPS adapter does not strip a trailing s when checking context boundaries', async () => {
  const doc = {
    Name: 'context-suffix.docx',
    Content: { Text: 'prefixs target' },
    Range() {
      return { Select() {} };
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  const result = await adapter.locateSuggestion({ anchorText: 'target', contextBefore: 'prefix' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'context_mismatch');
});

test('task pane records WPS acceptance events and accepts by adding comments', async () => {
  const source = await readFile('public/addin/app.js', 'utf8');

  assert.match(source, /postAcceptanceEvent/);
  assert.match(source, /taskpane\.opened/);
  assert.match(source, /suggestion\.commented/);
  assert.match(source, /adapter\.addComment\(suggestion\)/);
  assert.doesNotMatch(source, /suggestion\.applied/);
});

test('WPS adapter rejects comment API false positives when comment count does not change', async () => {
  const doc = {
    Name: 'real.docx',
    Content: { Text: 'hello anchor world' },
    Range(start, end) {
      return { Start: start, End: end, Select() {} };
    },
    Comments: {
      Count: 0,
      Add() {
        return {};
      }
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);

  await assert.rejects(
    () => adapter.addComment({ anchorText: 'anchor', comment: 'review note' }),
    /未确认批注已写入/
  );
});

test('WPS adapter reconciles an accepted comment after native undo', async () => {
  const comments = [];
  const doc = {
    Name: 'reconcile.docx',
    Content: { Text: 'hello anchor world' },
    Range(start, end) {
      return { Start: start, End: end, Text: this.Content.Text.slice(start, end), Select() {} };
    },
    Comments: {
      get Count() { return comments.length; },
      Item(index) { return comments[index]; }
    }
  };
  const adapter = await loadWpsAdapterWithDoc(doc);
  const suggestion = { anchorText: 'anchor', comment: 'review note' };

  comments.push({
    Text: 'review note',
    Range: { Start: 6, End: 12, Text: 'anchor' }
  });
  const present = await adapter.findComment(suggestion);
  assert.equal(present.ok, true);
  assert.equal(present.present, true);
  assert.equal(present.fingerprint.start, 6);
  assert.equal(present.fingerprint.end, 12);
  assert.equal(present.fingerprint.suggestionId, '');
  assert.equal(present.fingerprint.anchorText, 'anchor');
  assert.equal(present.fingerprint.text, 'review note');
  assert.equal(present.fingerprint.textSummary, 'review note');

  comments.length = 0;
  const removed = await adapter.findComment(suggestion, present.fingerprint);
  assert.equal(removed.ok, true);
  assert.equal(removed.present, false);
});
