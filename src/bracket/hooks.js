import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 45_000;
const MAX_CHARS = 2500;

function readHooksConfig(cwd) {
  const abs = path.join(path.resolve(cwd || '.'), '.scalattice', 'hooks.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function commandsFor(cfg, event) {
  const raw = cfg?.[event];
  if (!raw) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [];
}

function runOne(command, cwd, signal) {
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
      if (out.length > MAX_CHARS * 2) out = out.slice(-MAX_CHARS);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve({ command, code: code ?? 1, out: out.trim().slice(0, MAX_CHARS) });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve({ command, code: 1, out: err.message });
    });
  });
}

export async function runHooks(event, { cwd, signal } = {}) {
  const cmds = commandsFor(readHooksConfig(cwd), event);
  if (!cmds.length) return '';
  const rows = [];
  for (const command of cmds) {
    const r = await runOne(command, cwd, signal);
    rows.push(`hook ${event} \`${command}\` exit ${r.code}${r.out ? `\n${r.out}` : ''}`);
    if (signal?.aborted) break;
  }
  return rows.join('\n');
}
