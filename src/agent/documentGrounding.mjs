import { locateSuggestion, normalizeWhitespace } from '../bridge/locator.mjs';

const CONTEXT_WINDOW = 500;

function includesNormalized(source, excerpt) {
  const target = normalizeWhitespace(excerpt);
  return Boolean(target) && normalizeWhitespace(source).includes(target);
}

function suggestionEvidence(suggestion) {
  const verification = suggestion?.quality?.verification || {};
  return [
    suggestion.anchorText,
    suggestion.contextBefore,
    suggestion.contextAfter,
    verification.documentEvidenceExcerpt,
    ...(Array.isArray(verification.relatedExcerpts) ? verification.relatedExcerpts : [])
  ]
    .filter(Boolean)
    .join('\n');
}

export function validateGroundedReviewBatch(documentText, batch = {}) {
  const text = String(documentText ?? '');
  const errors = [];
  const locations = [];

  for (const [index, suggestion] of (batch.suggestions || []).entries()) {
    const prefix = `suggestions[${index}]`;
    if (!suggestion.contextBefore && !suggestion.contextAfter) {
      errors.push(`${prefix}: 正式批注必须至少提供一侧上下文`);
    }

    const located = locateSuggestion(text, suggestion);
    if (!located.ok) {
      errors.push(located.reason === 'context_mismatch'
        ? `${prefix}: contextBefore/contextAfter 与定位原文不相邻`
        : `${prefix}: 未找到对应原文`);
      continue;
    }
    if (located.ambiguous) {
      errors.push(`${prefix}: 上下文无法唯一定位原文`);
      continue;
    }

    const beforeWindow = text.slice(Math.max(0, located.start - CONTEXT_WINDOW), located.start);
    const afterWindow = text.slice(located.end, located.end + CONTEXT_WINDOW);
    if (suggestion.contextBefore && !includesNormalized(beforeWindow, suggestion.contextBefore)) {
      errors.push(`${prefix}.contextBefore 与定位原文的相邻前文不一致`);
    }
    if (suggestion.contextAfter && !includesNormalized(afterWindow, suggestion.contextAfter)) {
      errors.push(`${prefix}.contextAfter 与定位原文的相邻后文不一致`);
    }

    const verification = suggestion?.quality?.verification || {};
    if (!includesNormalized(text, verification.documentEvidenceExcerpt)) {
      errors.push(`${prefix}: 正文证据 documentEvidenceExcerpt 不在当前文档中`);
    }
    for (const [relatedIndex, excerpt] of (verification.relatedExcerpts || []).entries()) {
      if (!includesNormalized(text, excerpt)) {
        errors.push(`${prefix}.quality.verification.relatedExcerpts[${relatedIndex}] 不在当前文档中`);
      }
    }

    const groundedEvidence = suggestionEvidence(suggestion);
    for (const keyTerm of suggestion?.quality?.keyTerms || []) {
      if (!includesNormalized(groundedEvidence, keyTerm)) {
        errors.push(`${prefix}.quality.keyTerms 中的 ${keyTerm} 没有对应正文证据`);
      }
    }

    locations.push({
      candidateId: suggestion.candidateId,
      strategy: located.strategy,
      start: located.start,
      end: located.end,
      score: located.score
    });
  }

  return { ok: errors.length === 0, errors, locations };
}
