#!/usr/bin/env node
import { checkUrlConsistency } from '../src/acceptance/urlConsistency.mjs';

const result = await checkUrlConsistency();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
