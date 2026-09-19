import { loadConfig } from '../config.js';
import {
  mintBracketKey,
  readStoredKey,
} from './key.js';
import { listModels } from './client.js';
import {
  getActiveProvider,
  isScalatticeProvider,
  providerKey,
} from './providers.js';
import {
  bracketAuthHint,
  isAuthFailure,
  isIncorrectApiKey,
  looksLikeInferenceKey,
  probeSession,
  wrongKeyHint,
} from '../session.js';

async function inferenceKeyAccepted(apiUrl, apiKey) {
  try {
    await listModels({ apiUrl, apiKey });
    return true;
  } catch (err) {
    if (isIncorrectApiKey(err)) return false;
    return true;
  }
}

/**
 * Inference needs an `slt_…` key on Scalattice. Other providers use their stored secret.
 * Env is tried first, then ~/.config/scalattice/bracket.key. A dead env secret
 * (common after remint while SCALATTICE_API_KEY / OPENAI_API_KEY still holds the
 * old value) must not win over a working file.
 */
export async function resolveBracketAuth(cfg = loadConfig()) {
  const rec = getActiveProvider();
  if (!isScalatticeProvider(rec)) {
    const key = providerKey(rec, cfg);
    if (!key) {
      throw new Error(
        `Provider "${rec.name}" has no API key.\nSet one:  scalattice bracket provider key set SECRET\nOr:       /provider key set SECRET`
      );
    }
    return {
      ...cfg,
      apiUrl: rec.apiUrl,
      apiKey: key,
      keySource: 'provider',
      providerId: rec.id,
      providerName: rec.name,
    };
  }

  const apply = (apiKey, keySource, authNote = '') => ({
    ...cfg,
    apiKey,
    keySource,
    authNote,
    providerId: rec.id,
    providerName: rec.name,
  });

  if (cfg.apiKey && (cfg.apiKey.startsWith('slt_mgmt_') || cfg.apiKey.startsWith('slt_provider_'))) {
    throw new Error(wrongKeyHint(cfg.apiKey));
  }

  const envKey = looksLikeInferenceKey(cfg.apiKey) ? cfg.apiKey : '';
  const stored = readStoredKey();
  const candidates = [];
  if (envKey) candidates.push({ key: envKey, source: 'env' });
  if (stored && stored !== envKey) candidates.push({ key: stored, source: 'bracket.key' });

  let envRejected = false;
  for (const c of candidates) {
    if (await inferenceKeyAccepted(cfg.apiUrl, c.key)) {
      const note =
        envRejected && c.source === 'bracket.key'
          ? 'Ignored SCALATTICE_API_KEY / OPENAI_API_KEY (API rejected it). Using the saved Bracket key. Unset the env var so a dead secret cannot shadow the file.'
          : '';
      return apply(c.key, c.source, note);
    }
    if (c.source === 'env') envRejected = true;
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
    return apply(
      secret,
      'created',
      envRejected
        ? 'SCALATTICE_API_KEY / OPENAI_API_KEY was rejected. Minted a new Bracket key. Unset the env var or the next launch will try the dead secret first.'
        : ''
    );
  } catch (err) {
    if (isAuthFailure(err)) throw new Error(bracketAuthHint(cfg));
    throw err;
  }
}
