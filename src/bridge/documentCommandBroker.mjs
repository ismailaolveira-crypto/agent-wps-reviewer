import { createId } from './validation.mjs';

export class DocumentCommandBroker {
  constructor() {
    this.listeners = new Map();
    this.pending = new Map();
  }

  get pendingCount() {
    return this.pending.size;
  }

  subscribe(clientId, listener) {
    const key = String(clientId);
    this.listeners.set(key, listener);
    return () => {
      if (this.listeners.get(key) === listener) {
        this.listeners.delete(key);
      }
    };
  }

  request({ clientId, type, payload = {}, timeoutMs = 5000 }) {
    const id = createId('cmd');
    const targetClientId = String(clientId);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('WPS document read timed out'));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const listener = this.listeners.get(targetClientId);
      if (listener) {
        queueMicrotask(() => listener({ id, type, payload }));
      }
    });
  }

  resolve(id, result) {
    const item = this.pending.get(String(id));
    if (!item) return false;

    clearTimeout(item.timer);
    this.pending.delete(String(id));
    item.resolve(result);
    return true;
  }

  reject(id, error) {
    const item = this.pending.get(String(id));
    if (!item) return false;

    clearTimeout(item.timer);
    this.pending.delete(String(id));
    item.reject(error instanceof Error ? error : new Error(String(error || 'WPS command failed')));
    return true;
  }
}
