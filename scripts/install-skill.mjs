#!/usr/bin/env node
import { installProductionSkills } from '../src/install/skillInstall.mjs';

const roots = [];
let manifestPath;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--target' && process.argv[index + 1]) roots.push(process.argv[++index]);
  if (process.argv[index] === '--manifest' && process.argv[index + 1]) manifestPath = process.argv[++index];
}

const result = await installProductionSkills({
  ...(roots.length ? { targetRoots: roots } : {}),
  ...(manifestPath ? { manifestPath } : {})
});
console.log(JSON.stringify(result, null, 2));
