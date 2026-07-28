import { cloudFetch } from '../api.js';
import { loadConfig, saveConfig } from '../config.js';
import { print, prompt } from '../io.js';

export async function cmdLogin(args) {
  const cfg = loadConfig();
  let email = args.email || '';
  if (!email) email = await prompt('Email');
  email = String(email).trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Valid email required');

  await cloudFetch(cfg, '/api/v1/auth/request-code', {
    method: 'POST',
    body: { email },
    cli: true,
  });
  print(`Magic code sent to ${email}. Check your inbox.`);
  const code = await prompt('Paste the code');
  if (!code) throw new Error('Code required');

  const data = await cloudFetch(cfg, '/api/v1/auth/verify-code', {
    method: 'POST',
    body: { email, code },
    cli: true,
  });
  if (!data.token) {
    throw new Error('Login succeeded but no session token was returned. Redeploy the cloud backend with CLI auth support.');
  }

  saveConfig({
    sessionToken: data.token,
    email: data.user?.email || email,
  });
  print(`Signed in as ${data.user?.email || email}`);
  return loadConfig();
}

export async function cmdLogout() {
  saveConfig({
    sessionToken: '',
    apiKey: '',
    apiKeyId: '',
    apiKeyName: '',
  });
  print('Signed out. Session and stored API key cleared.');
}

export async function ensureDeveloperAudience(cfg) {
  const me = await cloudFetch(cfg, '/api/v1/account/me', { token: cfg.sessionToken });
  if (!me.accountAudience) {
    await cloudFetch(cfg, '/api/v1/account/me', {
      method: 'PATCH',
      token: cfg.sessionToken,
      body: { accountAudience: 'developer', disclaimerAcknowledged: true },
    });
    print('Account set to developer.');
  } else if (me.accountAudience === 'provider') {
    await cloudFetch(cfg, '/api/v1/account/me', {
      method: 'PATCH',
      token: cfg.sessionToken,
      body: { accountAudience: 'both' },
    });
    print('Account upgraded to developer + provider (both).');
  }
  return me;
}
