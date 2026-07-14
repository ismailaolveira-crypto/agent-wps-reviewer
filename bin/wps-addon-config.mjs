#!/usr/bin/env node
import {
  DEFAULT_PLUGIN_URL,
  installPluginConfig,
  readPluginConfigStatus,
  uninstallPluginConfig
} from '../src/wps/pluginConfig.mjs';
import { authorizePluginAuthFile, readPluginAuthStatus } from '../src/wps/pluginAuth.mjs';

function parseArgs(argv) {
  const args = { command: argv[0] || 'status' };
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'no-backup') {
      args.backup = false;
      continue;
    }
    args[name] = argv[i + 1];
    i += 1;
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  wps-addon-config status [--dir PATH]
  wps-addon-config install [--dir PATH] [--url URL] [--no-backup]
  wps-addon-config authorize [--dir PATH] [--url URL]
  wps-addon-config uninstall [--dir PATH] [--no-backup]

Default URL: ${DEFAULT_PLUGIN_URL}
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'help' || args.command === '--help') {
  printHelp();
  process.exit(0);
}

const options = {
  jsaddonsDir: args.dir,
  pluginUrl: args.url || DEFAULT_PLUGIN_URL,
  backup: args.backup !== false
};

let result;
if (args.command === 'status') {
  result = {
    ...(await readPluginConfigStatus(options)),
    auth: await readPluginAuthStatus(options)
  };
} else if (args.command === 'install') {
  result = await installPluginConfig(options);
} else if (args.command === 'authorize') {
  result = await authorizePluginAuthFile(options);
} else if (args.command === 'uninstall') {
  result = await uninstallPluginConfig(options);
} else {
  console.error(`Unknown command: ${args.command}`);
  printHelp();
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
