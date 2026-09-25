import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from '../config.js';

const MAX_SKILL = 4000;

function dirs(cwd) {
  return [
    path.join(path.resolve(cwd || '.'), '.scalattice', 'skills'),
    path.join(configDir(), 'skills'),
  ];
}

function listMd(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

function parseSkill(abs) {
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  const name = path.basename(abs, '.md');
  const first = text.split('\n').find((l) => l.trim()) || name;
  return {
    id: name,
    title: first.replace(/^#\s+/, '').trim().slice(0, 80),
    text: text.trim().slice(0, MAX_SKILL),
  };
}

export function loadSkills(cwd) {
  const byId = new Map();
  for (const dir of dirs(cwd)) {
    for (const abs of listMd(dir)) {
      const skill = parseSkill(abs);
      if (skill && !byId.has(skill.id)) byId.set(skill.id, skill);
    }
  }
  return [...byId.values()];
}

export function skillsCatalog(skills) {
  return (skills || []).map((s) => `${s.id}: ${s.title}`).join('\n');
}

export function pickSkills(skills, ids) {
  const want = new Set((ids || []).map((id) => String(id).trim()).filter(Boolean));
  if (!want.size) return [];
  return (skills || []).filter((s) => want.has(s.id));
}

export function formatSkills(skills) {
  if (!skills?.length) return '';
  return skills.map((s) => `# Skill ${s.id}\n${s.text}`).join('\n\n');
}

export function skillsHomeHint() {
  return path.join(configDir() || os.homedir(), 'skills');
}
