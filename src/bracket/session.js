import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../config.js';

function sessionDir() {
  return path.join(dataDir(), 'bracket-sessions');
}

function sessionPath(id = 'last') {
  const safe = String(id || 'last').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(sessionDir(), `${safe}.json`);
}

export function saveSession(record) {
  const dir = sessionDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(sessionPath('last'), `${JSON.stringify(body)}\n`, { mode: 0o600 });
  return body;
}

export function loadLastSession() {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath('last'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
