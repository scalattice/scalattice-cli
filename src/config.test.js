import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  loadConfig,
  loadLastBracketModel,
  migrateLegacyWindowsConfig,
  saveLastBracketModel,
  saveSession,
  windowsLegacyConfigDir,
} from './config.js';

test('saveConfig keeps the last Bracket model across session writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-cfg-'));
  const prev = process.env.SCALATTICE_CONFIG_DIR;
  process.env.SCALATTICE_CONFIG_DIR = root;
  try {
    saveLastBracketModel('qwen-3-8b');
    assert.equal(loadLastBracketModel(), 'qwen-3-8b');
    saveSession('tok', 'dev@example.com');
    assert.equal(loadLastBracketModel(), 'qwen-3-8b');
    assert.equal(loadConfig().email, 'dev@example.com');
    assert.equal(loadConfig().bracketModel, 'qwen-3-8b');
  } finally {
    if (prev === undefined) delete process.env.SCALATTICE_CONFIG_DIR;
    else process.env.SCALATTICE_CONFIG_DIR = prev;
  }
});

test('migrateLegacyWindowsConfig copies Git Bash ~/.config into APPDATA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-cfg-'));
  const home = path.join(root, 'home');
  const primary = path.join(root, 'AppData', 'Roaming', 'scalattice');
  const legacyDir = windowsLegacyConfigDir(home);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'config.json'),
    `${JSON.stringify({ email: 'dev@example.com', sessionToken: 'tok' }, null, 2)}\n`
  );

  const dest = migrateLegacyWindowsConfig(primary, home);
  assert.equal(dest, path.join(primary, 'config.json'));
  const copied = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.equal(copied.email, 'dev@example.com');
  assert.equal(copied.sessionToken, 'tok');

  fs.writeFileSync(dest, `${JSON.stringify({ email: 'newer@example.com' }, null, 2)}\n`);
  migrateLegacyWindowsConfig(primary, home);
  const kept = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.equal(kept.email, 'newer@example.com');
});
