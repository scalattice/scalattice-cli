import fs from 'node:fs';
import path from 'node:path';
import { looksBinary, resolveWorkspacePath } from './paths.js';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MAX_BYTES = 4 * 1024 * 1024;

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function extractCandidates(text) {
  const out = [];
  const src = String(text || '');
  for (const m of src.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) out.push(m[1]);
  for (const m of src.matchAll(/(?:^|\s)((?:\.\.?\/)?[^\s]+?\.(?:png|jpe?g|gif|webp|bmp))/gi)) {
    out.push(m[1]);
  }
  return [...new Set(out.map((s) => String(s).trim().replace(/^<|>$/g, '')))];
}

export function collectImagePaths(text, cwd) {
  const hits = [];
  for (const rel of extractCandidates(text)) {
    if (!IMAGE_RE.test(rel)) continue;
    let abs;
    try {
      abs = resolveWorkspacePath(cwd, rel).abs;
    } catch {
      continue;
    }
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      const buf = fs.readFileSync(abs);
      if (!looksBinary(buf) && st.size > 32) continue;
      hits.push({ rel: path.relative(path.resolve(cwd), abs).replaceAll('\\', '/'), abs, mime: mimeOf(abs) });
    } catch {
      /* skip */
    }
  }
  return hits;
}

export function userContentWithImages(text, cwd) {
  const images = collectImagePaths(text, cwd);
  if (!images.length) return String(text || '');
  const parts = [{ type: 'text', text: String(text || '') }];
  for (const img of images) {
    const b64 = fs.readFileSync(img.abs).toString('base64');
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${b64}` },
    });
  }
  return parts;
}

export function looksLikeVisionModel(id) {
  const s = String(id || '').toLowerCase();
  return s.includes('vl') || s.includes('vision') || s.includes('image');
}
