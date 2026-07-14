#!/usr/bin/env node
import { smokeWpsResources } from '../src/acceptance/resourceSmoke.mjs';

const result = await smokeWpsResources();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
