import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

function parseLines(buffer, onMessage) {
  let remaining = buffer;
  let newlineIndex = remaining.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = remaining.slice(0, newlineIndex).trim();
    remaining = remaining.slice(newlineIndex + 1);
    if (line) {
      try {
        onMessage(JSON.parse(line));
      } catch {
        // MCP writes JSON-RPC messages to stdout; ignore incomplete/noisy lines.
      }
    }
    newlineIndex = remaining.indexOf('\n');
  }
  return remaining;
}

export function checkMcpServer({
  projectRoot = PROJECT_ROOT,
  nodePath = process.execPath,
  serverUrl = 'http://127.0.0.1:17531',
  tokenPath = '',
  token = '',
  timeoutMs = 3000
} = {}) {
  const scriptPath = path.join(projectRoot, 'bin/wps-reviewer-mcp.mjs');
  if (!existsSync(scriptPath)) {
    return Promise.resolve({
      ok: false,
      checked: false,
      scriptPath,
      error: 'MCP server entry point is missing.'
    });
  }

  return new Promise((resolve) => {
    const child = spawn(nodePath, [scriptPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        WPS_REVIEWER_URL: serverUrl,
        ...(tokenPath ? { WPS_REVIEWER_TOKEN_FILE: tokenPath } : {}),
        ...(token ? { WPS_REVIEWER_TOKEN: token } : {})
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      resolve({
        checked: true,
        scriptPath,
        ...result,
        ...(stderr.trim() ? { stderr: stderr.trim().slice(-500) } : {})
      });
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuffer = parseLines(stdoutBuffer + chunk.toString('utf8'), (message) => {
        if (message.id !== 1 || !message.result?.serverInfo) return;
        const serverInfo = message.result.serverInfo;
        finish({
          ok: serverInfo.name === 'agent-wps-reviewer' && Boolean(serverInfo.version),
          serverInfo,
          ...(serverInfo.name === 'agent-wps-reviewer' && serverInfo.version
            ? {}
            : { error: 'MCP initialize returned an unexpected server identity.' })
        });
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish({ ok: false, error: error.message }));
    child.on('exit', (code, signal) => {
      if (!settled) finish({ ok: false, error: `MCP server exited before initialize (${code ?? signal}).` });
    });

    timer = setTimeout(() => finish({ ok: false, error: `MCP initialize timed out after ${timeoutMs}ms.` }), timeoutMs);
    child.stdin.end(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'agent-wps-reviewer-doctor', version: '1' }
      }
    })}\n`);
  });
}
