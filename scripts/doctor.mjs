#!/usr/bin/env node
import { installPluginConfig } from '../src/wps/pluginConfig.mjs';
import { installProductionSkills } from '../src/install/skillInstall.mjs';
import { buildDoctorFixPlan, runDoctor } from '../src/install/doctor.mjs';
import { startBridge } from '../src/bridge/processControl.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--fix') {
      args.fix = true;
      continue;
    }
    if (key === '--skill-target' && argv[index + 1]) {
      args.skillTarget = argv[++index];
      continue;
    }
    if (key === '--jsaddons-dir' && argv[index + 1]) {
      args.jsaddonsDir = argv[++index];
      continue;
    }
    if (key === '--port' && argv[index + 1]) {
      args.port = Number(argv[++index]);
      continue;
    }
    if (key === '--runtime-dir' && argv[index + 1]) {
      args.runtimeDir = argv[++index];
      continue;
    }
    if (key === '--data-dir' && argv[index + 1]) {
      args.dataDir = argv[++index];
      continue;
    }
    if (key === '--pid-file' && argv[index + 1]) {
      args.pidFile = argv[++index];
      continue;
    }
    if (key === '--log-file' && argv[index + 1]) {
      args.logFile = argv[++index];
      continue;
    }
    if (key === '--launch-agent-path' && argv[index + 1]) {
      args.launchAgentPath = argv[++index];
      continue;
    }
    if (key === '--wps-app' && argv[index + 1]) {
      args.wpsAppPath = argv[++index];
      continue;
    }
    if (key === '--no-wps-process') {
      args.checkWpsProcess = false;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const skillRoots = args.skillTarget ? [args.skillTarget] : undefined;
const bridgeOptions = {
  ...(args.port ? { port: args.port } : {}),
  ...(args.runtimeDir ? { runtimeDir: args.runtimeDir } : {}),
  ...(args.dataDir ? { dataDir: args.dataDir } : {}),
  ...(args.pidFile ? { pidFile: args.pidFile } : {}),
  ...(args.logFile ? { logFile: args.logFile } : {})
};
const changes = [];
const doctorOptions = {
  ...(skillRoots ? { skillRoots } : {}),
  jsaddonsDir: args.jsaddonsDir,
  bridgeOptions,
  wpsAppPath: args.wpsAppPath,
  checkWpsProcess: args.checkWpsProcess !== false,
  checkLaunchAgent: true,
  launchAgentPath: args.launchAgentPath
};

if (args.fix) {
  const before = await runDoctor(doctorOptions);
  const fixPlan = buildDoctorFixPlan(before.checks);
  if (fixPlan.installSkills) {
    changes.push({ component: 'skills', ...(await installProductionSkills({
      ...(skillRoots ? { targetRoots: skillRoots } : {})
    })) });
  }
  if (fixPlan.installWpsConfig) {
    changes.push({ component: 'wps-config', ...(await installPluginConfig({ jsaddonsDir: args.jsaddonsDir })) });
  }
  if (fixPlan.startBridge) {
    changes.push({ component: 'bridge', ...(await startBridge(bridgeOptions)) });
  }
  changes.push(...fixPlan.skipped.map((item) => ({ ...item, skipped: true })));
}

const result = await runDoctor(doctorOptions);
console.log(JSON.stringify({ ...result, changes }, null, 2));
if (!result.ok) process.exitCode = 1;
