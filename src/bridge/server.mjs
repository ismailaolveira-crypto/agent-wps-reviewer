import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGroundedReviewBatch } from '../agent/documentGrounding.mjs';
import { validateWhitepaperReviewBatch } from '../agent/whitepaperReview.mjs';
import { isAgentAuthorized } from './auth.mjs';
import { DocumentCommandBroker } from './documentCommandBroker.mjs';
import { DocumentRegistry } from './documentRegistry.mjs';
import { ReviewStore } from './store.mjs';
import { publicError } from './validation.mjs';
import { readAgentTokenSync } from '../install/agentToken.mjs';
import { CURRENT_RUNTIME_IDENTITY } from '../acceptance/runtimeIdentity.mjs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

const TRUSTED_ORIGINS = new Set(['http://127.0.0.1:17531', 'http://localhost:17531']);
const MAX_DOCUMENT_CHUNK = 32000;
const WPS_HEARTBEAT_MAX_AGE_MS = 10000;
const DOCUMENT_READ_TIMEOUT_MS = 5000;
const TASKPANE_URL_PLACEHOLDER = '__WPS_REVIEWER_TASKPANE_URL__';
const BRIDGE_ORIGIN_PLACEHOLDER = '__WPS_REVIEWER_BRIDGE_ORIGIN__';

function localOriginFromRequest(req) {
  const host = String(req?.headers?.host || '127.0.0.1:17531');
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) {
    return 'http://127.0.0.1:17531';
  }
  return `http://${host}`;
}

function corsHeaders(req) {
  const origin = req?.headers?.origin;
  if (!TRUSTED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin'
  };
}

function sendJson(req, res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-wps-reviewer-token',
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function staticHeaders(agentToken) {
  return agentToken
    ? { 'set-cookie': 'wps-reviewer-token=' + encodeURIComponent(agentToken) + '; Path=/; HttpOnly; SameSite=Strict' }
    : {};
}

async function serveStatic(req, res, pathname, agentToken = '') {
  const relative = pathname === '/' ? 'addin/taskpane.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(PUBLIC_ROOT, relative);
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    sendJson(req, res, 403, publicError('Forbidden'));
    return true;
  }

  try {
    await access(filePath);
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      if (!filePath.startsWith(PUBLIC_ROOT)) {
        sendJson(req, res, 403, publicError('Forbidden'));
        return true;
      }
      await access(filePath);
      info = await stat(filePath);
    }
    if (!info.isFile()) return false;

    const ext = path.extname(filePath);
    if (pathname === '/WpsAgentReviewer/main.js' || pathname === '/WpsAgentReviewer/document-connector.js') {
      const source = await readFile(filePath, 'utf8');
      const bridgeOrigin = localOriginFromRequest(req);
      const taskpaneUrl = `${bridgeOrigin}/addin/taskpane.html`;
      res.writeHead(200, {
        'content-type': MIME_TYPES.get(ext) ?? 'application/octet-stream',
        'cache-control': 'no-store',
        ...staticHeaders(agentToken)
      });
      res.end(source
        .replaceAll(TASKPANE_URL_PLACEHOLDER, taskpaneUrl)
        .replaceAll(BRIDGE_ORIGIN_PLACEHOLDER, bridgeOrigin));
      return true;
    }
    res.writeHead(200, {
      'content-type': MIME_TYPES.get(ext) ?? 'application/octet-stream',
      'cache-control': 'no-store',
      ...staticHeaders(agentToken)
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function normalizeDocumentMetadata(input = {}, { now = () => Date.now(), defaultIsActive = false } = {}) {
  const documentHandle = String(input.documentHandle ?? '').trim();
  const clientId = String(input.clientId ?? '').trim();
  const errors = [];

  if (!clientId) errors.push('clientId is required');
  if (!documentHandle) errors.push('documentHandle is required');

  if (errors.length) {
    const error = new Error('Invalid WPS document metadata');
    error.details = errors;
    throw error;
  }

  const lastSeenAt = Number.isFinite(Number(input.lastSeenAt))
    ? Number(input.lastSeenAt)
    : Number.isFinite(Number(input.lastActiveAt))
      ? Number(input.lastActiveAt)
      : now();
  const isActive = input.isActive === undefined
    ? defaultIsActive
    : input.isActive === true || input.isActive === 'true';

  const rawFullName = String(input.fullName ?? input.path ?? '').trim();
  const explicitKey = String(input.documentKey ?? '').trim();
  const documentKey = explicitKey
    ? explicitKey.replace(/^path:/i, 'path:').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
    : rawFullName
      ? `path:${rawFullName.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()}`
      : documentHandle;

  return {
    clientId,
    documentHandle,
    documentKey,
    identityKind: String(input.identityKind ?? (rawFullName || explicitKey.startsWith('path:') ? 'path' : 'session')).trim() || 'session',
    title: String(input.title ?? input.docTitle ?? 'WPS Document').trim() || 'WPS Document',
    fullName: String(input.fullName ?? input.path ?? '').trim(),
    textLength: Number.isFinite(Number(input.textLength)) ? Number(input.textLength) : 0,
    selectionText: String(input.selectionText ?? '').slice(0, 2000),
    revisionToken: String(input.revisionToken ?? '').trim(),
    isActive,
    lastSeenAt,
    lastActiveAt: Number.isFinite(Number(input.lastActiveAt))
      ? Number(input.lastActiveAt)
      : isActive
        ? lastSeenAt
        : 0
  };
}

function sanitizeDocument(document) {
  const lastSeenAt = document.lastSeenAt || document.lastActiveAt || Date.now();
  const lastActiveAt = document.lastActiveAt || lastSeenAt;
  return {
    documentHandle: document.documentHandle,
    documentKey: document.documentKey || document.documentHandle,
    connectionCode: document.connectionCode || '',
    identityKind: document.identityKind || 'session',
    title: document.title,
    fullName: document.fullName || '',
    textLength: document.textLength,
    selectionText: document.selectionText || '',
    revisionToken: document.revisionToken,
    isActive: Boolean(document.isActive),
    lastSeenAt: new Date(lastSeenAt).toISOString(),
    lastActiveAt: new Date(lastActiveAt).toISOString()
  };
}

function parseDocumentReadParams(url) {
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') || String(MAX_DOCUMENT_CHUNK), 10);
  const limit = Math.min(MAX_DOCUMENT_CHUNK, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : MAX_DOCUMENT_CHUNK));
  return { offset, limit };
}

function ensureAgentRouteAuthorized(req, res, agentToken) {
  if (isAgentAuthorized(req, agentToken)) return true;
  sendJson(req, res, 401, publicError('Unauthorized', ['Missing or invalid agent token']));
  return false;
}

function getFreshDocument(registry, documentHandle, now) {
  const document = registry.getByHandle(documentHandle);
  if (!document) return null;
  const lastSeenAt = document.lastSeenAt || document.lastActiveAt || 0;
  if (now() - lastSeenAt > WPS_HEARTBEAT_MAX_AGE_MS) return null;
  return document;
}

function getFreshDocumentByHandleOrBinding({ store, documentRegistry, documentHandle, now }) {
  const direct = getFreshDocument(documentRegistry, documentHandle, now);
  if (direct) return direct;
  const documentKey = store.getDocumentKeyByRuntimeHandle(documentHandle);
  if (!documentKey) return null;
  return documentRegistry
    .getAvailable({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS })
    .find((item) => item.documentKey === documentKey) || null;
}

function getFreshDocumentByConnectionCode({ store, documentRegistry, connectionCode, now }) {
  const binding = store.getDocumentBindingByCode(connectionCode);
  if (!binding) return null;
  return documentRegistry
    .getAvailable({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS })
    .find((item) => item.documentKey === binding.documentKey) || null;
}

async function registerDocumentSession({ store, documentRegistry, body, now, defaultIsActive = false }) {
  const normalized = normalizeDocumentMetadata(body, { now, defaultIsActive });
  const binding = await store.ensureDocumentBinding({
    documentKey: normalized.documentKey,
    title: normalized.title,
    fullName: normalized.fullName,
    identityKind: normalized.identityKind
  });
  const document = documentRegistry.upsert({ ...normalized, connectionCode: binding.connectionCode });
  await store.registerSession({
    docSessionId: document.documentHandle,
    docTitle: document.title,
    docFingerprint: document.revisionToken,
    client: 'wps-connector'
  });
  const sameTitle = documentRegistry
    .getAvailable({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS })
    .filter((item) => item.title === document.title);
  if (sameTitle.length === 1 && document.identityKind === 'path') {
    await store.bindLegacySuggestions({
      documentHandle: document.documentHandle,
      documentKey: document.documentKey,
      documentTitle: document.title
    });
  }
  return document;
}

async function activateDocument({ commandBroker, documentRegistry, document, now }) {
  const result = await commandBroker.request({
    clientId: document.clientId,
    type: 'document.activate',
    payload: { documentHandle: document.documentHandle },
    timeoutMs: DOCUMENT_READ_TIMEOUT_MS
  });
  const returnedHandle = String(result?.documentHandle ?? result?.handle ?? '').trim();
  if (returnedHandle && returnedHandle !== document.documentHandle) {
    throw new Error('WPS 激活目标与请求文档不一致');
  }
  const active = documentRegistry.markActive(document.documentHandle, { now: now() }) || document;
  return { ...active, ...result };
}

async function readDocumentText({ commandBroker, document, payload }) {
  return commandBroker.request({
    clientId: document.clientId,
    type: 'document.read',
    payload,
    timeoutMs: DOCUMENT_READ_TIMEOUT_MS
  });
}

async function readCurrentDocumentText({ commandBroker, document, revisionToken }) {
  const chunks = [];
  let offset = 0;

  while (true) {
    const result = await readDocumentText({
      commandBroker,
      document,
      payload: {
        documentHandle: document.documentHandle,
        offset,
        limit: MAX_DOCUMENT_CHUNK
      }
    });
    const returnedRevision = String(result.revisionToken ?? '').trim();
    if (returnedRevision !== revisionToken) {
      const error = new Error('WPS document changed; read it again');
      error.code = 'WPS_REVISION_CHANGED';
      throw error;
    }

    const chunk = String(result.text ?? '');
    chunks.push(chunk);
    if (result.done === true) break;

    const nextOffset = Number(result.nextOffset);
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      throw new Error('WPS document read returned an invalid nextOffset');
    }
    offset = nextOffset;
  }

  return chunks.join('');
}

async function setupCommandStream(req, res, commandBroker, clientId) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...corsHeaders(req)
  });

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const unsubscribe = commandBroker.subscribe(clientId, (command) => send('command', command));
  send('hello', { clientId });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function setupSse(req, res, store, { docSessionId, documentKey } = {}) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const onSuggestion = (payload) => {
    const suggestionKey = payload.suggestion?.metadata?.documentKey || '';
    if (
      (!docSessionId && !documentKey) ||
      (docSessionId && payload.suggestion.docSessionId === docSessionId) ||
      (documentKey && suggestionKey === documentKey)
    ) {
      send(payload.type, payload.suggestion);
    }
  };

  store.on('suggestion', onSuggestion);
  send('hello', {
    docSessionId: docSessionId || '',
    documentKey: documentKey || '',
    suggestions: store.listSuggestions({ docSessionId, documentKey })
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    store.off('suggestion', onSuggestion);
  });
}

export async function createBridgeServer({
  dataDir = path.join(PROJECT_ROOT, 'data'),
  store = new ReviewStore({ dataDir }),
  agentToken = '',
  documentRegistry = new DocumentRegistry(),
  commandBroker = new DocumentCommandBroker(),
  allowLegacySubmission = false,
  servicePort = null,
  runtimeIdentity = CURRENT_RUNTIME_IDENTITY,
  now = () => Date.now()
} = {}) {
  await store.load();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname;

      if (req.method === 'OPTIONS') {
        sendJson(req, res, 204, {});
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        sendJson(req, res, 200, {
          ok: true,
          service: 'agent-wps-reviewer',
          ...runtimeIdentity,
          ...(servicePort ? { port: servicePort } : {}),
          sessions: store.listSessions().length,
          suggestions: store.listSuggestions().length
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/sessions/register') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const body = await readJson(req);
        const session = await store.registerSession(body);
        sendJson(req, res, 200, { session });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/sessions') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        sendJson(req, res, 200, { sessions: store.listSessions() });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/wps/documents/active') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const body = await readJson(req);
        const document = await registerDocumentSession({
          store,
          documentRegistry,
          body: { ...body, isActive: true },
          now,
          defaultIsActive: true
        });
        sendJson(req, res, 200, { document: sanitizeDocument(document) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/wps/documents/register') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const body = await readJson(req);
        const document = await registerDocumentSession({ store, documentRegistry, body, now });
        sendJson(req, res, 200, { document: sanitizeDocument(document) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/wps/documents') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        sendJson(req, res, 200, {
          documents: documentRegistry
            .getAvailable({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS })
            .map(sanitizeDocument)
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/wps/documents/active') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const document = documentRegistry.getActive({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS });
        if (!document) {
          sendJson(req, res, 503, publicError('当前没有可用的 WPS 文档'));
          return;
        }
        sendJson(req, res, 200, { document: sanitizeDocument(document) });
        return;
      }

      const activateWpsDocument = pathname.match(/^\/api\/wps\/documents\/([^/]+)\/activate$/);
      if (req.method === 'POST' && activateWpsDocument) {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const documentHandle = decodeURIComponent(activateWpsDocument[1]);
        const document = getFreshDocumentByHandleOrBinding({
          store,
          documentRegistry,
          documentHandle,
          now
        });
        if (!document) {
          sendJson(req, res, 404, publicError('没有找到这篇文章，请确认它仍在 WPS 中打开'));
          return;
        }
        const activated = await activateDocument({ commandBroker, documentRegistry, document, now });
        sendJson(req, res, 200, { document: sanitizeDocument(activated) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/wps/commands') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const clientId = url.searchParams.get('clientId') || '';
        if (!clientId.trim()) {
          sendJson(req, res, 400, publicError('clientId is required'));
          return;
        }
        setupCommandStream(req, res, commandBroker, clientId.trim());
        return;
      }

      const commandResult = pathname.match(/^\/api\/wps\/commands\/([^/]+)\/result$/);
      if (req.method === 'POST' && commandResult) {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const body = await readJson(req);
        const ok = body.ok === false ? commandBroker.reject(commandResult[1], new Error(body.error || 'WPS command failed')) : commandBroker.resolve(commandResult[1], body.result ?? body);
        if (!ok) {
          sendJson(req, res, 404, publicError('Command not found'));
          return;
        }
        sendJson(req, res, 200, { ok: true });
        return;
      }

      if (pathname.startsWith('/api/agent/') && !ensureAgentRouteAuthorized(req, res, agentToken)) {
        return;
      }

      if (req.method === 'GET' && pathname === '/api/agent/documents/active') {
        const document = documentRegistry.getActive({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS });
        if (!document) {
          sendJson(req, res, 503, publicError('当前没有可用的 WPS 文档'));
          return;
        }
        sendJson(req, res, 200, { document: sanitizeDocument(document) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/agent/documents') {
        sendJson(req, res, 200, {
          documents: documentRegistry
            .getAvailable({ now: now(), maxAgeMs: WPS_HEARTBEAT_MAX_AGE_MS })
            .map(sanitizeDocument)
        });
        return;
      }

      const documentByCode = pathname.match(/^\/api\/agent\/documents\/by-code\/([^/]+)$/);
      if (req.method === 'GET' && documentByCode) {
        const connectionCode = decodeURIComponent(documentByCode[1]);
        const document = getFreshDocumentByConnectionCode({ store, documentRegistry, connectionCode, now });
        if (!document) {
          sendJson(req, res, 404, publicError('目标文章未打开或连接已过期'));
          return;
        }
        sendJson(req, res, 200, { document: sanitizeDocument(document) });
        return;
      }

      const documentText = pathname.match(/^\/api\/agent\/documents\/([^/]+)\/text$/);
      if (req.method === 'GET' && documentText) {
        const documentHandle = decodeURIComponent(documentText[1]);
        const document = getFreshDocument(documentRegistry, documentHandle, now);
        if (!document) {
          sendJson(req, res, 404, publicError('WPS document is not available'));
          return;
        }
        const read = parseDocumentReadParams(url);
        const result = await readDocumentText({
          commandBroker,
          document,
          payload: { documentHandle: document.documentHandle, ...read }
        });
        if (result.revisionToken && result.revisionToken !== document.revisionToken) {
          documentRegistry.upsert({
            ...document,
            revisionToken: result.revisionToken,
            lastSeenAt: now(),
            lastActiveAt: document.lastActiveAt,
            isActive: document.isActive
          });
        }
        sendJson(req, res, 200, {
          documentHandle: document.documentHandle,
          text: String(result.text ?? ''),
          nextOffset: Number.isFinite(Number(result.nextOffset)) ? Number(result.nextOffset) : read.offset + String(result.text ?? '').length,
          done: Boolean(result.done),
          revisionToken: String(result.revisionToken ?? document.revisionToken)
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/agent/suggestions') {
        let body = await readJson(req);
        let documentHandle = String(body.documentHandle ?? '').trim();
        if (!documentHandle && body.connectionCode) {
          const resolved = getFreshDocumentByConnectionCode({
            store,
            documentRegistry,
            connectionCode: body.connectionCode,
            now
          });
          if (!resolved) {
            sendJson(req, res, 404, publicError('目标文章未打开或连接已过期'));
            return;
          }
          body = {
            ...body,
            documentHandle: resolved.documentHandle,
            revisionToken: String(body.revisionToken ?? '').trim() || resolved.revisionToken
          };
          documentHandle = resolved.documentHandle;
        }
        const document = getFreshDocument(documentRegistry, documentHandle, now);
        if (!document) {
          sendJson(req, res, 404, publicError('WPS document is not available'));
          return;
        }
        if (String(body.revisionToken ?? '').trim() !== document.revisionToken) {
          sendJson(req, res, 409, publicError('WPS document changed; read it again'));
          return;
        }

        const contract = validateWhitepaperReviewBatch(body);
        if (!contract.ok) {
          sendJson(req, res, 400, publicError('批注未通过白皮书审稿质量门', contract.errors));
          return;
        }

        let documentText;
        try {
          documentText = await readCurrentDocumentText({
            commandBroker,
            document,
            revisionToken: contract.batch.revisionToken
          });
        } catch (error) {
          if (error.code === 'WPS_REVISION_CHANGED') {
            sendJson(req, res, 409, publicError('WPS 正文已变化，请重新读取并复核批注'));
            return;
          }
          if (/timed out/i.test(error.message)) {
            sendJson(req, res, 504, publicError('读取 WPS 正文超时，未保存任何批注'));
            return;
          }
          throw error;
        }

        const grounding = validateGroundedReviewBatch(documentText, contract.batch);
        if (!grounding.ok) {
          sendJson(req, res, 400, publicError('批注未通过当前正文核验', grounding.errors));
          return;
        }

        const locations = new Map(grounding.locations.map((location) => [location.candidateId, location]));
        const suggestions = await store.addValidatedSuggestions(
          contract.batch.suggestions.map((item) => ({
            docSessionId: document.documentHandle,
            sourceAgent: contract.batch.sourceAgent,
            anchorText: item.anchorText,
            contextBefore: item.contextBefore,
            contextAfter: item.contextAfter,
            comment: item.comment,
            metadata: {
              documentHandle: document.documentHandle,
              documentKey: document.documentKey,
              connectionCode: document.connectionCode || '',
              identityKind: document.identityKind,
              documentTitle: document.title,
              documentFullName: document.fullName || '',
              revisionToken: document.revisionToken,
              reviewProfile: contract.batch.reviewProfile,
              reviewScope: contract.batch.reviewScope,
              workflow: contract.batch.workflow,
              styleBaseline: contract.batch.styleBaseline,
              candidateId: item.candidateId,
              category: item.category,
              quality: item.quality,
              location: locations.get(item.candidateId)
            }
          }))
        );
        sendJson(req, res, 201, {
          documentHandle: document.documentHandle,
          documentTitle: document.title,
          suggestions
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/acceptance/events') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const body = await readJson(req);
        const event = await store.addAcceptanceEvent({ ...body, ...runtimeIdentity });
        sendJson(req, res, 201, { event });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/acceptance/events') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        sendJson(req, res, 200, {
          events: store.listAcceptanceEvents({
            docSessionId: url.searchParams.get('docSessionId') || undefined,
            adapterMode: url.searchParams.get('adapterMode') || undefined,
            eventType: url.searchParams.get('eventType') || undefined
          })
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/suggestions') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        sendJson(req, res, 200, {
          suggestions: store.listSuggestions({
            docSessionId: url.searchParams.get('docSessionId') || undefined,
            documentKey: url.searchParams.get('documentKey') || undefined,
            status: url.searchParams.get('status') || undefined
          })
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/suggestions') {
        if (!isAgentAuthorized(req, agentToken)) {
          sendJson(req, res, 401, publicError('Unauthorized', ['Missing or invalid agent token']));
          return;
        }
        if (!allowLegacySubmission) {
          sendJson(
            req,
            res,
            410,
            publicError('旧建议入口已停用；请先调用仓库 Skill，再使用正式批量工具 submit_wps_suggestions')
          );
          return;
        }
        const body = await readJson(req);
        const inputs = (Array.isArray(body.suggestions) ? body.suggestions : [body]).map((item) => ({
          ...item,
          metadata: {
            ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
            reviewStatus: 'legacy-unverified'
          }
        }));
        const suggestions = await store.addValidatedSuggestions(inputs);
        sendJson(req, res, 201, { suggestions });
        return;
      }

      const suggestionPatch = pathname.match(/^\/api\/suggestions\/([^/]+)$/);
      if (req.method === 'PATCH' && suggestionPatch) {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const body = await readJson(req);
        const suggestion = await store.updateSuggestion(suggestionPatch[1], body);
        if (!suggestion) {
          sendJson(req, res, 404, publicError('Suggestion not found'));
          return;
        }
        sendJson(req, res, 200, { suggestion });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/events') {
        if (!ensureAgentRouteAuthorized(req, res, agentToken)) return;
        const docSessionId = url.searchParams.get('docSessionId') || undefined;
        const documentKey = url.searchParams.get('documentKey') || undefined;
        setupSse(req, res, store, { docSessionId, documentKey });
        return;
      }

      const served = await serveStatic(req, res, pathname, agentToken);
      if (served) return;

      sendJson(req, res, 404, publicError('Not found'));
    } catch (error) {
      const statusCode =
        error.message === 'Invalid suggestion' ||
        error.message === 'Invalid status' ||
        error.message === 'Invalid acceptance event' ||
        error.message === 'Invalid WPS document metadata'
          ? 400
          : 500;
      sendJson(req, res, statusCode, publicError(error.message, error.details));
    }
  });

  return { server, store, documentRegistry, commandBroker };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const port = Number(process.env.PORT ?? 17531);
  const host = process.env.HOST ?? '127.0.0.1';
  const dataDir = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
  const pidFile = process.env.WPS_REVIEWER_PID_FILE || '';
  const runtimeInstanceId = process.env.WPS_REVIEWER_RUNTIME_INSTANCE_ID || randomUUID();
  const agentToken = process.env.WPS_REVIEWER_AGENT_TOKEN || readAgentTokenSync({
    tokenPath: process.env.WPS_REVIEWER_AGENT_TOKEN_FILE || undefined
  }) || '';
  const allowLegacySubmission = process.env.WPS_REVIEWER_ALLOW_LEGACY_SUBMIT === '1';
  const runtimeIdentity = {
    ...CURRENT_RUNTIME_IDENTITY,
    runtimeInstanceId,
    platform: process.platform,
    osVersion: os.release(),
    osArch: process.arch
  };
  const { server } = await createBridgeServer({
    dataDir,
    agentToken,
    allowLegacySubmission,
    servicePort: port,
    runtimeIdentity
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  if (pidFile) {
    await mkdir(path.dirname(pidFile), { recursive: true });
    await writeFile(pidFile, `${JSON.stringify({
      pid: process.pid,
      host,
      port,
      runtimeInstanceId,
      platform: process.platform,
      osVersion: os.release(),
      osArch: process.arch,
      productVersion: CURRENT_RUNTIME_IDENTITY.productVersion,
      buildFingerprint: CURRENT_RUNTIME_IDENTITY.buildFingerprint,
      dataDir
    })}\n`);
  }
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await new Promise((resolve) => server.close(resolve));
    if (pidFile) await rm(pidFile, { force: true });
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(`Agent WPS Reviewer bridge listening on http://${host}:${port}`);
  console.log(`Taskpane: http://${host}:${port}/addin/taskpane.html`);
}
