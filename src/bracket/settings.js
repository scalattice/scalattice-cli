const REGIONS = new Set(['auto', 'us', 'eu', 'ap']);
const SECURITIES = new Set(['tier1', 'tier2.5']);

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

function falsey(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no';
}

function regionOf(raw, fallback = 'auto') {
  const v = String(raw || fallback).trim().toLowerCase();
  return REGIONS.has(v) ? v : fallback;
}

function securityOf(raw, fallback = 'tier1') {
  let v = String(raw || fallback).trim().toLowerCase();
  if (v === 'tier25' || v === '2.5' || v === 'tier2') v = 'tier2.5';
  if (v === 'tier-1' || v === '1') v = 'tier1';
  return SECURITIES.has(v) ? v : fallback;
}

function vetOf(raw, fallback = 1) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3, Math.max(1, Math.floor(n)));
}

export function defaultSettings(flags = {}, env = process.env) {
  let stream = true;
  if (falsey(env.SCALATTICE_STREAM)) stream = false;
  if (truthy(env.SCALATTICE_STREAM)) stream = true;
  if (flags.stream === true) stream = true;
  if (flags.noStream) stream = false;

  let thinking = true;
  if (falsey(env.SCALATTICE_THINKING)) thinking = false;
  if (truthy(env.SCALATTICE_THINKING)) thinking = true;
  if (flags.think === true) thinking = true;
  if (flags.noThink) thinking = false;

  const region = regionOf(flags.region || env.SCALATTICE_REGION, 'auto');
  const vet = vetOf(flags.vet ?? env.SCALATTICE_VET_REPLICAS, 1);
  const security = securityOf(flags.security || env.SCALATTICE_SECURITY, 'tier1');

  const seed = { stream, thinking, region, vet, security };
  const patch = { thinking, region };
  if (flags.noStream || falsey(env.SCALATTICE_STREAM)) patch.stream = false;
  if (flags.stream === true || truthy(env.SCALATTICE_STREAM)) patch.stream = true;
  if (flags.noStream) patch.stream = false;
  if (flags.vet != null || env.SCALATTICE_VET_REPLICAS) patch.vet = vet;
  if (flags.security || env.SCALATTICE_SECURITY) patch.security = security;
  return patchSettings(seed, patch);
}

export function patchSettings(current, patch) {
  const next = { ...current, ...patch };
  if (Number(patch.vet) > 1 || (patch.security && securityOf(patch.security, 'tier1') !== 'tier1')) {
    next.stream = false;
  }
  if (patch.stream === true) {
    next.stream = true;
    next.vet = 1;
    next.security = 'tier1';
  }
  if (next.stream) {
    next.vet = 1;
    next.security = 'tier1';
  }
  next.region = regionOf(next.region, 'auto');
  next.vet = vetOf(next.vet, 1);
  next.security = securityOf(next.security, 'tier1');
  next.stream = next.stream !== false;
  next.thinking = next.thinking !== false;
  return next;
}

export function routingHeaders(settings) {
  const s = settings || {};
  const stream = s.stream !== false;
  return {
    'X-Scalattice-Region': regionOf(s.region, 'auto'),
    'X-Scalattice-Vet-Replicas': String(stream ? 1 : vetOf(s.vet, 1)),
    'X-Scalattice-Security': stream ? 'tier1' : securityOf(s.security, 'tier1'),
  };
}

export function settingsLine(settings) {
  const s = settings || {};
  const stream = s.stream !== false;
  return [
    `stream ${stream ? 'on' : 'off'}`,
    `think ${s.thinking === false ? 'off' : 'on'}`,
    `region ${regionOf(s.region, 'auto')}`,
    `vet ${stream ? 1 : vetOf(s.vet, 1)}`,
    `security ${stream ? 'tier1' : securityOf(s.security, 'tier1')}`,
  ].join(' · ');
}

export function parseBoolArg(arg, current) {
  const v = String(arg || '').trim().toLowerCase();
  if (!v) return !current;
  if (['on', 'true', '1', 'yes'].includes(v)) return true;
  if (['off', 'false', '0', 'no'].includes(v)) return false;
  throw new Error('Use on or off');
}
