import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  SCALATTICE_PROVIDER_ID,
  addProvider,
  formatProviderList,
  getActiveProvider,
  loadProviderStore,
  normalizeApiUrl,
  removeProvider,
  setActiveProviderKey,
  useProvider,
} from './providers.js';
import { looksLikeInferenceKey } from '../session.js';
import { writeStoredKey } from './key.js';

function withConfigDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-bprov-'));
  const prev = {
    config: process.env.SCALATTICE_CONFIG_DIR,
    api: process.env.SCALATTICE_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  process.env.SCALATTICE_CONFIG_DIR = root;
  delete process.env.SCALATTICE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return fn(root);
  } finally {
    if (prev.config === undefined) delete process.env.SCALATTICE_CONFIG_DIR;
    else process.env.SCALATTICE_CONFIG_DIR = prev.config;
    if (prev.api === undefined) delete process.env.SCALATTICE_API_KEY;
    else process.env.SCALATTICE_API_KEY = prev.api;
    if (prev.openai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev.openai;
  }
}

test('normalizeApiUrl adds https and /v1', () => {
  assert.equal(normalizeApiUrl('api.openai.com'), 'https://api.openai.com/v1');
  assert.equal(normalizeApiUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1');
});

test('store always includes undeletable scalattice', () => {
  withConfigDir(() => {
    const store = loadProviderStore();
    assert.equal(store.active, SCALATTICE_PROVIDER_ID);
    assert.equal(store.providers[0].id, SCALATTICE_PROVIDER_ID);
    assert.equal(store.providers[0].builtin, true);
    assert.throws(() => removeProvider('scalattice'), /cannot be removed/);
  });
});

test('add use and remove custom providers; switch back to scalattice', () => {
  withConfigDir(() => {
    const rec = addProvider({
      name: 'OpenAI',
      url: 'https://api.openai.com/v1',
      key: 'sk-testkey123456',
      model: 'gpt-4.1',
    });
    assert.equal(rec.id, 'openai');
    assert.equal(rec.apiUrl, 'https://api.openai.com/v1');
    useProvider('openai');
    assert.equal(getActiveProvider().id, 'openai');
    const listed = formatProviderList();
    assert.match(listed, /\* openai/);
    assert.match(listed, /cannot be removed/);
    assert.match(listed, /\/provider key set/);
    assert.doesNotMatch(listed, /\/key set/);
    removeProvider('openai');
    assert.equal(getActiveProvider().id, SCALATTICE_PROVIDER_ID);
    assert.equal(loadProviderStore().providers.length, 1);
  });
});

test('addProvider takes name and url only; a short third token is not a key', () => {
  withConfigDir(() => {
    const rec = addProvider({ name: 'Steven', url: 'steven.com' });
    assert.equal(rec.id, 'steven');
    assert.equal(rec.apiUrl, 'https://steven.com/v1');
    assert.equal(rec.key || '', '');
  });
});

test('setActiveProviderKey writes scalattice bracket.key', () => {
  withConfigDir((root) => {
    const secret = 'slt_manualsetkeyxxxxxxxx';
    assert.ok(looksLikeInferenceKey(secret));
    setActiveProviderKey(secret);
    const file = path.join(root, 'bracket.key');
    assert.equal(fs.readFileSync(file, 'utf8').trim(), secret);
    writeStoredKey(secret);
    assert.equal(getActiveProvider().id, SCALATTICE_PROVIDER_ID);
  });
});
