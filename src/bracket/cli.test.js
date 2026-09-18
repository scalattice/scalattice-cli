import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bin/scalattice.js');

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SCALATTICE_CONFIG_DIR: '/tmp/scalattice-cli-test-empty', SCALATTICE_NO_UPDATE: '1' },
  });
}

test('scalattice --help still documents login and mcp', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scalattice login/);
  assert.match(r.stdout, /scalattice mcp/);
  assert.match(r.stdout, /scalattice update/);
  assert.match(r.stdout, /scalattice bracket/);
  assert.match(r.stdout, /scalattice bracket key/);
  assert.doesNotMatch(r.stdout, /scalattice agent\b/);
});

test('scalattice bracket --help names Bracket', () => {
  const r = run(['bracket', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /coding harness/);
  assert.doesNotMatch(r.stdout, /scalattice-agent/);
  assert.match(r.stdout, /--yolo/);
  assert.match(r.stdout, /--stream/);
  assert.match(r.stdout, /--think/);
  assert.match(r.stdout, /--region/);
  assert.match(r.stdout, /\/help \[command\]/);
  assert.match(r.stdout, /\/chats/);
  assert.match(r.stdout, /\/tools/);
  assert.match(r.stdout, /\/key/);
  assert.match(r.stdout, /bracket key \[show\|roll\|revoke\]/);
  assert.match(r.stdout, /Tab completes/);
});

test('banner names Scalattice Bracket and can show credits', async () => {
  const { renderBanner } = await import('./tui.js');
  const text = renderBanner({
    cwd: '/tmp/ws',
    model: 'qwen-3-coder-30b-a3b',
    yolo: false,
    email: 'dev@example.com',
    columns: 80,
    credits: ['Wallet $12.34 · spent $1.00', 'qwen-3-coder-30b-a3b unlimited'],
    policy: 'stream on · think on · region auto · vet 1 · security tier1',
  });
  assert.match(text, /Scalattice Bracket/);
  assert.match(text, /\/tmp\/ws/);
  assert.match(text, /dev@example.com/);
  assert.match(text, /Wallet \$12\.34/);
  assert.match(text, /stream on · think on · region auto · vet 1 · security tier1/);
  assert.match(text, /[\u2800-\u28FF]/);
  assert.doesNotMatch(text, /\[ \]\s+Scalattice Bracket/);
  assert.doesNotMatch(text, /coding harness/);
  assert.doesNotMatch(text, /38;2;34;211;238/);
});

test('intro stays a fixed block above the transcript', async () => {
  const { renderIntro, introRowCount } = await import('./tui.js');
  const meta = { cwd: '/tmp/ws', model: 'qwen-3-coder-30b-a3b', yolo: false };
  const intro = renderIntro(meta);
  assert.match(intro, /Scalattice Bracket/);
  assert.match(intro, /Ask about this workspace/);
  assert.match(intro, /\/help \[command\]/);
  assert.match(intro, /\/chats/);
  assert.match(intro, /PgUp/);
  assert.equal(introRowCount(meta), intro.split('\n').length);
  assert.ok(introRowCount(meta) >= 6);
});

test('wide layout keeps chats in a full-height scrollable panel', async () => {
  const { renderBanner, renderChatPanel, chatSidebarView, layoutFrame } = await import('./tui.js');
  const chats = Array.from({ length: 40 }, (_, i) => ({ id: `c${i + 1}`, title: `Chat ${i + 1}` }));
  const wide = renderBanner({
    cwd: '/tmp/ws',
    model: 'qwen-3-coder-30b-a3b',
    columns: 120,
    currentId: 'c1',
    chats,
  });
  assert.doesNotMatch(wide, /\bChats\b/);
  const top = wide.split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '');
  const lay = layoutFrame({ columns: 120, chats });
  assert.equal(lay.showSide, true);
  assert.equal(lay.cols, 120);
  assert.equal(lay.mainW, 92);
  assert.equal(top.length, 92);

  const plines = renderChatPanel(
    { chats, currentId: 'c1' },
    { height: 12, offset: 0, width: 28 }
  );
  assert.equal(plines.length, 12);
  const panelText = plines.join('\n');
  assert.match(panelText, /Chats/);
  assert.match(panelText, /Chat 1/);
  assert.doesNotMatch(panelText, /Chat 40/);
  const scrolled = chatSidebarView({ chats, currentId: 'c40' }, 12, 31);
  assert.ok(scrolled.shown.some((item) => item.title === 'Chat 40'));
  assert.ok(scrolled.offset > 0);

  const narrow = renderBanner({
    cwd: '/tmp/ws',
    model: 'qwen-3-coder-30b-a3b',
    columns: 80,
    currentId: 'c1',
    chats,
  });
  assert.doesNotMatch(narrow, /\bChats\b/);
  const ntop = narrow.split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(ntop.length, 80);
});

test('transcript wrap and history window keep older lines reachable', async () => {
  const { wrapLine, historyWindow } = await import('./tui.js');
  assert.deepEqual(wrapLine('abcdef', 3), ['abc', 'def']);
  const painted = wrapLine('\x1b[31mhello\x1b[0m', 3);
  assert.equal(painted.length, 2);
  assert.match(painted[0], /hel/);
  assert.match(painted[1], /lo/);
  const href = 'https://ex.com/cli';
  const linked = `\x1b]8;;${href}\x1b\\${href}\x1b]8;;\x1b\\`;
  const wrapped = wrapLine(linked, 10);
  assert.ok(wrapped.length >= 2);
  assert.equal(wrapped[0].includes('\x1b]8;;https://ex.com/cli\x1b\\'), true);
  assert.equal(wrapped[0].endsWith('\x1b]8;;\x1b\\'), true);
  assert.match(wrapped[1], /^\x1b\]8;;https:\/\/ex\.com\/cli\x1b\\/);
  assert.equal(wrapped.join('').replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, ''), href);
  const win = historyWindow(['a', 'b', 'c', 'd'], 2, 1);
  assert.deepEqual(win.slice, ['b', 'c']);
  assert.equal(win.offset, 1);
  assert.equal(win.maxOff, 2);
  const top = historyWindow(['a', 'b', 'c', 'd'], 2, 99);
  assert.deepEqual(top.slice, ['a', 'b']);
  assert.equal(top.offset, 2);
});

test('thinking is guttered italic, not plain assistant text', async () => {
  const { thinkDeltaToAnsi } = await import('./tui.js');
  const first = thinkDeltaToAnsi('plan the edit', {}, { width: 40 });
  assert.match(first.text, /┊ think/);
  assert.match(first.text, /┊ /);
  assert.match(first.text, /plan the edit/);
  assert.doesNotMatch(first.text, /\[ \]/);
  const next = thinkDeltaToAnsi('\nmore', first.state, { width: 40 });
  assert.match(next.text, /┊ /);
  assert.match(next.text, /more/);
});

test('line submit accepts CR, LF, CRLF, and a line glued to enter', async () => {
  const { splitLineSubmit } = await import('./tui.js');
  assert.deepEqual(splitLineSubmit('\r'), { line: '', rest: '' });
  assert.deepEqual(splitLineSubmit('\n'), { line: '', rest: '' });
  assert.deepEqual(splitLineSubmit('\r\n'), { line: '', rest: '' });
  assert.deepEqual(splitLineSubmit('/help\r\n'), { line: '/help', rest: '' });
  assert.deepEqual(splitLineSubmit('/help\n'), { line: '/help', rest: '' });
  assert.equal(splitLineSubmit('/help'), null);
  assert.deepEqual(splitLineSubmit('/help\r\nmore'), { line: '/help', rest: 'more' });
});

test('elapsed time is compact ASCII', async () => {
  const { formatElapsed } = await import('./tui.js');
  assert.equal(formatElapsed(0), '0.0s');
  assert.equal(formatElapsed(1400), '1.4s');
  assert.equal(formatElapsed(61_000), '1m 01s');
});

test('help text has no em dashes', () => {
  const r = run(['bracket', '--help']);
  assert.doesNotMatch(r.stdout, /[\u2014\u2013]/);
});

test('backet is a typo alias for bracket --help', () => {
  const r = run(['backet', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /coding harness/);
});

test('Bracket, BRACKET, brackets, and BRACKETS are aliases', () => {
  for (const name of ['Bracket', 'BRACKET', 'brackets', 'BRACKETS', 'Brackets', 'bracket']) {
    const r = run([name, '--help']);
    assert.equal(r.status, 0, r.stderr || `${name} failed`);
    assert.match(r.stdout, /coding harness/, name);
  }
});

test('unknown commands still fail', () => {
  const r = run(['definitely-not-a-command']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr || r.stdout, /Unknown command/);
});

test('banner credit lines summarize wallet and matching grant', async () => {
  const { bannerCreditLines, formatCredits } = await import('../commands/misc.js');
  const billing = {
    unlimitedCredits: true,
    lifetimeSpendUsd: 1.5,
    modelCredits: [
      {
        modelId: 'qwen-3-8b',
        displayName: 'Qwen 3 8B',
        grantType: 'unlimited',
        expiresAt: '2026-12-01T00:00:00.000Z',
      },
    ],
  };
  const lines = bannerCreditLines(billing, 'qwen-3-8b');
  assert.equal(lines[0], 'Wallet unlimited · spent $1.50');
  assert.equal(lines[1], 'Qwen 3 8B unlimited · expires 2026-12-01');
  const text = formatCredits(billing);
  assert.match(text, /Wallet: unlimited \(admin\)/);
  assert.match(text, /Lifetime spend: \$1\.5000/);
  assert.match(text, /Qwen 3 8B \(unlimited\): unlimited/);
});

test('whoami reports an env inference key even without a Cloud session', () => {
  const r = spawnSync(process.execPath, [bin, 'whoami'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SCALATTICE_CONFIG_DIR: '/tmp/scalattice-cli-test-empty',
      SCALATTICE_NO_UPDATE: '1',
      SCALATTICE_SESSION_TOKEN: '',
      SCALATTICE_MGMT_KEY: '',
      SCALATTICE_API_KEY: 'slt_abcdefghijklmnopqrstuvwx',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Inference: env \(…uvwx\)/);
  assert.match(r.stdout, /scalattice bracket/);
  assert.match(r.stdout, /scalattice bracket key/);
  assert.doesNotMatch(r.stdout, /slt_abcdefghijklmnopqrstuvwx/);
});

test('whoami reports bracket.key when env is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-whoami-'));
  fs.writeFileSync(path.join(dir, 'bracket.key'), 'slt_filekeystoredherewxyz\n', { mode: 0o600 });
  const r = spawnSync(process.execPath, [bin, 'whoami'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SCALATTICE_CONFIG_DIR: dir,
      SCALATTICE_NO_UPDATE: '1',
      SCALATTICE_SESSION_TOKEN: '',
      SCALATTICE_MGMT_KEY: '',
      SCALATTICE_API_KEY: '',
      OPENAI_API_KEY: '',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Inference: bracket\.key \(…wxyz\)/);
  assert.match(r.stdout, /scalattice bracket key/);
  assert.doesNotMatch(r.stdout, /slt_filekeystoredherewxyz/);
});

test('scalattice bracket key shows the file and does not start the TUI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-bkey-cli-'));
  fs.writeFileSync(path.join(dir, 'bracket.key'), 'slt_abcdefghijklmnopqrstuvwx\n', { mode: 0o600 });
  const env = {
    ...process.env,
    SCALATTICE_CONFIG_DIR: dir,
    SCALATTICE_NO_UPDATE: '1',
    SCALATTICE_SESSION_TOKEN: '',
    SCALATTICE_MGMT_KEY: '',
    SCALATTICE_API_KEY: '',
    OPENAI_API_KEY: '',
  };
  const shown = spawnSync(process.execPath, [bin, 'bracket', 'key'], { encoding: 'utf8', env });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /Source:  bracket\.key/);
  assert.match(shown.stdout, /…uvwx/);
  assert.doesNotMatch(shown.stdout, /slt_abcdefghijklmnopqrstuvwx/);
  assert.doesNotMatch(shown.stdout, /coding harness/);

  const full = spawnSync(process.execPath, [bin, 'bracket', 'key', '--show'], { encoding: 'utf8', env });
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /Full:    slt_abcdefghijklmnopqrstuvwx/);

  const alias = spawnSync(process.execPath, [bin, 'bracket', 'keys'], { encoding: 'utf8', env });
  assert.equal(alias.status, 0, alias.stderr);
  assert.match(alias.stdout, /Source:  bracket\.key/);

  const bad = spawnSync(process.execPath, [bin, 'bracket', 'key', 'nope'], { encoding: 'utf8', env });
  assert.notEqual(bad.status, 0);
  assert.match(String(bad.stderr || bad.stdout), /Usage: scalattice bracket key/);
});

