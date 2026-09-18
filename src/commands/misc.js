import { mgmtFetch } from '../api.js';
import { inspectBracketKey } from '../bracket/key.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';
import { authedFetch, requireCloudAuth } from './mgmt.js';
import { looksLikeInferenceKey, probeSession } from '../session.js';
import { localVersion } from '../update.js';

function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'n/a';
  const hundredths = v * 100;
  if (Math.abs(hundredths - Math.round(hundredths)) < 1e-8) {
    return `$${(Math.round(hundredths) / 100).toFixed(2)}`;
  }
  return `$${v.toFixed(4)}`;
}

function shortDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function findGrant(grants, model) {
  const id = String(model || '').trim().toLowerCase();
  if (!id || !Array.isArray(grants) || !grants.length) return grants?.[0] || null;
  return (
    grants.find((g) => {
      const mid = String(g.modelId || g.model_id || '').toLowerCase();
      const name = String(g.displayName || g.display_name || '').toLowerCase();
      return mid === id || name === id || (mid && (id.includes(mid) || mid.includes(id)));
    }) || grants[0]
  );
}

export async function loadBilling(cfg = loadConfig()) {
  if (!cfg.sessionToken && !cfg.mgmtKey) return null;
  try {
    return await authedFetch(cfg, '/api/v1/developers/billing');
  } catch {
    return null;
  }
}

/** Compact status lines for the Bracket banner. */
export function bannerCreditLines(data, model) {
  if (!data) return [];
  const lines = [];
  let wallet = '';
  if (data.unlimitedCredits) wallet = 'Wallet unlimited';
  else if (data.creditBalanceUsd != null) wallet = `Wallet ${usd(data.creditBalanceUsd)}`;
  const spend =
    data.lifetimeSpendUsd != null && Number(data.lifetimeSpendUsd) > 0
      ? `spent ${usd(data.lifetimeSpendUsd)}`
      : '';
  if (wallet) lines.push(spend ? `${wallet} · ${spend}` : wallet);

  const grants = data.modelCredits || [];
  const g = findGrant(grants, model);
  if (g) {
    const label = g.displayName || g.display_name || g.modelId || g.model_id || 'grant';
    const grantType = g.grantType || g.grant_type;
    const bal =
      grantType === 'unlimited' ? 'unlimited' : usd(g.balanceUsd ?? g.balance_usd);
    const exp = shortDate(g.expiresAt || g.expires_at);
    lines.push(exp ? `${label} ${bal} · expires ${exp}` : `${label} ${bal}`);
  }
  return lines;
}

export function formatCredits(data) {
  const lines = [];
  if (data?.unlimitedCredits) {
    lines.push('Wallet: unlimited (admin)');
  } else {
    const bal = data?.creditBalanceUsd;
    lines.push(`Wallet: ${bal == null ? 'n/a' : usd(bal)}`);
  }
  lines.push(`Lifetime spend: ${usd(data?.lifetimeSpendUsd || 0)}`);
  const grants = data?.modelCredits || [];
  if (!grants.length) {
    lines.push('Model grants: none');
    return lines.join('\n');
  }
  lines.push('Model grants:');
  for (const g of grants) {
    const label = g.displayName || g.display_name || g.modelId || g.model_id;
    const grantType = g.grantType || g.grant_type;
    const bal =
      grantType === 'unlimited'
        ? 'unlimited'
        : g.balanceUsd != null
          ? usd(g.balanceUsd)
          : g.balance_usd == null
            ? 'n/a'
            : usd(g.balance_usd);
    const expRaw = g.expiresAt || g.expires_at;
    const exp = expRaw ? ` · expires ${expRaw}` : '';
    lines.push(`  - ${label} (${grantType}): ${bal}${exp}`);
  }
  return lines.join('\n');
}

export async function creditsText(cfg = loadConfig()) {
  const data = await authedFetch(requireCloudAuth(cfg), '/api/v1/developers/billing');
  return formatCredits(data);
}

export async function cmdCredits() {
  print(await creditsText());
}

export async function cmdInit() {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'No inference API key in the environment. Run: scalattice developers keys create\nThen: export SCALATTICE_API_KEY=slt_…'
    );
  }
  print(`export SCALATTICE_API_KEY=${cfg.apiKey}`);
  print(`export OPENAI_BASE_URL=${cfg.apiUrl}`);
  print(`export OPENAI_API_KEY=${cfg.apiKey}`);
}

export async function whoamiText(cfg = loadConfig()) {
  const lines = [
    `CLI:     ${localVersion() || 'unknown'}`,
    `Cloud:   ${cfg.cloudUrl}`,
    `API:     ${cfg.apiUrl}`,
    `Email:   ${cfg.email || '(not signed in)'}`,
  ];

  let sessionOk = false;
  if (cfg.sessionToken) {
    const me = await probeSession(cfg);
    if (!me) {
      lines.push('Session: stored, but expired or invalid');
      lines.push(`Refresh: open ${cfg.cloudUrl}/auth. If that tab is already signed in, Cloud shows a command to copy.`);
    } else {
      sessionOk = true;
      lines.push('Session: yes');
      if (me?.email) lines.push(`Account: ${me.email}${me.name ? ` (${me.name})` : ''}`);
      if (me?.accountAudience) lines.push(`Audience: ${me.accountAudience}`);
    }
  } else if (cfg.mgmtKey) {
    try {
      const me = await mgmtFetch(cfg, '/api/v1/account/me');
      sessionOk = true;
      lines.push('Session: management key');
      if (me?.email) lines.push(`Account: ${me.email}${me.name ? ` (${me.name})` : ''}`);
      if (me?.accountAudience) lines.push(`Audience: ${me.accountAudience}`);
    } catch (err) {
      lines.push(`Session: management key failed (${err?.message || err})`);
    }
  } else {
    lines.push('Session: no');
  }

  if (looksLikeInferenceKey(cfg.apiKey)) {
    lines.push(`Inference: env (…${cfg.apiKey.slice(-4)})`);
    if (!sessionOk) lines.push('Bracket: scalattice bracket   (the inference key is enough)');
  } else {
    const key = inspectBracketKey(cfg);
    if (key.storedKey) {
      lines.push(`Inference: bracket.key (…${key.lastFour})`);
      lines.push(`Key file: ${key.path}`);
    } else {
      lines.push('Inference: none (no env, no bracket.key)');
    }
  }
  lines.push('Manage:  scalattice bracket key   (show / roll / revoke)');
  return lines.join('\n');
}

export async function cmdWhoami() {
  print(await whoamiText());
}
