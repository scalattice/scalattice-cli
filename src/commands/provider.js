import { cloudFetch, mgmtFetch } from '../api.js';
import { loadConfig } from '../config.js';
import { print, prompt } from '../io.js';
import { cmdLogin, ensureProviderAudience } from './login.js';
import { requireCloudAuth, requireSession } from './mgmt.js';

export async function cmdProviderSetup(args) {
  let cfg = loadConfig();
  if (!cfg.sessionToken || args.forceLogin) {
    cfg = await cmdLogin(args);
  }
  requireSession(cfg);
  await ensureProviderAudience(cfg);
  print('Signed in. Fleet commands use this session.');
  print('Try: scalattice provider machines');
  print('     scalattice provider earnings');
  return cfg;
}

export async function cmdProviderKeysList() {
  const cfg = requireSession(loadConfig());
  const data = await cloudFetch(cfg, '/api/v1/account/mgmt-keys', { token: cfg.sessionToken });
  const keys = data.keys || [];
  if (!keys.length) {
    print('No account management keys yet.');
    return;
  }
  for (const k of keys) {
    print(`${k.id}\t${k.name || 'unnamed'}\t...${k.lastFour || '????'}\t${k.status || 'active'}`);
  }
}

export async function cmdProviderKeysCreate(args) {
  const cfg = requireSession(loadConfig());
  const name =
    args.name ||
    (args.yes
      ? 'CLI management key'
      : await prompt('Key name', { defaultValue: 'CLI management key' }));
  const data = await cloudFetch(cfg, '/api/v1/account/mgmt-keys', {
    method: 'POST',
    token: cfg.sessionToken,
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key created but secret missing from response');
  print('Account management key (shown once, not stored):');
  print(secret);
  print('');
  print('For MCP / scripts:');
  print(`  export SCALATTICE_MGMT_KEY=${secret}`);
}

export async function cmdProviderKeysRoll(args) {
  const cfg = requireSession(loadConfig());
  const id = String(args.id || '').trim();
  if (!id) throw new Error('Usage: scalattice provider keys roll --id KEY_ID');
  const data = await cloudFetch(cfg, `/api/v1/account/mgmt-keys/${id}/roll`, {
    method: 'POST',
    token: cfg.sessionToken,
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key rolled but secret missing from response');
  print('Account management key rolled (new secret shown once, not stored):');
  print(secret);
}

export async function cmdProviderKeysRevoke(args) {
  const cfg = requireSession(loadConfig());
  const id = String(args.id || '').trim();
  if (!id) throw new Error('Usage: scalattice provider keys revoke --id KEY_ID');
  await cloudFetch(cfg, `/api/v1/account/mgmt-keys/${id}`, {
    method: 'DELETE',
    token: cfg.sessionToken,
  });
  print(`Revoked account management key ${id}`);
}

export async function cmdProviderMachines() {
  const cfg = requireCloudAuth(loadConfig());
  const data = await mgmtFetch(cfg, '/api/v1/providers/machines');
  const machines = data.machines || [];
  if (!machines.length) {
    print('No machines.');
    return;
  }
  for (const m of machines) {
    const live = m.live ? 'live' : 'offline';
    const accepting = m.acceptingJobs ? 'accepting' : 'paused';
    const earned = Number(m.statsEarnedUsd || 0).toFixed(2);
    print(
      `${m.id}\t${m.name || 'unnamed'}\t${live}\t${accepting}\t${m.scheduleMode || '?'}\t$${earned}`
    );
  }
}

export async function cmdProviderEarnings() {
  const cfg = requireCloudAuth(loadConfig());
  const data = await mgmtFetch(cfg, '/api/v1/providers/earnings');
  print(`totalEarnedUsd\t${Number(data.totalEarnedUsd || 0).toFixed(4)}`);
  print(`pendingPayoutUsd\t${Number(data.pendingPayoutUsd || 0).toFixed(4)}`);
  if (data.payoutEmail) print(`payoutEmail\t${data.payoutEmail}`);
}

export async function cmdProviderPause() {
  const cfg = requireCloudAuth(loadConfig());
  const data = await mgmtFetch(cfg, '/api/v1/providers/machines/schedule', {
    method: 'POST',
    body: { accepting: false },
  });
  print(`Paused fleet (${data.updated || 0}/${data.total || 0} machines updated).`);
}

export async function cmdProviderResume() {
  const cfg = requireCloudAuth(loadConfig());
  const data = await mgmtFetch(cfg, '/api/v1/providers/machines/schedule', {
    method: 'POST',
    body: { accepting: true },
  });
  print(`Resumed fleet (${data.updated || 0}/${data.total || 0} machines updated).`);
}

export async function cmdProviderSchedule(args) {
  const cfg = requireCloudAuth(loadConfig());
  const id = String(args.machine || args.id || '').trim();
  if (!id) throw new Error('Usage: scalattice provider schedule --machine ID --mode always|paused|windows');
  const mode = String(args.mode || '').trim();
  if (!['always', 'paused', 'windows'].includes(mode)) {
    throw new Error('--mode must be always, paused, or windows');
  }
  const body = { scheduleMode: mode };
  if (mode === 'windows' && args.windows) {
    try {
      body.scheduleWindows = JSON.parse(args.windows);
    } catch {
      throw new Error('--windows must be JSON array of {days,start,end}');
    }
  }
  if (args.name) body.name = args.name;
  const data = await mgmtFetch(cfg, `/api/v1/providers/machines/${id}`, { method: 'PATCH', body });
  const m = data.machine || {};
  print(
    `${m.id || id}\t${m.name || ''}\t${m.scheduleMode || mode}\taccepting=${m.acceptingJobs ? 'yes' : 'no'}`
  );
}

export async function cmdProviderReconnect(args) {
  const cfg = requireCloudAuth(loadConfig());
  const id = String(args.machine || args.id || '').trim();
  if (!id) throw new Error('Usage: scalattice provider reconnect --machine ID');
  const data = await mgmtFetch(cfg, `/api/v1/providers/machines/${id}/reconnect`, {
    method: 'POST',
    body: {},
  });
  print(data.message || `Re-connect requested for ${data.id || id} (disconnected=${data.disconnected ?? 0}).`);
}
