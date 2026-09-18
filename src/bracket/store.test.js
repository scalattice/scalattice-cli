import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

function withDataDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-chats-'));
  const prev = process.env.SCALATTICE_DATA_DIR;
  process.env.SCALATTICE_DATA_DIR = dir;
  return fn(dir).finally(() => {
    if (prev == null) delete process.env.SCALATTICE_DATA_DIR;
    else process.env.SCALATTICE_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('saves, lists, switches, and forgets chats', async () => {
  await withDataDir(async () => {
    const {
      saveSession,
      listSessions,
      loadLastSession,
      resolveSessionRef,
      deleteSession,
      formatSessionList,
      titleFromMessages,
      contentText,
    } = await import('./session.js');

    assert.equal(titleFromMessages([{ role: 'user', content: 'fix the tests please' }]), 'fix the tests please');
    assert.equal(contentText({ role: 'user', content: [{ type: 'text', text: 'hi' }] }), 'hi');

    const a = saveSession({
      cwd: '/tmp/ws-a',
      model: 'qwen-3-coder-30b-a3b',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'fix the failing tests' },
        { role: 'assistant', content: 'done' },
      ],
    });
    assert.match(a.id, /^c/);
    assert.equal(a.title, 'fix the failing tests');
    const last = loadLastSession('/tmp/ws-a');
    assert.equal(last.id, a.id);

    const b = saveSession({
      cwd: '/tmp/ws-a',
      model: 'qwen-3-8b',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'add streaming' },
      ],
    });
    const listed = listSessions({ cwd: '/tmp/ws-a' });
    assert.equal(listed[0].id, b.id);
    assert.equal(listed.length, 2);

    const byNum = resolveSessionRef('2', { cwd: '/tmp/ws-a' });
    assert.equal(byNum.session.id, a.id);
    const byTitle = resolveSessionRef('streaming', { cwd: '/tmp/ws-a' });
    assert.equal(byTitle.session.id, b.id);

    const text = formatSessionList(listed, b.id);
    assert.match(text, /\* *1/);
    assert.match(text, /add streaming/);
    assert.doesNotMatch(text, /[\u2014\u2013]/);

    assert.equal(deleteSession(a.id), true);
    assert.equal(listSessions({ cwd: '/tmp/ws-a' }).length, 1);
    assert.equal(loadLastSession('/tmp/ws-a').id, b.id);
  });
});
