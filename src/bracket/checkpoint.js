import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../config.js';

function clip(s, n = 120) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** First changed region as a unified hunk. */
export function unifiedHunk(rel, before, after, { radius = 6, maxLines = 80 } = {}) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  let ae = a.length - 1;
  let be = b.length - 1;
  while (ae >= i && be >= i && a[ae] === b[be]) {
    ae -= 1;
    be -= 1;
  }
  const startA = Math.max(0, i - radius);
  const startB = Math.max(0, i - radius);
  const old = a.slice(startA, ae + 1 + radius);
  const next = b.slice(startB, be + 1 + radius);
  const lines = [`--- a/${rel}`, `+++ b/${rel}`, `@@ -${startA + 1},${old.length} +${startB + 1},${next.length} @@`];
  for (const line of old.slice(0, maxLines)) lines.push(`-${line}`);
  for (const line of next.slice(0, maxLines)) lines.push(`+${line}`);
  if (old.length > maxLines || next.length > maxLines) lines.push('…');
  return lines.join('\n');
}

export function createCheckpointStore({ cwd, chatId } = {}) {
  const root = path.resolve(cwd || '.');
  const id = String(chatId || 'anon')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  const dir = path.join(dataDir(), 'bracket-checkpoints', id);
  const stack = [];

  function snapshotFile(rel, abs) {
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { rel, existed: false, content: '' };
      return { rel, existed: true, content: fs.readFileSync(abs, 'utf8') };
    } catch {
      return { rel, existed: false, content: '' };
    }
  }

  return {
    dir,
    list() {
      return stack.slice().reverse();
    },
    snapshot(files) {
      const entries = (files || []).filter(Boolean);
      if (!entries.length) return null;
      const rec = {
        id: `cp${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        files: entries.map((f) => snapshotFile(f.rel, f.abs)),
      };
      stack.push(rec);
      if (stack.length > 30) stack.shift();
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, `${rec.id}.json`), `${JSON.stringify(rec)}\n`, { mode: 0o600 });
      } catch {
        /* disk optional */
      }
      return rec;
    },
    rewind() {
      const rec = stack.pop();
      if (!rec) return { ok: false, error: 'No checkpoint to rewind.' };
      const restored = [];
      for (const file of rec.files || []) {
        const abs = path.resolve(root, file.rel);
        try {
          if (!file.existed) {
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
            restored.push(`removed ${file.rel}`);
            continue;
          }
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, file.content, 'utf8');
          restored.push(`restored ${file.rel}`);
        } catch (err) {
          restored.push(`failed ${file.rel}: ${err.message}`);
        }
      }
      return { ok: true, id: rec.id, restored };
    },
    describe() {
      if (!stack.length) return 'No checkpoints in this chat.';
      return stack
        .slice()
        .reverse()
        .map((r, i) => `${i === 0 ? 'latest' : String(stack.length - i)}. ${r.id}  ${clip(r.files.map((f) => f.rel).join(', '))}`)
        .join('\n');
    },
  };
}
