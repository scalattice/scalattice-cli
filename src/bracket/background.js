import { spawn } from 'node:child_process';

let seq = 1;

export function createBackgroundShells() {
  const jobs = new Map();

  function reap(id) {
    const job = jobs.get(id);
    if (!job) return;
    if (!job.done) return;
    /* keep finished jobs until awaited */
  }

  return {
    start(command, cwd, signal) {
      const id = `sh${seq}`;
      seq += 1;
      let stdout = '';
      let stderr = '';
      const child = spawn(command, {
        cwd,
        shell: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const job = { id, command, done: false, code: null, stdout: '', stderr: '', child };
      const take = (buf, which) => {
        const s = buf.toString('utf8');
        if (which === 'out') {
          stdout += s;
          if (stdout.length > 8000) stdout = stdout.slice(-8000);
          job.stdout = stdout;
        } else {
          stderr += s;
          if (stderr.length > 4000) stderr = stderr.slice(-4000);
          job.stderr = stderr;
        }
      };
      child.stdout?.on('data', (d) => take(d, 'out'));
      child.stderr?.on('data', (d) => take(d, 'err'));
      child.on('close', (code) => {
        job.done = true;
        job.code = code;
        reap(id);
      });
      child.on('error', (err) => {
        job.done = true;
        job.code = 1;
        job.stderr = err.message;
      });
      const onAbort = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      jobs.set(id, job);
      return id;
    },
    snapshot(id) {
      const job = jobs.get(id);
      if (!job) return `Unknown job ${id}`;
      return [
        `job ${job.id} ${job.done ? `exit ${job.code}` : 'running'}`,
        `command: ${job.command}`,
        job.stdout ? `stdout:\n${job.stdout}` : 'stdout: (empty)',
        job.stderr ? `stderr:\n${job.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
    list() {
      if (!jobs.size) return '(no background shells)';
      return [...jobs.values()]
        .map((j) => `${j.id}  ${j.done ? `exit ${j.code}` : 'running'}  ${j.command}`)
        .join('\n');
    },
    kill(id) {
      const job = jobs.get(id);
      if (!job) return `Unknown job ${id}`;
      try {
        job.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      return `signaled ${id}`;
    },
  };
}
