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

test('read_file defaults to a slice not the whole file', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createToolRunner } = await import('./tools.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bracket-read-'));
  fs.writeFileSync(
    path.join(dir, 'big.txt'),
    Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join('\n')
  );
  const run = createToolRunner({
    cwd: dir,
    permissions: { approve: async () => true },
    todos: [],
  });
  const out = await run({ function: { name: 'read_file', arguments: '{"path":"big.txt"}' } });
  assert.match(out, /400 lines/);
  assert.match(out, /line 160/);
  assert.doesNotMatch(out, /line 200/);
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

test('parse function/parameters JSON dumps without dropping later calls', () => {
  const calls = parseFallbackToolCalls(`
\`\`\`json
// Search for "error" in .js files
{
  "function": "grep",
  "parameters": {
    "pattern": "error",
    "glob": "*.js"
  }
}

// List directory contents
{
  "function": "list_dir",
  "parameters": {
    "path": "src"
  }
}

{
  "function": "todo_write",
  "parameters": {
    "items": [{ "id": "1", "content": "Fix login bug", "status": "in_progress" }]
  }
}
\`\`\`
`);
  assert.equal(calls.map((c) => c.function.name).join(','), 'grep,list_dir,todo_write');
  assert.equal(JSON.parse(calls[0].function.arguments).pattern, 'error');
  assert.equal(JSON.parse(calls[1].function.arguments).path, 'src');
  assert.equal(JSON.parse(calls[2].function.arguments).items[0].id, '1');
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
  assert.match(settingsLine(s), /stream on · think on · region auto · vet 1 · security tier1/);

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
  assert.match(index, /\/tools/);
  assert.match(slashHelp('tools'), /Ask in the chat/);
  assert.doesNotMatch(index, /\/bash/);
  assert.doesNotMatch(index, /\/search/);

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
  assert.doesNotMatch(block, /[\u2014\u2013]/);
  assert.doesNotMatch(slashHelp('vet'), /[\u2014\u2013]/);
});

test('tab completes slash commands and arguments', async () => {
  const { completeSlash } = await import('./slash.js');
  const cmd = completeSlash('/se');
  assert.ok(cmd.matches.some((m) => m.startsWith('/settings')));
  assert.ok(cmd.matches.some((m) => m.startsWith('/security')));
  const stream = completeSlash('/st');
  assert.equal(stream.completed, '/stream ');
  const unique = completeSlash('/ex');
  assert.equal(unique.completed, '/exit ');
  const region = completeSlash('/region u');
  assert.ok(region.matches.some((m) => m.includes('us')));
  const onoff = completeSlash('/stream ');
  assert.deepEqual(
    onoff.matches.map((m) => m.trim()),
    ['/stream on', '/stream off']
  );
  const models = completeSlash('/model q', { models: ['qwen-3-8b', 'qwen-3-32b'] });
  assert.ok(models.matches.some((m) => m.includes('qwen-3-8b')));
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
  const afterTool = applyThinkingTag(
    [
      { role: 'user', content: 'search it' },
      { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'web_search' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'hits' },
    ],
    true
  );
  assert.equal(afterTool[0].content, 'search it\n/no_think');
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
      tools: [{ type: 'function', function: { name: 'grep' } }],
      onDelta: (p) => parts.push(p),
    });
    const body = JSON.parse(captured.opts.body);
    assert.equal(captured.url, 'https://api.example/v1/chat/completions');
    assert.equal(body.stream, true);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].function.name, 'grep');
    assert.equal(body.tool_choice, 'auto');
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

test('stream does not dump a trailing full message after deltas', async () => {
  const { chatCompletion } = await import('./client.js');
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {},
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'hi', reasoning_content: 'plan' },
          },
        ],
      })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const parts = [];
    const msg = await chatCompletion({
      apiUrl: 'https://api.example',
      apiKey: 'slt_x',
      model: 'qwen',
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: (p) => parts.push(p.text),
    });
    assert.equal(msg.content, 'hi');
    assert.equal(parts.join(''), 'hi');
  } finally {
    globalThis.fetch = orig;
  }
});

test('stream keeps tool_calls from the final message and incremental args', async () => {
  const { chatCompletion } = await import('./client.js');
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    const sse = [
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'grep', arguments: '' } }] } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pattern":' } }] } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {},
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'c1',
                  type: 'function',
                  function: { name: 'grep', arguments: '{"pattern":"x"}' },
                },
              ],
            },
          },
        ],
      })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const msg = await chatCompletion({
      apiUrl: 'https://api.example',
      apiKey: 'slt_x',
      model: 'qwen',
      messages: [{ role: 'user', content: 'find x' }],
    });
    assert.equal(msg.tool_calls.length, 1);
    assert.equal(msg.tool_calls[0].function.name, 'grep');
    assert.equal(msg.tool_calls[0].function.arguments, '{"pattern":"x"}');
  } finally {
    globalThis.fetch = orig;
  }
});

test('runLoop sends tools, runs streamed tool_calls, then posts tool results', async () => {
  const { runLoop } = await import('./loop.js');
  const orig = globalThis.fetch;
  const bodies = [];
  let n = 0;
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    n += 1;
    if (n === 1) {
      const sse = [
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_grep',
                    type: 'function',
                    function: { name: 'grep', arguments: '{"pattern":"x"}' },
                  },
                ],
              },
            },
          ],
        })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}`,
        'data: [DONE]',
        '',
      ].join('\n');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'found it' } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const ran = [];
    const out = await runLoop({
      apiUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'find x' }],
      tools: [{ type: 'function', function: { name: 'grep' } }],
      runTool: async (call) => {
        ran.push(call.function.name);
        return 'path:1:x';
      },
    });
    assert.equal(bodies[0].tools[0].function.name, 'grep');
    assert.equal(bodies[0].stream, true);
    assert.equal(ran[0], 'grep');
    assert.equal(bodies[1].messages.at(-1).role, 'tool');
    assert.equal(bodies[1].messages.at(-1).tool_call_id, 'call_grep');
    assert.equal(bodies[1].messages.at(-2).tool_calls[0].function.name, 'grep');
    assert.equal(out.reason, 'stop');
    assert.match(out.messages.at(-1).content, /found it/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('runLoop retries without thinking when a think-only turn is empty', async () => {
  const { runLoop } = await import('./loop.js');
  const orig = globalThis.fetch;
  const bodies = [];
  let n = 0;
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    n += 1;
    if (n === 1) {
      const sse = [
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'planning ' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}`,
        'data: [DONE]',
        '',
      ].join('\n');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const notes = [];
    const out = await runLoop({
      apiUrl: 'https://api.example/v1',
      apiKey: 'k',
      model: 'qwen',
      messages: [{ role: 'user', content: 'hi' }],
      onRetry: (m) => notes.push(m),
    });
    assert.equal(bodies.length, 2);
    assert.match(bodies[0].messages.at(-1).content, /\/think$/);
    assert.match(bodies[1].messages.at(-1).content, /\/no_think$/);
    assert.equal(notes.length, 1);
    assert.equal(out.reason, 'stop');
    assert.equal(out.messages.at(-1).content, 'hello');
  } finally {
    globalThis.fetch = orig;
  }
});

test('fitMessagesForContext drops early turns before the GPU window fills', async () => {
  const { estimateTokens, fitMessagesForContext, isContextOverflowError } = await import('./prompt.js');
  const tools = [{ type: 'function', function: { name: 'grep', description: 'search' } }];
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'a'.repeat(4000) },
    { role: 'assistant', content: 'b'.repeat(4000) },
    { role: 'user', content: 'c'.repeat(4000) },
    { role: 'assistant', content: 'd'.repeat(4000) },
    { role: 'user', content: 'latest' },
  ];
  const fitted = fitMessagesForContext(messages, { budget: 800, tools, keep: 4 });
  assert.ok(estimateTokens(fitted, tools) < estimateTokens(messages, tools));
  assert.equal(fitted[0].role, 'system');
  assert.match(fitted.at(-1).content, /latest/);
  assert.match(fitted.map((m) => m.content).join('\n'), /compacted/);
  assert.equal(
    isContextOverflowError(
      new Error('API 400: This model\'s maximum context length is 4096 tokens. Shorten the messages or reduce max_tokens.')
    ),
    true
  );
});

test('runLoop compacts and retries when the API rejects an oversize prompt', async () => {
  const { runLoop } = await import('./loop.js');
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (_url, opts) => {
    n += 1;
    const body = JSON.parse(opts.body);
    if (n === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              "This model's maximum context length is 4096 tokens. However, you requested 5559 tokens (4264 in the messages, 1295 in the completion). Shorten the messages or reduce max_tokens.",
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }
    assert.ok(body.messages.some((m) => String(m.content || '').includes('latest')));
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const notes = [];
    const out = await runLoop({
      apiUrl: 'https://api.example/v1',
      apiKey: 'k',
      model: 'qwen',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: `old essay ${'x'.repeat(9000)}` },
        { role: 'assistant', content: 'y'.repeat(9000) },
        { role: 'user', content: 'latest' },
      ],
      onRetry: (m) => notes.push(m),
    });
    assert.equal(n, 2);
    assert.ok(notes.some((m) => /compact|shrink/i.test(m)));
    assert.equal(out.messages.at(-1).content, 'ok');
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
