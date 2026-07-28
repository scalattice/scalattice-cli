/**
 * Minimal MCP server over stdio (JSON-RPC 2.0).
 * Lets Claude Desktop / Cursor call Scalattice tools without a browser.
 *
 * What MCP is: a small protocol so an AI app can discover and call tools
 * you expose (here: credits, models, env snippet). It is not how you sign up.
 */
import { apiFetch } from '../api.js';
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

const TOOLS = [
  {
    name: 'scalattice_credits',
    description:
      'Return Scalattice prepaid wallet balance, lifetime spend, and active model-specific credit grants for the configured API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'scalattice_models',
    description: 'List Scalattice catalog models with live per-token pricing (OpenAI-compatible /v1/models).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'scalattice_env',
    description:
      'Return OPENAI_BASE_URL and whether an API key is configured (key value redacted). Use after scalattice setup.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function callTool(name) {
  const cfg = loadConfig();
  if (name === 'scalattice_env') {
    return {
      openai_base_url: cfg.apiUrl,
      api_key_configured: Boolean(cfg.apiKey),
      api_key_suffix: cfg.apiKey ? cfg.apiKey.slice(-4) : null,
      hint: cfg.apiKey
        ? `export OPENAI_BASE_URL=${cfg.apiUrl}\nexport OPENAI_API_KEY=<stored locally>`
        : 'Run `scalattice setup` in a terminal first.',
    };
  }
  if (name === 'scalattice_credits') {
    return apiFetch(cfg, '/credits');
  }
  if (name === 'scalattice_models') {
    return apiFetch(cfg, '/models');
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'scalattice', version: '0.1.0' },
    });
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const toolName = params?.name;
    try {
      const result = await callTool(toolName);
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
  // MCP uses Content-Length framed messages on stdin/stdout.
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
      const body = buffer.slice(start, start + len).toString('utf8');
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
