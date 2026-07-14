#!/usr/bin/env node
import path from 'node:path';
import {
  buildLaunchAgentPlist,
  defaultLaunchAgentPath,
  defaultLaunchAgentsDir,
  installLaunchAgent,
  readLaunchAgentStatus,
  uninstallLaunchAgent
} from '../src/install/launchAgent.mjs';

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function resolveOptions(flags) {
  const launchAgentsDir = flags.dir || defaultLaunchAgentsDir();
  const label = flags.label;
  const plistPath = flags.plist || defaultLaunchAgentPath({ launchAgentsDir, label });
  const projectRoot = flags['project-root'] ? path.resolve(flags['project-root']) : undefined;
  return {
    launchAgentsDir,
    plistPath,
    label,
    projectRoot,
    nodePath: flags.node,
    host: flags.host,
    port: flags.port ? Number(flags.port) : undefined,
    dataDir: flags['data-dir'],
    stdoutPath: flags.stdout,
    stderrPath: flags.stderr,
    agentToken: flags.token || process.env.WPS_REVIEWER_TOKEN || '',
    agentTokenPath: flags['token-file'] || process.env.WPS_REVIEWER_TOKEN_FILE || ''
  };
}

const { command, flags } = parseArgs(process.argv.slice(2));
const options = resolveOptions(flags);

if (command === 'install') {
  const result = await installLaunchAgent(options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === 'status') {
  const result = await readLaunchAgentStatus({ plistPath: options.plistPath });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'uninstall') {
  const result = await uninstallLaunchAgent({ plistPath: options.plistPath });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === 'print') {
  console.log(buildLaunchAgentPlist(options));
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node scripts/install-launch-agent.mjs [status|install|uninstall|print] [--dir DIR] [--plist FILE]');
  process.exitCode = 2;
}
