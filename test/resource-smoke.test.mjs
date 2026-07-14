import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smokeWpsResources } from '../src/acceptance/resourceSmoke.mjs';

test('smokeWpsResources verifies WPS add-in resources', async () => {
  const result = await smokeWpsResources();

  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.equal(result.resources.some((item) => item.path === '/WpsAgentReviewer/'), true);
  assert.equal(result.resources.some((item) => item.path === '/WpsAgentReviewer/ribbon.xml'), true);
  assert.equal(result.resources.some((item) => item.path === '/WpsAgentReviewer/main.js'), true);
  assert.equal(result.resources.some((item) => item.path === '/addin/taskpane.html'), true);
  assert.equal(result.resources.some((item) => item.path === '/addin/wps-adapter.js'), true);
});

test('smokeWpsResources reports missing required content', async () => {
  const result = await smokeWpsResources({
    checks: [
      {
        path: '/addin/taskpane.html',
        type: 'text/html',
        includes: ['definitely-not-present']
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.resources[0].missing, ['definitely-not-present']);
});
