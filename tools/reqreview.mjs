#!/usr/bin/env node
// The clerk's script for the requirements review. The product owner, the domain expert and the legal role judge; this
// script decides what is a valid item, writes the review file the human ticks, and keeps the ids stable across runs.
//   node reqreview.mjs start [docs/REQUIREMENTS.md] [--root <dir>]
//       the file must exist and no slice may be active; writes docs/requirements-review/state.json and brief.txt;
//       prints the roles to launch (product-owner always; domain-expert only when a skill exists under
//       .claude/skills/domain-*/; legal always, with the kit's skills/legal-*/ plus any .claude/skills/legal-*/)
//   node reqreview.mjs check
//       validates docs/requirements-review/<role>.json, writes items.json; exit 1 with one RE-ASK line per role
//       whose answer is not usable
//   node reqreview.mjs render
//       writes docs/REQUIREMENTS-REVIEW.md: one checkbox per item, blocking first, the checklists, what to do next
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMain } from './hook-common.mjs';
import { activeSlice, readRequirements, readText, domainSkills, legalSkills, LEGAL_RULE_ID, REQUIREMENTS_FILE } from './scope.mjs';
import { extractJson, statusLines, readJson, wrap } from './review.mjs';
import { loadRoles } from './roles.mjs';

export const REQ_REVIEW_DIR = 'docs/requirements-review';
export const REQ_STATE_FILE = 'docs/requirements-review/state.json';
export const REQ_REVIEW_FILE = 'docs/REQUIREMENTS-REVIEW.md';
export const ROLES = ['product-owner', 'domain-expert', 'legal'];
export const ROLE_PREFIX = { 'product-owner': 'PO', 'domain-expert': 'DOM', legal: 'LEG' };
export const KINDS = ['missing', 'wrong', 'priority', 'unclear', 'risk'];
export const SEVERITIES = ['blocking', 'advisory'];
export const ITEM_FIELDS = { id: 'string', kind: 'string', severity: 'string', requirement: 'string', title: 'string', why: 'string', suggested: 'string', proven: 'boolean' };
export const RULE_ID = /^D-\d+$/;
export const FOLD_IN = `Fold the ticked items of ${REQ_REVIEW_FILE} into ${REQUIREMENTS_FILE}`;

/** The product owner's checklist, in the order the agent runs it; the brief and the agent file carry the same text. */
export const PO_CHECKLIST = [
  'who uses the app and for what',
  'the main flows end to end: can a user get from start to the outcome without a dead end',
  'priorities: a MUST that is not needed for the first use, a LATER that blocks it',
  'acceptance criteria a user can observe, not implementation words',
  'empty, error and edge states of the business, not of the code',
  'what the brief implies and the requirements dropped',
];

/** The domain expert's checklist: each requirement and the data model against every D-nn rule. */
export const DOM_CHECKLIST = [
  'a rule the requirements break',
  'a rule the requirements ignore',
  'a term used wrongly',
  'a rounding or legal element missing',
];

/** The legal role's checklist: each requirement and the data model against every L?-nn rule of the legal skills. */
export const LEG_CHECKLIST = [
  'personal data: which fields, with what purpose, nothing beyond it',
  'the rights the app must make possible: see, correct, export machine-readable, erase with its named exception',
  'retention: every entity with personal data has a rule; a legal retention is named where erasure is refused',
  'disclosure and defaults: personal data in logs, errors, URLs, shared-machine storage; private by default',
  'licences: every dependency, font, icon set or adapted content named with a licence the project can use; a LICENSE file',
  'documents with legal content: invoice details, sequential numbering, immutability after issue, storage, acceptance',
];

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function writeFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function readState(root) {
  return readJson(join(root, REQ_STATE_FILE), null);
}

function writeState(root, state) {
  writeFile(join(root, REQ_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

/**
 * The roles a run launches: the product owner always, the domain expert only when the project has a domain skill, the
 * legal role always (the kit ships its legal skills, so it never lacks rules).
 */
export function rolesFor(skills) {
  return ROLES.filter((role) => role !== 'domain-expert' || skills.length > 0);
}

/** The models the role agent files declare (one word when they agree). */
export function roleModels(roles) {
  const all = loadRoles();
  const models = roles.map((r) => all.get(r)?.model ?? 'unset');
  return [...new Set(models)].join('/') || 'unset';
}

/** `Status: draft` or `Status: approved` from the requirements file, or `none`. */
export function statusOf(text) {
  return String(text).match(/^Status:\s*(\w+)/im)?.[1]?.toLowerCase() ?? 'none';
}

/**
 * One item against the schema: null when fine, else the problem.
 * context: { role, requirements (Set of R-nn), rules (Set of D-nn or null), legalRules (Set of L?-nn), maxIds,
 *            seen (Set of ids in this file) }
 */
export function itemProblem(item, index, context) {
  const { role, requirements, rules, legalRules, maxIds = {}, seen } = context;
  const prefix = ROLE_PREFIX[role];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return `item ${index + 1} is not an object`;
  for (const [field, type] of Object.entries(ITEM_FIELDS)) {
    if (!(field in item)) return `item ${index + 1} (${item.id ?? 'no id'}) is missing "${field}"`;
    if (typeof item[field] !== type) return `item ${index + 1} (${item.id ?? 'no id'}): "${field}" must be a ${type}`;
  }
  const m = item.id.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!m) return `item ${index + 1}: id "${item.id}" must look like ${prefix}-1`;
  if (seen?.has(item.id)) return `item ${index + 1}: id "${item.id}" is used twice`;
  if (Number(m[1]) <= (maxIds[prefix] ?? 0)) return `item ${index + 1} (${item.id}): ${item.id} was used in an earlier run; number from ${prefix}-${maxIds[prefix] + 1}`;
  if (!KINDS.includes(item.kind)) return `item ${index + 1} (${item.id}): kind "${item.kind}" must be one of ${KINDS.join(', ')}`;
  if (!SEVERITIES.includes(item.severity)) return `item ${index + 1} (${item.id}): severity "${item.severity}" must be blocking or advisory`;
  if (item.requirement !== 'none' && !requirements.has(item.requirement)) return `item ${index + 1} (${item.id}): requirement "${item.requirement}" is not in ${REQUIREMENTS_FILE} (use none or one of ${[...requirements].join(', ') || 'none defined'})`;
  if (role === 'domain-expert') {
    if (typeof item.rule !== 'string' || !RULE_ID.test(item.rule)) return `item ${index + 1} (${item.id}): a domain item needs "rule" like D-03`;
    if (rules && !rules.has(item.rule)) return `item ${index + 1} (${item.id}): rule "${item.rule}" is not defined in the domain skill (defined: ${[...rules].join(', ') || 'none'})`;
  }
  if (role === 'legal') {
    if (typeof item.rule !== 'string' || !LEGAL_RULE_ID.test(item.rule)) return `item ${index + 1} (${item.id}): a legal item needs "rule" like LD-03`;
    if (legalRules && !legalRules.has(item.rule)) return `item ${index + 1} (${item.id}): rule "${item.rule}" is not defined in a legal skill (defined: ${[...legalRules].join(', ') || 'none'})`;
  }
  return null;
}

/** Reads and validates one role's answer. Returns { ok, items, checklist, partial, blocked, problem }. */
export function readRole(path, role, context) {
  if (!existsSync(path)) return { ok: false, items: [], problem: `${REQ_REVIEW_DIR}/${role}.json is missing` };
  const text = readFileSync(path, 'utf8');
  const { json, error, rest } = extractJson(text);
  const status = statusLines(rest ?? text);
  if (json === null) return { ok: false, items: [], problem: error, ...status };
  if (!Array.isArray(json)) return { ok: false, items: [], problem: 'the answer is not a JSON array', ...status };
  const seen = new Set();
  for (let i = 0; i < json.length; i++) {
    const problem = itemProblem(json[i], i, { ...context, role, seen });
    if (problem) return { ok: false, items: json, problem, ...status };
    seen.add(json[i].id);
  }
  if (!json.length && !status.checklist && !status.blocked) return { ok: false, items: [], problem: 'an empty array needs the Checklist: line that says every item ran, or a Blocked: line', ...status };
  return { ok: true, items: json, problem: null, ...status };
}

function briefText(state) {
  const ids = state.requirements;
  const lines = [
    `Requirements review, run ${state.run}. File: ${state.file} (Status: ${state.status}, ${ids.length} requirement${ids.length === 1 ? '' : 's'}: ${ids.length ? `${ids[0]}..${ids.at(-1)}` : 'none'}). Reviewed commit ${state.head}.`,
    `Read first: docs/BRIEF.md, AGENTS.md, docs/decisions/*.md; then ${state.file}.`,
  ];
  if (state.domainSkills.length) {
    lines.push(`Domain skill${state.domainSkills.length === 1 ? '' : 's'}: ${state.domainSkills.map((s) => `${s.path} (${s.rules.join(', ') || 'no D-nn rules'})`).join('; ')}. The domain expert reads it before the requirements and cites its rules as "rule": "D-nn".`);
  }
  lines.push(`Legal skills: ${(state.legalSkills ?? []).map((s) => `${s.file} (${s.rules.join(', ') || 'no rules'})`).join('; ')}. The legal role reads them before the requirements and cites their rules as "rule": "LD-nn"; it is not legal advice, the human decides.`);
  lines.push(
    `Return a JSON array of items and the Checklist: line, nothing else:`,
    `[{"id":"PO-1","kind":"missing|wrong|priority|unclear|risk","severity":"blocking|advisory","requirement":"R-07 or none","title":"...","why":"...","suggested":"<the requirement or criterion text to add or change, in the file's own format>","proven":true}]`,
    `product-owner: ids PO-1, PO-2, ...; checklist: ${PO_CHECKLIST.map((c, i) => `${i + 1} ${c}`).join('; ')}.`,
  );
  if (state.roles.includes('domain-expert')) {
    lines.push(`domain-expert: ids DOM-1, DOM-2, ... with "rule":"D-nn"; checklist, each requirement and the data model against every rule: ${DOM_CHECKLIST.map((c, i) => `${i + 1} ${c}`).join('; ')}.`);
  }
  lines.push(`legal: ids LEG-1, LEG-2, ... with "rule":"LD-nn" (or LL-nn, LE-nn, a project prefix); checklist, each requirement and the data model against every rule: ${LEG_CHECKLIST.map((c, i) => `${i + 1} ${c}`).join('; ')}.`);
  lines.push(`blocking means a user cannot complete a main flow, the requirement contradicts the brief, it breaks a domain rule, or the app as specified would break a legal obligation (personal data it cannot erase or export, an invoice it can edit after issue, a dependency whose licence forbids the use). proven: true only when "why" quotes the requirement or brief line and the rule or flow it fails.`);
  const max = state.maxIds ?? {};
  const taken = state.roles.map((r) => ROLE_PREFIX[r]).filter((pre) => max[pre]);
  if (taken.length) lines.push(`Number your items after run ${state.run - 1}: start at ${taken.map((pre) => `${pre}-${max[pre] + 1}`).join(', ')} (ids from earlier runs are taken).`);
  return lines.join('\n') + '\n';
}

export function start(root, options = {}) {
  const file = options.file ?? REQUIREMENTS_FILE;
  if (!existsSync(join(root, file))) return { ok: false, lines: [`Requirements review refused: ${file} does not exist; run /sdlc-kit:write-requirements first.`] };
  const slice = activeSlice(root);
  if (slice) return { ok: false, lines: [`Requirements review refused: ${slice} is still active (.sdlc/slice); finish the slice or remove the marker first.`] };
  const text = readText(join(root, file));
  const requirements = file === REQUIREMENTS_FILE ? readRequirements(root).map((r) => r.id) : [...text.matchAll(/^#+\s*(R-\d+)\s*\[(?:MUST|LATER)\]/gm)].map((m) => m[1]);
  const previous = readState(root);
  const run = previous ? (previous.rendered ? previous.run + 1 : previous.run) : 1;
  const maxIds = { ...(previous?.maxIds ?? {}) };
  const head = git(root, ['rev-parse', '--short', 'HEAD']) ?? 'no git';
  const dirty = head !== 'no git' && Boolean(git(root, ['status', '--porcelain', '--', file]));
  const skills = domainSkills(root);
  const legal = legalSkills(root);
  const roles = rolesFor(skills);
  const state = {
    run,
    file,
    status: statusOf(text),
    uncommitted: dirty,
    head,
    requirements,
    roles,
    domainSkills: skills,
    legalSkills: legal,
    maxIds,
    startedAt: new Date().toISOString(),
    rendered: false,
  };
  writeState(root, state);
  writeFile(join(root, REQ_REVIEW_DIR, 'brief.txt'), briefText(state));
  const lines = [
    `review   run ${run}   ${file} (Status: ${state.status}${dirty ? ', uncommitted' : ''}, ${requirements.length} requirement${requirements.length === 1 ? '' : 's'})   HEAD ${head}`,
    `roles    ${roles.join(', ')}`,
    `domain   ${skills.length ? skills.map((s) => s.path).join(', ') : 'none (no skill under .claude/skills/domain-*/; domain-expert not run)'}`,
    `legal    ${legal.map((s) => s.path).join(', ')}`,
    `brief    ${REQ_REVIEW_DIR}/brief.txt`,
    `save     each answer to ${REQ_REVIEW_DIR}/<role>.json, then: node reqreview.mjs check`,
  ];
  return { ok: true, state, lines };
}

export function check(root) {
  const state = readState(root);
  if (!state) return { ok: false, lines: [`Requirements review refused: ${REQ_STATE_FILE} is missing; run start first.`] };
  const context = {
    requirements: new Set(state.requirements),
    rules: state.domainSkills.length ? new Set(state.domainSkills.flatMap((s) => s.rules)) : null,
    legalRules: new Set((state.legalSkills ?? []).flatMap((s) => s.rules)),
    maxIds: state.maxIds ?? {},
  };
  const perRole = {};
  const lines = [];
  let ok = true;
  for (const role of state.roles) {
    const result = readRole(join(root, REQ_REVIEW_DIR, `${role}.json`), role, context);
    perRole[role] = result;
    if (!result.ok) {
      ok = false;
      lines.push(`RE-ASK ${role}: ${result.problem}`);
    } else {
      lines.push(`${role}  ${result.items.length} item${result.items.length === 1 ? '' : 's'}   ${result.checklist ? 'Checklist: ' + result.checklist : 'no Checklist line'}${result.partial ? '   Partial: ' + result.partial : ''}${result.blocked ? '   Blocked: ' + result.blocked : ''}`);
    }
  }
  if (!ok) return { ok, lines };
  const items = state.roles.flatMap((role) => perRole[role].items.map((item) => ({ ...item, role })));
  writeFile(join(root, REQ_REVIEW_DIR, 'items.json'), JSON.stringify(items, null, 1) + '\n');
  lines.push(`items    ${items.length} in ${REQ_REVIEW_DIR}/items.json (role files untouched); then: node reqreview.mjs render`);
  return { ok: true, lines, items, perRole };
}

/** Blocking first; within a severity the product owner's items, then the domain expert's, then the legal ones, each by number. */
export function sortItems(items) {
  const num = (id) => Number(String(id).split('-')[1]);
  return [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1;
    if (a.role !== b.role) return ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
    return num(a.id) - num(b.id);
  });
}

export function renderReview({ state, items, perRole, date }) {
  const blocking = items.filter((i) => i.severity === 'blocking').length;
  const lines = [
    `# Requirements review, run ${state.run}`,
    `Reviewed: ${state.head} (${state.file}, Status: ${state.status}${state.uncommitted ? ', uncommitted' : ''})   Date: ${date}`,
    `Roles: ${state.roles.join(', ')} (${roleModels(state.roles)})   Domain skills: ${state.domainSkills.length ? state.domainSkills.map((s) => s.path).join(', ') : 'none'}   Legal skills: ${(state.legalSkills ?? []).map((s) => s.path).join(', ') || 'none'}`,
    '',
    `## Items (${items.length}: ${blocking} blocking, ${items.length - blocking} advisory)`,
  ];
  for (const item of items) {
    const head = `- [ ] ${[item.id, item.severity, item.kind, item.requirement, item.rule ?? '', item.title].filter((x) => x !== '').join('  ')}`;
    lines.push(...wrap(head));
    for (const [i, l] of String(item.why).split('\n').entries()) lines.push(...wrap(`      ${i === 0 ? 'why: ' : ''}${l}`));
    for (const [i, l] of String(item.suggested).split('\n').entries()) lines.push(...wrap(`      ${i === 0 ? 'suggested: ' : ''}${l}`));
  }
  lines.push('', '## Checklists');
  for (const role of state.roles) {
    const r = perRole[role];
    lines.push(...wrap(`${role}: ${r?.checklist ?? (r?.blocked ? '' : 'not reported')}${r?.partial ? `   Partial: ${r.partial}` : ''}${r?.blocked ? `${r?.checklist ? '   ' : ''}Blocked: ${r.blocked}` : ''}`));
  }
  lines.push('', '## Next');
  if (!items.length) lines.push(`No item. ${state.status === 'approved' ? `${state.file} stays as it is; next: /sdlc-kit:plan-slices.` : `Set Status: approved on the third line of ${state.file}, commit it, then /sdlc-kit:plan-slices.`}`);
  else {
    lines.push(...wrap(`Tick the items you accept (- [x]), then tell the session: "${FOLD_IN}". An untouched item is rejected.`));
    if (state.status === 'approved') lines.push(...wrap(`${state.file} is approved, so the fold-in is your own edit: the file is human-only for agents, the session may only show you the text to paste. Then /sdlc-kit:plan-slices.`));
    else lines.push(...wrap(`The session folds them in (an item becomes a requirement, a criterion or a changed line, in the file's own format). Then set Status: approved on the third line of ${state.file}, commit it, and run /sdlc-kit:plan-slices.`));
  }
  return lines.join('\n') + '\n';
}

export function render(root, options = {}) {
  const state = readState(root);
  if (!state) return { ok: false, lines: [`Requirements review refused: ${REQ_STATE_FILE} is missing; run start first.`] };
  const checked = check(root);
  if (!checked.ok) return checked;
  const items = sortItems(checked.items);
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const text = renderReview({ state, items, perRole: checked.perRole, date });
  writeFile(join(root, REQ_REVIEW_FILE), text);
  const maxIds = { ...(state.maxIds ?? {}) };
  for (const item of items) {
    const [pre, n] = item.id.split('-');
    maxIds[pre] = Math.max(maxIds[pre] ?? 0, Number(n));
  }
  writeState(root, { ...state, rendered: true, maxIds, items: items.map((i) => i.id), renderedAt: new Date().toISOString() });
  const blocking = items.filter((i) => i.severity === 'blocking').length;
  return {
    ok: true,
    text,
    items,
    lines: [
      `${REQ_REVIEW_FILE} written (run ${state.run}, ${items.length} item${items.length === 1 ? '' : 's'}: ${blocking} blocking, ${items.length - blocking} advisory)`,
      `commit   git add ${REQ_REVIEW_DIR} ${REQ_REVIEW_FILE} && git commit -m "Requirements review"`,
    ],
  };
}

function cli(argv) {
  const [command, ...rest] = argv;
  const value = (flag) => (rest.indexOf(flag) >= 0 ? rest[rest.indexOf(flag) + 1] : undefined);
  const root = resolve(value('--root') ?? process.cwd());
  let result;
  if (command === 'start') {
    const file = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--root');
    result = start(root, { file });
  } else if (command === 'check') result = check(root);
  else if (command === 'render') result = render(root);
  else {
    console.error(`Usage: node reqreview.mjs start [${REQUIREMENTS_FILE}] | check | render   [--root <dir>]`);
    return 2;
  }
  console.log(result.lines.join('\n'));
  return result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
