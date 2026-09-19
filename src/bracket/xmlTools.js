const KNOWN_TOOLS = new Set([
  'bash',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'list_dir',
  'todo_write',
  'web_search',
  'web_fetch',
]);

function parseArgsJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    try {
      const parsed = JSON.parse(stripJsonComments(text));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return { input: text };
    }
  }
}

function stripJsonComments(s) {
  return String(s || '').replace(/^\s*\/\/.*$/gm, '');
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

function callFromObject(obj, index) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  let name = obj.name || obj.tool;
  let args = obj.arguments || obj.parameters || obj.params || obj.input;
  if (typeof obj.function === 'string') {
    name = obj.function;
  } else if (obj.function && typeof obj.function === 'object') {
    name = obj.function.name || name;
    args = obj.function.arguments || obj.function.parameters || args;
  }
  if (typeof args === 'string') args = parseArgsJson(args);
  name = String(name || '').trim();
  if (!name || !KNOWN_TOOLS.has(name)) return null;
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  return makeCall(name, args, index);
}

function extractJsonObjects(text) {
  const src = stripJsonComments(text);
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < src.length; j += 1) {
      const ch = src[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = src.slice(i, j + 1);
          try {
            out.push(JSON.parse(slice));
          } catch {
            /* skip */
          }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Qwen / open models sometimes emit tool XML or JSON even when the API asked
 * for OpenAI tool_calls. Recover those so the loop still runs.
 */
export function parseFallbackToolCalls(content) {
  const text = String(content || '');
  if (
    !text.includes('tool_call') &&
    !text.includes('"name"') &&
    !text.includes('"function"') &&
    !text.includes('web_search') &&
    !text.includes('web_fetch')
  ) {
    return [];
  }
  const calls = [];
  const seen = new Set();
  const add = (call) => {
    if (!call?.function?.name) return;
    const key = `${call.function.name}:${call.function.arguments}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ ...call, id: `call_xml_${calls.length + 1}` });
  };

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
    add(makeCall(name, args, calls.length));
  }

  const tagged = /<tool_call>\s*([\s\S]*?)<\/tool_call>/gi;
  while ((m = tagged.exec(text))) {
    const inner = m[1].trim();
    if (inner.startsWith('<function=')) continue;
    if (inner.startsWith('{')) {
      const obj = extractJsonObjects(inner)[0];
      add(callFromObject(obj, calls.length));
      continue;
    }
    const argKey = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
    const args = {};
    let k;
    while ((k = argKey.exec(inner))) {
      args[k[1].trim()] = k[2].trim();
    }
    const name = inner.split('\n')[0].trim().replace(/[<>]/g, '');
    if (name && KNOWN_TOOLS.has(name)) add(makeCall(name, args, calls.length));
  }

  for (const obj of extractJsonObjects(text)) {
    add(callFromObject(obj, calls.length));
  }

  return calls;
}

export function stripRecoveredToolText(content) {
  let text = String(content || '');
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  text = text.replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|function)"[\s\S]*?\}\s*```/gi, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
