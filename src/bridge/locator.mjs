export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function findAllOccurrences(text, needle) {
  const haystack = String(text ?? '');
  const target = String(needle ?? '');
  if (!target) return [];

  const result = [];
  let index = haystack.indexOf(target);
  while (index !== -1) {
    result.push(index);
    index = haystack.indexOf(target, index + Math.max(target.length, 1));
  }
  return result;
}

function isWhitespace(char) {
  return /\s/.test(char || '');
}

function buildNormalizedIndex(value) {
  const source = String(value ?? '');
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

  if (normalizedBefore && normalizedPrefix.includes(normalizedBefore)) score += 1;
  if (normalizedAfter && normalizedSuffix.includes(normalizedAfter)) score += 1;
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

export function locateSuggestion(documentText, suggestion) {
  const text = String(documentText ?? '');
  const anchorText = String(suggestion?.anchor?.text ?? suggestion?.anchorText ?? '').trim();
  if (!anchorText) {
    return { ok: false, reason: 'missing_anchor_text' };
  }

  const before = String(
    suggestion?.anchor?.before ?? suggestion?.contextBefore ?? suggestion?.beforeText ?? ''
  ).trim();
  const after = String(
    suggestion?.anchor?.after ?? suggestion?.contextAfter ?? suggestion?.afterText ?? ''
  ).trim();

  const exact = findAllOccurrences(text, anchorText);
  if (exact.length > 0) {
    return rankCandidates(
      exact.map((start) => ({ start, end: start + anchorText.length })),
      text,
      before,
      after,
      'exact'
    );
  }

  const normalized = findNormalizedOccurrences(text, anchorText);
  if (!normalized.length) {
    return { ok: false, reason: 'anchor_not_found' };
  }

  return rankCandidates(normalized, text, before, after, 'normalized-whitespace');
}
