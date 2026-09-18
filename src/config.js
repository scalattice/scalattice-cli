import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULTS = {
  cloudUrl: 'https://scalattice.cloud',
  apiUrl: 'https://api.scalattice.cloud/v1',
};

export function windowsLegacyConfigDir(home = os.homedir()) {
  return path.join(home, '.config', 'scalattice');
}

export function migrateLegacyWindowsConfig(
  primaryDir,
  homeDir = os.homedir(),
  exists = (p) => fs.existsSync(p)
) {
  const dest = path.join(primaryDir, 'config.json');
  if (exists(dest)) return dest;
  const src = path.join(windowsLegacyConfigDir(homeDir), 'config.json');
  if (!exists(src)) return dest;
  try {
    fs.mkdirSync(primaryDir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dest);
  } catch {
    return src;
  }
  return dest;
}

export function configDir() {
  if (process.env.SCALATTICE_CONFIG_DIR) return process.env.SCALATTICE_CONFIG_DIR;
  if (process.platform === 'win32') {
    const primary = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'scalattice');
    migrateLegacyWindowsConfig(primary);
    return primary;
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'scalattice');
}

export function dataDir() {
  if (process.env.SCALATTICE_DATA_DIR) return process.env.SCALATTICE_DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'scalattice');
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'scalattice');
}

export function bracketKeyPath() {
  return path.join(configDir(), 'bracket.key');
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

function readStored() {
  const files = [configPath()];
  if (process.platform === 'win32' && !process.env.SCALATTICE_CONFIG_DIR) {
    files.push(path.join(windowsLegacyConfigDir(), 'config.json'));
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next */
    }
  }
  return {};
}

export function loadConfig() {
  const stored = readStored();
  return {
    cloudUrl: String(process.env.SCALATTICE_CLOUD_URL || stored.cloudUrl || DEFAULTS.cloudUrl).replace(/\/+$/, ''),
    apiUrl: String(process.env.SCALATTICE_API_URL || stored.apiUrl || DEFAULTS.apiUrl).replace(/\/+$/, ''),
    sessionToken: process.env.SCALATTICE_SESSION_TOKEN || stored.sessionToken || '',
    email: stored.email || '',
    apiKey: process.env.SCALATTICE_API_KEY || process.env.OPENAI_API_KEY || '',
    mgmtKey: process.env.SCALATTICE_MGMT_KEY || '',
    bracketModel: String(stored.bracketModel || '').trim(),
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
    bracketModel: String(next.bracketModel || '').trim() || undefined,
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

export function loadLastBracketModel() {
  return String(readStored().bracketModel || '').trim();
}

export function saveLastBracketModel(id) {
  const model = String(id || '').trim();
  if (!model) return loadConfig();
  return saveConfig({ bracketModel: model });
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
