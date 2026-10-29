#!/usr/bin/env node
// Roles and their write scopes (the write matrix), read from the frontmatter of agents/*.md in the kit.
//   x-writes: []                         a judge: a role that writes nothing by any tool (the finders, the verifier, the critic)
//   x-writes: slice                      the builder: the active slice's files plus docs/MANUAL-CHECKS.md, docs/** with no slice
//   x-writes: [docs/PLAN.md, tests/**/*.spec.mjs]   a role with its own files: those paths and nothing else, slice or no slice
//   no x-writes key                      same as []
// Patterns: `*` matches inside one path segment, `**` matches any number of segments; a bare folder (`scripts/`) matches
// everything under it. Human-only files and the content rules apply to every role whatever its patterns say.
// A hook event names its agent in `agent_type`; a plugin agent arrives as "sdlc-kit:builder" (verified on a real
// run, Claude Code 2.1.310), so the match is on the part after the last colon. No `agent_type` means the main session.
// Usage: node roles.mjs            prints every role and its scope
//        node roles.mjs <agent_type>   prints the role a hook input with that agent_type resolves to
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './hook-common.mjs';

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AGENTS_DIR = 'agents';

/** The main session (no subagent): the default rules, slice files when a slice is active, else docs/** and the init files. */
export const MAIN = Object.freeze({ name: 'main', writes: 'main', known: true });

/** The frontmatter between the first two `---` lines as plain key: value pairs; `[]` and `[a, b]` become arrays. */
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trim();
    if (/^\[.*\]$/.test(value)) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      out[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/** `[]` or missing: a judge. `slice`: the builder's scope. A list: the role's own path patterns. Anything else is read as `[]`, the safe side. */
export function parseWrites(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.length ? value.map((v) => String(v).trim()).filter(Boolean) : [];
  if (String(value).trim() === 'slice') return 'slice';
  return [];
}

/** A role that writes its own listed paths (the analyst, the architect, the planner, the tester, the devops). */
export function hasOwnPaths(role) {
  return Array.isArray(role?.writes) && role.writes.length > 0;
}

/** One write pattern as a regular expression over a project path: `**` any segments, `*` inside a segment, a trailing `/` the whole folder. */
export function patternToRegExp(pattern) {
  let p = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.endsWith('/')) p += '**';
  const segment = (part) => part.split('*').map((s) => s.replace(/\[(!?)([^\]]*)\]/g, (m, neg, body) => `\u0000${neg ? '^' : ''}${body.replace(/\\/g, '\\\\')}\u0001`).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '[^/]').replace(/\u0000/g, '[').replace(/\u0001/g, ']')).join('[^/]*');
  const escaped = p
    .split('**/')
    .map((part) => part.split('**').map(segment).join('.*'))
    .join('(?:.*/)?');
  return new RegExp(`^${escaped}$`, 'i');
}

/** True when the project path matches one of the role's own patterns. */
export function matchesOwnPaths(role, relPath) {
  if (!hasOwnPaths(role)) return false;
  return role.writes.some((pattern) => patternToRegExp(pattern).test(relPath));
}

/** Every agents/*.md in the kit: name -> { name, writes, model, file }. */
export function loadRoles(kitRoot = KIT_ROOT) {
  const dir = join(kitRoot, AGENTS_DIR);
  const roles = new Map();
  if (!existsSync(dir)) return roles;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const fm = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
    const name = fm.name || file.replace(/\.md$/, '');
    roles.set(name, { name, writes: parseWrites(fm['x-writes']), model: fm.model ?? null, file: join(AGENTS_DIR, file), known: true });
  }
  return roles;
}

/** "sdlc-kit:builder" -> "builder"; "builder" -> "builder"; missing -> null. */
export function roleName(agentType) {
  if (typeof agentType !== 'string' || !agentType.trim()) return null;
  return agentType.trim().split(':').pop();
}

/**
 * The role of a hook event. A kit agent gets its own scope; the main session, and any agent the kit does not
 * define (Explore, a project agent), get the main rules.
 */
export function roleOf(input, roles = loadRoles()) {
  const name = roleName(input?.agent_type);
  if (!name) return MAIN;
  const role = roles.get(name);
  if (role) return role;
  return { ...MAIN, name, known: false };
}

/** The main session itself: no agent_type, not an agent the kit does not know. */
export function isMainSession(role) {
  return role === MAIN || (role?.name === 'main' && role?.known === true);
}

export function isJudge(role) {
  return Array.isArray(role?.writes) && role.writes.length === 0;
}

export function describeWrites(role) {
  if (isJudge(role)) return 'nothing';
  if (role.writes === 'slice') return 'the active slice files (plus docs/MANUAL-CHECKS.md), docs/** with no slice';
  if (role.writes === 'main') return 'the active slice files, or docs/** and the init files with no slice';
  return [].concat(role.writes).join(', ');
}

function cli(argv) {
  const roles = loadRoles();
  if (argv[0]) {
    const role = roleOf({ agent_type: argv[0] }, roles);
    console.log(`${argv[0]} -> ${role.name}${role.known ? '' : ' (not a kit agent, main rules)'}: writes ${describeWrites(role)}`);
    return 0;
  }
  console.log(`${'role'.padEnd(20)} ${'model'.padEnd(8)} writes`);
  for (const role of roles.values()) console.log(`${role.name.padEnd(20)} ${String(role.model ?? '-').padEnd(8)} ${describeWrites(role)}`);
  console.log(`${'main'.padEnd(20)} ${'-'.padEnd(8)} ${describeWrites(MAIN)}`);
  console.log('A judge is a role with x-writes: [] (the finders and the verifier): it reads and runs tests, it writes nothing.');
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
