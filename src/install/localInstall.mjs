import { installPluginConfig, DEFAULT_PLUGIN_URL, defaultJsaddonsDir } from '../wps/pluginConfig.mjs';
import { authorizePluginAuthFile } from '../wps/pluginAuth.mjs';
import { startBridge, statusBridge, stopBridge } from '../bridge/processControl.mjs';
import { smokeWpsResourcesAtBaseUrl } from '../acceptance/resourceSmoke.mjs';
import { checkUrlConsistency } from '../acceptance/urlConsistency.mjs';
import { validateDefaultPortReadiness } from '../acceptance/defaultPortReadiness.mjs';
import { installProductionSkills } from './skillInstall.mjs';
import { checkMcpServer } from './mcpHealth.mjs';
import { ensureAgentToken } from './agentToken.mjs';
import { installMcpClients } from './mcpConfig.mjs';
import { installLaunchAgent } from './launchAgent.mjs';
import { defaultProductDataDir, defaultProductFilesDir, defaultProductRuntimeDir } from '../platform.mjs';
import path from 'node:path';

function withoutTransactionHooks(value) {
  if (!value || typeof value !== 'object') return value;
  const { rollback, cleanup, ...publicValue } = value;
  return publicValue;
}

function pluginUrlFor({ host, port }) {
  return `http://${host}:${port}/WpsAgentReviewer/`;
}

export async function installLocalProduct({
  platform = process.platform,
  host = '127.0.0.1',
  port = 17531,
  configMode = platform === 'win32' ? 'publish' : 'legacy',
  pluginUrl = port === 17531 && host === '127.0.0.1' ? DEFAULT_PLUGIN_URL : pluginUrlFor({ host, port }),
  jsaddonsDir = undefined,
  backup = true,
  startBridgeAfterInstall = false,
  runReadiness = true,
  checkInstalledUrls = true,
  installSkill = true,
  configureMcp = false,
  mcpOptions = {},
  skillTargetRoots = undefined,
  bridgeOptions = {},
  configureAutostart = undefined,
  configureLaunchAgent = false,
  launchAgentOptions = {}
} = {}) {
  const resolvedJsaddonsDir = jsaddonsDir || defaultJsaddonsDir({ platform });
  let config;
  let authorization;
  let skillTransaction;
  let agentToken;
  let mcpConfig;
  let launchAgent;
  let bridge;
  let readiness = null;
  let bridgeStartedByInstall = false;
  const rollbackActions = [];
  const shouldConfigureAutostart = configureAutostart ?? configureLaunchAgent;

  try {
    config = await installPluginConfig({
      jsaddonsDir: resolvedJsaddonsDir,
      pluginUrl,
      backup,
      platform,
      mode: configMode
    });
    rollbackActions.push(config.rollback);

    authorization = await authorizePluginAuthFile({
      jsaddonsDir: resolvedJsaddonsDir,
      pluginUrl,
      platform
    });
    rollbackActions.push(authorization.rollback);

    skillTransaction = installSkill
      ? await installProductionSkills(
        skillTargetRoots
          ? { targetRoots: skillTargetRoots, backup, deferCleanup: true }
          : { backup, deferCleanup: true }
      )
      : {
        ok: true,
        skipped: true,
        installations: [],
        rollback: async () => {},
        cleanup: async () => {}
      };
    rollbackActions.push(skillTransaction.rollback);

    agentToken = await ensureAgentToken({
      tokenPath: bridgeOptions.agentTokenPath || path.join(defaultProductDataDir({ platform }), 'agent-token'),
      platform
    });
    rollbackActions.push(agentToken.rollback);
    const securedBridgeOptions = {
      ...bridgeOptions,
      agentTokenPath: agentToken.tokenPath,
      platform
    };

    bridge = await statusBridge({ ...securedBridgeOptions, host, port });

    if (startBridgeAfterInstall) {
      bridge = await startBridge({ ...securedBridgeOptions, host, port });
      bridgeStartedByInstall = bridge.changed === true;
      const baseUrl = `http://${host}:${port}`;
      const resources = await smokeWpsResourcesAtBaseUrl(baseUrl);
      const mcp = await checkMcpServer({ serverUrl: baseUrl, tokenPath: agentToken.tokenPath });
      const urlConsistency = checkInstalledUrls
        ? await checkUrlConsistency({ jsaddonsDir: resolvedJsaddonsDir, pluginUrl, platform })
        : { ok: true, skipped: true };
      readiness = {
        ok: bridge.running === true && resources.ok === true && mcp.ok === true && urlConsistency.ok === true,
        mode: 'persistent-bridge',
        baseUrl,
        resources,
        mcp,
        urlConsistency
      };
    } else if (runReadiness) {
      readiness = await validateDefaultPortReadiness({
        ...securedBridgeOptions,
        host,
        port,
        jsaddonsDir: resolvedJsaddonsDir,
        pluginUrl,
        checkInstalledUrls
      });
    }

    if (readiness && readiness.ok !== true) {
      const error = new Error('Local product readiness failed; installation was rolled back.');
      error.code = 'INSTALL_READINESS_FAILED';
      error.details = readiness;
      throw error;
    }

    mcpConfig = configureMcp
      ? await installMcpClients({
        tokenPath: agentToken.tokenPath,
        mcpPath: mcpOptions.mcpPath,
        nodePath: mcpOptions.nodePath,
        cliPaths: mcpOptions.cliPaths,
        env: mcpOptions.env,
        cwd: mcpOptions.cwd,
        runner: mcpOptions.runner,
        platform
      })
      : { ok: true, skipped: true, reason: 'not-requested', clients: [], rollback: async () => {} };
    if (!mcpConfig.ok) {
      const error = new Error('MCP configuration failed; installation was rolled back.');
      error.code = 'MCP_CONFIG_FAILED';
      error.details = mcpConfig;
      throw error;
    }

    if (readiness) readiness = { ...readiness, mcpConfig, ok: readiness.ok === true && mcpConfig.ok === true };

    if (shouldConfigureAutostart) {
      const launchDataDir = launchAgentOptions.dataDir || bridgeOptions.dataDir || (platform === 'win32'
        ? defaultProductFilesDir({ platform })
        : path.join(process.cwd(), 'data'));
      const launchPidFile = launchAgentOptions.pidFile || bridgeOptions.pidFile || (platform === 'win32'
        ? path.join(defaultProductRuntimeDir({ platform }), 'bridge.pid')
        : path.join(launchDataDir, 'runtime/bridge.pid'));
      launchAgent = await installLaunchAgent({
        ...launchAgentOptions,
        platform,
        host,
        port,
        dataDir: launchDataDir,
        pidFile: launchPidFile,
        agentToken: '',
        agentTokenPath: agentToken.tokenPath
      });
      if (launchAgent.ok !== true) {
        const error = new Error('LaunchAgent configuration failed; installation was rolled back.');
        error.code = 'LAUNCH_AGENT_CONFIG_FAILED';
        throw error;
      }
      rollbackActions.push(launchAgent.rollback);
    }
    await skillTransaction.cleanup();

    const wpsTrustPending = platform === 'win32' && authorization.trustPending === true;
    const baseOk = config.installed === true && authorization.authorized !== false && skillTransaction.ok === true && (!readiness || readiness.ok === true);

    return {
      ok: baseOk,
      ready: baseOk && !wpsTrustPending,
      productionReady: false,
      wpsTrustPending,
      wpsTrusted: authorization.wpsTrusted === true,
      installed: true,
      platform,
      pluginUrl,
      config: withoutTransactionHooks(config),
      authorization: withoutTransactionHooks(authorization),
      skill: withoutTransactionHooks(skillTransaction),
      agentToken: {
        tokenPath: agentToken.tokenPath,
        created: agentToken.created,
        fileMode: agentToken.fileMode,
        directoryMode: agentToken.directoryMode
      },
      mcpConfig: withoutTransactionHooks(mcpConfig),
      launchAgent: launchAgent ? withoutTransactionHooks(launchAgent) : { ok: true, skipped: true },
      autostart: launchAgent ? withoutTransactionHooks(launchAgent) : { ok: true, skipped: true },
      bridge,
      readiness,
      nextManualSteps: [
        'Restart WPS during an allowed test window if the Agent 审阅 tab is not visible.',
        'Ask the Agent to invoke whitepaper-chief-editor before reviewing a document.',
        'Approve selected candidates, then verify locate/comment actions in the WPS side pane.'
      ]
    };
  } catch (error) {
    if (bridgeStartedByInstall) {
      await stopBridge({ ...bridgeOptions, host, port, platform }).catch(() => undefined);
    }
    if (mcpConfig?.rollback) await mcpConfig.rollback().catch(() => undefined);
    for (const rollback of [...rollbackActions].reverse()) {
      if (typeof rollback === 'function') await rollback().catch(() => undefined);
    }
    throw error;
  }
}
