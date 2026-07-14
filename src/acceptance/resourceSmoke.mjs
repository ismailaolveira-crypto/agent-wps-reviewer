import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBridgeServer } from '../bridge/server.mjs';

export const RESOURCE_CHECKS = [
  {
    path: '/health',
    type: 'application/json',
    includes: ['agent-wps-reviewer']
  },
  {
    path: '/WpsAgentReviewer/',
    type: 'text/html',
    includes: ['WpsAgentReviewer', 'ribbon.xml', 'document-connector.js', 'main.js', '<script src="./main.js"></script>']
  },
  {
    path: '/WpsAgentReviewer/ribbon.xml',
    type: 'application/xml',
    includes: ['customUI', 'Agent 审阅', 'showAgentReviewerPane']
  },
  {
    path: '/WpsAgentReviewer/main.js',
    type: 'text/javascript',
    includes: [
      'WpsDocumentConnector.start(getApplication())',
      'ShowAgentReviewerPane',
      'CreateTaskPane',
      'CreateTaskpane'
    ]
  },
  {
    path: '/WpsAgentReviewer/document-connector.js',
    type: 'text/javascript',
    includes: ['WindowActivate', 'DocumentChange', 'DocumentViewFocusIn', 'document.read']
  },
  {
    path: '/addin/taskpane.html',
    type: 'text/html',
    includes: ['Agent 审阅', 'detailSheet', '/addin/wps-adapter.js', '/addin/app.js']
  },
  {
    path: '/addin/app.js',
    type: 'text/javascript',
    includes: ['EventSource', '/api/suggestions', 'pendingStatuses', 'undoRejectStack', 'addComment(suggestion)']
  },
  {
    path: '/addin/wps-adapter.js',
    type: 'text/javascript',
    includes: ['comments.Add({ Range: { Start', 'comments.Add(range, text)', 'TrackRevisions', 'locateInText']
  },
  {
    path: '/addin/styles.css',
    type: 'text/css',
    includes: ['.inbox-panel', '.suggestion-card', '.detail-sheet']
  }
];

async function fetchText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  const text = await response.text();
  return {
    path: pathname,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    bytes: Buffer.byteLength(text),
    text
  };
}

function evaluateResource(check, resource, baseUrl) {
  const missing = check.includes.filter((item) => !resource.text.includes(item));
  if (check.path === '/WpsAgentReviewer/main.js') {
    const taskpaneUrl = new URL('/addin/taskpane.html', baseUrl).href;
    if (!resource.text.includes(taskpaneUrl)) missing.push(taskpaneUrl);
  }
  if (check.path === '/WpsAgentReviewer/document-connector.js') {
    const bridgeOrigin = new URL(baseUrl).origin;
    if (!resource.text.includes(`var BRIDGE_ORIGIN = '${bridgeOrigin}'`)) {
      missing.push(`var BRIDGE_ORIGIN = '${bridgeOrigin}'`);
    }
    if (resource.text.includes('__WPS_REVIEWER_BRIDGE_ORIGIN__')) {
      missing.push('no unresolved bridge-origin placeholder');
    }
  }
  const ok =
    resource.status === 200 &&
    resource.contentType.includes(check.type) &&
    resource.bytes > 0 &&
    missing.length === 0;

  return {
    path: check.path,
    status: ok ? 'passed' : 'failed',
    httpStatus: resource.status,
    contentType: resource.contentType,
    bytes: resource.bytes,
    expectedType: check.type,
    missing
  };
}

export async function smokeWpsResourcesAtBaseUrl(baseUrl, { checks = RESOURCE_CHECKS } = {}) {
  const resources = [];

  for (const check of checks) {
    const resource = await fetchText(baseUrl, check.path);
    resources.push(evaluateResource(check, resource, baseUrl));
  }

  const failed = resources.filter((item) => item.status !== 'passed');
  return {
    ok: failed.length === 0,
    baseUrl,
    checked: resources.length,
    passed: resources.length - failed.length,
    failed: failed.length,
    resources
  };
}

export async function smokeWpsResources({ checks = RESOURCE_CHECKS } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wps-resource-smoke-'));
  const { server } = await createBridgeServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return await smokeWpsResourcesAtBaseUrl(baseUrl, { checks });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}
