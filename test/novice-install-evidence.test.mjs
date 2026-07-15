import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  REQUIRED_NOVICE_INSTALL_STEPS,
  validateNoviceInstallEvidence,
  writeNoviceInstallEvidence
} from '../src/acceptance/noviceInstallEvidence.mjs';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const runtimeIdentity = getRuntimeIdentity();

async function createStepsFile(root) {
  const steps = [];
  for (const [index, required] of REQUIRED_NOVICE_INSTALL_STEPS.entries()) {
    const proofFile = path.join(root, `${index}-${required.id}.log`);
    await writeFile(proofFile, `${required.label}\npassed\n`);
    steps.push({
      id: required.id,
      status: 'passed',
      evidence: `${required.label} completed by an independent tester.`,
      proofFiles: [proofFile]
    });
  }
  const stepsFile = path.join(root, 'steps.json');
  await writeFile(stepsFile, JSON.stringify({ steps }, null, 2));
  return stepsFile;
}

test('novice install evidence requires independent standard-user proof for every step', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-novice-evidence-'));
  try {
    const stepsFile = await createStepsFile(root);
    const result = await writeNoviceInstallEvidence({
      filePath: path.join(root, 'novice.json'),
      stepsFile,
      releaseSha256: 'a'.repeat(64),
      osVersion: 'Windows 11 24H2 build 26100',
      osArch: 'x64',
      wpsArch: 'x64',
      runtimeInstanceId: 'runtime-test-12345678',
      operator: 'independent tester',
      independentReviewer: true,
      unassisted: true,
      standardUser: true,
      administrator: false,
      wpsTrusted: true,
      mcpClient: 'codex',
      runtimeIdentity
    });
    assert.equal(result.ok, true);

    const invalid = validateNoviceInstallEvidence({
      ...result.evidence,
      unassisted: false,
      steps: result.evidence.steps.slice(1)
    }, { expectedIdentity: runtimeIdentity, projectRoot: root });
    assert.equal(invalid.ok, false);
    assert.match(invalid.errors.join('\n'), /unassisted|missing step/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
