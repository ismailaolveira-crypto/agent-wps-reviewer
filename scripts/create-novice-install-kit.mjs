#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_NOVICE_INSTALL_STEPS } from '../src/acceptance/noviceInstallEvidence.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const relativeDir = args.dir || 'output/windows-probe/novice-install';
const targetDir = path.resolve(PROJECT_ROOT, relativeDir);
const proofDir = path.join(targetDir, 'proofs');
const stepsFile = path.join(targetDir, 'novice-steps.json');
const readmeFile = path.join(targetDir, 'README.txt');

const steps = REQUIRED_NOVICE_INSTALL_STEPS.map((step) => ({
  id: step.id,
  status: 'pending',
  evidence: '',
  proofFiles: [path.relative(PROJECT_ROOT, path.join(proofDir, `${step.id}.txt`))]
}));

await mkdir(proofDir, { recursive: true });
await writeFile(stepsFile, `${JSON.stringify({ steps }, null, 2)}\n`, 'utf8');
await writeFile(readmeFile, [
  'Windows novice-install evidence kit',
  '',
  '1. Execute each step as an independent standard (non-admin) user.',
  '2. Save the actual transcript, screenshot, or command output in the matching proofs/*.txt file.',
  '3. Replace status=pending and evidence="" only after the step really passes.',
  '4. Run npm run acceptance:record-novice with this novice-steps.json.',
  '5. Do not use this template itself as proof of WPS trust or real comments.',
  ''
].join('\n'), 'utf8');

console.log(JSON.stringify({
  ok: true,
  targetDir,
  stepsFile,
  readmeFile,
  proofDir,
  steps: steps.map((step) => step.id)
}, null, 2));
