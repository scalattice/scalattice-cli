import {
  ACCENT,
  ACCENT_SOFT,
  BOLD,
  CODE,
  DIM,
  ITALIC,
  MUTED,
  RESET,
  STRIKE,
  TEXT,
  UNDERLINE,
} from './theme.js';

export function stripAnsi(s) {
  return String(s || '')
    .replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '');
}

function paint(code, s) {
  if (!s) return '';
  return `${code}${s}${RESET}`;
}

const OSC8_CLOSE = '\x1b]8;;\x1b\\';

export function httpUrl(raw) {
  const u = String(raw || '').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  if (/[\x1b\x07]/.test(u)) return '';
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

export function oscHyperlink(href, label, { color = true } = {}) {
  const url = httpUrl(href);
  const text = label || href || url;
  const painted = color ? paint(`${UNDERLINE}${ACCENT}`, text) : text;
  if (!url) return painted;
  return `\x1b]8;;${url}\x1b\\${painted}${OSC8_CLOSE}`;
}

function takeBareUrl(s) {
  const angle = /^<(https?:\/\/[^>\s]+)>/i.exec(s);
  if (angle && httpUrl(angle[1])) {
    return { raw: angle[1], eaten: angle[0].length };
  }
  const m = /^(https?:\/\/[^\s<>\[\]"'`\\]+)/i.exec(s);
  if (!m) return null;
  let url = m[1];
  while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
  while (url.endsWith(')') && url.split('(').length < url.split(')').length) {
    url = url.slice(0, -1);
  }
  if (!httpUrl(url)) return null;
  return { raw: url, eaten: url.length };
}

function headingStyle(level) {
  if (level <= 1) return `${BOLD}${TEXT}`;
  if (level === 2) return `${BOLD}${ACCENT}`;
  return `${BOLD}${ACCENT_SOFT}`;
}

function isHr(line) {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(String(line || '').trim());
}

function fenceOpen(line) {
  const m = /^(```|~~~)([^\n]*)$/.exec(String(line || '').trimEnd());
  return m ? { mark: m[1], info: String(m[2] || '').trim() } : null;
}

function isFenceClose(line, mark) {
  const t = String(line || '').trim();
  return t === mark || t.startsWith(mark);
}

function splitCells(line) {
  let s = String(line || '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isSepRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')));
}

function looksLikeTable(line) {
  const t = String(line || '').trim();
  return t.includes('|') && splitCells(t).length >= 2;
}

function padCell(text, w) {
  const vis = stripAnsi(text).length;
  return `${text}${' '.repeat(Math.max(0, w - vis))}`;
}

function renderTable(rows, color) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] || 0, stripAnsi(cell).length);
    });
  }
  return rows.map((row) => {
    const line = row.map((cell, i) => padCell(cell, widths[i] || 0)).join(color ? paint(MUTED, '  │  ') : '   ');
    return line;
  });
}

function canOpenEm(s, i, mark) {
  const next = s[i + mark.length];
  if (!next || next === ' ' || next === '\n') return false;
  if (mark === '_' || mark === '*') {
    if (next === mark) return false;
  }
  if (mark === '_') {
    const prev = i === 0 ? ' ' : s[i - 1];
    if (/\w/.test(prev)) return false;
  }
  return true;
}

function findClose(s, i, mark) {
  const from = i + mark.length;
  let j = from;
  while (j < s.length) {
    if (s[j] === '`') {
      const k = s.indexOf('`', j + 1);
      j = k === -1 ? s.length : k + 1;
      continue;
    }
    if (s.startsWith(mark, j)) return j;
    j += 1;
  }
  return -1;
}

function takeWrap(s, i, mark, style, color) {
  if (!s.startsWith(mark, i)) return null;
  const end = findClose(s, i, mark);
  const inner = end === -1 ? s.slice(i + mark.length) : s.slice(i + mark.length, end);
  const body = inlineMarkdown(inner, { color: false });
  const text = color ? paint(style, body) : body;
  if (end === -1) return { text, next: s.length };
  return { text, next: end + mark.length };
}

export function inlineMarkdown(src, { color = true, links = true } = {}) {
  const s = String(src || '');
  let i = 0;
  let out = '';
  const wrap = (code, text) => (color ? paint(code, text) : text);
  const linkify = (href, label) => (links ? oscHyperlink(href, label, { color }) : color ? wrap(`${UNDERLINE}${ACCENT}`, label || href) : label || href);

  while (i < s.length) {
    const rest = s.slice(i);

    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) {
        out += wrap(CODE, s.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      out += wrap(CODE, s.slice(i + 1));
      break;
    }

    const img = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(rest);
    if (img) {
      const alt = img[1] || img[2];
      out += httpUrl(img[2]) && links ? oscHyperlink(img[2], alt, { color }) : wrap(MUTED, alt);
      i += img[0].length;
      continue;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (link) {
      out += linkify(link[2], link[1]);
      i += link[0].length;
      continue;
    }

    const bare = takeBareUrl(rest);
    if (bare) {
      out += linkify(bare.raw, bare.raw);
      i += bare.eaten;
      continue;
    }

    if (rest.startsWith('~~')) {
      const hit = takeWrap(s, i, '~~', STRIKE, color);
      if (hit) {
        out += hit.text;
        i = hit.next;
        continue;
      }
    }

    if (rest.startsWith('***')) {
      const hit = takeWrap(s, i, '***', `${BOLD}${ITALIC}`, color);
      if (hit) {
        out += hit.text;
        i = hit.next;
        continue;
      }
    }

    if (rest.startsWith('**')) {
      const hit = takeWrap(s, i, '**', BOLD, color);
      if (hit) {
        out += hit.text;
        i = hit.next;
        continue;
      }
    }

    if (rest.startsWith('__')) {
      const hit = takeWrap(s, i, '__', BOLD, color);
      if (hit) {
        out += hit.text;
        i = hit.next;
        continue;
      }
    }

    if (s[i] === '*' && canOpenEm(s, i, '*')) {
      const hit = takeWrap(s, i, '*', ITALIC, color);
      if (hit) {
        out += hit.text;
        i = hit.next;
        continue;
      }
    }

    if (s[i] === '_' && canOpenEm(s, i, '_')) {
      const hit = takeWrap(s, i, '_', ITALIC, color);
      if (hit) {
        out += hit.text;
        i = hit.next;
        continue;
      }
    }

    out += s[i];
    i += 1;
  }
  return out;
}

function listPad(indent) {
  return '  '.repeat(Math.max(0, Math.floor(String(indent || '').length / 2)));
}

/**
 * Common model Markdown (ATX headings, lists, fences, emphasis, hr, tables, links)
 * to ANSI. Unclosed emphasis and fences stay styled through EOF so a stream paints
 * as it arrives instead of showing raw markers until the closing token.
 */
export function markdownToAnsi(src, { color = true, width = 72 } = {}) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const maxW = Math.max(16, Number(width) || 72);
  let i = 0;
  let fence = null;
  const inline = (s) => inlineMarkdown(s, { color });

  while (i < lines.length) {
    const line = lines[i];

    if (fence) {
      if (isFenceClose(line, fence.mark)) {
        fence = null;
        i += 1;
        continue;
      }
      out.push(color ? `  ${paint(`${DIM}${CODE}`, line)}` : `  ${line}`);
      i += 1;
      continue;
    }

    const open = fenceOpen(line);
    if (open) {
      fence = open;
      if (open.info) out.push(color ? paint(MUTED, `  ${open.info}`) : `  ${open.info}`);
      i += 1;
      continue;
    }

    if (isHr(line)) {
      const bar = '─'.repeat(Math.min(40, maxW - 4));
      out.push(color ? paint(MUTED, `  ${bar}`) : `  ${'-'.repeat(bar.length)}`);
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      const rendered = inlineMarkdown(title, { color: false, links: color });
      out.push(color ? paint(headingStyle(level), rendered) : rendered);
      if (level <= 2) {
        const underline = '─'.repeat(Math.min(32, Math.max(8, stripAnsi(rendered).length)));
        out.push(color ? paint(MUTED, underline) : underline);
      }
      i += 1;
      continue;
    }

    if (looksLikeTable(line) && i + 1 < lines.length && isSepRow(splitCells(lines[i + 1]))) {
      const rows = [splitCells(line).map((c) => inline(c))];
      i += 2;
      while (i < lines.length && looksLikeTable(lines[i]) && !isSepRow(splitCells(lines[i]))) {
        rows.push(splitCells(lines[i]).map((c) => inline(c)));
        i += 1;
      }
      out.push(...renderTable(rows, color));
      continue;
    }

    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) {
      out.push(`${color ? paint(MUTED, '│ ') : '  '}${inline(bq[1])}`);
      i += 1;
      continue;
    }

    const ul = /^(\s*)([-*+])\s+(.*)$/.exec(line);
    if (ul) {
      const bullet = color ? paint(ACCENT, '•') : '*';
      out.push(`${listPad(ul[1])}${bullet} ${inline(ul[3])}`);
      i += 1;
      continue;
    }

    const ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (ol) {
      const n = color ? paint(ACCENT, `${ol[2]}.`) : `${ol[2]}.`;
      out.push(`${listPad(ol[1])}${n} ${inline(ol[3])}`);
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      out.push('');
      i += 1;
      continue;
    }

    out.push(inline(line));
    i += 1;
  }

  return out.join('\n');
}
