#!/usr/bin/env node
import { buildWindowsTaskArgs, installLaunchAgent, readLaunchAgentStatus, uninstallLaunchAgent } from '../src/install/launchAgent.mjs';

function parseArgs(argv) {
  const args = { command: argv[0] || 'status' };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--task-name' && argv[index + 1]) args.taskName = argv[++index];
    else if (key === '--dir' && argv[index + 1]) args.launchAgentsDir = argv[++index];
    else if (key === '--plist' && argv[index + 1]) args.plistPath = argv[++index];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const platform = process.platform;
let result;
if (args.command === 'status') {
  result = await readLaunchAgentStatus({ platform, taskName: args.taskName, plistPath: args.plistPath });
} else if (args.command === 'install') {
  result = await installLaunchAgent({
    platform,
    taskName: args.taskName,
    launchAgentsDir: args.launchAgentsDir,
    plistPath: args.plistPath
  });
} else if (args.command === 'uninstall') {
  result = await uninstallLaunchAgent({
    platform,
    taskName: args.taskName,
    plistPath: args.plistPath
  });
} else if (args.command === 'print' && platform === 'win32') {
  result = buildWindowsTaskArgs({ taskName: args.taskName });
} else {
  throw new Error(`Unknown autostart command: ${args.command}`);
}

console.log(JSON.stringify(result, null, 2));
if (result.ok === false) process.exitCode = 1;
