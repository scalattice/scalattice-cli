import { chatCompletion } from './client.js';
import { compactMessages, estimateChars } from './prompt.js';
import { toolSummary } from './tools.js';
import { parseFallbackToolCalls, stripRecoveredToolText } from './xmlTools.js';

const COMPACT_AFTER = 180_000;

function historyMessage(assistant) {
  const msg = { role: 'assistant', content: assistant.content ?? null };
  if (assistant.tool_calls?.length) msg.tool_calls = assistant.tool_calls;
  return msg;
}

function withFallbackTools(assistant) {
  if (assistant?.tool_calls?.length) return assistant;
  const recovered = parseFallbackToolCalls(assistant?.content);
  if (!recovered.length) return assistant;
  const stripped = stripRecoveredToolText(assistant.content);
  return {
    ...assistant,
    tool_calls: recovered,
    content: stripped || null,
  };
}

export async function runLoop({
  messages,
  tools,
  model,
  apiUrl,
  apiKey,
  runTool,
  maxTurns = 40,
  stream = true,
  settings,
  signal,
  onDelta,
  onTool,
  onToolDone,
  onAssistantEnd,
} = {}) {
  let history = messages;
  const useStream = settings?.stream !== undefined ? settings.stream !== false : stream !== false;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (estimateChars(history) > COMPACT_AFTER) {
      history = compactMessages(history, { keep: 16 });
    }

    const assistant = withFallbackTools(
      await chatCompletion({
        apiUrl,
        apiKey,
        messages: history,
        tools,
        model,
        stream: useStream,
        settings,
        signal,
        onDelta,
      })
    );

    history = [...history, historyMessage(assistant)];
    onAssistantEnd?.(assistant);

    const calls = assistant.tool_calls || [];
    if (!calls.length) {
      return { messages: history, reason: 'stop' };
    }

    for (const call of calls) {
      onTool?.({ call, summary: toolSummary(call) });
      const result = await runTool(call);
      onToolDone?.({ call, summary: toolSummary(call), result });
      history = [
        ...history,
        {
          role: 'tool',
          tool_call_id: call.id,
          content: String(result ?? ''),
        },
      ];
    }
  }
  return { messages: history, reason: 'max_turns' };
}
