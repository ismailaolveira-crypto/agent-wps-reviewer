import { statusBridge } from '../bridge/processControl.mjs';
import { loadManualEvidence } from './manualEvidence.mjs';
import { defaultJsaddonsDir, readPluginConfigStatus } from '../wps/pluginConfig.mjs';

function pluginStatusLabel(plugin, platform = process.platform) {
  return plugin.installed && plugin.publishExists && (platform === 'win32' || plugin.exists) ? 'installed' : 'missing';
}

function bridgeStatusLabel(bridge) {
  if (bridge.running && bridge.health?.ok) return 'running';
  if (bridge.running) return 'unhealthy';
  return 'stopped';
}

function isBackgroundReady(pluginConfig, bridge, platform = process.platform) {
  return pluginConfig.installed === true && pluginConfig.publishExists === true && (platform === 'win32' || pluginConfig.exists === true) && bridge.running === true && bridge.health?.ok === true;
}

function nextCommandFor({ pluginConfig, bridge, manualEvidence, platform }) {
  if (!isBackgroundReady(pluginConfig, bridge, platform)) return 'npm run acceptance:prepare';
  if (!manualEvidence.ok) return 'npm run acceptance:wait';
  return 'npm run acceptance:audit';
}

export async function getAcceptanceStatus({
  jsaddonsDir = undefined,
  bridgeOptions = {},
  manualEvidenceFile = undefined,
  acceptanceEventStorePath = undefined,
  platform = process.platform
} = {}) {
  const [pluginConfig, bridge, manualEvidence] = await Promise.all([
    readPluginConfigStatus({ jsaddonsDir: jsaddonsDir || defaultJsaddonsDir({ platform }) }),
    statusBridge({ ...bridgeOptions, platform }),
    loadManualEvidence({
      filePath: manualEvidenceFile,
      acceptanceEventStorePath
    })
  ]);

  const backgroundReady = isBackgroundReady(pluginConfig, bridge, platform);
  const foregroundReady = manualEvidence.ok === true;
  const accepted = backgroundReady && foregroundReady;

  return {
    ok: backgroundReady && foregroundReady,
    accepted,
    backgroundReady,
    foregroundReady,
    nextCommand: nextCommandFor({ pluginConfig, bridge, manualEvidence, platform }),
    checks: {
      pluginConfig: {
        status: pluginStatusLabel(pluginConfig, platform),
        ...pluginConfig
      },
      bridge: {
        status: bridgeStatusLabel(bridge),
        ...bridge
      },
      manualEvidence: {
        status: manualEvidence.status,
        ok: manualEvidence.ok,
        filePath: manualEvidence.filePath,
        errors: manualEvidence.errors,
        checks: manualEvidence.checks
      }
    }
  };
}
