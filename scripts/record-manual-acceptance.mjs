#!/usr/bin/env node
import { writeManualEvidence } from '../src/acceptance/manualEvidence.mjs';

function parseArgs(argv) {
  const args = { taskpaneProofFiles: [], mutationProofFiles: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (name === 'taskpane-proof') {
      args.taskpaneProofFiles.push(value);
      i += 1;
      continue;
    }
    if (name === 'mutation-proof') {
      args.mutationProofFiles.push(value);
      i += 1;
      continue;
    }
    args[name] = value;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

try {
  const result = await writeManualEvidence({
    filePath: args.file,
    wpsVersion: args['wps-version'],
    documentPath: args.document,
    bridgeUrl: args.bridge,
    platform: args.platform || process.platform,
    osVersion: args['os-version'],
    osArch: args['os-arch'],
    wpsArch: args['wps-arch'],
    runtimeInstanceId: args['runtime-instance-id'],
    taskpaneEvidence: args['taskpane-evidence'],
    mutationEvidence: args['mutation-evidence'],
    taskpaneProofFiles: args.taskpaneProofFiles,
    mutationProofFiles: args.mutationProofFiles
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        details: error.details || []
      },
      null,
      2
    )
  );
  process.exit(1);
}
