import fs from 'node:fs';
import { mgmtFetch } from '../api.js';
import { bracketKeyPath, configDir, loadConfig } from '../config.js';
import { print } from '../io.js';
import {
  isAuthFailure,
  looksLikeInferenceKey,
  probeSession,
  sessionRefreshHint,
} from '../session.js';

const BRACKET_KEY_NAME = 'CLI bracket';

function readStoredKey() {
  try {
    const raw = fs.readFileSync(bracketKeyPath(), 'utf8').trim();
    return looksLikeInferenceKey(raw) ? raw : '';
  } catch {
    return '';
  }
}

function writeStoredKey(secret) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(bracketKeyPath(), `${secret}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(bracketKeyPath(), 0o600);
  } catch {
    /* ignore */
  }
}

async function mintBracketKey(cfg) {
  const data = await mgmtFetch(cfg, '/api/v1/developers/keys', {
    method: 'POST',
    body: { name: BRACKET_KEY_NAME },
  });
  const secret = data.secret;
  if (!looksLikeInferenceKey(secret)) {
    throw new Error('Could not create an inference key for Bracket.');
  }
  writeStoredKey(secret);
  print(`Created inference key "${BRACKET_KEY_NAME}" → ${bracketKeyPath()}`);
  return secret;
}

/**
 * Inference needs an `slt_…` key. A Cloud JWT is not enough to call api.*.
 * Env wins when it is actually an inference key. Otherwise mint from a live session.
 */
export async function resolveBracketAuth(cfg = loadConfig()) {
  if (looksLikeInferenceKey(cfg.apiKey)) {
    return { ...cfg, apiKey: cfg.apiKey, keySource: 'env' };
  }
  const stored = readStoredKey();
  if (stored) {
    return { ...cfg, apiKey: stored, keySource: 'bracket.key' };
  }
  if (!cfg.sessionToken && !cfg.mgmtKey) {
    throw new Error(sessionRefreshHint(cfg));
  }
  const me = cfg.sessionToken ? await probeSession(cfg) : { ok: true };
  if (!me) {
    throw new Error(sessionRefreshHint(cfg));
  }
  try {
    const secret = await mintBracketKey(cfg);
    return { ...cfg, apiKey: secret, keySource: 'created' };
  } catch (err) {
    if (isAuthFailure(err)) throw new Error(sessionRefreshHint(cfg));
    throw err;
  }
}
