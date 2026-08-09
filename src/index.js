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
} from './commands/provider.js';
import { runMcpServer } from './commands/mcp.js';
import { print } from './io.js';
import { configPath } from './config.js';

const HELP = `scalattice - CLI for Scalattice Cloud (developers + providers)

Keys:
  slt_mgmt_…  account management (credits, keys CRUD, fleet) — SCALATTICE_MGMT_KEY
  slt_…       inference only (OpenAI SDK) — SCALATTICE_API_KEY / OPENAI_API_KEY

Usage:
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

Quick start:
  1. scalattice setup          # mints mgmt key + inference key
  2. eval "$(scalattice init)" # OpenAI env for SDKs
  3. scalattice credits
  4. scalattice provider machines   # if you host GPUs

Config file: ${configPath()}
Env overrides: SCALATTICE_CLOUD_URL, SCALATTICE_API_URL, SCALATTICE_API_KEY,
  SCALATTICE_MGMT_KEY, SCALATTICE_SESSION_TOKEN
`;

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
      else throw new Error('Usage: scalattice provider keys list|create|roll|revoke');
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
    default:
      throw new Error(
        `Usage: scalattice provider setup|keys|machines|earnings|pause|resume|schedule\n\n${HELP}`
      );
  }
}

export async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const [cmd, sub, ...rest] = positionals;

  if (!cmd || flags.help || cmd === 'help') {
    print(HELP.trim());
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
      else throw new Error('Usage: scalattice keys list|create');
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
      throw new Error(`Unknown command: ${cmd}\n\n${HELP}`);
  }
}
