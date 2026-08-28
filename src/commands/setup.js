import { cmdLogin } from './login.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';

/** @deprecated kept so old `scalattice setup` scripts still sign in */
export async function cmdSetup(args) {
  const cfg = loadConfig();
  if (!cfg.sessionToken || args.forceLogin) {
    return cmdLogin(args);
  }
  print(`Already signed in as ${cfg.email || 'session'}.`);
}
