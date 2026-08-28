import { cloudFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print, prompt } from '../io.js';
import { requireSession } from './mgmt.js';

export async function cmdAccountKeysList() {
  const cfg = requireSession(loadConfig());
  const data = await cloudFetch(cfg, '/api/v1/account/mgmt-keys', { token: cfg.sessionToken });
  const keys = data.keys || [];
  if (!keys.length) {
    print('No account management keys yet.');
    return;
  }
  for (const k of keys) {
    print(`${k.id}\t${k.name || 'unnamed'}\t...${k.lastFour || '????'}\t${k.status || 'active'}`);
  }
}

export async function cmdAccountKeysCreate(args) {
  const cfg = requireSession(loadConfig());
  const name =
    args.name ||
    (args.yes
      ? 'CLI management key'
      : await prompt('Key name', { defaultValue: 'CLI management key' }));
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
  print('For MCP / scripts:');
  print(`  export SCALATTICE_MGMT_KEY=${secret}`);
}

export async function cmdAccountKeysRoll(args, rest = []) {
  const cfg = requireSession(loadConfig());
  const id = String(args.id || rest[0] || '').trim();
  if (!id) throw new Error('Usage: account keys roll --id KEY_ID');
  const data = await cloudFetch(cfg, `/api/v1/account/mgmt-keys/${id}/roll`, {
    method: 'POST',
    token: cfg.sessionToken,
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key rolled but secret missing from response');
  print('Account management key rolled (new secret shown once, not stored):');
  print(secret);
}

export async function cmdAccountKeysRevoke(args, rest = []) {
  const cfg = requireSession(loadConfig());
  const id = String(args.id || rest[0] || '').trim();
  if (!id) throw new Error('Usage: account keys revoke --id KEY_ID');
  await cloudFetch(cfg, `/api/v1/account/mgmt-keys/${id}`, {
    method: 'DELETE',
    token: cfg.sessionToken,
  });
  print(`Revoked account management key ${id}`);
}
