#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildWindowsTaskArgs, installLaunchAgent, uninstallLaunchAgent } from '../src/install/launchAgent.mjs';

const env = {
  USERPROFILE: 'C:\\Users\\reviewer',
  LOCALAPPDATA: 'C:\\Users\\reviewer\\AppData\\Local'
};
const calls = [];
const taskRunner = async (command, args) => {
  calls.push({ command, args });
  return args[0] === '/Query'
    ? { code: 0, stdout: '"Agent WPS Reviewer Bridge","Ready"', stderr: '' }
    : { code: 0, stdout: '', stderr: '' };
};
const task = buildWindowsTaskArgs({
  env,
  projectRoot: 'C:\\Users\\reviewer\\Downloads\\Agent WPS Reviewer (beta)',
  taskName: 'Agent WPS Reviewer Bridge'
});
assert.ok(task.create.includes('/RL') && task.create.includes('LIMITED'));
assert.match(task.command, /cmd\.exe/);
assert.match(task.command, /wps-bridge-control\.mjs/);
assert.doesNotMatch(task.command, /WPS_REVIEWER_AGENT_TOKEN=/i);

const installed = await installLaunchAgent({
  platform: 'win32',
  env,
  projectRoot: 'C:\\Users\\reviewer\\Downloads\\Agent WPS Reviewer (beta)',
  taskRunner
});
assert.equal(installed.ok, true);
await installed.rollback();
const removed = await uninstallLaunchAgent({ platform: 'win32', taskRunner });
assert.equal(removed.ok, true);

console.log(JSON.stringify({ ok: true, calls: calls.length, taskName: task.taskName }));
