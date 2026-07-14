import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  deriveManualEvidenceFromAcceptanceEvents,
  loadManualEvidence,
  validateManualEvidence,
  writeManualEvidence
} from '../src/acceptance/manualEvidence.mjs';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const runtimeIdentity = getRuntimeIdentity();

test('loadManualEvidence reports manual_required when evidence is absent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-manual-evidence-'));
  try {
    const result = await loadManualEvidence({
      filePath: path.join(dir, 'missing.json'),
      acceptanceEventStorePath: path.join(dir, 'isolated-review-store.json')
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'manual_required');
    assert.equal(result.checks.length, 2);
    assert.equal(result.checks.every((item) => item.status === 'manual_required'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validateManualEvidence requires both foreground WPS checks', () => {
  const result = validateManualEvidence({
    checkedAt: '2026-07-09T10:00:00.000Z',
    wpsVersion: '12.1.25895',
    documentPath: 'output/acceptance-kit/wps-reviewer-acceptance.docx',
    checks: [
      {
        id: 'wps-taskpane-visible',
        status: 'passed',
        evidence: 'Agent 审阅 tab and side pane were visible.'
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /wps-comment-flow/);
});

test('validateManualEvidence rejects a manual file from another build', () => {
  const result = validateManualEvidence({
    productVersion: runtimeIdentity.productVersion,
    buildFingerprint: '00000000000000000000000000000000',
    checkedAt: '2026-07-09T10:00:00.000Z',
    wpsVersion: '12.1.25895',
    documentPath: 'output/acceptance-kit/wps-reviewer-acceptance.docx',
    checks: [
      {
        id: 'wps-taskpane-visible',
        status: 'passed',
        evidence: 'Agent 审阅 tab and side pane were visible.'
      },
      {
        id: 'wps-comment-flow',
        status: 'passed',
        evidence: 'Locate and comment insertion worked without changing body text.'
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /buildFingerprint does not match current runtime/);
});

test('writeManualEvidence writes a valid evidence file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-manual-evidence-'));
  const filePath = path.join(dir, 'manual.json');
  try {
    const written = await writeManualEvidence({
      filePath,
      wpsVersion: '12.1.25895',
      documentPath: 'output/acceptance-kit/wps-reviewer-acceptance.docx',
      taskpaneEvidence: 'Agent 审阅 tab and side pane were visible.',
      mutationEvidence: 'Locate and comment insertion both worked in WPS without replacing body text.'
    });
    assert.equal(written.ok, true);

    const loaded = await loadManualEvidence({ filePath });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'passed');
    assert.equal(loaded.checks.every((item) => item.status === 'passed'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deriveManualEvidenceFromAcceptanceEvents ignores mock events and requires real WPS locate and comment events', () => {
  const mockOnly = deriveManualEvidenceFromAcceptanceEvents([
    {
      ...runtimeIdentity,
      eventType: 'taskpane.opened',
      adapterMode: 'mock',
      docSessionId: 'doc-1',
      docTitle: 'Browser Mock Document',
      createdAt: '2026-07-09T10:00:00.000Z'
    },
    {
      eventType: 'suggestion.commented',
      adapterMode: 'mock',
      docSessionId: 'doc-1',
      docTitle: 'Browser Mock Document',
      createdAt: '2026-07-09T10:01:00.000Z'
    }
  ]);
  assert.equal(mockOnly.ok, false);
  assert.match(mockOnly.errors.join('\n'), /wps-taskpane-visible/);

  const wpsEvidence = deriveManualEvidenceFromAcceptanceEvents([
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
  ]);

  assert.equal(wpsEvidence.ok, true);
  assert.equal(wpsEvidence.status, 'passed');
  assert.equal(wpsEvidence.checks.every((item) => item.status === 'passed'), true);
  assert.match(wpsEvidence.evidence.checks[1].evidence, /suggestion\.commented/);
  assert.match(wpsEvidence.evidence.checks[1].evidence, /suggestion\.located/);
});

test('deriveManualEvidenceFromAcceptanceEvents ignores identity-less and stale WPS events', () => {
  const result = deriveManualEvidenceFromAcceptanceEvents([
    {
      eventType: 'taskpane.opened',
      adapterMode: 'wps',
      docSessionId: 'old-session',
      createdAt: '2026-07-09T10:00:00.000Z'
    },
    {
      eventType: 'suggestion.located',
      adapterMode: 'wps',
      docSessionId: 'old-session',
      createdAt: '2026-07-09T10:00:30.000Z'
    },
    {
      eventType: 'suggestion.commented',
      adapterMode: 'wps',
      docSessionId: 'old-session',
      createdAt: '2026-07-09T10:01:00.000Z'
    },
    {
      ...runtimeIdentity,
      eventType: 'taskpane.opened',
      adapterMode: 'wps',
      docSessionId: 'current-session',
      docTitle: 'Current.docx',
      wpsVersion: '12.1.25895',
      createdAt: '2026-07-10T10:00:00.000Z'
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.evidence.ignoredWpsEventCount, 3);
  assert.match(result.errors.join('\n'), /wps-comment-flow/);
});
