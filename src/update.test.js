import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyUpdate,
  checkForUpdate,
  cmpSemver,
  maybeAutoUpdate,
  npmPrefixFromPkgRoot,
  resolveNpm,
  rewritePortableWrappers,
} from './update.js';

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

test('resolveNpm prefers the Node-bundled npm-cli.js', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-npm-'));
  try {
    const execPath = path.join(dir, 'node.exe');
    const cliJs = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    fs.mkdirSync(path.dirname(cliJs), { recursive: true });
    fs.writeFileSync(execPath, '');
    fs.writeFileSync(cliJs, '');
    const npm = resolveNpm(execPath, 'win32');
    assert.equal(npm.command, execPath);
    assert.deepEqual(npm.args, [cliJs]);
    assert.equal(npm.shell, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveNpm falls back to npm.cmd with a shell on Windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-npm-'));
  try {
    const execPath = path.join(dir, 'node.exe');
    const cmd = path.join(dir, 'npm.cmd');
    fs.writeFileSync(execPath, '');
    fs.writeFileSync(cmd, '');
    const npm = resolveNpm(execPath, 'win32');
    assert.equal(npm.command, cmd);
    assert.deepEqual(npm.args, []);
    assert.equal(npm.shell, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveNpm on unix uses nvm/Homebrew npm-cli.js without a shell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-npm-unix-'));
  try {
    const bin = path.join(dir, 'bin');
    const execPath = path.join(bin, 'node');
    const cliJs = path.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.dirname(cliJs), { recursive: true });
    fs.writeFileSync(execPath, '');
    fs.writeFileSync(cliJs, '');
    for (const platform of ['linux', 'darwin']) {
      const npm = resolveNpm(execPath, platform);
      assert.equal(npm.command, execPath);
      assert.deepEqual(npm.args, [cliJs]);
      assert.equal(npm.shell, false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveNpm on unix falls back to npm without a shell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-npm-unix-'));
  try {
    const execPath = path.join(dir, 'node');
    fs.writeFileSync(execPath, '');
    const npm = resolveNpm(execPath, 'linux');
    assert.equal(npm.command, 'npm');
    assert.deepEqual(npm.args, []);
    assert.equal(npm.shell, false);
    const mac = resolveNpm(execPath, 'darwin');
    assert.equal(mac.command, 'npm');
    assert.equal(mac.shell, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rewritePortableWrappers is a no-op for a system Node on unix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-wrap-unix-'));
  try {
    const execPath = path.join(dir, 'usr', 'bin', 'node');
    const cli = path.join(dir, 'lib', 'node_modules', 'scalattice-cli', 'bin', 'scalattice.js');
    fs.mkdirSync(path.dirname(execPath), { recursive: true });
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(execPath, '');
    fs.writeFileSync(cli, '');
    assert.equal(rewritePortableWrappers(dir, { execPath, platform: 'linux' }), false);
    assert.equal(rewritePortableWrappers(dir, { execPath, platform: 'darwin' }), false);
    assert.equal(fs.existsSync(path.join(dir, 'bin', 'scalattice')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rewritePortableWrappers writes a unix shim for the private runtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-wrap-xdg-'));
  try {
    const dataHome = path.join(dir, 'share');
    const nodeHome = path.join(dataHome, 'scalattice', 'runtime', 'node', 'bin');
    const prefix = path.join(dir, 'prefix');
    const cli = path.join(prefix, 'lib', 'node_modules', 'scalattice-cli', 'bin', 'scalattice.js');
    fs.mkdirSync(nodeHome, { recursive: true });
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    const execPath = path.join(nodeHome, 'node');
    fs.writeFileSync(execPath, '');
    fs.writeFileSync(cli, '');
    assert.equal(rewritePortableWrappers(prefix, { execPath, platform: 'linux', dataHome }), true);
    const sh = fs.readFileSync(path.join(prefix, 'bin', 'scalattice'), 'utf8');
    assert.match(sh, /#!/);
    assert.match(sh, /scalattice\.js/);
    assert.match(sh, /runtime\/node\/bin/);
    fs.writeFileSync(cli, 'export const ok = 1;\n');
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    fs.rmSync(path.join(prefix, 'bin', 'scalattice'));
    fs.symlinkSync(cli, path.join(prefix, 'bin', 'scalattice'));
    assert.equal(rewritePortableWrappers(prefix, { execPath, platform: 'linux', dataHome }), true);
    assert.match(fs.readFileSync(path.join(prefix, 'bin', 'scalattice'), 'utf8'), /#!/);
    assert.equal(fs.readFileSync(cli, 'utf8'), 'export const ok = 1;\n');
    assert.equal(fs.lstatSync(path.join(prefix, 'bin', 'scalattice')).isSymbolicLink(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rewritePortableWrappers restores Windows shims for the private runtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-wrap-'));
  try {
    const nodeHome = path.join(dir, 'runtime', 'node');
    const cli = path.join(dir, 'node_modules', 'scalattice-cli', 'bin', 'scalattice.js');
    fs.mkdirSync(nodeHome, { recursive: true });
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    const execPath = path.join(nodeHome, 'node.exe');
    fs.writeFileSync(execPath, '');
    fs.writeFileSync(cli, '');
    assert.equal(rewritePortableWrappers(dir, { execPath, platform: 'win32' }), true);
    const cmd = fs.readFileSync(path.join(dir, 'scalattice.cmd'), 'utf8');
    assert.match(cmd, /@echo off/);
    assert.match(cmd, /node\.exe/);
    assert.match(cmd, /scalattice\.js/);
    const sh = fs.readFileSync(path.join(dir, 'scalattice'), 'utf8');
    assert.match(sh, /#!/);
    assert.equal(
      rewritePortableWrappers(dir, { execPath: path.join(dir, 'elsewhere', 'node'), platform: 'win32' }),
      false
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
