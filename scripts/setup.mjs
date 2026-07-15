#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLocalProduct } from '../src/install/localInstall.mjs';
import { runDoctor } from '../src/install/doctor.mjs';
import { defaultProductInstallDir } from '../src/platform.mjs';
import { installStableWindowsBundle } from '../src/install/stableWindowsBundle.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--dir' && argv[index + 1]) args.jsaddonsDir = argv[++index];
    else if (key === '--skill-target' && argv[index + 1]) args.skillTargetRoots = [argv[++index]];
    else if (key === '--port' && argv[index + 1]) args.port = Number(argv[++index]);
    else if (key === '--no-launch-agent' || key === '--no-autostart') args.configureLaunchAgent = false;
  }
  return args;
}

async function bootstrapStableWindows(argv) {
  if (process.platform !== 'win32' || process.env.WPS_REVIEWER_STABLE_BOOTSTRAPPED === '1') return null;
  const targetRoot = defaultProductInstallDir({ platform: 'win32', env: process.env });
  const transaction = await installStableWindowsBundle({
    platform: 'win32',
    sourceRoot: PROJECT_ROOT,
    targetRoot
  });
  const child = spawn(process.execPath, [path.join(targetRoot, 'scripts/setup.mjs'), ...argv], {
    cwd: targetRoot,
    env: { ...process.env, WPS_REVIEWER_STABLE_BOOTSTRAPPED: '1' },
    stdio: 'inherit',
    windowsHide: true
  });
  let code = 1;
  try {
    [code] = await once(child, 'exit');
  } catch {
    code = 1;
  }
  if (code === 0) await transaction.cleanup();
  else await transaction.rollback();
  return code;
}

async function main() {
  const argv = process.argv.slice(2);
  const stableExit = await bootstrapStableWindows(argv);
  if (stableExit !== null) return stableExit;

  const args = parseArgs(argv);
  try {
    const result = await installLocalProduct({
      ...args,
      startBridgeAfterInstall: true,
      runReadiness: false,
      configureMcp: true,
      configureAutostart: args.configureLaunchAgent !== false
    });

    console.log(JSON.stringify({
      ...result,
      userFacingNextSteps: [
        process.platform === 'win32'
          ? 'Windows 首次安装请打开 WPS 官方 publish/trust 页面完成加载项信任；不要手动修改 authaddin.json。'
          : '如果 WPS 中没有出现 Agent 审阅，请在允许的窗口重启 WPS。',
        '在 Agent 中调用 whitepaper-chief-editor 开始审稿。',
        args.port
          ? `运行 npm run doctor -- --port ${args.port} 查看安装和 bridge 状态。`
          : '运行 npm run doctor 查看安装和 bridge 状态。'
      ]
    }, null, 2));

    const doctor = await runDoctor({
      platform: process.platform,
      jsaddonsDir: args.jsaddonsDir,
      skillRoots: args.skillTargetRoots,
      bridgeOptions: args.port ? { port: args.port } : {},
      checkLaunchAgent: true
    });
    console.log(JSON.stringify(doctor, null, 2));
    if (!result.ok || !doctor.ok) process.exitCode = 1;
    return process.exitCode || 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: error?.code || 'SETUP_FAILED',
        message
      },
      nextSteps: error?.code === 'BRIDGE_UNMANAGED_LISTENER'
        ? ['请在允许的维护窗口关闭占用目标端口的旧 bridge，再重新运行 npm run setup。']
        : ['请运行 npm run doctor 获取安装诊断。']
    }, null, 2));
    return 1;
  }
}

process.exitCode = await main();
