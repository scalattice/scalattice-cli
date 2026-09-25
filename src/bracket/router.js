import path from 'node:path';
import { chatCompletion } from './client.js';

const WRITE_TOOLS = new Set(['bash', 'write_file', 'edit_file', 'delegate', 'kill_shell']);

export function routerEnabled(settings, env = process.env) {
  const raw = String(env.SCALATTICE_BRACKET_ROUTER ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (settings?.router === false) return false;
  return true;
}

export function parseModelSize(id) {
  const s = String(id || '').toLowerCase();
  const moe = s.match(/(\d+(?:\.\d+)?)b-a(\d+(?:\.\d+)?)b/);
  if (moe) return { total: Number(moe[1]), active: Number(moe[2]) };
  const m = s.match(/(\d+(?:\.\d+)?)b(?![a-z])/);
  if (m) {
    const n = Number(m[1]);
    return { total: n, active: n };
  }
  return { total: 99, active: 99 };
}

export function modelKind(id) {
  const s = String(id || '').toLowerCase();
  if (/embed|rerank|whisper|tts|\baudio\b/.test(s)) return 'other';
  if (/\bvl\b|vision|llava/.test(s)) return 'vision';
  if (/image|img|flux|sdxl|diffusion/.test(s)) return 'image';
  if (/\bcoder\b|code-|codellama|starcoder|deepseek-coder/.test(s)) return 'coder';
  return 'chat';
}

function catalogRows(catalog) {
  return (catalog || [])
    .map((m) => {
      const id = String(m?.id || m?.modelId || '').trim();
      if (!id) return null;
      const kind = modelKind(id);
      const size = parseModelSize(id);
      return { id, kind, ...size, maxContextTokens: Number(m.maxContextTokens) || 0 };
    })
    .filter(Boolean);
}

export function describeCatalog(catalog) {
  return catalogRows(catalog)
    .filter((r) => r.kind !== 'other' && r.kind !== 'image')
    .map((r) => {
      const role = r.kind === 'coder' ? 'create' : r.kind === 'vision' ? 'images' : 'talk';
      const size = r.total === 99 ? '?' : `${r.total}b`;
      return `${r.id}  ${r.kind}  ${size}  ${role}`;
    })
    .join('\n');
}

/** Smallest chat (else smallest coder) in the live catalog. Env can pin the advisor. */
export function pickAdvisorModel(catalog, env = process.env) {
  const rows = catalogRows(catalog).filter((r) => r.kind === 'chat' || r.kind === 'coder');
  const want = String(env.SCALATTICE_BRACKET_ROUTER_MODEL || '').trim();
  if (want) {
    if (!rows.length || rows.some((r) => r.id === want)) return want;
  }
  const ranked = rows.slice().sort((a, b) => {
    const ka = a.kind === 'chat' ? 0 : 1;
    const kb = b.kind === 'chat' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    if (a.total !== b.total) return a.total - b.total;
    return a.id.localeCompare(b.id);
  });
  return ranked[0]?.id || catalogRows(catalog)[0]?.id || '';
}

export function classifyTurn(text, { hasImages } = {}) {
  const t = String(text || '').trim();
  const low = t.toLowerCase();
  if (hasImages) return { intent: 'vision', confidence: 0.9 };
  if (!t) return { intent: 'talk', confidence: 0.3 };
  const shortHi = /^(hi|hello|hey|thanks|thank you|yo|sup)[\s!.]*$/i.test(t);
  if (shortHi || /^(who are you|what are you|what can you do)\b/i.test(low)) {
    return { intent: 'talk', confidence: 0.95 };
  }
  if (looksLikePlanApproval(t)) return { intent: 'create', confidence: 0.9 };
  if (
    /\b(how (?:to|could|can|would|do (?:we|i|you))|explain how)\b/.test(low) &&
    /\b(build|implement|make|create|write|code|scaffold|develop)\b/.test(low)
  ) {
    return { intent: 'create', confidence: 0.86 };
  }
  const create =
    /\b(fix|implement|refactor|write|create|add|edit|patch|debug|scaffold|migrate|rename|delete|install|build|commit|test|typecheck)\b/.test(
      low
    );
  const talk =
    /\b(explain|describe|summarize|summarise|tell me|what is|what's|who is|who's|why (does|is|do)|how does|credits|pricing|hello|thanks)\b/.test(
      low
    ) || /^(what|why|how|who|where|when|tell|explain|describe)\b/.test(low);
  const question = /\?\s*$/.test(t) || talk;
  if (create && !question) return { intent: 'create', confidence: 0.82 };
  if (question && !create) return { intent: 'talk', confidence: 0.85 };
  if (create) return { intent: 'create', confidence: 0.6 };
  // Unknown statements in a coding CLI still often want tools, but questions never default to coder.
  return { intent: 'create', confidence: 0.4 };
}

/** User accepted a plan in chat ("yes", "do this", "go ahead"). */
export function looksLikePlanApproval(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 240) return false;
  if (
    /^(yes|y|ok|okay|sure|lgtm|approved|proceed|go|go ahead|do it|do this|do that|execute|ship it|sounds good)([,.!]*|\s+please)?$/i.test(
      t
    )
  ) {
    return true;
  }
  return /^(yes|ok|okay|sure|please)[,.]?\s+(do|go|execute|implement|proceed|make)\b/i.test(t);
}

export function pickModelForIntent(catalog, intent, fallback) {
  const rows = catalogRows(catalog);
  const ids = rows.map((r) => r.id);
  const pick = (pred, rank) => {
    const hits = rows.filter(pred);
    if (!hits.length) return '';
    hits.sort(rank);
    return hits[0].id;
  };
  if (intent === 'vision') {
    const vl = pick((r) => r.kind === 'vision', (a, b) => a.total - b.total);
    if (vl) return vl;
  }
  if (intent === 'talk') {
    const chat = pick((r) => r.kind === 'chat', (a, b) => a.total - b.total);
    if (chat) return chat;
  }
  if (intent === 'create') {
    const coder = pick((r) => r.kind === 'coder', (a, b) => b.total - a.total);
    if (coder) return coder;
    const chat = pick((r) => r.kind === 'chat', (a, b) => b.total - a.total);
    if (chat) return chat;
  }
  if (fallback && (!ids.length || ids.includes(fallback))) return fallback;
  return ids[0] || fallback || '';
}

export function heuristicRoute({ userText, catalog, tools, hasImages, fallbackModel } = {}) {
  const { intent, confidence } = classifyTurn(userText, { hasImages });
  const model = pickModelForIntent(catalog, intent, fallbackModel);
  const allTools = (tools || []).map((t) => t.function?.name).filter(Boolean);
  const talk = intent === 'talk';
  return {
    model: model || fallbackModel,
    think: !talk,
    mode: talk ? 'ask' : 'agent',
    tools: talk ? [] : allTools,
    files: [],
    skills: [],
    reason: `heuristic:${intent}`,
    intent,
    confidence,
    hasImages: Boolean(hasImages),
  };
}

export function parseRouterJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function catalogIds(catalog) {
  return (catalog || []).map((m) => String(m.id || m.modelId || '')).filter(Boolean);
}

export function pickRoutedModel(wanted, catalog, fallback) {
  const ids = catalogIds(catalog);
  const want = String(wanted || '').trim();
  if (want && (!ids.length || ids.includes(want))) return want;
  if (fallback && (!ids.length || ids.includes(fallback))) return fallback;
  return ids[0] || fallback || want;
}

export function filterToolDefs(defs, names) {
  const list = Array.isArray(defs) ? defs : [];
  if (!names?.length) return list;
  const allow = new Set(names.map(String));
  const wantMcp = [...allow].some((n) => n === 'mcp' || String(n).startsWith('mcp_') || String(n).startsWith('mcp__'));
  const filtered = list.filter((t) => {
    const n = t.function?.name;
    if (allow.has(n)) return true;
    if (wantMcp && String(n).startsWith('mcp__')) return true;
    return false;
  });
  return filtered.length ? filtered : list;
}

export function toolsForMode(defs, mode) {
  const list = Array.isArray(defs) ? defs : [];
  if (mode === 'ask') return [];
  if (mode === 'plan') {
    return list.filter((t) => !WRITE_TOOLS.has(t.function?.name));
  }
  return list;
}

export function defaultRoute({ model, tools, hasImages } = {}) {
  return {
    model: model || '',
    think: true,
    mode: 'agent',
    tools: (tools || []).map((t) => t.function?.name).filter(Boolean),
    files: [],
    skills: [],
    reason: 'default',
    hasImages: Boolean(hasImages),
  };
}

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}\n…` : t;
}

export function buildRouterPrompt({
  userText,
  catalogText,
  toolNames,
  skills,
  memoryNames,
  tree,
  hasImages,
  hint,
  advisorId,
}) {
  return `You route one user message to a catalog model. Reply with JSON only, no markdown.

Schema:
{"intent":"talk|create","model":"catalog-id","think":true,"mode":"agent|plan|ask","tools":["bash"],"files":["rel/path"],"skills":["id"]}

Catalog (id  kind  size  role):
${clip(catalogText || '(empty)', 1200)}

You are advisor ${advisorId || '(unknown)'}. For talk, the smallest chat model (including you) is correct. Only pick a coder when the user wants code changed or written.

Rules:
- intent=talk: greetings, trivia, literature, movies, credits, "tell me about…", "what is X". Prefer the smallest chat model. mode=ask unless they need to read the repo (then plan).
- "Explain how to/could we build/implement/make X" is create, even if it starts with explain. Dumping a tutorial is not talk.
- A movie/book/play "script" is talk. A shell/JS/Python script to write or patch is create.
- Sitting in a git repo does not make a trivia question into create.
- intent=create: implement, fix, refactor, write files, run tests, design a site/app. Prefer a coder model if listed, else a larger chat model. mode=agent.
- mode=ask: no tools. mode=plan: read-only tools. mode=agent: can edit.
- tools: subset of ${ (toolNames || []).join(', ') || '(none)' }. Omit tools the job will not need.
- files: up to 6 workspace paths the main model should read first. Skip node_modules.
- skills: ids from this list if relevant:\n${clip(skills || '(none)', 800)}
- Project memory files present: ${memoryNames || '(none)'}
- Local hint (ignore if it conflicts with the rules): ${hint || 'none'}
${hasImages ? '- The user attached images. Pick a vision/VL model, not an image-generator.\n' : ''}
Workspace sketch:
${clip(tree || '(empty)', 1200)}

User message:
${clip(userText, 2000)}
`;
}

/** One muted TUI line. Never include the advisor's prose. */
export function formatRouterNote(decided, route = {}) {
  const model = String(route.model || decided?.model || '').trim();
  const intent = String(route.intent || decided?.intent || route.mode || '').trim();
  const from = String(decided?.routerModel || '').trim();
  if (from && model && from !== model) return `Advisor ${from} → ${model} (${intent || 'auto'})`;
  if (intent && model) return `${intent} → ${model}`;
  return model;
}

export function shouldSkipAdvisor({ catalog, confidence, intent } = {}) {
  const usable = catalogRows(catalog).filter((r) => r.kind === 'chat' || r.kind === 'coder' || r.kind === 'vision');
  if (usable.length <= 1) return true;
  if (intent === 'talk' && Number(confidence) >= 0.8) return true;
  return false;
}

export async function runRouter({
  userText,
  catalog,
  fallbackModel,
  toolDefs,
  skillsText,
  memoryNames,
  tree,
  hasImages,
  apiUrl,
  apiKey,
  settings,
  signal,
} = {}) {
  const hint = heuristicRoute({ userText, catalog, tools: toolDefs, hasImages, fallbackModel });
  if (shouldSkipAdvisor({ catalog, confidence: hint.confidence, intent: hint.intent })) {
    return { ...hint, reason: hint.reason, routerModel: '' };
  }

  const advisorId = pickAdvisorModel(catalog) || fallbackModel;
  if (!advisorId) return { ...hint, reason: 'no-advisor' };

  const toolNames = (toolDefs || []).map((t) => t.function?.name).filter(Boolean);
  const prompt = buildRouterPrompt({
    userText,
    catalogText: describeCatalog(catalog),
    toolNames,
    skills: skillsText,
    memoryNames,
    tree,
    hasImages,
    hint: `${hint.intent} (${hint.confidence}) → ${hint.model}`,
    advisorId,
  });
  const msg = await chatCompletion({
    apiUrl,
    apiKey,
    model: advisorId,
    messages: [
      { role: 'system', content: 'Return only JSON for the schema in the user message.' },
      { role: 'user', content: prompt },
    ],
    tools: undefined,
    stream: false,
    thinking: false,
    temperature: 0,
    max_tokens: 400,
    settings: { ...(settings || {}), stream: false, thinking: false },
    signal,
  });
  const parsed = parseRouterJson(msg?.content);
  const base = { ...hint, reason: 'advisor-parse-failed', routerModel: advisorId };
  if (!parsed) return base;
  let intent = parsed.intent === 'talk' || parsed.intent === 'create' ? parsed.intent : hint.intent;
  const clampedCreate = hint.intent === 'create' && Number(hint.confidence) >= 0.75 && intent === 'talk';
  if (clampedCreate) intent = 'create';
  let model = pickRoutedModel(parsed.model, catalog, hint.model || fallbackModel);
  if (clampedCreate) {
    model = pickModelForIntent(catalog, 'create', hint.model || fallbackModel) || model;
  }
  if (hasImages && modelKind(model) !== 'vision') {
    const vision = pickModelForIntent(catalog, 'vision', model);
    if (vision) model = vision;
  }
  if (!model) model = pickModelForIntent(catalog, intent, fallbackModel) || fallbackModel;
  let mode = ['ask', 'plan', 'agent'].includes(parsed.mode)
    ? parsed.mode
    : intent === 'talk'
      ? 'ask'
      : 'agent';
  if (clampedCreate && mode === 'ask') mode = 'agent';
  const tools = Array.isArray(parsed.tools)
    ? parsed.tools.map(String).filter((n) => toolNames.includes(n))
    : hint.tools;
  const files = Array.isArray(parsed.files) ? parsed.files.map(String).slice(0, 6) : [];
  const skillIds = Array.isArray(parsed.skills) ? parsed.skills.map(String).slice(0, 4) : [];
  return {
    model,
    think: parsed.think !== false && intent !== 'talk',
    mode,
    tools: mode === 'ask' ? [] : tools.length ? tools : hint.tools,
    files,
    skills: skillIds,
    reason: `advisor:${intent}`,
    intent,
    hasImages: Boolean(hasImages),
    routerModel: advisorId,
  };
}

export function shallowTree(cwd, walkFiles, { limit = 40 } = {}) {
  if (typeof walkFiles !== 'function') return '';
  try {
    const files = walkFiles(cwd, { maxFiles: 200 });
    return files
      .slice(0, limit)
      .map((abs) => {
        try {
          return path.relative(cwd, abs).replaceAll('\\', '/') || abs;
        } catch {
          return String(abs);
        }
      })
      .join('\n');
  } catch {
    return '';
  }
}
