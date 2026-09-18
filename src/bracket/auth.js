import { loadConfig } from '../config.js';
import {
  mintBracketKey,
  readStoredKey,
} from './key.js';
import {
  bracketAuthHint,
  isAuthFailure,
  looksLikeInferenceKey,
  probeSession,
  wrongKeyHint,
} from '../session.js';

/**
 * Inference needs an `slt_…` key. A Cloud JWT is not enough to call api.*.
 * Env wins when it is actually an inference key. Otherwise mint from a live session.
 */
export async function resolveBracketAuth(cfg = loadConfig()) {
  if (looksLikeInferenceKey(cfg.apiKey)) {
    return { ...cfg, apiKey: cfg.apiKey, keySource: 'env' };
  }
  if (cfg.apiKey && (cfg.apiKey.startsWith('slt_mgmt_') || cfg.apiKey.startsWith('slt_provider_'))) {
    throw new Error(wrongKeyHint(cfg.apiKey));
  }
  const stored = readStoredKey();
  if (stored) {
    return { ...cfg, apiKey: stored, keySource: 'bracket.key' };
  }
  if (!cfg.sessionToken && !cfg.mgmtKey) {
    throw new Error(bracketAuthHint(cfg));
  }
  const me = cfg.sessionToken ? await probeSession(cfg) : { ok: true };
  if (!me) {
    throw new Error(bracketAuthHint(cfg));
  }
  try {
    const secret = await mintBracketKey(cfg);
    return { ...cfg, apiKey: secret, keySource: 'created' };
  } catch (err) {
    if (isAuthFailure(err)) throw new Error(bracketAuthHint(cfg));
    throw err;
  }
}
