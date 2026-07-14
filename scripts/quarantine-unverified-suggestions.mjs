#!/usr/bin/env node
import path from 'node:path';
import { applyQuarantine, inspectUnverifiedSuggestions, restoreQuarantine } from '../src/maintenance/quarantineSuggestions.mjs';

const storePath = path.resolve('data/review-store.json');
const restoreIndex = process.argv.indexOf('--restore');
let result;
if (restoreIndex >= 0) {
  const backupPath = process.argv[restoreIndex + 1];
  if (!backupPath) throw new Error('--restore requires a backup path');
  result = await restoreQuarantine({ storePath, backupPath: path.resolve(backupPath) });
} else if (process.argv.includes('--apply')) {
  result = await applyQuarantine({ storePath });
} else {
  result = { dryRun: true, ...(await inspectUnverifiedSuggestions({ storePath })) };
}
console.log(JSON.stringify(result, null, 2));
