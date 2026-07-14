import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DEFAULT_LAUNCH_AGENT_LABEL = 'com.agent-wps-reviewer.bridge';
export const DEFAULT_LAUNCH_AGENT_FILENAME = `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`;

export function defaultLaunchAgentsDir(homeDir = process.env.HOME) {
  if (!homeDir) {
    throw new Error('HOME is not set; pass launchAgentsDir explicitly.');
  }
  return path.join(homeDir, 'Library/LaunchAgents');
}

export function defaultLaunchAgentPath({
  launchAgentsDir = defaultLaunchAgentsDir(),
  label = DEFAULT_LAUNCH_AGENT_LABEL
} = {}) {
  return path.join(launchAgentsDir, `${label}.plist`);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function envEntry(key, value) {
  return `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`;
}

export function buildLaunchAgentPlist({
  label = DEFAULT_LAUNCH_AGENT_LABEL,
  nodePath = process.execPath,
  projectRoot = PROJECT_ROOT,
  host = '127.0.0.1',
  port = 17531,
  dataDir = path.join(projectRoot, 'data'),
  pidFile = path.join(dataDir, 'runtime/bridge.pid'),
  stdoutPath = path.join(projectRoot, 'data/runtime/launch-agent.out.log'),
  stderrPath = path.join(projectRoot, 'data/runtime/launch-agent.err.log'),
  agentToken = '',
  agentTokenPath = ''
} = {}) {
  const environment = [
    envEntry('HOST', host),
    envEntry('PORT', String(port)),
    envEntry('DATA_DIR', dataDir),
    envEntry('WPS_REVIEWER_PID_FILE', pidFile)
  ];
  if (agentToken) {
    environment.push(envEntry('WPS_REVIEWER_AGENT_TOKEN', agentToken));
  }
  if (agentTokenPath) {
    environment.push(envEntry('WPS_REVIEWER_AGENT_TOKEN_FILE', agentTokenPath));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>src/bridge/server.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environment.join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function extractLabel(plistText) {
  const match = plistText.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/);
  return match?.[1] ? match[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&') : null;
}

export async function readLaunchAgentStatus({
  plistPath = defaultLaunchAgentPath()
} = {}) {
  if (!existsSync(plistPath)) {
    return {
      exists: false,
      plistPath,
      label: null,
      bytes: 0,
      containsLaunchctlInstruction: false
    };
  }

  const plistText = await readFile(plistPath, 'utf8');
  return {
    exists: true,
    plistPath,
    label: extractLabel(plistText),
    bytes: Buffer.byteLength(plistText),
    containsLaunchctlInstruction: plistText.includes('launchctl')
  };
}

export async function installLaunchAgent({
  launchAgentsDir = defaultLaunchAgentsDir(),
  plistPath = defaultLaunchAgentPath({ launchAgentsDir }),
  label = DEFAULT_LAUNCH_AGENT_LABEL,
  nodePath = process.execPath,
  projectRoot = PROJECT_ROOT,
  host = '127.0.0.1',
  port = 17531,
  dataDir = path.join(projectRoot, 'data'),
  pidFile = path.join(dataDir, 'runtime/bridge.pid'),
  stdoutPath = path.join(projectRoot, 'data/runtime/launch-agent.out.log'),
  stderrPath = path.join(projectRoot, 'data/runtime/launch-agent.err.log'),
  agentToken = '',
  agentTokenPath = ''
} = {}) {
  let previousPlist = null;
  try {
    previousPlist = await readFile(plistPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(plistPath), { recursive: true });
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const plist = buildLaunchAgentPlist({
    label,
    nodePath,
    projectRoot,
    host,
    port,
    dataDir,
    pidFile,
    stdoutPath,
    stderrPath,
    agentToken,
    agentTokenPath
  });
  await writeFile(plistPath, plist, 'utf8');
  const status = await readLaunchAgentStatus({ plistPath });

  return {
    ok: status.exists === true && status.label === label,
    loaded: false,
    plistPath,
    launchAgentsDir,
    status,
    rollback: async () => {
      if (previousPlist === null) await rm(plistPath, { force: true });
      else await writeFile(plistPath, previousPlist, 'utf8');
    }
  };
}

export async function uninstallLaunchAgent({
  plistPath = defaultLaunchAgentPath()
} = {}) {
  await rm(plistPath, { force: true });
  const status = await readLaunchAgentStatus({ plistPath });
  return {
    ok: status.exists === false,
    loaded: false,
    plistPath,
    status
  };
}
