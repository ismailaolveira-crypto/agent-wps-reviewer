import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeIdentity } from './runtimeIdentity.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const REQUIRED_NOVICE_INSTALL_STEPS = [
  { id: 'clean-standard-install', label: 'Clean standard-user install' },
  { id: 'doctor', label: 'Doctor after install' },
  { id: 'official-publish-trust', label: 'Official WPS publish/trust' },
  { id: 'login-autostart', label: 'Bridge after logon' },
  { id: 'mcp-discovery', label: 'MCP discovery' },
  { id: 'uninstall', label: 'Product uninstall' },
  { id: 'reinstall', label: 'Product reinstall' },
  { id: 'special-path', label: 'Chinese/space path install' }
];

export function defaultNoviceInstallEvidencePath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, 'output/novice-install-acceptance.json');
}

function useful(value) {
  return typeof value === 'string' && value.trim().length >= 8;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function proofExists(filePath, projectRoot) {
  if (!filePath) return false;
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  return existsSync(resolved);
}

export function validateNoviceInstallEvidence(
  evidence,
  { projectRoot = PROJECT_ROOT, expectedIdentity = getRuntimeIdentity(projectRoot) } = {}
) {
  const errors = [];
  if (evidence?.platform !== 'win32') errors.push('platform must be win32');
  if (!text(evidence?.productVersion)) errors.push('productVersion is required');
  if (!text(evidence?.buildFingerprint)) errors.push('buildFingerprint is required');
  if (evidence?.productVersion && evidence.productVersion !== expectedIdentity.productVersion) {
    errors.push(`productVersion does not match current runtime (${expectedIdentity.productVersion})`);
  }
  if (evidence?.buildFingerprint && evidence.buildFingerprint !== expectedIdentity.buildFingerprint) {
    errors.push('buildFingerprint does not match current runtime');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(evidence?.releaseSha256 || ''))) errors.push('releaseSha256 must be a 64-character SHA-256');
  if (!useful(evidence?.checkedAt)) errors.push('checkedAt is required');
  if (!useful(evidence?.osVersion)) errors.push('osVersion is required');
  if (!text(evidence?.osArch)) errors.push('osArch is required');
  if (!text(evidence?.wpsArch)) errors.push('wpsArch is required');
  if (!useful(evidence?.runtimeInstanceId)) errors.push('runtimeInstanceId is required');
  if (!useful(evidence?.operator)) errors.push('operator is required');
  if (evidence?.independentReviewer !== true) errors.push('independentReviewer must be true');
  if (evidence?.unassisted !== true) errors.push('unassisted must be true');
  if (evidence?.standardUser !== true) errors.push('standardUser must be true');
  if (evidence?.administrator !== false) errors.push('administrator must be false');
  if (evidence?.wpsTrusted !== true) errors.push('wpsTrusted must be true');
  if (!['codex', 'claude'].includes(String(evidence?.mcpClient || '').toLowerCase())) {
    errors.push('mcpClient must be codex or claude');
  }

  const steps = Array.isArray(evidence?.steps) ? evidence.steps : [];
  for (const required of REQUIRED_NOVICE_INSTALL_STEPS) {
    const found = steps.find((step) => step?.id === required.id);
    if (!found) {
      errors.push(`${required.id}: missing step`);
      continue;
    }
    if (found.status !== 'passed') errors.push(`${required.id}: status must be passed`);
    if (!useful(found.evidence)) errors.push(`${required.id}: evidence text is required`);
    const proofFiles = Array.isArray(found.proofFiles) ? found.proofFiles : [];
    if (proofFiles.length === 0) errors.push(`${required.id}: at least one proof file is required`);
    for (const proofFile of proofFiles) {
      if (!proofExists(proofFile, projectRoot)) errors.push(`${required.id}: proof file not found: ${proofFile}`);
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'manual_required',
    errors,
    evidence: evidence || null
  };
}

export async function loadNoviceInstallEvidence({
  filePath = defaultNoviceInstallEvidencePath(),
  projectRoot = PROJECT_ROOT,
  expectedIdentity = getRuntimeIdentity(projectRoot)
} = {}) {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      status: 'manual_required',
      filePath,
      errors: ['novice install evidence file not found'],
      evidence: null
    };
  }
  try {
    const evidence = JSON.parse(await readFile(filePath, 'utf8'));
    return { filePath, ...validateNoviceInstallEvidence(evidence, { projectRoot, expectedIdentity }) };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      filePath,
      errors: [error instanceof Error ? error.message : String(error)],
      evidence: null
    };
  }
}

export async function writeNoviceInstallEvidence({
  filePath = defaultNoviceInstallEvidencePath(),
  stepsFile,
  releaseSha256,
  osVersion,
  osArch = process.arch,
  wpsArch,
  runtimeInstanceId,
  operator,
  independentReviewer = false,
  unassisted = false,
  standardUser = false,
  administrator = true,
  wpsTrusted = false,
  mcpClient,
  runtimeIdentity = getRuntimeIdentity()
} = {}) {
  if (!stepsFile) throw new Error('stepsFile is required');
  const stepsPayload = JSON.parse(await readFile(stepsFile, 'utf8'));
  const evidence = {
    checkedAt: new Date().toISOString(),
    productVersion: runtimeIdentity.productVersion,
    buildFingerprint: runtimeIdentity.buildFingerprint,
    platform: 'win32',
    releaseSha256,
    osVersion,
    osArch,
    wpsArch,
    runtimeInstanceId,
    operator,
    independentReviewer,
    unassisted,
    standardUser,
    administrator,
    wpsTrusted,
    mcpClient,
    source: 'independent-windows-acceptance',
    steps: stepsPayload.steps
  };
  const validation = validateNoviceInstallEvidence(evidence, { expectedIdentity: runtimeIdentity });
  if (!validation.ok) {
    const error = new Error(`Invalid novice install evidence: ${validation.errors.join('; ')}`);
    error.details = validation;
    throw error;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { ...validation, filePath };
}
