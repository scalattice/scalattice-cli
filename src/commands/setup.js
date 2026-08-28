import { cmdLogin, ensureDeveloperAudience } from './login.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';

/**
 * Login and set developer workspace. Keys stay in the cloud / your shell env,
 * not in config.json.
 */
export async function cmdSetup(args) {
  let cfg = loadConfig();
  if (!cfg.sessionToken || args.forceLogin) {
    cfg = await cmdLogin(args);
  } else {
    print(`Already signed in as ${cfg.email || 'session'}. Use --login to re-auth.`);
  }

  await ensureDeveloperAudience(cfg);
  cfg = loadConfig();
  print('');
  print(`Signed in as ${cfg.email || 'session'}.`);
  print('This CLI stores the session only. For the OpenAI SDK:');
  print('  scalattice developers keys create');
  print('Then: scalattice credits');
}
