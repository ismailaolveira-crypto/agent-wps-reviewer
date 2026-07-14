#!/usr/bin/env node
import { loadManualEvidence } from '../src/acceptance/manualEvidence.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await loadManualEvidence({ filePath: args.file });
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
