import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  BRACKET_KEY_NAME,
  deleteStoredKey,
  formatBracketKeyStatus,
  formatRevokeResult,
  formatRollResult,
  inspectBracketKey,
  lastFourOf,
  pickBracketCloudKey,
  writeStoredKey,
} from './key.js';

const SECRET = 'slt_abcdefghijklmnopqrstuvwx';

function withConfigDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-bkey-'));
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

test('inspect prefers env over bracket.key and never needs the resolved auth object', () => {
  withConfigDir((root) => {
    writeStoredKey(SECRET);
    const file = inspectBracketKey();
    assert.equal(file.source, 'bracket.key');
    assert.equal(file.lastFour, 'uvwx');
    assert.equal(file.path, path.join(root, 'bracket.key'));
    assert.equal(file.envWins, false);

    process.env.SCALATTICE_API_KEY = 'slt_envkeyfromshellzzzz';
    const env = inspectBracketKey();
    assert.equal(env.source, 'env');
    assert.equal(env.envWins, true);
    assert.equal(env.lastFour, 'zzzz');
    assert.equal(env.storedLastFour, 'uvwx');
  });
});

test('format hides the full secret unless showSecret', () => {
  const info = {
    source: 'bracket.key',
    envWins: false,
    secret: SECRET,
    storedKey: SECRET,
    path: '/tmp/bracket.key',
    lastFour: 'uvwx',
    storedLastFour: 'uvwx',
    provider: { id: 'scalattice', name: 'Scalattice', builtin: true },
  };
  const hidden = formatBracketKeyStatus(info);
  assert.match(hidden, /Source:  bracket\.key/);
  assert.match(hidden, /…uvwx/);
  assert.doesNotMatch(hidden, /slt_abcdefghijklmnopqrstuvwx/);
  const shown = formatBracketKeyStatus(info, { showSecret: true });
  assert.match(shown, /Full:    slt_abcdefghijklmnopqrstuvwx/);
});

test('pickBracketCloudKey matches last four, then the CLI bracket name', () => {
  const keys = [
    { id: '1', name: 'other', lastFour: 'aaaa', status: 'active' },
    { id: '2', name: BRACKET_KEY_NAME, lastFour: 'uvwx', status: 'active' },
  ];
  assert.equal(pickBracketCloudKey(keys, SECRET).id, '2');
  assert.equal(pickBracketCloudKey(keys, '').name, BRACKET_KEY_NAME);
  assert.equal(pickBracketCloudKey(keys, 'slt_nomatchxxxxkeyxx').id, '2');
});

test('roll and revoke formatters keep the secret out of the default text', () => {
  const rolled = formatRollResult({
    action: 'rolled',
    secret: SECRET,
    path: '/tmp/bracket.key',
    envWins: true,
    cloud: { id: 'abc', name: BRACKET_KEY_NAME },
  });
  assert.match(rolled, /Rolled "CLI bracket"  abc/);
  assert.match(rolled, /…uvwx/);
  assert.match(rolled, /SCALATTICE_API_KEY is set/);
  assert.doesNotMatch(rolled, /slt_abcdefghijklmnopqrstuvwx/);
  const shown = formatRollResult(
    { action: 'created', secret: SECRET, path: '/tmp/bracket.key', envWins: false, cloud: null },
    { showSecret: true }
  );
  assert.match(shown, /Created "CLI bracket"/);
  assert.match(shown, /Full:    slt_abcdefghijklmnopqrstuvwx/);

  const revoked = formatRevokeResult({
    cloud: { id: 'abc', name: BRACKET_KEY_NAME },
    hadFile: true,
    path: '/tmp/bracket.key',
    envWins: false,
  });
  assert.match(revoked, /Revoked "CLI bracket"  abc/);
  assert.match(revoked, /Deleted {2}\/tmp\/bracket\.key/);
});

test('writeStoredKey then deleteStoredKey', () => {
  withConfigDir((root) => {
    writeStoredKey(SECRET);
    const file = path.join(root, 'bracket.key');
    assert.equal(fs.readFileSync(file, 'utf8').trim(), SECRET);
    deleteStoredKey();
    assert.equal(fs.existsSync(file), false);
    deleteStoredKey();
  });
});

test('lastFourOf', () => {
  assert.equal(lastFourOf(SECRET), 'uvwx');
  assert.equal(lastFourOf(''), '');
});
