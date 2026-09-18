import { mgmtFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';
import { authedFetch, requireCloudAuth } from './mgmt.js';
import { looksLikeInferenceKey, probeSession } from '../session.js';

function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'n/a';
  if (v === 0 || Math.abs(v) >= 0.01) return `$${v.toFixed(2)}`;
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

export async function cmdCredits() {
  const cfg = requireCloudAuth(loadConfig());
  const data = await authedFetch(cfg, '/api/v1/developers/billing');
  if (data.unlimitedCredits) {
    print('Wallet: unlimited (admin)');
  } else {
    const bal = data.creditBalanceUsd;
    print(`Wallet: ${bal == null ? 'n/a' : `$${Number(bal).toFixed(4)}`}`);
  }
  print(`Lifetime spend: $${Number(data.lifetimeSpendUsd || 0).toFixed(4)}`);
  const grants = data.modelCredits || [];
  if (!grants.length) {
    print('Model grants: none');
    return;
  }
  print('Model grants:');
  for (const g of grants) {
    const label = g.displayName || g.display_name || g.modelId || g.model_id;
    const grantType = g.grantType || g.grant_type;
    const bal =
      grantType === 'unlimited'
        ? 'unlimited'
        : g.balanceUsd != null
          ? `$${Number(g.balanceUsd).toFixed(4)}`
          : g.balance_usd == null
            ? 'n/a'
            : `$${Number(g.balance_usd).toFixed(4)}`;
    const expRaw = g.expiresAt || g.expires_at;
    const exp = expRaw ? ` · expires ${expRaw}` : '';
    print(`  - ${label} (${grantType}): ${bal}${exp}`);
  }
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

export async function cmdWhoami() {
  const cfg = loadConfig();
  print(`Cloud:   ${cfg.cloudUrl}`);
  print(`API:     ${cfg.apiUrl}`);
  print(`Email:   ${cfg.email || '(not signed in)'}`);

  let sessionOk = false;
  if (cfg.sessionToken) {
    const me = await probeSession(cfg);
    if (!me) {
      print('Session: stored, but expired or invalid');
      print(`Refresh: open ${cfg.cloudUrl}/auth. If that tab is already signed in, Cloud shows a command to copy.`);
    } else {
      sessionOk = true;
      print('Session: yes');
      if (me?.email) print(`Account: ${me.email}${me.name ? ` (${me.name})` : ''}`);
      if (me?.accountAudience) print(`Audience: ${me.accountAudience}`);
    }
  } else if (cfg.mgmtKey) {
    try {
      const me = await mgmtFetch(cfg, '/api/v1/account/me');
      sessionOk = true;
      print('Session: management key');
      if (me?.email) print(`Account: ${me.email}${me.name ? ` (${me.name})` : ''}`);
      if (me?.accountAudience) print(`Audience: ${me.accountAudience}`);
    } catch (err) {
      print(`Session: management key failed (${err?.message || err})`);
    }
  } else {
    print('Session: no');
  }

  if (looksLikeInferenceKey(cfg.apiKey)) {
    print(`Inference: SCALATTICE_API_KEY set (…${cfg.apiKey.slice(-4)})`);
    if (!sessionOk) print('Bracket: scalattice bracket   (the inference key is enough)');
  } else {
    print('Inference: no developer key in the environment');
  }
}
