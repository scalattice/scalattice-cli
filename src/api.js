export async function cloudFetch(cfg, path, { method = 'GET', body, token, cli = false } = {}) {
  const url = `${cfg.cloudUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (cli) headers['X-Scalattice-Client'] = 'cli';
  const auth = token || cfg.sessionToken;
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Cloud management API via account management key (`slt_mgmt_…`).
 * `path` is absolute under cloud origin, e.g. `/api/v1/developers/keys`.
 */
export async function mgmtFetch(cfg, path, { method = 'GET', body, mgmtKey } = {}) {
  const key = mgmtKey || cfg.mgmtKey;
  if (!key) {
    throw new Error('No account management key. Run: scalattice setup');
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = `${cfg.cloudUrl}${suffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-Scalattice-Client': 'cli',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Inference API via developer key (`slt_…`) against api.* /v1. */
export async function apiFetch(cfg, path, { method = 'GET', body, apiKey } = {}) {
  const base = cfg.apiUrl.replace(/\/+$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const key = apiKey || cfg.apiKey;
  if (!key) throw new Error('No API key. Run: scalattice setup');

  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
