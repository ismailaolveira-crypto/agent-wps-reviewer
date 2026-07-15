import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_GATES,
  evaluateGate,
  parseFirstJsonObject,
  runAcceptanceAudit
} from '../src/acceptance/audit.mjs';
import { writeManualEvidence } from '../src/acceptance/manualEvidence.mjs';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const runtimeIdentity = getRuntimeIdentity();

test('parseFirstJsonObject reads JSON from command output', () => {
  const parsed = parseFirstJsonObject('log line\n{"ok":true,"count":2}\n');
  assert.deepEqual(parsed, { ok: true, count: 2 });
});

test('evaluateGate validates agent ingress evidence', () => {
  const gate = {
    id: 'agent-ingress',
    label: 'Agent ingress',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'agent entry points work'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      suggestionCount: 2,
      sources: ['cli-validator', 'mcp-validator']
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      suggestionCount: 1,
      sources: ['cli-validator']
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates WPS resource smoke evidence', () => {
  const gate = {
    id: 'wps-resource-smoke',
    label: 'WPS resource smoke',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'wps resources are reachable'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      checked: 8,
      failed: 0,
      resources: [{ status: 'passed' }]
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      checked: 8,
      failed: 0,
      resources: [{ status: 'failed' }]
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates agent contract evidence', () => {
  const gate = {
    id: 'agent-contract',
    label: 'Agent contract',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'contract is valid'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      failed: 0,
      checks: [{ status: 'passed' }]
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      failed: 0,
      checks: [{ status: 'failed' }]
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates local installer evidence', () => {
  const gate = {
    id: 'local-installer',
    label: 'Local installer',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'installer works'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      config: { installed: true },
      readiness: {
        ok: true,
        resources: { ok: true }
      }
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      config: { installed: true },
      readiness: {
        ok: false,
        resources: { ok: true }
      }
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates URL consistency evidence', () => {
  const gate = {
    id: 'url-consistency',
    label: 'URL consistency',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'URLs match'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      failed: 0,
      checks: [{ status: 'passed' }]
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      failed: 0,
      checks: [{ status: 'failed' }]
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates default port readiness evidence', () => {
  const gate = {
    id: 'default-port-readiness',
    label: 'Default port readiness',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'default port works'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      port: 17531,
      resources: { ok: true },
      urlConsistency: { ok: true }
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      port: 17531,
      resources: { ok: false },
      urlConsistency: { ok: true }
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates the clean release installation through setup.command', () => {
  const gate = DEFAULT_GATES.find((item) => item.id === 'release-install');
  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      release: { version: '0.2.0', channel: 'beta', productionReady: false },
      runtimeIdentity: { productVersion: '0.2.0', buildFingerprint: '12345678901234567890123456789012' },
      setup: {
        ok: true,
        resources: true,
        mcp: true,
        mcpConfig: true,
        urlConsistency: true,
        dependencyInstall: { attempted: false, nodeModulesPresent: false },
        skills: 1,
        userFacingSkill: 'whitepaper-chief-editor',
        internalSkills: [{ name: 'whitepaper-wps-reviewer', target: 'whitepaper-chief-editor/references/executors/whitepaper-wps-reviewer' }],
        skillContract: { ok: true },
        launchAgent: true
      },
      doctor: { ok: true, mcp: true, mcpConfig: true }
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      release: { version: '0.2.0', channel: 'beta', productionReady: false },
      runtimeIdentity: { productVersion: '0.2.0', buildFingerprint: '12345678901234567890123456789012' },
      setup: {
        ok: true,
        resources: true,
        mcp: true,
        mcpConfig: false,
        urlConsistency: true,
        dependencyInstall: { attempted: false, nodeModulesPresent: false },
        skills: 1,
        userFacingSkill: 'whitepaper-chief-editor',
        internalSkills: [{ name: 'whitepaper-wps-reviewer', target: 'whitepaper-chief-editor/references/executors/whitepaper-wps-reviewer' }],
        launchAgent: true
      },
      doctor: { ok: true, mcp: true, mcpConfig: true }
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates LaunchAgent template evidence', () => {
  const gate = {
    id: 'launch-agent-template',
    label: 'LaunchAgent template',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'LaunchAgent plist generation is safe'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      installed: {
        ok: true,
        loaded: false,
        status: { exists: true, label: 'com.agent-wps-reviewer.bridge' }
      },
      uninstalled: {
        ok: true,
        status: { exists: false }
      }
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      installed: {
        ok: true,
        loaded: true,
        status: { exists: true, label: 'com.agent-wps-reviewer.bridge' }
      },
      uninstalled: {
        ok: true,
        status: { exists: false }
      }
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('evaluateGate validates foreground acceptance preparation evidence', () => {
  const gate = {
    id: 'foreground-prep',
    label: 'Foreground acceptance preparation',
    command: [process.execPath, ['fake']],
    parseJson: true,
    proves: 'foreground prep works'
  };

  const passed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      kit: { ok: true },
      installer: { ok: true },
      bridge: { running: true, health: { ok: true } },
      sample: { suggestions: [{ id: 'sug-1' }] },
      stopped: { running: false }
    }),
    stderr: ''
  });
  assert.equal(passed.status, 'passed');

  const failed = evaluateGate(gate, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      ok: true,
      kit: { ok: true },
      installer: { ok: true },
      bridge: { running: true, health: { ok: true } },
      sample: { suggestions: [] },
      stopped: { running: false }
    }),
    stderr: ''
  });
  assert.equal(failed.status, 'failed');
});

test('runAcceptanceAudit does not mark product completed without manual WPS gates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-audit-isolated-'));
  try {
    const audit = await runAcceptanceAudit({
      acceptanceEventStorePath: path.join(dir, 'isolated-review-store.json'),
      gates: [
        {
          id: 'synthetic',
          label: 'Synthetic gate',
          command: [process.execPath, ['-e', 'console.log("ok")']],
          proves: 'test harness can run a gate'
        }
      ]
    });

    assert.equal(audit.ok, true);
    assert.equal(audit.completed, false);
    assert.equal(audit.backgroundReady, true);
    assert.equal(audit.platformForegroundAccepted, false);
    assert.equal(audit.noviceInstallAccepted, false);
    assert.equal(audit.releasePromotable, false);
    assert.equal(audit.summary.passed, 1);
    assert.equal(audit.summary.manualRequired, 2);
    assert.equal(audit.manualGates.every((gate) => gate.status === 'manual_required'), true);
    assert.match(audit.completionNote, /Final completion still requires foreground WPS validation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runAcceptanceAudit marks completed only with valid manual evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-audit-manual-'));
  const manualEvidenceFile = path.join(dir, 'manual.json');
  try {
    await writeManualEvidence({
      filePath: manualEvidenceFile,
      wpsVersion: '12.1.25895',
      documentPath: 'output/acceptance-kit/wps-reviewer-acceptance.docx',
      taskpaneEvidence: 'Agent 审阅 tab and side pane were visible.',
      mutationEvidence: 'Locate and comment insertion worked in WPS without replacing body text.'
    });

    const audit = await runAcceptanceAudit({
      manualEvidenceFile,
      gates: [
        {
          id: 'synthetic',
          label: 'Synthetic gate',
          command: [process.execPath, ['-e', 'console.log("ok")']],
          proves: 'test harness can run a gate'
        }
      ]
    });

    assert.equal(audit.ok, true);
    assert.equal(audit.completed, true);
    assert.equal(audit.summary.manualRequired, 0);
    assert.equal(audit.manualGates.every((gate) => gate.status === 'passed'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runAcceptanceAudit can complete manual gates from real WPS acceptance events', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-audit-events-'));
  const eventStorePath = path.join(dir, 'data/review-store.json');
  try {
    await mkdir(path.dirname(eventStorePath), { recursive: true });
    await writeFile(
      eventStorePath,
      JSON.stringify(
        {
          sessions: [],
          suggestions: [],
          acceptanceEvents: [
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
          ]
        },
        null,
        2
      )
    );

    const audit = await runAcceptanceAudit({
      manualEvidenceFile: path.join(dir, 'missing-manual.json'),
      acceptanceEventStorePath: eventStorePath,
      gates: [
        {
          id: 'synthetic',
          label: 'Synthetic gate',
          command: [process.execPath, ['-e', 'console.log("ok")']],
          proves: 'test harness can run a gate'
        }
      ]
    });

    assert.equal(audit.ok, true);
    assert.equal(audit.completed, true);
    assert.equal(audit.summary.manualRequired, 0);
    assert.match(audit.manualEvidence.filePath, /review-store\.json$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
