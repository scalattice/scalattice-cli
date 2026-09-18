import { cmdLogin, cmdLogout, ensureDeveloperAudience, ensureProviderAudience } from './commands/login.js';
import {
  cmdDevelopersKeysList,
  cmdDevelopersKeysCreate,
  cmdDevelopersKeysRoll,
  cmdDevelopersKeysRevoke,
} from './commands/developers.js';
import {
  cmdAccountKeysList,
  cmdAccountKeysCreate,
  cmdAccountKeysRoll,
  cmdAccountKeysRevoke,
} from './commands/account.js';
import { cmdCredits, cmdInit, cmdWhoami } from './commands/misc.js';
import { cmdSetup } from './commands/setup.js';
import {
  cmdProviderMachinesList,
  cmdProviderMachinesCreate,
  cmdProviderMachinesRoll,
  cmdProviderMachinesRevoke,
  cmdProviderEarnings,
  cmdProviderPause,
  cmdProviderResume,
  cmdProviderSchedule,
  cmdProviderReconnect,
} from './commands/provider.js';
import { runMcpServer } from './commands/mcp.js';
import { cmdBracket, BRACKET_HELP } from './bracket/index.js';
import { print, setPromptInterface } from './io.js';
import { configPath, loadConfig } from './config.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const HELP = `scalattice - CLI for Scalattice Cloud (developers + providers)

The CLI stores a session (same idea as the Cloud cookie). It does not store
API keys or management keys. For the OpenAI SDK or MCP, export them yourself.

Usage:
  scalattice
  scalattice login [--email you@example.com]
  scalattice logout
  scalattice init
  scalattice credits
  scalattice whoami
  scalattice mcp
  scalattice bracket ["prompt"] [--yolo] [--print] [--model ID]

Bracket:
  scalattice bracket
  scalattice bracket "fix the failing tests"
  scalattice bracket --help

Developers (inference API keys slt_…):
  scalattice developers keys list|create|roll|revoke

Account (management keys slt_mgmt_…):
  scalattice account keys list|create|roll|revoke

Provider fleet:
  scalattice provider machines
  scalattice provider machines create [--name NAME]
  scalattice provider machines roll --machine ID
  scalattice provider machines revoke --machine ID
  scalattice provider earnings
  scalattice provider pause
  scalattice provider resume
  scalattice provider schedule --machine ID --mode always|paused|windows [--windows JSON]
  scalattice provider reconnect --machine ID

Aliases: developer/developers, provider/providers, machine/machines, key/keys.

Quick start:
  1. scalattice login
  2. scalattice credits
  3. scalattice developers keys create   # prints an inference key once
  4. eval "$(scalattice init)"          # after SCALATTICE_API_KEY is in the env

Config file: ${configPath()}
Env: SCALATTICE_CLOUD_URL, SCALATTICE_API_URL, SCALATTICE_SESSION_TOKEN,
  SCALATTICE_API_KEY, OPENAI_API_KEY, SCALATTICE_MGMT_KEY, SCALATTICE_BRACKET_MODEL
`;

const SHELL_HELP = `Commands:
  whoami
  login [--email …]
  logout
  credits
  bracket ["prompt"]
  developers keys list|create|roll|revoke
  account keys list|create|roll|revoke
  init
  provider machines [list|create|roll|revoke]|earnings|pause|resume|schedule|reconnect
  help
  exit

Aliases: developer, providers, machine, key
One-shot from any terminal: scalattice <command>
Config: ${configPath()}`;

const KEYS_MOVED =
  'Inference keys: developers keys list|create|roll|revoke\nAccount management keys: account keys list|create|roll|revoke\nMachine tokens: provider machines create|roll|revoke';

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

function canon(word, aliases) {
  const w = String(word || '').toLowerCase();
  return aliases[w] || w;
}

const CMD_ALIAS = {
  developer: 'developers',
  developers: 'developers',
  provider: 'provider',
  providers: 'provider',
  backet: 'bracket',
  braket: 'bracket',
  brackett: 'bracket',
};

function asKeys(word) {
  return canon(word, { key: 'keys', keys: 'keys' });
}

function asMachines(word) {
  return canon(word, { machine: 'machines', machines: 'machines' });
}

function topicOf(sub) {
  const keys = asKeys(sub);
  if (keys === 'keys' && (sub === 'key' || sub === 'keys')) return 'keys';
  const machines = asMachines(sub);
  if (machines === 'machines' && (sub === 'machine' || sub === 'machines')) return 'machines';
  return sub;
}

async function withDeveloperWorkspace() {
  const cfg = loadConfig();
  if (cfg.sessionToken) await ensureDeveloperAudience(cfg);
}

async function withProviderWorkspace() {
  const cfg = loadConfig();
  if (cfg.sessionToken) await ensureProviderAudience(cfg);
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
    else if (a === '--yolo' || a === '--auto' || a === '--dangerously-skip-permissions') flags.yolo = true;
    else if (a === '--print' || a === '-p') flags.print = true;
    else if (a === '--continue' || a === '-c') flags.continue = true;
    else if (a === '--model') flags.model = argv[++i];
    else if (a === '--cwd') flags.cwd = argv[++i];
    else if (a === '--max-turns') flags.maxTurns = Number(argv[++i]);
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    else positionals.push(a);
  }
  return { flags, positionals };
}

async function runKeysGroup(action, rest, flags, {
  list,
  create,
  roll,
  revoke,
  noun,
}) {
  const idRest = rest.slice(1);
  if (action === 'list') await list();
  else if (action === 'create') await create(flags);
  else if (action === 'roll') await roll(flags, idRest);
  else if (action === 'revoke') await revoke(flags, idRest);
  else {
    throw new Error(
      usage(
        flags.shell,
        `Usage: scalattice ${noun} keys list|create|roll|revoke`,
        `Usage: ${noun} keys list|create|roll|revoke`
      )
    );
  }
}

async function runDevelopers(sub, rest, flags) {
  if (sub === 'setup') {
    throw new Error(
      usage(
        flags.shell,
        'No setup step. Use: scalattice login, then developers keys create',
        'No setup step. Use: login, then developers keys create'
      )
    );
  }
  await withDeveloperWorkspace();
  switch (topicOf(sub)) {
    case 'keys':
      await runKeysGroup(rest[0], rest, flags, {
        list: cmdDevelopersKeysList,
        create: cmdDevelopersKeysCreate,
        roll: cmdDevelopersKeysRoll,
        revoke: cmdDevelopersKeysRevoke,
        noun: 'developers',
      });
      break;
    default:
      throw new Error(
        usage(
          flags.shell,
          `Usage: scalattice developers keys list|create|roll|revoke\n\n${HELP}`,
          'Usage: developers keys list|create|roll|revoke'
        )
      );
  }
}

async function runAccount(sub, rest, flags) {
  switch (topicOf(sub)) {
    case 'keys':
      await runKeysGroup(rest[0], rest, flags, {
        list: cmdAccountKeysList,
        create: cmdAccountKeysCreate,
        roll: cmdAccountKeysRoll,
        revoke: cmdAccountKeysRevoke,
        noun: 'account',
      });
      break;
    default:
      throw new Error(
        usage(
          flags.shell,
          'Usage: scalattice account keys list|create|roll|revoke',
          'Usage: account keys list|create|roll|revoke'
        )
      );
  }
}

async function runProvider(sub, rest, flags) {
  if (sub === 'setup') {
    throw new Error(
      usage(
        flags.shell,
        'No setup step. Use: scalattice login, then provider machines create',
        'No setup step. Use: login, then provider machines create'
      )
    );
  }
  await withProviderWorkspace();
  switch (topicOf(sub)) {
    case 'keys':
      throw new Error(
        usage(
          flags.shell,
          'Machine tokens belong to machines. Use: scalattice provider machines create|roll|revoke',
          'Machine tokens belong to machines. Use: provider machines create|roll|revoke'
        )
      );
    case 'machines': {
      const action = rest[0];
      const idRest = rest.slice(1);
      if (!action || action === 'list') await cmdProviderMachinesList();
      else if (action === 'create') await cmdProviderMachinesCreate(flags);
      else if (action === 'roll') await cmdProviderMachinesRoll(flags, idRest);
      else if (action === 'revoke') await cmdProviderMachinesRevoke(flags, idRest);
      else if (action === 'reconnect') await cmdProviderReconnect(flags, idRest);
      else {
        throw new Error(
          usage(
            flags.shell,
            'Usage: scalattice provider machines [list|create|roll|revoke]',
            'Usage: provider machines [list|create|roll|revoke]'
          )
        );
      }
      break;
    }
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
      await cmdProviderReconnect(flags, rest);
      break;
    default:
      throw new Error(
        usage(
          flags.shell,
          `Usage: scalattice provider machines|earnings|pause|resume|schedule|reconnect\n\n${HELP}`,
          'Usage: provider machines|earnings|pause|resume|schedule|reconnect'
        )
      );
  }
}

async function dispatch(argv, { shell = false, rl } = {}) {
  const { flags, positionals } = parseArgs(argv);
  flags.shell = shell;
  const [rawCmd, sub, ...rest] = positionals;
  const cmd = CMD_ALIAS[rawCmd] || rawCmd;

  if (!cmd || cmd === 'help' || (flags.help && cmd !== 'bracket')) {
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
      throw new Error(KEYS_MOVED);
    case 'developers':
      await runDevelopers(sub, rest, flags);
      break;
    case 'account':
      await runAccount(sub, rest, flags);
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
    case 'bracket': {
      if (flags.help) {
        print(BRACKET_HELP.trim());
        break;
      }
      const prompt = [sub, ...rest].filter(Boolean).join(' ');
      const parentRl = rl;
      if (parentRl) {
        parentRl.pause();
        setPromptInterface(null);
      }
      try {
        await cmdBracket({ flags, prompt });
      } finally {
        if (parentRl) {
          parentRl.resume();
          setPromptInterface(parentRl);
        }
      }
      break;
    }
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
  setPromptInterface(rl);
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
        await dispatch(argv, { shell: true, rl });
      } catch (err) {
        print(err?.message || String(err));
      }
    }
  } finally {
    setPromptInterface(null);
    rl.close();
  }
}

export async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const [rawCmd] = positionals;
  const cmd = CMD_ALIAS[rawCmd] || rawCmd;

  if (cmd === 'help' || (flags.help && cmd !== 'bracket')) {
    print(HELP.trim());
    return;
  }
  if (!cmd) {
    if (flags.yolo || flags.print || flags.continue) {
      await cmdBracket({ flags, prompt: '' });
      return;
    }
    if (input.isTTY && output.isTTY) {
      await runPrompt();
      return;
    }
    print(HELP.trim());
    return;
  }
  await dispatch(argv);
}
