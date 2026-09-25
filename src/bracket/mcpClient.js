import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { configDir } from '../config.js';

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Claude-style mcpServers map from user config and the workspace. */
export function loadMcpConfig(cwd) {
  const files = [
    path.join(configDir(), 'mcp.json'),
    path.join(path.resolve(cwd || '.'), '.scalattice', 'mcp.json'),
  ];
  const servers = {};
  for (const file of files) {
    const parsed = readJson(file);
    const map = parsed?.mcpServers || parsed?.servers || parsed;
    if (!map || typeof map !== 'object') continue;
    for (const [id, spec] of Object.entries(map)) {
      if (!spec || typeof spec !== 'object') continue;
      servers[String(id)] = spec;
    }
  }
  return servers;
}

function writeFrame(child, msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}

function createSession(id, spec) {
  const command = String(spec.command || '').trim();
  if (!command) throw new Error(`MCP ${id}: command is required`);
  const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
  const env = { ...process.env, ...(spec.env || {}) };
  const child = spawn(command, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  let buf = Buffer.alloc(0);
  const pending = new Map();
  let nextId = 1;
  let tools = [];

  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = buf.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;
      const body = buf.slice(start, start + len).toString('utf8');
      buf = buf.slice(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (msg.id == null) continue;
      const wait = pending.get(msg.id);
      if (!wait) continue;
      pending.delete(msg.id);
      if (msg.error) wait.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else wait.resolve(msg.result);
    }
  };
  child.stdout?.on('data', onData);
  child.on('error', (err) => {
    for (const wait of pending.values()) wait.reject(err);
    pending.clear();
  });

  function request(method, params) {
    const rid = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(rid, { resolve, reject });
      writeFrame(child, { jsonrpc: '2.0', id: rid, method, params });
      setTimeout(() => {
        if (!pending.has(rid)) return;
        pending.delete(rid);
        reject(new Error(`MCP ${id} timeout: ${method}`));
      }, 20_000);
    });
  }

  return {
    id,
    child,
    async start() {
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'scalattice-bracket', version: '0.3.0' },
      });
      writeFrame(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const listed = await request('tools/list', {});
      tools = Array.isArray(listed?.tools) ? listed.tools : [];
      return tools;
    },
    list() {
      return tools;
    },
    async call(name, args) {
      return request('tools/call', { name, arguments: args || {} });
    },
    stop() {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    },
  };
}

function sanitizeId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'server';
}

export function mcpToolName(serverId, toolName) {
  return `mcp__${sanitizeId(serverId)}__${sanitizeId(toolName)}`;
}

export function parseMcpToolName(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
  if (!m) return null;
  return { serverId: m[1], tool: m[2] };
}

export function isMcpToolName(name) {
  return /^mcp__/.test(String(name || ''));
}

export function mcpToOpenAiTools(serverId, tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: {
      name: mcpToolName(serverId, t.name),
      description: `[MCP ${serverId}] ${t.description || t.name}`,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

export function formatMcpCallResult(result) {
  if (result == null) return '(empty MCP result)';
  if (typeof result === 'string') return result;
  const bits = [];
  if (result.isError) bits.push('MCP error');
  for (const part of result.content || []) {
    if (part?.type === 'text') bits.push(String(part.text || ''));
    else if (part?.text) bits.push(String(part.text));
  }
  if (!bits.length) {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return bits.join('\n');
}

export function createMcpPool({ cwd } = {}) {
  const specs = loadMcpConfig(cwd);
  const sessions = new Map();
  const aliases = new Map();
  let openaiTools = [];

  return {
    specs,
    tools() {
      return openaiTools;
    },
    async start() {
      openaiTools = [];
      aliases.clear();
      for (const [id, spec] of Object.entries(specs)) {
        try {
          const session = createSession(id, spec);
          await session.start();
          sessions.set(id, session);
          for (const t of session.list()) {
            const openaiName = mcpToolName(id, t.name);
            aliases.set(openaiName, { serverId: id, tool: t.name });
            openaiTools.push(...mcpToOpenAiTools(id, [t]));
          }
        } catch (err) {
          const offline = mcpToolName(id, 'offline');
          aliases.set(offline, { serverId: id, tool: 'offline' });
          openaiTools.push({
            type: 'function',
            function: {
              name: offline,
              description: `MCP server ${id} failed to start: ${err.message}`,
              parameters: { type: 'object', properties: {} },
            },
          });
        }
      }
      return openaiTools;
    },
    async call(name, args) {
      const mapped = aliases.get(name) || parseMcpToolName(name);
      if (!mapped) throw new Error(`Not an MCP tool: ${name}`);
      const session = sessions.get(mapped.serverId);
      if (!session) throw new Error(`MCP server not running: ${mapped.serverId}`);
      if (mapped.tool === 'offline') throw new Error(`MCP server ${mapped.serverId} is offline`);
      const result = await session.call(mapped.tool, args);
      return formatMcpCallResult(result);
    },
    describe() {
      const ids = Object.keys(specs);
      if (!ids.length) {
        return 'No MCP servers. Add ~/.config/scalattice/mcp.json or .scalattice/mcp.json (Claude mcpServers shape). This is a client: Bracket calls other servers. `scalattice mcp` is the opposite (Scalattice as a server).';
      }
      return ids
        .map((id) => {
          const session = sessions.get(id);
          const n = session?.list?.().length || 0;
          return `${id}  ${n} tool${n === 1 ? '' : 's'}${session ? '' : '  (not started)'}`;
        })
        .join('\n');
    },
    stop() {
      for (const session of sessions.values()) session.stop();
      sessions.clear();
    },
  };
}
