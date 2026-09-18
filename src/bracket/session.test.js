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

test('auth hints name developer keys, not a git checkout', async () => {
  const { bracketAuthHint, wrongKeyHint } = await import('../session.js');
  const hint = bracketAuthHint({ cloudUrl: 'https://scalattice.cloud' });
  assert.match(hint, /developer key \(slt_…\)/);
  assert.match(hint, /slt_mgmt_/);
  assert.doesNotMatch(hint, /checkout/);
  assert.doesNotMatch(hint, /node \.\/bin/);
  assert.match(hint, /SCALATTICE_API_KEY/);
  assert.doesNotMatch(hint, /OPENAI_API_KEY/);
  assert.equal(
    wrongKeyHint('slt_mgmt_abc'),
    'That is an account management key (slt_mgmt_…). Bracket needs a developer inference key (slt_…).'
  );
});
