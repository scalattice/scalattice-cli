import fs from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { print } from '../io.js';
import { cmdCredits, cmdWhoami, loadBilling, bannerCreditLines } from '../commands/misc.js';
import { resolveBracketAuth } from './auth.js';
import { listModelIds } from './client.js';
import { runLoop } from './loop.js';
import { createPermissions } from './permissions.js';
import { buildSystemPrompt, compactMessages, pickDefaultModel } from './prompt.js';
import { loadLastSession, saveSession } from './session.js';
import { createToolRunner, TOOL_DEFS, toolSummary } from './tools.js';
import { createTui } from './tui.js';
import { defaultSettings, parseBoolArg, patchSettings, settingsLine } from './settings.js';

export const BRACKET_HELP = `scalattice bracket — coding harness (reads/edits files, runs commands)

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
  --stream / --no-stream
      SSE streaming (default on). Streaming needs vet 1 and tier1.
  --think / --no-think
      Request model thinking on the last user turn (default on)
  --region auto|us|eu|ap
      X-Scalattice-Region (default auto)
  --vet 1|2|3
      X-Scalattice-Vet-Replicas. Values above 1 turn streaming off.
  --security tier1|tier2.5
      X-Scalattice-Security. tier2.5 turns streaming off.

Env: SCALATTICE_STREAM, SCALATTICE_THINKING, SCALATTICE_REGION,
     SCALATTICE_VET_REPLICAS, SCALATTICE_SECURITY

Inside Bracket:
  /help  /exit  /clear  /compact  /model [id]  /yolo [on|off]  /credits  /whoami
  /settings  /stream [on|off]  /think [on|off]  /region [auto|us|eu|ap]
  /vet [1|2|3]  /security [tier1|tier2.5]

Auth: sign in (session). Bracket then mints a developer inference key (slt_…).
Do not use slt_mgmt_… or slt_provider_…. To set a key yourself:
  export SCALATTICE_API_KEY=slt_…
A minted key may be stored at ~/.config/scalattice/bracket.key (mode 0600).
`;

function deltaPart(part) {
  return typeof part === 'string' ? { type: 'content', text: part } : part;
}

async function completeTurn({
  messages,
  model,
  auth,
  cwd,
  permissions,
  todos,
  maxTurns,
  settings,
  ui,
}) {
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.once('SIGINT', onSig);
  const runTool = createToolRunner({ cwd, permissions, todos });
  const stream = settings?.stream !== false;
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
      settings,
      signal: ac.signal,
      onDelta: (part) => {
        const p = deltaPart(part);
        if (ui) ui.writeDelta(p);
        else if (stream && p.type === 'content' && p.text) process.stdout.write(p.text);
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
  let settings = defaultSettings(flags);

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
      settings,
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
  let billing = null;
  const syncHeader = () => {
    ui.updateBanner({
      model,
      yolo: permissions.yolo,
      policy: settingsLine(settings),
      credits: bannerCreditLines(billing, model),
    });
  };

  const handleSlash = async (line) => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'help':
        ui.note(
          '/help /exit /clear /compact /model /yolo /credits /whoami /settings /stream /think /region /vet /security'
        );
        return 'ok';
      case 'exit':
      case 'quit':
        return 'exit';
      case 'clear':
        messages = [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo: permissions.yolo }) }];
        ui.clearTranscript();
        ui.note('Conversation cleared.');
        return 'ok';
      case 'compact':
        messages = compactMessages(messages, { keep: 10 });
        ui.note('Compacted earlier turns.');
        return 'ok';
      case 'model':
        if (arg) {
          model = arg;
          syncHeader();
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
        syncHeader();
        ui.note(next ? 'yolo on' : 'yolo off');
        return 'ok';
      }
      case 'credits':
        await cmdCredits();
        return 'ok';
      case 'whoami':
        await cmdWhoami();
        return 'ok';
      case 'settings':
        ui.note(settingsLine(settings));
        return 'ok';
      case 'stream':
        try {
          settings = patchSettings(settings, { stream: parseBoolArg(arg, settings.stream) });
          syncHeader();
          ui.note(settingsLine(settings));
        } catch (err) {
          ui.note(err?.message || String(err));
        }
        return 'ok';
      case 'think':
        try {
          settings = patchSettings(settings, { thinking: parseBoolArg(arg, settings.thinking) });
          syncHeader();
          ui.note(settingsLine(settings));
        } catch (err) {
          ui.note(err?.message || String(err));
        }
        return 'ok';
      case 'region':
        if (!arg) {
          ui.note(`region ${settings.region} (auto|us|eu|ap)`);
          return 'ok';
        }
        settings = patchSettings(settings, { region: arg });
        syncHeader();
        ui.note(settingsLine(settings));
        return 'ok';
      case 'vet':
        if (!arg) {
          ui.note(`vet ${settings.vet} (1–3; stream needs 1)`);
          return 'ok';
        }
        settings = patchSettings(settings, { vet: Number(arg) });
        syncHeader();
        ui.note(settingsLine(settings));
        return 'ok';
      case 'security':
        if (!arg) {
          ui.note(`security ${settings.security} (tier1|tier2.5; stream needs tier1)`);
          return 'ok';
        }
        settings = patchSettings(settings, { security: arg });
        syncHeader();
        ui.note(settingsLine(settings));
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
        settings,
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
    billing = await loadBilling(auth);
    ui.banner({
      cwd,
      model,
      yolo: permissions.yolo,
      email: auth.email || '',
      policy: settingsLine(settings),
      credits: bannerCreditLines(billing, model),
    });
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
