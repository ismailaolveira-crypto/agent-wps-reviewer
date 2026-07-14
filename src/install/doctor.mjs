import { access, readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { defaultSkillRoots, PROJECT_ROOT } from './skillInstall.mjs';
import { readPluginConfigStatus } from '../wps/pluginConfig.mjs';
import { readPluginAuthStatus } from '../wps/pluginAuth.mjs';
import { statusBridge } from '../bridge/processControl.mjs';
import { checkMcpServer } from './mcpHealth.mjs';
import { defaultAgentTokenPath, readAgentToken } from './agentToken.mjs';
import { inspectMcpClients } from './mcpConfig.mjs';
import { buildAgentAuthHeaders } from '../bridge/auth.mjs';
import { runWpsDiagnostics } from '../wps/diagnostics.mjs';
import { DEFAULT_LAUNCH_AGENT_LABEL, defaultLaunchAgentPath, readLaunchAgentStatus } from './launchAgent.mjs';

const RELEASE_LOCK_STALE_MS = 10 * 60 * 1000;

async function readProductManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

function inferProjectRoot(manifestPath) {
  const manifestDir = path.dirname(manifestPath);
  return path.basename(manifestDir) === 'config' ? path.dirname(manifestDir) : manifestDir;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function inspectPublicDocumentation(projectRoot = PROJECT_ROOT) {
  const readmePath = path.join(projectRoot, 'README.md');
  const forbiddenPromises = ['应用替换', '修订替换', 'replacement applied'];
  try {
    const readme = await readFile(readmePath, 'utf8');
    const violations = forbiddenPromises.filter((phrase) => readme.includes(phrase));
    return {
      ok: violations.length === 0,
      checked: true,
      path: readmePath,
      violations
    };
  } catch (error) {
    return {
      ok: false,
      checked: true,
      path: readmePath,
      error: error.code === 'ENOENT' ? 'README.md missing' : String(error)
    };
  }
}

export async function inspectReleaseArtifact(projectRoot = PROJECT_ROOT) {
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch (error) {
    return { ok: false, checked: true, error: `package.json unreadable: ${String(error)}` };
  }

  const releaseName = `${packageJson.name}-${packageJson.version}`;
  const zipPath = path.join(projectRoot, 'dist', `${releaseName}.zip`);
  const manifestPath = path.join(projectRoot, 'dist', `${releaseName}-manifest.json`);
  const releaseLockPath = path.join(projectRoot, 'dist', `.${releaseName}.lock`);
  try {
    const lockStat = await stat(releaseLockPath);
    const lockAgeMs = Math.max(0, Date.now() - lockStat.mtimeMs);
    return {
      ok: false,
      checked: true,
      status: lockAgeMs > RELEASE_LOCK_STALE_MS ? 'stale-lock' : 'release-build-in-progress',
      error: lockAgeMs > RELEASE_LOCK_STALE_MS
        ? 'stale release lock detected'
        : 'release build in progress',
      releaseLockPath,
      lockAgeMs,
      zipPath,
      manifestPath
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return {
        ok: false,
        checked: true,
        error: `release lock unreadable: ${String(error)}`,
        releaseLockPath,
        zipPath,
        manifestPath
      };
    }
  }
  const [zipExists, manifestExists] = await Promise.all([
    access(zipPath).then(() => true).catch(() => false),
    access(manifestPath).then(() => true).catch(() => false)
  ]);

  if (!zipExists && !manifestExists) {
    return {
      ok: true,
      checked: false,
      reason: 'release-artifact-not-present',
      zipPath,
      manifestPath
    };
  }
  if (!zipExists || !manifestExists) {
    return {
      ok: false,
      checked: true,
      error: 'release-artifact-incomplete',
      zipPath,
      manifestPath,
      zipExists,
      manifestExists
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    return { ok: false, checked: true, error: `release manifest unreadable: ${String(error)}`, zipPath, manifestPath };
  }

  const archiveHash = await hashFile(zipPath);
  const listing = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (listing.status !== 0) {
    return {
      ok: false,
      checked: true,
      error: listing.stderr || 'unzip listing failed',
      zipPath,
      manifestPath,
      archiveHash,
      manifestHash: manifest.sha256
    };
  }

  const manifestFiles = [...new Set(Array.isArray(manifest.files) ? manifest.files : [])].sort();
  const archiveFiles = String(listing.stdout || '').split(/\r?\n/).filter(Boolean).sort();
  const missing = manifestFiles.filter((file) => !archiveFiles.includes(file));
  const unexpected = archiveFiles.filter((file) => !manifestFiles.includes(file));
  const hashMatches = manifest.sha256 === archiveHash;
  const filesMatch = missing.length === 0 && unexpected.length === 0 && manifestFiles.length === archiveFiles.length;
  const identityMatches = manifest.name === packageJson.name && manifest.version === packageJson.version;

  return {
    ok: hashMatches && filesMatch && identityMatches,
    checked: true,
    zipPath,
    manifestPath,
    archiveHash,
    manifestHash: manifest.sha256,
    hashMatches,
    filesMatch,
    identityMatches,
    fileCount: archiveFiles.length,
    missing,
    unexpected
  };
}

async function skillSnapshot(root) {
  const files = [];

  async function walk(current, prefix = '') {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath, relative);
      else if (entry.isFile()) files.push({ relative, content: await readFile(fullPath) });
    }
  }

  await walk(root);
  const entries = files.map((file) => ({
    relative: file.relative,
    sha256: createHash('sha256').update(file.content).digest('hex')
  }));
  return { sha256: hashEntries(entries), files: entries };
}

function hashEntries(entries) {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.relative.localeCompare(right.relative))) {
    hash.update(entry.relative);
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function readOpenWpsDocuments({ bridge, bridgeOptions, token }) {
  if (!bridge.running || !token) {
    return {
      checked: false,
      count: 0,
      documents: [],
      reason: !bridge.running ? 'bridge-not-running' : 'agent-token-missing'
    };
  }

  const host = bridgeOptions.host || '127.0.0.1';
  const port = bridgeOptions.port || 17531;
  try {
    const response = await fetch(`http://${host}:${port}/api/agent/documents`, {
      headers: buildAgentAuthHeaders(token),
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) {
      return { checked: true, count: 0, documents: [], reason: `http-${response.status}` };
    }
    const body = await response.json();
    const documents = Array.isArray(body.documents)
      ? body.documents.map((document) => ({
        documentHandle: document.documentHandle,
        title: document.title,
        path: document.path,
        isActive: document.isActive,
        lastActiveAt: document.lastActiveAt
      }))
      : [];
    return { checked: true, count: documents.length, documents };
  } catch (error) {
    return {
      checked: true,
      count: 0,
      documents: [],
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runDoctor({
  manifestPath,
  skillRoots = defaultSkillRoots(),
  skillSourceRoot = PROJECT_ROOT,
  projectRoot,
  jsaddonsDir,
  bridgeOptions = {},
  wpsAppPath,
  checkWpsProcess = true,
  checkLaunchAgent = false,
  launchAgentPath
} = {}) {
  const resolvedManifestPath = manifestPath || path.join(PROJECT_ROOT, 'config/product-manifest.json');
  const resolvedProjectRoot = projectRoot || (manifestPath ? inferProjectRoot(resolvedManifestPath) : PROJECT_ROOT);
  const manifest = await readProductManifest(resolvedManifestPath);
  const requiredSkills = manifest.productionSkills || [];
  const internalSkills = manifest.internalSkills || [];
  const retiredTopLevelSkills = manifest.retiredTopLevelSkills || [];
  const skillChecks = [];
  const retiredSkillChecks = [];

  for (const root of skillRoots) {
    for (const skill of requiredSkills) {
      const skillPath = path.join(root, skill.name, 'SKILL.md');
      const sourcePath = path.resolve(skillSourceRoot, skill.source || '');
      try {
        await readFile(skillPath, 'utf8');
        const [source, installed] = await Promise.all([
          skillSnapshot(sourcePath),
          skillSnapshot(path.join(root, skill.name))
        ]);
        const expected = new Map(source.files.map((file) => [file.relative, file.sha256]));
        for (const resource of manifest.resources || []) {
          const resourceTarget = path.posix.normalize(String(resource.target || '')).replace(/^\.\//, '');
          if (resourceTarget !== skill.name && !resourceTarget.startsWith(`${skill.name}/`)) continue;
          const resourceSnapshot = await skillSnapshot(path.resolve(skillSourceRoot, resource.source));
          const relativeTarget = path.posix.relative(skill.name, resourceTarget);
          for (const file of resourceSnapshot.files) {
            expected.set(path.posix.join(relativeTarget, file.relative), file.sha256);
          }
        }
        for (const internalSkill of internalSkills) {
          const internalTarget = path.posix.normalize(String(internalSkill.target || '')).replace(/^\.\//, '');
          if (internalTarget !== skill.name && !internalTarget.startsWith(`${skill.name}/`)) continue;
          const internalSource = await skillSnapshot(path.resolve(skillSourceRoot, internalSkill.source || ''));
          const relativeTarget = path.posix.relative(skill.name, internalTarget);
          for (const file of internalSource.files) {
            expected.set(path.posix.join(relativeTarget, file.relative), file.sha256);
          }
        }
        const expectedEntries = [...expected.entries()].map(([relative, sha256]) => ({ relative, sha256 }));
        const installedEntries = installed.files;
        const installedMap = new Map(installedEntries.map((file) => [file.relative, file.sha256]));
        const expectedHash = hashEntries(expectedEntries);
        const inSync = expectedHash === installed.sha256 &&
          expectedEntries.length === installedEntries.length &&
          expectedEntries.every((file) => installedMap.get(file.relative) === file.sha256);
        skillChecks.push({
          root,
          name: skill.name,
          path: skillPath,
          sourcePath,
          internalSkills: internalSkills
            .filter((internalSkill) => String(internalSkill.target || '').startsWith(`${skill.name}/`))
            .map((internalSkill) => ({ name: internalSkill.name, target: internalSkill.target })),
          sourceHash: source.sha256,
          expectedHash,
          installedHash: installed.sha256,
          drift: !inSync,
          ok: inSync,
          ...(inSync ? {} : { error: 'source-drift' })
        });
      } catch (error) {
        skillChecks.push({
          root,
          name: skill.name,
          path: skillPath,
          ok: false,
          error: error.code === 'ENOENT' ? 'missing-or-source-missing' : String(error)
        });
      }
    }
    for (const name of retiredTopLevelSkills) {
      const retiredPath = path.join(root, name);
      const present = await access(retiredPath).then(() => true).catch(() => false);
      retiredSkillChecks.push({
        root,
        name,
        path: retiredPath,
        ok: !present,
        ...(present ? { error: 'retired-top-level-skill' } : {})
      });
    }
  }

  const pluginConfig = await readPluginConfigStatus({ jsaddonsDir });
  const pluginAuth = await readPluginAuthStatus({ jsaddonsDir });
  const bridge = await statusBridge(bridgeOptions);
  const tokenPath = bridgeOptions.agentTokenPath || defaultAgentTokenPath();
  const token = await readAgentToken({ tokenPath });
  const mcpConfig = await inspectMcpClients();
  const availableMcpClients = mcpConfig.clients.filter((client) => client.available);
  const configuredMcpClients = availableMcpClients.filter((client) => client.configured);
  const mcp = await checkMcpServer({
    serverUrl: `http://${bridgeOptions.host || '127.0.0.1'}:${bridgeOptions.port || 17531}`,
    tokenPath
  });
  const wpsDiagnostics = await runWpsDiagnostics({
    jsaddonsDir,
    wpsAppPath,
    bridgeUrl: `http://${bridgeOptions.host || '127.0.0.1'}:${bridgeOptions.port || 17531}`,
    checkBridge: false,
    checkProcess: checkWpsProcess
  });
  const wpsDocuments = await readOpenWpsDocuments({ bridge, bridgeOptions, token });
  const documentation = await inspectPublicDocumentation(resolvedProjectRoot);
  const releaseArtifact = await inspectReleaseArtifact(resolvedProjectRoot);
  const launchAgentStatus = checkLaunchAgent
    ? {
      checked: true,
      ...(await readLaunchAgentStatus({ plistPath: launchAgentPath || defaultLaunchAgentPath() }))
    }
    : { checked: false, exists: false, plistPath: launchAgentPath || null };
  const launchAgent = {
    ok: launchAgentStatus.checked !== true || launchAgentStatus.exists !== true || (
      launchAgentStatus.label === DEFAULT_LAUNCH_AGENT_LABEL &&
      launchAgentStatus.containsLaunchctlInstruction !== true
    ),
    checked: launchAgentStatus.checked !== true ? false : true,
    configured: launchAgentStatus.exists === true,
    ...launchAgentStatus
  };
  const checks = {
      manifest: {
        ok: requiredSkills.length > 0,
        path: resolvedManifestPath,
        userFacingSkill: manifest.userFacingSkill || requiredSkills[0]?.name || null,
        requiredSkills: requiredSkills.map((skill) => skill.name)
      },
    skills: {
      ok: skillChecks.length > 0 && skillChecks.every((check) => check.ok),
      items: skillChecks
    },
    retiredSkills: {
      ok: retiredSkillChecks.every((check) => check.ok),
      items: retiredSkillChecks
    },
    wpsConfig: {
      ok: pluginConfig.installed === true && pluginAuth.valid !== false && pluginAuth.disabled !== true,
      auth: pluginAuth,
      ...pluginConfig
    },
    agentToken: {
      ok: Boolean(token),
      tokenPath,
      fileMode: token ? 'present' : 'missing'
    },
    mcpConfig: {
      ok: availableMcpClients.length === 0 || configuredMcpClients.length > 0,
      clients: mcpConfig.clients,
      configured: configuredMcpClients.map((client) => client.id)
    },
    bridge: {
      ok: bridge.running === true && bridge.managed === true && bridge.health?.ok === true,
      ...bridge
    },
    mcp: {
      ok: mcp.ok === true,
      ...mcp
    },
    documentation,
    releaseArtifact,
    launchAgent,
    wpsRuntime: {
      ok: true,
      installed: wpsDiagnostics.wpsApp.exists === true,
      app: wpsDiagnostics.wpsApp,
      process: wpsDiagnostics.process,
      recommendations: wpsDiagnostics.recommendations
    },
    wpsDocuments: {
      ok: true,
      ...wpsDocuments
    }
  };

  const nextSteps = [];
  if (!checks.skills.ok) {
    const drifted = checks.skills.items.some((item) => item.error === 'source-drift');
    nextSteps.push(drifted
      ? '检测到已安装 Skill 与仓库源文件不一致；运行 npm run install:skill 同步完整 Skill 集。'
      : '运行 npm run install:skill，安装 whitepaper-chief-editor 及其内部 WPS 执行 bundle。');
  }
  if (!checks.retiredSkills.ok) {
    nextSteps.push('检测到旧的顶层 whitepaper-wps-reviewer；运行 npm run install:skill 完成迁移并清理旧入口。');
  }
  if (!checks.wpsConfig.ok) nextSteps.push('运行 npm run setup，安装 WPS 运行配置并启动 bridge。');
  if (checks.wpsConfig.auth?.disabled) nextSteps.push('WPS 已禁用 Agent 审阅加载项；运行 npm run wps:authorize 后，在允许的窗口重启 WPS。');
  if (checks.wpsConfig.auth?.valid === false) nextSteps.push('WPS authaddin.json 格式损坏；请恢复该文件备份后再运行 npm run doctor。');
  if (!checks.agentToken.ok) nextSteps.push('安装凭据缺失；请运行 npm run setup 生成本机 token，再运行 npm run doctor。');
  if (!checks.mcpConfig.ok) nextSteps.push('尚未发现已配置的 Codex/Claude MCP；请运行 npm run setup，或运行 npm run mcp:install。');
  if (!checks.mcp.ok) nextSteps.push('MCP 服务自检失败；请确认发布包完整且 Node.js 版本满足要求，再运行 npm run doctor。');
  if (!checks.documentation.ok) nextSteps.push('README 包含已废弃的正文替换承诺；请清理公开文档后再发布。');
  if (checks.launchAgent.checked && !checks.launchAgent.configured) {
    nextSteps.push('尚未配置 bridge 登录后自启动；运行 npm run setup 写入本产品 LaunchAgent（不会执行 launchctl）。');
  } else if (!checks.launchAgent.ok) {
    nextSteps.push('本产品 LaunchAgent 配置异常；运行 npm run setup 重写，或运行 npm run launch-agent:uninstall 后重新安装。');
  }
  if (checks.releaseArtifact.status === 'release-build-in-progress') {
    nextSteps.push('release 正在构建中；等待发布锁释放后再运行 npm run doctor。');
  } else if (checks.releaseArtifact.status === 'stale-lock') {
    nextSteps.push('检测到过期的 release 锁；确认没有发布进程后重新运行 npm run release 清理并重建发布包。');
  } else if (!checks.releaseArtifact.ok) {
    nextSteps.push('release ZIP 与 manifest 不一致；请重新运行 npm run release 并核对发布包。');
  }
  if (!checks.wpsRuntime.installed) nextSteps.push('未检测到 WPS Office；安装 WPS 后再打开文章进行审阅。');
  if (checks.wpsRuntime.process?.running && checks.wpsConfig.ok) nextSteps.push('WPS 当前正在运行；若看不到 Agent 审阅，请在允许的窗口重启 WPS。');
  if (checks.wpsDocuments.checked && checks.wpsDocuments.count === 0) nextSteps.push('当前没有已注册的 WPS 文档；打开目标文章并进入 Agent 审阅后再让 Agent 读取正文。');
  if (!checks.bridge.ok) {
    if (bridge.running && bridge.health?.ok && bridge.managed !== true) {
      const pids = bridge.listenerPids?.length ? `（监听进程 PID：${bridge.listenerPids.join(', ')}）` : '';
      nextSteps.push(`检测到已有 bridge 正在占用目标端口${pids}，但它不由当前安装管理；请在允许的维护窗口关闭旧 bridge 后再运行 npm run setup。`);
    } else {
      nextSteps.push('运行 npm run bridge:start，或使用产品启动入口启动本地服务。');
    }
  }

  return {
    ok: Object.entries(checks)
      .filter(([name]) => !['wpsRuntime', 'wpsDocuments'].includes(name))
      .every(([, check]) => check.ok),
    checks,
    nextSteps
  };
}
