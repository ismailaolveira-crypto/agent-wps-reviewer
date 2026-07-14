const MAX_FIELD_LENGTH = 20000;
const VALID_STATUSES = new Set(['pending', 'commented', 'applied', 'rejected', 'conflict', 'stale']);
const VALID_SEVERITIES = new Set(['info', 'minor', 'major', 'critical']);

export function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function normalizeSuggestion(input = {}) {
  const anchor = {
    text: String(input.anchor?.text ?? input.anchorText ?? '').trim(),
    before: String(input.anchor?.before ?? input.contextBefore ?? input.beforeText ?? '').trim(),
    after: String(input.anchor?.after ?? input.contextAfter ?? input.afterText ?? '').trim()
  };

  const severity = String(input.severity ?? 'minor').trim();

  return {
    docSessionId: String(input.docSessionId ?? 'default').trim() || 'default',
    sourceAgent: String(input.sourceAgent ?? input.agent ?? 'agent').trim() || 'agent',
    threadId: input.threadId ? String(input.threadId).trim() : '',
    anchor,
    comment: String(input.comment ?? input.message ?? '').trim(),
    replacement: input.replacement == null ? '' : String(input.replacement).trim(),
    reason: input.reason == null ? '' : String(input.reason).trim(),
    severity: VALID_SEVERITIES.has(severity) ? severity : 'minor',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  };
}

function validateStringLength(errors, name, value) {
  if (String(value ?? '').length > MAX_FIELD_LENGTH) {
    errors.push(`${name} is too long`);
  }
}

export function validateSuggestion(input) {
  const suggestion = normalizeSuggestion(input);
  const errors = [];

  if (!suggestion.docSessionId) errors.push('docSessionId is required');
  if (!suggestion.anchor.text) errors.push('anchor.text or anchorText is required');
  if (!suggestion.comment) errors.push('comment is required');

  validateStringLength(errors, 'anchor.text', suggestion.anchor.text);
  validateStringLength(errors, 'anchor.before', suggestion.anchor.before);
  validateStringLength(errors, 'anchor.after', suggestion.anchor.after);
  validateStringLength(errors, 'comment', suggestion.comment);
  validateStringLength(errors, 'replacement', suggestion.replacement);
  validateStringLength(errors, 'reason', suggestion.reason);

  return { ok: errors.length === 0, errors, suggestion };
}

export function validateStatus(status) {
  return VALID_STATUSES.has(status);
}

export function publicError(message, details = undefined) {
  return { error: { message, details } };
}
