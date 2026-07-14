# Active WPS Document Agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Codex and other local MCP agents discover, read, and submit suggestions to the most recently active WPS Writer document without a manual session id.

**Architecture:** A WPS background connector reports active-document metadata and listens for read commands. The localhost bridge keeps only metadata, brokers on-demand text reads in memory, and validates document/revision targets before persisting suggestions. The stdio MCP server exposes active-document, chunk-read, batch-submit, and list tools.

**Tech Stack:** Node.js 20+, native `node:http`, native test runner, classic JavaScript for the WPS CEF host, JSON Schema draft 2020-12, MCP JSON-RPC over stdio, Codex CLI 0.142.5.

## Global Constraints

- Target platform is macOS with WPS Office 12.1.25895.
- Do not launch, focus, quit, or automate WPS during background implementation.
- Bridge remains bound to `127.0.0.1:17531`.
- Document text is request-scoped memory only; never write it to ReviewStore, logs, or acceptance events.
- A read response is limited to 32,000 characters and times out after 5 seconds.
- WPS client heartbeat expires after 10 seconds.
- Preserve legacy `submit_wps_suggestion` and `list_wps_suggestions` tools.
- The project directory is not a Git repository. Do not run `git init`; use test checkpoints instead of commits.

---

### Task 1: Active Document Registry

**Files:**
- Create: `src/bridge/documentRegistry.mjs`
- Create: `test/document-registry.test.mjs`

**Interfaces:**
- Consumes: WPS metadata objects with `clientId`, `documentHandle`, `title`, `textLength`, `revisionToken`, and `lastActiveAt`.
- Produces: `DocumentRegistry.upsert(input)`, `DocumentRegistry.getActive({ now, maxAgeMs })`, `DocumentRegistry.getByHandle(handle)`, and `DocumentRegistry.removeClient(clientId)`.

- [ ] **Step 1: Write failing freshness and switching tests**

```js
test('registry returns the most recently active fresh document', () => {
  const registry = new DocumentRegistry();
  registry.upsert({ clientId: 'c1', documentHandle: 'doc-a', title: 'A.docx', lastActiveAt: 1000 });
  registry.upsert({ clientId: 'c1', documentHandle: 'doc-b', title: 'B.docx', lastActiveAt: 2000 });
  assert.equal(registry.getActive({ now: 2500, maxAgeMs: 10000 }).documentHandle, 'doc-b');
});

test('registry rejects stale clients', () => {
  const registry = new DocumentRegistry();
  registry.upsert({ clientId: 'c1', documentHandle: 'doc-a', lastActiveAt: 1000 });
  assert.equal(registry.getActive({ now: 12001, maxAgeMs: 10000 }), null);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/document-registry.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `documentRegistry.mjs`.

- [ ] **Step 3: Implement the registry**

```js
export class DocumentRegistry {
  constructor() {
    this.documents = new Map();
  }

  upsert(input) {
    const document = {
      clientId: String(input.clientId),
      documentHandle: String(input.documentHandle),
      title: String(input.title || 'WPS Document'),
      textLength: Number(input.textLength || 0),
      revisionToken: String(input.revisionToken || ''),
      lastActiveAt: Number(input.lastActiveAt || Date.now())
    };
    this.documents.set(document.documentHandle, document);
    return document;
  }

  getActive({ now = Date.now(), maxAgeMs = 10000 } = {}) {
    return [...this.documents.values()]
      .filter((item) => now - item.lastActiveAt <= maxAgeMs)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] || null;
  }

  getByHandle(handle) {
    return this.documents.get(String(handle)) || null;
  }

  removeClient(clientId) {
    for (const [handle, item] of this.documents) {
      if (item.clientId === clientId) this.documents.delete(handle);
    }
  }
}
```

- [ ] **Step 4: Run the focused test**

Run: `node --test test/document-registry.test.mjs`
Expected: all registry tests PASS.

### Task 2: Request-Scoped Document Command Broker

**Files:**
- Create: `src/bridge/documentCommandBroker.mjs`
- Create: `test/document-command-broker.test.mjs`

**Interfaces:**
- Consumes: `{ clientId, type: 'document.read', payload, timeoutMs }`.
- Produces: `broker.request(input): Promise<result>`, `broker.subscribe(clientId, listener): unsubscribe`, and `broker.resolve(commandId, result)`.

- [ ] **Step 1: Write failing resolve and timeout tests**

```js
test('broker routes a command to one WPS client and resolves it', async () => {
  const broker = new DocumentCommandBroker();
  const seen = [];
  broker.subscribe('client-a', (command) => {
    seen.push(command);
    broker.resolve(command.id, { text: '正文', done: true });
  });
  const result = await broker.request({ clientId: 'client-a', type: 'document.read', payload: {}, timeoutMs: 100 });
  assert.equal(seen.length, 1);
  assert.equal(result.text, '正文');
});

test('broker rejects a timed out read and removes pending state', async () => {
  const broker = new DocumentCommandBroker();
  await assert.rejects(
    broker.request({ clientId: 'missing', type: 'document.read', payload: {}, timeoutMs: 10 }),
    /timed out/
  );
  assert.equal(broker.pendingCount, 0);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/document-command-broker.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement command routing with cleanup**

```js
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
    this.listeners.set(String(clientId), listener);
    return () => this.listeners.delete(String(clientId));
  }

  request({ clientId, type, payload = {}, timeoutMs = 5000 }) {
    const id = createId('cmd');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('WPS document read timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const listener = this.listeners.get(String(clientId));
      if (listener) queueMicrotask(() => listener({ id, type, payload }));
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
}
```

- [ ] **Step 4: Run broker tests**

Run: `node --test test/document-command-broker.test.mjs`
Expected: resolve and timeout tests PASS.

### Task 3: Bridge Document and Batch Suggestion APIs

**Files:**
- Modify: `src/bridge/server.mjs`
- Modify: `src/bridge/store.mjs`
- Modify: `src/bridge/validation.mjs`
- Create: `test/document-api.test.mjs`
- Modify: `test/api.test.mjs`

**Interfaces:**
- Consumes: connector registration/result requests and authenticated Agent read/submit requests.
- Produces: `POST /api/wps/documents/active`, `GET /api/wps/commands`, `POST /api/wps/commands/:id/result`, `GET /api/agent/documents/active`, `GET /api/agent/documents/:handle/text`, and `POST /api/agent/suggestions`.

- [ ] **Step 1: Add failing API tests for active metadata, text reads, stale revisions, and CORS**

```js
test('agent reads only the registered active WPS document', async () => {
  const registered = await post('/api/wps/documents/active', {
    clientId: 'wps-1', documentHandle: 'doc-a', title: 'A.docx', textLength: 6,
    revisionToken: 'sha256:a', lastActiveAt: Date.now()
  });
  assert.equal(registered.status, 200);
  const active = await get('/api/agent/documents/active', { authorization: 'Bearer secret' });
  assert.equal(active.body.document.documentHandle, 'doc-a');
});

test('batch submission rejects a stale revision without persisting suggestions', async () => {
  const response = await post('/api/agent/suggestions', {
    documentHandle: 'doc-a', revisionToken: 'sha256:old', sourceAgent: 'codex',
    suggestions: [{ anchorText: '原文', comment: '批注' }]
  }, { authorization: 'Bearer secret' });
  assert.equal(response.status, 409);
});
```

- [ ] **Step 2: Run focused API tests and verify 404/409 failures**

Run: `node --test test/document-api.test.mjs test/api.test.mjs`
Expected: new document routes return 404 before implementation.

- [ ] **Step 3: Inject registry and broker into the bridge**

```js
export async function createBridgeServer({
  dataDir,
  store = new ReviewStore({ dataDir }),
  agentToken = '',
  documentRegistry = new DocumentRegistry(),
  commandBroker = new DocumentCommandBroker(),
  now = () => Date.now()
} = {}) {
  // Existing routes remain; document routes use these injected collaborators.
}
```

- [ ] **Step 4: Implement route validation and target mapping**

```js
const active = documentRegistry.getActive({ now: now(), maxAgeMs: 10000 });
if (!active) return sendJson(res, 503, publicError('No active WPS document'));

const result = await commandBroker.request({
  clientId: active.clientId,
  type: 'document.read',
  payload: { documentHandle: active.documentHandle, offset, limit },
  timeoutMs: 5000
});

if (body.revisionToken !== active.revisionToken) {
  return sendJson(res, 409, publicError('WPS document changed; read it again'));
}
```

Each submitted suggestion is normalized with:

```js
{
  ...item,
  docSessionId: active.documentHandle,
  metadata: {
    ...(item.metadata || {}),
    documentHandle: active.documentHandle,
    revisionToken: active.revisionToken,
    category: String(item.category || '')
  }
}
```

- [ ] **Step 5: Restrict browser origins and protect Agent routes**

Use an `Origin` allowlist containing only `http://127.0.0.1:17531` and `http://localhost:17531`; omit CORS headers when no trusted origin matches. Require `isAgentAuthorized` for every `/api/agent/*` route.

- [ ] **Step 6: Run API and persistence tests**

Run: `node --test test/document-api.test.mjs test/api.test.mjs test/store.test.mjs`
Expected: all tests PASS and ReviewStore JSON contains metadata/suggestions but no document text.

### Task 4: WPS Background Document Connector

**Files:**
- Create: `public/WpsAgentReviewer/document-connector.js`
- Modify: `public/WpsAgentReviewer/index.html`
- Modify: `public/WpsAgentReviewer/main.js`
- Create: `test/wps-document-connector.test.mjs`
- Modify: `test/wps-api-compat.test.mjs`

**Interfaces:**
- Consumes: WPS `Application.ActiveDocument`, `Application.ApiEvent`, and bridge commands.
- Produces: global `WpsDocumentConnector.start(application)` and connector HTTP calls.

- [ ] **Step 1: Write failing source and pure-helper tests**

```js
test('connector subscribes to Writer activation and change events', async () => {
  const source = await readFile('public/WpsAgentReviewer/document-connector.js', 'utf8');
  assert.match(source, /WindowActivate/);
  assert.match(source, /DocumentChange/);
  assert.match(source, /DocumentViewFocusIn/);
  assert.match(source, /document\.read/);
  assert.match(source, /crypto\.subtle\.digest/);
});
```

- [ ] **Step 2: Run connector tests and verify missing-file failure**

Run: `node --test test/wps-document-connector.test.mjs test/wps-api-compat.test.mjs`
Expected: FAIL because `document-connector.js` does not exist.

- [ ] **Step 3: Implement identity, revision, and chunk helpers**

```js
async function sha256(text) {
  var bytes = new TextEncoder().encode(text);
  var digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

function readChunk(text, offset, limit) {
  var safeOffset = Math.max(0, Number(offset) || 0);
  var safeLimit = Math.min(32000, Math.max(1, Number(limit) || 32000));
  var chunk = text.slice(safeOffset, safeOffset + safeLimit);
  return { text: chunk, nextOffset: safeOffset + chunk.length, done: safeOffset + chunk.length >= text.length };
}
```

- [ ] **Step 4: Register active metadata and command events**

On startup and each WPS event, call `POST /api/wps/documents/active` with a runtime-scoped handle. Connect to `/api/wps/commands?clientId=...`; for `document.read`, verify `Application.ActiveDocument` still matches the handle, compute the exact-text SHA-256, return the requested chunk, and POST the result.

- [ ] **Step 5: Start connector without affecting WPS focus**

```js
function OnAddinLoad(ribbonUI) {
  agentReviewerRibbon = ribbonUI;
  try {
    WpsDocumentConnector.start(getApplication());
  } catch (error) {
    // Ribbon remains usable; connector retries through its own timer.
  }
  return true;
}
```

Load `document-connector.js` before `main.js` in `index.html`.

- [ ] **Step 6: Run connector and resource smoke tests**

Run: `node --test test/wps-document-connector.test.mjs test/wps-api-compat.test.mjs test/resource-smoke.test.mjs`
Expected: all tests PASS without launching WPS.

### Task 5: MCP Active-Document and Batch Tools

**Files:**
- Create: `schemas/wps-active-document.schema.json`
- Create: `schemas/wps-document-read.schema.json`
- Create: `schemas/wps-suggestion-batch.schema.json`
- Modify: `bin/wps-reviewer-mcp.mjs`
- Modify: `test/mcp.test.mjs`
- Modify: `docs/AGENT_INTEGRATION.md`

**Interfaces:**
- Consumes: authenticated `/api/agent/*` routes from Task 3.
- Produces: tools `get_active_wps_document`, `read_wps_document`, `submit_wps_suggestions`, `submit_wps_suggestion`, and `list_wps_suggestions`.

- [ ] **Step 1: Extend the failing MCP tool-list test**

```js
assert.deepEqual(names, [
  'get_active_wps_document',
  'list_wps_suggestions',
  'read_wps_document',
  'submit_wps_suggestion',
  'submit_wps_suggestions'
]);
```

Add calls that register a fake WPS client, resolve one document read, and verify batch submission uses the returned `documentHandle` and `revisionToken`.

- [ ] **Step 2: Run MCP tests and verify missing-tool failure**

Run: `node --test test/mcp.test.mjs`
Expected: FAIL because only two tools are currently exposed.

- [ ] **Step 3: Add exact MCP handlers**

```js
if (name === 'get_active_wps_document') {
  const body = await bridgeFetch('/api/agent/documents/active');
  return textContent(JSON.stringify(body.document, null, 2));
}

if (name === 'read_wps_document') {
  const search = new URLSearchParams({
    offset: String(args.offset || 0),
    limit: String(args.limit || 32000)
  });
  const body = await bridgeFetch(`/api/agent/documents/${encodeURIComponent(args.documentHandle)}/text?${search}`);
  return textContent(JSON.stringify(body, null, 2));
}

if (name === 'submit_wps_suggestions') {
  const body = await bridgeFetch('/api/agent/suggestions', {
    method: 'POST',
    body: JSON.stringify(args)
  });
  return textContent(`已向 ${body.documentTitle} 提交 ${body.suggestions.length} 条 WPS 审阅建议`);
}
```

- [ ] **Step 4: Run MCP and schema contract tests**

Run: `node --test test/mcp.test.mjs test/agent-contract.test.mjs`
Expected: all MCP and schema tests PASS.

### Task 6: Token File and Codex MCP Installer

**Files:**
- Create: `src/install/agentToken.mjs`
- Create: `src/install/codexMcp.mjs`
- Create: `scripts/install-codex-mcp.mjs`
- Create: `test/agent-token.test.mjs`
- Create: `test/codex-mcp-install.test.mjs`
- Modify: `src/install/launchAgent.mjs`
- Modify: `package.json`
- Modify: `docs/WPS_INSTALL.md`

**Interfaces:**
- Consumes: Codex CLI `codex mcp add`, Node executable path, project MCP path.
- Produces: token file mode `0600` and npm scripts `codex:mcp:status`, `codex:mcp:install`, `codex:mcp:uninstall`.

- [ ] **Step 1: Write failing token and command construction tests**

```js
test('ensureAgentToken creates a 0600 token and reuses it', async () => {
  const first = await ensureAgentToken({ tokenPath });
  const second = await ensureAgentToken({ tokenPath });
  assert.equal(first.token, second.token);
  assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
});

test('buildCodexMcpAddArgs scopes changes to agent-wps-reviewer', () => {
  assert.deepEqual(buildCodexMcpAddArgs({ nodePath, mcpPath, tokenPath }), [
    'mcp', 'add', '--env', `WPS_REVIEWER_TOKEN_FILE=${tokenPath}`,
    'agent-wps-reviewer', '--', nodePath, mcpPath
  ]);
});
```

- [ ] **Step 2: Run installer tests and verify missing-module failure**

Run: `node --test test/agent-token.test.mjs test/codex-mcp-install.test.mjs`
Expected: FAIL with missing install modules.

- [ ] **Step 3: Implement token generation and file loading**

```js
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureAgentToken({ tokenPath }) {
  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  try {
    return { token: (await readFile(tokenPath, 'utf8')).trim(), changed: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  return { token, changed: true };
}
```

MCP reads `WPS_REVIEWER_TOKEN`, then `WPS_REVIEWER_TOKEN_FILE`, then the default token path. LaunchAgent reads the same file so the bridge and MCP share one secret without putting it in command output.

- [ ] **Step 4: Implement idempotent Codex configuration commands**

Status uses `codex mcp get agent-wps-reviewer`. Install removes only an existing entry with that exact name, then runs `codex mcp add`; uninstall removes only that exact name. Never parse or rewrite `~/.codex/config.toml` directly.

- [ ] **Step 5: Run installer, launch-agent, and full tests**

Run: `node --test test/agent-token.test.mjs test/codex-mcp-install.test.mjs test/launch-agent.test.mjs`
Expected: all tests PASS with spawned commands mocked; no live Codex config changes during tests.

Run: `npm test`
Expected: zero failures.

### Task 7: Background Integration Acceptance

**Files:**
- Modify: `src/acceptance/audit.mjs`
- Modify: `src/acceptance/resourceSmoke.mjs`
- Create: `test/active-document-acceptance.test.mjs`
- Modify: `docs/ACCEPTANCE.md`

**Interfaces:**
- Consumes: all interfaces from Tasks 1-6.
- Produces: one automated proof that a fake WPS connector registers A, switches to B, serves B text in chunks, and receives suggestions only for B.

- [ ] **Step 1: Write the failing end-to-end background test**

The test starts a temporary bridge, registers two documents with increasing activation times, opens the command stream for the active client, calls MCP `get_active_wps_document` and `read_wps_document`, submits two suggestions, and asserts ReviewStore contains no source document text.

- [ ] **Step 2: Run and verify the acceptance test fails before final wiring**

Run: `node --test test/active-document-acceptance.test.mjs`
Expected: FAIL at the first missing integration assertion.

- [ ] **Step 3: Complete wiring and acceptance evidence**

Update the audit to report separate checks for active-document discovery, chunk reads, revision mismatch rejection, token authorization, and batch target mapping. Evidence must include test names and counts, not document text.

- [ ] **Step 4: Run the complete background gate**

Run: `npm test`
Expected: zero failed tests.

Run: `npm run validate:background`
Expected: `ok: true`.

Run: `npm run acceptance:audit`
Expected: active-document background checks pass; foreground WPS checks may remain pending until the user opens WPS.
