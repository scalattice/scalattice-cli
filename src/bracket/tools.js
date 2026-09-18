import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { applyEdit } from './edit.js';
import { globToRegExp, looksBinary, resolveWorkspacePath, walkFiles } from './paths.js';

const MAX_READ_BYTES = 512 * 1024;
const MAX_TOOL_CHARS = 80_000;
const MAX_GREP_HITS = 80;

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
    'Read a text file. Use offset/limit for large files (1-based line numbers).',
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

function runBash({ command, timeout_ms }, cwd) {
  const timeout = Math.min(Math.max(Number(timeout_ms) || 120_000, 1000), 300_000);
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd, env: process.env })
    : spawn('/bin/bash', ['-lc', command], { cwd, env: process.env });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeout);
    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
      if (stdout.length > MAX_TOOL_CHARS * 2) stdout = stdout.slice(-MAX_TOOL_CHARS);
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
      if (stderr.length > MAX_TOOL_CHARS) stderr = stderr.slice(-MAX_TOOL_CHARS);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(
        clip(
          [
            `exit ${code}${signal ? ` signal=${signal}` : ''}`,
            stdout ? `stdout:\n${stdout}` : 'stdout: (empty)',
            stderr ? `stderr:\n${stderr}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        )
      );
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`failed to spawn shell: ${err.message}`);
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
  const limit = Math.max(1, Number(args.limit) || lines.length);
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
    if (hits.length >= 200) break;
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

export function createToolRunner({ cwd, permissions, todos }) {
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
      const ok = await permissions.approve(name, summary);
      if (!ok) return `Denied by user: ${name}`;

      switch (name) {
        case 'bash':
          if (!args.command) throw new Error('command is required');
          return await runBash(args, cwd);
        case 'read_file':
          return readFileTool(args, cwd);
        case 'write_file':
          return writeFileTool(args, cwd);
        case 'edit_file':
          return editFileTool(args, cwd);
        case 'glob':
          return globTool(args, cwd);
        case 'grep':
          return grepTool(args, cwd);
        case 'list_dir':
          return listDirTool(args, cwd);
        case 'todo_write': {
          const items = Array.isArray(args.items) ? args.items : [];
          todos.splice(0, todos.length, ...items);
          return items
            .map((t) => `- [${t.status || 'pending'}] ${t.content}`)
            .join('\n') || '(empty list)';
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      return `Error: ${err?.message || String(err)}`;
    }
  };
}

export function toolSummary(call) {
  const name = call.function?.name || 'tool';
  const args = parseArgs(call.function?.arguments);
  if (name === 'bash') return `bash  ${args.command || ''}`.trim();
  if (args.path) return `${name}  ${args.path}`;
  if (args.pattern) return `${name}  ${args.pattern}`;
  return name;
}
