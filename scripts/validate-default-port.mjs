#!/usr/bin/env node
import { validateDefaultPortReadiness } from '../src/acceptance/defaultPortReadiness.mjs';

const result = await validateDefaultPortReadiness();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
