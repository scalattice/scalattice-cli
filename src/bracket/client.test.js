import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeHttpError, looksLikeHtmlError } from './client.js';

const CF524 = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie"> <![endif]-->
<title>scalattice.cloud | 524: A timeout occurred</title>
<body><div id="cf-wrapper">`;

test('Cloudflare HTML is not dumped into the error line', () => {
  assert.equal(looksLikeHtmlError(CF524), true);
  const msg = describeHttpError(524, 'https://api.scalattice.cloud/v1/chat/completions', CF524);
  assert.match(msg, /API 524/);
  assert.match(msg, /Cloudflare 524/);
  assert.match(msg, /timed out before the first token/);
  assert.doesNotMatch(msg, /DOCTYPE/);
  assert.doesNotMatch(msg, /cf-wrapper/);
  assert.doesNotMatch(msg, /\[if lt IE/);
});

test('JSON API errors still show the server message', () => {
  const msg = describeHttpError(
    401,
    'https://api.scalattice.cloud/v1/chat/completions',
    JSON.stringify({ error: { message: 'Incorrect API key provided' } })
  );
  assert.match(msg, /Incorrect API key provided/);
  assert.doesNotMatch(msg, /Cloudflare/);
});
