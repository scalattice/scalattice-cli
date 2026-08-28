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
  print('Try: scalattice provider machines create');
  print('     scalattice provider machines');
  print('     scalattice provider earnings');
  return cfg;
}

function machineId(args, rest = []) {
  return String(args.machine || args.id || rest[0] || '').trim();
}

function printMachineToken(secret, { rolled = false, windowsSetupPageUrl } = {}) {
  print(
    rolled
      ? 'Machine token rolled (new secret shown once, not stored):'
      : 'Machine created. Token (shown once, not stored):'
  );
  print(secret);
  print('');
  print('On the GPU host:');
  print(`  scalattice-agent set-token --token ${secret}`);
  if (windowsSetupPageUrl) {
    print('');
    print(`Windows setup: ${windowsSetupPageUrl}`);
  }
}

export async function cmdProviderMachinesList() {
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
      `${m.id}\t${m.name || 'unnamed'}\t${live}\t${accepting}\t...${m.lastFour || '????'}\t${m.scheduleMode || '?'}\t$${earned}`
    );
  }
}

export async function cmdProviderMachinesCreate(args) {
  const cfg = requireSession(loadConfig());
  const name =
    args.name ||
    (args.yes ? 'CLI machine' : await prompt('Machine name', { defaultValue: 'CLI machine' }));
  const data = await cloudFetch(cfg, '/api/v1/providers/keys', {
    method: 'POST',
    token: cfg.sessionToken,
    body: { name },
  });
  const secret = data.secret;
  if (!secret) throw new Error('Machine created but token missing from response');
  printMachineToken(secret, { windowsSetupPageUrl: data.windowsSetupPageUrl });
}

export async function cmdProviderMachinesRoll(args, rest = []) {
  const cfg = requireSession(loadConfig());
  const id = machineId(args, rest);
  if (!id) throw new Error('Usage: provider machines roll --machine ID');
  const data = await cloudFetch(cfg, `/api/v1/providers/machines/${id}/roll-token`, {
    method: 'POST',
    token: cfg.sessionToken,
    body: {},
  });
  const secret = data.secret;
  if (!secret) throw new Error('Token rolled but secret missing from response');
  printMachineToken(secret, { rolled: true, windowsSetupPageUrl: data.windowsSetupPageUrl });
}

export async function cmdProviderMachinesRevoke(args, rest = []) {
  const cfg = requireSession(loadConfig());
  const id = machineId(args, rest);
  if (!id) throw new Error('Usage: provider machines revoke --machine ID');
  await cloudFetch(cfg, `/api/v1/providers/keys/${id}`, {
    method: 'DELETE',
    token: cfg.sessionToken,
  });
  print(`Removed machine ${id} (never connected). Connected machines: pause instead.`);
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
  const id = machineId(args);
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

export async function cmdProviderReconnect(args, rest = []) {
  const cfg = requireCloudAuth(loadConfig());
  const id = machineId(args, rest);
  if (!id) throw new Error('Usage: scalattice provider reconnect --machine ID');
  const data = await mgmtFetch(cfg, `/api/v1/providers/machines/${id}/reconnect`, {
    method: 'POST',
    body: {},
  });
  print(data.message || `Re-connect requested for ${data.id || id} (disconnected=${data.disconnected ?? 0}).`);
}
