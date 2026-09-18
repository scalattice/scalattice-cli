import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import { logoBraille, logoCellWidth } from './logo.js';

const CYAN = '\x1b[38;2;34;211;238m';
const VIOLET = '\x1b[38;2;167;139;250m';
const THINK = '\x1b[38;2;196;181;253m';
const THINK_DIM = '\x1b[38;2;139;122;184m';
const MUTED = '\x1b[38;2;148;163;184m';
const TEXT = '\x1b[38;2;226;232;240m';
const RED = '\x1b[38;2;248;113;113m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const SHOW = '\x1b[?25h';
const HIDE = '\x1b[?25l';
const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const THINK_GUTTER = '  ┊ ';

const tty = () => Boolean(input.isTTY && output.isTTY);

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

function width() {
  const cols = Number(output.columns) || 80;
  return Math.max(40, Math.min(cols > 1 ? cols - 1 : cols, 100));
}

function rows() {
  return Math.max(12, output.rows || 24);
}

function strip(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function hline(w, left, mid, right) {
  return `${left}${mid.repeat(Math.max(0, w - 2))}${right}`;
}

function row(w, inner) {
  const max = Math.max(0, w - 4);
  let text = inner;
  if (strip(text).length > max) {
    text = paint(MUTED, `${strip(text).slice(0, Math.max(0, max - 1))}…`);
  }
  const pad = Math.max(0, max - strip(text).length);
  return `│ ${text}${' '.repeat(pad)} │`;
}

export function renderBanner({ cwd, model, yolo, version = pkgVersion(), email, credits = [], policy } = {}) {
  const w = width();
  const ver = version ? ` v${version}` : '';
  const mode = yolo ? 'yolo' : 'approvals on';
  const markRaw = logoBraille({ width: 12, height: 12, color: tty() });
  const mark = markRaw.length ? markRaw : [paint(CYAN, `${BOLD}[ ]`)];
  const markW = logoCellWidth(mark) || 3;
  const gap = '  ';
  const indent = `${' '.repeat(markW)}${gap}`;
  const rest = [
    `${paint(TEXT, `${BOLD}Scalattice Bracket`)}${paint(MUTED, ver)}`,
    paint(MUTED, cwd || process.cwd()),
    paint(MUTED, `${model} · ${mode}`),
  ];
  if (policy) rest.push(paint(MUTED, policy));
  if (email) rest.push(paint(MUTED, email));
  for (const line of credits) {
    if (line) rest.push(paint(MUTED, line));
  }

  const lines = [hline(w, '╭', '─', '╮')];
  const n = Math.max(mark.length, rest.length);
  for (let i = 0; i < n; i += 1) {
    const text = rest[i] || '';
    if (i < mark.length) lines.push(row(w, `${mark[i]}${gap}${text}`));
    else lines.push(row(w, `${indent}${text}`));
  }
  lines.push(hline(w, '╰', '─', '╯'));
  return lines.join('\n');
}

export function renderIntro(meta = {}) {
  const banner = renderBanner(meta);
  const hint = `  ${paint(MUTED, 'Ask about this workspace.  /help [command]   /settings   /exit')}`;
  return `${banner}\n\n${hint}`;
}

export function introRowCount(meta = {}) {
  return renderIntro(meta).split('\n').length;
}

/** Stream thinking into italic guttered lines. `state` is mutated across chunks. */
export function thinkDeltaToAnsi(text, state = {}, opts = {}) {
  const limit = Math.max(16, (opts.width || width()) - THINK_GUTTER.length - 2);
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

function renderInput(w, value) {
  const innerW = w - 6;
  const shown = value.slice(-innerW);
  const caret = tty() ? paint(CYAN, '█') : '';
  const pad = Math.max(0, innerW - shown.length - (tty() ? 1 : 0));
  const box = [
    hline(w, '╭', '─', '╮'),
    `│ ${paint(CYAN, '>')} ${shown}${caret}${' '.repeat(pad)} │`,
    hline(w, '╰', '─', '╯'),
  ].join('\n');
  return tty() ? box + HIDE : box;
}

function eraseLines(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += '\x1b[2K';
    if (i < n - 1) out += '\x1b[1A';
  }
  return `\r${out}`;
}

export function createTui() {
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

  function write(s) {
    output.write(s);
  }

  function layoutTop(meta) {
    const total = rows();
    const intro = introRowCount(meta);
    return Math.min(intro + 2, Math.max(3, total - 5));
  }

  function paintHeader({ resetCursor = false } = {}) {
    if (!bannerMeta || !tty()) return;
    const intro = renderIntro(bannerMeta);
    const lines = intro.split('\n');
    scrollTop = layoutTop(bannerMeta);
    const bottom = rows();
    if (!resetCursor) write('\x1b7');
    write('\x1b[?6l\x1b[r\x1b[H');
    for (const line of lines) {
      write(`\x1b[2K${line}\r\n`);
    }
    write('\x1b[2K\r\n');
    write(`\x1b[${scrollTop};${bottom}r`);
    write(HIDE);
    if (resetCursor) write(`\x1b[${scrollTop};1H`);
    else write('\x1b8');
  }

  function onResize() {
    if (!alive || !bannerMeta) return;
    paintHeader({ resetCursor: false });
  }

  function closeThink() {
    if (!thinkOpen) return;
    if (!thinkState.lineStart) write('\n');
    write('\n');
    thinkOpen = false;
    thinkState = { open: false, col: 0, lineStart: true };
  }

  function finishWait(fn) {
    const w = waiter;
    waiter = null;
    fn(w);
  }

  function onData(chunk) {
    const s = String(chunk);
    if (!waiter) return;

    if (s === '\x03') {
      if (waiter) {
        const err = Object.assign(new Error('Interrupted'), { interrupted: true });
        finishWait((w) => w.reject(err));
      } else {
        process.emit('SIGINT');
      }
      return;
    }
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

    if (s.startsWith('\x1b')) return;

    if (s === '\r' || s === '\n') {
      const value = lineBuf;
      lineBuf = '';
      finishWait((w) => w.resolve(value));
      return;
    }
    if (s === '\x7f' || s === '\b') {
      lineBuf = lineBuf.slice(0, -1);
      waiter.redraw();
      return;
    }
    const add = pasting ? s.replace(/\r/g, '') : s;
    if (pasting || add >= ' ' || add === '\t') {
      lineBuf += add;
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
      write(ALT_ON + PASTE_ON + HIDE);
      write('\x1b[2J\x1b[H');
      input.on('data', onData);
      output.on('resize', onResize);
    },
    leave() {
      alive = false;
      output.off('resize', onResize);
      input.off('data', onData);
      write('\x1b[r');
      write(PASTE_OFF + SHOW + ALT_OFF);
      if (raw && typeof input.setRawMode === 'function') {
        input.setRawMode(false);
        raw = false;
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
      if (!tty()) return;
      write(`\x1b[${scrollTop};1H\x1b[J`);
    },
    note(s) {
      write('\n');
      for (const line of String(s || '').split('\n')) {
        write(`  ${paint(MUTED, line)}\n`);
      }
    },
    user(s) {
      write(`\n${paint(CYAN, `${BOLD}you`)}  ${s}\n`);
    },
    startAssistant() {
      closeThink();
      wrotePrefix = false;
      write('\n');
    },
    writeDelta(part) {
      const p = typeof part === 'string' ? { type: 'content', text: part } : part;
      if (!p?.text) return;
      if (p.type === 'thinking') {
        const painted = thinkDeltaToAnsi(p.text, thinkState, { width: width() });
        thinkState = painted.state;
        thinkOpen = true;
        write(painted.text);
        return;
      }
      closeThink();
      if (!wrotePrefix) {
        write(`${paint(VIOLET, `${BOLD}[ ]`)}  `);
        wrotePrefix = true;
      }
      write(p.text);
    },
    writeAssistant(chunk) {
      this.writeDelta(typeof chunk === 'string' ? { type: 'content', text: chunk } : chunk);
    },
    endAssistant() {
      closeThink();
      write('\n');
    },
    tool(summary) {
      write(`  ${paint(CYAN, '▸')} ${paint(MUTED, summary)}\n`);
    },
    error(s) {
      write(`\n  ${paint(RED, s)}\n`);
    },
    async readLine() {
      if (!tty()) {
        throw new Error('Bracket needs a terminal. Use: scalattice bracket --print "…"');
      }
      lineBuf = '';
      const w = width();
      write(`\n${renderInput(w, '')}${HIDE}`);
      const value = await new Promise((resolve, reject) => {
        waiter = {
          kind: 'line',
          resolve,
          reject,
          redraw() {
            write(eraseLines(3) + renderInput(w, lineBuf) + HIDE);
          },
        };
      });
      write(eraseLines(3) + HIDE);
      return value;
    },
    async approve(toolName, summary) {
      write(`\n  ${paint(TEXT, 'Allow')} ${paint(CYAN, toolName)}?\n`);
      write(`  ${paint(MUTED, summary)}\n`);
      write(`  ${paint(MUTED, '[y]es  [n]o  [a]lways')}\n`);
      const key = await new Promise((resolve, reject) => {
        waiter = { kind: 'key', resolve, reject };
      });
      return key;
    },
  };
}
