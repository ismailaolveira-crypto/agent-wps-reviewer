import { statusBridge } from '../bridge/processControl.mjs';
import { loadManualEvidence } from './manualEvidence.mjs';
import { readPluginConfigStatus } from '../wps/pluginConfig.mjs';

function pluginStatusLabel(plugin) {
  return plugin.installed && plugin.exists && plugin.publishExists ? 'installed' : 'missing';
}

function bridgeStatusLabel(bridge) {
  if (bridge.running && bridge.health?.ok) return 'running';
  if (bridge.running) return 'unhealthy';
  return 'stopped';
}

function isBackgroundReady(pluginConfig, bridge) {
  return pluginConfig.installed === true && bridge.running === true && bridge.health?.ok === true;
}

function nextCommandFor({ pluginConfig, bridge, manualEvidence }) {
  if (!isBackgroundReady(pluginConfig, bridge)) return 'npm run acceptance:prepare';
  if (!manualEvidence.ok) return 'npm run acceptance:wait';
  return 'npm run acceptance:audit';
}

export async function getAcceptanceStatus({
  jsaddonsDir = undefined,
  bridgeOptions = {},
  manualEvidenceFile = undefined,
  acceptanceEventStorePath = undefined
} = {}) {
  const [pluginConfig, bridge, manualEvidence] = await Promise.all([
    readPluginConfigStatus({ jsaddonsDir }),
    statusBridge(bridgeOptions),
    loadManualEvidence({
      filePath: manualEvidenceFile,
      acceptanceEventStorePath
    })
  ]);

  const backgroundReady = isBackgroundReady(pluginConfig, bridge);
  const foregroundReady = manualEvidence.ok === true;
  const accepted = backgroundReady && foregroundReady;

  return {
    ok: backgroundReady && foregroundReady,
    accepted,
    backgroundReady,
    foregroundReady,
    nextCommand: nextCommandFor({ pluginConfig, bridge, manualEvidence }),
    checks: {
      pluginConfig: {
        status: pluginStatusLabel(pluginConfig),
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
