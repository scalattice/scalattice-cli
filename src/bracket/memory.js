import fs from 'node:fs';
import path from 'node:path';

const NAMES = ['AGENTS.md', 'CLAUDE.md', 'BRACKET.md', path.join('.scalattice', 'instructions.md')];
const MAX_CHARS = 6000;

function readIfFile(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 400_000) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Walk cwd → parents for AGENTS.md / CLAUDE.md / BRACKET.md. First hit per name wins. */
export function loadProjectMemory(cwd, { maxChars = MAX_CHARS } = {}) {
  const root = path.resolve(cwd || '.');
  const found = [];
  const seen = new Set();
  let dir = root;
  for (let hop = 0; hop < 8; hop += 1) {
    for (const name of NAMES) {
      if (seen.has(name)) continue;
      const abs = path.join(dir, name);
      const text = readIfFile(abs);
      if (!text || !String(text).trim()) continue;
      seen.add(name);
      found.push({
        name: path.basename(name),
        rel: path.relative(root, abs).replaceAll('\\', '/') || name,
        text: String(text).trim(),
      });
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  let used = 0;
  const parts = [];
  for (const file of found) {
    const room = Math.max(0, maxChars - used);
    if (room < 80) break;
    const body = file.text.length > room ? `${file.text.slice(0, room)}\n…` : file.text;
    parts.push(`# ${file.rel}\n${body}`);
    used += body.length + file.rel.length + 8;
  }
  return {
    files: found.map((f) => f.rel),
    text: parts.join('\n\n').trim(),
  };
}
