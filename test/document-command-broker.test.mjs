import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentCommandBroker } from '../src/bridge/documentCommandBroker.mjs';

test('broker routes a command to one WPS client and resolves it', async () => {
  const broker = new DocumentCommandBroker();
  const seen = [];

  broker.subscribe('wps-1', (command) => {
    seen.push(command);
    broker.resolve(command.id, { text: '正文', nextOffset: 2, done: true });
  });

  const result = await broker.request({
    clientId: 'wps-1',
    type: 'document.read',
    payload: { documentHandle: 'doc-a' },
    timeoutMs: 100
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'document.read');
  assert.equal(result.text, '正文');
  assert.equal(broker.pendingCount, 0);
});

test('broker rejects a timed out read and removes pending state', async () => {
  const broker = new DocumentCommandBroker();

  await assert.rejects(
    broker.request({ clientId: 'missing', type: 'document.read', payload: {}, timeoutMs: 10 }),
    /timed out/
  );
  assert.equal(broker.pendingCount, 0);
});

test('broker can stream commands and resolve from a later result', async () => {
  const broker = new DocumentCommandBroker();
  const commands = [];

  broker.subscribe('wps-1', (command) => {
    commands.push(command);
  });

  const pending = broker.request({ clientId: 'wps-1', type: 'document.read', timeoutMs: 100 });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(commands.length, 1);
  assert.equal(broker.resolve(commands[0].id, { ok: true }), true);
  assert.deepEqual(await pending, { ok: true });
});
