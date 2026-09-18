const ALIAS = {
  streaming: 'stream',
  thinking: 'think',
  models: 'model',
  setting: 'settings',
  quit: 'exit',
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
    detail: 'Saves this session and returns to the shell. /quit does the same.',
  },
  clear: {
    usage: '/clear',
    summary: 'Drop the conversation, keep the workspace',
    detail: 'Starts a new chat in this directory. Files on disk are not touched.',
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
      'Pass an id to use it for the next turn: /model qwen-3-8b',
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
  settings: {
    usage: '/settings',
    summary: 'Show labeled inference options',
    detail:
      'Stream, thinking, region, vet, and security — each with its current value\n' +
      'and a short explanation. Change them with the matching slash command.\n' +
      'The banner line is a compact reminder of the same five fields.',
  },
  stream: {
    usage: '/stream [on|off]',
    summary: 'Tokens as they arrive (default on)',
    detail:
      'On: the API streams tokens. That requires vet 1 and security tier1;\n' +
      'Bracket sets those headers for you.\n' +
      'Off: wait for the full completion. Needed for vet 2–3 or tier2.5.\n' +
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
      '2  two checks — turns streaming off\n' +
      '3  three checks — turns streaming off\n' +
      'Sent as X-Scalattice-Vet-Replicas. Higher values cost more. No argument shows help.',
  },
  security: {
    usage: '/security [tier1|tier2.5]',
    summary: 'Routing security policy',
    detail:
      'tier1    standard routing (required for streaming)\n' +
      'tier2.5  stricter policy — turns streaming off\n' +
      'Sent as X-Scalattice-Security. No argument shows this help and the current value.',
  },
};

function canonSlash(name) {
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
    case 'model':
      return s.model || '';
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
      'Replica checks (1–3). Above 1 turns streaming off.',
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
