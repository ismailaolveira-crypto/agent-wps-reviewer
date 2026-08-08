import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createId, validateStatus, validateSuggestion } from './validation.mjs';

const ACCEPTANCE_EVENT_TYPES = new Set([
  'taskpane.opened',
  'suggestion.located',
  'suggestion.commented',
  'suggestion.applied',
  'suggestion.action.started',
  'suggestion.target.confirmed',
  'suggestion.location.resolved',
  'suggestion.location.failed',
  'suggestion.comment.started',
  'suggestion.comment.verified',
  'suggestion.comment.failed',
  'suggestion.action.completed',
  'suggestion.action.failed',
  'suggestion.auto_advance.started',
  'suggestion.auto_advance.failed'
]);

function textField(value, fallback = '') {
  return String(value ?? fallback).trim();
}

const CONNECTION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TRANSIENT_WPS_SESSIONS = 200;

function normalizeConnectionCode(value) {
  return String(value || '').trim().toUpperCase();
}

function createConnectionCode() {
  const bytes = randomBytes(8);
  const raw = Array.from(bytes, (byte) => CONNECTION_CODE_ALPHABET[byte % CONNECTION_CODE_ALPHABET.length]).join('');
  return `WPS-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function normalizeAcceptanceEvent(input = {}) {
  const eventType = textField(input.eventType);
  const adapterMode = textField(input.adapterMode);
  const errors = [];

  if (!ACCEPTANCE_EVENT_TYPES.has(eventType)) {
    errors.push('eventType is not supported');
  }
  if (!['wps', 'mock'].includes(adapterMode)) {
    errors.push('adapterMode must be wps or mock');
  }

  if (errors.length) {
    const error = new Error('Invalid acceptance event');
    error.details = errors;
    throw error;
  }

  return {
    id: createId('evt'),
    eventType,
    adapterMode,
    docSessionId: textField(input.docSessionId, 'default') || 'default',
    docTitle: textField(input.docTitle, 'WPS Document'),
    docFingerprint: textField(input.docFingerprint),
    wpsVersion: textField(input.wpsVersion),
    platform: textField(input.platform),
    osVersion: textField(input.osVersion),
    osArch: textField(input.osArch),
    wpsArch: textField(input.wpsArch),
    runtimeInstanceId: textField(input.runtimeInstanceId),
    productVersion: textField(input.productVersion),
    buildFingerprint: textField(input.buildFingerprint),
    suggestionId: textField(input.suggestionId),
    operationId: textField(input.operationId),
    step: textField(input.step),
    reason: textField(input.reason),
    errorCode: textField(input.errorCode),
    documentKeyHash: textField(input.documentKeyHash),
    actualRevisionToken: textField(input.actualRevisionToken),
    structureType: textField(input.structureType),
    anchorLength: Number.isFinite(Number(input.anchorLength)) ? Number(input.anchorLength) : undefined,
    candidateCount: Number.isFinite(Number(input.candidateCount)) ? Number(input.candidateCount) : undefined,
    rangeCorrection: Number.isFinite(Number(input.rangeCorrection)) ? Number(input.rangeCorrection) : undefined,
    resultMessage: textField(input.resultMessage),
    location:
      input.location && typeof input.location === 'object'
        ? {
            start: Number.isFinite(Number(input.location.start)) ? Number(input.location.start) : undefined,
            end: Number.isFinite(Number(input.location.end)) ? Number(input.location.end) : undefined
          }
        : null,
    createdAt: new Date().toISOString()
  };
}

export class ReviewStore extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'review-store.json');
    this.sessions = new Map();
    this.suggestions = new Map();
    this.documentBindings = new Map();
    this.acceptanceEvents = [];
    this.sessionCompaction = { removed: 0, kept: 0 };
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      this.sessions = new Map((parsed.sessions ?? []).map((item) => [item.docSessionId, item]));
      this.suggestions = new Map((parsed.suggestions ?? []).map((item) => [item.id, item]));
      this.documentBindings = new Map((parsed.documentBindings ?? []).map((item) => [item.documentKey, item]));
      this.acceptanceEvents = Array.isArray(parsed.acceptanceEvents) ? parsed.acceptanceEvents : [];
      this.compactSessions();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  compactSessions({ maxTransientSessions = MAX_TRANSIENT_WPS_SESSIONS } = {}) {
    const protectedIds = new Set();
    for (const suggestion of this.suggestions.values()) {
      const metadata = suggestion.metadata || {};
      for (const value of [
        suggestion.docSessionId,
        metadata.documentHandle,
        ...(Array.isArray(metadata.previousDocumentHandles) ? metadata.previousDocumentHandles : [])
      ]) {
        const id = textField(value);
        if (id) protectedIds.add(id);
      }
    }

    const sessions = [...this.sessions.values()].sort((left, right) =>
      textField(right.updatedAt).localeCompare(textField(left.updatedAt))
    );
    const kept = [];
    const transientTitles = new Set();
    let transientCount = 0;

    for (const session of sessions) {
      const id = textField(session.docSessionId);
      const client = textField(session.client);
      const logicalSession = id.startsWith('path:') || id.startsWith('session:');
      if (protectedIds.has(id) || client !== 'wps-connector' || logicalSession) {
        kept.push(session);
        continue;
      }

      const titleKey = textField(session.docTitle, 'WPS Document').toLowerCase();
      if (transientCount >= maxTransientSessions || transientTitles.has(titleKey)) continue;
      transientTitles.add(titleKey);
      transientCount += 1;
      kept.push(session);
    }

    const removed = Math.max(0, this.sessions.size - kept.length);
    this.sessions = new Map(kept.map((item) => [item.docSessionId, item]));
    this.sessionCompaction = { removed, kept: kept.length };
    return this.sessionCompaction;
  }

  async save() {
    await mkdir(this.dataDir, { recursive: true });
    const payload = JSON.stringify(
      {
        sessions: [...this.sessions.values()],
        suggestions: [...this.suggestions.values()],
        documentBindings: [...this.documentBindings.values()],
        acceptanceEvents: this.acceptanceEvents
      },
      null,
      2
    );
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, payload);
    await rename(tmpPath, this.filePath);
  }

  async registerSession(input = {}) {
    const now = new Date().toISOString();
    const docSessionId = String(input.docSessionId ?? '').trim() || createId('doc');
    const existing = this.sessions.get(docSessionId);
    const session = {
      docSessionId,
      docTitle: String(input.docTitle ?? existing?.docTitle ?? 'WPS Document').trim(),
      docFingerprint: String(input.docFingerprint ?? existing?.docFingerprint ?? '').trim(),
      client: String(input.client ?? existing?.client ?? 'wps-taskpane').trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.sessions.set(docSessionId, session);
    this.compactSessions();
    await this.save();
    this.emit('session', session);
    return session;
  }

  listSessions() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async ensureDocumentBinding({ documentKey, title, fullName, identityKind = 'session' } = {}) {
    const key = textField(documentKey);
    if (!key) throw new Error('documentKey is required');

    const existing = this.documentBindings.get(key);
    if (existing) {
      const updated = {
        ...existing,
        title: textField(title, existing.title || 'WPS Document'),
        fullName: textField(fullName, existing.fullName || ''),
        identityKind: textField(identityKind, existing.identityKind || 'session'),
        lastSeenAt: new Date().toISOString()
      };
      const metadataChanged = updated.title !== existing.title
        || updated.fullName !== existing.fullName
        || updated.identityKind !== existing.identityKind;
      this.documentBindings.set(key, updated);
      if (metadataChanged) {
        await this.save();
      }
      return updated;
    }

    let code = '';
    do {
      code = createConnectionCode();
    } while ([...this.documentBindings.values()].some((item) => item.connectionCode === code));

    const binding = {
      connectionCode: code,
      documentKey: key,
      title: textField(title, 'WPS Document'),
      fullName: textField(fullName),
      identityKind: textField(identityKind, 'session'),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    this.documentBindings.set(key, binding);
    await this.save();
    return binding;
  }

  getDocumentBindingByCode(connectionCode) {
    const code = normalizeConnectionCode(connectionCode);
    return [...this.documentBindings.values()].find((item) => item.connectionCode === code) || null;
  }

  getDocumentKeyByRuntimeHandle(documentHandle) {
    const handle = textField(documentHandle);
    if (!handle) return '';
    const keys = new Set();
    for (const suggestion of this.suggestions.values()) {
      const metadata = suggestion.metadata || {};
      const knownHandles = [
        suggestion.docSessionId,
        metadata.documentHandle,
        ...(Array.isArray(metadata.previousDocumentHandles) ? metadata.previousDocumentHandles : [])
      ].map((value) => textField(value)).filter(Boolean);
      if (!knownHandles.includes(handle)) continue;
      const key = textField(metadata.documentKey);
      if (key) keys.add(key);
    }
    return keys.size === 1 ? [...keys][0] : '';
  }

  async addSuggestion(input) {
    const result = validateSuggestion(input);
    if (!result.ok) {
      const error = new Error('Invalid suggestion');
      error.details = result.errors;
      throw error;
    }

    if (!this.sessions.has(result.suggestion.docSessionId)) {
      await this.registerSession({ docSessionId: result.suggestion.docSessionId });
    }

    const now = new Date().toISOString();
    const suggestion = {
      id: createId('sug'),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...result.suggestion
    };

    this.suggestions.set(suggestion.id, suggestion);
    await this.save();
    this.emit('suggestion', { type: 'suggestion.created', suggestion });
    return suggestion;
  }

  async addSuggestions(inputs = []) {
    return this.addValidatedSuggestions(inputs);
  }

  async addValidatedSuggestions(inputs = []) {
    const results = inputs.map((input, index) => ({ index, ...validateSuggestion(input) }));
    const invalid = results.filter((result) => !result.ok);
    if (invalid.length > 0) {
      const error = new Error('Invalid suggestion');
      error.details = invalid.flatMap((result) =>
        result.errors.map((message) => `suggestions[${result.index}]: ${message}`)
      );
      throw error;
    }

    const previousSessions = new Map(this.sessions);
    const previousSuggestions = new Map(this.suggestions);
    const now = new Date().toISOString();
    const created = [];

    for (const result of results) {
      const normalized = result.suggestion;
      if (!this.sessions.has(normalized.docSessionId)) {
        this.sessions.set(normalized.docSessionId, {
          docSessionId: normalized.docSessionId,
          docTitle: 'WPS Document',
          docFingerprint: '',
          client: 'wps-taskpane',
          createdAt: now,
          updatedAt: now
        });
      }
      const suggestion = {
        id: createId('sug'),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        ...normalized
      };
      this.suggestions.set(suggestion.id, suggestion);
      created.push(suggestion);
    }

    try {
      await this.save();
    } catch (error) {
      this.sessions = previousSessions;
      this.suggestions = previousSuggestions;
      throw error;
    }

    for (const suggestion of created) {
      this.emit('suggestion', { type: 'suggestion.created', suggestion });
    }
    return created;
  }

  listSuggestions({ docSessionId, documentKey, status } = {}) {
    return [...this.suggestions.values()]
      .filter((item) => !docSessionId || item.docSessionId === docSessionId)
      .filter((item) => !documentKey || item.metadata?.documentKey === documentKey)
      .filter((item) => !status || item.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async bindLegacySuggestions({ documentHandle, documentKey, documentTitle } = {}) {
    const title = textField(documentTitle);
    const key = textField(documentKey);
    const handle = textField(documentHandle);
    if (!title || !key || !handle) return 0;

    const legacySessionIds = new Set(
      [...this.sessions.values()]
        .filter((session) => textField(session.docTitle) === title)
        .map((session) => textField(session.docSessionId))
        .filter(Boolean)
    );
    const binding = this.documentBindings.get(key);
    const updates = [];
    for (const suggestion of this.suggestions.values()) {
      const suggestionKey = textField(suggestion.metadata?.documentKey);
      if (suggestionKey && suggestionKey !== key) continue;
      if (!suggestionKey && !legacySessionIds.has(suggestion.docSessionId)) continue;
      const metadata = suggestion.metadata || {};
      if (
        suggestionKey === key
        && suggestion.docSessionId === handle
        && metadata.documentHandle === handle
        && metadata.documentTitle === title
        && metadata.connectionCode === (binding?.connectionCode || '')
      ) continue;
      updates.push({
        ...suggestion,
        docSessionId: handle,
        metadata: {
          ...metadata,
          previousDocumentHandles: [...new Set([
            ...(Array.isArray(metadata.previousDocumentHandles) ? metadata.previousDocumentHandles : []),
            suggestion.docSessionId,
            metadata.documentHandle
          ].map((value) => textField(value)).filter((value) => value && value !== handle))],
          documentHandle: handle,
          documentKey: key,
          documentTitle: title,
          connectionCode: binding?.connectionCode || '',
          identityKind: 'path'
        },
        updatedAt: new Date().toISOString()
      });
    }
    if (!updates.length) return 0;
    for (const suggestion of updates) this.suggestions.set(suggestion.id, suggestion);
    await this.save();
    return updates.length;
  }

  getSuggestion(id) {
    return this.suggestions.get(id);
  }

  async updateSuggestion(id, patch = {}) {
    const existing = this.suggestions.get(id);
    if (!existing) return null;

    if (patch.status && !validateStatus(patch.status)) {
      const error = new Error('Invalid status');
      error.details = [`status must be one of pending, commented, applied, rejected, conflict, stale`];
      throw error;
    }

    const updated = {
      ...existing,
      status: patch.status ?? existing.status,
      resultMessage: patch.resultMessage == null ? existing.resultMessage : String(patch.resultMessage),
      updatedAt: new Date().toISOString()
    };

    this.suggestions.set(id, updated);
    await this.save();
    this.emit('suggestion', { type: 'suggestion.updated', suggestion: updated });
    return updated;
  }

  async addAcceptanceEvent(input) {
    const event = normalizeAcceptanceEvent(input);
    this.acceptanceEvents.push(event);
    await this.save();
    this.emit('acceptance-event', event);
    return event;
  }

  listAcceptanceEvents({ docSessionId, adapterMode, eventType } = {}) {
    return this.acceptanceEvents
      .filter((item) => !docSessionId || item.docSessionId === docSessionId)
      .filter((item) => !adapterMode || item.adapterMode === adapterMode)
      .filter((item) => !eventType || item.eventType === eventType)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
