import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  checkUrlConsistency,
  extractHttpUrls,
  extractPluginUrls
} from '../src/acceptance/urlConsistency.mjs';
import {
  buildPluginEntry,
  buildPublishXml,
  DEFAULT_PLUGIN_URL
} from '../src/wps/pluginConfig.mjs';

async function makeInstalledConfig(pluginUrl = DEFAULT_PLUGIN_URL) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wps-url-consistency-'));
  await mkdir(dir, { recursive: true });
  await writeFile(dir + '/jsplugins.xml', ['<jsplugins>', `  ${buildPluginEntry(pluginUrl)}`, '</jsplugins>', ''].join('\n'));
  await writeFile(dir + '/publish.xml', buildPublishXml(pluginUrl));
  return dir;
}

test('extractPluginUrls reads WPS plugin URLs by name', () => {
  const xml = [
    '<jsplugins>',
    '  <jspluginonline name="Other" type="wps" url="http://127.0.0.1:1/Other/"/>',
    `  ${buildPluginEntry(DEFAULT_PLUGIN_URL)}`,
    '</jsplugins>'
  ].join('\n');

  assert.deepEqual(extractPluginUrls(xml), [DEFAULT_PLUGIN_URL]);
});

test('extractHttpUrls finds localhost URLs in JavaScript', () => {
  const urls = extractHttpUrls("var url = 'http://127.0.0.1:17531/addin/taskpane.html';");
  assert.deepEqual(urls, ['http://127.0.0.1:17531/addin/taskpane.html']);
});

test('checkUrlConsistency passes when installed config matches bootstrap URLs', async () => {
  const dir = await makeInstalledConfig();
  try {
    const result = await checkUrlConsistency({ jsaddonsDir: dir });

    assert.equal(result.ok, true);
    assert.equal(result.failed, 0);
    assert.equal(result.expected.pluginUrl, DEFAULT_PLUGIN_URL);
    assert.equal(result.expected.taskpaneUrl, 'http://127.0.0.1:17531/addin/taskpane.html');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkUrlConsistency fails when installed config points to the wrong port', async () => {
  const dir = await makeInstalledConfig('http://127.0.0.1:18888/WpsAgentReviewer/');
  try {
    const result = await checkUrlConsistency({ jsaddonsDir: dir });

    assert.equal(result.ok, false);
    assert.ok(result.checks.some((item) => item.label === 'installed-jsplugins' && item.status === 'failed'));
    assert.ok(result.checks.some((item) => item.label === 'installed-publish' && item.status === 'failed'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkUrlConsistency accepts a custom installed port with portable public assets', async () => {
  const dir = await makeInstalledConfig('http://127.0.0.1:18888/WpsAgentReviewer/');
  try {
    const result = await checkUrlConsistency({
      jsaddonsDir: dir,
      pluginUrl: 'http://127.0.0.1:18888/WpsAgentReviewer/'
    });

    assert.equal(result.ok, true);
    assert.equal(result.failed, 0);
    assert.equal(result.checks.find((item) => item.label === 'public-jsplugins').status, 'passed');
    assert.equal(result.checks.find((item) => item.label === 'main-js-taskpane-url').portable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
