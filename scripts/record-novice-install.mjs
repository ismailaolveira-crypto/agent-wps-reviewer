#!/usr/bin/env node
import { writeNoviceInstallEvidence } from '../src/acceptance/noviceInstallEvidence.mjs';

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

try {
  const result = await writeNoviceInstallEvidence({
    filePath: args.file,
    stepsFile: args['steps-file'],
    releaseSha256: args['release-sha256'],
    osVersion: args['os-version'],
    osArch: args['os-arch'],
    wpsArch: args['wps-arch'],
    runtimeInstanceId: args['runtime-instance-id'],
    operator: args.operator,
    independentReviewer: args['independent-reviewer'] === 'true',
    unassisted: args.unassisted === 'true',
    standardUser: args['standard-user'] === 'true',
    administrator: args.administrator !== 'false',
    wpsTrusted: args['wps-trusted'] === 'true',
    mcpClient: args['mcp-client']
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    details: error?.details || null
  }, null, 2));
  process.exitCode = 1;
}
