import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  defaultAgentTokenPath,
  ensureAgentToken,
  readAgentToken,
  resolveAgentTokenPath
} from '../src/install/agentToken.mjs';

test('agent token generation is idempotent and owner-only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wps-agent-token-'));
  const tokenPath = path.join(root, 'private', 'agent-token');

  try {
    const first = await ensureAgentToken({ tokenPath });
    const firstToken = await readAgentToken({ tokenPath });
    const second = await ensureAgentToken({ tokenPath });
    const fileStats = await stat(tokenPath);
    const parentStats = await stat(path.dirname(tokenPath));

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(firstToken, second.token);
    assert.match(firstToken, /^[a-f0-9]{64}$/);
    assert.equal(fileStats.mode & 0o777, 0o600);
    assert.equal(parentStats.mode & 0o777, 0o700);
    assert.equal((await readFile(tokenPath, 'utf8')).trim(), firstToken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent token path resolution supports explicit files and platform defaults', () => {
  assert.equal(resolveAgentTokenPath('/tmp/custom-agent-token'), '/tmp/custom-agent-token');
  assert.equal(
    defaultAgentTokenPath({ homeDir: '/tmp/home', platform: 'darwin' }),
    '/tmp/home/Library/Application Support/Agent WPS Reviewer/agent-token'
  );
  assert.equal(
    defaultAgentTokenPath({ homeDir: '/tmp/home', platform: 'linux' }),
    '/tmp/home/.config/agent-wps-reviewer/agent-token'
  );
  assert.equal(
    defaultAgentTokenPath({ homeDir: 'C:\\Users\\reviewer', platform: 'win32' }),
    path.join('C:\\Users\\reviewer', 'AppData/Local/Agent WPS Reviewer/agent-token')
  );
});
