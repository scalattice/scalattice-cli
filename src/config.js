import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULTS = {
  cloudUrl: 'https://scalattice.cloud',
  apiUrl: 'https://api.scalattice.cloud/v1',
};

function configDir() {
  if (process.env.SCALATTICE_CONFIG_DIR) return process.env.SCALATTICE_CONFIG_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'scalattice');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'scalattice');
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

function readStored() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadConfig() {
  const stored = readStored();
  return {
    cloudUrl: String(process.env.SCALATTICE_CLOUD_URL || stored.cloudUrl || DEFAULTS.cloudUrl).replace(/\/+$/, ''),
    apiUrl: String(process.env.SCALATTICE_API_URL || stored.apiUrl || DEFAULTS.apiUrl).replace(/\/+$/, ''),
    sessionToken: process.env.SCALATTICE_SESSION_TOKEN || stored.sessionToken || '',
    email: stored.email || '',
    // Keys are never persisted. Env only, for MCP / OpenAI SDK.
    apiKey: process.env.SCALATTICE_API_KEY || process.env.OPENAI_API_KEY || '',
    mgmtKey: process.env.SCALATTICE_MGMT_KEY || '',
  };
}

export function saveConfig(patch) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = readStored();
  const next = { ...stored, ...patch };
  const fileBody = {
    cloudUrl: next.cloudUrl || DEFAULTS.cloudUrl,
    apiUrl: next.apiUrl || DEFAULTS.apiUrl,
    sessionToken: next.sessionToken || undefined,
    email: next.email || undefined,
  };
  const file = configPath();
  fs.writeFileSync(file, `${JSON.stringify(fileBody, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore on platforms without chmod */
  }
  return loadConfig();
}

export function saveSession(token, email) {
  return saveConfig({
    sessionToken: token || '',
    email: String(email || '').trim(),
  });
}

export function clearSecrets() {
  return saveConfig({
    sessionToken: '',
    email: '',
  });
}
