import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';

const CYAN = '\x1b[38;2;34;211;238m';
const VIOLET = '\x1b[38;2;167;139;250m';
const MUTED = '\x1b[38;2;148;163;184m';
const TEXT = '\x1b[38;2;226;232;240m';
const RED = '\x1b[38;2;248;113;113m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const SHOW = '\x1b[?25h';

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
  return Math.max(40, Math.min(output.columns || 80, 100));
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

export function renderBanner({ cwd, model, yolo, version = pkgVersion(), email, credits = [] } = {}) {
  const w = width();
  const ver = version ? ` v${version}` : '';
  const mode = yolo ? 'yolo' : 'approvals on';
  const lines = [
    hline(w, '╭', '─', '╮'),
    row(w, `${paint(CYAN, `${BOLD}[ ]${RESET}${CYAN}`)}  ${paint(TEXT, `${BOLD}Scalattice Bracket`)}${paint(MUTED, ver)}`),
    row(w, ''),
    row(w, paint(MUTED, cwd || process.cwd())),
    row(w, paint(MUTED, `${model} · ${mode}`)),
  ];
  if (email) lines.push(row(w, paint(MUTED, email)));
  for (const line of credits) {
    if (line) lines.push(row(w, paint(MUTED, line)));
  }
  lines.push(hline(w, '╰', '─', '╯'));
  return lines.join('\n');
}

function renderInput(w, value) {
  const innerW = w - 6;
  const shown = value.slice(-innerW);
  const caret = tty() ? paint(CYAN, '█') : '';
  const pad = Math.max(0, innerW - shown.length - (tty() ? 1 : 0));
  return [
    hline(w, '╭', '─', '╮'),
    `│ ${paint(CYAN, '>')} ${shown}${caret}${' '.repeat(pad)} │`,
    hline(w, '╰', '─', '╯'),
  ].join('\n');
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

  function write(s) {
    output.write(s);
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
      if (typeof input.setRawMode === 'function') {
        input.setRawMode(true);
        raw = true;
      }
      input.resume();
      input.setEncoding('utf8');
      write(PASTE_ON + SHOW);
      input.on('data', onData);
    },
    leave() {
      input.off('data', onData);
      write(PASTE_OFF + SHOW);
      if (raw && typeof input.setRawMode === 'function') {
        input.setRawMode(false);
        raw = false;
      }
    },
    banner(meta) {
      write(`\x1b[2J\x1b[H${renderBanner(meta)}\n`);
      write(`\n  ${paint(MUTED, 'Ask about this workspace. /help  /exit  /model  /yolo  /credits')}\n`);
    },
    note(s) {
      write(`  ${paint(MUTED, s)}\n`);
    },
    user(s) {
      write(`\n${paint(CYAN, `${BOLD}you`)}  ${s}\n`);
    },
    startAssistant() {
      write(`\n${paint(VIOLET, `${BOLD}[ ]`)}  `);
    },
    writeAssistant(chunk) {
      write(chunk);
    },
    endAssistant() {
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
      write(`\n${renderInput(w, '')}`);
      const value = await new Promise((resolve, reject) => {
        waiter = {
          kind: 'line',
          resolve,
          reject,
          redraw() {
            write(eraseLines(3) + renderInput(w, lineBuf));
          },
        };
      });
      write(eraseLines(3));
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
