import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { applyEdit } from './edit.js';
import { globToRegExp, looksBinary, resolveWorkspacePath, walkFiles } from './paths.js';
import { webFetchTool, webSearchTool } from './web.js';

const MAX_READ_BYTES = 512 * 1024;
const MAX_TOOL_CHARS = 4_000;
const MAX_GREP_HITS = 40;
const DEFAULT_READ_LINES = 160;
const MAX_GLOB_HITS = 80;

function fn(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

export const TOOL_DEFS = [
  fn(
    'bash',
    'Run a shell command in the workspace. Use for git, tests, builds, and inspection. Quote paths with spaces.',
    {
      command: { type: 'string', description: 'Shell command to run' },
      timeout_ms: { type: 'integer', description: 'Kill after this many ms (default 120000)' },
    },
    ['command']
  ),
  fn(
    'read_file',
    'Read a slice of a text file. Default 160 lines. Use offset/limit; do not read a whole large file.',
    {
      path: { type: 'string', description: 'Path relative to the workspace' },
      offset: { type: 'integer', description: 'First line to return (1-based)' },
      limit: { type: 'integer', description: 'Maximum number of lines' },
    },
    ['path']
  ),
  fn(
    'write_file',
    'Create or overwrite a text file. Creates parent directories. Prefer edit_file for existing files.',
    {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    ['path', 'content']
  ),
  fn(
    'edit_file',
    'Replace an exact substring in a file. old_string must be unique unless replace_all is true.',
    {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    ['path', 'old_string', 'new_string']
  ),
  fn(
    'glob',
    'Find files by glob relative to the workspace (e.g. **/*.ts). Ignores node_modules, .git, dist, target.',
    {
      pattern: { type: 'string' },
    },
    ['pattern']
  ),
  fn(
    'grep',
    'Search file contents for a regex or literal string. Returns path:line:text.',
    {
      pattern: { type: 'string', description: 'JavaScript regex (no surrounding slashes)' },
      path: { type: 'string', description: 'Subdirectory or file to search (default workspace root)' },
      glob: { type: 'string', description: 'Optional file glob filter, e.g. *.js' },
      case_insensitive: { type: 'boolean' },
    },
    ['pattern']
  ),
  fn(
    'list_dir',
    'List a directory (names only). Hidden and ignored directories are skipped except the listing itself.',
    {
      path: { type: 'string', description: 'Directory relative to the workspace (default .)' },
    },
    []
  ),
  fn(
    'todo_write',
    'Replace the in-memory task list for this session. Use for multi-step work.',
    {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', description: 'pending | in_progress | completed' },
          },
          required: ['content', 'status'],
        },
      },
    },
    ['items']
  ),
  fn(
    'web_search',
    'Search the public web. Use for live docs, current events, and anything not in this workspace.',
    {
      query: { type: 'string', description: 'Search query' },
    },
    ['query']
  ),
  fn(
    'web_fetch',
    'GET a public http(s) URL and return text. HTML is stripped to readable text. Use after web_search or when the user names a page.',
    {
      url: { type: 'string', description: 'Full http(s) URL' },
    },
    ['url']
  ),
];

function clip(text, max = MAX_TOOL_CHARS) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… truncated (${s.length} chars)`;
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function interruptedError(message = 'Interrupted') {
  return Object.assign(new Error(message), { interrupted: true });
}

function stopChild(child) {
  if (!child?.pid || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function runBash({ command, timeout_ms }, cwd, signal) {
  const timeout = Math.min(Math.max(Number(timeout_ms) || 120_000, 1000), 300_000);
  const isWin = process.platform === 'win32';
  if (signal?.aborted) {
    return Promise.reject(interruptedError());
  }

  const child = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', command], {
        cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn('/bin/bash', ['-c', command], {
        cwd,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn();
    };

    const onAbort = () => {
      stopChild(child);
      finish(() => reject(interruptedError()));
    };

    const timer = setTimeout(() => {
      stopChild(child);
    }, timeout);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });

    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
      if (stdout.length > MAX_TOOL_CHARS * 2) stdout = stdout.slice(-MAX_TOOL_CHARS);
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
      if (stderr.length > MAX_TOOL_CHARS) stderr = stderr.slice(-MAX_TOOL_CHARS);
    });
    child.on('close', (code, sig) => {
      finish(() =>
        resolve(
          clip(
            [
              `exit ${code}${sig ? ` signal=${sig}` : ''}`,
              stdout ? `stdout:\n${stdout}` : 'stdout: (empty)',
              stderr ? `stderr:\n${stderr}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          )
        )
      );
    });
    child.on('error', (err) => {
      finish(() => resolve(`failed to spawn shell: ${err.message}`));
    });
  });
}

function readFileTool(args, cwd) {
  const { abs } = resolveWorkspacePath(cwd, args.path);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error(`Not a file: ${args.path}`);
  if (st.size > MAX_READ_BYTES) {
    throw new Error(`File is ${st.size} bytes; read a slice with offset/limit, or use grep.`);
  }
  const buf = fs.readFileSync(abs);
  if (looksBinary(buf)) throw new Error('Binary file; not shown.');
  const lines = buf.toString('utf8').split('\n');
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Number(args.limit) > 0 ? Math.max(1, Number(args.limit)) : DEFAULT_READ_LINES;
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = slice.map((line, i) => `${String(offset + i).padStart(6)}|${line}`).join('\n');
  return clip(`${args.path} (${lines.length} lines)\n${numbered}`);
}

function writeFileTool(args, cwd) {
  const { abs } = resolveWorkspacePath(cwd, args.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(args.content ?? ''), 'utf8');
  return `Wrote ${args.path} (${String(args.content ?? '').length} chars)`;
}

function editFileTool(args, cwd) {
  const { abs } = resolveWorkspacePath(cwd, args.path);
  const before = fs.readFileSync(abs, 'utf8');
  const after = applyEdit(before, args.old_string, args.new_string, {
    replaceAll: Boolean(args.replace_all),
  });
  fs.writeFileSync(abs, after, 'utf8');
  return `Edited ${args.path}`;
}

function globTool(args, cwd) {
  const re = globToRegExp(args.pattern || '*');
  const files = walkFiles(cwd, { maxFiles: 8000 });
  const hits = [];
  for (const abs of files) {
    const rel = path.relative(cwd, abs).replaceAll('\\', '/');
    if (re.test(rel) || re.test(path.basename(rel))) hits.push(rel);
    if (hits.length >= MAX_GLOB_HITS) break;
  }
  return hits.length ? hits.join('\n') : '(no matches)';
}

function grepTool(args, cwd) {
  const flags = args.case_insensitive ? 'i' : '';
  let re;
  try {
    re = new RegExp(String(args.pattern), flags);
  } catch (err) {
    throw new Error(`Invalid regex: ${err.message}`);
  }
  const start = args.path
    ? resolveWorkspacePath(cwd, args.path).abs
    : cwd;
  const fileGlob = args.glob ? globToRegExp(args.glob) : null;
  const st = fs.existsSync(start) ? fs.statSync(start) : null;
  if (!st) throw new Error(`Path not found: ${args.path || '.'}`);
  const files = st.isFile() ? [start] : walkFiles(start, { maxFiles: 4000 });
  const hits = [];
  for (const abs of files) {
    const rel = path.relative(cwd, abs).replaceAll('\\', '/');
    if (fileGlob && !fileGlob.test(rel) && !fileGlob.test(path.basename(rel))) continue;
    let text;
    try {
      const buf = fs.readFileSync(abs);
      if (looksBinary(buf)) continue;
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!re.test(lines[i])) continue;
      hits.push(`${rel}:${i + 1}:${lines[i]}`);
      if (hits.length >= MAX_GREP_HITS) {
        return clip(`${hits.join('\n')}\n… hit limit ${MAX_GREP_HITS}`);
      }
    }
  }
  return hits.length ? hits.join('\n') : '(no matches)';
}

function listDirTool(args, cwd) {
  const { abs } = resolveWorkspacePath(cwd, args.path || '.');
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ent) => {
      const tag = ent.isDirectory() ? '/' : ent.isSymbolicLink() ? '@' : '';
      return `${ent.name}${tag}`;
    });
  return lines.length ? lines.join('\n') : '(empty)';
}

export function createToolRunner({ cwd, permissions, todos, signal } = {}) {
  return async function runTool(call) {
    const name = call.function?.name || call.name;
    const args = parseArgs(call.function?.arguments ?? call.arguments);
    const summary =
      name === 'bash'
        ? args.command || '(empty command)'
        : name === 'edit_file' || name === 'write_file' || name === 'read_file'
          ? args.path || ''
          : JSON.stringify(args).slice(0, 180);

    try {
      if (signal?.aborted) throw interruptedError();
      const ok = await permissions.approve(name, summary);
      if (signal?.aborted) throw interruptedError();
      if (!ok) return `Denied by user: ${name}`;

      let out;
      switch (name) {
        case 'bash':
          if (!args.command) throw new Error('command is required');
          out = await runBash(args, cwd, signal);
          break;
        case 'read_file':
          out = readFileTool(args, cwd);
          break;
        case 'write_file':
          out = writeFileTool(args, cwd);
          break;
        case 'edit_file':
          out = editFileTool(args, cwd);
          break;
        case 'glob':
          out = globTool(args, cwd);
          break;
        case 'grep':
          out = grepTool(args, cwd);
          break;
        case 'list_dir':
          out = listDirTool(args, cwd);
          break;
        case 'todo_write': {
          const items = Array.isArray(args.items) ? args.items : [];
          todos.splice(0, todos.length, ...items);
          out =
            items.map((t) => `- [${t.status || 'pending'}] ${t.content}`).join('\n') ||
            '(empty list)';
          break;
        }
        case 'web_search':
          if (!args.query) throw new Error('query is required');
          out = await webSearchTool(args, { signal });
          break;
        case 'web_fetch':
          if (!args.url) throw new Error('url is required');
          out = await webFetchTool(args, { signal });
          break;
        default:
          out = `Unknown tool: ${name}`;
      }
      return clip(out);
    } catch (err) {
      if (err?.interrupted || signal?.aborted) throw interruptedError(err?.message);
      return `Error: ${err?.message || String(err)}`;
    }
  };
}

export function toolSummary(call) {
  const name = call.function?.name || 'tool';
  const args = parseArgs(call.function?.arguments);
  if (name === 'bash') return `bash  ${args.command || ''}`.trim();
  if (name === 'web_search') return `web_search  ${args.query || ''}`.trim();
  if (name === 'web_fetch') return `web_fetch  ${args.url || ''}`.trim();
  if (args.path) return `${name}  ${args.path}`;
  if (args.pattern) return `${name}  ${args.pattern}`;
  return name;
}

export function toolsPrompt() {
  const listed = TOOL_DEFS.map((t) => `${t.function.name}: ${String(t.function.description || '').split('.')[0]}`);
  return [
    'You have OpenAI function tools on this request (including web_search and web_fetch). Call them with tool_calls (function name + JSON arguments). Do not print a tutorial about the tools.',
    'Prefer tools over guessing. Use glob/list_dir/grep, then read_file in slices. Use web_search and web_fetch for live pages.',
    'After a tool result, either call the next tool or answer with the result. Never stop at "I will now…" or "let me create…".',
    'If a template cannot emit native tool_calls, a <tool_call>{"name":"TOOL_NAME","arguments":{}}</tool_call> block is also accepted.',
    listed.length ? `Tools: ${listed.map((row) => row.split(':')[0]).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function toolsBlock() {
  const rows = TOOL_DEFS.map((t) => {
    const name = t.function.name;
    const desc = String(t.function.description || '').split('.')[0];
    return [name, desc];
  });
  const w = Math.max(...rows.map((r) => r[0].length));
  return [
    'The model can call these tools while it works. Ask in the chat.',
    '',
    ...rows.map(([name, desc]) => `${name.padEnd(w)}  ${desc}`),
  ].join('\n');
}
