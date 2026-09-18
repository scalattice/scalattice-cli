import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyUpdate, checkForUpdate, cmpSemver, maybeAutoUpdate, npmPrefixFromPkgRoot } from './update.js';

test('cmpSemver orders dotted versions', () => {
  assert.equal(cmpSemver('0.3.3', '0.3.2'), 1);
  assert.equal(cmpSemver('0.3.2', '0.3.3'), -1);
  assert.equal(cmpSemver('0.3.3', '0.3.3'), 0);
  assert.equal(cmpSemver('1.0.0', '0.9.9'), 1);
});

test('npmPrefixFromPkgRoot reads global layouts', () => {
  assert.equal(
    npmPrefixFromPkgRoot('/home/me/.local/lib/node_modules/scalattice-cli'),
    '/home/me/.local'
  );
  assert.equal(
    npmPrefixFromPkgRoot('/usr/local/lib/node_modules/scalattice-cli'),
    '/usr/local'
  );
  assert.equal(
    npmPrefixFromPkgRoot('C:/Users/me/AppData/Roaming/npm/node_modules/scalattice-cli'),
    'C:/Users/me/AppData/Roaming/npm'
  );
  assert.equal(npmPrefixFromPkgRoot('/srv/robottik/scalattice/scalattice-cli'), '');
});

test('maybeAutoUpdate skips when disabled or not a TTY', async () => {
  const fetchImpl = async () => {
    throw new Error('should not fetch');
  };
  const skipped = await maybeAutoUpdate({
    cmd: 'whoami',
    tty: false,
    fetchImpl,
    env: {},
  });
  assert.equal(skipped.skipped, true);

  const off = await maybeAutoUpdate({
    cmd: 'whoami',
    tty: true,
    fetchImpl,
    env: { SCALATTICE_NO_UPDATE: '1' },
  });
  assert.equal(off.skipped, true);

  const mcp = await maybeAutoUpdate({
    cmd: 'mcp',
    tty: true,
    fetchImpl,
    env: {},
  });
  assert.equal(mcp.skipped, true);
});

test('maybeAutoUpdate installs and relaunches when npm is newer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-upd-'));
  const prev = process.env.SCALATTICE_CONFIG_DIR;
  process.env.SCALATTICE_CONFIG_DIR = dir;
  const calls = [];
  try {
    const info = await maybeAutoUpdate({
      argv: ['whoami'],
      cmd: 'whoami',
      tty: true,
      env: {},
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ version: '9.9.9' }),
      }),
      install: () => {
        calls.push('install');
      },
      relaunch: (argv) => {
        calls.push(['relaunch', argv]);
      },
      now: () => Date.parse('2026-09-18T00:00:00.000Z'),
      prefix: dir,
    });
    assert.equal(info.newer, true);
    assert.deepEqual(calls[0], 'install');
    assert.deepEqual(calls[1], ['relaunch', ['whoami']]);
  } finally {
    if (prev == null) delete process.env.SCALATTICE_CONFIG_DIR;
    else process.env.SCALATTICE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkForUpdate caches the registry lookup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-upd-'));
  const prev = process.env.SCALATTICE_CONFIG_DIR;
  process.env.SCALATTICE_CONFIG_DIR = dir;
  let hits = 0;
  const fetchImpl = async () => {
    hits += 1;
    return { ok: true, json: async () => ({ version: '8.1.0' }) };
  };
  try {
    const first = await checkForUpdate({
      force: true,
      fetchImpl,
      now: () => Date.parse('2026-09-18T00:00:00.000Z'),
    });
    const second = await checkForUpdate({
      fetchImpl,
      now: () => Date.parse('2026-09-18T01:00:00.000Z'),
    });
    assert.equal(first.latest, '8.1.0');
    assert.equal(second.latest, '8.1.0');
    assert.equal(hits, 1);
  } finally {
    if (prev == null) delete process.env.SCALATTICE_CONFIG_DIR;
    else process.env.SCALATTICE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyUpdate refuses a non-npm checkout', async () => {
  await assert.rejects(() => applyUpdate({ install() {}, relaunch() {} }), /not an npm install/);
});
