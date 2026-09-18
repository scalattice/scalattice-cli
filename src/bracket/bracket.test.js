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

test('default settings stream and think with compatible headers', async () => {
  const { defaultSettings, routingHeaders, patchSettings, settingsLine } = await import('./settings.js');
  const empty = {};
  const s = defaultSettings({}, empty);
  assert.equal(s.stream, true);
  assert.equal(s.thinking, true);
  assert.deepEqual(routingHeaders(s), {
    'X-Scalattice-Region': 'auto',
    'X-Scalattice-Vet-Replicas': '1',
    'X-Scalattice-Security': 'tier1',
  });
  assert.match(settingsLine(s), /stream · think · auto · vet 1 · tier1/);

  const vet2 = defaultSettings({ vet: 2 }, empty);
  assert.equal(vet2.stream, false);
  assert.equal(vet2.vet, 2);
  assert.equal(routingHeaders(vet2)['X-Scalattice-Vet-Replicas'], '2');

  const streamWins = defaultSettings({ stream: true, vet: 2 }, empty);
  assert.equal(streamWins.stream, true);
  assert.equal(streamWins.vet, 1);

  const off = patchSettings(s, { stream: false, security: 'tier2.5' });
  assert.equal(off.stream, false);
  assert.equal(off.security, 'tier2.5');
});

test('slash help explains one command and settings are labeled', async () => {
  const { slashHelp, slashIndex, settingsBlock } = await import('./slash.js');
  const index = slashIndex();
  assert.match(index, /\/help \[command\]/);
  assert.match(index, /\/settings/);
  assert.match(index, /\/region/);

  const stream = slashHelp('stream', { stream: true, thinking: true, region: 'auto', vet: 1, security: 'tier1' });
  assert.match(stream, /\/stream \[on\|off\]/);
  assert.match(stream, /Now: on/);
  assert.match(stream, /vet 1/);
  assert.match(stream, /tier1/);

  const region = slashHelp('region', { region: 'eu' });
  assert.match(region, /Now: eu/);
  assert.match(region, /auto\|us\|eu\|ap/);

  const unknown = slashHelp('nope');
  assert.match(unknown, /No help for \/nope/);
  assert.match(unknown, /\/help/);

  const block = settingsBlock({
    stream: true,
    thinking: true,
    region: 'auto',
    vet: 1,
    security: 'tier1',
  });
  assert.match(block, /Inference settings/);
  assert.match(block, /Stream\s+on/);
  assert.match(block, /Thinking\s+on/);
  assert.match(block, /Region\s+auto/);
  assert.match(block, /Vet\s+1/);
  assert.match(block, /Security\s+tier1/);
  assert.doesNotMatch(block, /stream · think · auto/);
});

test('thinking tag is applied to the last user turn only', async () => {
  const { applyThinkingTag } = await import('./think.js');
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'two /no_think' },
  ];
  const on = applyThinkingTag(msgs, true);
  assert.equal(on[1].content, 'one');
  assert.equal(on[3].content, 'two\n/think');
  assert.equal(msgs[3].content, 'two /no_think');
  const off = applyThinkingTag(msgs, false);
  assert.equal(off[3].content, 'two\n/no_think');
});

test('think splitter holds partial tags and splits reasoning', async () => {
  const { createThinkSplitter } = await import('./think.js');
  const s = createThinkSplitter();
  const a = s.push('<thi');
  assert.deepEqual(a, []);
  const b = s.push('nk>plan</th');
  assert.deepEqual(b, [{ type: 'thinking', text: 'plan' }]);
  const c = s.push('ink>answer');
  assert.deepEqual(c, [{ type: 'content', text: 'answer' }]);
  assert.deepEqual(s.pushThinking(' extra'), [{ type: 'thinking', text: ' extra' }]);
});

test('inferenceUrl does not double /v1', async () => {
  const { inferenceUrl } = await import('./client.js');
  assert.equal(
    inferenceUrl('https://api.scalattice.cloud/v1', '/v1/chat/completions'),
    'https://api.scalattice.cloud/v1/chat/completions'
  );
  assert.equal(
    inferenceUrl('https://api.scalattice.cloud/v1', '/chat/completions'),
    'https://api.scalattice.cloud/v1/chat/completions'
  );
  assert.equal(
    inferenceUrl('https://api.scalattice.cloud', 'models'),
    'https://api.scalattice.cloud/v1/models'
  );
});

test('chatCompletion streams by default and sends native headers', async () => {
  const { chatCompletion } = await import('./client.js');
  const orig = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'plan' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const parts = [];
    const msg = await chatCompletion({
      apiUrl: 'https://api.example',
      apiKey: 'slt_x',
      model: 'qwen',
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: (p) => parts.push(p),
    });
    const body = JSON.parse(captured.opts.body);
    assert.equal(captured.url, 'https://api.example/v1/chat/completions');
    assert.equal(body.stream, true);
    assert.match(body.messages.at(-1).content, /\/think$/);
    assert.equal(captured.opts.headers['X-Scalattice-Vet-Replicas'], '1');
    assert.equal(captured.opts.headers['X-Scalattice-Security'], 'tier1');
    assert.equal(captured.opts.headers['X-Scalattice-Region'], 'auto');
    assert.equal(msg.content, 'hi');
    assert.equal(msg.reasoning_content, 'plan');
    assert.deepEqual(
      parts.map((p) => p.type),
      ['thinking', 'content']
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('local logo SVG rasterizes to a braille mark', async () => {
  const { logoBraille, logoCellWidth, LOGO_URL, loadLogoSvg } = await import('./logo.js');
  assert.match(LOGO_URL, /scalattice\.com\/resources\/logos\/scalattice\/logo-light-noword\.svg/);
  assert.match(loadLogoSvg(), /<path /);
  const lines = logoBraille({ width: 12, height: 12, color: false });
  assert.equal(lines.length, 3);
  assert.equal(logoCellWidth(lines), 6);
  assert.match(lines.join('\n'), /[\u2800-\u28FF]/);
});
