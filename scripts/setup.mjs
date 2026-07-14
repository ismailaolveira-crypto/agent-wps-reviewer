#!/usr/bin/env node
import { installLocalProduct } from '../src/install/localInstall.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--dir' && argv[index + 1]) args.jsaddonsDir = argv[++index];
    else if (key === '--skill-target' && argv[index + 1]) args.skillTargetRoots = [argv[++index]];
    else if (key === '--port' && argv[index + 1]) args.port = Number(argv[++index]);
    else if (key === '--no-launch-agent') args.configureLaunchAgent = false;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
try {
  const result = await installLocalProduct({
    ...args,
    startBridgeAfterInstall: true,
    runReadiness: false,
    configureMcp: true,
    configureLaunchAgent: args.configureLaunchAgent !== false
  });

  console.log(JSON.stringify({
    ...result,
    userFacingNextSteps: [
      '如果 WPS 中没有出现 Agent 审阅，请在允许的窗口重启 WPS。',
      '在 Agent 中调用 whitepaper-chief-editor 开始审稿。',
      args.port
        ? `运行 npm run doctor -- --port ${args.port} 查看安装和 bridge 状态。`
        : '运行 npm run doctor 查看安装和 bridge 状态。'
    ]
  }, null, 2));

  if (!result.ok) process.exitCode = 1;
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
  process.exitCode = 1;
}
