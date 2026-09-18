import fs from 'node:fs';
import path from 'node:path';

export const IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.venv',
  '.yarn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  '__pycache__',
  'vendor',
]);

export function resolveWorkspacePath(cwd, rel = '.', { allowOutside = false } = {}) {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, String(rel || '.'));
  const relToRoot = path.relative(root, abs);
  const outside = relToRoot.startsWith('..') || path.isAbsolute(relToRoot);
  if (outside && !allowOutside) {
    throw new Error(`Path escapes workspace (${root}): ${rel}`);
  }
  return { abs, root, outside, rel: outside ? abs : relToRoot || '.' };
}

export function isIgnoredDir(name) {
  return IGNORE_DIRS.has(name);
}

/** Very small glob: `*` and `**` and `?`. Case-sensitive. */
export function globToRegExp(pattern) {
  const src = String(pattern || '').replace(/\\/g, '/');
  let re = '^';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '*' && src[i + 1] === '*') {
      const next = src[i + 2];
      if (next === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if ('\\^$+{}()|[]'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  re += '$';
  return new RegExp(re);
}

export function walkFiles(root, { maxFiles = 5000, includeDirs = false } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === '.' || ent.name === '..') continue;
      if (ent.isDirectory() && isIgnoredDir(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (includeDirs) out.push(abs);
        stack.push(abs);
      } else if (ent.isFile()) {
        out.push(abs);
      }
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

export function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}
