#!/usr/bin/env node
import { getAcceptanceStatus } from '../src/acceptance/status.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await getAcceptanceStatus({
  jsaddonsDir: args.dir,
  manualEvidenceFile: args.file,
  acceptanceEventStorePath: args.store,
  bridgeOptions: {
    port: args.port ? Number(args.port) : undefined,
    runtimeDir: args['runtime-dir'],
    dataDir: args['data-dir'],
    pidFile: args['pid-file'],
    logFile: args['log-file']
  }
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = result.accepted ? 0 : 1;
}
