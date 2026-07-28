import { cloudFetch } from '../api.js';
import { loadConfig, saveConfig } from '../config.js';
import { print, prompt } from '../io.js';

function requireSession(cfg) {
  if (!cfg.sessionToken) throw new Error('Not signed in. Run: scalattice login');
  return cfg;
}

export async function cmdKeysList() {
  const cfg = requireSession(loadConfig());
  const data = await cloudFetch(cfg, '/api/v1/developers/keys', { token: cfg.sessionToken });
  const keys = data.keys || data || [];
  if (!Array.isArray(keys) || !keys.length) {
    print('No API keys yet.');
    return;
  }
  for (const k of keys) {
    const status = k.status || 'active';
    print(`${k.id}\t${k.name || 'unnamed'}\t...${k.lastFour || '????'}\t${status}`);
  }
}

export async function cmdKeysCreate(args) {
  const cfg = requireSession(loadConfig());
  const name =
    args.name ||
    (args.yes ? 'CLI key' : await prompt('Key name', { defaultValue: 'CLI key' }));
  const data = await cloudFetch(cfg, '/api/v1/developers/keys', {
    method: 'POST',
    token: cfg.sessionToken,
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key created but secret missing from response');
  saveConfig({
    apiKey: secret,
    apiKeyId: String(data.key?.id || ''),
    apiKeyName: data.key?.name || name,
  });
  print('API key created and saved locally (shown once):');
  print(secret);
  print('');
  print('Add to your shell:');
  print(`  export OPENAI_BASE_URL=${cfg.apiUrl}`);
  print(`  export OPENAI_API_KEY=${secret}`);
  return secret;
}
