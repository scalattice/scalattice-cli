const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const TAG_ON = '/think';
const TAG_OFF = '/no_think';
const TAG_RE = /(?:^|\s)\/(?:no_)?think\b/g;

function longestSuffixPrefix(hold, token) {
  const max = Math.min(hold.length, token.length - 1);
  for (let n = max; n >= 1; n -= 1) {
    if (token.startsWith(hold.slice(-n))) return n;
  }
  return 0;
}

/** Clone messages and tag the last user turn so Qwen-family templates enable or suppress thinking. */
export function applyThinkingTag(messages, thinking) {
  const tag = thinking ? TAG_ON : TAG_OFF;
  const out = (messages || []).map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i].role !== 'user' || typeof out[i].content !== 'string') continue;
    const body = out[i].content.replace(TAG_RE, '').trimEnd();
    out[i] = { ...out[i], content: body ? `${body}\n${tag}` : tag };
    break;
  }
  return out;
}

export function createThinkSplitter() {
  let mode = 'content';
  let hold = '';

  function pushChunk(chunk) {
    if (!chunk) return [];
    hold += chunk;
    const emitted = [];
    while (hold) {
      const token = mode === 'content' ? THINK_OPEN : THINK_CLOSE;
      const idx = hold.indexOf(token);
      if (idx >= 0) {
        const before = hold.slice(0, idx);
        if (before) emitted.push({ type: mode === 'think' ? 'thinking' : 'content', text: before });
        hold = hold.slice(idx + token.length);
        mode = mode === 'content' ? 'think' : 'content';
        continue;
      }
      const keep = longestSuffixPrefix(hold, token);
      const safe = keep ? hold.slice(0, hold.length - keep) : hold;
      hold = keep ? hold.slice(-keep) : '';
      if (safe) emitted.push({ type: mode === 'think' ? 'thinking' : 'content', text: safe });
      break;
    }
    return emitted;
  }

  return {
    push(chunk) {
      return pushChunk(chunk);
    },
    pushThinking(chunk) {
      return chunk ? [{ type: 'thinking', text: chunk }] : [];
    },
    flush() {
      if (!hold) return [];
      const type = mode === 'think' ? 'thinking' : 'content';
      const text = hold;
      hold = '';
      return [{ type, text }];
    },
  };
}
