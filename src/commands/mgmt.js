import { cloudFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print, prompt } from '../io.js';
import { cmdLogin } from './login.js';

export function requireSession(cfg) {
  if (!cfg.sessionToken) throw new Error('Not signed in. Run: scalattice login');
  return cfg;
}

export function requireCloudAuth(cfg) {
  if (!cfg.sessionToken && !cfg.mgmtKey) {
    throw new Error('Not signed in. Run: scalattice login');
  }
  return cfg;
}

/** @deprecated use requireCloudAuth */
export function requireMgmt(cfg) {
  return requireCloudAuth(cfg);
}

/** Mint a management key for MCP / env. Prints once; never stored in config.json. */
export async function cmdMgmtKeyCreate(args = {}) {
  let cfg = loadConfig();
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
  print('Account management key (shown once, not stored):');
  print(secret);
  print('');
  print('For MCP / scripts, put it in the environment:');
  print(`  export SCALATTICE_MGMT_KEY=${secret}`);
  return secret;
}
