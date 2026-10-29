#!/usr/bin/env node
// Reads docs/PLAN.md and answers one question: which files may change in slice S<n>?
// Plan contract (written by the plan-slices skill):
//   ## S3 Lines, money and totals
//   **Goal:** ... **Covers:** R-11 to R-17.
//   **Files:** `src/domain/money.js`, `src/domain/lines.js`, `tests/money.test.js`
// Usage: node scope.mjs S3 [--root <project dir>]
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { isMain, physicalPath } from './hook-common.mjs';
import { KIT_ROOT, hasOwnPaths, matchesOwnPaths } from './roles.mjs';

export const PLAN_FILE = 'docs/PLAN.md';
export const REQUIREMENTS_FILE = 'docs/REQUIREMENTS.md';
export const MANUAL_CHECKS_FILE = 'docs/MANUAL-CHECKS.md';
export const SLICE_MARKER = '.sdlc/slice';

/** Files every slice may also touch, on top of its **Files:** line. */
export const ALWAYS_ALLOWED_IN_SLICE = [MANUAL_CHECKS_FILE];

/** Files only humans edit, whatever the slice. Any docs/** document joins this list once it carries `Status: approved` (or accepted). */
export const HUMAN_ONLY = ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json'];

/** The tester's tests: a file under tests/ ending in .spec.mjs (or .js, .cjs). The builder adds its own in .test.* files and never changes these. */
export const TESTER_SPEC = /^tests\/.*\.spec\.(?:m|c)?js$/i;
export function isTesterSpec(relPath) {
  return TESTER_SPEC.test(relPath);
}

/** A document the human approved: the contract. `Status: approved` (requirements, plan, UI spec) or `Status: accepted` (an ADR). */
export const APPROVED_STATUS = /^Status:\s*(approved|accepted)\b/im;
export const PROPOSED_STATUS = /^Status:\s*proposed\b/im;
export function isApprovedDoc(root, relPath) {
  if (!/^docs\/.*\.md$/i.test(relPath)) return false;
  const path = join(root, relPath);
  return existsSync(path) && APPROVED_STATUS.test(readFileSync(path, 'utf8'));
}

/** The decision records: the human writes them, or accepts what an architect proposed (`Status: proposed` until then). */
export const DECISIONS_PREFIX = 'docs/decisions/';
export function isDecisionPath(relPath) {
  return relPath.toLowerCase().startsWith(DECISIONS_PREFIX);
}
/** A decision file a role with that path in its own patterns may still write: not there yet, or still proposed. */
export function isOpenDecision(root, relPath) {
  const path = join(root, relPath);
  return !existsSync(path) || PROPOSED_STATUS.test(readFileSync(path, 'utf8'));
}

/** Project skills: the main session may write them when no slice is active; the builder and the judges may not. */
export const PROJECT_SKILLS_PREFIX = '.claude/skills/';
export function isProjectSkillPath(relPath) {
  return relPath.startsWith(PROJECT_SKILLS_PREFIX);
}

/**
 * Project domain skills: `.claude/skills/domain-<area>/SKILL.md`, rules as `### D-01 <rule>` headings. The AI may draft
 * one (a project skill, written by the main session with no slice); once the file exists it is human-only, like an ADR.
 */
export const DOMAIN_SKILL_PREFIX = '.claude/skills/domain-';
export function isDomainSkillPath(relPath) {
  return relPath.toLowerCase().startsWith(DOMAIN_SKILL_PREFIX);
}

/** The rule ids `D-nn` of a domain skill text, in order, zero-padded as written. */
export function domainRuleIds(text) {
  return [...String(text ?? '').matchAll(/^#+\s*(D-\d+)\b/gm)].map((m) => m[1]);
}

/** Every domain skill, `.claude/skills/domain-<area>/SKILL.md`: { path, name, rules }. Empty when none exists. */
export function domainSkills(root) {
  const dir = join(root, '.claude/skills');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).filter((d) => d.startsWith('domain-')).sort()) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    if (!existsSync(join(root, rel))) continue;
    out.push({ path: rel, name, rules: domainRuleIds(readFileSync(join(root, rel), 'utf8')) });
  }
  return out;
}

/**
 * Legal skills: the kit ships three under `skills/legal-<name>/SKILL.md` (LD-nn data protection, LL-nn licences, LE-nn
 * e-invoicing), a project may add its own under `.claude/skills/legal-<area>/SKILL.md` with another `L?-nn` prefix.
 * A project legal skill is drafted once like a domain skill and is human-only from then on.
 */
export const LEGAL_SKILL_PREFIX = '.claude/skills/legal-';
export function isLegalSkillPath(relPath) {
  return relPath.toLowerCase().startsWith(LEGAL_SKILL_PREFIX);
}

/** A legal rule id: a two-letter prefix starting with L (`LD`, `LL`, `LE`, or a project's own), then a number. */
export const LEGAL_RULE_ID = /^L[A-Z]-\d+$/;

/** The rule ids `L?-nn` of a legal skill text, in order, as written. */
export function legalRuleIds(text) {
  return [...String(text ?? '').matchAll(/^#+\s*(L[A-Z]-\d+)\b/gm)].map((m) => m[1]);
}

/** How a kit legal skill is named in a brief header or a review file: the plugin name, then its path in the kit. */
export const KIT_SKILL_LABEL = 'sdlc-kit/';

/**
 * Every legal skill, the kit's first (always present) then the project's:
 * { path (the label shown in files), file (what an agent reads), name, rules, origin: 'kit' | 'project' }.
 */
export function legalSkills(root, kitRoot = KIT_ROOT) {
  const out = [];
  const kitDir = join(kitRoot, 'skills');
  if (existsSync(kitDir)) {
    for (const name of readdirSync(kitDir).filter((d) => d.startsWith('legal-')).sort()) {
      const file = join(kitDir, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      out.push({ path: `${KIT_SKILL_LABEL}skills/${name}/SKILL.md`, file, name, rules: legalRuleIds(readFileSync(file, 'utf8')), origin: 'kit' });
    }
  }
  const dir = join(root, '.claude/skills');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((d) => d.startsWith('legal-')).sort()) {
      const rel = `.claude/skills/${name}/SKILL.md`;
      if (!existsSync(join(root, rel))) continue;
      out.push({ path: rel, file: rel, name, rules: legalRuleIds(readFileSync(join(root, rel), 'utf8')), origin: 'project' });
    }
  }
  return out;
}

/** Root files that are documentation, not code. */
export const ROOT_DOCS = ['README.md', 'LICENSE'];

/** What a no-slice commit may hold: docs, the init files, project skills and the root documentation files. */
export function isDocsLikePath(relPath) {
  return isDocsPath(relPath) || isSetupPath(relPath) || isProjectSkillPath(relPath) || ROOT_DOCS.includes(relPath);
}
export const HUMAN_ONLY_PREFIXES = ['.sdlc/'];

/** Setup files that /sdlc-kit:init writes through Bash; the gate accepts them in a no-slice commit. */
export const SETUP_FILES = ['.gitignore'];
export const SETUP_PREFIXES = ['.githooks/', '.github/'];
/** The only files the agent may write in those folders: what /sdlc-kit:init installs. */
export const SETUP_WRITABLE = ['.githooks/pre-commit', '.githooks/commit-msg', '.github/workflows/gate.yml'];

/** The text of a regular file; a folder, a link or anything else reads as empty, so a marker replaced by a folder is no marker. */
export function readText(path) {
  try {
    if (!lstatSync(path).isFile()) return '';
  } catch {
    return '';
  }
  return readFileSync(path, 'utf8');
}

/** Expands "R-01, R-03", "R-11 to R-17" and "R-11..R-17" into unique zero-padded IDs. */
export function expandIds(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/(?<![A-Za-z])R-(\d+)(?:\s*(?:to|\.\.)\s*R-(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to < from) continue;
    for (let n = from; n <= to; n++) out.add(`R-${String(n).padStart(2, '0')}`);
  }
  return [...out];
}

/** Parses the plan into slices: id, title, files (as written, slash separated) and the requirement IDs it covers. */
export function parsePlan(planText) {
  const slices = new Map();
  const sections = planText.split(/^(?=##\s+S\d+\b)/m);
  for (const section of sections) {
    const heading = section.match(/^##\s+(S\d+)\b\s*(.*)$/m);
    if (!heading) continue;
    const [, id, title] = heading;
    const filesLine = section.match(/^\*\*Files:\*\*\s*(.*)$/m);
    const files = filesLine ? [...filesLine[1].matchAll(/`([^`]+)`/g)].map((m) => normalizePath(m[1])) : [];
    const coversLine = section.match(/\*\*Covers[^*]*\*\*\s*([^\n]*)/);
    const covers = coversLine ? expandIds(coversLine[1]) : [];
    slices.set(id, { id, title: title.trim(), files, covers });
  }
  return slices;
}

export function readPlan(root) {
  const path = join(root, PLAN_FILE);
  if (!existsSync(path)) return null;
  return parsePlan(readFileSync(path, 'utf8'));
}

/** The active slice id from .sdlc/slice, or null when no slice is active. */
export function activeSlice(root) {
  const marker = readText(join(root, SLICE_MARKER)).trim();
  return /^S\d+$/.test(marker) ? marker : null;
}

/** All requirement IDs defined in docs/REQUIREMENTS.md, with their scope. */
export function readRequirements(root) {
  const text = readText(join(root, REQUIREMENTS_FILE));
  return [...text.matchAll(/^#+\s*(R-\d+)\s*\[(MUST|LATER)\]\s*(.*)$/gm)].map(([, id, scope, title]) => ({
    id,
    scope,
    title: title.trim(),
  }));
}

export function requirementsApproved(root) {
  return /^Status:\s*approved\b/im.test(readText(join(root, REQUIREMENTS_FILE)));
}

/** True when the project path, or any folder on its way, is a symbolic link: a write there lands somewhere else than it says. */
export function isSymlink(root, relPath) {
  const parts = String(relPath ?? '').split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    try {
      if (lstatSync(resolve(root, parts.slice(0, i).join('/'))).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** A project path relative to the root, slash separated, no leading "./". */
export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** The project path of a file: relative to the root as spelled, or to the root as the file system holds it when the project is opened through a link. */
export function toProjectPath(root, filePath) {
  const p = String(filePath ?? '');
  if (!p) return '';
  const rel = normalizePath(relative(resolve(root), resolve(root, p)));
  if (!escapesRoot(rel)) return rel;
  const physical = normalizePath(relative(physicalPath(root), physicalPath(resolve(root, p))));
  return escapesRoot(physical) ? rel : physical;
}

/** True when a project path points outside the root ("../x" after normalisation). */
export function escapesRoot(relPath) {
  return relPath === '..' || relPath.startsWith('../') || isAbsolute(relPath);
}

/** The human's record of accepted and rejected findings; written from the human's own terminal, never by an agent. */
export const DECISIONS_FILE = /^docs\/review\/\d+\/decisions\.json$/i;

/**
 * Files the review scripts write from the agents' answers: the rendered review and its state, the briefs, the merged
 * findings. The clerk saves only the answer files (`finder-*.json`, `verifier.json`, `verifier.txt`, `<role>.json`);
 * a verdict typed by hand would be a judge's signature forged.
 */
export const SCRIPT_OWNED = /^docs\/(?:REVIEW|REQUIREMENTS-REVIEW)\.md$|^docs\/review\/(?:state\.json|\d+\/(?:brief\.txt|verifier-brief\.txt|findings\.json|verifier\.captured\.txt))$|^docs\/requirements-review\/(?:state\.json|brief\.txt|items\.json)$/i;
export function isScriptOwnedPath(relPath) {
  return SCRIPT_OWNED.test(String(relPath ?? '').replace(/\\/g, '/'));
}

/**
 * Why a path is the human's, or null. `role` (from roles.mjs) matters in one place: a role whose own patterns name
 * docs/decisions/ may write a decision that does not exist yet or is still `Status: proposed`.
 */
export function isHumanOnly(root, relPath, role = null) {
  const lower = relPath.toLowerCase();
  if (escapesRoot(relPath)) return `${relPath} is outside the project`;
  if (DECISIONS_FILE.test(lower)) return `${relPath} is the human's decision on the review findings`;
  if (HUMAN_ONLY.some((f) => f.toLowerCase() === lower)) return `${relPath} is a human decision file`;
  if (HUMAN_ONLY_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))) return `${relPath} is a human decision file`;
  if (isDecisionPath(relPath)) {
    const mayPropose = role && hasOwnPaths(role) && matchesOwnPaths(role, relPath) && isOpenDecision(root, relPath);
    if (!mayPropose) return `${relPath} is a human decision file`;
  }
  if (isDomainSkillPath(relPath) && existsSync(join(root, relPath))) return `${relPath} is the project's domain knowledge, signed by the human`;
  if (isLegalSkillPath(relPath) && existsSync(join(root, relPath))) return `${relPath} is the project's legal rules, signed by the human`;
  if (lower === REQUIREMENTS_FILE.toLowerCase() && requirementsApproved(root)) {
    return `${REQUIREMENTS_FILE} is approved, changing a requirement is a human decision`;
  }
  if (isApprovedDoc(root, relPath)) return `${relPath} is approved (its Status line); changing it is a human decision`;
  return null;
}

export function isDocsPath(relPath) {
  return relPath.startsWith('docs/');
}

export function isSetupPath(relPath) {
  return SETUP_FILES.includes(relPath) || SETUP_PREFIXES.some((prefix) => relPath.startsWith(prefix) || `${relPath}/` === prefix);
}

/**
 * What may change right now: the active slice's files plus docs/MANUAL-CHECKS.md,
 * or docs/** and the setup files /sdlc-kit:init installs when no slice is active. Reports a plan or slice that is missing.
 */
export function allowedScope(root, role = 'main') {
  const slice = activeSlice(root);
  if (Array.isArray(role)) return { slice, files: null, docsOnly: false, patterns: role, role: 'own' };
  if (!slice) return { slice: null, files: null, docsOnly: true, role };
  const plan = readPlan(root);
  if (!plan) return { slice, files: null, docsOnly: false, error: `${PLAN_FILE} does not exist` };
  const entry = plan.get(slice);
  if (!entry) return { slice, files: null, docsOnly: false, error: `${PLAN_FILE} has no slice ${slice}` };
  return { slice, files: [...entry.files, ...ALWAYS_ALLOWED_IN_SLICE], covers: entry.covers, docsOnly: false, role, docsToo: role === 'main' };
}

/** The main session keeps its notes while a slice runs: docs/** except the plan (frozen for the slice) and the review's decision files. */
export function isInScope(relPath, scope) {
  if (scope.error) return false;
  if (scope.patterns) return matchesOwnPaths({ writes: scope.patterns }, relPath);
  if (scope.docsOnly) return isDocsPath(relPath) || SETUP_FILES.includes(relPath) || SETUP_WRITABLE.includes(relPath) || (isProjectSkillPath(relPath) && scope.role === 'main');
  if (scope.files.includes(relPath)) return true;
  return Boolean(scope.docsToo) && isDocsPath(relPath) && relPath !== PLAN_FILE;
}

export function sliceFiles(root, sliceId) {
  const plan = readPlan(root);
  const entry = plan?.get(sliceId);
  return entry ? entry.files : null;
}

function cli(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  const sliceId = argv.find((a) => /^S\d+$/.test(a));
  if (!sliceId) {
    console.error('Usage: node scope.mjs S<n> [--root <project dir>]');
    return 2;
  }
  const plan = readPlan(root);
  if (!plan) {
    console.error(`${PLAN_FILE} not found under ${root}`);
    return 1;
  }
  const entry = plan.get(sliceId);
  if (!entry) {
    console.error(`${PLAN_FILE} has no slice ${sliceId}. Slices: ${[...plan.keys()].join(', ') || 'none'}`);
    return 1;
  }
  console.log(`${sliceId} ${entry.title}`.trim());
  console.log(`covers: ${entry.covers.join(', ') || 'none'}`);
  for (const f of entry.files) console.log(f);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
