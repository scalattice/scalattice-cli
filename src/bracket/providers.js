import fs from 'node:fs';
import path from 'node:path';
import { bracketKeyPath, configDir } from '../config.js';
import { print } from '../io.js';
import { looksLikeInferenceKey } from '../session.js';

export const SCALATTICE_PROVIDER_ID = 'scalattice';
export const SCALATTICE_PROVIDER_NAME = 'Scalattice';
export const DEFAULT_SCALATTICE_API_URL = 'https://api.scalattice.cloud/v1';

export function providersPath() {
  return path.join(configDir(), 'bracket.providers.json');
}

export function isScalatticeProvider(rec) {
  return String(rec?.id || '') === SCALATTICE_PROVIDER_ID || rec?.builtin === true;
}

function lastFour(secret) {
  const s = String(secret || '').trim();
  return s.length >= 4 ? s.slice(-4) : '';
}

export function normalizeApiUrl(url) {
  let u = String(url || '').trim();
  if (!u) throw new Error('API URL is required');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '');
  if (!/\/v1$/i.test(u)) u += '/v1';
  return u;
}

export function slugProviderId(name) {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'provider';
}

function uniqueId(name, taken) {
  const base = slugProviderId(name);
  const blocked = new Set([...(taken || []), SCALATTICE_PROVIDER_ID]);
  if (!blocked.has(base)) return base;
  let i = 2;
  while (blocked.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function looksLikeProviderSecret(value, { scalattice = false } = {}) {
  const s = String(value || '').trim();
  if (!s || s.length < 8) return false;
  if (s.startsWith('slt_mgmt_') || s.startsWith('slt_provider_')) return false;
  if (scalattice) return looksLikeInferenceKey(s);
  return true;
}

function readScalatticeKeyFile() {
  try {
    const raw = fs.readFileSync(bracketKeyPath(), 'utf8').trim();
    return looksLikeInferenceKey(raw) ? raw : '';
  } catch {
    return '';
  }
}

function writeScalatticeKeyFile(secret) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(bracketKeyPath(), `${secret}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(bracketKeyPath(), 0o600);
  } catch {
    /* ignore */
  }
}

function builtinRecord(saved = {}) {
  return {
    id: SCALATTICE_PROVIDER_ID,
    name: SCALATTICE_PROVIDER_NAME,
    builtin: true,
    apiUrl: DEFAULT_SCALATTICE_API_URL,
    key: '',
    model: String(saved.model || '').trim(),
  };
}

function readStoreFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(providersPath(), 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* missing or invalid */
  }
  return {};
}

function normalizeCustom(raw) {
  const id = slugProviderId(raw.id || raw.name);
  if (!id || id === SCALATTICE_PROVIDER_ID) return null;
  let apiUrl;
  try {
    apiUrl = normalizeApiUrl(raw.apiUrl || raw.url);
  } catch {
    return null;
  }
  return {
    id,
    name: String(raw.name || id).trim() || id,
    builtin: false,
    apiUrl,
    key: String(raw.key || '').trim(),
    model: String(raw.model || '').trim(),
  };
}

export function loadProviderStore() {
  const raw = readStoreFile();
  const customs = [];
  const seen = new Set();
  for (const row of raw.providers || []) {
    if (isScalatticeProvider(row)) continue;
    const rec = normalizeCustom(row);
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    customs.push(rec);
  }
  const savedBuiltin = (raw.providers || []).find((p) => isScalatticeProvider(p)) || {};
  const providers = [builtinRecord(savedBuiltin), ...customs];
  const active = providers.some((p) => p.id === raw.active) ? raw.active : SCALATTICE_PROVIDER_ID;
  return { active, providers };
}

function writeStore(store) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const body = {
    active: store.active || SCALATTICE_PROVIDER_ID,
    providers: (store.providers || [])
      .filter((p) => p && p.id)
      .map((p) =>
        isScalatticeProvider(p)
          ? {
              id: SCALATTICE_PROVIDER_ID,
              name: SCALATTICE_PROVIDER_NAME,
              builtin: true,
              model: p.model || undefined,
            }
          : {
              id: p.id,
              name: p.name,
              apiUrl: p.apiUrl,
              key: p.key || undefined,
              model: p.model || undefined,
            }
      ),
  };
  const file = providersPath();
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  return loadProviderStore();
}

export function listProviders() {
  return loadProviderStore().providers;
}

export function getActiveProvider() {
  const store = loadProviderStore();
  return store.providers.find((p) => p.id === store.active) || store.providers[0];
}

export function findProvider(ref) {
  const token = String(ref || '').trim().toLowerCase();
  if (!token) return null;
  const store = loadProviderStore();
  return (
    store.providers.find((p) => p.id === token) ||
    store.providers.find((p) => String(p.name || '').toLowerCase() === token) ||
    null
  );
}

export function requireProvider(ref) {
  const rec = findProvider(ref);
  if (!rec) throw new Error(`No provider "${ref}". /provider to list.`);
  return rec;
}

export function providerKey(rec, cfg = {}) {
  const row = rec || getActiveProvider();
  if (isScalatticeProvider(row)) {
    const envRaw = String(cfg.apiKey || process.env.SCALATTICE_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    if (looksLikeInferenceKey(envRaw)) return envRaw;
    return readScalatticeKeyFile();
  }
  return String(row.key || '').trim();
}

export function addProvider({ name, url, key = '', model = '' } = {}) {
  const label = String(name || '').trim();
  if (!label) throw new Error('Usage: /provider add NAME URL');
  const apiUrl = normalizeApiUrl(url);
  const secret = String(key || '').trim();
  if (secret && !looksLikeProviderSecret(secret)) {
    throw new Error('That key is not valid (not slt_mgmt_… or slt_provider_…).');
  }
  const store = loadProviderStore();
  const id = uniqueId(label, store.providers.map((p) => p.id));
  store.providers.push({
    id,
    name: label,
    builtin: false,
    apiUrl,
    key: secret,
    model: String(model || '').trim(),
  });
  writeStore(store);
  return findProvider(id);
}

export function useProvider(ref) {
  const rec = requireProvider(ref);
  const store = loadProviderStore();
  store.active = rec.id;
  writeStore(store);
  return rec;
}

export function removeProvider(ref) {
  const rec = requireProvider(ref);
  if (isScalatticeProvider(rec)) {
    throw new Error('The Scalattice provider cannot be removed.');
  }
  const store = loadProviderStore();
  store.providers = store.providers.filter((p) => p.id !== rec.id);
  if (store.active === rec.id) store.active = SCALATTICE_PROVIDER_ID;
  writeStore(store);
  return rec;
}

export function patchProvider(id, patch) {
  const rec = requireProvider(id);
  if (isScalatticeProvider(rec) && (patch.apiUrl || patch.url)) {
    throw new Error('The Scalattice API URL is fixed.');
  }
  const store = loadProviderStore();
  store.providers = store.providers.map((p) => {
    if (p.id !== rec.id) return p;
    const next = { ...p, ...patch };
    if (patch.url) next.apiUrl = normalizeApiUrl(patch.url);
    if (patch.apiUrl) next.apiUrl = normalizeApiUrl(patch.apiUrl);
    if (patch.key != null) next.key = String(patch.key || '').trim();
    if (patch.model != null) next.model = String(patch.model || '').trim();
    if (patch.name) next.name = String(patch.name).trim() || p.name;
    if (isScalatticeProvider(next)) {
      next.id = SCALATTICE_PROVIDER_ID;
      next.builtin = true;
      next.apiUrl = DEFAULT_SCALATTICE_API_URL;
      next.key = '';
    }
    return next;
  });
  writeStore(store);
  return findProvider(rec.id);
}

export function setActiveProviderModel(model) {
  return patchProvider(getActiveProvider().id, { model: String(model || '').trim() });
}

export function setActiveProviderKey(secret) {
  const rec = getActiveProvider();
  const value = String(secret || '').trim();
  if (!looksLikeProviderSecret(value, { scalattice: isScalatticeProvider(rec) })) {
    throw new Error(
      isScalatticeProvider(rec)
        ? 'Scalattice needs a developer inference key (slt_…). Not slt_mgmt_… or slt_provider_….'
        : 'Pass a non-empty API key. Not slt_mgmt_… or slt_provider_….'
    );
  }
  if (isScalatticeProvider(rec)) {
    writeScalatticeKeyFile(value);
    return getActiveProvider();
  }
  return patchProvider(rec.id, { key: value });
}

export function clearActiveProviderKey() {
  const rec = getActiveProvider();
  if (isScalatticeProvider(rec)) return rec;
  return patchProvider(rec.id, { key: '' });
}

export function formatProviderList(store = loadProviderStore(), { keyFor } = {}) {
  const rows = store.providers.map((p) => {
    const secret = typeof keyFor === 'function' ? keyFor(p) : providerKey(p);
    const four = lastFour(secret);
    return {
      active: p.id === store.active,
      id: p.id,
      name: p.name,
      model: p.model || '',
      url: isScalatticeProvider(p) ? DEFAULT_SCALATTICE_API_URL : p.apiUrl,
      lastFour: four,
      builtin: Boolean(p.builtin || isScalatticeProvider(p)),
    };
  });
  const idW = Math.max(2, ...rows.map((r) => r.id.length));
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));
  const lines = ['Providers  (* in use). Scalattice cannot be removed.', ''];
  for (const r of rows) {
    const mark = r.active ? '*' : ' ';
    const key = r.lastFour ? `…${r.lastFour}` : '(no key)';
    const model = r.model || '(no model)';
    const extra = r.builtin ? 'builtin' : r.url;
    lines.push(`${mark} ${r.id.padEnd(idW)}  ${r.name.padEnd(nameW)}  ${key}  ${model}  ${extra}`);
  }
  lines.push('');
  lines.push('Switch:  /provider use NAME');
  lines.push('Add:     /provider add NAME URL');
  lines.push('Key:     /provider key set SECRET   or   /provider key new');
  return lines.join('\n');
}

export function formatProviderSwitch(rec) {
  const url = isScalatticeProvider(rec) ? DEFAULT_SCALATTICE_API_URL : rec.apiUrl;
  return `Provider: ${rec.name} (${rec.id})\nAPI:      ${url}`;
}

export async function cmdBracketProvider(rest = [], flags = {}) {
  const action = String(rest[0] || 'list').toLowerCase();
  if (!action || action === 'list' || action === 'ls' || action === 'show') {
    print(formatProviderList());
    return;
  }
  if (action === 'add') {
    const rec = addProvider({
      name: flags.name || rest[1],
      url: flags.url || rest[2],
      key: flags.key,
      model: flags.model,
    });
    print(
      `Added ${rec.name} (${rec.id})\nAPI:  ${rec.apiUrl}\nUse:  scalattice bracket provider use ${rec.id}\nKey:  scalattice bracket provider key set SECRET`
    );
    return;
  }
  if (action === 'use' || action === 'switch') {
    const rec = useProvider(flags.id || rest[1]);
    print(formatProviderSwitch(rec));
    return;
  }
  if (action === 'rm' || action === 'remove' || action === 'delete') {
    const rec = removeProvider(flags.id || rest[1]);
    print(`Removed ${rec.name} (${rec.id})`);
    return;
  }
  if (action === 'url') {
    const rec = patchProvider(getActiveProvider().id, { url: flags.url || rest[1] });
    print(formatProviderSwitch(rec));
    return;
  }
  if (action === 'key' || action === 'keys') {
    const { cmdBracketKey } = await import('./key.js');
    const inner = rest.slice(1);
    const verb = String(inner[0] || 'show').toLowerCase();
    const known = ['show', 'status', 'set', 'new', 'create', 'roll', 'revoke'];
    if (inner.length && !known.includes(verb)) {
      if (looksLikeProviderSecret(inner.join(' '))) {
        await cmdBracketKey(['set', ...inner], flags);
        return;
      }
      throw new Error(
        'Usage: scalattice bracket provider key [show|set|new|roll|revoke] [--show]'
      );
    }
    await cmdBracketKey(inner, flags);
    return;
  }
  throw new Error(
    'Usage: scalattice bracket provider [list|add|use|remove|url|key]\n' +
      '  add NAME URL\n' +
      '  use NAME\n' +
      '  key [show|set|new|roll|revoke]\n' +
      '  remove NAME'
  );
}
