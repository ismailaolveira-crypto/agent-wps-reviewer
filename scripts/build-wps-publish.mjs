#!/usr/bin/env node
import { runWpsPublish } from '../src/wps/publish.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--command' && argv[index + 1]) args.command = argv[++index];
    else if (key === '--output-dir' && argv[index + 1]) args.outputDir = argv[++index];
  }
  return args;
}

const result = runWpsPublish(parseArgs(process.argv.slice(2)));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
