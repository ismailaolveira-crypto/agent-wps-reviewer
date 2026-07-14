import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isVerified(item) {
  return item?.metadata?.reviewProfile === 'whitepaper-chief-editor-v1';
}

async function readStore(storePath) {
  const raw = await readFile(storePath);
  return { raw, store: JSON.parse(raw.toString('utf8')) };
}

async function writeAtomic(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tmpPath, filePath);
}

function partition(store) {
  const suggestions = Array.isArray(store.suggestions) ? store.suggestions : [];
  const quarantined = suggestions.filter((item) => !isVerified(item));
  const ids = new Set(quarantined.map((item) => item.id));
  const events = Array.isArray(store.acceptanceEvents) ? store.acceptanceEvents : [];
  return {
    quarantined,
    retained: suggestions.filter((item) => isVerified(item)),
    linkedEvents: events.filter((item) => item.suggestionId && ids.has(item.suggestionId)),
    retainedEvents: events.filter((item) => !item.suggestionId || !ids.has(item.suggestionId))
  };
}

export async function inspectUnverifiedSuggestions({ storePath }) {
  const { raw, store } = await readStore(storePath);
  const parts = partition(store);
  return {
    storePath,
    sourceSha256: sha256(raw),
    totalSuggestions: (store.suggestions ?? []).length,
    verifiedSuggestions: parts.retained.length,
    unverifiedSuggestions: parts.quarantined.length,
    linkedAcceptanceEvents: parts.linkedEvents.length
  };
}

export async function applyQuarantine({ storePath, backupDir = path.join(path.dirname(storePath), 'quarantine') }) {
  const { raw, store } = await readStore(storePath);
  const parts = partition(store);
  const sourceSha256 = sha256(raw);
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `unverified-suggestions-${stamp}.json`);
  const backup = {
    format: 'agent-wps-reviewer-quarantine-v1',
    createdAt: new Date().toISOString(),
    sourcePath: path.resolve(storePath),
    sourceSha256,
    suggestions: parts.quarantined,
    acceptanceEvents: parts.linkedEvents
  };

  await mkdir(backupDir, { recursive: true });
  await writeAtomic(backupPath, backup);
  await writeAtomic(storePath, {
    ...store,
    sessions: store.sessions ?? [],
    suggestions: parts.retained,
    acceptanceEvents: parts.retainedEvents
  });

  return {
    ok: true,
    storePath,
    backupPath,
    sourceSha256,
    quarantinedSuggestions: parts.quarantined.length,
    removedAcceptanceEvents: parts.linkedEvents.length,
    retainedSuggestions: parts.retained.length
  };
}

function mergeById(current = [], restored = []) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...restored.filter((item) => !ids.has(item.id))];
}

export async function restoreQuarantine({ storePath, backupPath }) {
  const { store } = await readStore(storePath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  if (backup.format !== 'agent-wps-reviewer-quarantine-v1') throw new Error('Unsupported quarantine backup');
  const restored = {
    ...store,
    suggestions: mergeById(store.suggestions, backup.suggestions),
    acceptanceEvents: mergeById(store.acceptanceEvents, backup.acceptanceEvents)
  };
  await writeAtomic(storePath, restored);
  return { ok: true, suggestions: restored.suggestions.length, acceptanceEvents: restored.acceptanceEvents.length };
}
