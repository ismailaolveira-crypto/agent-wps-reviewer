#!/usr/bin/env node
import { validateAgentContract } from '../src/agent/contract.mjs';

const result = await validateAgentContract();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
