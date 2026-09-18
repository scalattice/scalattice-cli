import os from 'node:os';
import { companyPrompt } from './company.js';
import { toolsPrompt } from './tools.js';

const DEFAULT_MODEL = 'qwen-3-coder-30b-a3b';
const FALLBACK_MODELS = ['qwen-3-32b', 'qwen-3-8b'];

export function pickDefaultModel(ids, remembered) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const inCatalog = (id) => !list.length || list.includes(id);
  for (const want of [process.env.SCALATTICE_BRACKET_MODEL, remembered, DEFAULT_MODEL, ...FALLBACK_MODELS]) {
    if (want && inCatalog(want)) return want;
  }
  if (process.env.SCALATTICE_BRACKET_MODEL) return process.env.SCALATTICE_BRACKET_MODEL;
  if (remembered) return remembered;
  return list[0] || DEFAULT_MODEL;
}

export function buildSystemPrompt({ cwd, model, yolo }) {
  const today = new Date().toISOString().slice(0, 10);

  return `You are Scalattice Bracket, a coding harness in the Scalattice CLI. You help the user with software engineering in this workspace.

Workspace: ${cwd}
Platform: ${os.platform()} ${os.release()} (${os.arch()})
Date: ${today}
Model: ${model}
Unattended (yolo): ${yolo ? 'yes: do not ask the user to run commands; use tools' : 'no: tools that write or run a shell may require approval'}

# How you work
- Prefer tools. Do not guess file contents. Use glob, list_dir, and grep, then read_file with offset/limit. Never paste a whole repo or a huge file into one turn.
- Use web_search and web_fetch for the public web. Do not pretend you cannot go online.
- No extra comments, docs, refactors, commits, or pushes unless asked.
- After edits, run tests or typecheck when you reasonably can.
- Write replies in Markdown: headings, lists, fenced code, **bold**, *italic*, \`code\`, and --- rules.

# Scalattice
${companyPrompt()}

# Tools
${toolsPrompt()}
`;
}

export function compactMessages(messages, { keep = 12 } = {}) {
  if (!Array.isArray(messages) || messages.length <= keep + 1) return messages;
  const head = messages[0]?.role === 'system' ? [messages[0]] : [];
  const rest = head.length ? messages.slice(1) : messages.slice();
  if (rest.length <= keep) return messages;
  const dropped = rest.slice(0, rest.length - keep);
  const kept = rest.slice(rest.length - keep);
  const summary = dropped
    .map((m) => {
      const role = m.role || 'unknown';
      const text =
        typeof m.content === 'string'
          ? m.content.slice(0, 400)
          : m.tool_calls
            ? m.tool_calls.map((t) => t.function?.name).join(', ')
            : '';
      return `${role}: ${text}`.replace(/\s+/g, ' ').slice(0, 240);
    })
    .join('\n');
  return [
    ...head,
    {
      role: 'user',
      content: `[Earlier conversation compacted]\n${summary}`,
    },
    ...kept,
  ];
}

export function estimateChars(messages) {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}

function charsToTokens(s) {
  const runes = [...String(s || '')].length;
  return Math.max(0, Math.ceil((runes + 2) / 3));
}

function messageBlob(m) {
  const parts = [m?.role, m?.content, m?.tool_call_id];
  if (m?.tool_calls) {
    try {
      parts.push(JSON.stringify(m.tool_calls));
    } catch {
      /* skip */
    }
  }
  return parts.filter((p) => p != null && p !== '').join('\n');
}

// Same ~3 chars/token as the router, plus tool schemas. Used to shrink
// history before a 4096-token GPU window rejects the request.
export function estimateTokens(messages, tools) {
  let n = 16;
  for (const m of messages || []) {
    n += 8 + charsToTokens(messageBlob(m));
  }
  if (tools) {
    try {
      n += charsToTokens(JSON.stringify(tools));
    } catch {
      /* skip */
    }
  }
  return n;
}

function clipMessage(m, maxChars) {
  if (typeof m?.content !== 'string' || m.content.length <= maxChars) return m;
  return { ...m, content: `${m.content.slice(0, maxChars)}\n…` };
}

export const CONTEXT_SOFT_TOKENS = 2800;

export function fitMessagesForContext(messages, { budget = CONTEXT_SOFT_TOKENS, tools, keep = 8 } = {}) {
  if (!Array.isArray(messages) || estimateTokens(messages, tools) <= budget) return messages;
  let out = messages.slice();
  let keepN = keep;
  const minKeep = 2;
  while (estimateTokens(out, tools) > budget && out.length > minKeep + 1) {
    const next = compactMessages(out, { keep: keepN });
    const before = estimateTokens(out, tools);
    const after = estimateTokens(next, tools);
    if (after >= before) {
      if (keepN <= minKeep) break;
      keepN = Math.max(minKeep, keepN - 2);
      continue;
    }
    out = next;
    keepN = Math.max(minKeep, keepN - 2);
  }
  out = out.map((m, i, arr) => {
    if (m.role === 'system') return m;
    if (i === arr.length - 1) return clipMessage(m, 4000);
    return clipMessage(m, 1600);
  });
  if (estimateTokens(out, tools) > budget) {
    out = out.map((m, i, arr) => {
      if (m.role === 'system') return clipMessage(m, 3500);
      if (i === arr.length - 1) return clipMessage(m, 1500);
      return clipMessage(m, 600);
    });
  }
  return out;
}

export function isContextOverflowError(err) {
  return /maximum context length|prompt_too_long|Shorten the messages|reduce max_tokens/i.test(
    String(err?.message || err || '')
  );
}
