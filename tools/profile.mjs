#!/usr/bin/env node
// The profile: which discipline skills each role reads, chosen by the architect's decisions. A discipline skill
// (skills/discipline-*/SKILL.md, skills/stack-*/SKILL.md, and a project's .claude/skills/discipline-*/SKILL.md) declares
// in its frontmatter the ADR tags that switch it on (`x-tags: [dotnet, ef-core]`; `[]` means always on) and the roles
// that read it (`x-roles: [architect, builder, ...]`). An ADR declares its tags on a line `Tags: dotnet, ef-core, rest`.
// The developer skills follow the architect's decisions, the architect's follow the product owner's requirements: the
// team forms top-down from the documents, and this script is where that is computed, so a brief can list the exact
// files a role reads and the review can refuse a rule id no skill defines.
// Usage: node profile.mjs [--root <dir>]            the tags, then one line per role with its skills
//        node profile.mjs <role> [--root <dir>]     one skill path per line, what that role reads
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMain } from './hook-common.mjs';
import { KIT_ROOT, parseFrontmatter } from './roles.mjs';
import { DECISIONS_PREFIX } from './scope.mjs';

export const ROLES = ['analyst', 'architect', 'planner', 'builder', 'tester', 'critic', 'devops', 'ux-designer', 'finder-correctness', 'finder-security', 'finder-contract', 'finder-domain', 'finder-legal', 'finder-ux', 'verifier', 'product-owner', 'domain-expert', 'legal'];

/** The tags every ADR under docs/decisions/ declares (`Tags: a, b, c`, case-insensitive, any status but superseded), lower-cased. */
export function adrTags(root) {
  const dir = join(root, DECISIONS_PREFIX);
  const tags = new Set();
  if (!existsSync(dir)) return tags;
  for (const name of readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    if (/^(?:Date:.*)?Status:\s*superseded\b/im.test(text) || /\bStatus:\s*superseded\b/i.test(text)) continue;
    for (const m of text.matchAll(/^Tags:\s*(.+)$/gim)) {
      for (const t of m[1].split(/[,\s]+/)) if (t.trim()) tags.add(t.trim().toLowerCase().replace(/[`'"]/g, ''));
    }
  }
  return tags;
}

/** The rule ids `XX-nn` (two or three capitals, a dash, a number) of a skill text, in order. */
export function disciplineRuleIds(text) {
  return [...String(text ?? '').matchAll(/^#{2,4}\s+([A-Z]{2,4}-\d+)\b/gm)].map((m) => m[1]);
}

/** One skill file read into its profile entry, or null when it is not a discipline skill. */
function readSkill(file, label, origin) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm.name) return null;
  const rules = disciplineRuleIds(text);
  const prefix = rules[0]?.split('-')[0] ?? null;
  return {
    name: fm.name,
    path: label,
    file,
    origin,
    prefix,
    rules,
    tags: [].concat(fm['x-tags'] ?? []).map((t) => String(t).toLowerCase()),
    roles: [].concat(fm['x-roles'] ?? []).map((r) => String(r).toLowerCase()),
    description: fm.description ?? '',
  };
}

/** Every discipline and stack skill: the kit's first, then the project's own under .claude/skills/discipline-*. */
export function disciplineSkills(root, kitRoot = KIT_ROOT) {
  const out = [];
  const kitDir = join(kitRoot, 'skills');
  if (existsSync(kitDir)) {
    for (const name of readdirSync(kitDir).filter((d) => /^(?:discipline|stack)-/.test(d)).sort()) {
      const entry = readSkill(join(kitDir, name, 'SKILL.md'), `sdlc-kit/skills/${name}/SKILL.md`, 'kit');
      if (entry) out.push(entry);
    }
  }
  const dir = join(root, '.claude/skills');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((d) => /^(?:discipline|stack)-/.test(d)).sort()) {
      const rel = `.claude/skills/${name}/SKILL.md`;
      const entry = readSkill(join(root, rel), rel, 'project');
      if (entry) out.push(entry);
    }
  }
  return out;
}

/** True when the ADR tags switch the skill on: no tags means always, else one shared tag is enough. */
export function activeFor(skill, tags) {
  return skill.tags.length === 0 || skill.tags.some((t) => tags.has(t));
}

/** The skills one role reads in this project, in the kit's order. */
export function profileFor(root, role, kitRoot = KIT_ROOT) {
  const tags = adrTags(root);
  const name = String(role ?? '').toLowerCase();
  return disciplineSkills(root, kitRoot).filter((s) => activeFor(s, tags) && s.roles.includes(name));
}

/** The whole profile: the tags, every active skill, and the skills per role. */
export function profile(root, kitRoot = KIT_ROOT) {
  const tags = adrTags(root);
  const skills = disciplineSkills(root, kitRoot);
  const active = skills.filter((s) => activeFor(s, tags));
  const inactive = skills.filter((s) => !activeFor(s, tags));
  const roles = {};
  for (const role of ROLES) roles[role] = active.filter((s) => s.roles.includes(role)).map((s) => s.name);
  return { tags: [...tags].sort(), skills, active, inactive, roles };
}

/** Every rule id an active skill defines, with the skill that defines it: what a finding's `rule` may cite. */
export function activeRules(root, kitRoot = KIT_ROOT) {
  const map = new Map();
  for (const s of profile(root, kitRoot).active) for (const id of s.rules) if (!map.has(id)) map.set(id, s);
  return map;
}

/** A reading list for a brief: one line per skill, the path first, then the rule range. */
export function readingList(root, role, kitRoot = KIT_ROOT) {
  return profileFor(root, role, kitRoot).map((s) => `${s.path} (${s.prefix ? `${s.rules[0]} to ${s.rules.at(-1)}` : 'no rule ids'})`);
}

function cli(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd());
  const role = argv.find((a, i) => !a.startsWith('--') && (rootIdx < 0 || i !== rootIdx + 1));
  if (role) {
    const list = readingList(root, role);
    if (!list.length) console.log(`${role}: no discipline skill applies (tags: ${[...adrTags(root)].join(', ') || 'none; add a "Tags:" line to an ADR'})`);
    for (const line of list) console.log(line);
    return 0;
  }
  const p = profile(root);
  console.log(`tags      ${p.tags.join(', ') || 'none (no "Tags:" line in docs/decisions/*.md; only the always-on skills apply)'}`);
  console.log(`skills    ${p.active.length} active${p.inactive.length ? `, ${p.inactive.length} off (${p.inactive.map((s) => `${s.name}: ${s.tags.join('|')}`).join('; ')})` : ''}`);
  for (const role of ROLES) if (p.roles[role].length) console.log(`${role.padEnd(18)} ${p.roles[role].join(', ')}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(cli(process.argv.slice(2)));
