#!/usr/bin/env node
import { runAcceptanceAudit } from '../src/acceptance/audit.mjs';

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
const audit = await runAcceptanceAudit({
  manualEvidenceFile: args.file,
  acceptanceEventStorePath: args.store,
  noviceInstallEvidenceFile: args['novice-install-file'],
  platform: args.platform || process.platform
});
console.log(JSON.stringify(audit, null, 2));

if (!audit.ok) {
  process.exitCode = 1;
}
