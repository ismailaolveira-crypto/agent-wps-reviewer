import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAcceptanceKit } from './kit.mjs';
import { installLocalProduct } from '../install/localInstall.mjs';
import { statusBridge } from '../bridge/processControl.mjs';
import { readAgentToken } from '../install/agentToken.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

async function submitSampleSuggestion({ baseUrl, sampleSuggestionPath, token = '' }) {
  const payload = JSON.parse(await readFile(sampleSuggestionPath, 'utf8'));
  const response = await fetch(new URL('/api/suggestions', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}`, 'x-wps-reviewer-token': token } : {})
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `Failed to submit sample suggestion: ${response.status}`);
    error.details = body.error?.details || [];
    throw error;
  }
  return body;
}

export async function prepareForegroundAcceptance({
  host = '127.0.0.1',
  port = 17531,
  jsaddonsDir = undefined,
  kitOutputDir = path.join(PROJECT_ROOT, 'output/acceptance-kit'),
  sampleSuggestionPath = path.join(PROJECT_ROOT, 'examples/development-legacy-suggestion.json'),
  bridgeOptions = {},
  backup = true,
  checkInstalledUrls = true,
  token = process.env.WPS_REVIEWER_TOKEN || ''
} = {}) {
  const kit = await createAcceptanceKit({
    outputDir: kitOutputDir,
    sampleSuggestionPath
  });
  const installer = await installLocalProduct({
    host,
    port,
    jsaddonsDir,
    backup,
    startBridgeAfterInstall: true,
    runReadiness: true,
    checkInstalledUrls,
    installSkill: false,
    bridgeOptions: { ...bridgeOptions, allowLegacySubmission: true }
  });
  const baseUrl = `http://${host}:${port}`;
  const installerToken = await readAgentToken({ tokenPath: installer.agentToken.tokenPath });
  const sample = await submitSampleSuggestion({
    baseUrl,
    sampleSuggestionPath: kit.payloadPath,
    token: token || installerToken || ''
  });
  const bridge = await statusBridge({ ...bridgeOptions, host, port });

  return {
    ok:
      kit.ok === true &&
      installer.ok === true &&
      bridge.running === true &&
      bridge.health?.ok === true &&
      Array.isArray(sample.suggestions) &&
      sample.suggestions.length > 0,
    baseUrl,
    pluginUrl: installer.pluginUrl,
    kit,
    installer,
    bridge,
    sample,
    nextSteps: [
      'Use an allowed foreground WPS test window.',
      'Open output/acceptance-kit/wps-reviewer-acceptance.docx in WPS.',
      'Open Agent 审阅 -> 审阅收件箱.',
      'Click 定位, then 接受; verify a true WPS comment is created and body text is unchanged.',
      'Run npm run acceptance:wait and npm run acceptance:audit.'
    ]
  };
}
