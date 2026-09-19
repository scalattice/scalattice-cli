/**
 * Minimal MCP server over stdio (JSON-RPC 2.0).
 * Lets Claude Desktop / Cursor call Scalattice tools without a browser.
 *
 * Credits + fleet use the CLI session, or SCALATTICE_MGMT_KEY in the environment.
 * Inference catalog tools use SCALATTICE_API_KEY (OPENAI_API_KEY is an alias).
 */
import { apiFetch, mgmtFetch } from '../api.js';
import { loadConfig } from '../config.js';

function adminApiPath(raw) {
  let p = String(raw || '').trim();
  if (!p) throw new Error('path is required');
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.includes('..')) {
    throw new Error('path must be a relative admin API path');
  }
  if (p.startsWith('/api/v1/admin')) p = p.slice('/api/v1/admin'.length) || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  return `/api/v1/admin${p}`;
}

function withQuery(path, query) {
  if (!query || typeof query !== 'object') return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

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
        'Return configured Scalattice endpoints and whether a session or env keys are present (values redacted).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  if (cfg.sessionToken || cfg.mgmtKey) {
    tools.push(
      {
        name: 'scalattice_credits',
        description:
          'Return Scalattice prepaid wallet balance, lifetime spend, and active model credit grants (account management key).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
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
      },
      {
        name: 'scalattice_fleet_reconnect',
        description:
          'Kick a machine agent WebSocket so it auto-reconnects with the same token.',
        inputSchema: {
          type: 'object',
          properties: {
            machineId: {
              type: 'string',
              description: 'Provider machine / agent key id',
            },
          },
          required: ['machineId'],
          additionalProperties: false,
        },
      },
      {
        name: 'scalattice_admin_catalog',
        description:
          'List every admin-panel HTTP route (machines, Full Debug, catalog, users, billing). Requires an admin account. Start here before calling scalattice_admin.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'scalattice_admin',
        description:
          'Call any admin-panel API the dashboard uses (same /api/v1/admin routes). Prefer GET /api first via scalattice_admin_catalog. For Full Debug: POST /machines/:id/debug with { full: true, sweep: true, fresh: true, pauseRouting: true, waitForJob: true }, then poll with sweep: true and fresh: false.',
        inputSchema: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method. Default GET.',
            },
            path: {
              type: 'string',
              description:
                'Path under /api/v1/admin, e.g. /machines, /machines/:id/debug, /monitor',
            },
            query: {
              type: 'object',
              additionalProperties: true,
              description: 'Query string fields',
            },
            body: {
              type: 'object',
              additionalProperties: true,
              description: 'JSON body for POST/PUT/PATCH',
            },
          },
          required: ['path'],
          additionalProperties: false,
        },
      }
    );
  }
  if (cfg.apiKey) {
    tools.push({
      name: 'scalattice_models',
      description:
        'List Scalattice catalog models with live per-token pricing (OpenAI-compatible /v1/models).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
  }
  return tools;
}

async function callTool(name, args = {}) {
  const cfg = loadConfig();
  if (name === 'scalattice_env') {
    return {
      cloud_url: cfg.cloudUrl,
      openai_base_url: cfg.apiUrl,
      session: Boolean(cfg.sessionToken),
      api_key_configured: Boolean(cfg.apiKey),
      mgmt_key_configured: Boolean(cfg.mgmtKey),
      hint: [
        cfg.sessionToken || cfg.mgmtKey
          ? 'Session or SCALATTICE_MGMT_KEY is set (credits, fleet, admin tools).'
          : 'Run `scalattice login` (or set SCALATTICE_MGMT_KEY for MCP).',
        cfg.apiKey
          ? `export OPENAI_BASE_URL=${cfg.apiUrl}`
          : 'Run `scalattice developers keys create` then export SCALATTICE_API_KEY.',
      ].join(' '),
    };
  }
  if (name === 'scalattice_credits') {
    return mgmtFetch(cfg, '/api/v1/developers/billing');
  }
  if (name === 'scalattice_models') {
    return apiFetch(cfg, '/models');
  }
  if (name === 'scalattice_fleet_machines') {
    return mgmtFetch(cfg, '/api/v1/providers/machines');
  }
  if (name === 'scalattice_fleet_earnings') {
    return mgmtFetch(cfg, '/api/v1/providers/earnings');
  }
  if (name === 'scalattice_fleet_set_availability') {
    const accepting = args.accepting === true || args.accepting === 'true';
    return mgmtFetch(cfg, '/api/v1/providers/machines/schedule', {
      method: 'POST',
      body: { accepting },
    });
  }
  if (name === 'scalattice_fleet_reconnect') {
    const machineId = String(args.machineId || args.machine || args.id || '').trim();
    if (!machineId) throw new Error('machineId is required');
    return mgmtFetch(cfg, `/api/v1/providers/machines/${machineId}/reconnect`, {
      method: 'POST',
      body: {},
    });
  }
  if (name === 'scalattice_admin_catalog') {
    return mgmtFetch(cfg, '/api/v1/admin/api');
  }
  if (name === 'scalattice_admin') {
    const method = String(args.method || 'GET').trim().toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new Error('method must be GET, POST, PUT, PATCH, or DELETE');
    }
    const path = withQuery(adminApiPath(args.path), args.query);
    return mgmtFetch(cfg, path, {
      method,
      body: method === 'GET' || method === 'DELETE' ? undefined : args.body || {},
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
