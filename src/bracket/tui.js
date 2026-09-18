import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import { logoBraille, logoCellWidth } from './logo.js';
import { markdownToAnsi, stripAnsi as stripMd } from './markdown.js';
import { contentText } from './session.js';
import { toolSummary } from './tools.js';
import {
  ACCENT,
  BOLD,
  DIM,
  ITALIC,
  MUTED,
  RED,
  RESET,
  TEXT,
  THINK,
  THINK_DIM,
} from './theme.js';
const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const SHOW = '\x1b[?25h';
const HIDE = '\x1b[?25l';
const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const THINK_GUTTER = '  ┊ ';
const INPUT_BLOCK = 4;
const MAX_RECORDS = 4000;
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l\x1b[?1002l\x1b[?1003l';

const tty = () => Boolean(input.isTTY && output.isTTY);

export function formatElapsed(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

/** Enter often arrives as \\r\\n, or as the typed line plus newline in one chunk. */
export function splitLineSubmit(chunk) {
  const s = String(chunk || '');
  const m = /^(.*?)(\r\n|\r|\n|\x1bOM)/.exec(s);
  if (!m) return null;
  return { line: m[1], rest: s.slice(m[0].length) };
}

function paint(code, s) {
  return tty() ? `${code}${s}${RESET}` : s;
}

function pkgVersion() {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')).version || '';
  } catch {
    return '';
  }
}

const SIDE_MIN_COLS = 100;
const SIDE_W = 28;

function termWidth() {
  const cols = Number(output.columns) || 80;
  return Math.max(40, cols > 1 ? cols - 1 : cols);
}

function rows() {
  return Math.max(12, output.rows || 24);
}

export function layoutFrame({ columns, chats } = {}) {
  const cols = Math.max(40, Number(columns) || 80);
  const showSide = Array.isArray(chats) && cols >= SIDE_MIN_COLS;
  const sideW = showSide ? SIDE_W : 0;
  return { cols, showSide, sideW, mainW: showSide ? cols - sideW : cols };
}

function strip(s) {
  return stripMd(s);
}

function visLen(s) {
  return strip(s).length;
}

function fit(text, w) {
  const max = Math.max(0, Number(w) || 0);
  let out = String(text || '');
  if (visLen(out) > max) {
    out = paint(MUTED, `${strip(out).slice(0, Math.max(0, max - 1))}…`);
  }
  return `${out}${' '.repeat(Math.max(0, max - visLen(out)))}`;
}

function hline(w, left, mid, right) {
  return `${left}${mid.repeat(Math.max(0, w - 2))}${right}`;
}

function row(w, inner) {
  return `│ ${fit(inner, Math.max(0, w - 4))} │`;
}

function identityLines(meta = {}) {
  const ver = meta.version ? ` v${meta.version}` : '';
  const mode = meta.yolo ? 'yolo' : 'approvals on';
  const markRaw = logoBraille({ width: 12, height: 12, color: tty() });
  const mark = markRaw.length ? markRaw : [paint(ACCENT, `${BOLD}[ ]`)];
  const markW = logoCellWidth(mark) || 3;
  const gap = '  ';
  const indent = `${' '.repeat(markW)}${gap}`;
  const rest = [
    `${paint(TEXT, `${BOLD}Scalattice Bracket`)}${paint(MUTED, ver)}`,
    paint(MUTED, meta.cwd || process.cwd()),
    paint(MUTED, `${meta.model || ''} · ${mode}`),
  ];
  if (meta.chat) rest.push(paint(MUTED, meta.chat));
  if (meta.policy) rest.push(paint(MUTED, meta.policy));
  if (meta.email) rest.push(paint(MUTED, meta.email));
  for (const line of meta.credits || []) {
    if (line) rest.push(paint(MUTED, line));
  }
  const n = Math.max(mark.length, rest.length);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const text = rest[i] || '';
    out.push(i < mark.length ? `${mark[i]}${gap}${text}` : `${indent}${text}`);
  }
  return out;
}

export function chatPanelItems(meta = {}) {
  const chats = Array.isArray(meta.chats) ? meta.chats : [];
  const items = [];
  const currentId = meta.currentId;
  if (currentId && !chats.some((c) => c.id === currentId)) {
    items.push({ n: 0, id: currentId, title: meta.chat || 'New chat', current: true });
  }
  for (let i = 0; i < chats.length; i += 1) {
    const c = chats[i];
    items.push({
      n: i + 1,
      id: c.id,
      title: c.title || 'New chat',
      current: Boolean(currentId) && c.id === currentId,
    });
  }
  return items;
}

function chatRowLabel(item) {
  const mark = item.current ? paint(ACCENT, '▸') : paint(MUTED, ' ');
  const n = item.n ? paint(item.current ? ACCENT : MUTED, String(item.n).padStart(2, ' ')) : paint(MUTED, '  ');
  const title = paint(item.current ? TEXT : MUTED, item.title || 'New chat');
  return `${mark}${n} ${title}`;
}

function boxLines(w, inners) {
  return [hline(w, '╭', '─', '╮'), ...inners.map((line) => row(w, line)), hline(w, '╰', '─', '╯')];
}

export function chatSidebarView(meta = {}, height = 12, offset = 0) {
  const items = chatPanelItems(meta);
  const inner = Math.max(1, Number(height) - 2);
  const listSlots = Math.max(0, inner - 1);
  const maxOff = Math.max(0, items.length - listSlots);
  const off = Math.min(Math.max(0, Number(offset) || 0), maxOff);
  return {
    items,
    shown: items.slice(off, off + listSlots),
    offset: off,
    maxOff,
    listSlots,
  };
}

export function renderChatPanel(meta = {}, { height, offset = 0, width } = {}) {
  const h = Math.max(3, Number(height) || 12);
  const w = Math.max(12, Number(width) || SIDE_W);
  const view = chatSidebarView(meta, h, offset);
  const innerH = Math.max(1, h - 2);
  const more = view.offset > 0 || view.offset < view.maxOff;
  const titleBits = [paint(TEXT, `${BOLD}Chats`)];
  if (view.offset > 0) titleBits.unshift(paint(MUTED, '↑'));
  if (view.maxOff > 0 && view.offset < view.maxOff) titleBits.push(paint(MUTED, '↓'));
  const inner = [titleBits.join(' ')];
  for (const item of view.shown) inner.push(chatRowLabel(item));
  if (!view.shown.length) inner.push(paint(MUTED, 'No saved chats'));
  if (more && inner.length < innerH) {
    inner.push(paint(MUTED, `${view.offset + 1}-${view.offset + view.shown.length}/${view.items.length}`));
  }
  while (inner.length < innerH) inner.push('');
  return boxLines(w, inner.slice(0, innerH));
}

export function renderBanner(meta = {}) {
  const version = meta.version === undefined ? pkgVersion() : meta.version;
  const body = { ...meta, version };
  const lay = layoutFrame({ columns: meta.columns || termWidth(), chats: meta.chats });
  return boxLines(lay.mainW, identityLines(body)).join('\n');
}

export function renderIntro(meta = {}) {
  const banner = renderBanner(meta);
  const lay = layoutFrame({ columns: meta.columns || termWidth(), chats: meta.chats });
  const hint = lay.showSide
    ? 'Ask about this workspace.  /help [command]   /settings   /exit   PgUp   wheel chats'
    : 'Ask about this workspace.  /help [command]   /chats   /settings   /exit   PgUp';
  return `${banner}\n\n  ${paint(MUTED, hint)}`;
}

export function wrapLine(text, maxW) {
  const max = Math.max(1, Number(maxW) || 80);
  const s = String(text || '');
  const lines = [];
  let vis = 0;
  let buf = '';
  let sgr = '';
  let i = 0;
  const emit = () => {
    lines.push(buf);
    buf = sgr;
    vis = 0;
  };
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const rest = s.slice(i);
      const m = rest.match(/^\x1b\[[0-9;]*m/) || rest.match(/^\x1b\[[0-9;]*[A-Za-z]/);
      const seq = m ? m[0] : rest.slice(0, 2);
      buf += seq;
      if (seq.endsWith('m')) {
        sgr = seq === '\x1b[0m' ? '' : `${sgr}${seq}`;
      }
      i += seq.length;
      continue;
    }
    if (s[i] === '\n') {
      emit();
      i += 1;
      continue;
    }
    if (vis >= max) emit();
    buf += s[i];
    vis += 1;
    i += 1;
  }
  lines.push(buf);
  return lines;
}

export function historyWindow(lines, height, offset) {
  const h = Math.max(1, Number(height) || 1);
  const all = Array.isArray(lines) ? lines : [];
  const maxOff = Math.max(0, all.length - h);
  const off = Math.min(Math.max(0, Number(offset) || 0), maxOff);
  const start = Math.max(0, all.length - h - off);
  const slice = all.slice(start, start + h);
  while (slice.length < h) slice.push('');
  return { slice, offset: off, maxOff };
}

export function introRowCount(meta = {}) {
  return renderIntro(meta).split('\n').length;
}

/** Stream thinking into italic guttered lines. `state` is mutated across chunks. */
export function thinkDeltaToAnsi(text, state = {}, opts = {}) {
  const limit = Math.max(16, (opts.width || termWidth()) - THINK_GUTTER.length - 2);
  const next = {
    open: Boolean(state.open),
    col: Number(state.col) || 0,
    lineStart: state.lineStart !== false,
  };
  let out = '';
  const body = (s) => paint(`${ITALIC}${DIM}${THINK}`, s);
  const gut = () => paint(`${DIM}${THINK_DIM}`, THINK_GUTTER);

  if (!next.open) {
    out += `\n${paint(`${ITALIC}${DIM}${THINK_DIM}`, `${THINK_GUTTER}think`)}\n`;
    next.open = true;
    next.lineStart = true;
    next.col = 0;
  }

  let run = '';
  const flush = () => {
    if (!run) return;
    if (next.lineStart) {
      out += gut();
      next.lineStart = false;
    }
    out += body(run);
    run = '';
  };

  for (const ch of String(text || '')) {
    if (ch === '\r') continue;
    if (ch === '\n') {
      flush();
      out += '\n';
      next.lineStart = true;
      next.col = 0;
      continue;
    }
    if (next.col >= limit) {
      flush();
      out += '\n';
      next.lineStart = true;
      next.col = 0;
    }
    run += ch;
    next.col += 1;
  }
  flush();
  return { text: out, state: next };
}

function renderInputLines(w, value, { busy = false } = {}) {
  const innerW = w - 6;
  const shown = String(value || '').slice(-innerW);
  const caret = tty() && !busy ? paint(ACCENT, '█') : '';
  const pad = Math.max(0, innerW - shown.length - (tty() && !busy ? 1 : 0));
  const prompt = paint(busy ? MUTED : ACCENT, '>');
  return [
    hline(w, '╭', '─', '╮'),
    `│ ${prompt} ${shown}${caret}${' '.repeat(pad)} │`,
    hline(w, '╰', '─', '╯'),
  ];
}

export function createTui(opts = {}) {
  const complete = typeof opts.complete === 'function' ? opts.complete : null;
  let raw = false;
  let pasting = false;
  let lineBuf = '';
  let waiter = null;
  let thinkOpen = false;
  let wrotePrefix = false;
  let thinkState = { open: false, col: 0, lineStart: true };
  let bannerMeta = null;
  let scrollTop = 2;
  let alive = false;
  let busySince = 0;
  let cancelWork = null;
  let tick = null;
  let records = [];
  let partial = '';
  let viewOffset = 0;
  let paintSoon = null;
  let tabCycle = null;
  let tabHint = '';
  let chatHits = [];
  let chatOffset = 0;

  function frame() {
    return layoutFrame({
      columns: termWidth(),
      chats: bannerMeta?.chats,
    });
  }

  function write(s) {
    output.write(s);
  }

  function layoutTop(meta) {
    const total = rows();
    const intro = introRowCount(meta);
    const maxTop = Math.max(3, total - INPUT_BLOCK - 4);
    return Math.min(intro + 2, maxTop);
  }

  function scrollBottom() {
    return Math.max(scrollTop, rows() - INPUT_BLOCK);
  }

  function viewHeight() {
    return Math.max(1, scrollBottom() - scrollTop + 1);
  }

  function recLines(rec, w) {
    if (!rec) return [];
    if (typeof rec === 'string') return wrapLine(rec, w);
    if (rec.kind === 'md') {
      const lead = rec.lead || '';
      const painted = markdownToAnsi(rec.text, { color: tty(), width: w });
      const parts = String(painted).split('\n');
      const out = [];
      for (let i = 0; i < parts.length; i += 1) {
        const chunk = i === 0 && lead ? `${lead}${parts[i]}` : parts[i];
        out.push(...wrapLine(chunk, w));
      }
      return out;
    }
    return wrapLine(rec.text || '', w);
  }

  function visualLines() {
    const w = frame().mainW;
    const out = [];
    for (const rec of records) out.push(...recLines(rec, w));
    if (partial) out.push(...wrapLine(partial, w));
    return out;
  }

  function sideChatHits() {
    if (!bannerMeta) return [];
    const lay = frame();
    if (!lay.showSide) return [];
    const view = chatSidebarView(bannerMeta, rows(), chatOffset);
    chatOffset = view.offset;
    const x0 = lay.mainW + 1;
    const x1 = lay.cols;
    return view.shown
      .map((item, i) =>
        item.n > 0
          ? {
              row: 3 + i,
              x0,
              x1,
              n: item.n,
              id: item.id,
            }
          : null
      )
      .filter(Boolean);
  }

  function paintMain(row, text) {
    const lay = frame();
    write(`\x1b[${row};1H${fit(text || '', lay.mainW)}`);
  }

  function paintSidebar() {
    if (!tty() || !alive || !bannerMeta) return;
    const lay = frame();
    if (!lay.showSide) return;
    const view = chatSidebarView(bannerMeta, rows(), chatOffset);
    chatOffset = view.offset;
    const lines = renderChatPanel(bannerMeta, { height: rows(), offset: chatOffset, width: lay.sideW });
    const col = lay.mainW + 1;
    for (let i = 0; i < lines.length; i += 1) {
      write(`\x1b[${i + 1};${col}H${lines[i]}`);
    }
    chatHits = sideChatHits();
  }

  function paintTranscript() {
    if (!tty() || !alive) return;
    const vis = visualLines();
    const h = viewHeight();
    const win = historyWindow(vis, h, viewOffset);
    viewOffset = win.offset;
    write('\x1b7');
    for (let i = 0; i < h; i += 1) {
      paintMain(scrollTop + i, win.slice[i] || '');
    }
    write(HIDE);
    write('\x1b8');
  }

  function flushTranscript() {
    if (paintSoon) {
      clearTimeout(paintSoon);
      paintSoon = null;
    }
    if (viewOffset === 0) paintTranscript();
  }

  function scheduleTranscript() {
    if (viewOffset !== 0) return;
    if (paintSoon) return;
    paintTranscript();
    paintSoon = setTimeout(() => {
      paintSoon = null;
      paintTranscript();
    }, 16);
  }

  function append(text) {
    const s = String(text || '');
    if (!s) return;
    const parts = s.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      partial += parts[i];
      if (i < parts.length - 1) {
        records.push({ kind: 'ansi', text: partial });
        partial = '';
      }
    }
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
    if (viewOffset === 0) scheduleTranscript();
    else paintInput();
  }

  function scrollBy(n) {
    const vis = visualLines();
    const h = viewHeight();
    const maxOff = Math.max(0, vis.length - h);
    viewOffset = Math.min(maxOff, Math.max(0, viewOffset + n));
    if (paintSoon) {
      clearTimeout(paintSoon);
      paintSoon = null;
    }
    paintTranscript();
    paintInput();
  }

  function handleNav(s) {
    if (pasting) return false;
    if (s === '\x1b[A' || s === '\x1bOA') {
      scrollBy(1);
      return true;
    }
    if (s === '\x1b[B' || s === '\x1bOB') {
      scrollBy(-1);
      return true;
    }
    if (s === '\x1b[5~') {
      scrollBy(Math.max(1, viewHeight() - 1));
      return true;
    }
    if (s === '\x1b[6~') {
      scrollBy(-Math.max(1, viewHeight() - 1));
      return true;
    }
    if (s === '\x1b[H' || s === '\x1b[1~' || s === '\x1b[7~') {
      viewOffset = Number.MAX_SAFE_INTEGER;
      scrollBy(0);
      return true;
    }
    if (s === '\x1b[F' || s === '\x1b[4~' || s === '\x1b[8~') {
      viewOffset = 0;
      paintTranscript();
      paintInput();
      return true;
    }
    if (s === '\x15') {
      scrollBy(Math.max(1, Math.floor(viewHeight() / 2)));
      return true;
    }
    const wheel = /^\x1b\[<(64|65);(\d+);(\d+)[Mm]/.exec(s);
    if (wheel) {
      const x = Number(wheel[2]);
      const lay = frame();
      if (lay.showSide && x > lay.mainW) {
        scrollChats(wheel[1] === '64' ? -1 : 1);
      } else {
        scrollBy(wheel[1] === '64' ? 3 : -3);
      }
      return true;
    }
    const click = /^\x1b\[<0;(\d+);(\d+)([Mm])/.exec(s);
    if (click) {
      const released = click[3] === 'm';
      if (!released && !busySince && waiter?.kind !== 'key') {
        const x = Number(click[1]);
        const y = Number(click[2]);
        const hit = chatHits.find((h) => y === h.row && x >= h.x0 && x <= h.x1);
        if (hit && typeof opts.onOpenChat === 'function') {
          try {
            opts.onOpenChat({ n: hit.n, id: hit.id });
          } catch {
            /* ignore */
          }
        }
      }
      return true;
    }
    if (/^\x1b\[<\d+;\d+;\d+[Mm]/.test(s)) return true;
    return false;
  }

  function scrollChats(n) {
    if (!bannerMeta) return;
    const view = chatSidebarView(bannerMeta, rows(), chatOffset + n);
    chatOffset = view.offset;
    write('\x1b7');
    paintSidebar();
    write(HIDE);
    write('\x1b8');
  }

  function revealCurrentChat() {
    if (!bannerMeta) return;
    const items = chatPanelItems(bannerMeta);
    const cur = items.findIndex((it) => it.current);
    if (cur < 0) return;
    const view = chatSidebarView(bannerMeta, rows(), chatOffset);
    if (cur < view.offset) chatOffset = cur;
    else if (view.listSlots && cur >= view.offset + view.listSlots) {
      chatOffset = Math.max(0, cur - view.listSlots + 1);
    }
  }

  function paintInput() {
    if (!tty() || !alive) return;
    const w = frame().mainW;
    const top = Math.max(1, rows() - INPUT_BLOCK + 1);
    const elapsed = busySince ? formatElapsed(Date.now() - busySince) : '';
    const bits = [];
    if (tabHint) bits.push(tabHint);
    if (elapsed) bits.push(elapsed);
    if (viewOffset) bits.push(`↑ ${viewOffset}`);
    let status = bits.length ? `  ${paint(MUTED, bits.join('  ·  '))}` : '';
    if (strip(status).length > w) {
      status = paint(MUTED, `  ${strip(status).slice(0, Math.max(0, w - 5))}...`);
    }
    const lines = [status, ...renderInputLines(w, lineBuf, { busy: Boolean(busySince) })];
    write('\x1b7');
    for (let i = 0; i < INPUT_BLOCK; i += 1) {
      paintMain(top + i, lines[i] || '');
    }
    write(HIDE);
    write('\x1b8');
  }

  function paintHeader({ resetCursor = false } = {}) {
    if (!bannerMeta || !tty()) return;
    const intro = renderIntro(bannerMeta);
    const lines = intro.split('\n');
    scrollTop = layoutTop(bannerMeta);
    revealCurrentChat();
    const bottom = scrollBottom();
    if (!resetCursor) write('\x1b7');
    write('\x1b[?6l\x1b[r');
    for (let i = 0; i < lines.length; i += 1) {
      paintMain(i + 1, lines[i]);
    }
    for (let r = lines.length + 1; r < scrollTop; r += 1) {
      paintMain(r, '');
    }
    write(`\x1b[${scrollTop};${bottom}r`);
    write(HIDE);
    if (resetCursor) write(`\x1b[${scrollTop};1H`);
    else write('\x1b8');
    paintInput();
    paintTranscript();
    paintSidebar();
  }

  function stopWork() {
    busySince = 0;
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
  }

  function onResize() {
    if (!alive || !bannerMeta) return;
    paintHeader({ resetCursor: false });
  }

  function closeThink() {
    if (!thinkOpen) return;
    if (!thinkState.lineStart) append('\n');
    append('\n');
    thinkOpen = false;
    thinkState = { open: false, col: 0, lineStart: true };
  }

  function finishWait(fn) {
    const w = waiter;
    waiter = null;
    fn(w);
  }

  function applyTab(reverse = false) {
    if (!complete || busySince) return;
    if (tabCycle?.matches?.includes(lineBuf) && tabCycle.matches.length > 1) {
      const n = tabCycle.matches.length;
      tabCycle.i = (tabCycle.i + (reverse ? n - 1 : 1) + n) % n;
      lineBuf = tabCycle.matches[tabCycle.i];
      tabHint = tabCycle.hint || '';
      paintInput();
      return;
    }
    let result;
    try {
      result = complete(lineBuf);
    } catch {
      return;
    }
    const matches = result?.matches || [];
    if (result?.completed && result.completed !== lineBuf && matches.length !== 1) {
      lineBuf = result.completed;
      tabHint = result.hint || '';
      tabCycle = { matches, i: -1, hint: result.hint || '' };
      paintInput();
      return;
    }
    if (matches.length === 1) {
      lineBuf = matches[0];
      tabHint = result.hint || '';
      tabCycle = { matches, i: 0, hint: result.hint || '' };
      paintInput();
      return;
    }
    if (matches.length > 1) {
      tabCycle = { matches, i: reverse ? matches.length - 1 : 0, hint: result.hint || '' };
      lineBuf = matches[tabCycle.i];
      tabHint = result.hint || '';
      paintInput();
    }
  }

  function onData(chunk) {
    const s = String(chunk);
    if (s === '\x03') {
      if (busySince && cancelWork) {
        cancelWork();
        return;
      }
      if (waiter) {
        const err = Object.assign(new Error('Interrupted'), { interrupted: true });
        finishWait((w) => w.reject(err));
      } else {
        process.emit('SIGINT');
      }
      return;
    }
    if (waiter?.kind === 'line' && !pasting && (s === '\t' || s === '\x1b[Z')) {
      applyTab(s === '\x1b[Z');
      return;
    }
    if (handleNav(s)) return;
    if (!waiter) return;
    if (s === '\x04') {
      if (waiter.kind === 'line') {
        finishWait((w) => w.resolve('/exit'));
      }
      return;
    }
    if (s === '\x1b[200~') {
      pasting = true;
      return;
    }
    if (s === '\x1b[201~') {
      pasting = false;
      return;
    }

    if (waiter.kind === 'key') {
      const ch = s[0];
      if (ch && ch !== '\x1b') finishWait((w) => w.resolve(ch.toLowerCase()));
      return;
    }

    if (s.startsWith('\x1b') && s !== '\x1bOM') return;

    if (waiter.kind === 'line' && !pasting) {
      const hit = splitLineSubmit(s);
      if (hit) {
        lineBuf += hit.line;
        const value = lineBuf;
        lineBuf = '';
        tabCycle = null;
        tabHint = '';
        paintInput();
        finishWait((w) => w.resolve(value));
        return;
      }
    }
    if (s === '\x7f' || s === '\b') {
      lineBuf = lineBuf.slice(0, -1);
      tabCycle = null;
      tabHint = '';
      waiter.redraw();
      return;
    }
    const add = pasting ? s.replace(/\r/g, '') : s;
    if (pasting || (add >= ' ' && add !== '\t')) {
      lineBuf += add;
      tabCycle = null;
      tabHint = '';
      waiter.redraw();
    }
  }

  return {
    enter() {
      if (!tty()) return;
      alive = true;
      if (typeof input.setRawMode === 'function') {
        input.setRawMode(true);
        raw = true;
      }
      input.resume();
      input.setEncoding('utf8');
      write(ALT_ON + PASTE_ON + MOUSE_ON + HIDE);
      write('\x1b[2J\x1b[H');
      input.on('data', onData);
      output.on('resize', onResize);
    },
    leave() {
      alive = false;
      stopWork();
      if (paintSoon) {
        clearTimeout(paintSoon);
        paintSoon = null;
      }
      output.off('resize', onResize);
      input.off('data', onData);
      try {
        write('\x1b[r');
        write(MOUSE_OFF + PASTE_OFF + SHOW + ALT_OFF);
      } catch {
        /* ignore */
      }
      if (raw && typeof input.setRawMode === 'function') {
        try {
          input.setRawMode(false);
        } catch {
          /* ignore */
        }
        raw = false;
      }
      try {
        input.pause();
        if (typeof input.unref === 'function') input.unref();
      } catch {
        /* ignore */
      }
    },
    banner(meta) {
      bannerMeta = { ...(meta || {}) };
      if (!tty()) {
        write(`${renderIntro(bannerMeta)}\n\n`);
        return;
      }
      paintHeader({ resetCursor: true });
    },
    updateBanner(patch = {}) {
      if (!bannerMeta) return;
      bannerMeta = { ...bannerMeta, ...patch };
      paintHeader({ resetCursor: false });
    },
    clearTranscript() {
      records = [];
      partial = '';
      viewOffset = 0;
      if (!tty()) return;
      paintTranscript();
      paintInput();
    },
    beginWork(onCancel) {
      busySince = Date.now();
      cancelWork = typeof onCancel === 'function' ? onCancel : null;
      if (tick) clearInterval(tick);
      tick = setInterval(() => paintInput(), 100);
      paintInput();
    },
    endWork() {
      cancelWork = null;
      stopWork();
      if (paintSoon) {
        clearTimeout(paintSoon);
        paintSoon = null;
      }
      if (viewOffset === 0) paintTranscript();
      paintInput();
    },
    note(s) {
      append('\n');
      for (const line of String(s || '').split('\n')) {
        append(`  ${paint(MUTED, line)}\n`);
      }
      flushTranscript();
      paintInput();
    },
    user(s) {
      append(`\n${paint(TEXT, `${BOLD}you`)}  ${s}\n`);
      flushTranscript();
    },
    startAssistant() {
      closeThink();
      wrotePrefix = false;
      append('\n');
    },
    writeDelta(part) {
      const p = typeof part === 'string' ? { type: 'content', text: part } : part;
      if (!p?.text) return;
      if (p.type === 'thinking') {
        const painted = thinkDeltaToAnsi(p.text, thinkState, { width: frame().mainW });
        thinkState = painted.state;
        thinkOpen = true;
        append(painted.text);
        return;
      }
      closeThink();
      if (!wrotePrefix) {
        if (partial) {
          records.push({ kind: 'ansi', text: partial });
          partial = '';
        }
        records.push({
          kind: 'md',
          lead: '',
          text: '',
        });
        wrotePrefix = true;
      }
      const last = records[records.length - 1];
      if (last?.kind === 'md') last.text += p.text;
      else records.push({ kind: 'md', text: p.text, lead: '' });
      if (records.length > MAX_RECORDS) {
        records.splice(0, records.length - MAX_RECORDS);
      }
      if (viewOffset === 0) scheduleTranscript();
      else paintInput();
    },
    writeAssistant(chunk) {
      this.writeDelta(typeof chunk === 'string' ? { type: 'content', text: chunk } : chunk);
    },
    endAssistant() {
      closeThink();
      append('\n');
      if (paintSoon) {
        clearTimeout(paintSoon);
        paintSoon = null;
      }
      if (viewOffset === 0) paintTranscript();
    },
    replaceAssistant(text) {
      const next = String(text || '');
      for (let i = records.length - 1; i >= 0; i -= 1) {
        if (records[i]?.kind === 'md') {
          if (next.trim()) records[i].text = next;
          else records.splice(i, 1);
          break;
        }
      }
      flushTranscript();
    },
    tool(summary) {
      append(`  ${paint(ACCENT, '▸')} ${paint(MUTED, summary)}\n`);
    },
    error(s) {
      append(`\n  ${paint(RED, s)}\n`);
    },
    replay(messages) {
      this.clearTranscript();
      for (const m of messages || []) {
        if (m?.role === 'user') {
          const text = contentText(m);
          if (text) this.user(text);
        } else if (m?.role === 'assistant') {
          const text = contentText(m);
          if (text) {
            this.startAssistant();
            this.writeDelta({ type: 'content', text });
            this.endAssistant();
          }
          for (const call of m.tool_calls || []) {
            this.tool(toolSummary(call));
          }
        } else if (m?.role === 'tool') {
          const text = contentText(m).split('\n')[0];
          if (text) this.note(text.length > 120 ? `${text.slice(0, 117)}…` : text);
        }
      }
    },
    async readLine({ initial = '' } = {}) {
      if (!tty()) {
        throw new Error('Bracket needs a terminal. Use: scalattice bracket --print "…"');
      }
      lineBuf = String(initial || '');
      paintInput();
      return new Promise((resolve, reject) => {
        waiter = {
          kind: 'line',
          resolve,
          reject,
          redraw() {
            paintInput();
          },
        };
      });
    },
    async approve(toolName, summary) {
      write(`\n  ${paint(TEXT, 'Allow')} ${paint(ACCENT, toolName)}?\n`);
      write(`  ${paint(MUTED, summary)}\n`);
      write(`  ${paint(MUTED, '[y]es  [n]o  [a]lways')}\n`);
      const key = await new Promise((resolve, reject) => {
        waiter = { kind: 'key', resolve, reject };
      });
      return key;
    },
  };
}
