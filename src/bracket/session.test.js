import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeInferenceKey } from '../session.js';

test('inference keys are slt_ but not mgmt or provider', () => {
  assert.equal(looksLikeInferenceKey('slt_abcdefghijklmnopqrstuv'), true);
  assert.equal(looksLikeInferenceKey('slt_mgmt_abc'), false);
  assert.equal(looksLikeInferenceKey('slt_provider_abc'), false);
  assert.equal(looksLikeInferenceKey('sk-openai'), false);
  assert.equal(looksLikeInferenceKey('eyJhbGciOiJIUzI1NiJ9.aa.bb'), false);
});
