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
