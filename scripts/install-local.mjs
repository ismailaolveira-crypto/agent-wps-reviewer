#!/usr/bin/env node
import { installLocalProduct } from '../src/install/localInstall.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'start-bridge') {
      args.startBridgeAfterInstall = true;
      continue;
    }
    if (name === 'no-readiness') {
      args.runReadiness = false;
      continue;
    }
    if (name === 'no-backup') {
      args.backup = false;
      continue;
    }
    if (name === 'no-skill') {
      args.installSkill = false;
      continue;
    }
    args[name] = argv[i + 1];
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await installLocalProduct({
  jsaddonsDir: args.dir,
  port: args.port ? Number(args.port) : undefined,
  pluginUrl: args.url,
  backup: args.backup !== false,
  startBridgeAfterInstall: args.startBridgeAfterInstall === true,
  runReadiness: args.runReadiness !== false,
  installSkill: args.installSkill !== false,
  skillTargetRoots: args['skill-target'] ? [args['skill-target']] : undefined
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
