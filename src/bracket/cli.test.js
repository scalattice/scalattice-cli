import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  assert.match(r.stdout, /\/settings/);
});

test('banner names Scalattice Bracket and can show credits', async () => {
  const { renderBanner } = await import('./tui.js');
  const text = renderBanner({
    cwd: '/tmp/ws',
    model: 'qwen-3-coder-30b-a3b',
    yolo: false,
    email: 'dev@example.com',
    credits: ['Wallet $12.34 · spent $1.00', 'qwen-3-coder-30b-a3b unlimited'],
    policy: 'stream · think · auto · vet 1 · tier1',
  });
  assert.match(text, /Scalattice Bracket/);
  assert.match(text, /\/tmp\/ws/);
  assert.match(text, /dev@example.com/);
  assert.match(text, /Wallet \$12\.34/);
  assert.match(text, /stream · think · auto · vet 1 · tier1/);
  assert.doesNotMatch(text, /coding harness/);
});

test('intro stays a fixed block above the transcript', async () => {
  const { renderIntro, introRowCount } = await import('./tui.js');
  const meta = { cwd: '/tmp/ws', model: 'qwen-3-coder-30b-a3b', yolo: false };
  const intro = renderIntro(meta);
  assert.match(intro, /Scalattice Bracket/);
  assert.match(intro, /Ask about this workspace/);
  assert.match(intro, /\/help \[command\]/);
  assert.equal(introRowCount(meta), intro.split('\n').length);
  assert.ok(introRowCount(meta) >= 6);
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

test('backet is a typo alias for bracket --help', () => {
  const r = run(['backet', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /coding harness/);
});

test('unknown commands still fail', () => {
  const r = run(['definitely-not-a-command']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr || r.stdout, /Unknown command/);
});

test('banner credit lines summarize wallet and matching grant', async () => {
  const { bannerCreditLines } = await import('../commands/misc.js');
  const lines = bannerCreditLines(
    {
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
    },
    'qwen-3-8b'
  );
  assert.equal(lines[0], 'Wallet unlimited · spent $1.50');
  assert.equal(lines[1], 'Qwen 3 8B unlimited · expires 2026-12-01');
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
  assert.match(r.stdout, /Inference: SCALATTICE_API_KEY set \(…uvwx\)/);
  assert.match(r.stdout, /scalattice bracket/);
  assert.doesNotMatch(r.stdout, /slt_abcdefghijklmnopqrstuvwx/);
});
