import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgentAuthHeaders,
  isAgentAuthorized,
  readAgentTokenFromRequest
} from '../src/bridge/auth.mjs';

test('readAgentTokenFromRequest supports bearer and explicit headers', () => {
  assert.equal(
    readAgentTokenFromRequest({ headers: { authorization: 'Bearer abc' } }),
    'abc'
  );
  assert.equal(
    readAgentTokenFromRequest({ headers: { 'x-wps-reviewer-token': 'xyz' } }),
    'xyz'
  );
});

test('isAgentAuthorized allows missing configured token and validates configured token', () => {
  assert.equal(isAgentAuthorized({ headers: {} }, ''), true);
  assert.equal(isAgentAuthorized({ headers: { authorization: 'Bearer abc' } }, 'abc'), true);
  assert.equal(isAgentAuthorized({ headers: { authorization: 'Bearer wrong' } }, 'abc'), false);
});

test('buildAgentAuthHeaders returns both accepted token header shapes', () => {
  assert.deepEqual(buildAgentAuthHeaders('abc'), {
    authorization: 'Bearer abc',
    'x-wps-reviewer-token': 'abc'
  });
  assert.deepEqual(buildAgentAuthHeaders(''), {});
});
