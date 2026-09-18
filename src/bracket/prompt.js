import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { walkFiles } from './paths.js';
import { companyPrompt } from './company.js';
import { toolsPrompt } from './tools.js';

const DEFAULT_MODEL = 'qwen-3-coder-30b-a3b';
const FALLBACK_MODELS = ['qwen-3-32b', 'qwen-3-8b'];

function run(cmd, args, cwd) {
  try {
    const r = spawnSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) return '';
    return String(r.stdout || '').trim();
  } catch {
    return '';
  }
}

function listTop(cwd) {
  const files = walkFiles(cwd, { maxFiles: 80 });
  return files
    .slice(0, 60)
    .map((abs) => path.relative(cwd, abs) || '.')
    .join('\n');
}

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
  const gitRoot = run('git', ['rev-parse', '--show-toplevel'], cwd);
  const gitStatus = run('git', ['status', '-sb'], cwd);
  const gitLog = run('git', ['log', '-5', '--oneline'], cwd);
  const listing = listTop(cwd);
  const today = new Date().toISOString().slice(0, 10);

  return `You are Scalattice Bracket, a coding harness in the Scalattice CLI. You help the user with software engineering in this workspace.

Workspace: ${cwd}
Platform: ${os.platform()} ${os.release()} (${os.arch()})
Date: ${today}
Model: ${model}
Unattended (yolo): ${yolo ? 'yes: do not ask the user to run commands; use tools' : 'no: tools that write or run a shell may require approval'}
Git root: ${gitRoot || '(not a git repo)'}

# How you work
- Prefer tools over asking. Read the code before editing. Match existing style.
- Use web_search and web_fetch when the answer is on the public web or the user names a URL. Do not pretend you cannot go online.
- Make focused changes. Do not add comments, docs, or refactors the user did not ask for.
- Do not commit unless the user asked. Do not push.
- After edits, run the relevant tests or typecheck when you reasonably can.
- Paths in tools are relative to the workspace unless they are absolute.
- Keep going until the task is done or you are blocked. Summarize what you changed.
- Write replies in Markdown: headings, lists, fenced code, **bold**, *italic*, \`code\`, and --- rules. The terminal renders that. Do not dump a file-tree essay unless the user asked for a tour.

# Scalattice
${companyPrompt()}

# Tools
${toolsPrompt()}

# Git
${gitStatus || '(no status)'}
${gitLog ? `Recent commits:\n${gitLog}` : ''}

# Workspace files (partial)
${listing || '(empty)'}
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
