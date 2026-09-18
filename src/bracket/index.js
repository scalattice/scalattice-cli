import fs from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { print } from '../io.js';
import { loadBilling, bannerCreditLines, creditsText, whoamiText } from '../commands/misc.js';
import { resolveBracketAuth } from './auth.js';
import {
  describeBracketKey,
  formatBracketKeyStatus,
  formatRevokeResult,
  formatRollResult,
  revokeBracketKey,
  rollBracketKey,
} from './key.js';
import { listModelIds } from './client.js';
import { runLoop } from './loop.js';
import { createPermissions } from './permissions.js';
import { buildSystemPrompt, compactMessages, pickDefaultModel } from './prompt.js';
import { loadLastBracketModel, saveLastBracketModel } from '../config.js';
import { loadLastSession, loadSession, saveSession, newChatId, listSessions, resolveSessionRef, deleteSession, formatSessionList, titleFromMessages } from './session.js';
import { createToolRunner, TOOL_DEFS, toolSummary, toolsBlock } from './tools.js';
import { createTui } from './tui.js';
import { defaultSettings, parseBoolArg, patchSettings, settingsLine } from './settings.js';
import { settingNote, settingsBlock, slashHelp, canonSlash, completeSlash } from './slash.js';

export const BRACKET_HELP = `scalattice bracket: coding harness (reads/edits files, runs commands)

Usage:
  scalattice bracket
  scalattice bracket "fix the failing tests"
  scalattice bracket --print "summarize this repo"
  scalattice bracket --yolo "apply the refactor"
  scalattice bracket --continue
  scalattice bracket key [show|roll|revoke] [--show]

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
      Resume the last Bracket chat in this workspace
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
  /help [command]     explain one command (try /help stream)
  /settings           labeled stream / think / region / vet / security
  /stream /think /region /vet /security /model /yolo /credits /whoami /key
  /chats /chat /new /rename /forget /clear /compact /exit
  /tools
  Tab completes commands, flags, models, and chats.

Auth: sign in (session). Bracket then mints a developer inference key (slt_…).
Do not use slt_mgmt_… or slt_provider_…. To set a key yourself:
  export SCALATTICE_API_KEY=slt_…
A minted key is stored at ~/.config/scalattice/bracket.key (mode 0600).
Manage it with scalattice bracket key or /key inside Bracket (roll / revoke).
scalattice bracket key --show prints the full secret. /key never does.
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
  signal: outerSignal,
}) {
  const ac = new AbortController();
  const signal = outerSignal || ac.signal;
  const onSig = () => ac.abort();
  if (!ui) process.once('SIGINT', onSig);
  const runTool = createToolRunner({ cwd, permissions, todos });
  const stream = settings?.stream !== false;
  try {
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
      signal,
      onTurnStart: () => ui?.startAssistant?.(),
      onRetry: (msg) => ui?.note?.(msg),
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
        if (ui) {
          if (assistant.tool_calls?.length) ui.replaceAssistant(assistant.content || '');
          ui.endAssistant();
          if (assistant.finish_reason === 'length') {
            ui.note('Stopped: hit the token limit. Ask it to continue, or /think off.');
          }
        } else if (stream && assistant.content) process.stdout.write('\n');
        if (!ui && !stream && assistant.content) print(assistant.content);
        if (!ui && !stream) {
          for (const call of assistant.tool_calls || []) {
            print(`▸ ${toolSummary(call)}`);
          }
        }
        if (!ui && assistant.finish_reason === 'length') {
          print('Stopped: hit the token limit.');
        }
      },
    });
    if (result.reason === 'max_turns') {
      const msg = 'Stopped: max turns. Raise with --max-turns or /clear.';
      if (ui) ui.note(msg);
      else print(msg);
    }
    if (result.reason === 'empty') {
      const msg = 'The model stopped before an answer. Try again, or /think off.';
      if (ui) ui.note(msg);
      else print(msg);
    }
    return result.messages;
  } finally {
    if (!ui) process.removeListener('SIGINT', onSig);
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
  let model = flags.model || pickDefaultModel(modelIds, loadLastBracketModel());
  if (model) saveLastBracketModel(model);

  const todos = [];
  let messages;
  let chatId;
  let chatTitle;
  let chatCreatedAt;

  if (flags.continue) {
    const prev = loadLastSession(cwd);
    if (!prev?.messages?.length) throw new Error('No previous Bracket chat to continue.');
    messages = prev.messages;
    chatId = prev.id || newChatId();
    chatTitle = prev.title || titleFromMessages(prev.messages);
    chatCreatedAt = prev.createdAt;
    if (prev.model && !flags.model) {
      model = prev.model;
      saveLastBracketModel(model);
    }
  } else {
    chatId = newChatId();
    chatTitle = 'New chat';
    chatCreatedAt = undefined;
    messages = [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo }) }];
  }

  const hasUserTurns = (msgs) => (msgs || []).some((m) => m?.role === 'user');

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
    saveSession({ id: chatId, title: chatTitle, createdAt: chatCreatedAt, cwd, model, messages });
    return;
  }

  const tuiOpts = {
    complete: (line) =>
      completeSlash(line, {
        models: modelIds,
        chats: listSessions({ cwd, limit: 80 }),
        cwd,
      }),
  };
  const ui = createTui(tuiOpts);
  const permissions = createPermissions({
    yolo,
    interactive: true,
    ask: (toolName, summary) => ui.approve(toolName, summary),
  });
  const persist = () => {
    if (!hasUserTurns(messages) && (!chatTitle || chatTitle === 'New chat')) return;
    const saved = saveSession({
      id: chatId,
      title: chatTitle === 'New chat' ? undefined : chatTitle,
      createdAt: chatCreatedAt,
      cwd,
      model,
      messages,
    });
    chatId = saved.id;
    chatTitle = saved.title;
    chatCreatedAt = saved.createdAt;
    saveLastBracketModel(model);
    syncHeader();
  };
  let billing = null;
  const headerBits = () => ({
    model,
    yolo: permissions.yolo,
    policy: settingsLine(settings),
    credits: bannerCreditLines(billing, model),
    chat: chatTitle,
    chats: listSessions({ cwd, limit: 80 }),
    currentId: chatId,
  });
  const syncHeader = () => {
    ui.updateBanner(headerBits());
  };

  const startBlankChat = (note) => {
    persist();
    chatId = newChatId();
    chatTitle = 'New chat';
    chatCreatedAt = undefined;
    messages = [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo: permissions.yolo }) }];
    ui.clearTranscript();
    syncHeader();
    ui.note(note);
  };

  const openChat = (rec) => {
    persist();
    chatId = rec.id;
    chatTitle = rec.title || titleFromMessages(rec.messages);
    chatCreatedAt = rec.createdAt;
    messages = rec.messages || [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo: permissions.yolo }) }];
    if (rec.model && !flags.model) {
      model = rec.model;
      saveLastBracketModel(model);
    }
    saveSession({ ...rec, id: chatId, title: chatTitle, cwd: rec.cwd || cwd, model, messages });
    ui.replay(messages);
    syncHeader();
    ui.note(`Opened ${chatTitle}`);
  };

  tuiOpts.onOpenChat = ({ id }) => {
    if (!id || id === chatId) return;
    const rec = loadSession(id);
    if (rec) openChat(rec);
  };

  const chatsNote = (all = false) => {
    const rows = listSessions({ cwd, all, limit: 30 });
    const body = formatSessionList(rows, chatId, { showCwd: all });
    const hint = all
      ? 'All saved chats. /chat 2 to switch.'
      : 'Chats in this workspace. /chats all for other dirs. /chat 2 to switch.';
    return `${hint}\n\n${body}`;
  };

  const handleSlash = async (line) => {
    const [rawCmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const cmd = canonSlash(rawCmd);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'help':
        ui.note(slashHelp(arg, { ...settings, model, yolo: permissions.yolo }));
        return 'ok';
      case 'exit':
        return 'exit';
      case 'clear':
      case 'new':
        startBlankChat('New chat. Previous one is saved. /chats to switch.');
        return 'save';
      case 'chats':
        ui.note(chatsNote(arg === 'all'));
        return 'ok';
      case 'chat': {
        if (!arg) {
          ui.note(chatsNote(false));
          return 'ok';
        }
        const found = resolveSessionRef(arg, { cwd });
        if (found.error) {
          ui.note(found.error);
          return 'ok';
        }
        if (found.session.id === chatId) {
          ui.note(`Already in ${chatTitle}`);
          return 'ok';
        }
        openChat(found.session);
        return 'save';
      }
      case 'rename':
        if (!arg) {
          ui.note(chatTitle || 'New chat');
          return 'ok';
        }
        chatTitle = arg;
        persist();
        syncHeader();
        ui.note(`Renamed to ${chatTitle}`);
        return 'ok';
      case 'forget': {
        const target = arg ? resolveSessionRef(arg, { cwd }) : { session: { id: chatId, title: chatTitle } };
        if (target.error) {
          ui.note(target.error);
          return 'ok';
        }
        const id = target.session.id;
        const title = target.session.title || id;
        const wasCurrent = id === chatId;
        const gone = deleteSession(id);
        if (wasCurrent) {
          chatId = newChatId();
          chatTitle = 'New chat';
          chatCreatedAt = undefined;
          messages = [{ role: 'system', content: buildSystemPrompt({ cwd, model, yolo: permissions.yolo }) }];
          ui.clearTranscript();
          syncHeader();
          ui.note(gone ? `Forgot ${title}.` : 'New chat.');
        } else if (gone) {
          ui.note(`Forgot ${title}`);
        } else {
          ui.note(`No saved chat ${title}`);
        }
        return 'ok';
      }
      case 'tools':
        ui.note(toolsBlock());
        return 'ok';
      case 'compact':
        messages = compactMessages(messages, { keep: 10 });
        ui.note('Compacted earlier turns.');
        return 'save';
      case 'model':
        if (arg) {
          model = arg;
          saveLastBracketModel(model);
          syncHeader();
          ui.note(`Model set to ${model}`);
          return 'save';
        }
        ui.note(modelIds.length ? modelIds.join(', ') : model);
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
        try {
          ui.note(await creditsText());
          billing = await loadBilling(auth);
          syncHeader();
        } catch (err) {
          ui.error(err?.message || String(err));
        }
        return 'ok';
      case 'whoami':
        try {
          ui.note(await whoamiText());
        } catch (err) {
          ui.error(err?.message || String(err));
        }
        return 'ok';
      case 'key': {
        const sub = String(rest[0] || 'show').toLowerCase();
        try {
          if (!sub || sub === 'show' || sub === 'status') {
            const { info, cloud } = await describeBracketKey(auth, { sessionSecret: auth.apiKey });
            ui.note(formatBracketKeyStatus(info, { cloud, sessionSecret: auth.apiKey }));
            return 'ok';
          }
          if (sub === 'roll') {
            const result = await rollBracketKey(auth, { sessionSecret: auth.apiKey });
            auth.apiKey = result.secret;
            auth.keySource = result.envWins ? 'env' : 'bracket.key';
            ui.note(formatRollResult(result));
            return 'ok';
          }
          if (sub === 'revoke') {
            const result = await revokeBracketKey(auth, { sessionSecret: auth.apiKey });
            auth.apiKey = '';
            auth.keySource = '';
            ui.note(formatRevokeResult(result));
            return 'ok';
          }
          ui.note(slashHelp('key'));
        } catch (err) {
          ui.error(err?.message || String(err));
        }
        return 'ok';
      }
      case 'settings':
        ui.note(settingsBlock(settings));
        return 'ok';
      case 'stream':
        try {
          settings = patchSettings(settings, { stream: parseBoolArg(arg, settings.stream) });
          syncHeader();
          ui.note(
            settingNote(
              'Stream',
              settings.stream ? 'on' : 'off',
              settings.stream
                ? 'Tokens arrive as they generate. Vet 1 and tier1 are required, so those are set.'
                : 'Wait for the full completion. You can raise /vet or /security.'
            ) + `\n\n${settingsBlock(settings)}`
          );
        } catch (err) {
          ui.note(`${err?.message || String(err)}\n\n${slashHelp('stream', settings)}`);
        }
        return 'ok';
      case 'think':
        try {
          settings = patchSettings(settings, { thinking: parseBoolArg(arg, settings.thinking) });
          syncHeader();
          ui.note(
            settingNote(
              'Thinking',
              settings.thinking ? 'on' : 'off',
              settings.thinking
                ? 'The model plans first. That plan shows as a muted think block.'
                : 'Skip the planning pass when the model honors the toggle.'
            ) + `\n\n${settingsBlock(settings)}`
          );
        } catch (err) {
          ui.note(`${err?.message || String(err)}\n\n${slashHelp('think', settings)}`);
        }
        return 'ok';
      case 'region':
        if (!arg) {
          ui.note(slashHelp('region', settings));
          return 'ok';
        }
        settings = patchSettings(settings, { region: arg });
        syncHeader();
        ui.note(settingNote('Region', settings.region, 'Where the job may run.') + `\n\n${settingsBlock(settings)}`);
        return 'ok';
      case 'vet':
        if (!arg) {
          ui.note(slashHelp('vet', settings));
          return 'ok';
        }
        settings = patchSettings(settings, { vet: Number(arg) });
        syncHeader();
        ui.note(
          settingNote(
            'Vet',
            String(settings.vet),
            settings.stream
              ? 'Streaming is on, so vet stays 1. /stream off first if you need 2 or 3.'
              : 'Replica checks before return. 2 or 3 turn streaming off.'
          ) + `\n\n${settingsBlock(settings)}`
        );
        return 'ok';
      case 'security':
        if (!arg) {
          ui.note(slashHelp('security', settings));
          return 'ok';
        }
        settings = patchSettings(settings, { security: arg });
        syncHeader();
        ui.note(
          settingNote(
            'Security',
            settings.security,
            settings.stream
              ? 'Streaming is on, so security stays tier1. /stream off first for tier2.5.'
              : 'tier2.5 is stricter and cannot stream.'
          ) + `\n\n${settingsBlock(settings)}`
        );
        return 'ok';
      default:
        ui.note(`Unknown slash command: /${cmd}. Try /help or /help ${cmd}.`);
        return 'ok';
    }
  };

  const runUserTurn = async (text, signal) => {
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
        signal,
      });
      return true;
    } catch (err) {
      const last = messages[messages.length - 1];
      if (last?.role === 'user' && last.content === text) {
        messages.pop();
      }
      if (err?.interrupted || /aborted|interrupted/i.test(err?.message || '')) {
        ui.note('Interrupted.');
      } else {
        ui.error(err?.message || String(err));
      }
      return false;
    }
  };

  const sendTurn = async (text) => {
    ui.user(text);
    const ac = new AbortController();
    ui.beginWork(() => ac.abort());
    try {
      return await runUserTurn(text, ac.signal);
    } finally {
      ui.endWork();
    }
  };

  ui.enter();
  let quitCli = false;
  try {
    billing = await loadBilling(auth);
    ui.banner({
      cwd,
      email: auth.email || '',
      ...headerBits(),
    });
    if (flags.continue) {
      ui.replay(messages);
      ui.note(`Continued ${chatTitle}`);
    }

    let restore = '';
    if (promptText) {
      const ok = await sendTurn(promptText);
      persist();
      if (!ok) restore = promptText;
    }

    while (true) {
      let line;
      try {
        line = (await ui.readLine({ initial: restore })).trim();
        restore = '';
      } catch (err) {
        if (err?.interrupted) {
          quitCli = true;
          break;
        }
        throw err;
      }
      if (!line) continue;
      if (line.startsWith('/')) {
        const slashName = canonSlash(line.slice(1).trim().split(/\s+/)[0] || '');
        if (slashName !== 'exit') ui.user(line);
        let act = 'ok';
        try {
          act = await handleSlash(line);
        } catch (err) {
          ui.error(err?.message || String(err));
        }
        if (act === 'exit') {
          quitCli = true;
          break;
        }
        if (act === 'save') persist();
        continue;
      }
      const ok = await sendTurn(line);
      persist();
      if (!ok) restore = line;
    }
  } finally {
    persist();
    ui.leave();
  }
  if (quitCli) process.exit(0);
}
