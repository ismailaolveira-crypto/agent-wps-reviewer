import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const runtimeIdentity = getRuntimeIdentity();
import { fileURLToPath } from 'node:url';
import { waitForManualAcceptance } from '../src/acceptance/manualEvidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function writeStore(filePath, acceptanceEvents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        sessions: [],
        suggestions: [],
        acceptanceEvents
      },
      null,
      2
    )
  );
}

function realWpsEvents() {
  return [
    {
      ...runtimeIdentity,
      eventType: 'taskpane.opened',
      adapterMode: 'wps',
      docSessionId: 'doc-real',
      docTitle: 'Acceptance Test Document.docx',
      wpsVersion: '12.1.25895',
      createdAt: '2026-07-09T10:00:00.000Z'
    },
    {
      ...runtimeIdentity,
      eventType: 'suggestion.located',
      adapterMode: 'wps',
      docSessionId: 'doc-real',
      docTitle: 'Acceptance Test Document.docx',
      suggestionId: 'sug-1',
      resultMessage: '已定位',
      wpsVersion: '12.1.25895',
      createdAt: '2026-07-09T10:00:30.000Z'
    },
    {
      ...runtimeIdentity,
      eventType: 'suggestion.commented',
      adapterMode: 'wps',
      docSessionId: 'doc-real',
      docTitle: 'Acceptance Test Document.docx',
      suggestionId: 'sug-1',
      resultMessage: '已生成批注',
      wpsVersion: '12.1.25895',
      createdAt: '2026-07-09T10:01:00.000Z'
    }
  ];
}

test('waitForManualAcceptance resolves when real WPS acceptance events appear', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-wait-test-'));
  const storeFilePath = path.join(dir, 'review-store.json');

  try {
    setTimeout(() => {
      writeStore(storeFilePath, realWpsEvents()).catch(() => {});
    }, 25);

    const result = await waitForManualAcceptance({
      acceptanceEventStorePath: storeFilePath,
      manualEvidenceFile: path.join(dir, 'missing-manual.json'),
      timeoutMs: 1000,
      intervalMs: 20
    });

    assert.equal(result.ok, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.source.filePath, storeFilePath);
    assert.equal(result.checks.every((item) => item.status === 'passed'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('waitForManualAcceptance times out when only mock events exist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-wait-test-'));
  const storeFilePath = path.join(dir, 'review-store.json');

  try {
    await writeStore(storeFilePath, realWpsEvents().map((event) => ({ ...event, adapterMode: 'mock' })));

    const result = await waitForManualAcceptance({
      acceptanceEventStorePath: storeFilePath,
      manualEvidenceFile: path.join(dir, 'missing-manual.json'),
      timeoutMs: 50,
      intervalMs: 10
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.match(result.errors.join('\n'), /Timed out/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('wait-manual-acceptance CLI exits when events appear', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-wait-cli-test-'));
  const storeFilePath = path.join(dir, 'review-store.json');

  try {
    const child = spawn(
      process.execPath,
      [
        'scripts/wait-manual-acceptance.mjs',
        '--store',
        storeFilePath,
        '--file',
        path.join(dir, 'missing-manual.json'),
        '--timeout-ms',
        '1000',
        '--interval-ms',
        '20'
      ],
      {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    setTimeout(() => {
      writeStore(storeFilePath, realWpsEvents()).catch(() => {});
    }, 25);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    const exitCode = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(exitCode, 0, stderr || stdout);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.timedOut, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
