import { cloudFetch } from '../api.js';
import { loadConfig, saveConfig } from '../config.js';
import { print, prompt } from '../io.js';
import { cmdLogin } from './login.js';

export function requireSession(cfg) {
  if (!cfg.sessionToken) throw new Error('Not signed in. Run: scalattice login');
  return cfg;
}

export function requireMgmt(cfg) {
  if (!cfg.mgmtKey) {
    throw new Error('No account management key. Run: scalattice setup');
  }
  return cfg;
}

/** Mint or reuse an account management key (session required for create). */
export async function ensureMgmtKey(args = {}) {
  let cfg = loadConfig();
  if (args.paste) {
    const pasted = String(args.paste).trim();
    if (!pasted.startsWith('slt_mgmt_')) {
      throw new Error('Account management key must start with slt_mgmt_');
    }
    saveConfig({ mgmtKey: pasted, mgmtKeyId: '', mgmtKeyName: 'pasted' });
    print('Account management key saved locally.');
    return loadConfig();
  }

  if (!args.newKey && cfg.mgmtKey) {
    return cfg;
  }

  if (!cfg.sessionToken || args.forceLogin) {
    cfg = await cmdLogin(args);
  }
  requireSession(cfg);

  const name =
    args.name ||
    (args.yes
      ? 'CLI management key'
      : await prompt('Management key name', { defaultValue: 'CLI management key' }));
  const data = await cloudFetch(cfg, '/api/v1/account/mgmt-keys', {
    method: 'POST',
    token: cfg.sessionToken,
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key created but secret missing from response');
  saveConfig({
    mgmtKey: secret,
    mgmtKeyId: String(data.key?.id || ''),
    mgmtKeyName: data.key?.name || name,
  });
  print('Account management key created and saved locally (shown once):');
  print(secret);
  return loadConfig();
}
