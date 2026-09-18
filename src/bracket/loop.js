import { chatCompletion } from './client.js';
import { fitMessagesForContext, isContextOverflowError } from './prompt.js';
import { toolSummary } from './tools.js';
import { parseFallbackToolCalls, stripRecoveredToolText } from './xmlTools.js';

function historyMessage(assistant) {
  const msg = { role: 'assistant', content: assistant.content ?? null };
  if (assistant.tool_calls?.length) {
    msg.tool_calls = assistant.tool_calls.map((tc, i) => ({
      id: String(tc.id || `call_${i + 1}`),
      type: 'function',
      function: {
        name: String(tc.function?.name || ''),
        arguments:
          typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || {}),
      },
    }));
  }
  return msg;
}

function turnHasOutput(assistant) {
  if (assistant?.tool_calls?.length) return true;
  return Boolean(String(assistant?.content || '').trim());
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
  onTurnStart,
  onRetry,
  onTool,
  onToolDone,
  onAssistantEnd,
} = {}) {
  let history = messages;
  const useStream = settings?.stream !== undefined ? settings.stream !== false : stream !== false;
  const thinkOn = settings?.thinking !== undefined ? settings.thinking !== false : true;

  const complete = (think) =>
    chatCompletion({
      apiUrl,
      apiKey,
      messages: history,
      tools,
      model,
      stream: useStream,
      thinking: think,
      settings: { ...(settings || {}), thinking: think },
      signal,
      onDelta,
    });

  const shrink = (budget, keep) => {
    const next = fitMessagesForContext(history, { budget, tools, keep });
    if (next !== history && JSON.stringify(next) !== JSON.stringify(history)) {
      onRetry?.('Shrinking earlier turns so they fit this model context window.');
    }
    history = next;
  };

  for (let turn = 0; turn < maxTurns; turn += 1) {
    shrink(2800, 8);

    onTurnStart?.();
    const lastRole = [...history].reverse().find((m) => m.role && m.role !== 'system')?.role;
    const shouldThink = thinkOn && lastRole !== 'tool' && lastRole !== 'function';
    let assistant;
    try {
      assistant = withFallbackTools(await complete(shouldThink));
    } catch (err) {
      if (!isContextOverflowError(err)) throw err;
      onRetry?.('Request was larger than the model window. Compacting and retrying.');
      shrink(2000, 4);
      onTurnStart?.();
      assistant = withFallbackTools(await complete(false));
    }
    if (!turnHasOutput(assistant) && shouldThink) {
      onRetry?.('Retrying without thinking (previous reply used up the token budget).');
      onTurnStart?.();
      assistant = withFallbackTools(await complete(false));
    }
    if (!turnHasOutput(assistant)) {
      onAssistantEnd?.(assistant);
      return { messages: history, reason: 'empty' };
    }

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
