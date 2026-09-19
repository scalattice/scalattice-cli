import fs from 'node:fs';
import { mgmtFetch } from '../api.js';
import { bracketKeyPath, configDir, loadConfig } from '../config.js';
import { print } from '../io.js';
import {
  isAuthFailure,
  looksLikeInferenceKey,
  sessionRefreshHint,
} from '../session.js';
import {
  clearActiveProviderKey,
  getActiveProvider,
  isScalatticeProvider,
  providerKey,
  setActiveProviderKey,
} from './providers.js';

export const BRACKET_KEY_NAME = 'CLI bracket';

export function lastFourOf(secret) {
  const s = String(secret || '').trim();
  return s.length >= 4 ? s.slice(-4) : '';
}

export function readStoredKey() {
  try {
    const raw = fs.readFileSync(bracketKeyPath(), 'utf8').trim();
    return looksLikeInferenceKey(raw) ? raw : '';
  } catch {
    return '';
  }
}

export function writeStoredKey(secret) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(bracketKeyPath(), `${secret}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(bracketKeyPath(), 0o600);
  } catch {
    /* ignore */
  }
}

export function deleteStoredKey() {
  try {
    fs.unlinkSync(bracketKeyPath());
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

function requireCloud(cfg) {
  if (!cfg.sessionToken && !cfg.mgmtKey) {
    throw new Error(sessionRefreshHint(cfg));
  }
  return cfg;
}

async function cloudKeys(cfg, path, opts) {
  try {
    return await mgmtFetch(cfg, path, opts);
  } catch (err) {
    if (isAuthFailure(err)) throw new Error(sessionRefreshHint(cfg));
    throw err;
  }
}

export function inspectBracketKey() {
  const envRaw = String(process.env.SCALATTICE_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const envKey = looksLikeInferenceKey(envRaw) ? envRaw : '';
  const storedKey = readStoredKey();
  const file = bracketKeyPath();
  if (envKey) {
    return {
      source: 'env',
      envWins: true,
      secret: envKey,
      storedKey,
      path: file,
      lastFour: lastFourOf(envKey),
      storedLastFour: storedKey ? lastFourOf(storedKey) : '',
    };
  }
  if (storedKey) {
    return {
      source: 'bracket.key',
      envWins: false,
      secret: storedKey,
      storedKey,
      path: file,
      lastFour: lastFourOf(storedKey),
      storedLastFour: lastFourOf(storedKey),
    };
  }
  return {
    source: 'none',
    envWins: false,
    secret: '',
    storedKey: '',
    path: file,
    lastFour: '',
    storedLastFour: '',
  };
}

export function pickBracketCloudKey(keys, secret) {
  const list = Array.isArray(keys) ? keys : [];
  const active = list.filter((k) => (k.status || 'active') === 'active');
  const four = lastFourOf(secret);
  if (four) {
    const matches = active.filter((k) => String(k.lastFour || '') === four);
    if (matches.length === 1) return matches[0];
    const named = matches.filter((k) => String(k.name || '') === BRACKET_KEY_NAME);
    if (named.length) return named[0];
    if (matches.length > 1) {
      throw new Error(
        `Multiple inference keys end in …${four}. Pick one: scalattice developers keys list`
      );
    }
    return active.find((k) => String(k.name || '') === BRACKET_KEY_NAME) || null;
  }
  return active.find((k) => String(k.name || '') === BRACKET_KEY_NAME) || null;
}

async function listActiveKeys(cfg) {
  const data = await cloudKeys(cfg, '/api/v1/developers/keys');
  return data.keys || data || [];
}

export async function mintBracketKey(cfg, { quiet = false } = {}) {
  const data = await cloudKeys(cfg, '/api/v1/developers/keys', {
    method: 'POST',
    body: { name: BRACKET_KEY_NAME },
  });
  const secret = data.secret;
  if (!looksLikeInferenceKey(secret)) {
    throw new Error('Could not create an inference key for Bracket.');
  }
  writeStoredKey(secret);
  if (!quiet) print(`Created inference key "${BRACKET_KEY_NAME}" → ${bracketKeyPath()}`);
  return secret;
}

function envOverrideNote(info) {
  if (!info.envWins) return '';
  return (
    'SCALATTICE_API_KEY is set, so the next launch still uses env until you unset it ' +
    'or export the new secret.'
  );
}

export function inspectActiveKey() {
  const rec = getActiveProvider();
  if (!isScalatticeProvider(rec)) {
    const secret = providerKey(rec);
    return {
      source: secret ? 'provider' : 'none',
      envWins: false,
      secret,
      storedKey: secret,
      path: rec.id,
      lastFour: lastFourOf(secret),
      storedLastFour: lastFourOf(secret),
      provider: rec,
    };
  }
  return { ...inspectBracketKey(), provider: rec };
}

export function formatBracketKeyStatus(info, { showSecret = false, cloud = null, sessionSecret = '' } = {}) {
  const rec = info.provider || getActiveProvider();
  const lines = [`Inference key  (${rec?.name || 'Scalattice'})`];
  if (info.source === 'env') {
    lines.push('Source:  env (SCALATTICE_API_KEY / OPENAI_API_KEY)');
  } else if (info.source === 'bracket.key') {
    lines.push('Source:  bracket.key');
  } else if (info.source === 'provider') {
    lines.push(`Source:  provider ${rec?.id || ''}`);
  } else {
    lines.push('Source:  none');
  }
  if (isScalatticeProvider(rec)) {
    lines.push(`File:    ${info.path}${info.storedKey ? '' : ' (none)'}`);
  } else {
    lines.push(`API:     ${rec?.apiUrl || ''}`);
  }
  if (info.storedKey && info.source === 'env') {
    const same = info.storedKey === info.secret ? ', same as env' : ', unused while env is set';
    lines.push(`         …${info.storedLastFour}${same}`);
  }
  if (info.lastFour) lines.push(`Secret:  …${info.lastFour}`);
  if (sessionSecret && lastFourOf(sessionSecret) && lastFourOf(sessionSecret) !== info.lastFour) {
    lines.push(`Session: …${lastFourOf(sessionSecret)} (this process; next launch uses source above)`);
  }
  if (showSecret && info.secret) lines.push(`Full:    ${info.secret}`);
  if (cloud) {
    lines.push(`Cloud:   ${cloud.name || 'unnamed'}  ${cloud.id}  …${cloud.lastFour || '????'}`);
  }
  if (info.source === 'none') {
    if (isScalatticeProvider(rec)) {
      lines.push('Set one:  /provider key set slt_…     or  /provider key new  (mints CLI bracket)');
      lines.push('Or: scalattice bracket provider key set slt_…   |   scalattice bracket provider key new');
    } else {
      lines.push('Set one:  /provider key set SECRET');
    }
  } else {
    lines.push(
      isScalatticeProvider(rec)
        ? 'Manage:  /provider key set | new | roll | revoke'
        : 'Manage:  /provider key set SECRET   (roll/new are Scalattice-only)'
    );
    const note = envOverrideNote(info);
    if (note) lines.push(note);
  }
  return lines.join('\n');
}

export async function describeBracketKey(cfg = loadConfig(), { sessionSecret = '' } = {}) {
  const info = inspectActiveKey();
  let cloud = null;
  const rec = info.provider || getActiveProvider();
  if (isScalatticeProvider(rec) && (cfg.sessionToken || cfg.mgmtKey)) {
    try {
      const keys = await listActiveKeys(cfg);
      const secret = sessionSecret || info.secret;
      cloud = secret
        ? pickBracketCloudKey(keys, secret)
        : keys.find((k) => String(k.name || '') === BRACKET_KEY_NAME) || null;
    } catch {
      /* status still works offline */
    }
  }
  return { info, cloud };
}

export function formatRollResult(result, { showSecret = false } = {}) {
  const verb = result.action === 'created' ? 'Created' : 'Rolled';
  const name = result.cloud?.name || BRACKET_KEY_NAME;
  const id = result.cloud?.id ? `  ${result.cloud.id}` : '';
  const lines = [
    `${verb} "${name}"${id}`,
    `Secret:  …${lastFourOf(result.secret)}`,
    `Wrote    ${result.path}`,
  ];
  if (showSecret && result.secret) lines.push(`Full:    ${result.secret}`);
  const note = envOverrideNote(result);
  if (note) lines.push(note);
  return lines.join('\n');
}

export function formatRevokeResult(result) {
  const lines = [];
  if (result.cloud) {
    lines.push(`Revoked "${result.cloud.name || BRACKET_KEY_NAME}"  ${result.cloud.id}`);
  } else {
    lines.push('No matching Cloud key to revoke.');
    if (result.cloudNote) lines.push(result.cloudNote);
  }
  if (result.hadFile) lines.push(`Deleted  ${result.path}`);
  else lines.push(`File:    ${result.path} (already gone)`);
  if (result.envWins) {
    lines.push(
      'SCALATTICE_API_KEY is still set. Unset it, or the next launch will keep using that (now revoked) secret.'
    );
  } else {
    lines.push('Next `scalattice bracket` will mint a new key. Or: scalattice bracket provider key new');
  }
  return lines.join('\n');
}

export function requireScalatticeKeyCommand() {
  const rec = getActiveProvider();
  if (!isScalatticeProvider(rec)) {
    throw new Error(
      `Provider "${rec.name}" is not Scalattice. Set its key with: /provider key set SECRET`
    );
  }
  return rec;
}

export function formatSetResult(rec, secret) {
  const four = lastFourOf(secret);
  if (isScalatticeProvider(rec)) {
    return `Wrote Scalattice key …${four} → ${bracketKeyPath()}`;
  }
  return `Wrote key for ${rec.name} (…${four})`;
}

export async function createBracketKey(cfg = loadConfig()) {
  requireCloud(cfg);
  requireScalatticeKeyCommand();
  const info = inspectBracketKey();
  const secret = await mintBracketKey(cfg, { quiet: true });
  return {
    action: 'created',
    secret,
    path: bracketKeyPath(),
    envWins: info.envWins,
    cloud: { name: BRACKET_KEY_NAME, lastFour: lastFourOf(secret) },
  };
}

export async function rollBracketKey(cfg = loadConfig(), { sessionSecret = '' } = {}) {
  requireCloud(cfg);
  requireScalatticeKeyCommand();
  const info = inspectBracketKey();
  const keys = await listActiveKeys(cfg);
  const secretForPick = sessionSecret || info.secret;
  const cloud = secretForPick
    ? pickBracketCloudKey(keys, secretForPick)
    : keys.find((k) => String(k.name || '') === BRACKET_KEY_NAME) || null;

  let secret;
  let action = 'rolled';
  let nextCloud = cloud;
  if (cloud) {
    try {
      const data = await cloudKeys(cfg, `/api/v1/developers/keys/${cloud.id}/roll`, {
        method: 'POST',
        body: {},
      });
      secret = data.secret;
      nextCloud = { ...cloud, lastFour: lastFourOf(secret), id: data.key?.id || cloud.id };
    } catch (err) {
      const msg = String(err?.message || '');
      if (!/404|not found|revoked|invalid|gone/i.test(msg) && err?.status !== 404) throw err;
      secret = await mintBracketKey(cfg, { quiet: true });
      action = 'created';
      nextCloud = { name: BRACKET_KEY_NAME, lastFour: lastFourOf(secret) };
    }
  } else {
    secret = await mintBracketKey(cfg, { quiet: true });
    action = 'created';
    nextCloud = { name: BRACKET_KEY_NAME, lastFour: lastFourOf(secret) };
  }
  if (!looksLikeInferenceKey(secret)) {
    throw new Error('Could not roll the Bracket inference key.');
  }
  writeStoredKey(secret);
  return {
    action,
    secret,
    path: bracketKeyPath(),
    envWins: info.envWins,
    cloud: nextCloud,
  };
}

export async function revokeBracketKey(cfg = loadConfig(), { sessionSecret = '' } = {}) {
  const rec = getActiveProvider();
  if (!isScalatticeProvider(rec)) {
    const had = Boolean(providerKey(rec));
    if (!had) throw new Error(`No key stored for ${rec.name}.`);
    clearActiveProviderKey();
    return {
      cloud: null,
      hadFile: had,
      cloudNote: '',
      envWins: false,
      path: rec.id,
    };
  }
  requireCloud(cfg);
  const info = inspectBracketKey();
  const keys = await listActiveKeys(cfg);
  let cloud = null;
  let cloudNote = '';
  try {
    const secretForPick = sessionSecret || info.secret;
    cloud = secretForPick
      ? pickBracketCloudKey(keys, secretForPick)
      : keys.find((k) => String(k.name || '') === BRACKET_KEY_NAME) || null;
  } catch (err) {
    cloudNote = err?.message || String(err);
  }
  if (!info.secret && !info.storedKey && !cloud) {
    throw new Error('No Bracket inference key to revoke.');
  }
  if (cloud) {
    await cloudKeys(cfg, `/api/v1/developers/keys/${cloud.id}`, { method: 'DELETE' });
  }
  const hadFile = Boolean(info.storedKey);
  deleteStoredKey();
  return {
    cloud,
    hadFile,
    cloudNote,
    envWins: info.envWins,
    path: info.path,
  };
}

const KEY_USAGE =
  'Usage: scalattice bracket provider key [show|set|new|roll|revoke] [--show]';

export async function cmdBracketKey(rest = [], flags = {}) {
  const action = String(rest[0] || 'show').toLowerCase();
  const showSecret = Boolean(flags.show);
  const cfg = loadConfig();
  if (!action || action === 'show' || action === 'status') {
    const { info, cloud } = await describeBracketKey(cfg);
    print(formatBracketKeyStatus(info, { showSecret, cloud }));
    return;
  }
  if (action === 'set') {
    const secret = String(rest.slice(1).join(' ') || flags.key || '').trim();
    if (!secret) throw new Error('Usage: scalattice bracket provider key set SECRET');
    const rec = setActiveProviderKey(secret);
    print(formatSetResult(rec, secret));
    return;
  }
  if (action === 'new' || action === 'create') {
    print(formatRollResult(await createBracketKey(cfg), { showSecret }));
    return;
  }
  if (action === 'roll') {
    print(formatRollResult(await rollBracketKey(cfg), { showSecret }));
    return;
  }
  if (action === 'revoke') {
    print(formatRevokeResult(await revokeBracketKey(cfg)));
    return;
  }
  throw new Error(KEY_USAGE);
}
