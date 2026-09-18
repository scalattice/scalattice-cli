import { routingHeaders } from './settings.js';
import { applyThinkingTag, createThinkSplitter } from './think.js';

/** Config/init store OPENAI_BASE_URL including `/v1`. Accept that or a host origin. */
export function inferenceUrl(apiUrl, path) {
  let base = String(apiUrl || 'https://api.scalattice.cloud/v1').replace(/\/+$/, '');
  if (!/\/v1$/i.test(base)) base += '/v1';
  const suffix = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^v1\//i, '');
  return `${base}/${suffix}`;
}

function emitDelta(onDelta, part) {
  if (!onDelta || !part?.text) return;
  onDelta(part);
}

async function readSse(res, { onDelta, signal } = {}) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  const toolAcc = new Map();
  const splitter = createThinkSplitter();
  let sawDone = false;

  const takeParts = (parts) => {
    for (const part of parts) {
      if (part.type === 'thinking') reasoning += part.text;
      else content += part.text;
      emitDelta(onDelta, part);
    }
  };

  const consumeData = (data) => {
    const line = data.trim();
    if (!line || line === '[DONE]') {
      if (line === '[DONE]') sawDone = true;
      return;
    }
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const err = json.error?.message || json.error;
    if (err && typeof err === 'string') throw new Error(err);
    const choice = json.choices?.[0] || {};
    const delta = choice.delta || {};
    if (delta.reasoning_content) takeParts(splitter.pushThinking(delta.reasoning_content));
    else if (delta.reasoning) takeParts(splitter.pushThinking(delta.reasoning));
    if (delta.content) takeParts(splitter.push(delta.content));
    const finish = choice.message;
    if (finish?.reasoning_content && !delta.reasoning_content) {
      takeParts(splitter.pushThinking(finish.reasoning_content));
    }
    if (finish?.content && !delta.content) takeParts(splitter.push(finish.content));
    const tcs = delta.tool_calls || [];
    for (const tc of tcs) {
      const idx = tc.index ?? 0;
      const cur = toolAcc.get(idx) || {
        id: tc.id || `call_${idx}`,
        type: 'function',
        function: { name: '', arguments: '' },
      };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      toolAcc.set(idx, cur);
    }
  };

  while (true) {
    if (signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error('aborted');
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() || '';
    for (const raw of parts) {
      const line = raw.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      consumeData(line.slice(5));
    }
  }
  if (buf.trim().startsWith('data:')) consumeData(buf.trim().slice(5));
  takeParts(splitter.flush());

  const tool_calls = [...toolAcc.values()].filter((t) => t.function.name);
  if (!content && !tool_calls.length && !reasoning && !sawDone) {
    throw new Error('empty stream');
  }
  const msg = { role: 'assistant', content: content || null };
  if (tool_calls.length) msg.tool_calls = tool_calls;
  if (reasoning) msg.reasoning_content = reasoning;
  return msg;
}

export async function chatCompletion({
  apiUrl,
  apiKey,
  messages,
  tools,
  model,
  stream = true,
  thinking = true,
  settings,
  temperature = 0.2,
  max_tokens = 8192,
  signal,
  onDelta,
} = {}) {
  const useStream = settings?.stream !== undefined ? settings.stream !== false : stream !== false;
  const useThink = settings?.thinking !== undefined ? settings.thinking !== false : thinking !== false;
  const body = {
    model,
    messages: applyThinkingTag(messages, useThink),
    temperature,
    max_tokens,
    stream: useStream,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const url = inferenceUrl(apiUrl, '/chat/completions');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: useStream ? 'text/event-stream' : 'application/json',
      ...routingHeaders({ ...(settings || {}), stream: useStream }),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t.slice(0, 800);
    try {
      const j = JSON.parse(t);
      msg = j.error?.message || j.message || msg;
    } catch {
      /* keep */
    }
    throw new Error(`API ${res.status} ${url}: ${msg}`);
  }
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (useStream && res.body && (ctype.includes('event-stream') || ctype.includes('octet-stream') || !ctype.includes('json'))) {
    return readSse(res, { onDelta, signal });
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error('empty completion');
  const splitter = createThinkSplitter();
  const parts = [
    ...(msg.reasoning_content ? splitter.pushThinking(msg.reasoning_content) : []),
    ...(msg.reasoning ? splitter.pushThinking(msg.reasoning) : []),
    ...(msg.content ? splitter.push(msg.content) : []),
    ...splitter.flush(),
  ];
  let content = '';
  let reasoning = '';
  for (const part of parts) {
    if (part.type === 'thinking') reasoning += part.text;
    else content += part.text;
    emitDelta(onDelta, part);
  }
  const out = { ...msg, content: content || msg.content || null };
  if (reasoning) out.reasoning_content = reasoning;
  return out;
}

export async function listModels({ apiUrl, apiKey } = {}) {
  const res = await fetch(inferenceUrl(apiUrl, '/models'), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((m) => m.id).filter(Boolean);
}

export async function listModelIds(opts) {
  return listModels(opts);
}
