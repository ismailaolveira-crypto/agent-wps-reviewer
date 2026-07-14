function textField(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export class DocumentRegistry {
  constructor() {
    this.documents = new Map();
  }

  upsert(input = {}) {
    const existing = this.documents.get(textField(input.documentHandle));
    const now = Date.now();
    const lastSeenAt = Number.isFinite(Number(input.lastSeenAt))
      ? Number(input.lastSeenAt)
      : Number.isFinite(Number(input.lastActiveAt))
        ? Number(input.lastActiveAt)
        : existing?.lastSeenAt || now;
    const isActive = input.isActive === undefined
      ? true
      : input.isActive === true || input.isActive === 'true';
    const lastActiveAt = Number.isFinite(Number(input.lastActiveAt))
      ? Number(input.lastActiveAt)
      : isActive
        ? lastSeenAt
        : existing?.lastActiveAt || 0;
    const documentKey = textField(input.documentKey, textField(input.fullName || input.path) || textField(input.documentHandle));
    const document = {
      clientId: textField(input.clientId),
      documentHandle: textField(input.documentHandle),
      documentKey,
      connectionCode: textField(input.connectionCode),
      identityKind: textField(input.identityKind, input.fullName || input.path ? 'path' : 'session') || 'session',
      title: textField(input.title, 'WPS Document') || 'WPS Document',
      fullName: textField(input.fullName || input.path),
      textLength: Number.isFinite(Number(input.textLength)) ? Number(input.textLength) : 0,
      selectionText: textField(input.selectionText).slice(0, 2000),
      revisionToken: textField(input.revisionToken),
      isActive,
      lastSeenAt,
      lastActiveAt
    };

    for (const [handle, item] of this.documents) {
      if (
        handle !== document.documentHandle &&
        item.clientId === document.clientId &&
        document.documentKey &&
        item.documentKey === document.documentKey
      ) {
        this.documents.delete(handle);
      }
    }

    if (document.isActive) {
      for (const item of this.documents.values()) {
        if (item.clientId === document.clientId && item.documentHandle !== document.documentHandle) {
          item.isActive = false;
        }
      }
    }
    this.documents.set(document.documentHandle, document);
    return document;
  }

  getActive({ now = Date.now(), maxAgeMs = 10000 } = {}) {
    return (
      [...this.documents.values()]
        .filter((item) => item.isActive && now - item.lastSeenAt <= maxAgeMs)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] || null
    );
  }

  getAvailable({ now = Date.now(), maxAgeMs = 10000 } = {}) {
    return [...this.documents.values()]
      .filter((item) => now - item.lastSeenAt <= maxAgeMs)
      .sort((a, b) => {
        if (Boolean(b.isActive) !== Boolean(a.isActive)) return Number(b.isActive) - Number(a.isActive);
        return (b.lastActiveAt || b.lastSeenAt) - (a.lastActiveAt || a.lastSeenAt);
      });
  }

  markActive(handle, { now = Date.now() } = {}) {
    const document = this.getByHandle(handle);
    if (!document) return null;
    for (const item of this.documents.values()) {
      if (item.clientId === document.clientId) item.isActive = item.documentHandle === document.documentHandle;
    }
    document.isActive = true;
    document.lastActiveAt = now;
    document.lastSeenAt = Math.max(document.lastSeenAt || 0, now);
    return document;
  }

  getByHandle(handle) {
    return this.documents.get(String(handle)) || null;
  }

  removeClient(clientId) {
    const targetClientId = String(clientId);
    for (const [handle, document] of this.documents) {
      if (document.clientId === targetClientId) {
        this.documents.delete(handle);
      }
    }
  }
}
