<p align="center">
  <img src="https://raw.githubusercontent.com/scalattice/scalattice-cli/production/media/earth.png" alt="Scalattice developer CLI" width="100%" />
</p>

# Scalattice CLI

[![npm](https://img.shields.io/npm/v/scalattice-cli.svg)](https://www.npmjs.com/package/scalattice-cli)
[![license](https://img.shields.io/npm/l/scalattice-cli.svg)](./LICENSE)

Sign in from a terminal, land in an interactive CLI, mint an account management key (`slt_mgmt_…`) for automation, create an inference API key (`slt_…`) for OpenAI-compatible SDKs, check credits, and manage a provider fleet. **Bracket** is the coding harness in this same binary (`scalattice bracket`). Optional MCP mode for other editors.

**Product:** [scalattice.com/cli](https://scalattice.com/cli/) · **npm:** [scalattice-cli](https://www.npmjs.com/package/scalattice-cli) · **Cloud docs:** [developers#cli](https://scalattice.cloud/docs/developers#cli) · [providers#fleet-api](https://scalattice.cloud/docs/providers#fleet-api) · **Installer:** [scalattice.cloud/install/cli](https://scalattice.cloud/install/cli)

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
scalattice> login
scalattice> credits
scalattice> help
scalattice> exit
```

`login` stores a session only. For the OpenAI SDK, create a key and export it:

```bash
scalattice developers keys create
eval "$(scalattice init)"   # after SCALATTICE_API_KEY is in the env
```

One-shot from any shell still works: `scalattice login`, `scalattice whoami`, and the rest.

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
| `scalattice` | Interactive prompt (`login`, `whoami`, …) |
| `login` / `logout` | Session only (what `config.json` stores) |
| `developers keys list|create|roll|revoke` | Inference API keys (prints secret once; not stored) |
| `account keys list|create|roll|revoke` | Account management keys (prints secret once; not stored) |
| `init` | Print env exports (`SCALATTICE_API_KEY` plus OpenAI SDK aliases) |
| `credits` | Wallet + model grants |
| `whoami` | Show CLI version / session / account |
| `update` | Check npm and install `scalattice-cli@latest` into this prefix |
| `provider machines` | List fleet (id, status, token last four) |
| `provider machines create` | Add a machine (prints `slt_provider_…` once) |
| `provider machines roll` | New token for an existing machine (prints once) |
| `provider machines revoke` | Remove a never-connected machine |
| `provider earnings` | Fleet earnings |
| `provider pause` / `resume` | Pause or resume all machines |
| `provider schedule` | Patch one machine’s schedule |
| `mcp` | MCP stdio server (run as `scalattice mcp`, not inside the prompt) |
| `bracket` | Coding harness: read/edit files and run commands in this directory |

`developer`/`developers`, `provider`/`providers`, `machine`/`machines`, and `key`/`keys` are aliases.

Config: `~/.config/scalattice/config.json` (mode `0600`) — session + email only. Keys are never written there. Bracket may store its own inference key at `~/.config/scalattice/bracket.key` (also `0600`).

Env overrides: `SCALATTICE_CLOUD_URL`, `SCALATTICE_API_URL`, `SCALATTICE_API_KEY`, `SCALATTICE_MGMT_KEY`, `SCALATTICE_SESSION_TOKEN`, `SCALATTICE_BRACKET_MODEL`, `SCALATTICE_STREAM`, `SCALATTICE_THINKING`, `SCALATTICE_REGION`, `SCALATTICE_VET_REPLICAS`, `SCALATTICE_SECURITY`, `SCALATTICE_NO_UPDATE`.

On a terminal the CLI checks npm every few hours and updates itself when the install prefix is writable. `scalattice update` does it immediately. `--no-update` or `SCALATTICE_NO_UPDATE=1` skips that. MCP and `init` never auto-update (their stdout is consumed).

## Bracket

Bracket is the coding harness in this CLI. `scalattice bracket` takes over the terminal. `scalattice` with no args is still the account prompt.

```bash
scalattice login
scalattice bracket
scalattice bracket "fix the failing tests"
scalattice bracket --print "what does this repo do?"
scalattice bracket --yolo "apply the refactor"
```

Login is enough: Bracket mints a **developer inference key** (`slt_…`) named `CLI bracket` into `~/.config/scalattice/bracket.key`. That is the key type chat completions use. An account management key (`slt_mgmt_…`) cannot call the inference API. To set a key yourself: `export SCALATTICE_API_KEY=slt_…` (`OPENAI_API_KEY` is accepted as an alias). Default model is `qwen-3-coder-30b-a3b` (override with `--model` or `SCALATTICE_BRACKET_MODEL`).

Streaming is on by default and sends `X-Scalattice-Vet-Replicas: 1` plus `X-Scalattice-Security: tier1` (required by the API). Thinking is on by default. Toggle with `--no-stream`, `--no-think`, `--region auto|us|eu|ap`, `--vet 1|2|3`, `--security tier1|tier2.5`, or the matching slash commands. Multi-vet or `tier2.5` turns streaming off.

Inside the prompt: `/help` lists commands; `/help stream` (or region, vet, settings, …) explains one. `/settings` prints labeled inference options. `/clear` `/compact` `/model` `/yolo` `/credits` `/whoami`. Shell and file writes ask before running unless you pass `--yolo` (also `--auto` / `--dangerously-skip-permissions`).

`--print` is one-shot (CI / scripts) and does not open the TUI. Writes and shell still need `--yolo` when stdin is not a TTY.

## Provider fleet

```bash
scalattice login
scalattice provider machines create
scalattice provider machines
scalattice provider pause   # or resume
```

See [Fleet API docs](https://scalattice.cloud/docs/providers#fleet-api).

## MCP (optional)

MCP is **not** a second install. After `login`, leave the prompt and run `scalattice mcp`. For a headless process without a session, set `SCALATTICE_MGMT_KEY` in that environment.

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
