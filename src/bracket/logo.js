import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGO_URL = 'https://scalattice.com/resources/logos/scalattice/logo-light-noword.svg';
const LOGO_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'media',
  'logo-light-noword.svg'
);

const CYAN = '\x1b[38;2;34;211;238m';
const RESET = '\x1b[0m';

function parsePath(d) {
  const tokens = String(d).match(/[MmCcSsLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const subpaths = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let current = [];

  const num = () => Number(tokens[i++]);

  const startSub = () => {
    if (current.length) subpaths.push(current);
    current = [];
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      i += 1;
    }
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === 'Z') {
      current.push({ x1: cx, y1: cy, x2: sx, y2: sy });
      cx = sx;
      cy = sy;
      continue;
    }
    if (c === 'M') {
      startSub();
      const x = rel ? cx + num() : num();
      const y = rel ? cy + num() : num();
      cx = sx = x;
      cy = sy = y;
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (c === 'L') {
      const x = rel ? cx + num() : num();
      const y = rel ? cy + num() : num();
      current.push({ x1: cx, y1: cy, x2: x, y2: y });
      cx = x;
      cy = y;
      continue;
    }
    if (c === 'H') {
      const x = rel ? cx + num() : num();
      current.push({ x1: cx, y1: cy, x2: x, y2: cy });
      cx = x;
      continue;
    }
    if (c === 'V') {
      const y = rel ? cy + num() : num();
      current.push({ x1: cx, y1: cy, x2: cx, y2: y });
      cy = y;
      continue;
    }
    if (c === 'C') {
      const x1 = rel ? cx + num() : num();
      const y1 = rel ? cy + num() : num();
      const x2 = rel ? cx + num() : num();
      const y2 = rel ? cy + num() : num();
      const x = rel ? cx + num() : num();
      const y = rel ? cy + num() : num();
      flattenCubic(current, cx, cy, x1, y1, x2, y2, x, y);
      cx = x;
      cy = y;
      continue;
    }
    i += 1;
  }
  startSub();
  return subpaths.flat();
}

function flattenCubic(edges, x0, y0, x1, y1, x2, y2, x3, y3, steps = 14) {
  let px = x0;
  let py = y0;
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const u = 1 - t;
    const x =
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const y =
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    edges.push({ x1: px, y1: py, x2: x, y2: y });
    px = x;
    py = y;
  }
}

function bounds(edges) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.x1, e.x2);
    minY = Math.min(minY, e.y1, e.y2);
    maxX = Math.max(maxX, e.x1, e.x2);
    maxY = Math.max(maxY, e.y1, e.y2);
  }
  return { minX, minY, maxX, maxY };
}

function rasterize(edges, width, height) {
  const b = bounds(edges);
  const pad = 0.08;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  const extra = span * pad;
  const originX = (b.minX + b.maxX) / 2 - span / 2 - extra;
  const originY = (b.minY + b.maxY) / 2 - span / 2 - extra;
  const scale = (span + extra * 2) / Math.max(width, height);
  const grid = Array.from({ length: height }, () => Array(width).fill(false));

  for (let y = 0; y < height; y += 1) {
    const gy = originY + (y + 0.5) * scale;
    const xs = [];
    for (const e of edges) {
      const y1 = e.y1;
      const y2 = e.y2;
      if ((y1 > gy && y2 > gy) || (y1 < gy && y2 < gy) || y1 === y2) continue;
      const t = (gy - y1) / (y2 - y1);
      xs.push(e.x1 + t * (e.x2 - e.x1));
    }
    xs.sort((a, c) => a - c);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.floor((xs[i] - originX) / scale);
      const x1 = Math.floor((xs[i + 1] - originX) / scale);
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) {
        grid[y][x] = true;
      }
    }
  }
  return grid;
}

function brailleFromGrid(grid) {
  const h = grid.length;
  const w = grid[0]?.length || 0;
  const rows = Math.ceil(h / 4);
  const cols = Math.ceil(w / 2);
  const bits = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
  ];
  const lines = [];
  for (let r = 0; r < rows; r += 1) {
    let line = '';
    for (let c = 0; c < cols; c += 1) {
      let mask = 0;
      for (let dy = 0; dy < 4; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const y = r * 4 + dy;
          const x = c * 2 + dx;
          if (y < h && x < w && grid[y][x]) mask |= bits[dy][dx];
        }
      }
      line += String.fromCodePoint(0x2800 + mask);
    }
    lines.push(line);
  }
  return lines;
}

function pathFromSvg(svg) {
  const m = String(svg).match(/<path[^>]*\sd="([^"]+)"/i);
  return m ? m[1] : '';
}

export function loadLogoSvg() {
  try {
    return fs.readFileSync(LOGO_FILE, 'utf8');
  } catch {
    return '';
  }
}

export function logoBraille({ width = 8, height = 8, color = true } = {}) {
  const svg = loadLogoSvg();
  const d = pathFromSvg(svg);
  if (!d) return [];
  const edges = parsePath(d);
  if (!edges.length) return [];
  const lines = brailleFromGrid(rasterize(edges, width, height));
  if (!color) return lines;
  return lines.map((line) => `${CYAN}${line}${RESET}`);
}

export function logoCellWidth(lines) {
  return String(lines[0] || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .length;
}

export { LOGO_FILE, LOGO_URL };
