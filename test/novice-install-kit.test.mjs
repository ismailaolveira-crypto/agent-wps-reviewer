import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REQUIRED_NOVICE_INSTALL_STEPS } from '../src/acceptance/noviceInstallEvidence.mjs';

const run = promisify(execFile);

test('novice install kit creates an explicit pending evidence template', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-novice-kit-'));
  try {
    const result = await run(process.execPath, ['scripts/create-novice-install-kit.mjs', '--dir', root]);
    const output = JSON.parse(result.stdout);
    const steps = JSON.parse(await readFile(output.stepsFile, 'utf8')).steps;
    assert.deepEqual(steps.map((step) => step.id), REQUIRED_NOVICE_INSTALL_STEPS.map((step) => step.id));
    assert.ok(steps.every((step) => step.status === 'pending'));
    assert.ok(steps.every((step) => step.proofFiles.length === 1));
    assert.match(await readFile(output.readmeFile, 'utf8'), /Do not use this template itself as proof/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
