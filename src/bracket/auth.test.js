import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveBracketAuth } from './auth.js';
import { writeStoredKey } from './key.js';

const FILE_KEY = 'slt_filekeystoredherewxyz';
const DEAD_ENV = 'slt_deadenvkeyxxxxxxxx';

function withConfigDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-bauth-'));
  const prev = {
    config: process.env.SCALATTICE_CONFIG_DIR,
    api: process.env.SCALATTICE_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    fetch: globalThis.fetch,
  };
  process.env.SCALATTICE_CONFIG_DIR = root;
  delete process.env.SCALATTICE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => {
      globalThis.fetch = prev.fetch;
      if (prev.config === undefined) delete process.env.SCALATTICE_CONFIG_DIR;
      else process.env.SCALATTICE_CONFIG_DIR = prev.config;
      if (prev.api === undefined) delete process.env.SCALATTICE_API_KEY;
      else process.env.SCALATTICE_API_KEY = prev.api;
      if (prev.openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev.openai;
    });
}

function mockModels(accepted) {
  globalThis.fetch = async (_url, opts) => {
    const token = String(opts?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    if (accepted.has(token)) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen-3-8b' }] }) };
    }
    return { ok: false, status: 401, json: async () => ({}), text: async () => '' };
  };
}

test('dead env inference key falls back to bracket.key', async () => {
  await withConfigDir(async () => {
    writeStoredKey(FILE_KEY);
    process.env.SCALATTICE_API_KEY = DEAD_ENV;
    mockModels(new Set([FILE_KEY]));
    const auth = await resolveBracketAuth({
      apiUrl: 'https://api.scalattice.cloud/v1',
      apiKey: DEAD_ENV,
      sessionToken: '',
      mgmtKey: '',
    });
    assert.equal(auth.apiKey, FILE_KEY);
    assert.equal(auth.keySource, 'bracket.key');
    assert.match(auth.authNote, /Ignored/);
  });
});

test('working env key still wins', async () => {
  await withConfigDir(async () => {
    writeStoredKey(FILE_KEY);
    mockModels(new Set([DEAD_ENV, FILE_KEY]));
    const auth = await resolveBracketAuth({
      apiUrl: 'https://api.scalattice.cloud/v1',
      apiKey: DEAD_ENV,
      sessionToken: '',
      mgmtKey: '',
    });
    assert.equal(auth.apiKey, DEAD_ENV);
    assert.equal(auth.keySource, 'env');
    assert.equal(auth.authNote, '');
  });
});
