import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PLUGIN_NAME,
  DEFAULT_PLUGIN_URL,
  defaultMacJsaddonsDir
} from '../wps/pluginConfig.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function taskpaneUrlFromPluginUrl(pluginUrl) {
  return new URL('/addin/taskpane.html', pluginUrl).href;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function parseAttributes(text) {
  const attrs = {};
  const attrPattern = /([\w:-]+)\s*=\s*["']([^"']*)["']/g;
  let match = attrPattern.exec(text);
  while (match) {
    attrs[match[1]] = match[2];
    match = attrPattern.exec(text);
  }
  return attrs;
}

export function extractPluginUrls(xml, pluginName = DEFAULT_PLUGIN_NAME) {
  const urls = [];
  const pluginPattern = /<jspluginonline\b([^>]*)\/?>/g;
  let match = pluginPattern.exec(String(xml || ''));
  while (match) {
    const attrs = parseAttributes(match[1]);
    if (attrs.name === pluginName && attrs.url) {
      urls.push(attrs.url);
    }
    match = pluginPattern.exec(String(xml || ''));
  }
  return urls;
}

export function extractHttpUrls(text) {
  return Array.from(new Set(String(text || '').match(/https?:\/\/127\.0\.0\.1:\d+\/[^\s'"`)]*/g) || []));
}

function checkPluginFile(label, filePath, xml, expectedPluginUrl) {
  const urls = extractPluginUrls(xml);
  const ok = urls.includes(expectedPluginUrl);
  return {
    label,
    path: filePath,
    status: ok ? 'passed' : 'failed',
    urls,
    expected: expectedPluginUrl
  };
}

function checkPortableMainJs(filePath, source, expectedTaskpaneUrl) {
  const urls = extractHttpUrls(source);
  const portable = source.includes('__WPS_REVIEWER_TASKPANE_URL__');
  const ok = portable || urls.includes(expectedTaskpaneUrl);
  return {
    label: 'main-js-taskpane-url',
    path: filePath,
    status: ok ? 'passed' : 'failed',
    urls,
    expected: expectedTaskpaneUrl,
    portable
  };
}

function checkPortableConnector(filePath, source, expectedBridgeOrigin) {
  const urls = extractHttpUrls(source);
  const portable = source.includes('__WPS_REVIEWER_BRIDGE_ORIGIN__');
  const ok = portable || urls.includes(expectedBridgeOrigin);
  return {
    label: 'document-connector-bridge-origin',
    path: filePath,
    status: ok ? 'passed' : 'failed',
    urls,
    expected: expectedBridgeOrigin,
    portable
  };
}

export async function checkUrlConsistency({
  jsaddonsDir = defaultMacJsaddonsDir(),
  pluginUrl = DEFAULT_PLUGIN_URL,
  projectRoot = PROJECT_ROOT
} = {}) {
  const expectedTaskpaneUrl = taskpaneUrlFromPluginUrl(pluginUrl);
  const paths = {
    publicConfig: path.join(projectRoot, 'public/jsplugins.xml'),
    installedConfig: path.join(jsaddonsDir, 'jsplugins.xml'),
    installedPublish: path.join(jsaddonsDir, 'publish.xml'),
    mainJs: path.join(projectRoot, 'public/WpsAgentReviewer/main.js'),
    documentConnector: path.join(projectRoot, 'public/WpsAgentReviewer/document-connector.js')
  };

  const publicConfig = await readOptional(paths.publicConfig);
  const installedConfig = await readOptional(paths.installedConfig);
  const installedPublish = await readOptional(paths.installedPublish);
  const mainJs = await readOptional(paths.mainJs);

  const checks = [
    // public/jsplugins.xml is the default-port bootstrap template; the installed
    // user config is the source of truth for a custom port.
    checkPluginFile('public-jsplugins', paths.publicConfig, publicConfig, DEFAULT_PLUGIN_URL),
    checkPluginFile('installed-jsplugins', paths.installedConfig, installedConfig, pluginUrl),
    checkPluginFile('installed-publish', paths.installedPublish, installedPublish, pluginUrl)
  ];

  checks.push(checkPortableMainJs(paths.mainJs, mainJs, expectedTaskpaneUrl));
  checks.push(checkPortableConnector(
    paths.documentConnector,
    await readOptional(paths.documentConnector),
    new URL(pluginUrl).origin
  ));

  const failed = checks.filter((item) => item.status !== 'passed');

  return {
    ok: failed.length === 0,
    expected: {
      pluginUrl,
      taskpaneUrl: expectedTaskpaneUrl
    },
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks
  };
}
