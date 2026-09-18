import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdit } from './edit.js';
import { globToRegExp, resolveWorkspacePath } from './paths.js';
import { parseFallbackToolCalls } from './xmlTools.js';

test('applyEdit replaces a unique string', () => {
  assert.equal(applyEdit('foo bar foo', 'bar', 'baz'), 'foo baz foo');
});

test('applyEdit refuses a non-unique string', () => {
  assert.throws(() => applyEdit('foo foo', 'foo', 'bar'), /more than once/);
});

test('applyEdit replace_all', () => {
  assert.equal(applyEdit('foo foo', 'foo', 'bar', { replaceAll: true }), 'bar bar');
});

test('resolveWorkspacePath blocks escape', () => {
  assert.throws(() => resolveWorkspacePath('/tmp/ws', '../etc/passwd'), /escapes workspace/);
});

test('resolveWorkspacePath allows inside', () => {
  const r = resolveWorkspacePath('/tmp/ws', 'src/index.js');
  assert.equal(r.outside, false);
  assert.match(r.abs, /src\/index\.js$/);
});

test('glob **/*.js', () => {
  const re = globToRegExp('**/*.js');
  assert.ok(re.test('src/foo.js'));
  assert.ok(re.test('foo.js'));
  assert.ok(!re.test('src/foo.ts'));
});

test('parse Qwen-style tool XML', () => {
  const calls = parseFallbackToolCalls(`
<tool_call>
<function=bash>
<parameter=command>
ls -la
</parameter>
</function>
</tool_call>
`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'bash');
  assert.equal(JSON.parse(calls[0].function.arguments).command, 'ls -la');
});

test('parse JSON tool_call block', () => {
  const calls = parseFallbackToolCalls(
    '<tool_call>{"name":"read_file","arguments":{"path":"README.md"}}</tool_call>'
  );
  assert.equal(calls[0].function.name, 'read_file');
  assert.equal(JSON.parse(calls[0].function.arguments).path, 'README.md');
});
