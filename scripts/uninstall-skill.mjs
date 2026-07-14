#!/usr/bin/env node
import { uninstallProductionSkills } from '../src/install/skillInstall.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--skill-target' && argv[index + 1]) args.targetRoots = [argv[++index]];
    else if (argv[index] === '--restore-backup') args.restoreBackup = true;
  }
  return args;
}

try {
  const result = await uninstallProductionSkills(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    nextSteps: ['确认目标 Skill 根目录后再重试；如需恢复上一版本，请显式传入 --restore-backup。']
  }, null, 2));
  process.exitCode = 1;
}
