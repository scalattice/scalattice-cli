import { mgmtFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print, prompt } from '../io.js';
import { requireCloudAuth } from './mgmt.js';

export async function cmdDevelopersKeysList() {
  const cfg = requireCloudAuth(loadConfig());
  const data = await mgmtFetch(cfg, '/api/v1/developers/keys');
  const keys = data.keys || data || [];
  if (!Array.isArray(keys) || !keys.length) {
    print('No inference API keys yet.');
    return;
  }
  for (const k of keys) {
    const status = k.status || 'active';
    print(`${k.id}\t${k.name || 'unnamed'}\t...${k.lastFour || '????'}\t${status}`);
  }
}

export async function cmdDevelopersKeysCreate(args) {
  const cfg = requireCloudAuth(loadConfig());
  const name =
    args.name ||
    (args.yes ? 'CLI key' : await prompt('Key name', { defaultValue: 'CLI key' }));
  const data = await mgmtFetch(cfg, '/api/v1/developers/keys', {
    method: 'POST',
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key created but secret missing from response');
  print('Inference API key (shown once, not stored):');
  print(secret);
  print('');
  print('Add to your shell for the OpenAI SDK:');
  print(`  export OPENAI_BASE_URL=${cfg.apiUrl}`);
  print(`  export OPENAI_API_KEY=${secret}`);
  return secret;
}

export async function cmdDevelopersKeysRoll(args, rest = []) {
  const cfg = requireCloudAuth(loadConfig());
  const id = String(args.id || rest[0] || '').trim();
  if (!id) throw new Error('Usage: developers keys roll --id KEY_ID');
  const data = await mgmtFetch(cfg, `/api/v1/developers/keys/${id}/roll`, {
    method: 'POST',
    body: {},
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key rolled but secret missing from response');
  print('Inference API key rolled (new secret shown once, not stored):');
  print(secret);
}

export async function cmdDevelopersKeysRevoke(args, rest = []) {
  const cfg = requireCloudAuth(loadConfig());
  const id = String(args.id || rest[0] || '').trim();
  if (!id) throw new Error('Usage: developers keys revoke --id KEY_ID');
  await mgmtFetch(cfg, `/api/v1/developers/keys/${id}`, { method: 'DELETE' });
  print(`Revoked inference API key ${id}`);
}
