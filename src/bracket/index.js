import fs from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { print } from '../io.js';
import { cmdCredits, cmdWhoami } from '../commands/misc.js';
import { resolveBracketAuth } from './auth.js';
import { listModelIds } from './client.js';
import { runLoop } from './loop.js';
import { createPermissions } from './permissions.js';
import { buildSystemPrompt, compactMessages, pickDefaultModel } from './prompt.js';
import { loadLastSession, saveSession } from './session.js';
import { createToolRunner, TOOL_DEFS, toolSummary } from './tools.js';
import { createTui } from './tui.js';

export const BRACKET_HELP = `scalattice bracket — coding harness (reads/edits files, runs commands)

Not scalattice-agent (that is the GPU provider daemon).

Usage:
  scalattice bracket
  scalattice bracket "fix the failing tests"
  scalattice bracket --print "summarize this repo"
  scalattice bracket --yolo "apply the refactor"
  scalattice bracket --continue

Flags:
  --yolo, --auto, --dangerously-skip-permissions
      Skip approval prompts for shell and writes
  --print, -p
      One shot, then exit (writes/shell still need --yolo unless you approve)
  --model ID
      Catalog model (default: qwen-3-coder-30b-a3b, or SCALATTICE_BRACKET_MODEL)
  --cwd PATH
      Workspace root (default: current directory)
  --max-turns N
      Stop after this many model turns (default 40)
  --continue, -c
      Resume the last Bracket session in this workspace

Inside Bracket:
  /help  /exit  /clear  /compact  /model [id]  /yolo [on|off]  /credits  /whoami

Auth: a live Cloud session (open /auth and run the curl command), or
OPENAI_API_KEY / SCALATTICE_API_KEY (must be slt_… inference, not a JWT).
A Bracket inference key may be stored at ~/.config/scalattice/bracket.key
(mode 0600). Account session stays in config.json as before.
`;

async function completeTurn({
  messages,
  model,
  auth,
  cwd,
  permissions,
  todos,
  maxTurns,
  stream,
  ui,
}) {
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.once('SIGINT', onSig);
  const runTool = createToolRunner({ cwd, permissions, todos });
  try {
    ui?.startAssistant?.();
    const result = await runLoop({
      messages,
      tools: TOOL_DEFS,
      model,
      apiUrl: auth.apiUrl,
      apiKey: auth.apiKey,
      runTool,
      maxTurns,
      stream,
      signal: ac.signal,
      onDelta: (chunk) => {
        if (ui) ui.writeAssistant(chunk);
        else if (stream) process.stdout.write(chunk);
      },
      onTool: ({ summary }) => {
        if (ui) ui.tool(summary);
        else print(`▸ ${summary}`);
      },
      onAssistantEnd: (assistant) => {
        if (ui) ui.endAssistant();
        else if (stream && assistant.content) process.stdout.write('\n');
        if (!ui && !stream && assistant.content) print(assistant.content);
        if (!ui && !stream) {
          for (const call of assistant.tool_calls || []) {
            print(`▸ ${toolSummary(call)}`);
          }
        }
      },
    });
    if (result.reason === 'max_turns') {
      const msg = 'Stopped: max turns. Raise with --max-turns or /clear.';
      if (ui) ui.note(msg);
      else print(msg);
    }
    return result.messages;
  } finally {
    process.removeListener('SIGINT', onSig);
  }
}

export async function cmdBracket(opts = {}) {
  const flags = opts.flags || {};
  let promptText = String(opts.prompt || '').trim();
  const cwd = path.resolve(flags.cwd || process.cwd());
  const yolo = Boolean(flags.yolo);
  const printMode = Boolean(flags.print);
  const interactive = !printMode && input.isTTY && output.isTTY;
  const maxTurns = Number.isFinite(flags.maxTurns) && flags.maxTurns > 0 ? flags.maxTurns : 40;

  if (printMode && !promptText) {
    promptText = fs.readFileSync(0, 'utf8').trim();
  }

  const auth = await resolveBracketAuth();
  let modelIds = [];
  try {
    modelIds = await listModelIds({ apiUrl: auth.apiUrl, apiKey: auth.apiKey });
  } catch {
    /* catalog optional */
  }
  let model = flags.model || pickDefaultModel(modelIds);

  const todos = [];
  let messages;

  if (flags.continue) {
    const prev = loadLastSession();
    if (!prev?.messages?.length) throw new Error('No previous Bracket session to continue.');
    messages = prev.messages;
    if (prev.model && !flags.model) model = prev.model;
  } else {
    messages = [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo }) }];
  }

  if (!interactive) {
    const permissions = createPermissions({ yolo, interactive: false });
    if (!promptText) throw new Error('Pass a prompt, or run `scalattice bracket` in a terminal.');
    messages.push({ role: 'user', content: promptText });
    messages = await completeTurn({
      messages,
      model,
      auth,
      cwd,
      permissions,
      todos,
      maxTurns,
      stream: Boolean(output.isTTY),
    });
    saveSession({ cwd, model, messages });
    return;
  }

  const ui = createTui();
  const permissions = createPermissions({
    yolo,
    interactive: true,
    ask: (toolName, summary) => ui.approve(toolName, summary),
  });
  const persist = () => saveSession({ cwd, model, messages });

  const handleSlash = async (line) => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'help':
        ui.note(BRACKET_HELP.trim().split('\n').slice(0, 12).join('\n  '));
        return 'ok';
      case 'exit':
      case 'quit':
        return 'exit';
      case 'clear':
        messages = [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo: permissions.yolo }) }];
        ui.note('Conversation cleared.');
        return 'ok';
      case 'compact':
        messages = compactMessages(messages, { keep: 10 });
        ui.note('Compacted earlier turns.');
        return 'ok';
      case 'model':
        if (arg) {
          model = arg;
          ui.note(`Model set to ${model}`);
        } else {
          ui.note(modelIds.length ? modelIds.join(', ') : model);
        }
        return 'ok';
      case 'yolo': {
        const next =
          arg === 'on' || arg === 'true' || arg === '1'
            ? true
            : arg === 'off' || arg === 'false' || arg === '0'
              ? false
              : !permissions.yolo;
        permissions.setYolo(next);
        ui.note(next ? 'yolo on' : 'yolo off');
        return 'ok';
      }
      case 'credits':
        await cmdCredits();
        return 'ok';
      case 'whoami':
        await cmdWhoami();
        return 'ok';
      default:
        ui.note(`Unknown slash command: /${cmd}. Try /help.`);
        return 'ok';
    }
  };

  const runUserTurn = async (text) => {
    messages.push({ role: 'user', content: text });
    try {
      messages = await completeTurn({
        messages,
        model,
        auth,
        cwd,
        permissions,
        todos,
        maxTurns,
        stream: true,
        ui,
      });
    } catch (err) {
      if (err?.interrupted || /aborted|interrupted/i.test(err?.message || '')) {
        ui.note('Interrupted.');
      } else {
        ui.error(err?.message || String(err));
      }
    }
    persist();
  };

  ui.enter();
  try {
    ui.banner({ cwd, model, yolo: permissions.yolo });
    if (flags.continue) ui.note('Continued last session.');

    if (promptText) {
      ui.user(promptText);
      await runUserTurn(promptText);
    }

    while (true) {
      let line;
      try {
        line = (await ui.readLine()).trim();
      } catch (err) {
        if (err?.interrupted) break;
        throw err;
      }
      if (!line) continue;
      if (line.startsWith('/')) {
        const act = await handleSlash(line);
        persist();
        if (act === 'exit') break;
        continue;
      }
      ui.user(line);
      await runUserTurn(line);
    }
  } finally {
    persist();
    ui.leave();
    print('');
  }
}
