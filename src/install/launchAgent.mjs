import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultProductFilesDir, defaultProductRuntimeDir, quoteWindowsArgument } from '../platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DEFAULT_LAUNCH_AGENT_LABEL = 'com.agent-wps-reviewer.bridge';
export const DEFAULT_LAUNCH_AGENT_FILENAME = `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`;
export const DEFAULT_WINDOWS_TASK_NAME = 'Agent WPS Reviewer Bridge';

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

function defaultWindowsTaskRunner(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return {
    code: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error || null
  };
}

export function buildWindowsTaskArgs({
  taskName = DEFAULT_WINDOWS_TASK_NAME,
  nodePath = process.execPath,
  projectRoot = PROJECT_ROOT,
  host = '127.0.0.1',
  port = 17531,
  dataDir,
  pidFile,
  tokenPath = '',
  env = process.env
} = {}) {
  const resolvedDataDir = dataDir || (process.platform === 'win32'
    ? defaultProductFilesDir({ platform: 'win32', env })
    : path.join(projectRoot, 'data'));
  const resolvedPidFile = pidFile || (process.platform === 'win32'
    ? path.join(defaultProductRuntimeDir({ platform: 'win32', env }), 'bridge.pid')
    : path.join(resolvedDataDir, 'runtime/bridge.pid'));
  const controlPath = path.join(projectRoot, 'bin/wps-bridge-control.mjs');
  const commandArgs = [
    'start',
    '--host', host,
    '--port', port,
    '--data-dir', resolvedDataDir,
    '--pid-file', resolvedPidFile
  ];
  if (tokenPath) commandArgs.push('--agent-token-file', tokenPath);
  const command = [quoteWindowsArgument(nodePath), quoteWindowsArgument(controlPath), ...commandArgs.map(quoteWindowsArgument)].join(' ');
  const taskCommand = `cmd.exe /d /s /c "${command}"`;
  return {
    create: ['/Create', '/TN', taskName, '/TR', taskCommand, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'],
    query: ['/Query', '/TN', taskName, '/FO', 'CSV', '/NH'],
    delete: ['/Delete', '/TN', taskName, '/F'],
    taskName,
    command: taskCommand
  };
}

function parseWindowsTaskStatus(result, taskName) {
  const exists = result.error?.code !== 'ENOENT' && result.code === 0;
  return {
    exists,
    taskName,
    checked: true,
    status: exists ? 'ready' : 'missing',
    error: exists ? undefined : String(result.stderr || result.error?.message || '').trim() || undefined
  };
}

async function readWindowsTaskStatus({ taskName = DEFAULT_WINDOWS_TASK_NAME, taskRunner = defaultWindowsTaskRunner } = {}) {
  return parseWindowsTaskStatus(await taskRunner('schtasks.exe', buildWindowsTaskArgs({ taskName }).query), taskName);
}

async function installWindowsTask({
  taskName = DEFAULT_WINDOWS_TASK_NAME,
  taskRunner = defaultWindowsTaskRunner,
  ...options
} = {}) {
  const args = buildWindowsTaskArgs({ taskName, ...options });
  const result = await taskRunner('schtasks.exe', args.create);
  const status = await readWindowsTaskStatus({ taskName, taskRunner });
  return {
    ok: result.error == null && result.code === 0 && status.exists,
    loaded: false,
    platform: 'win32',
    taskName,
    status,
    command: args.command,
    rollback: async () => {
      await taskRunner('schtasks.exe', args.delete);
    }
  };
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
  platform = process.platform,
  plistPath,
  taskName = DEFAULT_WINDOWS_TASK_NAME,
  taskRunner = defaultWindowsTaskRunner
} = {}) {
  if (platform === 'win32') return readWindowsTaskStatus({ taskName, taskRunner });
  const resolvedPlistPath = plistPath || defaultLaunchAgentPath();
  if (!existsSync(resolvedPlistPath)) {
    return {
      exists: false,
      plistPath: resolvedPlistPath,
      label: null,
      bytes: 0,
      containsLaunchctlInstruction: false
    };
  }

  const plistText = await readFile(resolvedPlistPath, 'utf8');
  return {
    exists: true,
    plistPath: resolvedPlistPath,
    label: extractLabel(plistText),
    bytes: Buffer.byteLength(plistText),
    containsLaunchctlInstruction: plistText.includes('launchctl')
  };
}

export async function installLaunchAgent({
  platform = process.platform,
  launchAgentsDir,
  plistPath,
  label = DEFAULT_LAUNCH_AGENT_LABEL,
  nodePath = process.execPath,
  projectRoot = PROJECT_ROOT,
  host = '127.0.0.1',
  port = 17531,
  dataDir,
  pidFile,
  stdoutPath = path.join(projectRoot, 'data/runtime/launch-agent.out.log'),
  stderrPath = path.join(projectRoot, 'data/runtime/launch-agent.err.log'),
  agentToken = '',
  agentTokenPath = '',
  taskName = DEFAULT_WINDOWS_TASK_NAME,
  env = process.env,
  taskRunner = defaultWindowsTaskRunner
} = {}) {
  const resolvedDataDir = dataDir || (platform === 'win32'
    ? defaultProductFilesDir({ platform, env })
    : path.join(projectRoot, 'data'));
  const resolvedPidFile = pidFile || (platform === 'win32'
    ? path.join(defaultProductRuntimeDir({ platform, env }), 'bridge.pid')
    : path.join(resolvedDataDir, 'runtime/bridge.pid'));
  if (platform === 'win32') {
    return installWindowsTask({
      taskName,
      taskRunner,
      nodePath,
      projectRoot,
      host,
      port,
      dataDir: resolvedDataDir,
      pidFile: resolvedPidFile,
      tokenPath: agentTokenPath,
      env
    });
  }
  const resolvedLaunchAgentsDir = launchAgentsDir || defaultLaunchAgentsDir();
  const resolvedPlistPath = plistPath || defaultLaunchAgentPath({ launchAgentsDir: resolvedLaunchAgentsDir, label });
  let previousPlist = null;
  try {
    previousPlist = await readFile(resolvedPlistPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(resolvedPlistPath), { recursive: true });
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  await mkdir(resolvedDataDir, { recursive: true });

  const plist = buildLaunchAgentPlist({
    label,
    nodePath,
    projectRoot,
    host,
    port,
    dataDir: resolvedDataDir,
    pidFile: resolvedPidFile,
    stdoutPath,
    stderrPath,
    agentToken,
    agentTokenPath
  });
  await writeFile(resolvedPlistPath, plist, 'utf8');
  const status = await readLaunchAgentStatus({ plistPath: resolvedPlistPath });

  return {
    ok: status.exists === true && status.label === label,
    loaded: false,
    plistPath: resolvedPlistPath,
    launchAgentsDir: resolvedLaunchAgentsDir,
    status,
    rollback: async () => {
      if (previousPlist === null) await rm(resolvedPlistPath, { force: true });
      else await writeFile(resolvedPlistPath, previousPlist, 'utf8');
    }
  };
}

export async function uninstallLaunchAgent({
  platform = process.platform,
  plistPath,
  taskName = DEFAULT_WINDOWS_TASK_NAME,
  taskRunner = defaultWindowsTaskRunner
} = {}) {
  if (platform === 'win32') {
    const args = buildWindowsTaskArgs({ taskName });
    const result = await taskRunner('schtasks.exe', args.delete);
    const status = await readWindowsTaskStatus({ taskName, taskRunner });
    return { ok: result.error == null && (result.code === 0 || !status.exists), loaded: false, platform, taskName, status };
  }
  const resolvedPlistPath = plistPath || defaultLaunchAgentPath();
  await rm(resolvedPlistPath, { force: true });
  const status = await readLaunchAgentStatus({ plistPath: resolvedPlistPath });
  return {
    ok: status.exists === false,
    loaded: false,
    plistPath: resolvedPlistPath,
    status
  };
}
