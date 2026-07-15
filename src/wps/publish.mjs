import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { quoteWindowsArgument, windowsCommandShell } from '../platform.mjs';

export const WPSJS_VERSION = '2.2.3';

function defaultRunner(command, args, options = {}) {
  const isWindowsScript = options.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const executable = isWindowsScript ? windowsCommandShell({ env: options.env }) : command;
  const commandArgs = isWindowsScript
    ? ['/d', '/s', '/c', [quoteWindowsArgument(command), ...args.map(quoteWindowsArgument)].join(' ')]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true
  });
  return {
    code: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error || null
  };
}

export function inspectWpsPublishArtifacts({ outputDir, platform = process.platform } = {}) {
  const root = outputDir ? path.resolve(outputDir) : '';
  const publishHtml = root ? path.join(root, 'publish.html') : '';
  const publishXml = root ? path.join(root, 'publish.xml') : '';
  return {
    platform,
    outputDir: root,
    publishHtml,
    publishXml,
    publishHtmlExists: Boolean(publishHtml && existsSync(publishHtml)),
    publishXmlExists: Boolean(publishXml && existsSync(publishXml)),
    publishReady: Boolean(publishHtml && existsSync(publishHtml) && publishXml && existsSync(publishXml)),
    trustPending: true,
    trusted: false
  };
}

export function buildWpsPublishCommand({ command = 'wpsjs', outputDir, platform = process.platform } = {}) {
  return {
    command,
    args: ['publish', ...(outputDir ? ['--output', outputDir] : [])],
    expectedVersion: WPSJS_VERSION,
    platform
  };
}

export function runWpsPublish({
  command = process.env.WPSJS_COMMAND || 'wpsjs',
  outputDir,
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  runner = defaultRunner
} = {}) {
  const spec = buildWpsPublishCommand({ command, outputDir, platform });
  const result = runner(spec.command, spec.args, { cwd, env, platform });
  const artifacts = inspectWpsPublishArtifacts({ outputDir, platform });
  return {
    ok: result.error == null && result.code === 0 && artifacts.publishReady,
    command: spec,
    artifacts,
    trustPending: artifacts.trustPending,
    trusted: false,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.code || undefined
  };
}
