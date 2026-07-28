import { cmdLogin, cmdLogout } from './commands/login.js';
import { cmdKeysCreate, cmdKeysList } from './commands/keys.js';
import { cmdCredits, cmdInit, cmdWhoami } from './commands/misc.js';
import { cmdSetup } from './commands/setup.js';
import { runMcpServer } from './commands/mcp.js';
import { print } from './io.js';
import { configPath } from './config.js';

const HELP = `scalattice - developer CLI for Scalattice Cloud

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

Quick start (human or coding agent):
  1. scalattice setup
  2. eval "$(scalattice init)"
  3. Use any OpenAI SDK with that base URL + key

MCP (optional):
  scalattice mcp
  Point Claude Desktop / Cursor at this command after setup.
  MCP exposes tools (credits, models) - it does not create accounts.

Config file: ${configPath()}
Env overrides: SCALATTICE_CLOUD_URL, SCALATTICE_API_URL, SCALATTICE_API_KEY, SCALATTICE_SESSION_TOKEN
`;

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--email') flags.email = argv[++i];
    else if (a === '--name') flags.name = argv[++i];
    else if (a === '--login') flags.forceLogin = true;
    else if (a === '--new-key') flags.newKey = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    else positionals.push(a);
  }
  return { flags, positionals };
}

export async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const [cmd, sub] = positionals;

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
