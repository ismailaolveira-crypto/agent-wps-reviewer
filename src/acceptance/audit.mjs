import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManualEvidence, REQUIRED_MANUAL_CHECKS } from './manualEvidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

export const DEFAULT_GATES = [
  {
    id: 'automated-tests',
    label: 'Automated tests',
    command: [process.execPath, ['--test', 'test/*.test.mjs']],
    proves: 'Core bridge, MCP, WPS config, release collection, and persistence behavior pass the local test suite.'
  },
  {
    id: 'skill-pressure',
    label: 'Review skill pressure',
    command: [process.execPath, ['scripts/validate-skill-pressure.mjs']],
    parseJson: true,
    proves: 'A fresh Agent using the bundled Skill refuses direct bulk submission, removes a title false positive through counter-evidence, and rejects an invented historical style rule.'
  },
  {
    id: 'agent-contract',
    label: 'Agent contract',
    command: [process.execPath, ['scripts/validate-agent-contract.mjs']],
    parseJson: true,
    proves: 'The shared JSON Schema and example payloads match the bridge validation rules agents use to submit suggestions.'
  },
  {
    id: 'local-installer',
    label: 'Local installer',
    command: [process.execPath, ['scripts/validate-local-install.mjs']],
    parseJson: true,
    proves: 'The internal installer can write WPS add-in config to a jsaddons directory and verify the resulting local bridge URL without touching the real WPS app.'
  },
  {
    id: 'launch-agent-template',
    label: 'LaunchAgent template',
    command: [process.execPath, ['scripts/validate-launch-agent.mjs']],
    parseJson: true,
    proves: 'The optional macOS LaunchAgent plist can be generated, installed into a temporary LaunchAgents directory, and removed without loading a service.'
  },
  {
    id: 'foreground-prep',
    label: 'Foreground acceptance preparation',
    command: [process.execPath, ['scripts/validate-foreground-prep.mjs']],
    parseJson: true,
    proves: 'The foreground WPS acceptance preparation can create the kit, install config, start a temporary bridge, submit the sample suggestion, and clean up the bridge.'
  },
  {
    id: 'wps-resource-smoke',
    label: 'WPS resource smoke',
    command: [process.execPath, ['scripts/smoke-wps-resources.mjs']],
    parseJson: true,
    proves: 'WPS ribbon, add-in bootstrap, task pane, browser app, and WPS adapter resources are served at the paths WPS will request.'
  },
  {
    id: 'url-consistency',
    label: 'URL consistency',
    command: [process.execPath, ['scripts/check-url-consistency.mjs']],
    parseJson: true,
    proves: 'Installed WPS config, release template config, and WPS bootstrap JavaScript all point to the same local plugin and task pane URLs.'
  },
  {
    id: 'default-port-readiness',
    label: 'Default port readiness',
    command: [process.execPath, ['scripts/validate-default-port.mjs']],
    parseJson: true,
    proves: 'The exact localhost URL installed into WPS can serve the add-in resources on port 17531, and the check cleans up any bridge it starts.'
  },
  {
    id: 'release-install',
    label: 'Clean release installation',
    command: [process.execPath, ['scripts/validate-release-install.mjs']],
    parseJson: true,
    proves: 'A clean temporary HOME can install the latest release ZIP through the real setup.command entry point and pass doctor without touching the user installation or WPS.'
  },
  {
    id: 'release-artifact',
    label: 'Release artifact',
    command: [process.execPath, ['scripts/build-release.mjs']],
    parseJson: true,
    proves: 'The redistributable package can be built from the current workspace.'
  },
  {
    id: 'wps-plugin-config',
    label: 'WPS plugin config',
    command: [process.execPath, ['bin/wps-addon-config.mjs', 'status']],
    parseJson: true,
    proves: 'The WPS jsaddons configuration files point WPS at the local add-in URL.'
  },
  {
    id: 'wps-readiness',
    label: 'WPS readiness',
    command: [process.execPath, ['bin/wps-diagnose.mjs', '--no-bridge']],
    parseJson: true,
    proves: 'WPS is installed and the add-in configuration exists, without starting or touching WPS.'
  }
];

export const MANUAL_GATES = REQUIRED_MANUAL_CHECKS.map((item) => ({
  ...item,
  status: 'manual_required'
}));

export function parseFirstJsonObject(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function runCommand(command, args, { cwd = PROJECT_ROOT, env = {}, timeoutMs = 30000 } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  try {
    const [code, signal] = await once(child, 'exit');
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeOutput(output) {
  return output
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
}

export function evaluateGate(gate, result) {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  let evidence = null;
  let passed = result.code === 0;

  if (passed && gate.parseJson) {
    try {
      evidence = parseFirstJsonObject(result.stdout);
    } catch (error) {
      passed = false;
      evidence = { parseError: error instanceof Error ? error.message : String(error) };
    }
  }

  if (passed && gate.id === 'agent-ingress') {
    passed =
      evidence?.ok === true &&
      evidence?.suggestionCount === 2 &&
      Array.isArray(evidence.sources) &&
      evidence.sources.includes('cli-validator') &&
      evidence.sources.includes('mcp-validator');
  }

  if (passed && gate.id === 'skill-pressure') {
    passed = evidence?.ok === true && Array.isArray(evidence.results) &&
      evidence.results.length === 3 && evidence.results.every((item) => item.passed === true);
  }

  if (passed && gate.id === 'agent-contract') {
    passed =
      evidence?.ok === true &&
      evidence?.failed === 0 &&
      Array.isArray(evidence.checks) &&
      evidence.checks.every((item) => item.status === 'passed');
  }

  if (passed && gate.id === 'local-installer') {
    passed =
      evidence?.ok === true &&
      evidence?.config?.installed === true &&
      evidence?.readiness?.ok === true &&
      evidence?.readiness?.resources?.ok === true;
  }

  if (passed && gate.id === 'release-artifact') {
    passed =
      typeof evidence?.zipPath === 'string' &&
      existsSync(evidence.zipPath) &&
      typeof evidence?.manifestPath === 'string' &&
      existsSync(evidence.manifestPath) &&
      typeof evidence?.sha256 === 'string' &&
      evidence.sha256.length === 64;
  }

  if (passed && gate.id === 'wps-resource-smoke') {
    passed =
      evidence?.ok === true &&
      evidence?.checked >= 8 &&
      evidence?.failed === 0 &&
      Array.isArray(evidence.resources) &&
      evidence.resources.every((item) => item.status === 'passed');
  }

  if (passed && gate.id === 'url-consistency') {
    passed =
      evidence?.ok === true &&
      evidence?.failed === 0 &&
      Array.isArray(evidence.checks) &&
      evidence.checks.every((item) => item.status === 'passed');
  }

  if (passed && gate.id === 'default-port-readiness') {
    passed =
      evidence?.ok === true &&
      evidence?.port === 17531 &&
      evidence?.resources?.ok === true &&
      evidence?.urlConsistency?.ok === true;
  }

  if (passed && gate.id === 'release-install') {
    passed =
      evidence?.ok === true &&
      evidence?.setup?.ok === true &&
      evidence?.setup?.resources === true &&
      evidence?.setup?.mcp === true &&
      evidence?.setup?.mcpConfig === true &&
      evidence?.setup?.urlConsistency === true &&
      evidence?.setup?.dependencyInstall?.attempted === false &&
      evidence?.setup?.dependencyInstall?.nodeModulesPresent === false &&
      evidence?.setup?.skills === 1 &&
      evidence?.setup?.userFacingSkill === 'whitepaper-chief-editor' &&
      Array.isArray(evidence?.setup?.internalSkills) &&
      evidence.setup.internalSkills.some((skill) =>
        skill.name === 'whitepaper-wps-reviewer' &&
        skill.target === 'whitepaper-chief-editor/references/executors/whitepaper-wps-reviewer'
      ) &&
      evidence?.setup?.skillContract?.ok === true &&
      evidence?.setup?.launchAgent === true &&
      evidence?.doctor?.ok === true &&
      evidence?.doctor?.mcp === true &&
      evidence?.doctor?.mcpConfig === true &&
      evidence?.runtimeIdentity?.productVersion === evidence?.release?.version &&
      typeof evidence?.runtimeIdentity?.buildFingerprint === 'string' &&
      evidence.runtimeIdentity.buildFingerprint.length === 32 &&
      evidence?.release?.channel === 'beta' &&
      evidence?.release?.productionReady === false;
  }

  if (passed && gate.id === 'launch-agent-template') {
    passed =
      evidence?.ok === true &&
      evidence?.installed?.ok === true &&
      evidence?.installed?.loaded === false &&
      evidence?.installed?.status?.exists === true &&
      evidence?.installed?.status?.label === 'com.agent-wps-reviewer.bridge' &&
      evidence?.uninstalled?.ok === true &&
      evidence?.uninstalled?.status?.exists === false;
  }

  if (passed && gate.id === 'foreground-prep') {
    passed =
      evidence?.ok === true &&
      evidence?.kit?.ok === true &&
      evidence?.installer?.ok === true &&
      evidence?.bridge?.running === true &&
      evidence?.bridge?.health?.ok === true &&
      Array.isArray(evidence?.sample?.suggestions) &&
      evidence.sample.suggestions.length > 0 &&
      evidence?.stopped?.running === false;
  }

  if (passed && gate.id === 'wps-plugin-config') {
    passed = evidence?.installed === true && evidence?.exists === true && evidence?.publishExists === true;
  }

  if (passed && gate.id === 'wps-readiness') {
    passed = evidence?.wpsApp?.exists === true && evidence?.plugin?.installed === true;
  }

  return {
    id: gate.id,
    label: gate.label,
    status: passed ? 'passed' : 'failed',
    proves: gate.proves,
    command: [gate.command[0], ...gate.command[1]].join(' '),
    exitCode: result.code,
    signal: result.signal,
    evidence,
    outputTail: summarizeOutput(output)
  };
}

export async function runAcceptanceAudit({
  gates = DEFAULT_GATES,
  includeManualGates = true,
  manualEvidenceFile = undefined,
  acceptanceEventStorePath = undefined
} = {}) {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const gate of gates) {
    const [command, args] = gate.command;
    const result = await runCommand(command, args);
    results.push(evaluateGate(gate, result));
  }

  const manualEvidence = includeManualGates
    ? await loadManualEvidence({ filePath: manualEvidenceFile, acceptanceEventStorePath })
    : { ok: true, status: 'skipped', checks: [] };
  const manual = includeManualGates ? manualEvidence.checks : [];
  const failed = results.filter((item) => item.status !== 'passed');
  const manualRequired = manual.filter((item) => item.status !== 'passed').length;
  let packageManifest = null;

  const releaseGate = results.find((item) => item.id === 'release-artifact' && item.status === 'passed');
  if (releaseGate?.evidence?.manifestPath) {
    packageManifest = JSON.parse(await readFile(releaseGate.evidence.manifestPath, 'utf8'));
  }

  return {
    ok: failed.length === 0,
    completed: failed.length === 0 && manualRequired === 0,
    generatedAt: new Date().toISOString(),
    startedAt,
    projectRoot: PROJECT_ROOT,
    summary: {
      passed: results.length - failed.length,
      failed: failed.length,
      manualRequired
    },
    gates: results,
    manualGates: manual,
    manualEvidence: includeManualGates
      ? {
          ok: manualEvidence.ok,
          status: manualEvidence.status,
          filePath: manualEvidence.filePath,
          errors: manualEvidence.errors
        }
      : null,
    release: packageManifest
      ? {
          name: packageManifest.name,
          version: packageManifest.version,
          channel: packageManifest.release?.channel || 'unknown',
          productionReady: packageManifest.release?.productionReady === true,
          promotionBlockers: Array.isArray(packageManifest.release?.promotionBlockers)
            ? packageManifest.release.promotionBlockers
            : [],
          zip: path.join(PROJECT_ROOT, 'dist', packageManifest.zip),
          sha256: packageManifest.sha256,
          fileCount: packageManifest.files.length
        }
      : null,
    completionNote:
      failed.length === 0 && manualRequired === 0
        ? 'All automated and recorded foreground WPS acceptance gates passed.'
        : 'Background acceptance passed only proves local build/config/agent-ingress readiness. Final completion still requires foreground WPS validation of the ribbon, side pane, exact locating, and true comment insertion without body-text replacement.'
  };
}
