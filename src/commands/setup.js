import { cmdLogin, ensureDeveloperAudience } from './login.js';
import { cmdKeysCreate } from './keys.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';

/** One-shot: login → developer audience → create key → print env exports. */
export async function cmdSetup(args) {
  let cfg = loadConfig();
  if (!cfg.sessionToken || args.forceLogin) {
    cfg = await cmdLogin(args);
  } else {
    print(`Already signed in as ${cfg.email || 'session'}. Use --login to re-auth.`);
  }

  cfg = loadConfig();
  await ensureDeveloperAudience(cfg);

  if (!cfg.apiKey || args.newKey) {
    await cmdKeysCreate({ ...args, yes: true, name: args.name || 'CLI key' });
  } else {
    print(`Reusing stored API key ...${cfg.apiKey.slice(-4)}. Pass --new-key to mint another.`);
  }

  cfg = loadConfig();
  print('');
  print('You are ready. Paste this into your shell (or ask your coding agent to):');
  print('');
  print(`export OPENAI_BASE_URL=${cfg.apiUrl}`);
  print(`export OPENAI_API_KEY=${cfg.apiKey}`);
  print('');
  print('Then: scalattice credits');
}
