import { mgmtFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';
import { requireMgmt } from './mgmt.js';

export async function cmdCredits() {
  const cfg = requireMgmt(loadConfig());
  const data = await mgmtFetch(cfg, '/api/v1/developers/billing');
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
  if (!cfg.apiKey) throw new Error('No inference API key stored. Run: scalattice setup');
  print(`export OPENAI_BASE_URL=${cfg.apiUrl}`);
  print(`export OPENAI_API_KEY=${cfg.apiKey}`);
  print('# Optional: SCALATTICE_API_KEY is also accepted by this CLI');
}

export async function cmdWhoami() {
  const cfg = loadConfig();
  print(`Cloud:   ${cfg.cloudUrl}`);
  print(`API:     ${cfg.apiUrl}`);
  print(`Email:   ${cfg.email || '(not signed in)'}`);
  print(`Session: ${cfg.sessionToken ? 'yes' : 'no'}`);
  print(`Mgmt key: ${cfg.mgmtKey ? `...${cfg.mgmtKey.slice(-4)}` : '(none)'}`);
  print(`API key:  ${cfg.apiKey ? `...${cfg.apiKey.slice(-4)}` : '(none)'}`);
  if (cfg.mgmtKey) {
    try {
      const me = await mgmtFetch(cfg, '/api/v1/account/me');
      if (me?.email) print(`Account: ${me.email}${me.name ? ` (${me.name})` : ''}`);
      if (me?.accountAudience) print(`Audience: ${me.accountAudience}`);
    } catch {
      /* ignore */
    }
  }
}
