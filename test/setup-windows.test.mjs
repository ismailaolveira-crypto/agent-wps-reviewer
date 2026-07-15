import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Windows setup entry checks Node version and delegates to the transactional setup', async () => {
  const cmd = await readFile(path.join(PROJECT_ROOT, 'setup.cmd'), 'utf8');
  const setup = await readFile(path.join(PROJECT_ROOT, 'scripts/setup.mjs'), 'utf8');
  assert.match(cmd, /where node\.exe/i);
  assert.match(cmd, /process\.versions\.node/);
  assert.match(cmd, /scripts\\setup\.mjs/);
  assert.match(setup, /installStableWindowsBundle/);
  assert.match(setup, /runDoctor/);
  assert.match(setup, /agentToken\?\.tokenPath/);
  assert.match(setup, /WPS_REVIEWER_STABLE_BOOTSTRAPPED/);
});
