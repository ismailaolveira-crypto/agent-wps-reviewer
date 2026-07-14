import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getAcceptanceStatus } from '../src/acceptance/status.mjs';
import { startBridge, stopBridge } from '../src/bridge/processControl.mjs';
import { installPluginConfig } from '../src/wps/pluginConfig.mjs';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const runtimeIdentity = getRuntimeIdentity();

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function writeAcceptedEventStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        sessions: [],
        suggestions: [],
        acceptanceEvents: [
          {
            ...runtimeIdentity,
            eventType: 'taskpane.opened',
            adapterMode: 'wps',
            docSessionId: 'default',
            docTitle: 'Acceptance Test Document.docx',
            wpsVersion: '12.1.25895',
            createdAt: '2026-07-10T10:00:00.000Z'
          },
          {
            ...runtimeIdentity,
            eventType: 'suggestion.located',
            adapterMode: 'wps',
            docSessionId: 'default',
            docTitle: 'Acceptance Test Document.docx',
            suggestionId: 'sug-1',
            wpsVersion: '12.1.25895',
            createdAt: '2026-07-10T10:00:30.000Z'
          },
          {
            ...runtimeIdentity,
            eventType: 'suggestion.commented',
            adapterMode: 'wps',
            docSessionId: 'default',
            docTitle: 'Acceptance Test Document.docx',
            suggestionId: 'sug-1',
            wpsVersion: '12.1.25895',
            createdAt: '2026-07-10T10:01:00.000Z'
          }
        ]
      },
      null,
      2
    )
  );
}

test('getAcceptanceStatus reports setup needed before bridge and foreground evidence exist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-status-test-'));
  try {
    const status = await getAcceptanceStatus({
      jsaddonsDir: path.join(dir, 'jsaddons'),
      manualEvidenceFile: path.join(dir, 'missing-manual.json'),
      acceptanceEventStorePath: path.join(dir, 'missing-store.json'),
      bridgeOptions: {
        runtimeDir: path.join(dir, 'runtime'),
        dataDir: path.join(dir, 'data'),
        pidFile: path.join(dir, 'runtime/bridge.pid'),
        logFile: path.join(dir, 'runtime/bridge.log')
      }
    });

    assert.equal(status.accepted, false);
    assert.equal(status.backgroundReady, false);
    assert.equal(status.foregroundReady, false);
    assert.equal(status.nextCommand, 'npm run acceptance:prepare');
    assert.equal(status.checks.pluginConfig.status, 'missing');
    assert.equal(status.checks.bridge.status, 'stopped');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getAcceptanceStatus keeps product unaccepted when WPS events exist but bridge is stopped', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-status-test-'));
  const eventStorePath = path.join(dir, 'data/review-store.json');
  try {
    await installPluginConfig({ jsaddonsDir: path.join(dir, 'jsaddons'), backup: false });
    await writeAcceptedEventStore(eventStorePath);

    const status = await getAcceptanceStatus({
      jsaddonsDir: path.join(dir, 'jsaddons'),
      manualEvidenceFile: path.join(dir, 'missing-manual.json'),
      acceptanceEventStorePath: eventStorePath,
      bridgeOptions: {
        runtimeDir: path.join(dir, 'runtime'),
        dataDir: path.join(dir, 'data'),
        pidFile: path.join(dir, 'runtime/bridge.pid'),
        logFile: path.join(dir, 'runtime/bridge.log')
      }
    });

    assert.equal(status.ok, false);
    assert.equal(status.accepted, false);
    assert.equal(status.backgroundReady, false);
    assert.equal(status.foregroundReady, true);
    assert.equal(status.checks.manualEvidence.status, 'passed');
    assert.equal(status.nextCommand, 'npm run acceptance:prepare');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getAcceptanceStatus reports accepted after bridge and real WPS events exist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-acceptance-status-test-'));
  const port = await getFreePort();
  const eventStorePath = path.join(dir, 'data/review-store.json');
  const bridgeOptions = {
    port,
    runtimeDir: path.join(dir, 'runtime'),
    dataDir: path.join(dir, 'bridge-data'),
    pidFile: path.join(dir, 'runtime/bridge.pid'),
    logFile: path.join(dir, 'runtime/bridge.log')
  };

  try {
    await installPluginConfig({ jsaddonsDir: path.join(dir, 'jsaddons'), backup: false });
    await writeAcceptedEventStore(eventStorePath);
    await startBridge(bridgeOptions);

    const status = await getAcceptanceStatus({
      jsaddonsDir: path.join(dir, 'jsaddons'),
      manualEvidenceFile: path.join(dir, 'missing-manual.json'),
      acceptanceEventStorePath: eventStorePath,
      bridgeOptions
    });

    assert.equal(status.ok, true);
    assert.equal(status.accepted, true);
    assert.equal(status.backgroundReady, true);
    assert.equal(status.foregroundReady, true);
    assert.equal(status.checks.manualEvidence.status, 'passed');
    assert.equal(status.nextCommand, 'npm run acceptance:audit');
  } finally {
    await stopBridge(bridgeOptions).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
