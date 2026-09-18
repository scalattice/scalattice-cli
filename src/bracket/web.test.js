import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertHttpUrl,
  htmlToText,
  isPrivateIp,
  parseDuckDuckGoHtml,
  webFetchTool,
} from './web.js';
import { TOOL_DEFS, toolsPrompt } from './tools.js';
import { parseFallbackToolCalls } from './xmlTools.js';

test('private IPs and localhost URLs are blocked', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.2'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.throws(() => assertHttpUrl('file:///etc/passwd'), /http/);
  assert.throws(() => assertHttpUrl('http://localhost/secret'), /Blocked host/);
  assert.throws(() => assertHttpUrl('http://127.0.0.1/'), /Blocked address/);
  assert.ok(assertHttpUrl('https://scalattice.com/cli/'));
});

test('htmlToText strips tags and scripts', () => {
  const text = htmlToText('<html><script>alert(1)</script><h1>Hi</h1><p>There</p></html>');
  assert.match(text, /Hi/);
  assert.match(text, /There/);
  assert.doesNotMatch(text, /alert/);
});

test('DuckDuckGo result parser reads titles and urls', () => {
  const html = `
    <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=${encodeURIComponent('https://scalattice.com/cli/')}">CLI docs</a>
    <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=${encodeURIComponent('https://scalattice.cloud/')}">Cloud</a>
  `;
  const hits = parseDuckDuckGoHtml(html);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].url, 'https://scalattice.com/cli/');
  assert.equal(hits[0].title, 'CLI docs');
});

test('web_fetch uses the mocked response and strips HTML', async () => {
  const out = await webFetchTool(
    { url: 'https://example.com/page' },
    {
      skipPublicDns: true,
      fetchImpl: async () =>
        new Response('<html><h1>Hello</h1><p>World</p></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    }
  );
  assert.match(out, /example.com\/page/);
  assert.match(out, /Hello/);
  assert.match(out, /World/);
  assert.doesNotMatch(out, /<h1>/);
});

test('tool catalog includes web_search and web_fetch', () => {
  const names = TOOL_DEFS.map((t) => t.function.name);
  assert.ok(names.includes('web_search'));
  assert.ok(names.includes('web_fetch'));
  assert.match(toolsPrompt(), /web_search/);
  assert.match(toolsPrompt(), /tool_call/);
  const calls = parseFallbackToolCalls(
    '<tool_call>{"name":"web_search","arguments":{"query":"scalattice api"}}</tool_call>'
  );
  assert.equal(calls[0].function.name, 'web_search');
});
