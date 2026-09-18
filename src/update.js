import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configDir } from './config.js';
import { print } from './io.js';

export const PKG_NAME = 'scalattice-cli';
const REGISTRY = `https://registry.npmjs.org/${PKG_NAME}/latest`;
const CHECK_MS = 6 * 60 * 60 * 1000;
const SKIP_CMDS = new Set(['mcp', 'init', 'update']);

function pkgRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function localVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgRoot(), 'package.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

export function cmpSemver(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function npmPrefixFromPkgRoot(root) {
  const norm = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const lib = norm.match(/^(.*)\/lib\/node_modules\/scalattice-cli$/i);
  if (lib) return lib[1];
  const win = norm.match(/^(.*)\/node_modules\/scalattice-cli$/i);
  if (win) return win[1];
  return '';
}

function updateStatePath() {
  return path.join(configDir(), 'update.json');
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(updateStatePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(patch) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = { ...readState(), ...patch };
  fs.writeFileSync(updateStatePath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function updatesDisabled(env = process.env, flags = {}) {
  if (flags.noUpdate) return true;
  const v = String(env.SCALATTICE_NO_UPDATE || '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (env.CI === 'true' || env.CI === '1') return true;
  return false;
}

export async function fetchLatest(fetchImpl = fetch, timeoutMs = 2500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(REGISTRY, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    const json = await res.json();
    const version = String(json.version || '').trim();
    if (!version) throw new Error('no version');
    return version;
  } finally {
    clearTimeout(t);
  }
}

function prefixWritable(prefix) {
  if (!prefix) return false;
  try {
    fs.accessSync(prefix, fs.constants.W_OK);
    const bin = path.join(prefix, 'bin');
    if (fs.existsSync(bin)) fs.accessSync(bin, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveNpm(execPath = process.execPath, platform = process.platform) {
  const dir = path.dirname(execPath);
  const cliJs = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p) => fs.existsSync(p));
  if (cliJs) {
    return { command: execPath, args: [cliJs], shell: false };
  }
  const script = platform === 'win32' ? 'npm.cmd' : 'npm';
  const bundled = path.join(dir, script);
  const command = fs.existsSync(bundled) ? bundled : script;
  return { command, args: [], shell: platform === 'win32' };
}

function posixPath(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function writeReplacing(dest, body, opts) {
  try {
    fs.lstatSync(dest);
    fs.unlinkSync(dest);
  } catch {
    // dest does not exist yet
  }
  fs.writeFileSync(dest, body, opts);
}

function portableNodeHomes(prefix, { platform = process.platform, dataHome } = {}) {
  const homes = [path.join(prefix, 'runtime', 'node')];
  if (platform !== 'win32') {
    const base = dataHome || process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    homes.push(path.join(base, 'scalattice', 'runtime', 'node'));
  }
  return homes;
}

function isPortableExec(execPath, prefix, opts = {}) {
  const resolved = path.resolve(path.dirname(execPath));
  return portableNodeHomes(prefix, opts).some(
    (home) => resolved === path.resolve(home) || resolved === path.resolve(home, 'bin')
  );
}

export function rewritePortableWrappers(
  prefix,
  { execPath = process.execPath, platform = process.platform, dataHome } = {}
) {
  if (!prefix) return false;
  if (!isPortableExec(execPath, prefix, { platform, dataHome })) return false;
  const cli = [
    path.join(prefix, 'node_modules', 'scalattice-cli', 'bin', 'scalattice.js'),
    path.join(prefix, 'lib', 'node_modules', 'scalattice-cli', 'bin', 'scalattice.js'),
  ].find((p) => fs.existsSync(p));
  if (!cli) return false;
  const node = path.resolve(execPath);
  const cliAbs = path.resolve(cli);
  const nodeHome = path.dirname(node);
  if (platform === 'win32') {
    writeReplacing(
      path.join(prefix, 'scalattice.cmd'),
      `@echo off\r\nsetlocal\r\nset "PATH=${path.resolve(nodeHome)};%PATH%"\r\n"${node}" "${cliAbs}" %*\r\n`
    );
    writeReplacing(
      path.join(prefix, 'scalattice'),
      `#!/bin/sh\nexport PATH="${posixPath(nodeHome)}:$PATH"\nexec "${posixPath(node)}" "${posixPath(cliAbs)}" "$@"\n`
    );
    return true;
  }
  const binDir = path.join(prefix, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  writeReplacing(
    path.join(binDir, 'scalattice'),
    `#!/bin/sh\nexport PATH="${posixPath(nodeHome)}:$PATH"\nexec "${posixPath(node)}" "${posixPath(cliAbs)}" "$@"\n`,
    { mode: 0o755 }
  );
  return true;
}

export function defaultInstall(prefix, { inherit = false, execPath = process.execPath, platform = process.platform } = {}) {
  const npm = resolveNpm(execPath, platform);
  const args = [
    ...npm.args,
    'install',
    '-g',
    '--no-fund',
    '--no-audit',
    '--prefer-online',
    '--prefix',
    prefix,
    `${PKG_NAME}@latest`,
  ];
  const r = spawnSync(npm.command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    shell: npm.shell,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${path.dirname(execPath)}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  if (r.error || r.status !== 0) {
    const err = String(r.error?.message || r.stderr || r.stdout || '').trim().slice(0, 600);
    throw new Error(err || `npm install failed (${r.status})`);
  }
  rewritePortableWrappers(prefix, { execPath, platform });
}

export function defaultRelaunch(argv) {
  const r = spawnSync(process.execPath, [process.argv[1], ...argv], {
    stdio: 'inherit',
    env: { ...process.env, SCALATTICE_NO_UPDATE: '1' },
  });
  process.exit(r.status == null ? 1 : r.status);
}

function hintLine(latest) {
  return `A newer CLI is out (${latest}). Update: scalattice update`;
}

export async function checkForUpdate({
  force = false,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const current = localVersion();
  const state = readState();
  const age = now() - Date.parse(state.checkedAt || 0);
  let latest = state.latest || '';
  if (force || !latest || !Number.isFinite(age) || age > CHECK_MS) {
    latest = await fetchLatest(fetchImpl);
    writeState({ checkedAt: new Date(now()).toISOString(), latest, current });
  }
  return {
    current,
    latest,
    newer: Boolean(latest && current && cmpSemver(latest, current) > 0),
  };
}

export async function applyUpdate({
  inherit = false,
  install = defaultInstall,
  relaunch = defaultRelaunch,
  argv = [],
  restart = false,
  prefix = npmPrefixFromPkgRoot(pkgRoot()),
} = {}) {
  if (!prefix) {
    throw new Error(
      `This copy of ${PKG_NAME} is not an npm install. Run: npm install -g ${PKG_NAME}@latest`
    );
  }
  if (!prefixWritable(prefix)) {
    throw new Error(
      `Cannot write ${prefix}. Run: npm install -g ${PKG_NAME}@latest\nOr: curl -fsSL https://scalattice.cloud/install/cli | sh`
    );
  }
  const from = localVersion();
  install(prefix, { inherit });
  writeState({
    checkedAt: new Date().toISOString(),
    applied: from,
    hinted: undefined,
    failedAt: undefined,
  });
  print(`Updated ${PKG_NAME} ${from} → latest (${prefix}).`);
  if (restart) relaunch(argv);
}

export async function maybeAutoUpdate({
  argv = [],
  cmd = '',
  flags = {},
  fetchImpl = fetch,
  install = defaultInstall,
  relaunch = defaultRelaunch,
  now = Date.now,
  tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  env = process.env,
  prefix = npmPrefixFromPkgRoot(pkgRoot()),
} = {}) {
  if (updatesDisabled(env, flags)) return { skipped: true };
  if (!tty || flags.print || flags.help) return { skipped: true };
  if (SKIP_CMDS.has(cmd)) return { skipped: true };

  let info;
  try {
    info = await checkForUpdate({ fetchImpl, now });
  } catch {
    return { skipped: true };
  }
  if (!info.newer) return info;

  const state = readState();
  if (prefix && prefixWritable(prefix)) {
    try {
      print(`Updating ${PKG_NAME} ${info.current} → ${info.latest}…`);
      await applyUpdate({ install, relaunch, argv, restart: true, prefix });
      return { ...info, applied: true };
    } catch (err) {
      writeState({ failedAt: new Date(now()).toISOString() });
      print(`Could not auto-update: ${err?.message || err}`);
      print(hintLine(info.latest));
      return { ...info, applied: false };
    }
  }
  if (state.hinted !== info.latest) {
    print(hintLine(info.latest));
    writeState({ hinted: info.latest });
  }
  return { ...info, applied: false };
}

export async function cmdUpdate(flags = {}) {
  const info = await checkForUpdate({ force: true });
  print(`CLI ${info.current}${info.latest ? ` · npm ${info.latest}` : ''}`);
  if (!info.newer) {
    print('Already up to date.');
    return info;
  }
  if (flags.check) {
    print(hintLine(info.latest));
    return info;
  }
  await applyUpdate({ inherit: true, argv: [], restart: false });
  print('Run scalattice again to use the new version.');
  return info;
}
