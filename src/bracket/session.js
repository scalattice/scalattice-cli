import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from '../config.js';

const POINTER = 'last.json';

export function sessionStoreDir() {
  return path.join(dataDir(), 'bracket-sessions');
}

function ensureDir() {
  const dir = sessionStoreDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function safeId(id) {
  return String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}

function sessionFile(id) {
  const safe = safeId(id);
  if (!safe || safe === 'last') throw new Error('Invalid chat id.');
  return path.join(sessionStoreDir(), `${safe}.json`);
}

function writeJson(file, body) {
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

function readJson(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed && typeof parsed === 'object' ? parsed : null;
}

export function newChatId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function contentText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((part) => part?.text || part?.content || '').join('');
  }
  return msg.content == null ? '' : String(msg.content);
}

export function titleFromMessages(messages) {
  const user = (messages || []).find((m) => m?.role === 'user');
  const line = contentText(user).split('\n')[0].trim().replace(/\s+/g, ' ');
  if (!line) return 'New chat';
  return line.length > 48 ? `${line.slice(0, 45)}...` : line;
}

function sameCwd(a, b) {
  if (!a || !b) return false;
  try {
    return path.resolve(a) === path.resolve(b);
  } catch {
    return a === b;
  }
}

function pointerPath() {
  return path.join(sessionStoreDir(), POINTER);
}

function writePointer(id) {
  writeJson(pointerPath(), { currentId: id });
}

function readPointer() {
  try {
    return readJson(pointerPath());
  } catch {
    return null;
  }
}

export function loadSession(id) {
  try {
    const rec = readJson(sessionFile(id));
    if (!rec) return null;
    if (!rec.id) rec.id = safeId(id);
    return rec;
  } catch {
    return null;
  }
}

function migrateLegacyLast() {
  const raw = readPointer();
  if (!raw) return null;
  if (raw.currentId) return loadSession(raw.currentId);
  if (!Array.isArray(raw.messages)) return null;
  const id = raw.id && raw.id !== 'last' ? raw.id : newChatId();
  const body = saveSession({ ...raw, id });
  return body;
}

export function saveSession(record = {}) {
  const dir = ensureDir();
  const id = safeId(record.id);
  const finalId = !id || id === 'last' ? newChatId() : id;
  const prev = loadSession(finalId);
  const messages = Array.isArray(record.messages) ? record.messages : prev?.messages || [];
  let title = String(record.title || '').trim();
  if (!title) {
    const prevTitle = prev?.title || '';
    title = !prevTitle || prevTitle === 'New chat' ? titleFromMessages(messages) : prevTitle;
  }
  const body = {
    id: finalId,
    title,
    cwd: record.cwd || prev?.cwd || '',
    model: record.model || prev?.model || '',
    messages,
    createdAt: record.createdAt || prev?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJson(path.join(dir, `${finalId}.json`), body);
  writePointer(finalId);
  return body;
}

export function loadLastSession(cwd) {
  try {
    const rec = migrateLegacyLast();
    if (!rec) return null;
    if (cwd && rec.cwd && !sameCwd(rec.cwd, cwd)) {
      const latest = listSessions({ cwd, limit: 1 })[0];
      return latest ? loadSession(latest.id) : rec;
    }
    return rec;
  } catch {
    return null;
  }
}

export function summarizeSession(rec) {
  const messages = rec?.messages || [];
  return {
    id: rec.id,
    title: rec.title || titleFromMessages(messages),
    cwd: rec.cwd || '',
    model: rec.model || '',
    updatedAt: rec.updatedAt || rec.createdAt || '',
    createdAt: rec.createdAt || '',
    turns: messages.filter((m) => m?.role === 'user').length,
  };
}

export function listSessions({ cwd, limit = 40, all = false } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(sessionStoreDir()).filter((name) => name.endsWith('.json') && name !== POINTER);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    try {
      const rec = readJson(path.join(sessionStoreDir(), name));
      if (!rec || !Array.isArray(rec.messages)) continue;
      if (!rec.id) rec.id = name.replace(/\.json$/, '');
      rows.push(summarizeSession(rec));
    } catch {
      /* skip bad files */
    }
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const scoped = !all && cwd ? rows.filter((row) => sameCwd(row.cwd, cwd)) : rows;
  const list = scoped.length || all || !cwd ? scoped : rows;
  return list.slice(0, Math.max(1, Number(limit) || 40));
}

export function resolveSessionRef(query, { cwd } = {}) {
  const q = String(query || '').trim();
  if (!q) return { error: 'Name a chat. /chats lists them; /chat 2 opens number 2.' };
  const local = listSessions({ cwd, limit: 80 });
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    if (n >= 1 && n <= local.length) return { session: loadSession(local[n - 1].id) };
    return { error: `No chat ${q} in this list. /chats` };
  }
  const all = listSessions({ all: true, limit: 120 });
  const exact = all.find((row) => row.id === q);
  if (exact) return { session: loadSession(exact.id) };
  const prefixed = all.filter((row) => row.id.startsWith(q));
  if (prefixed.length === 1) return { session: loadSession(prefixed[0].id) };
  if (prefixed.length > 1) {
    return { error: `Several chats start with ${q}. Use a fuller id.`, matches: prefixed };
  }
  const needle = q.toLowerCase();
  const titled = all.filter((row) => String(row.title).toLowerCase().includes(needle));
  if (titled.length === 1) return { session: loadSession(titled[0].id) };
  if (titled.length > 1) {
    return { error: `Several chats match ${q}. Use /chats and /chat N.`, matches: titled };
  }
  return { error: `No chat matches ${q}. /chats` };
}

export function deleteSession(id) {
  const rec = loadSession(id);
  if (!rec) return false;
  try {
    fs.unlinkSync(sessionFile(id));
  } catch {
    return false;
  }
  const pointer = readPointer();
  if (pointer?.currentId === rec.id) {
    const next = listSessions({ all: true, limit: 1 })[0];
    if (next) writePointer(next.id);
    else {
      try {
        fs.unlinkSync(pointerPath());
      } catch {
        /* none */
      }
    }
  }
  return true;
}

function shortCwd(cwd) {
  const home = os.homedir();
  if (home && cwd && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd || '';
}

function when(iso) {
  const s = String(iso || '');
  if (s.length >= 16) return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
  return s || '';
}

export function formatSessionList(rows, currentId, { showCwd = false } = {}) {
  if (!rows?.length) return 'No saved chats yet.';
  return rows
    .map((row, i) => {
      const mark = row.id === currentId ? '*' : ' ';
      const n = String(i + 1).padStart(2, ' ');
      const id = String(row.id).slice(0, 10).padEnd(10, ' ');
      const title = row.title || 'New chat';
      const extra = showCwd ? `  ${shortCwd(row.cwd)}` : '';
      return `${mark}${n}  ${id}  ${title}  ${when(row.updatedAt)}${extra}`;
    })
    .join('\n');
}
