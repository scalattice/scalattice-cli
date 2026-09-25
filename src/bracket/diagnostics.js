import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 40_000;
const MAX = 4000;

function exists(cwd, rel) {
  return fs.existsSync(path.join(cwd, rel));
}

function run(command, cwd, signal) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, TIMEOUT_MS);
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const take = (d) => {
      out += d.toString('utf8');
      if (out.length > MAX * 2) out = out.slice(-MAX);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve({ command, code: code ?? 1, out: out.trim().slice(0, MAX) });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ command, code: 1, out: err.message });
    });
  });
}

export async function runDiagnostics(cwd, { signal } = {}) {
  const root = path.resolve(cwd || '.');
  const jobs = [];
  if (exists(root, 'tsconfig.json')) {
    jobs.push(run('npx --yes tsc --noEmit --pretty false', root, signal));
  }
  if (
    exists(root, 'eslint.config.js') ||
    exists(root, 'eslint.config.mjs') ||
    exists(root, '.eslintrc.js') ||
    exists(root, '.eslintrc.cjs') ||
    exists(root, '.eslintrc.json')
  ) {
    jobs.push(run('npx --yes eslint . --max-warnings 0', root, signal));
  }
  if (!jobs.length) {
    return 'No tsconfig.json or eslint config in this workspace.';
  }
  const rows = await Promise.all(jobs);
  return rows
    .map((r) => `$ ${r.command}\nexit ${r.code}${r.out ? `\n${r.out}` : ''}`)
    .join('\n\n');
}
