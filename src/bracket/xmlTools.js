function parseArgsJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { input: text };
  }
}

function makeCall(name, args, index) {
  return {
    id: `call_xml_${index + 1}`,
    type: 'function',
    function: {
      name: String(name || '').trim(),
      arguments: JSON.stringify(args && typeof args === 'object' ? args : {}),
    },
  };
}

/**
 * Qwen / open models sometimes emit tool XML even when the API asked for
 * OpenAI tool_calls. Recover those so the loop still runs.
 */
export function parseFallbackToolCalls(content) {
  const text = String(content || '');
  if (!text.includes('tool_call') && !text.includes('"name"')) return [];
  const calls = [];

  const xmlBlock =
    /<tool_call>\s*<function=([^>]+)>\s*([\s\S]*?)<\/function>\s*<\/tool_call>/gi;
  let m;
  while ((m = xmlBlock.exec(text))) {
    const name = m[1].trim();
    const inner = m[2];
    const args = {};
    const param = /<parameter=([^>]+)>\s*([\s\S]*?)<\/parameter>/gi;
    let p;
    while ((p = param.exec(inner))) {
      args[p[1].trim()] = p[2].trim();
    }
    if (name) calls.push(makeCall(name, args, calls.length));
  }

  const jsonBlock = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  while ((m = jsonBlock.exec(text))) {
    const parsed = parseArgsJson(m[1]);
    const name = parsed.name || parsed.tool;
    const args = parsed.arguments || parsed.parameters || parsed.input || parsed;
    if (name) {
      const clean =
        args && typeof args === 'object' && !Array.isArray(args) && !args.name
          ? args
          : parseArgsJson(typeof args === 'string' ? args : JSON.stringify(args || {}));
      calls.push(makeCall(name, clean, calls.length));
    }
  }

  if (!calls.length) {
    const fence = /```(?:json)?\s*(\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\})\s*```/i.exec(text);
    if (fence) {
      const parsed = parseArgsJson(fence[1]);
      const name = parsed.name || parsed.tool;
      const args = parsed.arguments || parsed.parameters || {};
      if (name) calls.push(makeCall(name, typeof args === 'string' ? parseArgsJson(args) : args, 0));
    }
  }

  return calls.filter((c) => c.function.name);
}
