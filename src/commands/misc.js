import { apiFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print } from '../io.js';

export async function cmdCredits() {
  const cfg = loadConfig();
  const data = await apiFetch(cfg, '/credits');
  if (data.unlimited_credits) {
    print('Wallet: unlimited (admin)');
  } else {
    const bal = data.credit_balance_usd;
    print(`Wallet: ${bal == null ? 'n/a' : `$${Number(bal).toFixed(4)}`}`);
  }
  print(`Lifetime spend: $${Number(data.lifetime_spend_usd || 0).toFixed(4)}`);
  const grants = data.model_credits || [];
  if (!grants.length) {
    print('Model grants: none');
    return;
  }
  print('Model grants:');
  for (const g of grants) {
    const label = g.display_name || g.model_id;
    const bal =
      g.grant_type === 'unlimited'
        ? 'unlimited'
        : g.balance_usd == null
          ? 'n/a'
          : `$${Number(g.balance_usd).toFixed(4)}`;
    const exp = g.expires_at ? ` · expires ${g.expires_at}` : '';
    print(`  - ${label} (${g.grant_type}): ${bal}${exp}`);
  }
}

export async function cmdInit() {
  const cfg = loadConfig();
  if (!cfg.apiKey) throw new Error('No API key stored. Run: scalattice setup');
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
  print(`API key: ${cfg.apiKey ? `...${cfg.apiKey.slice(-4)}` : '(none)'}`);
}
