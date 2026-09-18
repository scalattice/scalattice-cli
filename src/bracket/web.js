import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 512 * 1024;
const MAX_CHARS = 8_000;
const FETCH_MS = 20_000;
const MAX_REDIRECTS = 5;
const UA = 'ScalatticeBracket/0.3 (https://scalattice.com/cli)';

const PRIVATE_V4 = [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
];

function ip4ToInt(ip) {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

export function isPrivateIp(ip) {
  const v = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (!v) return true;
  if (v.includes(':')) {
    const low = v.toLowerCase();
    return (
      low === '::1' ||
      low === '::' ||
      low.startsWith('fc') ||
      low.startsWith('fd') ||
      low.startsWith('fe80') ||
      low.startsWith('::ffff:127.') ||
      low.startsWith('::ffff:10.') ||
      low.startsWith('::ffff:192.168.') ||
      /^::ffff:169\.254\./.test(low) ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(low)
    );
  }
  if (!net.isIPv4(v)) return true;
  const n = ip4ToInt(v);
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ip4ToInt(base) & mask);
  });
}

export function assertHttpUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new Error('Need a full http(s) URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  if (u.username || u.password) throw new Error('URL credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new Error('URL host is required');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error(`Blocked host: ${host}`);
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error(`Blocked address: ${host}`);
  return u;
}

export async function assertPublicHttpUrl(raw) {
  const u = assertHttpUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return u;
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve ${host}: ${err?.message || err}`);
  }
  for (const row of addrs) {
    if (isPrivateIp(row.address)) throw new Error(`Blocked private host: ${host}`);
  }
  if (!addrs.length) throw new Error(`Could not resolve ${host}`);
  return u;
}

export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

export function parseDuckDuckGoHtml(html) {
  const src = String(html || '');
  const results = [];
  const seen = new Set();
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(src))) {
    const href = decodeDdgHref(m[1]);
    const title = htmlToText(m[2]);
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    results.push({ title, url: href });
    if (results.length >= 8) break;
  }
  if (results.length) return results;
  const lite = /<a[^>]*rel="nofollow"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = lite.exec(src))) {
    const href = m[1];
    const title = htmlToText(m[2]);
    if (!href || !title || seen.has(href) || /duckduckgo\.com/i.test(href)) continue;
    seen.add(href);
    results.push({ title, url: href });
    if (results.length >= 8) break;
  }
  return results;
}

function decodeDdgHref(href) {
  try {
    const u = new URL(href, 'https://html.duckduckgo.com/');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* ignore */
  }
  return '';
}

function clip(text, max = MAX_CHARS) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… truncated (${s.length} chars)`;
}

async function readLimited(res, max = MAX_BYTES) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) return buf.subarray(0, max).toString('utf8');
  return buf.toString('utf8');
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  if (typeof t.unref === 'function') t.unref();
  return ac.signal;
}

async function fetchFollow(url, { fetchImpl, method = 'GET', body, headers, skipPublicDns = false } = {}) {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    if (skipPublicDns) assertHttpUrl(current);
    else await assertPublicHttpUrl(current);
    const res = await fetchImpl(current, {
      method,
      body,
      headers,
      redirect: 'manual',
      signal: timeoutSignal(FETCH_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect with no Location (${res.status})`);
      current = new URL(loc, current).href;
      method = 'GET';
      body = undefined;
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

export async function webFetchTool(args = {}, { fetchImpl = globalThis.fetch, skipPublicDns = false } = {}) {
  const raw = String(args.url || args.uri || '').trim();
  if (!raw) throw new Error('url is required');
  const { res, finalUrl } = await fetchFollow(raw, {
    fetchImpl,
    skipPublicDns,
    headers: { Accept: 'text/html, text/plain, application/json, */*', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${finalUrl}`);
  const ctype = String(res.headers.get('content-type') || '');
  const body = await readLimited(res);
  const text = /html/i.test(ctype) || /<html/i.test(body.slice(0, 400)) ? htmlToText(body) : body;
  return clip(`URL: ${finalUrl}\n\n${text || '(empty)'}`);
}

export async function webSearchTool(args = {}, { fetchImpl = globalThis.fetch, skipPublicDns = false } = {}) {
  const query = String(args.query || args.q || '').trim();
  if (!query) throw new Error('query is required');
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { res, finalUrl } = await fetchFollow(target, {
    fetchImpl,
    skipPublicDns,
    headers: {
      Accept: 'text/html',
      'User-Agent': UA,
    },
  });
  if (!res.ok) throw new Error(`Search HTTP ${res.status} for ${finalUrl}`);
  const html = await readLimited(res);
  const hits = parseDuckDuckGoHtml(html);
  if (!hits.length) {
    return clip(`No search results for ${JSON.stringify(query)}. Try web_fetch on a known URL.`);
  }
  return clip(
    hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}`).join('\n')
  );
}
