import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runWpsDiagnostics } from '../src/wps/diagnostics.mjs';
import { installPluginConfig } from '../src/wps/pluginConfig.mjs';

test('runWpsDiagnostics reports installed plugin files from a fake jsaddons dir', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diag-'));
  try {
    await installPluginConfig({ jsaddonsDir: dir, backup: false });
    const diagnostics = await runWpsDiagnostics({
      jsaddonsDir: dir,
      wpsAppPath: '/missing/wpsoffice.app',
      checkBridge: false,
      checkProcess: false
    });

    assert.equal(diagnostics.plugin.installed, true);
    assert.equal(diagnostics.plugin.exists, true);
    assert.equal(diagnostics.plugin.publishExists, true);
    assert.equal(diagnostics.plugin.debugEnabled, false);
    assert.equal(diagnostics.auth.exists, false);
    assert.equal(diagnostics.wpsApp.exists, false);
    assert.equal(diagnostics.bridge.checked, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWpsDiagnostics flags a disabled WPS add-in authorization', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diag-'));
  try {
    await installPluginConfig({ jsaddonsDir: dir, backup: false });
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'authaddin.json'),
      JSON.stringify(
        {
          wps: {
            agentKey: {
              enable: false,
              isload: true,
              name: 'WpsAgentReviewer',
              path: 'http://127.0.0.1:17531/WpsAgentReviewer'
            },
            namelist: 'agentKey'
          }
        },
        null,
        2
      )
    );

    const diagnostics = await runWpsDiagnostics({
      jsaddonsDir: dir,
      wpsAppPath: '/missing/wpsoffice.app',
      checkBridge: false,
      checkProcess: false
    });

    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.auth.disabled, true);
    const authorizationRecommendation = process.platform === 'win32'
      ? diagnostics.recommendations.some((item) => item.includes('publish/trust'))
      : diagnostics.recommendations.some((item) => item.includes('wps:authorize'));
    assert.equal(authorizationRecommendation, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWpsDiagnostics flags corrupt WPS authorization JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diagnostics-corrupt-'));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'authaddin.json'), '{not-json');
    const diagnostics = await runWpsDiagnostics({
      jsaddonsDir: dir,
      wpsAppPath: '/missing/wpsoffice.app',
      checkBridge: false,
      checkProcess: false
    });
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.auth.valid, false);
    assert.match(diagnostics.recommendations.join('\n'), /authaddin\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWpsDiagnostics flags missing plugin installation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diag-'));
  try {
    const diagnostics = await runWpsDiagnostics({
      jsaddonsDir: dir,
      wpsAppPath: '/missing/wpsoffice.app',
      checkBridge: false,
      checkProcess: false
    });

    assert.equal(diagnostics.plugin.installed, false);
    assert.ok(diagnostics.recommendations.some((item) => item.includes('wps:install')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWpsDiagnostics flags legacy WPS development attributes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diag-debug-'));
  try {
    await writeFile(path.join(dir, 'publish.xml'), [
      '<jsplugins>',
      '  <jspluginonline name="WpsAgentReviewer" type="wps" url="http://127.0.0.1:17531/WpsAgentReviewer/" debug="" enable="enable_dev"/>',
      '</jsplugins>',
      ''
    ].join('\n'));
    const diagnostics = await runWpsDiagnostics({
      jsaddonsDir: dir,
      wpsAppPath: '/missing/wpsoffice.app',
      checkBridge: false,
      checkProcess: false
    });
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.plugin.debugEnabled, true);
    assert.match(diagnostics.recommendations.join('\n'), /打开JS调试器/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWpsDiagnostics reports bridge health when supplied', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diag-'));
  try {
    await writeFile(path.join(dir, 'dummy'), '');
    const diagnostics = await runWpsDiagnostics({
      jsaddonsDir: dir,
      wpsAppPath: '/missing/wpsoffice.app',
      bridgeUrl: 'http://127.0.0.1:1',
      checkBridge: true,
      checkProcess: false
    });

    assert.equal(diagnostics.bridge.checked, true);
    assert.equal(diagnostics.bridge.running, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runWpsDiagnostics handles non-macOS and non-Windows hosts without WPS path assumptions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-diagnostics-linux-'));
  try {
    const diagnostics = await runWpsDiagnostics({
      platform: 'linux',
      jsaddonsDir: dir,
      checkBridge: false,
      checkProcess: false
    });
    assert.equal(diagnostics.wpsApp.exists, false);
    assert.equal(diagnostics.wpsApp.path, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
