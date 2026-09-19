import { chatCompletion } from './client.js';
import {
  CONTEXT_SOFT_TOKENS,
  contextPromptBudget,
  DEFAULT_MAX_CONTEXT_TOKENS,
  fitMessagesForContext,
  isContextOverflowError,
} from './prompt.js';
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

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error('Interrupted'), { interrupted: true });
}

const CONTINUE_NUDGE =
  'Continue the task now. Call a tool (write_file, bash, web_search, web_fetch, read_file, etc.) or give the actual result. Do not only announce what you will do next.';

export function looksLikeStalledPlan(content) {
  const t = String(content || '').trim();
  if (!t) return true;
  if (/```/.test(t)) return false;
  if (t.length > 1600) return false;
  const delivered =
    /\b(here (is|are)|result(s)? for|i (created|wrote|found|searched|ran)|created |wrote )\b/i.test(t) ||
    /\bhttps?:\/\//i.test(t);
  if (delivered) return false;
  return (
    /\b(i['’]?ll|i will|let me|going to|i am going to|now (i['’]?ll|i will)|next i will)\b/i.test(t) ||
    /^(looking at|based on (the )?(workspace|directory|listing|results))\b/i.test(t)
  );
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
  let nudges = 0;
  const useStream = settings?.stream !== undefined ? settings.stream !== false : stream !== false;
  const thinkOn = settings?.thinking !== undefined ? settings.thinking !== false : true;
  const nCtx = Number(settings?.maxContextTokens);
  const promptBudget = contextPromptBudget(
    Number.isFinite(nCtx) && nCtx >= 1024 ? nCtx : DEFAULT_MAX_CONTEXT_TOKENS
  );
  const overflowBudget = Math.min(promptBudget, CONTEXT_SOFT_TOKENS);

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
    history = fitMessagesForContext(history, { budget, tools, keep });
  };

  for (let turn = 0; turn < maxTurns; turn += 1) {
    throwIfAborted(signal);
    shrink(promptBudget, 8);

    onTurnStart?.();
    const lastRole = [...history].reverse().find((m) => m.role && m.role !== 'system')?.role;
    const last = history[history.length - 1];
    const nudged = last?.role === 'user' && last?.content === CONTINUE_NUDGE;
    const shouldThink = thinkOn && !nudged && lastRole !== 'tool' && lastRole !== 'function';
    let assistant;
    try {
      assistant = withFallbackTools(await complete(shouldThink));
    } catch (err) {
      if (err?.interrupted || signal?.aborted || /aborted|interrupted/i.test(err?.message || '')) {
        throw Object.assign(err?.interrupted ? err : new Error('Interrupted'), { interrupted: true });
      }
      if (!isContextOverflowError(err)) throw err;
      onRetry?.('Request was larger than the model window. Compacting and retrying.');
      shrink(overflowBudget, 4);
      onTurnStart?.();
      assistant = withFallbackTools(await complete(false));
    }
    throwIfAborted(signal);
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
      const afterTools = history[history.length - 2]?.role === 'tool';
      if (afterTools && nudges < 2 && looksLikeStalledPlan(assistant.content)) {
        nudges += 1;
        onRetry?.(
          'That reply only described the next step. Asking it to actually call a tool or give the result.'
        );
        history = [...history, { role: 'user', content: CONTINUE_NUDGE }];
        continue;
      }
      return { messages: history, reason: 'stop' };
    }

    for (const call of calls) {
      throwIfAborted(signal);
      onTool?.({ call, summary: toolSummary(call) });
      const result = await runTool(call);
      throwIfAborted(signal);
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
