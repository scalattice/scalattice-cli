import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { unifiedHunk, createCheckpointStore } from './checkpoint.js';
import { collectImagePaths, looksLikeVisionModel } from './images.js';
import { loadProjectMemory } from './memory.js';
import { formatMcpCallResult, mcpToolName, parseMcpToolName } from './mcpClient.js';
import {
  classifyTurn,
  defaultRoute,
  filterToolDefs,
  formatRouterNote,
  looksLikePlanApproval,
  parseModelSize,
  parseRouterJson,
  pickAdvisorModel,
  pickModelForIntent,
  pickRoutedModel,
  routerEnabled,
  shouldSkipAdvisor,
  toolsForMode,
} from './router.js';
import { loadSkills, pickSkills } from './skills.js';
import { TOOL_DEFS } from './tools.js';
import { lastUserText, prepareBracketTurn } from './turn.js';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('parseRouterJson accepts fences and stray prose', () => {
  assert.deepEqual(parseRouterJson('{"model":"qwen-3-8b","think":false}').model, 'qwen-3-8b');
  assert.equal(
    parseRouterJson('Sure.\n```json\n{"model":"qwen-3-32b","mode":"plan"}\n```').mode,
    'plan'
  );
  assert.equal(parseRouterJson('nope'), null);
});

test('toolsForMode strips writes in plan and all tools in ask', () => {
  const plan = toolsForMode(TOOL_DEFS, 'plan').map((t) => t.function.name);
  assert.ok(plan.includes('read_file'));
  assert.ok(plan.includes('git_diff'));
  assert.ok(!plan.includes('write_file'));
  assert.ok(!plan.includes('bash'));
  assert.ok(!plan.includes('delegate'));
  assert.equal(toolsForMode(TOOL_DEFS, 'ask').length, 0);
  assert.ok(toolsForMode(TOOL_DEFS, 'agent').some((t) => t.function.name === 'write_file'));
});

test('filterToolDefs keeps MCP tools when router asks for mcp', () => {
  const defs = [
    ...TOOL_DEFS.filter((t) => ['read_file', 'bash'].includes(t.function.name)),
    { type: 'function', function: { name: 'mcp__gh__search', description: 's' } },
  ];
  const names = filterToolDefs(defs, ['read_file', 'mcp']).map((t) => t.function.name);
  assert.deepEqual(names.sort(), ['mcp__gh__search', 'read_file']);
});

test('advisor and intent pick from the live catalog, not a hardcoded id', () => {
  const catalog = [
    { id: 'qwen-3-coder-30b-a3b' },
    { id: 'qwen-3-32b' },
    { id: 'qwen-3-8b' },
    { id: 'qwen-2.5-vl-7b' },
    { id: 'qwen-image-2512' },
  ];
  assert.equal(parseModelSize('qwen-3-8b').total, 8);
  assert.equal(parseModelSize('qwen-3-coder-30b-a3b').total, 30);
  assert.equal(pickAdvisorModel(catalog, {}), 'qwen-3-8b');
  assert.equal(pickAdvisorModel(catalog, { SCALATTICE_BRACKET_ROUTER_MODEL: 'qwen-3-32b' }), 'qwen-3-32b');
  assert.equal(pickModelForIntent(catalog, 'talk'), 'qwen-3-8b');
  assert.equal(pickModelForIntent(catalog, 'create'), 'qwen-3-coder-30b-a3b');
  assert.equal(pickModelForIntent(catalog, 'vision'), 'qwen-2.5-vl-7b');
  assert.equal(classifyTurn('hi').intent, 'talk');
  assert.ok(classifyTurn('hi').confidence >= 0.9);
  assert.equal(classifyTurn('tell me about the bee movie script').intent, 'talk');
  assert.ok(classifyTurn('tell me about the bee movie script').confidence >= 0.8);
  assert.equal(classifyTurn('tell me about star wars').intent, 'talk');
  assert.equal(classifyTurn('Who is Anthropic?').intent, 'talk');
  assert.equal(classifyTurn('explain how we could build a star wars website').intent, 'create');
  assert.equal(classifyTurn('fix the failing tests').intent, 'create');
  assert.equal(classifyTurn('write a python script that prints hello').intent, 'create');
  assert.equal(looksLikePlanApproval('yes'), true);
  assert.equal(looksLikePlanApproval('do this'), true);
  assert.equal(looksLikePlanApproval('yes, go ahead'), true);
  assert.equal(looksLikePlanApproval('explain the plan first'), false);
  assert.equal(classifyTurn('yes do this').intent, 'create');
  assert.equal(shouldSkipAdvisor({ catalog, intent: 'talk', confidence: 0.85 }), true);
  assert.equal(shouldSkipAdvisor({ catalog, intent: 'talk', confidence: 0.95 }), true);
  assert.equal(shouldSkipAdvisor({ catalog, intent: 'create', confidence: 0.82 }), false);
  assert.equal(shouldSkipAdvisor({ catalog: [{ id: 'only-chat-7b' }], intent: 'create', confidence: 0.4 }), true);
  assert.equal(
    formatRouterNote(
      { routerModel: 'ministral-8b-2512', reason: 'Smallest chat model (8b) for talk, excluding vision models and larger unnecessary models.' },
      { model: 'ministral-8b-2512', intent: 'talk' }
    ),
    'talk → ministral-8b-2512'
  );
  assert.equal(
    formatRouterNote(
      { routerModel: 'ministral-8b-2512', reason: 'Coder model preferred for creation tasks' },
      { model: 'qwen-3-coder-30b-a3b', intent: 'create' }
    ),
    'Advisor ministral-8b-2512 → qwen-3-coder-30b-a3b (create)'
  );
});

test('pickRoutedModel stays in catalog and routerEnabled defaults on', () => {
  const catalog = [{ id: 'qwen-3-8b' }, { id: 'qwen-3-32b' }];
  assert.equal(pickRoutedModel('qwen-3-32b', catalog, 'qwen-3-8b'), 'qwen-3-32b');
  assert.equal(pickRoutedModel('missing', catalog, 'qwen-3-8b'), 'qwen-3-8b');
  assert.equal(routerEnabled({}, {}), true);
  assert.equal(routerEnabled({ router: false }, {}), false);
  assert.equal(routerEnabled({}, { SCALATTICE_BRACKET_ROUTER: 'off' }), false);
});

test('mcp tool names round-trip with double underscores', () => {
  const name = mcpToolName('github', 'search_repos');
  assert.equal(name, 'mcp__github__search_repos');
  assert.deepEqual(parseMcpToolName(name), { serverId: 'github', tool: 'search_repos' });
  assert.match(formatMcpCallResult({ content: [{ type: 'text', text: 'ok' }] }), /ok/);
});

test('loadProjectMemory walks AGENTS.md and CLAUDE.md', () => {
  const dir = tmpDir('bracket-mem-');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Use pnpm.');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Be terse.');
  const mem = loadProjectMemory(dir);
  assert.ok(mem.files.includes('AGENTS.md'));
  assert.ok(mem.files.includes('CLAUDE.md'));
  assert.match(mem.text, /pnpm/);
  assert.match(mem.text, /Be terse/);
});

test('skills load from workspace and pick by id', () => {
  const dir = tmpDir('bracket-sk-');
  fs.mkdirSync(path.join(dir, '.scalattice', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.scalattice', 'skills', 'review.md'), '# Review\nCheck tests.');
  const skills = loadSkills(dir);
  assert.equal(skills[0].id, 'review');
  assert.equal(pickSkills(skills, ['review']).length, 1);
  assert.equal(pickSkills(skills, ['nope']).length, 0);
});

test('checkpoint rewind restores a write', () => {
  const prev = process.env.SCALATTICE_CONFIG_DIR;
  const cfg = tmpDir('bracket-cfg-');
  process.env.SCALATTICE_CONFIG_DIR = cfg;
  const dir = tmpDir('bracket-cp-');
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'one');
  try {
    const store = createCheckpointStore({ cwd: dir, chatId: 'c1' });
    store.snapshot([{ rel: 'a.txt', abs: file }]);
    fs.writeFileSync(file, 'two');
    const rec = store.rewind();
    assert.equal(rec.ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'one');
    assert.match(unifiedHunk('a.txt', 'one\n', 'two\n'), /--- a\/a.txt/);
  } finally {
    if (prev === undefined) delete process.env.SCALATTICE_CONFIG_DIR;
    else process.env.SCALATTICE_CONFIG_DIR = prev;
  }
});

test('looksLikeVisionModel and lastUserText', () => {
  assert.equal(looksLikeVisionModel('qwen-2.5-vl-7b'), true);
  assert.equal(looksLikeVisionModel('qwen-3-8b'), false);
  assert.equal(lastUserText('hi'), 'hi');
  assert.equal(lastUserText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
});

test('collectImagePaths ignores missing files', () => {
  const dir = tmpDir('bracket-img-');
  assert.deepEqual(collectImagePaths('see ./nope.png', dir), []);
});

test('prepareBracketTurn injects memory and honors plan mode with router off', async () => {
  const dir = tmpDir('bracket-turn-');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Always use bun.');
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'hello workspace');
  const prepared = await prepareBracketTurn({
    messages: [
      { role: 'system', content: 'old' },
      { role: 'user', content: 'what is here?' },
    ],
    model: 'qwen-3-8b',
    cwd: dir,
    settings: { router: false, agentMode: 'plan', modePinned: true, thinking: true },
    catalog: [{ id: 'qwen-3-8b' }],
    yolo: false,
  });
  assert.equal(prepared.model, 'qwen-3-8b');
  assert.equal(prepared.route.mode, 'plan');
  assert.match(prepared.messages[0].content, /Always use bun/);
  assert.match(prepared.messages[0].content, /Mode: plan/);
  const names = prepared.tools.map((t) => t.function.name);
  assert.ok(!names.includes('write_file'));
  assert.ok(names.includes('read_file'));
  assert.ok(TOOL_DEFS.some((t) => t.function.name === 'delegate'));
  assert.ok(TOOL_DEFS.some((t) => t.function.name === 'diagnostics'));
  assert.equal(defaultRoute({ model: 'x', tools: TOOL_DEFS }).mode, 'agent');
});
