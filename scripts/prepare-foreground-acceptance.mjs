#!/usr/bin/env node
import { prepareForegroundAcceptance } from '../src/acceptance/foregroundPrep.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'no-backup') {
      args.backup = false;
      continue;
    }
    if (name === 'no-url-consistency') {
      args.checkInstalledUrls = false;
      continue;
    }
    args[name] = argv[index + 1];
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await prepareForegroundAcceptance({
  host: args.host,
  port: args.port ? Number(args.port) : undefined,
  jsaddonsDir: args.dir,
  kitOutputDir: args['kit-output-dir'],
  sampleSuggestionPath: args.sample,
  backup: args.backup !== false,
  checkInstalledUrls: args.checkInstalledUrls !== false,
  token: args.token || process.env.WPS_REVIEWER_TOKEN || ''
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
