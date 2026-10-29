#!/usr/bin/env node
// The clerk's script for the review stage. The models find and verify; this script decides what counts.
//   node review.mjs start [--cycle n] [--scope <range>|all] [--author sonnet]
//       tree clean, no slice active, cycle 1 or 2 only; writes docs/review/state.json and docs/review/<cycle>/brief.txt;
//       prints the finder classes to run (cycle 1: correctness, security, contract, legal, plus domain when a project
//       domain skill exists under .claude/skills/domain-*/; cycle 2: the classes confirmed or watch-listed in cycle 1)
//   node review.mjs check --cycle n
//       validates docs/review/<cycle>/finder-*.json, renumbers a repeated id (COR-7 -> COR-7a), writes findings.json;
//       exit 1 with one RE-ASK line per finder whose answer is not usable
//   node review.mjs render --cycle n
//       validates verifier.json, places every id exactly once, runs the gate and mutate.mjs itself for the header,
//       computes routes from docs/PLAN.md, writes docs/REVIEW.md; F-ids are stable across cycles (state.nextF)
//   node review.mjs decide --cycle n --accept F-01,F-02 --reject F-03..F-18 [--note "..."]
//       records the human's decision on every confirmed finding in docs/review/<n>/decisions.json; cycle n+1 carries
//       only the accepted ones
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMain } from './hook-common.mjs';
import { recordDecision } from './internal/record-decision.mjs';
import { activeSlice, readPlan, readText, domainSkills, legalSkills, LEGAL_RULE_ID, PLAN_FILE, REQUIREMENTS_FILE } from './scope.mjs';
import { activeRules, readingList, adrTags } from './profile.mjs';
import { runGate } from './gate.mjs';
import { mutate } from './mutate.mjs';
import { loadRoles, KIT_ROOT } from './roles.mjs';

export const REVIEW_DIR = 'docs/review';
export const STATE_FILE = 'docs/review/state.json';
export const REVIEW_FILE = 'docs/REVIEW.md';
export const CLASSES = ['correctness', 'security', 'contract', 'domain', 'legal'];
export const PREFIX = { correctness: 'COR', security: 'SEC', contract: 'CON', domain: 'DOM', legal: 'LEG' };
/** The classes every cycle 1 runs; `domain` joins them only when a project domain skill exists. */
export const BASE_CLASSES = ['correctness', 'security', 'contract', 'legal'];
/** A domain rule id as a domain skill writes it: `### D-03 ...`. */
export const RULE_ID = /^D-\d+$/;
export const MAX_CYCLE = 2;
export const DEFAULT_AUTHOR = 'sonnet';
export const FINDING_FIELDS = { id: 'string', class: 'string', severity: 'string', file: 'string', line: 'number', what_breaks: 'string', requirement: 'string', evidence: 'string', proven: 'boolean' };
export const LEVELS = ['code', 'plan', 'requirement'];
/** A carried finding keeps the F-id it got in the previous cycle's REVIEW.md. F-ids never change. */
export const CARRIED_ID = /^F-\d{2,}$/;
export const ROW_WIDTH = 100;

/** The models the finder agent files declare, from their frontmatter (one word when they agree). */
export function finderModels() {
  const models = [...loadRoles().values()].filter((r) => r.name.startsWith('finder-')).map((r) => r.model ?? 'unset');
  return [...new Set(models)].join('/') || 'unset';
}

/** `F-03..F-18`, `F-01,F-02` and mixes of both as a list of F-ids. */
export function expandFids(text) {
  const out = [];
  for (const part of String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^F-(\d+)\.\.F-(\d+)$/);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(`F-${String(n).padStart(2, '0')}`);
    } else if (/^F-\d+$/.test(part)) out.push(`F-${part.slice(2).padStart(2, '0')}`);
    else out.push(part);
  }
  return [...new Set(out)];
}

/** Text wrapped at `width` on single spaces, inner spacing kept, continuation lines indented. */
export function wrap(text, width = ROW_WIDTH, indent = '      ') {
  let rest = String(text);
  const lines = [];
  let first = true;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width);
    if (cut <= (first ? 0 : indent.length)) cut = rest.indexOf(' ', width);
    if (cut < 0) break;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = indent + rest.slice(cut).trimStart();
    first = false;
  }
  lines.push(rest);
  return lines;
}
export const FINDING_ID = /^(COR|SEC|CON|DOM|LEG|VER)-\d+[a-z]?$/;

/** `claude-opus-5-5` -> `opus`, `claude-sonnet-4-5` -> `sonnet`; anything else as written. */
export function normalizeModel(name) {
  const m = String(name ?? '').match(/\b(opus|sonnet|haiku|fable)\b/i);
  return m ? m[1].toLowerCase() : String(name ?? '').trim() || 'not reported';
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function readState(root) {
  return readJson(join(root, STATE_FILE), null);
}

export function writeState(root, state) {
  writeFile(join(root, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

/** The first balanced JSON array or object in a text that may also carry Checklist:, Partial: or Blocked: lines. */
export function extractJson(text) {
  const src = String(text ?? '');
  const start = src.search(/[[{]/);
  if (start < 0) return { json: null, error: 'no JSON found' };
  const open = src[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try {
          return { json: JSON.parse(src.slice(start, i + 1)), rest: src.slice(0, start) + src.slice(i + 1) };
        } catch (e) {
          return { json: null, error: `JSON does not parse: ${e.message}` };
        }
      }
    }
  }
  return { json: null, error: 'JSON is not closed' };
}

/** The Checklist:, Partial: and Blocked: lines around a finder's or the verifier's JSON. */
export function statusLines(text) {
  const out = {};
  for (const m of String(text ?? '').matchAll(/^\s*(Checklist|Partial|Blocked|Model|Gate|Mutations):\s*(.*)$/gm)) out[m[1].toLowerCase()] = m[2].trim();
  const survivors = [...String(text ?? '').matchAll(/^\s*survived:\s*(\S.*)$/gm)].map((m) => m[1].trim());
  if (survivors.length) out.survivors = survivors;
  return out;
}

/**
 * One finding against the schema: null when fine, else the problem. A `domain` finding also needs `rule` (`D-nn`) and
 * a `legal` finding `rule` (`LD-nn`, `LL-nn`, `LE-nn` or a project prefix); `rules` is `{ domain, legal }`, each a Set
 * of the ids the skills define (domain null when the project has no domain skill), and the rule must be one of them.
 */
export function findingProblem(item, index, rules = null) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return `item ${index + 1} is not an object`;
  for (const [field, type] of Object.entries(FINDING_FIELDS)) {
    if (!(field in item)) return `item ${index + 1} (${item.id ?? 'no id'}) is missing "${field}"`;
    if (typeof item[field] !== type) return `item ${index + 1} (${item.id ?? 'no id'}): "${field}" must be a ${type}`;
  }
  if (!/^(COR|SEC|CON|DOM|LEG)-\d+[a-z]?$/.test(item.id)) return `item ${index + 1}: id "${item.id}" must look like COR-1, SEC-1, CON-1, DOM-1 or LEG-1`;
  if (!CLASSES.includes(item.class)) return `item ${index + 1} (${item.id}): class "${item.class}" must be one of ${CLASSES.join(', ')}`;
  if (!['blocking', 'advisory'].includes(item.severity)) return `item ${index + 1} (${item.id}): severity "${item.severity}" must be blocking or advisory`;
  return ruleProblem(item, index, rules);
}

/**
 * The `rule` field of a domain or legal item: a `D-nn` id defined by the domain skills, or an `L?-nn` id defined by
 * the legal skills, when their ids are known (`rules = { domain, legal }`).
 */
export function ruleProblem(item, index, rules = null) {
  const id = String(item.id ?? '');
  if (item.class === 'domain' || /^DOM-/.test(id)) {
    if (typeof item.rule !== 'string' || !RULE_ID.test(item.rule)) return `item ${index + 1} (${item.id}): a domain finding needs "rule" like D-03`;
    const defined = rules?.domain;
    if (defined && !defined.has(item.rule)) return `item ${index + 1} (${item.id}): rule "${item.rule}" is not defined in the domain skill (defined: ${[...defined].join(', ') || 'none'})`;
    return null;
  }
  if (item.class === 'legal' || /^LEG-/.test(id)) {
    if (typeof item.rule !== 'string' || !LEGAL_RULE_ID.test(item.rule)) return `item ${index + 1} (${item.id}): a legal finding needs "rule" like LD-03`;
    const defined = rules?.legal;
    if (defined && !defined.has(item.rule)) return `item ${index + 1} (${item.id}): rule "${item.rule}" is not defined in a legal skill (defined: ${[...defined].join(', ') || 'none'})`;
    return null;
  }
  if (item.rule !== undefined) {
    if (typeof item.rule !== 'string' || !DISCIPLINE_RULE_ID.test(item.rule)) return `item ${index + 1} (${item.id}): "rule" must be a discipline rule id like CP-03 or NET-07`;
    const defined = rules?.discipline;
    if (defined && !defined.has(item.rule)) return `item ${index + 1} (${item.id}): rule "${item.rule}" is not defined in an active discipline skill (the profile lists them: node profile.mjs)`;
  }
  return null;
}

/** A discipline rule id: a two- to four-letter prefix and a number (CP-03, NET-07, SE-12). */
export const DISCIPLINE_RULE_ID = /^[A-Z]{2,4}-\d+$/;

/** The rule ids every domain skill of the project defines, or null when the project has no domain skill. */
export function domainRules(root) {
  const skills = domainSkills(root);
  return skills.length ? new Set(skills.flatMap((s) => s.rules)) : null;
}

/** The rule ids every legal skill defines: the kit's three plus the project's. */
export function legalRules(root) {
  return new Set(legalSkills(root).flatMap((s) => s.rules));
}

/** Reads and validates one finder file. Returns { ok, findings, checklist, partial, blocked, problem }. */
export function readFinder(path, cls, rules = null) {
  if (!existsSync(path)) return { ok: false, findings: [], problem: `${path} is missing` };
  const text = readFileSync(path, 'utf8');
  const { json, error, rest } = extractJson(text);
  const status = statusLines(rest ?? text);
  if (json === null) return { ok: false, findings: [], problem: error, ...status };
  if (!Array.isArray(json)) return { ok: false, findings: [], problem: 'the answer is not a JSON array', ...status };
  for (let i = 0; i < json.length; i++) {
    const problem = findingProblem(json[i], i, rules);
    if (problem) return { ok: false, findings: json, problem, ...status };
  }
  if (!json.length && !status.checklist && !status.blocked) return { ok: false, findings: [], problem: 'an empty array needs the Checklist: line that says every item ran', ...status };
  return { ok: true, findings: json, problem: null, ...status };
}

/** One list with every id once: a repeated id is renumbered COR-7a, COR-7b, never dropped. */
export function mergeFindings(perClass) {
  const seen = new Set();
  const renumbered = [];
  const all = [];
  for (const cls of CLASSES) {
    for (const f of perClass[cls] ?? []) {
      let id = f.id;
      if (seen.has(id)) {
        const base = id.replace(/[a-z]$/, '');
        let suffix = 'a';
        while (seen.has(base + suffix)) suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
        renumbered.push(`${id} -> ${base + suffix}`);
        id = base + suffix;
      }
      seen.add(id);
      all.push({ ...f, id, finder: cls });
    }
  }
  return { findings: all, renumbered };
}

/** The slices of the plan that own a file. */
export function slicesOwning(plan, file) {
  if (!plan) return [];
  return [...plan.values()].filter((s) => s.files.includes(file)).map((s) => s.id);
}

export function routeOf(finding, plan, nextQuestion) {
  if (finding.level === 'requirement') return `question to the human: Q-${String(nextQuestion()).padStart(2, '0')} in ${REQUIREMENTS_FILE}`;
  if (finding.level === 'plan') return `re-plan: /sdlc-kit:plan-slices with the finding`;
  const files = [finding.file, ...(finding.merged_files ?? [])].filter(Boolean);
  const owners = [...new Set(files.flatMap((f) => slicesOwning(plan, f)))];
  if (!owners.length) return `reopen: no slice in ${PLAN_FILE} owns ${finding.file}; re-plan`;
  return `reopen ${owners.join(', ')}`;
}

function nextQuestionNumber(root) {
  const text = readText(join(root, REQUIREMENTS_FILE));
  let n = Math.max(0, ...[...text.matchAll(/\bQ-(\d+)/g)].map((m) => Number(m[1])));
  return () => ++n;
}

/** The verifier's answer against the schema: a list of problems (empty when fine). */
export function verifierProblems(v) {
  const problems = [];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['the answer is not a JSON object'];
  if (typeof v.pass !== 'boolean') problems.push('"pass" must be true or false');
  for (const list of ['confirmed', 'watchList', 'refuted', 'tradeoffs']) if (!Array.isArray(v[list])) problems.push(`"${list}" must be an array`);
  for (const [i, c] of (Array.isArray(v.confirmed) ? v.confirmed : []).entries()) {
    for (const field of ['id', 'severity', 'file', 'what_breaks', 'evidence', 'level']) if (typeof c?.[field] !== 'string') problems.push(`confirmed item ${i + 1}: "${field}" must be a string`);
    const bare = typeof c?.id === 'string' ? c.id.replace(/^cycle\d+[/:]/, '') : '';
    if (typeof c?.id === 'string' && !FINDING_ID.test(bare) && !CARRIED_ID.test(bare)) problems.push(`confirmed ${c.id}: id must be COR-n, SEC-n, CON-n, DOM-n, LEG-n, VER-n or a carried F-nn`);
    if (c?.level && !LEVELS.includes(c.level)) problems.push(`confirmed ${c.id}: level "${c.level}" must be code, plan or requirement`);
    if (c?.merged !== undefined && !Array.isArray(c.merged)) problems.push(`confirmed ${c.id}: "merged" must be an array`);
  }
  for (const [i, w] of (Array.isArray(v.watchList) ? v.watchList : []).entries()) {
    if (typeof w?.id !== 'string') problems.push(`watchList item ${i + 1} has no id`);
  }
  for (const [i, r] of (Array.isArray(v.refuted) ? v.refuted : []).entries()) {
    if (typeof r?.id !== 'string' || typeof r?.evidence !== 'string') problems.push(`refuted item ${i + 1} needs id and evidence`);
  }
  if (v.survivors !== undefined) {
    if (!Array.isArray(v.survivors)) problems.push('"survivors" must be an array');
    else for (const [i, m] of v.survivors.entries()) {
      for (const field of ['file', 'from', 'to']) if (typeof m?.[field] !== 'string') problems.push(`survivors item ${i + 1}: "${field}" must be a string`);
      if (!Number.isInteger(m?.line)) problems.push(`survivors item ${i + 1}: "line" must be a number`);
      if (typeof m?.equivalent !== 'boolean') problems.push(`survivors item ${i + 1}: "equivalent" must be true or false`);
      if (m?.equivalent === true && typeof m?.why !== 'string') problems.push(`survivors item ${i + 1}: an equivalent mutant needs "why"`);
    }
  }
  return problems;
}

/** The survivor lines for the header: `  survived: ...` and `  survived (equivalent): ... (why)`. */
export function survivorLines(verdict, status) {
  if (Array.isArray(verdict?.survivors)) {
    return verdict.survivors.map((m) => `  survived${m.equivalent ? ' (equivalent)' : ''}: ${m.file}:${m.line} ${JSON.stringify(m.from.trim())} -> ${JSON.stringify(m.to.trim())}${m.equivalent && m.why ? ` (${m.why})` : ''}`);
  }
  return (status?.survivors ?? []).map((line) => `  survived: ${line}`);
}

/**
 * Every required id exactly once. Missing ids go to the watch list with why_unproven "verifier did not place it";
 * an id placed twice keeps its first placement (confirmed, then watch list, then refuted) and is reported.
 */
export function placeAll(verdict, required, byId, aliases = new Map()) {
  const notes = [];
  const seen = new Map();
  const placedIds = new Set([
    ...['confirmed', 'watchList', 'refuted'].flatMap((list) => verdict[list].map((item) => item.id)),
    ...verdict.confirmed.flatMap((c) => (Array.isArray(c.merged) ? c.merged : [])),
  ]);
  const canon = (id) => {
    const m = String(id).match(/^(?:cycle\d+[/:])?([A-Z]+-\d+[a-z]?)$/);
    const alias = m && aliases.get(m[1]);
    if (alias && alias !== id && !placedIds.has(alias)) {
      notes.push(`${id} read as the carried ${alias}`);
      placedIds.add(alias);
      return alias;
    }
    return id;
  };
  for (const list of ['confirmed', 'watchList', 'refuted']) for (const item of verdict[list]) item.id = canon(item.id);
  for (const c of verdict.confirmed) if (Array.isArray(c.merged)) c.merged = c.merged.map(canon);
  const take = (id, where) => {
    if (seen.has(id)) {
      notes.push(`${id} placed twice (${seen.get(id)} and ${where}); kept in ${seen.get(id)}`);
      return false;
    }
    seen.set(id, where);
    return true;
  };
  const confirmed = [];
  for (const c of verdict.confirmed) {
    if (!take(c.id, 'confirmed')) continue;
    const merged = (c.merged ?? []).filter((id) => take(id, `merged into ${c.id}`));
    confirmed.push({ ...c, merged, merged_files: merged.map((id) => byId.get(id)?.file).filter(Boolean) });
  }
  const watchList = verdict.watchList.filter((w) => take(w.id, 'watchList'));
  const refuted = verdict.refuted.filter((r) => take(r.id, 'refuted'));
  for (const id of required) {
    if (seen.has(id)) continue;
    const original = byId.get(id) ?? {};
    watchList.push({ ...original, id, proven: false, why_unproven: 'verifier did not place it', how_to_settle: original.evidence ? `check: ${original.evidence}` : 'ask the verifier in the next cycle' });
    seen.set(id, 'watchList');
    notes.push(`${id} was not placed by the verifier; put on the watch list`);
  }
  const unknown = [...seen.keys()].filter((id) => !required.includes(id) && !/^VER-\d+[a-z]?$/.test(id));
  for (const id of unknown) notes.push(`${id} is not a finding of this cycle`);
  return { confirmed, watchList, refuted, notes };
}

/** Planted defects that survived and that the verifier did not mark equivalent. From the JSON when present, else from the Mutations: line. */
export function realSurvivors(verdict, mutationsLine) {
  if (Array.isArray(verdict?.survivors)) return verdict.survivors.filter((m) => m.equivalent !== true).length;
  const line = mutationsLine ?? '';
  const count = line.match(/(\d+)\s+survived/);
  if (count) return Number(count[1]);
  const ratio = line.match(/(\d+)\/(\d+)/);
  if (ratio) return Math.max(0, Number(ratio[1]) - Number(ratio[2]));
  return /survived:\s*(?!none\b)\S/.test(line) ? 1 : 0;
}

/** The verdict the script decides: MERGE, FIX FIRST, or BUDGET at the end of the last cycle for any reason that remains. */
export function verdictOf(placed, verdict, cycle, mutationsLine, extraReasons = []) {
  const blocking = placed.confirmed.filter((c) => c.severity === 'blocking');
  const survived = realSurvivors(verdict, mutationsLine);
  const reasons = [...extraReasons];
  if (blocking.length) reasons.push(`${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'} confirmed`);
  if (placed.tradeoffs.length) reasons.push(`${placed.tradeoffs.length} trade-off${placed.tradeoffs.length === 1 ? '' : 's'} open`);
  if (survived) reasons.push(`${survived} planted defect${survived === 1 ? '' : 's'} survived`);
  if (!reasons.length && verdict.pass !== true) reasons.push('the verifier did not pass it');
  if (!reasons.length) return { verdict: 'MERGE', reasons: [] };
  if (cycle >= MAX_CYCLE) return { verdict: 'BUDGET', reasons };
  return { verdict: 'FIX FIRST', reasons };
}

function fmtFinding(prefix, f, route) {
  const head = [prefix, f.id, f.severity ?? '', f.level ?? '', `${f.file}${f.line ? ':' + f.line : ''}`, f.requirement ?? 'none', f.rule ?? '', f.what_breaks ?? ''].filter((x) => x !== '').join('  ');
  const lines = wrap(head);
  const detail = [];
  if (f.evidence) detail.push(`evidence: ${f.evidence}`);
  if (f.merged?.length) detail.push(`merged: ${f.merged.join(', ')}`);
  if (route) detail.push(`route: ${route}`);
  for (const d of detail) lines.push(...wrap('      ' + d));
  return lines;
}

export function renderReview({ cycle, state, placed, verdict, decided, routes, status, perClass, renumbered, notes, date, rejected }) {
  const scopeText = state.scope === 'all' ? 'all' : `${state.scope}, ${state.commits} commit${state.commits === 1 ? '' : 's'}`;
  const classes = state.classes.join(', ');
  const lines = [
    `# Review, cycle ${cycle}`,
    `Reviewed: ${state.head.slice(0, 7)} (${scopeText})   Date: ${date}`,
    `Finders: ${classes} (${finderModels()})   Verifier: ${normalizeModel(status.model)} (reported)   Author: ${normalizeModel(state.author)}`,
    `Gate: ${status.gateComputed ?? 'not run'}   Mutations: ${status.mutationsComputed ?? status.mutations ?? 'not run'}`,
    ...(status.survivorLines ?? survivorLines(verdict, status)),
    '',
    `## Confirmed (${placed.confirmed.length})`,
  ];
  for (const f of placed.confirmed) lines.push(...fmtFinding(f.fid, f, routes.get(f.id)));
  lines.push('', `## Watch list (${placed.watchList.length})`);
  for (const w of placed.watchList) {
    lines.push(...fmtFinding('      ', w, null));
    lines.push(...wrap(`      why unproven: ${w.why_unproven ?? 'not said'}        how to settle: ${w.how_to_settle ?? 'not said'}`));
  }
  lines.push('', `## Refuted (${placed.refuted.length})`);
  for (const r of placed.refuted) lines.push(...wrap(`      ${r.id}  ${r.evidence}`));
  lines.push('', `## Trade-offs (${placed.tradeoffs.length})`);
  for (const t of placed.tradeoffs) {
    lines.push(...wrap(`      ${(t.findings ?? []).join(', ')}  options: ${(t.options ?? []).join(' | ')}  cost: ${t.cost ?? ''}  recommendation: ${t.recommendation ?? ''}`));
    lines.push('      route: ADR by the human');
  }
  if (rejected?.ids?.length) {
    lines.push('', `## Rejected by the human (cycle ${rejected.cycle})`);
    lines.push(...wrap(`      ${rejected.ids.join(', ')}${rejected.note ? `  note: ${rejected.note}` : ''}`));
  }
  lines.push('', '## Checklists');
  for (const cls of state.classes) lines.push(...wrap(`${cls}: ${perClass[cls]?.checklist ?? 'not reported'}${perClass[cls]?.partial ? `   Partial: ${perClass[cls].partial}` : ''}${perClass[cls]?.blocked ? `   Blocked: ${perClass[cls].blocked}` : ''}`));
  if (renumbered.length || notes.length) {
    lines.push('', '## Clerk notes');
    for (const r of renumbered) lines.push(`renumbered: ${r}`);
    for (const n of notes) lines.push(...wrap(n));
  }
  lines.push('', `## Verdict: ${decided.verdict}${decided.verdict === 'BUDGET' ? ': human decision' : ''}`);
  if (decided.reasons.length) lines.push(...wrap(`Why: ${decided.reasons.join('; ')}.`));
  const routeGroups = new Map();
  for (const f of placed.confirmed) {
    const r = routes.get(f.id);
    routeGroups.set(r, [...(routeGroups.get(r) ?? []), f.fid]);
  }
  if (placed.tradeoffs.length) routeGroups.set('ADR by the human', placed.tradeoffs.map((t) => (t.findings ?? []).join('+')));
  if (routeGroups.size) lines.push(...wrap(`Routes: ${[...routeGroups].map(([r, ids]) => `${r} (${ids.join(', ')})`).join('; ')}.`));
  if (decided.verdict === 'FIX FIRST') {
    const bySlice = new Map();
    for (const [route, ids] of routeGroups) {
      const m = route.match(/^reopen (S\d+(?:, S\d+)*)$/);
      if (m) for (const slice of m[1].split(', ')) bySlice.set(slice, [...(bySlice.get(slice) ?? []), ...ids]);
    }
    const slices = [...bySlice.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    lines.push(`Next: say accept or reject for each F-id, then: node review.mjs decide --cycle ${cycle} --accept <F-ids> --reject <F-ids> --note "<your words>"`);
    if (!slices.length) lines.push(`      answer the routes above, then /sdlc-kit:review-change --cycle ${cycle + 1}.`);
    else {
      slices.forEach((slice) => lines.push(`      /sdlc-kit:implement-slice ${slice} ${bySlice.get(slice).join(' ')}`));
      lines.push(`      then /sdlc-kit:review-change --cycle ${cycle + 1}.`);
    }
  }
  if (decided.verdict === 'BUDGET') {
    lines.push('Next: both fix rounds are used; there is no cycle 3. You decide:');
    lines.push('      ship as it is: /sdlc-kit:ship (the gate prints the review line as a warning, visibly), or');
    lines.push('      reopen as a new requirement: add it to docs/REQUIREMENTS.md as R-nn, re-plan with /sdlc-kit:plan-slices, build it as a slice, then a fresh review from cycle 1.');
  }
  if (decided.verdict === 'MERGE') lines.push('Next: /sdlc-kit:ship.');
  lines.push('Not checked: UI in a real browser (manual checks in docs/MANUAL-CHECKS.md).');
  return lines.flatMap((l) => wrap(l)).join('\n') + '\n';
}

/**
 * The classes a cycle runs: cycle 1 the base four (correctness, security, contract, legal), plus `domain` when the
 * project has a domain skill; later cycles the classes confirmed or watch-listed before (VER findings count as
 * contract; domain only while the skill exists).
 */
export function classesFor(cycle, previous, options = {}) {
  const available = CLASSES.filter((c) => c !== 'domain' || options.domain);
  if (cycle === 1 || !previous) return available;
  const set = new Set();
  for (const f of [...(previous.confirmed ?? []), ...(previous.watchList ?? [])]) {
    const cls = f.finder ?? f.class ?? (f.id?.startsWith('VER-') ? 'contract' : null);
    if (CLASSES.includes(cls)) set.add(cls);
    for (const id of f.merged ?? []) {
      const p = Object.entries(PREFIX).find(([, pre]) => id.startsWith(pre + '-'));
      if (p) set.add(p[0]);
    }
  }
  return available.filter((c) => set.has(c));
}

function scopeFiles(root, scope) {
  if (scope === 'all') {
    const out = [];
    const walk = (dir) => {
      if (!existsSync(join(root, dir))) return;
      for (const name of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${name.name}`;
        if (name.isDirectory()) walk(rel);
        else out.push(rel);
      }
    };
    walk('src');
    walk('tests');
    for (const f of ['index.html', 'styles.css']) if (existsSync(join(root, f))) out.push(f);
    return out.sort();
  }
  if (!SCOPE_RANGE.test(scope)) return [];
  return (git(root, ['diff', '--name-only', '--end-of-options', scope]) ?? '').split('\n').filter(Boolean);
}

/** A revision range the review may take: names, shas, `~`, `^`, `..` or `...`; never a word that starts with `-`. */
export const SCOPE_RANGE = /^(?!-)[\w./~^-]+(?:\.\.\.?(?!-)[\w./~^-]+)?$/;

/** The domain skill line of a brief: the paths and the rule ids, or null when the project has none. */
function domainLine(state) {
  const skills = state.domainSkills ?? [];
  if (!skills.length) return null;
  return `Domain skill${skills.length === 1 ? '' : 's'}: ${skills.map((s) => `${s.path} (${s.rules.join(', ') || 'no D-nn rules'})`).join('; ')}. finder-domain reads it first and cites its rules as "rule": "D-nn".`;
}

/** The legal skills line of a brief: the files an agent reads (the kit's by full path) with their rule ids. */
function legalLine(state, reader) {
  const skills = state.legalSkills ?? [];
  if (!skills.length) return null;
  return `Legal skills: ${skills.map((s) => `${s.file} (${s.rules.join(', ') || 'no rules'})`).join('; ')}. ${reader}`;
}

function briefText(state, cycle) {
  const lines = [
    `Review cycle ${cycle}. Reviewed commit ${state.head.slice(0, 7)}; scope ${state.scope}${state.scope === 'all' ? '' : ` (${state.commits} commits)`}.`,
    `Files in scope: ${state.files.join(', ') || 'none'}.`,
    `Read docs/REQUIREMENTS.md, docs/PLAN.md, AGENTS.md and docs/decisions/*.md first, the code and tests next, the commit messages last.`,
    `Return the JSON array and the Checklist: line, nothing else.`,
  ];
  const discipline = disciplineLines(state);
  if (discipline) lines.splice(2, 0, discipline);
  if (state.classes.includes('legal')) {
    const legal = legalLine(state, 'finder-legal reads them first and cites their rules as "rule": "LD-nn" (or LL-nn, LE-nn, a project prefix); it is not legal advice.');
    if (legal) lines.splice(2, 0, legal);
  }
  const domain = domainLine(state);
  if (domain) lines.splice(2, 0, domain);
  if (state.previous) {
    const max = state.previous.maxIds ?? {};
    const prefixes = Object.entries(PREFIX).filter(([cls]) => cls !== 'domain' || state.classes.includes('domain')).map(([, pre]) => pre);
    lines.push(`Number your findings after cycle ${state.previous.cycle}: start at ${prefixes.map((pre) => `${pre}-${(max[pre] ?? 0) + 1}`).join(', ')} (ids from cycle ${state.previous.cycle} are taken). Use only your own class prefix, never an F-id.`);
  }
  return lines.join('\n') + '\n';
}

/** The discipline skills each finder reads, from the profile recorded at start: the way of working the architect's decisions switched on. */
function disciplineLines(state) {
  const d = state.discipline;
  if (!d || !Object.keys(d.roles ?? {}).length) return null;
  const out = [`Discipline skills (ADR tags: ${d.tags.join(', ') || 'none'}): read yours before the diff and cite a rule as "rule": "CP-03" when a finding rests on it; the script refuses an id no active skill defines.`];
  for (const [role, list] of Object.entries(d.roles)) if (list.length) out.push(`  ${role}: ${list.join('; ')}`);
  return out.join('\n');
}

function verifierBriefText(state, cycle) {
  const max = state.previous?.maxIds ?? {};
  const lines = [
    `Review cycle ${cycle}. Reviewed commit ${state.head.slice(0, 7)}; scope ${state.scope}${state.scope === 'all' ? '' : ` (${state.commits} commits)`}.`,
    `Files in scope: ${state.files.join(', ') || 'none'}.`,
    `Finder findings: ${REVIEW_DIR}/${cycle}/findings.json (also the finder-*.json files there). Author model: ${state.author}. Your agent file says model ${loadRoles().get('verifier')?.model ?? 'unset'}; report the model you actually run on.`,
    `Your own findings start at VER-${(max.VER ?? 0) + 1}.`,
    `Kit tools: node "${KIT_ROOT}/tools/gate.mjs" runs the gate, node "${KIT_ROOT}/tools/mutate.mjs" plants the defects.`,
    `Return the JSON object and the Model:, Gate:, Mutations: lines, nothing else.`,
  ];
  const legal = legalLine(state, 'A LEG finding cites one of their rules in "rule"; check the rule text yourself.');
  if (legal) lines.splice(2, 0, legal);
  const discipline = disciplineLines(state);
  if (discipline) lines.splice(2, 0, discipline.replace('read yours before the diff and cite a rule', 'a finding that cites one of their rules is checked against the rule text; cite a rule'));
  const domain = domainLine(state);
  if (domain) lines.splice(2, 0, domain.replace(' finder-domain reads it first and cites its rules as "rule": "D-nn".', ' A DOM finding cites one of its rules in "rule"; check the rule text yourself.'));
  if (state.previous?.rejected?.ids?.length) {
    lines.push(`Rejected by the human in cycle ${state.previous.cycle}, closed, do not raise again: ${state.previous.rejected.ids.join(', ')}${state.previous.rejected.note ? ` (${state.previous.rejected.note})` : ''}.`);
  }
  if (state.previous?.confirmed?.length) {
    lines.push(`Confirmed in cycle ${state.previous.cycle} and accepted by the human, carried under their F-ids. Place each F-id exactly once, under that id: fixed goes to refuted with the fix as evidence, still present goes to confirmed. A finder re-found one of them under a new id: confirm it under the F-id and put the new id in merged. The finders were not told about them.`);
    lines.push(state.previous.confirmed.map((f) => `${f.fid} (was ${f.id}, ${f.severity}, level ${f.level}) ${f.file}${f.line ? ':' + f.line : ''}: ${f.what_breaks}`).join('\n'));
  }
  return lines.join('\n') + '\n';
}

/**
 * The highest id number per prefix after a cycle: the recorded maxIds, completed from the cycle's confirmed, watch list
 * and refuted lists and its finder files when a prefix is missing (an older or hand-edited state.json).
 */
export function deriveMaxIds(root, previous) {
  const max = { ...(previous?.maxIds ?? {}) };
  const bump = (id) => {
    const m = String(id ?? '').match(/^(COR|SEC|CON|DOM|LEG|VER)-(\d+)/);
    if (m && max[m[1]] === undefined) max[`_${m[1]}`] = Math.max(max[`_${m[1]}`] ?? 0, Number(m[2]));
  };
  const items = [...(previous?.confirmed ?? []), ...(previous?.watchList ?? []), ...(previous?.refuted ?? [])];
  for (const f of items) {
    bump(f.id);
    for (const id of f.merged ?? []) bump(id);
  }
  const dir = join(root, REVIEW_DIR, String(previous?.cycle ?? ''));
  if (previous?.cycle && existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => /^finder-.*\.json$|^findings\.json$/.test(f))) {
      const { json } = extractJson(readFileSync(join(dir, file), 'utf8'));
      for (const f of Array.isArray(json) ? json : []) bump(f?.id);
    }
  }
  for (const key of Object.keys(max).filter((k) => k.startsWith('_'))) {
    max[key.slice(1)] = max[key];
    delete max[key];
  }
  return max;
}

export function readDecisions(root, cycle) {
  return readJson(join(root, REVIEW_DIR, String(cycle), 'decisions.json'), null);
}

/**
 * The human's decision on every confirmed finding of a rendered cycle: each F-id in exactly one of accept, reject.
 * Writes docs/review/<cycle>/decisions.json. The next cycle carries the accepted ones only.
 */
/**
 * Asks the person at the keyboard to type the cycle number back, on the controlling terminal itself (/dev/tty), not on
 * stdin: a process with no terminal cannot open it, and a piped answer never reaches it. Returns true when the typed
 * line equals `cycle`.
 */
export function confirmOnTerminal(cycle) {
  let fd;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return false;
  }
  try {
    writeFileSync(fd, `Type the cycle number (${cycle}) to record your decision: `);
    const buf = Buffer.alloc(64);
    const n = readSync(fd, buf, 0, 64, null);
    return buf.toString('utf8', 0, n).trim() === String(cycle);
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * The human's decision: `decide` asks on the controlling terminal itself and nothing a caller passes stands in for the
 * typed answer (no flag, no environment variable, no option, no test seam). The writer behind it lives in
 * tools/internal/record-decision.mjs, which the CLI never reaches without the terminal and the kit's tests call directly.
 */
export function decide(root, cycle, options = {}) {
  if (!confirmOnTerminal(cycle)) return { ok: false, lines: ['Decision refused: review.mjs decide records a decision only when the person at the terminal types the cycle number back (no terminal here); the human records the decision themselves.'] };
  return recordDecision(root, cycle, options);
}


export function start(root, options = {}) {
  const dirty = git(root, ['status', '--porcelain']);
  if (dirty === null) return { ok: false, lines: ['Review refused: not a git repository.'] };
  if (dirty) return { ok: false, lines: ['Review refused: the working tree has uncommitted changes; commit or revert them first.'] };
  const slice = activeSlice(root);
  if (slice) return { ok: false, lines: [`Review refused: ${slice} is still active (.sdlc/slice); finish the slice or remove the marker first.`] };

  const previous = readState(root);
  let cycle = options.cycle ?? (previous ? (previous.rendered ? previous.cycle + 1 : previous.cycle) : 1);
  if (cycle > MAX_CYCLE) {
    return { ok: false, lines: [`BUDGET: human decision. Two fix rounds ran (cycles 1 and ${MAX_CYCLE}); a third review is not allowed, the human decides what ships.`] };
  }
  if (cycle < 1 || !Number.isInteger(cycle)) return { ok: false, lines: [`Review refused: cycle must be 1 or ${MAX_CYCLE}.`] };
  if (cycle > 1 && (!previous || !previous.rendered || previous.cycle !== cycle - 1)) {
    return { ok: false, lines: [`Review refused: cycle ${cycle} needs a rendered cycle ${cycle - 1} in ${STATE_FILE}; run cycle ${cycle - 1} first.`] };
  }

  const head = git(root, ['rev-parse', 'HEAD']);
  let scope = options.scope;
  if (scope && scope !== 'all' && !SCOPE_RANGE.test(scope)) return { ok: false, lines: [`Review refused: --scope must be a revision range such as main..HEAD (got "${scope}").`] };
  if (!scope) {
    const branch = git(root, ['branch', '--show-current']);
    const hasMain = git(root, ['rev-parse', '--verify', '--quiet', 'main']) !== null;
    const ahead = hasMain && branch !== 'main' ? Number(git(root, ['rev-list', '--count', 'main..HEAD']) ?? 0) : 0;
    scope = ahead > 0 ? 'main..HEAD' : 'all';
  }
  const commits = scope === 'all' ? Number(git(root, ['rev-list', '--count', 'HEAD']) ?? 0) : Number(git(root, ['rev-list', '--count', '--end-of-options', scope]) ?? 0);
  const files = scopeFiles(root, scope);
  let carried = null;
  let rejected = null;
  if (cycle > 1) {
    const decisions = readDecisions(root, previous.cycle);
    const confirmed = previous.confirmed ?? [];
    if (confirmed.length && !decisions) {
      return { ok: false, lines: [`Review refused: cycle ${previous.cycle} confirmed ${confirmed.map((f) => f.fid).join(', ')} and the human has not decided; run node review.mjs decide --cycle ${previous.cycle} --accept <F-ids> --reject <F-ids> first.`] };
    }
    const accepted = new Set(decisions?.accepted ?? []);
    carried = { cycle: previous.cycle, confirmed: confirmed.filter((f) => accepted.has(f.fid)), watchList: previous.watchList ?? [], maxIds: deriveMaxIds(root, previous) };
    rejected = decisions?.rejected?.length ? { cycle: previous.cycle, ids: decisions.rejected, note: decisions.note ?? '' } : null;
  }
  const skills = domainSkills(root);
  const legal = legalSkills(root);
  const classes = classesFor(cycle, carried, { domain: skills.length > 0 });
  const state = {
    cycle,
    head,
    scope,
    commits,
    files,
    classes,
    domainSkills: skills,
    legalSkills: legal,
    discipline: { tags: [...adrTags(root)].sort(), roles: Object.fromEntries(['finder-correctness', 'finder-security', 'finder-contract', 'finder-domain', 'finder-legal', 'verifier'].map((r) => [r, readingList(root, r)])) },
    author: options.author ?? previous?.author ?? DEFAULT_AUTHOR,
    startedAt: new Date().toISOString(),
    rendered: false,
    nextF: previous?.nextF ?? 1,
    previous: carried ? { cycle: carried.cycle, confirmed: carried.confirmed, maxIds: carried.maxIds, rejected } : null,
  };
  writeState(root, state);
  writeFile(join(root, REVIEW_DIR, String(cycle), 'brief.txt'), briefText(state, cycle));
  writeFile(join(root, REVIEW_DIR, String(cycle), 'verifier-brief.txt'), verifierBriefText(state, cycle));
  const lines = [
    `review   cycle ${cycle}   HEAD ${head.slice(0, 7)}   scope ${scope} (${commits} commit${commits === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'})`,
    `classes  ${classes.join(', ')}`,
    `domain   ${skills.length ? skills.map((s) => s.path).join(', ') : 'none (no skill under .claude/skills/domain-*/; finder-domain not run)'}`,
    `legal    ${legal.map((s) => s.path).join(', ')}`,
    `brief    ${REVIEW_DIR}/${cycle}/brief.txt (finders), ${REVIEW_DIR}/${cycle}/verifier-brief.txt (verifier)`,
  ];
  if (carried) lines.push(`carried  ${carried.confirmed.map((f) => `${f.fid} (${f.id})`).join(', ') || 'none'} (accepted by the human in cycle ${carried.cycle}${rejected ? `; rejected: ${rejected.ids.join(', ')}` : ''})`);
  lines.push(`save     finder answers to ${REVIEW_DIR}/${cycle}/finder-<class>.json, then: node review.mjs check --cycle ${cycle}`);
  return { ok: true, state, lines };
}

export function check(root, cycle) {
  const state = readState(root);
  if (!state || state.cycle !== cycle) return { ok: false, lines: [`Review refused: ${STATE_FILE} is not at cycle ${cycle}; run start first.`] };
  const dir = join(root, REVIEW_DIR, String(cycle));
  const perClass = {};
  const lines = [];
  let ok = true;
  const rules = { domain: domainRules(root), legal: legalRules(root), discipline: new Set(activeRules(root).keys()) };
  for (const cls of state.classes) {
    const result = readFinder(join(dir, `finder-${cls}.json`), cls, rules);
    perClass[cls] = result;
    if (!result.ok) {
      ok = false;
      lines.push(`RE-ASK finder-${cls}: ${result.problem}`);
    } else {
      lines.push(`finder-${cls}  ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}   ${result.checklist ? 'Checklist: ' + result.checklist : 'no Checklist line'}${result.partial ? '   Partial: ' + result.partial : ''}${result.blocked ? '   Blocked: ' + result.blocked : ''}`);
    }
  }
  if (!ok) return { ok, lines };
  const merged = mergeFindings(Object.fromEntries(state.classes.map((c) => [c, perClass[c].findings])));
  writeFile(join(dir, 'findings.json'), JSON.stringify(merged.findings, null, 1) + '\n');
  for (const r of merged.renumbered) lines.push(`renumbered  ${r}`);
  lines.push(`findings  ${merged.findings.length} in ${REVIEW_DIR}/${cycle}/findings.json (finder files untouched); launch the verifier, save its JSON to verifier.json and its Model/Gate/Mutations lines to verifier.txt, then: node review.mjs render --cycle ${cycle}`);
  return { ok: true, lines, merged, perClass };
}

export function render(root, cycle, options = {}) {
  const state = readState(root);
  if (!state || state.cycle !== cycle) return { ok: false, lines: [`Review refused: ${STATE_FILE} is not at cycle ${cycle}; run start first.`] };
  const dir = join(root, REVIEW_DIR, String(cycle));
  const checked = check(root, cycle);
  if (!checked.ok) return checked;
  const findings = checked.merged.findings;
  const byId = new Map(findings.map((f) => [f.id, f]));
  const aliases = new Map();
  for (const f of state.previous?.confirmed ?? []) {
    byId.set(f.fid, { ...f, id: f.fid });
    if (!byId.has(f.id)) aliases.set(f.id, f.fid);
  }
  const required = [...findings.map((f) => f.id), ...(state.previous?.confirmed ?? []).map((f) => f.fid)];

  const verifierPath = join(dir, 'verifier.json');
  const capturedPath = join(dir, 'verifier.captured.txt');
  const captured = existsSync(capturedPath);
  if (!captured && !existsSync(verifierPath)) return { ok: false, lines: [`RE-ASK verifier: ${REVIEW_DIR}/${cycle}/verifier.json is missing`] };
  const raw = readFileSync(captured ? capturedPath : verifierPath, 'utf8');
  const { json: verdict, error, rest } = extractJson(raw);
  if (!verdict) return { ok: false, lines: [`RE-ASK verifier: ${error}`] };
  const problems = verifierProblems(verdict);
  if (problems.length) return { ok: false, lines: problems.map((p) => `RE-ASK verifier: ${p}`) };
  const status = { ...statusLines(rest), ...statusLines(readText(join(dir, 'verifier.txt'))) };
  const gate = options.gate ?? runGate({ root });
  const testsRow = gate.rows.find((r) => r.label === 'tests');
  status.gateComputed = `${gate.lines.at(-1)}, tests ${testsRow?.text ?? 'not run'}`;
  const measured = options.mutation ?? mutate({ root });
  const judged = captured && Array.isArray(verdict.survivors) ? verdict.survivors : [];
  const uncapturedNote = !captured && Array.isArray(verdict.survivors) && verdict.survivors.some((s) => s.equivalent === true) ? 'the verifier\'s equivalence judgments were read from a file the clerk saved, not from the hook\'s capture (verifier.captured.txt); they are not recorded and the survivors count as real' : null;
  const same = (a, b) => a.file === b.file && Number(a.line) === Number(b.line) && String(a.from).trim() === String(b.from).trim() && String(a.to).trim() === String(b.to).trim();
  const survivors = measured.survivors.map((m) => ({ ...m, judged: judged.find((j) => same(j, m)) }));
  status.mutationsComputed = measured.baselineOk ? `${measured.planted} planted, ${measured.caught} caught, ${measured.survived} survived` : measured.lines[0].replace(/^mutations\s+/, '');
  status.survivorLines = survivors.map((m) => `  survived${m.judged?.equivalent ? ' (equivalent)' : ''}: ${m.file}:${m.line} ${JSON.stringify(m.from.trim())} -> ${JSON.stringify(m.to.trim())}${m.judged?.equivalent && m.judged.why ? ` (${m.judged.why})` : ''}`);
  const realSurvived = survivors.filter((m) => !m.judged?.equivalent).length;
  const mutationNote = status.mutations && !status.mutations.startsWith(status.mutationsComputed) ? `verifier reported "Mutations: ${status.mutations}"; measured now: ${status.mutationsComputed}` : null;

  const placed = { ...placeAll(verdict, required, byId, aliases), tradeoffs: verdict.tradeoffs };
  const rejectedIds = new Set(state.previous?.rejected?.ids ?? []);
  const cameBack = placed.confirmed.filter((c) => rejectedIds.has(c.id));
  if (cameBack.length) {
    placed.confirmed = placed.confirmed.filter((c) => !rejectedIds.has(c.id));
    placed.notes.push(`${cameBack.map((c) => c.id).join(', ')} rejected by the human in cycle ${state.previous.cycle}; not counted`);
  }
  for (const c of placed.confirmed) {
    const original = byId.get(c.id);
    if (original) for (const k of ['class', 'line', 'requirement', 'rule']) if (c[k] === undefined && original[k] !== undefined) c[k] = original[k];
  }
  placed.confirmed.sort((a, b) => (a.severity === b.severity ? (a.rank ?? 99) - (b.rank ?? 99) : a.severity === 'blocking' ? -1 : 1));
  let nextF = state.nextF ?? 1;
  for (const c of placed.confirmed) {
    if (CARRIED_ID.test(c.id)) c.fid = c.id;
    else c.fid = `F-${String(nextF++).padStart(2, '0')}`;
  }
  const plan = readPlan(root);
  const nextQ = nextQuestionNumber(root);
  const routes = new Map(placed.confirmed.map((f) => [f.id, routeOf(f, plan, nextQ)]));
  const carriedUnplaced = (state.previous?.confirmed ?? []).filter((f) => f.severity === 'blocking' && placed.notes.some((n) => n.startsWith(`${f.fid} was not placed`))).map((f) => f.fid);
  const decided = verdictOf(placed, { ...verdict, survivors: survivors.map((m) => ({ ...m, equivalent: m.judged?.equivalent === true })) }, cycle, status.mutationsComputed, carriedUnplaced.length ? [`carried finding${carriedUnplaced.length === 1 ? '' : 's'} ${carriedUnplaced.join(', ')} not shown fixed or still present`] : []);
  const notes = [...placed.notes];
  if (mutationNote) notes.push(mutationNote);
  if (uncapturedNote) notes.push(uncapturedNote);
  if (verdict.pass === true && decided.verdict !== 'MERGE') notes.push(`the verifier said pass: true, the script says ${decided.verdict}: ${decided.reasons.join('; ')}`);
  if (status.partial) notes.push(`verifier Partial: ${status.partial}`);
  if (status.blocked) notes.push(`verifier Blocked: ${status.blocked}`);
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const text = renderReview({ cycle, state, placed, verdict, decided, routes, status, perClass: checked.perClass, renumbered: checked.merged.renumbered, notes, date, rejected: state.previous?.rejected ?? null });
  writeFile(join(root, REVIEW_FILE), text);
  const maxIds = { ...(state.previous?.maxIds ?? {}) };
  for (const id of [...findings.map((f) => f.id), ...placed.confirmed.map((c) => c.id), ...placed.watchList.map((w) => w.id), ...placed.refuted.map((r) => r.id)]) {
    const m = id.match(/^(COR|SEC|CON|DOM|LEG|VER)-(\d+)/);
    if (m) maxIds[m[1]] = Math.max(maxIds[m[1]] ?? 0, Number(m[2]));
  }
  const confirmedOut = placed.confirmed.map(({ merged_files, ...f }) => f);
  const equivalent = survivors.filter((m) => m.judged?.equivalent === true).map((m) => ({ file: m.file, line: m.line, from: m.from, to: m.to, why: m.judged.why ?? '' }));
  writeState(root, { ...state, rendered: true, verdict: decided.verdict, confirmed: confirmedOut, watchList: placed.watchList, equivalent, maxIds, nextF, renderedAt: new Date().toISOString() });
  const tail = text.trimEnd().split('\n');
  const verdictIndex = tail.findIndex((l) => l.startsWith('## Verdict:'));
  return { ok: true, verdict: decided.verdict, text, realSurvived, lines: [`${REVIEW_FILE} written (cycle ${cycle}, ${placed.confirmed.length} confirmed, ${placed.watchList.length} on the watch list, ${placed.refuted.length} refuted)`, ...tail.slice(verdictIndex)] };
}

function cli(argv) {
  const [command, ...rest] = argv;
  const value = (flag) => (rest.indexOf(flag) >= 0 ? rest[rest.indexOf(flag) + 1] : undefined);
  const root = resolve(value('--root') ?? process.cwd());
  const cycle = value('--cycle') !== undefined ? Number(value('--cycle')) : undefined;
  let result;
  if (command === 'start') result = start(root, { cycle, scope: value('--scope'), author: value('--author') });
  else if (command === 'check') result = cycle ? check(root, cycle) : { ok: false, lines: ['check needs --cycle n'] };
  else if (command === 'render') result = cycle ? render(root, cycle) : { ok: false, lines: ['render needs --cycle n'] };
  else if (command === 'decide') result = cycle ? decide(root, cycle, { accept: value('--accept'), reject: value('--reject'), note: value('--note'), }) : { ok: false, lines: ['decide needs --cycle n'] };
  else {
    console.error('Usage: node review.mjs start [--cycle n] [--scope <range>|all] | check --cycle n | render --cycle n | decide --cycle n --accept F-01,F-02 --reject F-03..F-18 [--note "..."]');
    return 2;
  }
  console.log(result.lines.join('\n'));
  return result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
