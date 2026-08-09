<p align="center">
  <img src="https://raw.githubusercontent.com/scalattice/scalattice-cli/main/media/earth.png" alt="Scalattice developer CLI" width="100%" />
</p>

# Scalattice CLI

[![npm](https://img.shields.io/npm/v/scalattice-cli.svg)](https://www.npmjs.com/package/scalattice-cli)
[![license](https://img.shields.io/npm/l/scalattice-cli.svg)](./LICENSE)

Sign in, create a developer API key, print OpenAI-compatible env vars, check credits, and manage a provider fleet (`slt_mgmt_…`) - from the terminal. Optional MCP mode for AI coding agents.

**Product:** [scalattice.com/cli](https://scalattice.com/cli/) · **npm:** [scalattice-cli](https://www.npmjs.com/package/scalattice-cli) · **Cloud docs:** [developers#cli](https://scalattice.cloud/docs/developers#cli) · [providers#fleet-api](https://scalattice.cloud/docs/providers#fleet-api) · **Installer:** [scalattice.cloud/install/cli](https://scalattice.cloud/install/cli)

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
| `scalattice keys list` / `keys create` | Manage developer API keys |
| `scalattice init` | Print `export OPENAI_BASE_URL=...` and `OPENAI_API_KEY=...` |
| `scalattice credits` | `GET /v1/credits` (wallet + model grants) |
| `scalattice whoami` | Show config paths / what’s stored |
| `scalattice provider setup` | Login → provider profile → create/save Fleet API key (`slt_mgmt_…`) |
| `scalattice provider machines` / `earnings` | Fleet status and earnings |
| `scalattice provider pause` / `resume` | Pause or resume all machines |
| `scalattice provider schedule` | Patch one machine’s schedule |
| `scalattice provider keys …` | List / create / roll / revoke Fleet API keys |
| `scalattice mcp` | MCP stdio server for Cursor / Claude Desktop |

Config: `~/.config/scalattice/config.json` (mode `0600`).

Env overrides: `SCALATTICE_CLOUD_URL`, `SCALATTICE_API_URL`, `SCALATTICE_API_KEY`, `SCALATTICE_MGMT_KEY`, `SCALATTICE_SESSION_TOKEN`.

## Provider fleet

```bash
scalattice provider setup
scalattice provider machines
scalattice provider pause   # or resume
```

Create/roll keys on the Providers dashboard or via `scalattice provider keys`. See [Fleet API docs](https://scalattice.cloud/docs/providers#fleet-api).

## MCP (optional)

MCP is **not** a second install. After `scalattice setup` and/or `scalattice provider setup`:

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

Developer tools (when an API key is stored): `scalattice_credits`, `scalattice_models`, `scalattice_env`.

Fleet tools (when a management key is stored): `scalattice_fleet_machines`, `scalattice_fleet_earnings`, `scalattice_fleet_set_availability`.

## Develop

```bash
git clone https://github.com/scalattice/scalattice-cli.git
cd scalattice-cli
node bin/scalattice.js --help
```

## License

MIT
