#!/usr/bin/env node
import { waitForManualAcceptance } from '../src/acceptance/manualEvidence.mjs';

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
const result = await waitForManualAcceptance({
  manualEvidenceFile: args.file,
  acceptanceEventStorePath: args.store,
  timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
  intervalMs: args['interval-ms'] ? Number(args['interval-ms']) : undefined
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
