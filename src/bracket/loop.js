import { chatCompletion } from './client.js';
import { compactMessages, estimateChars } from './prompt.js';
import { toolSummary } from './tools.js';

const COMPACT_AFTER = 180_000;

export async function runLoop({
  messages,
  tools,
  model,
  apiUrl,
  apiKey,
  runTool,
  maxTurns = 40,
  stream = true,
  signal,
  onDelta,
  onTool,
  onToolDone,
  onAssistantEnd,
} = {}) {
  let history = messages;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (estimateChars(history) > COMPACT_AFTER) {
      history = compactMessages(history, { keep: 16 });
    }

    let assistant;
    try {
      assistant = await chatCompletion({
        apiUrl,
        apiKey,
        messages: history,
        tools,
        model,
        stream,
        signal,
        onDelta,
      });
    } catch (err) {
      if (stream && /aborted/i.test(err?.message || '')) throw err;
      if (stream) {
        assistant = await chatCompletion({
          apiUrl,
          apiKey,
          messages: history,
          tools,
          model,
          stream: false,
          signal,
        });
      } else {
        throw err;
      }
    }

    history = [...history, assistant];
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
