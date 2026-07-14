#!/usr/bin/env node
import { runWpsDiagnostics } from '../src/wps/diagnostics.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'no-bridge') {
      args.checkBridge = false;
      continue;
    }
    if (name === 'no-process') {
      args.checkProcess = false;
      continue;
    }
    args[name] = argv[i + 1];
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await runWpsDiagnostics({
  jsaddonsDir: args.dir,
  wpsAppPath: args['wps-app'],
  bridgeUrl: args.bridge,
  checkBridge: args.checkBridge !== false,
  checkProcess: args.checkProcess !== false
});

console.log(JSON.stringify(result, null, 2));
