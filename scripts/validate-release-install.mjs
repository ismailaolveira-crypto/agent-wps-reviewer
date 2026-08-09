#!/usr/bin/env node
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease } from './build-release.mjs';
import { getRuntimeIdentity } from '../src/acceptance/runtimeIdentity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function run(command, args, { cwd, env = {}, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function parseJsonOutput(output, label) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error(`${label} did not return JSON.`);
  return JSON.parse(output.slice(start, end + 1));
}

function parseJsonOutputs(output, label) {
  const objects = [];
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < output.length; index += 1) {
      const character = output[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(output.slice(start, index + 1)));
          } catch {
            // A non-JSON brace in command output is not a result object.
          }
          start = index;
          break;
        }
      }
    }
  }
  if (objects.length === 0) throw new Error(`${label} did not return JSON.`);
  return objects;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function inspectInstalledSkillBundle({ userFacingSkillPath, internalExecutorPath }) {
  const dispatcherText = await readFile(path.join(userFacingSkillPath, 'SKILL.md'), 'utf8');
  const capability = JSON.parse(await readFile(
    path.join(userFacingSkillPath, 'references', 'capability-manifest.json'),
    'utf8'
  ));
  const agentMetadata = await readFile(path.join(userFacingSkillPath, 'agents', 'openai.yaml'), 'utf8');
  const executorText = await readFile(internalExecutorPath, 'utf8');
  const profilePaths = [
    path.join(userFacingSkillPath, 'references', 'profiles', 'generic-whitepaper', 'profile.json'),
    path.join(userFacingSkillPath, 'references', 'profiles', 'network-security-talent-2022-2024', 'profile.json')
  ];
  const profilesPresent = (await Promise.all(profilePaths.map((filePath) =>
    access(filePath).then(() => true).catch(() => false)
  ))).every(Boolean);
  const checks = {
    dispatcherFrontmatter: /^---\nname: whitepaper-chief-editor\n/m.test(dispatcherText),
    dispatcherReferencesExecutor: dispatcherText.includes('whitepaper-wps-reviewer'),
    dispatcherAgentMetadata: /display_name:\s*["']?白皮书审稿总编/u.test(agentMetadata) &&
      /allow_implicit_invocation:\s*true/u.test(agentMetadata),
    capabilityManifest: capability?.capabilities?.['wps-comment']?.status === 'production',
    disabledWord: capability?.capabilities?.['docx-redline']?.status === 'disabled',
    disabledPdf: capability?.capabilities?.['pdf-replica']?.status === 'disabled',
    executorFrontmatter: /^---\nname: whitepaper-wps-reviewer\n/m.test(executorText),
    executorFormalSubmit: executorText.includes('submit_wps_suggestions'),
    executorRequiresAccept: /接受.*真实 WPS 批注|真实 WPS 批注.*接受/u.test(executorText),
    profilesPresent
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-wps-reviewer-release-install-'));
const homeDir = path.join(tempDir, 'home');
const skillTarget = path.join(tempDir, 'installed-skills');
const port = await getFreePort();

try {
  const release = await buildRelease();
  const releaseManifest = JSON.parse(await readFile(release.manifestPath, 'utf8'));
  const sourceIdentity = getRuntimeIdentity(PROJECT_ROOT);
  const extracted = await run('unzip', ['-q', release.zipPath, '-d', tempDir], { cwd: PROJECT_ROOT });
  if (extracted.code !== 0) throw new Error(extracted.stderr || 'unzip failed');

  const releaseIdentityProbe = await run(
    process.execPath,
    ['--input-type=module', '-e', "import { getRuntimeIdentity } from './src/acceptance/runtimeIdentity.mjs'; console.log(JSON.stringify(getRuntimeIdentity(process.cwd())))"],
    { cwd: tempDir, env: { HOME: homeDir } }
  );
  const releaseIdentity = parseJsonOutput(releaseIdentityProbe.stdout || releaseIdentityProbe.stderr, 'release identity');
  if (
    releaseIdentityProbe.code !== 0 ||
    releaseIdentity.productVersion !== sourceIdentity.productVersion ||
    releaseIdentity.buildFingerprint !== sourceIdentity.buildFingerprint
  ) {
    throw new Error(`release runtime identity mismatch: source=${JSON.stringify(sourceIdentity)} release=${JSON.stringify(releaseIdentity)}`);
  }

  const setup = await run('bash', ['setup.command', '--dir', path.join(tempDir, 'jsaddons'), '--skill-target', skillTarget, '--port', String(port)], {
    cwd: tempDir,
    env: { HOME: homeDir }
  });
  const setupResults = parseJsonOutputs(setup.stdout || setup.stderr, 'setup.command');
  const setupResult = setupResults[0];
  const doctorResult = setupResults.at(-1);
  if (setup.code !== 0 || setupResult?.ok !== true) throw new Error(`setup.command failed: ${setup.stdout || setup.stderr}`);
  if (setupResults.length < 2 || doctorResult?.ok !== true) throw new Error(`setup.command doctor failed: ${setup.stdout || setup.stderr}`);

  const userFacingSkillPath = path.join(skillTarget, 'whitepaper-chief-editor');
  const internalExecutorPath = path.join(userFacingSkillPath, 'references', 'executors', 'whitepaper-wps-reviewer', 'SKILL.md');
  const retiredTopLevelPath = path.join(skillTarget, 'whitepaper-wps-reviewer', 'SKILL.md');
  if (
    !(await access(path.join(userFacingSkillPath, 'SKILL.md')).then(() => true).catch(() => false)) ||
    !(await access(internalExecutorPath).then(() => true).catch(() => false)) ||
    (await access(retiredTopLevelPath).then(() => true).catch(() => false))
  ) {
    throw new Error('release install did not produce one user-facing Skill with a nested WPS executor');
  }
  const skillContract = await inspectInstalledSkillBundle({ userFacingSkillPath, internalExecutorPath });
  if (!skillContract.ok) {
    throw new Error(`installed Skill bundle contract failed: ${JSON.stringify(skillContract.checks)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    release: {
      ...release,
      version: releaseManifest.version,
      channel: releaseManifest.release?.channel || 'unknown',
      productionReady: releaseManifest.release?.productionReady === true
    },
    runtimeIdentity: sourceIdentity,
    port,
    setup: {
      ok: setupResult.ok,
      resources: setupResult.readiness?.resources?.ok === true,
      mcp: setupResult.readiness?.mcp?.ok === true,
      mcpConfig: setupResult.mcpConfig?.ok === true,
      urlConsistency: setupResult.readiness?.urlConsistency?.ok === true,
      skills: setupResult.skill?.installations?.length || 0,
      userFacingSkill: setupResult.skill?.userFacingSkill || null,
      internalSkills: setupResult.skill?.internalSkills || [],
      skillContract,
      dependencyInstall: {
        attempted: false,
        nodeModulesPresent: await access(path.join(tempDir, 'node_modules')).then(() => true).catch(() => false)
      },
      launchAgent: setupResult.launchAgent?.status?.exists === true &&
        setupResult.launchAgent?.status?.label === 'com.agent-wps-reviewer.bridge'
    },
    doctor: {
      ok: doctorResult.ok,
      mcp: doctorResult.checks?.mcp?.ok === true,
      mcpConfig: doctorResult.checks?.mcpConfig?.ok === true
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), port }, null, 2));
  process.exitCode = 1;
} finally {
  await run(process.execPath, ['bin/wps-bridge-control.mjs', 'stop', '--port', String(port)], { cwd: tempDir, env: { HOME: homeDir } }).catch(() => undefined);
  await rm(tempDir, { recursive: true, force: true });
}
