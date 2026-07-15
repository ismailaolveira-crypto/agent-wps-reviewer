import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeIdentity } from './runtimeIdentity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export const REQUIRED_MANUAL_CHECKS = [
  {
    id: 'wps-taskpane-visible',
    label: 'WPS task pane visible',
    reason: 'Requires restarting or interacting with WPS to confirm the Agent 审阅 ribbon and side task pane are visible.'
  },
  {
    id: 'wps-comment-flow',
    label: 'Real document locate/comment flow',
    reason: 'Requires a foreground WPS document to prove exact locating and true comment insertion work without replacing body text.'
  }
];

export function defaultManualEvidencePath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, 'output/manual-acceptance.json');
}

export function defaultReviewStorePath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, 'data/review-store.json');
}

function hasUsefulText(value) {
  return typeof value === 'string' && value.trim().length >= 8;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function proofFileExists(filePath, projectRoot) {
  if (!filePath) return true;
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  return existsSync(resolved);
}

export function validateManualEvidence(
  evidence,
  { projectRoot = PROJECT_ROOT, expectedIdentity = getRuntimeIdentity(projectRoot) } = {}
) {
  const errors = [];
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];

  if (!hasText(evidence?.productVersion)) errors.push('productVersion is required');
  if (!hasText(evidence?.buildFingerprint)) errors.push('buildFingerprint is required');
  if (hasText(evidence?.productVersion) && evidence.productVersion !== expectedIdentity.productVersion) {
    errors.push(`productVersion does not match current runtime (${expectedIdentity.productVersion})`);
  }
  if (hasText(evidence?.buildFingerprint) && evidence.buildFingerprint !== expectedIdentity.buildFingerprint) {
    errors.push('buildFingerprint does not match current runtime');
  }
  if (!hasUsefulText(evidence?.wpsVersion)) errors.push('wpsVersion is required');
  if (!hasUsefulText(evidence?.documentPath)) errors.push('documentPath is required');
  if (!hasUsefulText(evidence?.checkedAt)) errors.push('checkedAt is required');
  if (evidence?.platform === 'win32') {
    if (!hasText(evidence?.osVersion)) errors.push('osVersion is required for Windows evidence');
    if (!hasText(evidence?.osArch)) errors.push('osArch is required for Windows evidence');
    if (!hasText(evidence?.wpsArch)) errors.push('wpsArch is required for Windows evidence');
    if (!hasText(evidence?.runtimeInstanceId)) errors.push('runtimeInstanceId is required for Windows evidence');
  }

  const normalizedChecks = REQUIRED_MANUAL_CHECKS.map((required) => {
    const found = checks.find((item) => item?.id === required.id);
    const checkErrors = [];
    if (!found) {
      checkErrors.push('missing check');
    } else {
      if (found.status !== 'passed') checkErrors.push('status must be passed');
      if (!hasUsefulText(found.evidence)) checkErrors.push('evidence text is required');
      const proofFiles = Array.isArray(found.proofFiles) ? found.proofFiles : [];
      for (const proofFile of proofFiles) {
        if (!proofFileExists(proofFile, projectRoot)) {
          checkErrors.push(`proof file not found: ${proofFile}`);
        }
      }
    }

    return {
      id: required.id,
      label: required.label,
      status: checkErrors.length === 0 ? 'passed' : 'manual_required',
      reason: checkErrors.length === 0 ? '' : required.reason,
      evidence: found?.evidence || '',
      proofFiles: Array.isArray(found?.proofFiles) ? found.proofFiles : [],
      errors: checkErrors
    };
  });

  for (const check of normalizedChecks) {
    errors.push(...check.errors.map((error) => `${check.id}: ${error}`));
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'manual_required',
    errors,
    checks: normalizedChecks,
    evidence: evidence || null
  };
}

function latestIso(values) {
  return values
    .map((item) => item.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
}

function chooseEvidenceSession(events) {
  const wpsEvents = events.filter((item) => item?.adapterMode === 'wps');
  const sessionIds = [...new Set(wpsEvents.map((item) => item.docSessionId || 'default'))];
  for (const docSessionId of sessionIds) {
    const sessionEvents = wpsEvents.filter((item) => (item.docSessionId || 'default') === docSessionId);
    const hasTaskpane = sessionEvents.some((item) => item.eventType === 'taskpane.opened');
    const hasComment = sessionEvents.some((item) => item.eventType === 'suggestion.commented');
    const hasLocate = sessionEvents.some((item) => item.eventType === 'suggestion.located');
    if (hasTaskpane && hasLocate && hasComment) return sessionEvents;
  }
  return wpsEvents;
}

export function deriveManualEvidenceFromAcceptanceEvents(
  events = [],
  { projectRoot = PROJECT_ROOT, runtimeIdentity = getRuntimeIdentity(projectRoot) } = {}
) {
  const allEvents = Array.isArray(events) ? events : [];
  const currentWpsEvents = allEvents.filter(
    (item) =>
      item?.adapterMode === 'wps' &&
      item.productVersion === runtimeIdentity.productVersion &&
      item.buildFingerprint === runtimeIdentity.buildFingerprint
  );
  const chosen = chooseEvidenceSession(currentWpsEvents);
  const latest = chosen.at(-1) || {};
  const taskpaneEvent = chosen.find((item) => item.eventType === 'taskpane.opened');
  const commentEvent = chosen.find((item) => item.eventType === 'suggestion.commented');
  const locateEvent = chosen.find((item) => item.eventType === 'suggestion.located');
  const checkedAt = latestIso(chosen) || new Date().toISOString();
  const docSessionId = latest.docSessionId || taskpaneEvent?.docSessionId || 'unknown-session';
  const docTitle = latest.docTitle || taskpaneEvent?.docTitle || `WPS document session ${docSessionId}`;
  const wpsVersion = latest.wpsVersion || taskpaneEvent?.wpsVersion || 'WPS runtime detected';
  const evidence = {
    checkedAt,
    productVersion: runtimeIdentity.productVersion,
    buildFingerprint: runtimeIdentity.buildFingerprint,
    ...(latest.platform ? { platform: latest.platform } : {}),
    ...(latest.osVersion ? { osVersion: latest.osVersion } : {}),
    ...(latest.osArch ? { osArch: latest.osArch } : {}),
    ...(latest.wpsArch ? { wpsArch: latest.wpsArch } : {}),
    ...(latest.runtimeInstanceId ? { runtimeInstanceId: latest.runtimeInstanceId } : {}),
    wpsVersion,
    documentPath: docTitle,
    bridgeUrl: 'http://127.0.0.1:17531',
    source: 'acceptance-events',
    ignoredWpsEventCount: allEvents.filter((item) => item?.adapterMode === 'wps').length - currentWpsEvents.length,
    checks: [
      {
        id: 'wps-taskpane-visible',
        status: taskpaneEvent ? 'passed' : 'manual_required',
        evidence: taskpaneEvent
          ? `Real WPS task pane opened for ${docTitle} at ${taskpaneEvent.createdAt}.`
          : '',
        proofFiles: []
      },
      {
        id: 'wps-comment-flow',
        status: locateEvent && commentEvent ? 'passed' : 'manual_required',
        evidence:
          locateEvent && commentEvent
            ? `Real WPS events recorded: suggestion.located (${locateEvent.suggestionId || 'unknown suggestion'}) and suggestion.commented (${commentEvent.suggestionId || 'unknown suggestion'}); no body-text replacement is required.`
            : '',
        proofFiles: []
      }
    ]
  };

  const validation = validateManualEvidence(evidence, { projectRoot, expectedIdentity: runtimeIdentity });
  if (currentWpsEvents.length === 0 && allEvents.some((item) => item?.adapterMode === 'wps')) {
    validation.ok = false;
    validation.status = 'manual_required';
    validation.errors.unshift(
      `No WPS acceptance events match the current build; ignored ${evidence.ignoredWpsEventCount} historical or stale WPS event(s).`
    );
  }
  return validation;
}

export async function loadManualEvidenceFromAcceptanceEvents({
  storeFilePath = defaultReviewStorePath(),
  projectRoot = PROJECT_ROOT,
  runtimeIdentity = getRuntimeIdentity(projectRoot)
} = {}) {
  if (!existsSync(storeFilePath)) {
    return {
      ok: false,
      status: 'manual_required',
      filePath: storeFilePath,
      errors: ['acceptance event store not found'],
      checks: REQUIRED_MANUAL_CHECKS.map((item) => ({
        ...item,
        status: 'manual_required',
        evidence: '',
        proofFiles: [],
        errors: ['acceptance event store not found']
      })),
      evidence: null
    };
  }

  try {
    const parsed = JSON.parse(await readFile(storeFilePath, 'utf8'));
    const result = deriveManualEvidenceFromAcceptanceEvents(parsed.acceptanceEvents || [], { projectRoot, runtimeIdentity });
    return {
      filePath: storeFilePath,
      ...result
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      filePath: storeFilePath,
      errors: [error instanceof Error ? error.message : String(error)],
      checks: REQUIRED_MANUAL_CHECKS.map((item) => ({
        ...item,
        status: 'manual_required',
        evidence: '',
        proofFiles: [],
        errors: ['acceptance event store is invalid']
      })),
      evidence: null
    };
  }
}

export async function loadManualEvidence({
  filePath = defaultManualEvidencePath(),
  projectRoot = PROJECT_ROOT,
  acceptanceEventStorePath = defaultReviewStorePath(projectRoot),
  runtimeIdentity = getRuntimeIdentity(projectRoot)
} = {}) {
  if (!existsSync(filePath)) {
    const automatic = await loadManualEvidenceFromAcceptanceEvents({
      storeFilePath: acceptanceEventStorePath,
      projectRoot,
      runtimeIdentity
    });
    if (automatic.ok) return automatic;

    return {
      ok: false,
      status: 'manual_required',
      filePath,
      errors: ['manual evidence file not found', ...automatic.errors],
      checks: REQUIRED_MANUAL_CHECKS.map((item) => ({
        ...item,
        status: 'manual_required',
        evidence: '',
        proofFiles: [],
        errors: ['manual evidence file not found']
      })),
      evidence: null
    };
  }

  try {
    const evidence = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      filePath,
      ...validateManualEvidence(evidence, { projectRoot, expectedIdentity: runtimeIdentity })
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      filePath,
      errors: [error instanceof Error ? error.message : String(error)],
      checks: REQUIRED_MANUAL_CHECKS.map((item) => ({
        ...item,
        status: 'manual_required',
        evidence: '',
        proofFiles: [],
        errors: ['manual evidence file is invalid']
      })),
      evidence: null
    };
  }
}

export async function waitForManualAcceptance({
  manualEvidenceFile = defaultManualEvidencePath(),
  acceptanceEventStorePath = defaultReviewStorePath(),
  projectRoot = PROJECT_ROOT,
  timeoutMs = 10 * 60 * 1000,
  intervalMs = 1000
} = {}) {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + Number(timeoutMs);
  let lastResult = null;

  while (Date.now() <= deadline) {
    lastResult = await loadManualEvidence({
      filePath: manualEvidenceFile,
      acceptanceEventStorePath,
      projectRoot
    });
    if (lastResult.ok) {
      return {
        ...lastResult,
        ok: true,
        timedOut: false,
        startedAt,
        completedAt: new Date().toISOString(),
        source: {
          filePath: lastResult.filePath
        }
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(intervalMs))));
  }

  return {
    ...(lastResult || {
      status: 'manual_required',
      checks: [],
      evidence: null,
      errors: ['manual evidence has not been checked']
    }),
    ok: false,
    timedOut: true,
    startedAt,
    completedAt: new Date().toISOString(),
    errors: [`Timed out waiting for real WPS acceptance evidence after ${Number(timeoutMs)}ms`, ...(lastResult?.errors || [])],
    source: {
      filePath: lastResult?.filePath || acceptanceEventStorePath
    }
  };
}

export async function writeManualEvidence({
  filePath = defaultManualEvidencePath(),
  wpsVersion,
  documentPath,
  bridgeUrl = 'http://127.0.0.1:17531',
  runtimeIdentity = getRuntimeIdentity(),
  platform = process.platform,
  osVersion = os.release(),
  osArch = process.arch,
  wpsArch = '',
  runtimeInstanceId = '',
  taskpaneEvidence,
  mutationEvidence,
  taskpaneProofFiles = [],
  mutationProofFiles = []
} = {}) {
  const evidence = {
    checkedAt: new Date().toISOString(),
    productVersion: runtimeIdentity.productVersion,
    buildFingerprint: runtimeIdentity.buildFingerprint,
    platform,
    osVersion,
    osArch,
    ...(wpsArch ? { wpsArch } : {}),
    ...(runtimeInstanceId ? { runtimeInstanceId } : {}),
    wpsVersion,
    documentPath,
    bridgeUrl,
    checks: [
      {
        id: 'wps-taskpane-visible',
        status: 'passed',
        evidence: taskpaneEvidence,
        proofFiles: taskpaneProofFiles
      },
      {
        id: 'wps-comment-flow',
        status: 'passed',
        evidence: mutationEvidence,
        proofFiles: mutationProofFiles
      }
    ]
  };

  const validation = validateManualEvidence(evidence, { expectedIdentity: runtimeIdentity });
  if (!validation.ok) {
    const error = new Error('Invalid manual acceptance evidence');
    error.details = validation.errors;
    throw error;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return {
    ok: true,
    filePath,
    evidence
  };
}
