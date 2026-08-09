import { cmdLogin, ensureDeveloperAudience } from './login.js';
import { cmdKeysCreate } from './keys.js';
import { ensureMgmtKey } from './mgmt.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';

/**
 * One-shot: login → mint account management key → developer audience →
 * inference API key → print env exports.
 */
export async function cmdSetup(args) {
  let cfg = loadConfig();
  if (!cfg.sessionToken || args.forceLogin) {
    cfg = await cmdLogin(args);
  } else {
    print(`Already signed in as ${cfg.email || 'session'}. Use --login to re-auth.`);
  }

  cfg = await ensureMgmtKey({ ...args, yes: args.yes !== false });
  await ensureDeveloperAudience(cfg);

  cfg = loadConfig();
  if (!cfg.apiKey || args.newKey) {
    await cmdKeysCreate({ ...args, yes: true, name: args.name || 'CLI key' });
  } else {
    print(`Reusing stored inference API key ...${cfg.apiKey.slice(-4)}. Pass --new-key to mint another.`);
  }

  cfg = loadConfig();
  print('');
  print('You are ready. Paste this into your shell (or ask your coding agent to):');
  print('');
  print(`export OPENAI_BASE_URL=${cfg.apiUrl}`);
  print(`export OPENAI_API_KEY=${cfg.apiKey}`);
  print('');
  print('Account management key is stored for credits / fleet / keys CRUD.');
  print('Then: scalattice credits');
}
