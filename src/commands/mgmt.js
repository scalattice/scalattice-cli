import { mgmtFetch } from '../api.js';
import { isAuthFailure, sessionRefreshHint } from '../session.js';

export function requireSession(cfg) {
  if (!cfg.sessionToken) throw new Error('Not signed in. Open https://scalattice.cloud/auth and run the curl command.');
  return cfg;
}

export function requireCloudAuth(cfg) {
  if (!cfg.sessionToken && !cfg.mgmtKey) {
    throw new Error('Not signed in. Open https://scalattice.cloud/auth and run the curl command.');
  }
  return cfg;
}

/** @deprecated use requireCloudAuth */
export function requireMgmt(cfg) {
  return requireCloudAuth(cfg);
}

export async function authedFetch(cfg, path, opts) {
  try {
    return await mgmtFetch(cfg, path, opts);
  } catch (err) {
    if (isAuthFailure(err)) throw new Error(sessionRefreshHint(cfg));
    throw err;
  }
}
