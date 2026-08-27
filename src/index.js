import { cmdLogin, cmdLogout } from './commands/login.js';
import { cmdKeysCreate, cmdKeysList } from './commands/keys.js';
import { cmdCredits, cmdInit, cmdWhoami } from './commands/misc.js';
import { cmdSetup } from './commands/setup.js';
import {
  cmdProviderSetup,
  cmdProviderKeysList,
  cmdProviderKeysCreate,
  cmdProviderKeysRoll,
  cmdProviderKeysRevoke,
  cmdProviderMachines,
  cmdProviderEarnings,
  cmdProviderPause,
  cmdProviderResume,
  cmdProviderSchedule,
  cmdProviderReconnect,
} from './commands/provider.js';
import { runMcpServer } from './commands/mcp.js';
import { print } from './io.js';
import { configPath } from './config.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const HELP = `scalattice - CLI for Scalattice Cloud (developers + providers)

Keys:
  slt_mgmt_…  account management (credits, keys CRUD, fleet) — SCALATTICE_MGMT_KEY
  slt_…       inference only (OpenAI SDK) — SCALATTICE_API_KEY / OPENAI_API_KEY

Usage:
  scalattice
  scalattice setup [--email you@example.com] [--login] [--new-key]
  scalattice login [--email you@example.com]
  scalattice logout
  scalattice keys list
  scalattice keys create [--name NAME]
  scalattice init
  scalattice credits
  scalattice whoami
  scalattice mcp

Provider fleet (uses account management key):
  scalattice provider setup [--email …] [--new-key] [--name NAME] [--paste KEY]
  scalattice provider keys list|create|roll|revoke
  scalattice provider machines
  scalattice provider earnings
  scalattice provider pause
  scalattice provider resume
  scalattice provider schedule --machine ID --mode always|paused|windows [--windows JSON]
  scalattice provider reconnect --machine ID

Quick start:
  1. scalattice setup          # mints mgmt key + inference key
  2. eval "$(scalattice init)" # OpenAI env for SDKs
  3. scalattice credits
  4. scalattice provider machines   # if you host GPUs

Config file: ${configPath()}
Env overrides: SCALATTICE_CLOUD_URL, SCALATTICE_API_URL, SCALATTICE_API_KEY,
  SCALATTICE_MGMT_KEY, SCALATTICE_SESSION_TOKEN
`;

const SHELL_HELP = `Commands:
  whoami
  setup [--email …] [--login] [--new-key]
  login [--email …]
  logout
  credits
  keys list
  keys create [--name NAME]
  init
  provider setup|machines|earnings|pause|resume|keys|schedule|reconnect
  help
  exit

One-shot from any terminal: scalattice <command>
Config: ${configPath()}`;

function parseLine(line) {
  const parts = String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0] === 'scalattice') parts.shift();
  return parts;
}

function usage(shell, oneShot, shellForm) {
  return shell ? shellForm : oneShot;
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--email') flags.email = argv[++i];
    else if (a === '--name') flags.name = argv[++i];
    else if (a === '--id') flags.id = argv[++i];
    else if (a === '--machine') flags.machine = argv[++i];
    else if (a === '--mode') flags.mode = argv[++i];
    else if (a === '--windows') flags.windows = argv[++i];
    else if (a === '--paste') flags.paste = argv[++i];
    else if (a === '--login') flags.forceLogin = true;
    else if (a === '--new-key') flags.newKey = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    else positionals.push(a);
  }
  return { flags, positionals };
}

async function runProvider(sub, rest, flags) {
  switch (sub) {
    case 'setup':
      await cmdProviderSetup(flags);
      break;
    case 'keys': {
      const action = rest[0];
      if (action === 'list') await cmdProviderKeysList();
      else if (action === 'create') await cmdProviderKeysCreate(flags);
      else if (action === 'roll') await cmdProviderKeysRoll(flags);
      else if (action === 'revoke') await cmdProviderKeysRevoke(flags);
      else throw new Error(usage(flags.shell, 'Usage: scalattice provider keys list|create|roll|revoke', 'Usage: provider keys list|create|roll|revoke'));
      break;
    }
    case 'machines':
      await cmdProviderMachines();
      break;
    case 'earnings':
      await cmdProviderEarnings();
      break;
    case 'pause':
      await cmdProviderPause();
      break;
    case 'resume':
      await cmdProviderResume();
      break;
    case 'schedule':
      await cmdProviderSchedule(flags);
      break;
    case 'reconnect':
      await cmdProviderReconnect(flags);
      break;
    default:
      throw new Error(
        usage(
          flags.shell,
          `Usage: scalattice provider setup|keys|machines|earnings|pause|resume|schedule|reconnect\n\n${HELP}`,
          'Usage: provider setup|keys|machines|earnings|pause|resume|schedule|reconnect'
        )
      );
  }
}

async function dispatch(argv, { shell = false } = {}) {
  const { flags, positionals } = parseArgs(argv);
  flags.shell = shell;
  const [cmd, sub, ...rest] = positionals;

  if (!cmd || flags.help || cmd === 'help') {
    print((shell ? SHELL_HELP : HELP).trim());
    return;
  }

  switch (cmd) {
    case 'setup':
      await cmdSetup(flags);
      break;
    case 'login':
      await cmdLogin(flags);
      break;
    case 'logout':
      await cmdLogout();
      break;
    case 'keys':
      if (sub === 'list') await cmdKeysList();
      else if (sub === 'create') await cmdKeysCreate(flags);
      else throw new Error(usage(shell, 'Usage: scalattice keys list|create', 'Usage: keys list|create'));
      break;
    case 'provider':
      await runProvider(sub, rest, flags);
      break;
    case 'init':
      await cmdInit();
      break;
    case 'credits':
      await cmdCredits();
      break;
    case 'whoami':
      await cmdWhoami();
      break;
    case 'mcp':
      await runMcpServer();
      break;
    default:
      throw new Error(
        shell ? `Unknown command: ${cmd}. Try help.` : `Unknown command: ${cmd}\n\n${HELP}`
      );
  }
}

async function runPrompt() {
  print('');
  try {
    await cmdWhoami();
  } catch (err) {
    print(err?.message || String(err));
  }
  print('');
  print('Type a command (help, exit).');
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    while (true) {
      const line = await rl.question('scalattice> ');
      const argv = parseLine(line);
      if (!argv.length) continue;
      if (argv[0] === 'exit' || argv[0] === 'quit') break;
      if (argv[0] === 'mcp') {
        print('mcp is a stdio server. Leave this prompt and run: scalattice mcp');
        continue;
      }
      try {
        await dispatch(argv, { shell: true });
      } catch (err) {
        print(err?.message || String(err));
      }
    }
  } finally {
    rl.close();
  }
}

export async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const [cmd] = positionals;

  if (flags.help || cmd === 'help') {
    print(HELP.trim());
    return;
  }
  if (!cmd) {
    if (input.isTTY && output.isTTY) {
      await runPrompt();
      return;
    }
    print(HELP.trim());
    return;
  }
  await dispatch(argv);
}
