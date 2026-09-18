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
    `Open ${cloud}/auth in a browser, copy the curl command, and run it in this terminal.`,
    `That writes a fresh session to ${configPath()}.`,
    'Then retry Bracket with this checkout, not the old npm install:',
    '  node ./bin/scalattice.js bracket',
    'Or skip the session and use an inference key from Cloud → Developers:',
    '  export OPENAI_API_KEY=slt_…',
  ].join('\n');
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
