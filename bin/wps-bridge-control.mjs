#!/usr/bin/env node
import { startBridge, statusBridge, stopBridge } from '../src/bridge/processControl.mjs';

function parseArgs(argv) {
  const args = { command: argv[0] || 'status' };
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  wps-bridge-control status [--port 17531]
  wps-bridge-control start [--port 17531]
  wps-bridge-control stop [--port 17531]
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'help' || args.command === '--help') {
  printHelp();
  process.exit(0);
}

const options = {
  port: args.port ? Number(args.port) : undefined,
  runtimeDir: args['runtime-dir'],
  dataDir: args['data-dir'],
  pidFile: args['pid-file'],
  logFile: args['log-file']
};

let result;
if (args.command === 'status') {
  result = await statusBridge(options);
} else if (args.command === 'start') {
  result = await startBridge(options);
} else if (args.command === 'stop') {
  result = await stopBridge(options);
} else {
  console.error(`Unknown command: ${args.command}`);
  printHelp();
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
