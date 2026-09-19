const ALIAS = {
  streaming: 'stream',
  thinking: 'think',
  models: 'model',
  setting: 'settings',
  providers: 'provider',
  quit: 'exit',
  history: 'chats',
  conversations: 'chats',
  convos: 'chats',
  resume: 'chat',
  open: 'chat',
  newchat: 'new',
  renamechat: 'rename',
  delete: 'forget',
  rm: 'forget',
};

export const SLASH = {
  help: {
    usage: '/help [command]',
    summary: 'List commands, or explain one',
    detail:
      'Bare /help lists every slash command with a one-line summary.\n' +
      'Name one to get usage, the current value, and what it changes.\n' +
      'Examples: /help stream   /help region   /help settings',
  },
  exit: {
    usage: '/exit',
    summary: 'Leave Bracket',
    detail: 'Saves this session, restores the terminal, and leaves the CLI. /quit does the same.',
  },
  clear: {
    usage: '/clear',
    summary: 'Start a new chat; keep the previous one on disk',
    detail:
      'Saves the current chat if it has messages, then opens a blank one.\n' +
      'Same as /new. Files in the workspace are not touched. /chats lists saved chats.',
  },
  new: {
    usage: '/new',
    summary: 'Start a new chat',
    detail: 'Saves the current chat and opens a blank one. /chats to switch back.',
  },
  chats: {
    usage: '/chats [all]',
    summary: 'List saved chats',
    detail:
      'Shows recent chats for this workspace, newest first.\n' +
      'On a wide terminal they sit in a full-height panel on the right.\n' +
      'Wheel over the panel to scroll. Click a row to switch.\n' +
      '/chats all includes other directories.\n' +
      'Switch with /chat 2 or /chat <id>. Stored under the local data dir.',
  },
  chat: {
    usage: '/chat [n|id|title]',
    summary: 'Switch to a saved chat',
    detail:
      'No argument lists chats.\n' +
      '/chat 2 opens the second row from /chats.\n' +
      'You can also pass an id prefix or part of the title.',
  },
  rename: {
    usage: '/rename [title]',
    summary: 'Rename the current chat',
    detail: 'Bare /rename shows the current title. Pass a name to set it.',
  },
  forget: {
    usage: '/forget [n|id]',
    summary: 'Delete a saved chat',
    detail:
      'No argument deletes the current chat and opens a blank one.\n' +
      'Pass a list number or id to delete that chat instead.',
  },
  compact: {
    usage: '/compact',
    summary: 'Shrink earlier turns to free context',
    detail: 'Keeps recent messages and a short summary of the rest.',
  },
  model: {
    usage: '/model [id]',
    summary: 'Show catalog models, or switch to one',
    detail:
      'No argument lists ids the inference API returned.\n' +
      'Pass an id to use it for the next turn: /model qwen-3-8b\n' +
      'Bracket remembers the last model for new chats and the next launch.',
  },
  yolo: {
    usage: '/yolo [on|off]',
    summary: 'Skip approval prompts for shell and writes',
    detail:
      'Off (default): Bracket asks before bash, write, and edit.\n' +
      'On: those tools run without asking. Same as --yolo on the command line.\n' +
      'Bare /yolo toggles.',
  },
  credits: {
    usage: '/credits',
    summary: 'Wallet and model grants',
    detail: 'Prints the same billing snapshot as scalattice credits.',
  },
  whoami: {
    usage: '/whoami',
    summary: 'CLI version, cloud, session, inference key',
    detail: 'Prints the same snapshot as scalattice whoami.',
  },
  provider: {
    usage: '/provider [list|add|use|rm|key]',
    summary: 'Inference providers and their keys',
    detail:
      'Bare /provider lists records. Scalattice is builtin and cannot be removed.\n' +
      '/provider use NAME              switch provider (and its model)\n' +
      '/provider add NAME URL          add an OpenAI-compatible endpoint\n' +
      '/provider rm NAME               delete a custom provider (not Scalattice)\n' +
      '/provider url URL               change the URL of the active custom provider\n' +
      '/provider key                   show the active provider key (never the full secret here)\n' +
      '/provider key set SECRET        write a key by hand\n' +
      '/provider key new               mint a Scalattice key named "CLI bracket"\n' +
      '/provider key roll              rotate, or mint if the Cloud key was revoked\n' +
      '/provider key revoke            revoke Cloud key and delete the local secret\n' +
      'Scalattice keys live in ~/.config/scalattice/bracket.key (mode 0600).\n' +
      'Same as: scalattice bracket provider …',
  },
  settings: {
    usage: '/settings',
    summary: 'Show labeled inference options',
    detail:
      'Stream, thinking, region, vet, and security, each with its current value\n' +
      'and a short explanation. Change them with the matching slash command.\n' +
      'The banner line is a compact reminder of the same five fields.',
  },
  stream: {
    usage: '/stream [on|off]',
    summary: 'Tokens as they arrive (default on)',
    detail:
      'On: the API streams tokens. That requires vet 1 and security tier1;\n' +
      'Bracket sets those headers for you.\n' +
      'Off: wait for the full completion. Needed for vet 2-3 or tier2.5.\n' +
      'Bare /stream toggles.',
  },
  think: {
    usage: '/think [on|off]',
    summary: 'Ask the model to plan before answering (default on)',
    detail:
      'On: Bracket requests thinking. Plans show in a muted gutter, then the answer.\n' +
      'Off: skip that planning pass when the model honors the toggle.\n' +
      'Bare /think toggles.',
  },
  region: {
    usage: '/region [auto|us|eu|ap]',
    summary: 'Where the job may run',
    detail:
      'auto  any region with capacity (default)\n' +
      'us    United States\n' +
      'eu    Europe\n' +
      'ap    Asia-Pacific\n' +
      'Sent as X-Scalattice-Region. No argument shows this help and the current value.',
  },
  vet: {
    usage: '/vet [1|2|3]',
    summary: 'How many replica checks before return',
    detail:
      '1  one check (required for streaming)\n' +
      '2  two checks (turns streaming off)\n' +
      '3  three checks (turns streaming off)\n' +
      'Sent as X-Scalattice-Vet-Replicas. Higher values cost more. No argument shows help.',
  },
  security: {
    usage: '/security [tier1|tier2.5]',
    summary: 'Routing security policy',
    detail:
      'tier1    standard routing (required for streaming)\n' +
      'tier2.5  stricter policy (turns streaming off)\n' +
      'Sent as X-Scalattice-Security. No argument shows this help and the current value.',
  },
  tools: {
    usage: '/tools',
    summary: 'List tools the model can call',
    detail: 'Shows bash, read_file, edit_file, web_search, web_fetch, and the rest. Ask in the chat; Bracket runs them.',
  },
};

export function canonSlash(name) {
  const key = String(name || '')
    .trim()
    .replace(/^\//, '')
    .toLowerCase();
  return ALIAS[key] || key;
}

function currentValue(name, settings = {}) {
  const s = settings || {};
  switch (name) {
    case 'stream':
      return s.stream === false ? 'off' : 'on';
    case 'think':
      return s.thinking === false ? 'off' : 'on';
    case 'region':
      return s.region || 'auto';
    case 'vet':
      return String(s.stream === false ? s.vet || 1 : 1);
    case 'security':
      return s.stream === false ? s.security || 'tier1' : 'tier1';
    case 'yolo':
      return s.yolo ? 'on' : 'off';
    case 'provider':
      return s.provider || s.providerId || 'scalattice';
    default:
      return '';
  }
}

export function slashIndex() {
  const names = Object.keys(SLASH);
  const width = Math.max(...names.map((n) => SLASH[n].usage.length));
  return [
    'Slash commands. /help <name> explains one.',
    '',
    ...names.map((n) => `${SLASH[n].usage.padEnd(width + 2)}${SLASH[n].summary}`),
  ].join('\n');
}

export function slashHelp(name, settings = {}) {
  const key = canonSlash(name);
  if (!key) return slashIndex();
  const d = SLASH[key];
  if (!d) {
    const known = Object.keys(SLASH)
      .map((n) => `/${n}`)
      .join('  ');
    return `No help for /${String(name || '').replace(/^\//, '')}. Try /help.\n${known}`;
  }
  const cur = currentValue(key, settings);
  const lines = [d.usage, ''];
  if (cur) lines.push(`Now: ${cur}`, '');
  lines.push(d.detail);
  return lines.join('\n');
}

export function settingsBlock(settings = {}) {
  const s = settings || {};
  const stream = s.stream !== false;
  const rows = [
    ['Stream', stream ? 'on' : 'off', 'Tokens as they arrive. Needs vet 1 and tier1.'],
    [
      'Thinking',
      s.thinking === false ? 'off' : 'on',
      'Model plans first; shown as a muted think block.',
    ],
    ['Region', s.region || 'auto', 'Where to run: auto, us, eu, ap.'],
    [
      'Vet',
      String(stream ? 1 : s.vet || 1),
      'Replica checks (1-3). Above 1 turns streaming off.',
    ],
    [
      'Security',
      stream ? 'tier1' : s.security || 'tier1',
      'tier1 standard. tier2.5 stricter; turns streaming off.',
    ],
  ];
  const titleW = Math.max(...rows.map((r) => r[0].length));
  const valueW = Math.max(...rows.map((r) => String(r[1]).length));
  return [
    'Inference settings',
    '',
    ...rows.map(
      ([title, value, blurb]) =>
        `${title.padEnd(titleW)}  ${String(value).padEnd(valueW)}  ${blurb}`
    ),
    '',
    'Change with /stream /think /region /vet /security.  /help stream for one.',
  ].join('\n');
}

export function settingNote(title, value, detail = '') {
  const head = `${title}: ${value}`;
  return detail ? `${head}\n${detail}` : head;
}

function commonPrefix(items) {
  if (!items.length) return '';
  let prefix = String(items[0]);
  for (const item of items) {
    const s = String(item);
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

function commandNames() {
  return [...new Set([...Object.keys(SLASH), ...Object.keys(ALIAS)])].sort();
}

function argCandidates(cmd, ctx, after = '') {
  switch (cmd) {
    case 'help':
      return Object.keys(SLASH);
    case 'stream':
    case 'think':
    case 'yolo':
      return ['on', 'off'];
    case 'region':
      return ['auto', 'us', 'eu', 'ap'];
    case 'vet':
      return ['1', '2', '3'];
    case 'security':
      return ['tier1', 'tier2.5'];
    case 'chats':
      return ['all'];
    case 'provider': {
      const tokens = String(after).trim().split(/\s+/).filter(Boolean);
      const typed = /\s$/.test(after) ? tokens : tokens.slice(0, -1);
      if (typed[0] === 'key' || typed[0] === 'keys') {
        return ['show', 'set', 'new', 'roll', 'revoke'];
      }
      return [
        'list',
        'add',
        'use',
        'rm',
        'remove',
        'url',
        'key',
        ...(ctx.providers || []).map(String),
      ];
    }
    case 'model':
      return (ctx.models || []).map(String);
    case 'chat':
    case 'forget':
      return (ctx.chats || []).flatMap((row, i) =>
        [String(i + 1), row.id, String(row.id || '').slice(0, 8)].filter(Boolean)
      );
    default:
      return [];
  }
}

function emptyComplete(line) {
  return { completed: line, matches: [], hint: '' };
}

export function completeSlash(input, ctx = {}) {
  const line = String(input || '');
  if (!line.startsWith('/')) return emptyComplete(line);

  const space = line.indexOf(' ');
  if (space === -1) {
    const prefix = line.slice(1).toLowerCase();
    const hits = commandNames().filter((n) => n.startsWith(prefix));
    if (!hits.length) return emptyComplete(line);
    const canons = [...new Set(hits.map((n) => canonSlash(n)))];
    if (canons.length === 1) {
      const done = `/${canons[0]} `;
      return { completed: done, matches: [done], hint: SLASH[canons[0]]?.summary || '' };
    }
    const labels = canons.map((n) => `/${n}`);
    const common = commonPrefix(labels);
    return {
      completed: common.length > line.length ? common : line,
      matches: labels.map((n) => `${n} `),
      hint: labels.join('  '),
    };
  }

  const cmd = canonSlash(line.slice(1, space));
  const after = line.slice(space + 1);
  const last = /\s$/.test(line) ? '' : line.slice(line.search(/\S+$/));
  const head = line.slice(0, line.length - last.length);
  const hits = argCandidates(cmd, ctx, after).filter((c) =>
    String(c).toLowerCase().startsWith(String(last).toLowerCase())
  );
  const uniq = [...new Set(hits)];
  if (!uniq.length) return emptyComplete(line);
  if (!last && uniq.length > 1) {
    return {
      completed: line,
      matches: uniq.map((token) => `${head}${token}${String(token).endsWith('/') ? '' : ' '}`),
      hint: uniq.slice(0, 10).join('  '),
    };
  }
  if (uniq.length === 1) {
    const token = uniq[0];
    const done = `${head}${token}${String(token).endsWith('/') ? '' : ' '}`;
    return { completed: done, matches: [done], hint: '' };
  }
  const common = commonPrefix(uniq);
  return {
    completed: common.length > last.length ? `${head}${common}` : line,
    matches: uniq.map((token) => `${head}${token}`),
    hint: uniq.slice(0, 10).join('  '),
  };
}
