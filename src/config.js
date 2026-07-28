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

export function loadConfig() {
  const file = configPath();
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    stored = {};
  }
  return {
    cloudUrl: String(process.env.SCALATTICE_CLOUD_URL || stored.cloudUrl || DEFAULTS.cloudUrl).replace(/\/+$/, ''),
    apiUrl: String(process.env.SCALATTICE_API_URL || stored.apiUrl || DEFAULTS.apiUrl).replace(/\/+$/, ''),
    sessionToken: process.env.SCALATTICE_SESSION_TOKEN || stored.sessionToken || '',
    email: stored.email || '',
    apiKey: process.env.SCALATTICE_API_KEY || process.env.OPENAI_API_KEY || stored.apiKey || '',
    apiKeyId: stored.apiKeyId || '',
    apiKeyName: stored.apiKeyName || '',
  };
}

export function saveConfig(patch) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = { ...loadConfig(), ...patch };
  // Don't persist env-only overrides as empty wipes.
  const fileBody = {
    cloudUrl: next.cloudUrl,
    apiUrl: next.apiUrl,
    sessionToken: next.sessionToken || undefined,
    email: next.email || undefined,
    apiKey: next.apiKey || undefined,
    apiKeyId: next.apiKeyId || undefined,
    apiKeyName: next.apiKeyName || undefined,
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

export function clearSecrets() {
  return saveConfig({
    sessionToken: '',
    apiKey: '',
    apiKeyId: '',
    apiKeyName: '',
  });
}
