import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildPluginEntry,
  buildPublishXml,
  installPluginConfig,
  readPluginConfigStatus,
  uninstallPluginConfig
} from '../src/wps/pluginConfig.mjs';

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-plugin-config-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildPluginEntry returns WPS online plugin XML', () => {
  assert.equal(
    buildPluginEntry('http://127.0.0.1:17531/WpsAgentReviewer/'),
    '<jspluginonline name="WpsAgentReviewer" type="wps" url="http://127.0.0.1:17531/WpsAgentReviewer/" debug="" enable="enable_dev" install="http://127.0.0.1:17531/WpsAgentReviewer/"/>'
  );
});

test('buildPublishXml returns Mac-friendly publish XML', () => {
  const xml = buildPublishXml('http://127.0.0.1:17531/WpsAgentReviewer/');
  assert.match(xml, /<jsplugins>/);
  assert.match(xml, /name="WpsAgentReviewer"/);
  assert.match(xml, /debug=""/);
  assert.match(xml, /enable="enable_dev"/);
  assert.match(xml, /install="http:\/\/127\.0\.0\.1:17531\/WpsAgentReviewer\/"/);
});

test('installPluginConfig creates jsplugins.xml and is idempotent', async () => {
  await withTempDir(async (dir) => {
    const first = await installPluginConfig({ jsaddonsDir: dir, backup: false });
    assert.equal(first.installed, true);
    assert.equal(first.changed, true);

    const second = await installPluginConfig({ jsaddonsDir: dir, backup: false });
    assert.equal(second.installed, true);
    assert.equal(second.changed, false);

    const xml = await readFile(path.join(dir, 'jsplugins.xml'), 'utf8');
    const publishXml = await readFile(path.join(dir, 'publish.xml'), 'utf8');
    assert.equal((xml.match(/name="WpsAgentReviewer"/g) || []).length, 1);
    assert.equal((publishXml.match(/name="WpsAgentReviewer"/g) || []).length, 1);
    assert.match(xml, /<jsplugins>/);
  });
});

test('installPluginConfig preserves existing plugin entries', async () => {
  await withTempDir(async (dir) => {
    const existing = [
      '<jsplugins>',
      '  <jspluginonline name="OtherPlugin" type="wps" url="http://127.0.0.1:1234/Other/"/>',
      '</jsplugins>',
      ''
    ].join('\n');
    await writeFile(path.join(dir, 'jsplugins.xml'), existing);

    await installPluginConfig({ jsaddonsDir: dir, backup: false });
    const xml = await readFile(path.join(dir, 'jsplugins.xml'), 'utf8');

    assert.match(xml, /OtherPlugin/);
    assert.match(xml, /WpsAgentReviewer/);
  });
});

test('uninstallPluginConfig removes only Agent reviewer entry', async () => {
  await withTempDir(async (dir) => {
    await installPluginConfig({ jsaddonsDir: dir, backup: false });
    await installPluginConfig({
      jsaddonsDir: dir,
      backup: false,
      pluginName: 'OtherPlugin',
      pluginUrl: 'http://127.0.0.1:1234/Other/'
    });

    const result = await uninstallPluginConfig({ jsaddonsDir: dir, backup: false });
    assert.equal(result.installed, false);
    assert.equal(result.changed, true);

    const xml = await readFile(path.join(dir, 'jsplugins.xml'), 'utf8');
    const publishXml = await readFile(path.join(dir, 'publish.xml'), 'utf8');
    assert.doesNotMatch(xml, /WpsAgentReviewer/);
    assert.doesNotMatch(publishXml, /WpsAgentReviewer/);
    assert.match(xml, /OtherPlugin/);
  });
});

test('readPluginConfigStatus reports installed state', async () => {
  await withTempDir(async (dir) => {
    assert.equal((await readPluginConfigStatus({ jsaddonsDir: dir })).installed, false);
    await installPluginConfig({ jsaddonsDir: dir, backup: false });
    const status = await readPluginConfigStatus({ jsaddonsDir: dir });
    assert.equal(status.installed, true);
    assert.match(status.filePath, /jsplugins\.xml$/);
    assert.match(status.publishPath, /publish\.xml$/);
  });
});
