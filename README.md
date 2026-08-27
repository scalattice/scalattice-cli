<p align="center">
  <img src="https://raw.githubusercontent.com/scalattice/scalattice-cli/production/media/earth.png" alt="Scalattice developer CLI" width="100%" />
</p>

# Scalattice CLI

[![npm](https://img.shields.io/npm/v/scalattice-cli.svg)](https://www.npmjs.com/package/scalattice-cli)
[![license](https://img.shields.io/npm/l/scalattice-cli.svg)](./LICENSE)

Sign in from a terminal, land in an interactive CLI, mint an account management key (`slt_mgmt_…`) for automation, create an inference API key (`slt_…`) for OpenAI-compatible SDKs, check credits, and manage a provider fleet. Optional MCP mode for AI coding agents.

**Product:** [scalattice.com/cli](https://scalattice.com/cli/) · **npm:** [scalattice-cli](https://www.npmjs.com/package/scalattice-cli) · **Cloud docs:** [developers#cli](https://scalattice.cloud/docs/developers#cli) · [providers#fleet-api](https://scalattice.cloud/docs/providers#fleet-api) · **Installer:** [scalattice.cloud/install/cli](https://scalattice.cloud/install/cli)

## Install

```bash
# Paste-friendly
curl -fsSL https://scalattice.cloud/install/cli | sh

# Or with npm (Node 18+)
npm install -g scalattice-cli
```

Or sign in on [Cloud /auth](https://scalattice.cloud/auth) and run the curl command shown there. That stores a session in `~/.config/scalattice/config.json`, signs the browser tab in, installs this CLI if needed, and opens the prompt.

## Quick start

```bash
scalattice
```

You get a `scalattice>` prompt. Type commands without the `scalattice` prefix:

```
scalattice> whoami
scalattice> setup
scalattice> credits
scalattice> help
scalattice> exit
```

`setup` mints an account management key and an inference key. Then:

```bash
eval "$(scalattice init)"
```

One-shot from any shell still works: `scalattice setup`, `scalattice whoami`, and the rest.

Then use any OpenAI SDK:

```python
from openai import OpenAI
client = OpenAI()  # uses OPENAI_BASE_URL + OPENAI_API_KEY
print(client.models.list())
```

## Keys

| Prefix | Role |
| --- | --- |
| `slt_mgmt_…` | Account management: credits, inference-key CRUD, fleet |
| `slt_…` | Inference only (chat/completions via `api.*`) |
| `slt_provider_…` | Machine agent tokens (not for this CLI) |

Create/roll management keys on [Account](https://scalattice.cloud/account) or via `setup` / `provider keys`.

## Commands

Inside the prompt, drop the `scalattice` prefix. From a normal terminal, keep it.

| Command | What it does |
| --- | --- |
| `scalattice` | Interactive prompt (`setup`, `whoami`, …) |
| `setup` | Login → mint mgmt key → create inference key → print exports |
| `login` / `logout` | Session only |
| `keys list` / `keys create` | Inference API keys (via mgmt key) |
| `init` | Print `export OPENAI_BASE_URL=...` and `OPENAI_API_KEY=...` |
| `credits` | Wallet + model grants (via mgmt key) |
| `whoami` | Show config / account |
| `provider setup` | Ensure provider audience + mgmt key |
| `provider machines` / `earnings` | Fleet status and earnings |
| `provider pause` / `resume` | Pause or resume all machines |
| `provider schedule` | Patch one machine’s schedule |
| `provider keys …` | List / create / roll / revoke management keys (session) |
| `mcp` | MCP stdio server (run as `scalattice mcp`, not inside the prompt) |

Config: `~/.config/scalattice/config.json` (mode `0600`).

Env overrides: `SCALATTICE_CLOUD_URL`, `SCALATTICE_API_URL`, `SCALATTICE_API_KEY`, `SCALATTICE_MGMT_KEY`, `SCALATTICE_SESSION_TOKEN`.

## Provider fleet

```bash
scalattice provider setup
scalattice provider machines
scalattice provider pause   # or resume
```

See [Fleet API docs](https://scalattice.cloud/docs/providers#fleet-api).

## MCP (optional)

MCP is **not** a second install. After `setup`, leave the prompt and run `scalattice mcp`:

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

## License

MIT
