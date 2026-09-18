import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bin/scalattice.js');

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SCALATTICE_CONFIG_DIR: '/tmp/scalattice-cli-test-empty' },
  });
}

test('scalattice --help still documents login and mcp', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scalattice login/);
  assert.match(r.stdout, /scalattice mcp/);
  assert.match(r.stdout, /scalattice bracket/);
  assert.doesNotMatch(r.stdout, /scalattice agent\b/);
});

test('scalattice bracket --help names Bracket, not an agent command', () => {
  const r = run(['bracket', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /coding harness/);
  assert.match(r.stdout, /Not scalattice-agent/);
  assert.match(r.stdout, /--yolo/);
});

test('banner names Scalattice Bracket', async () => {
  const { renderBanner } = await import('./tui.js');
  const text = renderBanner({ cwd: '/tmp/ws', model: 'qwen-3-coder-30b-a3b', yolo: false });
  assert.match(text, /Scalattice Bracket/);
  assert.match(text, /coding harness/);
  assert.match(text, /\/tmp\/ws/);
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
