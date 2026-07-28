<p align="center">
  <img src="https://raw.githubusercontent.com/scalattice/scalattice-cli/main/media/earth.png" alt="Scalattice developer CLI" width="100%" />
</p>

# Scalattice CLI

[![npm](https://img.shields.io/npm/v/scalattice-cli.svg)](https://www.npmjs.com/package/scalattice-cli)
[![license](https://img.shields.io/npm/l/scalattice-cli.svg)](./LICENSE)

Sign in, create a developer API key, print OpenAI-compatible env vars, and check credits - from the terminal. Optional MCP mode for AI coding agents.

**Product:** [scalattice.com/cli](https://scalattice.com/cli/) · **npm:** [scalattice-cli](https://www.npmjs.com/package/scalattice-cli) · **Cloud docs:** [developers#cli](https://scalattice.cloud/docs/developers#cli) · **Installer:** [scalattice.cloud/install/cli](https://scalattice.cloud/install/cli)

## Install

```bash
# Paste-friendly
curl -fsSL https://scalattice.cloud/install/cli | sh

# Or with npm (Node 18+)
npm install -g scalattice-cli
```

## Quick start

```bash
scalattice setup
eval "$(scalattice init)"
scalattice credits
```

Then use any OpenAI SDK:

```python
from openai import OpenAI
client = OpenAI()  # uses OPENAI_BASE_URL + OPENAI_API_KEY
print(client.models.list())
```

## Commands

| Command | What it does |
| --- | --- |
| `scalattice setup` | Magic-code login → developer profile → create API key → print exports |
| `scalattice login` / `logout` | Session only |
| `scalattice keys list` / `keys create` | Manage API keys |
| `scalattice init` | Print `export OPENAI_BASE_URL=...` and `OPENAI_API_KEY=...` |
| `scalattice credits` | `GET /v1/credits` (wallet + model grants) |
| `scalattice whoami` | Show config paths / what’s stored |
| `scalattice mcp` | MCP stdio server for Cursor / Claude Desktop |

Config: `~/.config/scalattice/config.json` (mode `0600`).

Env overrides: `SCALATTICE_CLOUD_URL`, `SCALATTICE_API_URL`, `SCALATTICE_API_KEY`, `SCALATTICE_SESSION_TOKEN`.

## MCP (optional)

MCP is **not** a second install. After `scalattice setup`:

```json
{
  "mcpServers": {
    "scalattice": {
      "command": "scalattice",
      "args": ["mcp"]
    }
  }
}
```

Tools: `scalattice_credits`, `scalattice_models`, `scalattice_env`.

## Develop

```bash
git clone https://github.com/scalattice/scalattice-cli.git
cd scalattice-cli
node bin/scalattice.js --help
```

## License

MIT
