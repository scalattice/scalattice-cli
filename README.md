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

`login` stores a session only. For the OpenAI SDK, create a key and export it:

```bash
scalattice developers keys create
eval "$(scalattice init)"   # after OPENAI_API_KEY is in the env
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
| `slt_provider_…` | Machine agent token (`provider machines create` / `roll`; goes on the GPU host) |

Create management keys on [Account](https://scalattice.cloud/account) or `account keys create` if you need a long-lived secret for MCP. The CLI itself uses your session.

## Commands

Inside the prompt, drop the `scalattice` prefix. From a normal terminal, keep it.

| Command | What it does |
| --- | --- |
| `scalattice` | Interactive prompt (`setup`, `whoami`, …) |
| `setup` | Login and set developer workspace |
| `login` / `logout` | Session only (what `config.json` stores) |
| `developers setup` | Login and set developer workspace |
| `developers keys list|create|roll|revoke` | Inference API keys (prints secret once; not stored) |
| `account keys list|create|roll|revoke` | Account management keys (prints secret once; not stored) |
| `init` | Print OpenAI env exports (needs `OPENAI_API_KEY` in the env) |
| `credits` | Wallet + model grants |
| `whoami` | Show session / account |
| `provider setup` | Login and set provider workspace |
| `provider machines` | List fleet (id, status, token last four) |
| `provider machines create` | Add a machine (prints `slt_provider_…` once) |
| `provider machines roll` | New token for an existing machine (prints once) |
| `provider machines revoke` | Remove a never-connected machine |
| `provider earnings` | Fleet earnings |
| `provider pause` / `resume` | Pause or resume all machines |
| `provider schedule` | Patch one machine’s schedule |
| `mcp` | MCP stdio server (run as `scalattice mcp`, not inside the prompt) |

Config: `~/.config/scalattice/config.json` (mode `0600`) — session + email only. Keys are never written there.

Env overrides: `SCALATTICE_CLOUD_URL`, `SCALATTICE_API_URL`, `SCALATTICE_API_KEY`, `SCALATTICE_MGMT_KEY`, `SCALATTICE_SESSION_TOKEN`.

## Provider fleet

```bash
scalattice provider setup
scalattice provider machines create
scalattice provider machines
scalattice provider pause   # or resume
```

See [Fleet API docs](https://scalattice.cloud/docs/providers#fleet-api).

## MCP (optional)

MCP is **not** a second install. After `login`, leave the prompt and run `scalattice mcp`. For a headless agent without a session, set `SCALATTICE_MGMT_KEY` in that environment.

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
