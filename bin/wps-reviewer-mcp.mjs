#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { buildAgentAuthHeaders } from '../src/bridge/auth.mjs';
import { readAgentTokenSync } from '../src/install/agentToken.mjs';
import { normalizeSuggestion } from '../src/bridge/validation.mjs';

const SERVER_URL = process.env.WPS_REVIEWER_URL || 'http://127.0.0.1:17531';
const AGENT_TOKEN = process.env.WPS_REVIEWER_TOKEN || readAgentTokenSync({
  tokenPath: process.env.WPS_REVIEWER_TOKEN_FILE || undefined
}) || '';
const PROTOCOL_VERSION = '2025-03-26';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_MANIFEST = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

function readSchema(relativePath) {
  return JSON.parse(readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8'));
}

const ACTIVE_DOCUMENT_INPUT_SCHEMA = readSchema('schemas/wps-active-document.schema.json');
const DOCUMENTS_LIST_INPUT_SCHEMA = readSchema('schemas/wps-documents-list.schema.json');
const DOCUMENT_CODE_INPUT_SCHEMA = readSchema('schemas/wps-document-code.schema.json');
const DOCUMENT_READ_INPUT_SCHEMA = readSchema('schemas/wps-document-read.schema.json');
const SUBMIT_INPUT_SCHEMA = readSchema('schemas/wps-legacy-suggestion.schema.json');
const SUBMIT_BATCH_INPUT_SCHEMA = readSchema('schemas/wps-suggestion-batch.schema.json');

const LIST_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    docSessionId: {
      type: 'string',
      description: 'Filter suggestions by document session id.'
    },
    status: {
      type: 'string',
      enum: ['pending', 'commented', 'applied', 'rejected', 'conflict'],
      description: 'Filter suggestions by review status.'
    }
  }
};

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  writeMessage({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message, data) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message, data } });
}

function textContent(text) {
  return { content: [{ type: 'text', text }] };
}

async function bridgeFetch(path, options = {}) {
  const response = await fetch(new URL(path, SERVER_URL), {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...buildAgentAuthHeaders(AGENT_TOKEN),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.error?.details ? `: ${body.error.details.join('; ')}` : '';
    throw new Error(`${body.error?.message || response.statusText}${detail}`);
  }
  return body;
}

async function resolveDocumentHandleByCode(connectionCode) {
  const code = String(connectionCode ?? '').trim();
  if (!code) throw new Error('connectionCode is required');
  const body = await bridgeFetch(`/api/agent/documents/by-code/${encodeURIComponent(code)}`);
  return body.document;
}

function normalizeSubmitArguments(args = {}) {
  return normalizeSuggestion(args);
}

async function callTool(name, args) {
  if (name === 'list_wps_documents') {
    const body = await bridgeFetch('/api/agent/documents');
    return textContent(JSON.stringify(body.documents || [], null, 2));
  }

  if (name === 'get_active_wps_document') {
    const body = await bridgeFetch('/api/agent/documents/active');
    return textContent(JSON.stringify(body.document, null, 2));
  }

  if (name === 'get_wps_document_by_code') {
    const document = await resolveDocumentHandleByCode(args?.connectionCode);
    return textContent(JSON.stringify(document, null, 2));
  }

  if (name === 'read_wps_document') {
    const documentHandle = String(args?.documentHandle ?? '').trim();
    if (!documentHandle) throw new Error('documentHandle is required');
    const search = new URLSearchParams({
      offset: String(args?.offset ?? 0),
      limit: String(args?.limit ?? 32000)
    });
    const body = await bridgeFetch(
      `/api/agent/documents/${encodeURIComponent(documentHandle)}/text?${search.toString()}`
    );
    return textContent(JSON.stringify(body, null, 2));
  }

  if (name === 'submit_wps_suggestion') {
    const suggestion = normalizeSubmitArguments(args);
    const body = await bridgeFetch('/api/suggestions', {
      method: 'POST',
      body: JSON.stringify(suggestion)
    });
    const created = body.suggestions?.[0];
    return textContent(`已提交 1 条 WPS 审阅建议：${created?.id || 'unknown'}`);
  }

  if (name === 'submit_wps_suggestions') {
    const submission = { ...(args || {}) };
    if (!String(submission.documentHandle || '').trim() && submission.connectionCode) {
      const document = await resolveDocumentHandleByCode(submission.connectionCode);
      submission.documentHandle = document.documentHandle;
      submission.revisionToken = submission.revisionToken || document.revisionToken;
    }
    const body = await bridgeFetch('/api/agent/suggestions', {
      method: 'POST',
      body: JSON.stringify(submission)
    });
    return textContent(`已向 ${body.documentTitle || body.documentHandle} 提交 ${body.suggestions?.length || 0} 条 WPS 审阅建议`);
  }

  if (name === 'list_wps_suggestions') {
    const search = new URLSearchParams();
    if (args?.docSessionId) search.set('docSessionId', String(args.docSessionId));
    if (args?.status) search.set('status', String(args.status));
    const suffix = search.toString() ? `?${search}` : '';
    const body = await bridgeFetch(`/api/suggestions${suffix}`);
    return textContent(JSON.stringify(body.suggestions || [], null, 2));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params = {} } = message;

  if (id === undefined || id === null) {
    return;
  }

  try {
    if (method === 'initialize') {
      result(id, {
        protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: 'agent-wps-reviewer',
          version: PACKAGE_MANIFEST.version
        }
      });
      return;
    }

    if (method === 'tools/list') {
      result(id, {
        tools: [
          {
            name: 'list_wps_documents',
            title: 'List Open WPS Documents',
            description:
              'List all currently open WPS Writer documents with stable handles. Select the target by title or path before reading and submitting review suggestions.',
            inputSchema: DOCUMENTS_LIST_INPUT_SCHEMA
          },
          {
            name: 'get_active_wps_document',
            title: 'Get Active WPS Document',
            description: 'Return metadata for the most recently active WPS Writer document without returning full text.',
            inputSchema: ACTIVE_DOCUMENT_INPUT_SCHEMA
          },
          {
            name: 'get_wps_document_by_code',
            title: 'Resolve WPS Document by Connection Code',
            description:
              'Resolve the exact open WPS Writer document paired with the WPS-XXXX-XXXX code copied from its Agent Review pane. This is the authoritative target-selection method when multiple documents are open.',
            inputSchema: DOCUMENT_CODE_INPUT_SCHEMA
          },
          {
            name: 'read_wps_document',
            title: 'Read WPS Document Chunk',
            description: 'Read one text chunk from the selected open WPS document through the local bridge. The documentHandle must come from list_wps_documents.',
            inputSchema: DOCUMENT_READ_INPUT_SCHEMA
          },
          {
            name: 'submit_wps_suggestion',
            title: 'Submit WPS Review Suggestion',
            description:
              'Deprecated development-only compatibility tool. Formal whitepaper review must use the bundled Skill and submit_wps_suggestions.',
            inputSchema: SUBMIT_INPUT_SCHEMA
          },
          {
            name: 'submit_wps_suggestions',
            title: 'Submit WPS Review Suggestions',
            description:
              'Submit one final-previewed, source-grounded review round produced through the bundled whitepaper-wps-reviewer Skill. Prefer connectionCode when the user supplied a document pairing code; the server resolves it to the exact current WPS document before submission.',
            inputSchema: SUBMIT_BATCH_INPUT_SCHEMA
          },
          {
            name: 'list_wps_suggestions',
            title: 'List WPS Review Suggestions',
            description: 'List suggestions currently stored in the local WPS reviewer bridge.',
            inputSchema: LIST_INPUT_SCHEMA
          }
        ]
      });
      return;
    }

    if (method === 'tools/call') {
      const toolResult = await callTool(params.name, params.arguments || {});
      result(id, toolResult);
      return;
    }

    error(id, -32601, `Method not found: ${method}`);
  } catch (caught) {
    result(id, {
      content: [
        {
          type: 'text',
          text: caught instanceof Error ? caught.message : String(caught)
        }
      ],
      isError: true
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    void handleRequest(JSON.parse(trimmed));
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : caught);
  }
});

rl.on('close', () => {
  process.exit(0);
});
