/**
 * Minimal MCP server over stdio (JSON-RPC 2.0).
 * Lets Claude Desktop / Cursor call Scalattice tools without a browser.
 *
 * Developer tools use the inference API key; fleet tools use the management key.
 */
import { apiFetch, mgmtFetch } from '../api.js';
import { loadConfig } from '../config.js';

function writeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function sendResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function listTools(cfg) {
  const tools = [
    {
      name: 'scalattice_env',
      description:
        'Return configured Scalattice endpoints and whether developer API / fleet management keys are stored (values redacted).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  if (cfg.apiKey) {
    tools.push(
      {
        name: 'scalattice_credits',
        description:
          'Return Scalattice prepaid wallet balance, lifetime spend, and active model-specific credit grants for the configured API key.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'scalattice_models',
        description:
          'List Scalattice catalog models with live per-token pricing (OpenAI-compatible /v1/models).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }
    );
  }
  if (cfg.mgmtKey) {
    tools.push(
      {
        name: 'scalattice_fleet_machines',
        description: 'List fleet machines (status, schedule, earnings).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'scalattice_fleet_earnings',
        description: 'Provider earnings totals.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'scalattice_fleet_set_availability',
        description: 'Pause or resume the whole fleet.',
        inputSchema: {
          type: 'object',
          properties: {
            accepting: {
              type: 'boolean',
              description: 'true = resume, false = pause',
            },
          },
          required: ['accepting'],
          additionalProperties: false,
        },
      }
    );
  }
  return tools;
}

async function callTool(name, args = {}) {
  const cfg = loadConfig();
  if (name === 'scalattice_env') {
    return {
      cloud_url: cfg.cloudUrl,
      openai_base_url: cfg.apiUrl,
      api_key_configured: Boolean(cfg.apiKey),
      api_key_suffix: cfg.apiKey ? cfg.apiKey.slice(-4) : null,
      mgmt_key_configured: Boolean(cfg.mgmtKey),
      mgmt_key_suffix: cfg.mgmtKey ? cfg.mgmtKey.slice(-4) : null,
      hint: [
        cfg.apiKey
          ? `export OPENAI_BASE_URL=${cfg.apiUrl}\nexport OPENAI_API_KEY=<stored locally>`
          : 'Run `scalattice setup` for developer inference keys.',
        cfg.mgmtKey
          ? 'Fleet tools available (scalattice_fleet_*).'
          : 'Run `scalattice provider setup` for fleet management.',
      ].join(' '),
    };
  }
  if (name === 'scalattice_credits') {
    return apiFetch(cfg, '/credits');
  }
  if (name === 'scalattice_models') {
    return apiFetch(cfg, '/models');
  }
  if (name === 'scalattice_fleet_machines') {
    return mgmtFetch(cfg, '/machines');
  }
  if (name === 'scalattice_fleet_earnings') {
    return mgmtFetch(cfg, '/earnings');
  }
  if (name === 'scalattice_fleet_set_availability') {
    const accepting = args.accepting === true || args.accepting === 'true';
    return mgmtFetch(cfg, '/machines/schedule', {
      method: 'POST',
      body: { accepting },
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  const cfg = loadConfig();

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'scalattice', version: '0.2.0' },
    });
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'tools/list') {
    sendResult(id, { tools: listTools(cfg) });
    return;
  }
  if (method === 'tools/call') {
    const toolName = params?.name;
    try {
      const result = await callTool(toolName, params?.arguments || {});
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      sendResult(id, {
        isError: true,
        content: [{ type: 'text', text: err?.message || String(err) }],
      });
    }
    return;
  }
  if (method === 'ping') {
    sendResult(id, {});
    return;
  }
  if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
}

export async function runMcpServer() {
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + len) break;
      const body = buffer.slice(start, len + start).toString('utf8');
      buffer = buffer.slice(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      void handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
