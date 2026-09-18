import assert from 'node:assert/strict';
import { test } from 'node:test';
import { companyPrompt } from './company.js';
import { inlineMarkdown, markdownToAnsi, stripAnsi } from './markdown.js';
import { buildSystemPrompt } from './prompt.js';

test('markdown headings lists rules and emphasis drop the markers', () => {
  const out = stripAnsi(
    markdownToAnsi(
      [
        '### **Use Cases**',
        '',
        '- **Developer Workflow**: Automate testing.',
        '- *Team* notes',
        '',
        '** Bold Title **',
        '',
        '---',
        '',
        'See [docs](https://scalattice.com/cli/) and `scalattice bracket`.',
      ].join('\n'),
      { color: false }
    )
  );
  assert.match(out, /^Use Cases$/m);
  assert.doesNotMatch(out, /###/);
  assert.match(out, /\* Developer Workflow: Automate testing\./);
  assert.doesNotMatch(out, /\*\*/);
  assert.match(out, /\* Team notes/);
  assert.match(out, /Bold Title/);
  assert.match(out, /-{3,}/);
  assert.match(out, /docs/);
  assert.doesNotMatch(out, /https:\/\/scalattice\.com/);
  assert.match(out, /scalattice bracket/);
});

test('colored headings and spaced bold drop asterisks', () => {
  const out = stripAnsi(
    markdownToAnsi('### **Use Cases**\n\n**hello world**', { color: true })
  );
  assert.match(out, /Use Cases/);
  assert.match(out, /hello world/);
  assert.doesNotMatch(out, /\*/);
});

test('markdown fences keep code markers out of the body', () => {
  const out = stripAnsi(
    markdownToAnsi('```js\nconst x = 1;\n```\nnext', { color: false })
  );
  assert.match(out, /js/);
  assert.match(out, /const x = 1;/);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /next/);
});

test('unclosed emphasis still styles through end of stream', () => {
  const bold = inlineMarkdown('**Developer', { color: false });
  assert.equal(bold, 'Developer');
  const code = inlineMarkdown('`partial', { color: false });
  assert.equal(code, 'partial');
});

test('tables and quotes render without pipes', () => {
  const out = stripAnsi(
    markdownToAnsi('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> note', { color: false })
  );
  assert.match(out, /a/);
  assert.match(out, /1/);
  assert.doesNotMatch(out, /\|/);
  assert.match(out, /note/);
});

test('company brief is factual and not a git checkout', () => {
  const text = companyPrompt();
  assert.match(text, /Robottik Ltd/);
  assert.match(text, /17193565/);
  assert.match(text, /OpenAI-compatible/);
  assert.match(text, /slt_/);
  assert.match(text, /scalattice-agent/);
  assert.match(text, /api\.scalattice\.cloud\/v1/);
  assert.doesNotMatch(text, /[\u2014\u2013]/);
  assert.doesNotMatch(text, /git checkout/i);
  assert.doesNotMatch(text, /node \.\/bin/);
});

test('palette has no turquoise', async () => {
  const { ACCENT, CODE, LOGO, TEXT } = await import('./theme.js');
  const { markdownToAnsi } = await import('./markdown.js');
  const blob = [ACCENT, CODE, LOGO, TEXT, markdownToAnsi('# hi\n- [x](https://a)', { color: true })].join('');
  assert.doesNotMatch(blob, /38;2;34;211;238/);
  assert.doesNotMatch(blob, /38;2;125;211;252/);
  assert.match(LOGO, /38;2;245;245;245/);
  assert.match(ACCENT, /38;2;167;139;250/);
});

test('pickDefaultModel prefers the last used model over the catalog default', async () => {
  const { pickDefaultModel } = await import('./prompt.js');
  const ids = ['qwen-3-coder-30b-a3b', 'qwen-3-8b', 'qwen-3-32b'];
  const prev = process.env.SCALATTICE_BRACKET_MODEL;
  delete process.env.SCALATTICE_BRACKET_MODEL;
  try {
    assert.equal(pickDefaultModel(ids), 'qwen-3-coder-30b-a3b');
    assert.equal(pickDefaultModel(ids, 'qwen-3-8b'), 'qwen-3-8b');
    assert.equal(pickDefaultModel(ids, 'missing-model'), 'qwen-3-coder-30b-a3b');
    assert.equal(pickDefaultModel([], 'qwen-3-8b'), 'qwen-3-8b');
  } finally {
    if (prev === undefined) delete process.env.SCALATTICE_BRACKET_MODEL;
    else process.env.SCALATTICE_BRACKET_MODEL = prev;
  }
});

test('system prompt includes Scalattice knowledge and markdown instruction', () => {
  const prompt = buildSystemPrompt({ cwd: process.cwd(), model: 'qwen-3-8b', yolo: false });
  assert.match(prompt, /# Scalattice/);
  assert.match(prompt, /Robottik Ltd/);
  assert.match(prompt, /Write replies in Markdown/);
  assert.match(prompt, /Do not reverse-engineer the company/);
  assert.match(prompt, /read_file with offset\/limit/);
  assert.doesNotMatch(prompt, /Workspace files \(partial\)/);
  assert.doesNotMatch(prompt, /Recent commits/);
});
