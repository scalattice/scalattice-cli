import { cloudFetch, mgmtFetch } from '../api.js';
import { loadConfig, saveConfig } from '../config.js';
import { print, prompt } from '../io.js';
import { cmdLogin, ensureProviderAudience } from './login.js';

function requireSession(cfg) {
  if (!cfg.sessionToken) throw new Error('Not signed in. Run: scalattice login');
  return cfg;
}

function requireMgmt(cfg) {
  if (!cfg.mgmtKey) throw new Error('No Fleet API key. Run: scalattice provider setup');
  return cfg;
}

export async function cmdProviderSetup(args) {
  let cfg = loadConfig();
  if (!cfg.sessionToken || args.forceLogin) {
    cfg = await cmdLogin(args);
  }
  requireSession(cfg);
  await ensureProviderAudience(cfg);

  if (args.paste) {
    const pasted = String(args.paste).trim();
    if (!pasted.startsWith('slt_mgmt_')) {
      throw new Error('Fleet API key must start with slt_mgmt_');
    }
    saveConfig({ mgmtKey: pasted, mgmtKeyId: '', mgmtKeyName: 'pasted' });
    print('Fleet API key saved locally.');
    print('Try: scalattice provider machines');
    return;
  }

  if (!args.newKey && cfg.mgmtKey) {
    print(`Fleet API key already configured (...${cfg.mgmtKey.slice(-4)}).`);
    print('Use --new-key to create another, or SCALATTICE_MGMT_KEY to override.');
    return;
  }

  const name =
    args.name ||
    (args.yes ? 'CLI fleet key' : await prompt('Key name', { defaultValue: 'CLI fleet key' }));
  const data = await cloudFetch(cfg, '/api/v1/providers/mgmt-keys', {
    method: 'POST',
    token: cfg.sessionToken,
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key created but secret missing from response');
  saveConfig({
    mgmtKey: secret,
    mgmtKeyId: String(data.key?.id || ''),
    mgmtKeyName: data.key?.name || name,
  });
  print('Fleet API key created and saved locally (shown once):');
  print(secret);
  print('');
  print('Try:');
  print('  scalattice provider machines');
  print('  scalattice provider earnings');
  print('  scalattice mcp');
}

export async function cmdProviderKeysList() {
  const cfg = requireSession(loadConfig());
  await ensureProviderAudience(cfg);
  const data = await cloudFetch(cfg, '/api/v1/providers/mgmt-keys', { token: cfg.sessionToken });
  const keys = data.keys || [];
  if (!keys.length) {
    print('No Fleet API keys yet.');
    return;
  }
  for (const k of keys) {
    print(`${k.id}\t${k.name || 'unnamed'}\t...${k.lastFour || '????'}\t${k.status || 'active'}`);
  }
}

export async function cmdProviderKeysCreate(args) {
  const cfg = requireSession(loadConfig());
  await ensureProviderAudience(cfg);
  const name =
    args.name ||
    (args.yes ? 'CLI fleet key' : await prompt('Key name', { defaultValue: 'CLI fleet key' }));
  const data = await cloudFetch(cfg, '/api/v1/providers/mgmt-keys', {
    method: 'POST',
    token: cfg.sessionToken,
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key created but secret missing from response');
  saveConfig({
    mgmtKey: secret,
    mgmtKeyId: String(data.key?.id || ''),
    mgmtKeyName: data.key?.name || name,
  });
  print('Fleet API key created and saved locally (shown once):');
  print(secret);
}

export async function cmdProviderKeysRoll(args) {
  const cfg = requireSession(loadConfig());
  await ensureProviderAudience(cfg);
  const id = String(args.id || '').trim();
  if (!id) throw new Error('Usage: scalattice provider keys roll --id KEY_ID');
  const data = await cloudFetch(cfg, `/api/v1/providers/mgmt-keys/${id}/roll`, {
    method: 'POST',
    token: cfg.sessionToken,
  });
  const secret = data.secret;
  if (!secret) throw new Error('Key rolled but secret missing from response');
  if (String(cfg.mgmtKeyId) === id || !cfg.mgmtKeyId) {
    saveConfig({
      mgmtKey: secret,
      mgmtKeyId: String(data.key?.id || id),
      mgmtKeyName: data.key?.name || cfg.mgmtKeyName,
    });
  }
  print('Fleet API key rolled (new secret shown once):');
  print(secret);
}

export async function cmdProviderKeysRevoke(args) {
  const cfg = requireSession(loadConfig());
  await ensureProviderAudience(cfg);
  const id = String(args.id || '').trim();
  if (!id) throw new Error('Usage: scalattice provider keys revoke --id KEY_ID');
  await cloudFetch(cfg, `/api/v1/providers/mgmt-keys/${id}`, {
    method: 'DELETE',
    token: cfg.sessionToken,
  });
  if (String(cfg.mgmtKeyId) === id) {
    saveConfig({ mgmtKey: '', mgmtKeyId: '', mgmtKeyName: '' });
  }
  print(`Revoked Fleet API key ${id}`);
}

export async function cmdProviderMachines() {
  const cfg = requireMgmt(loadConfig());
  const data = await mgmtFetch(cfg, '/machines');
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
  const cfg = requireMgmt(loadConfig());
  const data = await mgmtFetch(cfg, '/earnings');
  print(`totalEarnedUsd\t${Number(data.totalEarnedUsd || 0).toFixed(4)}`);
  print(`pendingPayoutUsd\t${Number(data.pendingPayoutUsd || 0).toFixed(4)}`);
  if (data.payoutEmail) print(`payoutEmail\t${data.payoutEmail}`);
}

export async function cmdProviderPause() {
  const cfg = requireMgmt(loadConfig());
  const data = await mgmtFetch(cfg, '/machines/schedule', {
    method: 'POST',
    body: { accepting: false },
  });
  print(`Paused fleet (${data.updated || 0}/${data.total || 0} machines updated).`);
}

export async function cmdProviderResume() {
  const cfg = requireMgmt(loadConfig());
  const data = await mgmtFetch(cfg, '/machines/schedule', {
    method: 'POST',
    body: { accepting: true },
  });
  print(`Resumed fleet (${data.updated || 0}/${data.total || 0} machines updated).`);
}

export async function cmdProviderSchedule(args) {
  const cfg = requireMgmt(loadConfig());
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
  const data = await mgmtFetch(cfg, `/machines/${id}`, { method: 'PATCH', body });
  const m = data.machine || {};
  print(
    `${m.id || id}\t${m.name || ''}\t${m.scheduleMode || mode}\taccepting=${m.acceptingJobs ? 'yes' : 'no'}`
  );
}
