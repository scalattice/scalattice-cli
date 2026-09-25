import fs from 'node:fs';
import { collectImagePaths, userContentWithImages } from './images.js';
import { loadProjectMemory } from './memory.js';
import { looksBinary, resolveWorkspacePath, walkFiles } from './paths.js';
import { buildSystemPrompt } from './prompt.js';
import {
  defaultRoute,
  filterToolDefs,
  formatRouterNote,
  routerEnabled,
  runRouter,
  shallowTree,
  toolsForMode,
} from './router.js';
import { formatSkills, loadSkills, pickSkills, skillsCatalog } from './skills.js';
import { TOOL_DEFS } from './tools.js';

const MAX_FILE = 2500;
const MAX_FILES_CHARS = 7000;

export function lastUserText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === 'text' || typeof p.text === 'string'))
      .map((p) => p.text || '')
      .join('\n');
  }
  return String(content || '');
}

function readSnippets(cwd, rels) {
  let used = 0;
  const parts = [];
  for (const rel of rels || []) {
    if (used >= MAX_FILES_CHARS) break;
    try {
      const { abs } = resolveWorkspacePath(cwd, rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 400_000) continue;
      const buf = fs.readFileSync(abs);
      if (looksBinary(buf)) continue;
      const room = Math.min(MAX_FILE, MAX_FILES_CHARS - used);
      let text = buf.toString('utf8');
      if (text.length > room) text = `${text.slice(0, room)}\n…`;
      parts.push(`## ${rel}\n${text}`);
      used += text.length;
    } catch {
      /* skip missing or outside */
    }
  }
  return parts.join('\n\n');
}

export async function prepareBracketTurn({
  messages,
  model,
  auth,
  cwd,
  settings,
  catalog,
  extraTools,
  yolo,
  signal,
  onNote,
} = {}) {
  const allTools = [...TOOL_DEFS, ...(extraTools || [])];
  const last = messages?.[messages.length - 1];
  const userText = lastUserText(last?.content);
  const hasImages = collectImagePaths(userText, cwd).length > 0;
  const memory = loadProjectMemory(cwd);
  const skills = loadSkills(cwd);
  const modePinned = settings?.modePinned === true;
  const modelPinned = settings?.modelPinned === true || !routerEnabled(settings);
  const forcedMode = settings?.agentMode || 'agent';

  let route = {
    ...defaultRoute({ model, tools: allTools, hasImages }),
    model,
    mode: forcedMode,
  };

  if (routerEnabled(settings) && last?.role === 'user') {
    try {
      const decided = await runRouter({
        userText,
        catalog,
        fallbackModel: model,
        toolDefs: allTools,
        skillsText: skillsCatalog(skills) || '(none)',
        memoryNames: memory.files.join(', ') || '(none)',
        tree: shallowTree(cwd, walkFiles),
        hasImages,
        apiUrl: auth?.apiUrl,
        apiKey: auth?.apiKey,
        settings,
        signal,
      });
      route = { ...route, ...decided };
      if (modelPinned) route.model = model;
      if (modePinned) route.mode = forcedMode;
      if (decided.routerModel || route.model) {
        const line = formatRouterNote(decided, route);
        if (line) onNote?.(line);
      }
    } catch (err) {
      onNote?.(`Router skipped: ${err?.message || err}`);
      route = {
        ...defaultRoute({ model, tools: allTools, hasImages }),
        mode: forcedMode,
        model,
        reason: 'router-error',
      };
    }
  }

  let tools = toolsForMode(allTools, route.mode);
  if (route.mode !== 'ask' && route.tools?.length) {
    tools = filterToolDefs(tools, route.tools);
  }

  const extras = [];
  const picked = pickSkills(skills, route.skills);
  if (picked.length) extras.push(formatSkills(picked));
  const snippets = readSnippets(cwd, route.files);
  if (snippets) extras.push(`# Relevant files\n${snippets}`);
  let nextUser = userText;
  if (extras.length) nextUser = `${userText}\n\n${extras.join('\n\n')}`;
  const content = last?.role === 'user' ? userContentWithImages(nextUser, cwd) : last?.content;

  const sys = buildSystemPrompt({
    cwd,
    model: route.model,
    yolo,
    mode: route.mode,
    memory: memory.text,
  });

  const nextMessages = (messages || []).map((m, i, arr) => {
    if (i === 0 && m.role === 'system') return { ...m, content: sys };
    if (i === arr.length - 1 && m.role === 'user') return { ...m, content };
    return m;
  });

  return {
    messages: nextMessages,
    model: route.model,
    tools,
    thinking: route.think !== false,
    route,
  };
}
