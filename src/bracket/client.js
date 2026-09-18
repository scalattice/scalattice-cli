import { parseFallbackToolCalls } from './xmlTools.js';

function apiError(res, data) {
  const msg =
    data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
  const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  err.status = res.status;
  err.data = data;
  return err;
}

async function parseJsonBody(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 400) };
  }
}

function emptyAssistant() {
  return { role: 'assistant', content: '', tool_calls: [] };
}

function mergeToolDelta(message, deltaCalls) {
  if (!Array.isArray(deltaCalls)) return;
  for (const part of deltaCalls) {
    const idx = Number.isInteger(part.index) ? part.index : message.tool_calls.length;
    if (!message.tool_calls[idx]) {
      message.tool_calls[idx] = {
        id: part.id || `call_${idx + 1}`,
        type: 'function',
        function: { name: part.function?.name || '', arguments: '' },
      };
    }
    const slot = message.tool_calls[idx];
    if (part.id) slot.id = part.id;
    if (part.function?.name) slot.function.name += part.function.name;
    if (part.function?.arguments) slot.function.arguments += part.function.arguments;
  }
}

function finalizeAssistant(message) {
  const tool_calls = (message.tool_calls || []).filter((c) => c && c.function?.name);
  if (!tool_calls.length) {
    const fallback = parseFallbackToolCalls(message.content);
    if (fallback.length) {
      return { role: 'assistant', content: message.content || '', tool_calls: fallback };
    }
    return { role: 'assistant', content: message.content || '' };
  }
  const out = { role: 'assistant', content: message.content || null, tool_calls };
  if (!out.content) out.content = null;
  return out;
}

async function readSse(res, { onDelta, signal } = {}) {
  const message = emptyAssistant();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) throw new Error('Aborted');
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n');
    buf = chunks.pop() || '';
    for (const line of chunks) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        message.content += delta.content;
        onDelta?.(delta.content);
      }
      if (delta.tool_calls) mergeToolDelta(message, delta.tool_calls);
    }
  }
  return finalizeAssistant(message);
}

/** OpenAI-compatible chat completions against Scalattice `/v1`. */
export async function chatCompletion({
  apiUrl,
  apiKey,
  messages,
  tools,
  model,
  stream = true,
  temperature = 0.2,
  max_tokens = 8192,
  signal,
  onDelta,
} = {}) {
  const base = String(apiUrl || '').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages,
    temperature,
    max_tokens,
    stream,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw apiError(res, await parseJsonBody(res));
  }

  if (stream && res.body) {
    return readSse(res, { onDelta, signal });
  }

  const data = await parseJsonBody(res);
  const choice = data.choices?.[0]?.message || {};
  return finalizeAssistant({
    role: 'assistant',
    content: choice.content || '',
    tool_calls: choice.tool_calls || [],
  });
}

export async function listModelIds({ apiUrl, apiKey, signal } = {}) {
  const base = String(apiUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal,
  });
  const data = await parseJsonBody(res);
  if (!res.ok) throw apiError(res, data);
  const rows = data.data || data.models || [];
  return rows.map((m) => m.id || m.name).filter(Boolean);
}
