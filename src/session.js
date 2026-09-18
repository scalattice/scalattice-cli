import { cloudFetch } from './api.js';
import { configPath } from './config.js';

export function looksLikeInferenceKey(value) {
  const s = String(value || '').trim();
  if (!s.startsWith('slt_')) return false;
  if (s.startsWith('slt_mgmt_') || s.startsWith('slt_provider_')) return false;
  return s.length > 12;
}

export function sessionRefreshHint(cfg) {
  const cloud = cfg?.cloudUrl || 'https://scalattice.cloud';
  return [
    'Cloud session is missing or expired.',
    `Open ${cloud}/auth. If that tab is already signed in, Cloud shows a command to copy — run it here.`,
    `That writes a session to ${configPath()}. Then try again.`,
  ].join('\n');
}

export function bracketAuthHint(cfg) {
  return [
    sessionRefreshHint(cfg),
    '',
    'Bracket calls the inference API, so it needs a developer key (slt_…).',
    'Not an account management key (slt_mgmt_…) and not a provider token (slt_provider_…).',
    'A live session is enough — Bracket mints the developer key.',
    'To set one yourself:  export SCALATTICE_API_KEY=slt_…',
  ].join('\n');
}

export function wrongKeyHint(value) {
  const s = String(value || '').trim();
  if (s.startsWith('slt_mgmt_')) {
    return 'That is an account management key (slt_mgmt_…). Bracket needs a developer inference key (slt_…).';
  }
  if (s.startsWith('slt_provider_')) {
    return 'That is a provider machine token (slt_provider_…). Bracket needs a developer inference key (slt_…).';
  }
  if (s && !looksLikeInferenceKey(s)) {
    return 'SCALATTICE_API_KEY is not a developer inference key (slt_…).';
  }
  return '';
}

export async function probeSession(cfg) {
  if (!cfg?.sessionToken) return null;
  try {
    return await cloudFetch(cfg, '/api/v1/account/me', { token: cfg.sessionToken });
  } catch {
    return null;
  }
}

export function isAuthFailure(err) {
  const status = err?.status;
  const msg = String(err?.message || '');
  return status === 401 || /invalid token|missing authentication|unauthor/i.test(msg);
}
