import { routingScalattice } from './settings.js';
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

const CF_EDGE = {
  520: 'Cloudflare 520: origin returned an unknown error.',
  521: 'Cloudflare 521: inference origin is down.',
  522: 'Cloudflare 522: could not connect to origin.',
  523: 'Cloudflare 523: origin is unreachable.',
  524: 'Cloudflare 524: origin timed out before the first token (long prompt or a slow GPU). Try a shorter request.',
};

export function looksLikeHtmlError(body) {
  const raw = String(body || '');
  return /<!DOCTYPE html/i.test(raw) || /<html[\s>]/i.test(raw) || /cf-error/i.test(raw);
}

/** Never dump Cloudflare/HTML error pages into the TUI. */
export function describeHttpError(status, url, body) {
  const n = Number(status) || 0;
  const raw = String(body || '');
  const html = looksLikeHtmlError(raw);
  let detail = '';
  if (!html) {
    try {
      const j = JSON.parse(raw);
      detail = String(j.error?.message || j.message || '').trim();
    } catch {
      detail = raw.replace(/\s+/g, ' ').trim().slice(0, 240);
    }
  }
  const edge = CF_EDGE[n] || (html ? `HTTP ${n}: gateway returned an HTML error page.` : '');
  const msg = [edge, detail].filter(Boolean).join(' ') || `HTTP ${n}`;
  return `API ${n} ${url}: ${msg}`;
}

function openaiMessages(messages) {
  return (messages || []).map((m) => {
    if (!m || typeof m !== 'object') return m;
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc, i) => ({
          id: String(tc.id || `call_${i + 1}`),
          type: 'function',
          function: {
            name: String(tc.function?.name || ''),
            arguments:
              typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || {}),
          },
        })),
      };
    }
    if (m.role === 'tool' || m.role === 'function') {
      return {
        role: 'tool',
        tool_call_id: String(m.tool_call_id || m.id || 'call_1'),
        content: String(m.content ?? ''),
      };
    }
    return m;
  });
}

function emitDelta(onDelta, part) {
  if (!onDelta || !part?.text) return;
  onDelta(part);
}

function mergeToolField(cur, next) {
  const a = String(cur || '');
  const b = String(next || '');
  if (!b) return a;
  if (!a) return b;
  if (a === b) return a;
  if (b.startsWith(a)) return b;
  if (a.startsWith(b)) return a;
  if (a.endsWith(b)) return a;
  return a + b;
}

function ingestToolCalls(toolAcc, tcs) {
  for (const tc of tcs || []) {
    if (!tc || typeof tc !== 'object') continue;
    const idx = tc.index ?? toolAcc.size;
    const cur = toolAcc.get(idx) || {
      id: tc.id || `call_${idx}`,
      type: 'function',
      function: { name: '', arguments: '' },
    };
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.function.name = mergeToolField(cur.function.name, tc.function.name);
    if (tc.function?.arguments != null && tc.function.arguments !== '') {
      const piece =
        typeof tc.function.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function.arguments);
      cur.function.arguments = mergeToolField(cur.function.arguments, piece);
    }
    toolAcc.set(idx, cur);
  }
}

async function readSse(res, { onDelta, signal, maxTokens = 2048 } = {}) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  const toolAcc = new Map();
  const splitter = createThinkSplitter();
  let sawDone = false;
  let sawContentDelta = false;
  let sawReasoningDelta = false;
  let lastMessage = null;
  let finishReason = null;
  let completionTokens = 0;

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
    if (choice.message) lastMessage = choice.message;
    if (delta.reasoning_content || delta.reasoning) {
      sawReasoningDelta = true;
      takeParts(splitter.pushThinking(delta.reasoning_content || delta.reasoning));
    }
    if (delta.content) {
      sawContentDelta = true;
      takeParts(splitter.push(delta.content));
    }
    if (delta.tool_calls?.length) ingestToolCalls(toolAcc, delta.tool_calls);
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const used = Number(json.usage?.completion_tokens);
    if (Number.isFinite(used) && used > 0) completionTokens = used;
  };

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener?.('abort', onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const raw of parts) {
        const line = raw.replace(/\r$/, '');
        if (line.startsWith('data:')) consumeData(line.slice(5));
        else if (line.startsWith('{')) consumeData(line);
      }
    }
    const tail = buf.trim();
    if (tail.startsWith('data:')) consumeData(tail.slice(5));
    else if (tail.startsWith('{')) consumeData(tail);
    takeParts(splitter.flush());

    if (!sawContentDelta && !sawReasoningDelta && lastMessage) {
      if (lastMessage.reasoning_content || lastMessage.reasoning) {
        takeParts(splitter.pushThinking(lastMessage.reasoning_content || lastMessage.reasoning));
      }
      if (lastMessage.content) takeParts(splitter.push(lastMessage.content));
      takeParts(splitter.flush());
    }
    if (lastMessage?.tool_calls?.length) ingestToolCalls(toolAcc, lastMessage.tool_calls);

    const tool_calls = [...toolAcc.values()].filter((t) => t.function.name);
    if (!content && !tool_calls.length && !reasoning && !sawDone) {
      throw new Error('empty stream');
    }
    const cap = Math.max(1, Number(maxTokens) || 2048);
    if (completionTokens >= cap - 8 && (!finishReason || finishReason === 'stop')) {
      finishReason = 'length';
    }
    const msg = { role: 'assistant', content: content || null };
    if (tool_calls.length) msg.tool_calls = tool_calls;
    if (reasoning) msg.reasoning_content = reasoning;
    if (finishReason) msg.finish_reason = finishReason;
    return msg;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }
}

function withScalatticeBody(body, settings, { stream } = {}) {
  const scalattice = routingScalattice({ ...(settings || {}), ...(stream != null ? { stream } : {}) });
  if (scalattice) body.scalattice = scalattice;
  return body;
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
  max_tokens = 2048,
  signal,
  onDelta,
} = {}) {
  const useStream = settings?.stream !== undefined ? settings.stream !== false : stream !== false;
  const useThink = settings?.thinking !== undefined ? settings.thinking !== false : thinking !== false;
  const body = withScalatticeBody(
    {
      model,
      messages: openaiMessages(applyThinkingTag(messages, useThink)),
      temperature,
      max_tokens,
      stream: useStream,
    },
    settings,
    { stream: useStream }
  );
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
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(describeHttpError(res.status, url, t));
  }
  if (useStream && res.body) {
    return readSse(res, { onDelta, signal, maxTokens: max_tokens });
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
  const fr = json.choices?.[0]?.finish_reason;
  if (fr) out.finish_reason = fr;
  const used = Number(json.usage?.completion_tokens);
  const cap = Math.max(1, Number(max_tokens) || 2048);
  if (Number.isFinite(used) && used >= cap - 8 && (!out.finish_reason || out.finish_reason === 'stop')) {
    out.finish_reason = 'length';
  }
  return out;
}

async function postJson({ apiUrl, apiKey, path, body, settings, signal, accept = 'application/json' }) {
  const payload = withScalatticeBody({ ...body }, settings, { stream: false });
  const url = inferenceUrl(apiUrl, path);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: accept,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(describeHttpError(res.status, url, t));
  }
  return res;
}

/** POST /v1/images/generations — prompt → pictures (b64_json by default). */
export async function imageGenerations({
  apiUrl,
  apiKey,
  model,
  prompt,
  n = 1,
  size,
  response_format = 'b64_json',
  settings,
  signal,
} = {}) {
  const body = {
    model,
    prompt: String(prompt || ''),
    n: Math.min(4, Math.max(1, Number(n) || 1)),
    response_format,
  };
  if (size) body.size = String(size);
  const res = await postJson({
    apiUrl,
    apiKey,
    path: '/images/generations',
    body,
    settings,
    signal,
  });
  return res.json();
}

/** POST /v1/images/edits — reference image(s) + prompt → pictures. */
export async function imageEdits({
  apiUrl,
  apiKey,
  model,
  prompt,
  image,
  images,
  n = 1,
  response_format = 'b64_json',
  settings,
  signal,
} = {}) {
  const refs = Array.isArray(images) ? images : images ? [images] : [];
  if (image) refs.unshift(image);
  const body = {
    model,
    prompt: String(prompt || ''),
    n: Math.min(4, Math.max(1, Number(n) || 1)),
    response_format,
    images: refs.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 4),
  };
  if (body.images.length === 1) body.image = body.images[0];
  if (!body.images.length) throw new Error('image_edit requires at least one input image');
  const res = await postJson({
    apiUrl,
    apiKey,
    path: '/images/edits',
    body,
    settings,
    signal,
  });
  return res.json();
}

/**
 * POST /v1/audio/speech — text → audio bytes.
 * Returns { buffer, contentType, characters, audioSeconds }.
 */
export async function audioSpeech({
  apiUrl,
  apiKey,
  model,
  input,
  voice,
  response_format = 'mp3',
  speed,
  settings,
  signal,
} = {}) {
  const body = {
    model,
    input: String(input || ''),
    response_format: String(response_format || 'mp3'),
  };
  if (voice) body.voice = String(voice);
  if (speed != null && Number.isFinite(Number(speed))) body.speed = Number(speed);
  const res = await postJson({
    apiUrl,
    apiKey,
    path: '/audio/speech',
    body,
    settings,
    signal,
    accept: 'audio/*',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const characters = res.headers.get('X-Scalattice-Characters');
  const audioSeconds = res.headers.get('X-Scalattice-Audio-Seconds');
  return {
    buffer: buf,
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    characters: characters != null ? Number(characters) || characters : undefined,
    audioSeconds: audioSeconds != null ? Number(audioSeconds) || audioSeconds : undefined,
  };
}

function modelContextTokens(row) {
  const n = Number(row?.max_context_tokens ?? row?.maxContextTokens ?? row?.context_length);
  return Number.isFinite(n) && n >= 1024 ? Math.floor(n) : 0;
}

function modelJobKind(row) {
  const raw = String(row?.job_kind || row?.jobKind || '').trim().toLowerCase();
  if (raw) return raw;
  if (row?.visionModel === true || row?.vision === true) return 'chat';
  return 'chat';
}

export async function listModels({ apiUrl, apiKey } = {}) {
  const res = await fetch(inferenceUrl(apiUrl, '/models'), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const err = new Error(`models ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return (json.data || [])
    .filter((m) => m && m.id)
    .map((m) => ({
      id: String(m.id),
      maxContextTokens: modelContextTokens(m),
      jobKind: modelJobKind(m),
      vision: m?.visionModel === true || m?.vision === true || Boolean(m?.mmproj),
    }));
}

export async function listModelIds(opts) {
  return (await listModels(opts)).map((m) => m.id);
}
