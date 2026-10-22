#!/usr/bin/env node
// Reads docs/PLAN.md and answers one question: which files may change in slice S<n>?
// Plan contract (written by the plan-slices skill):
//   ## S3 Lines, money and totals
//   **Goal:** ... **Covers:** R-11 to R-17.
//   **Files:** `src/domain/money.js`, `src/domain/lines.js`, `tests/money.test.js`
// Usage: node scope.mjs S3 [--root <project dir>]
import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { isMain } from './hook-common.mjs';

export const PLAN_FILE = 'docs/PLAN.md';
export const REQUIREMENTS_FILE = 'docs/REQUIREMENTS.md';
export const MANUAL_CHECKS_FILE = 'docs/MANUAL-CHECKS.md';
export const SLICE_MARKER = '.sdlc/slice';

/** Files every slice may also touch, on top of its **Files:** line. */
export const ALWAYS_ALLOWED_IN_SLICE = [MANUAL_CHECKS_FILE];

/** Files only humans edit, whatever the slice. docs/REQUIREMENTS.md joins this list once approved. */
export const HUMAN_ONLY = ['AGENTS.md', 'CLAUDE.md'];
export const HUMAN_ONLY_PREFIXES = ['docs/decisions/', '.sdlc/'];

/** Setup files that /sdlc-kit:init writes through Bash; the gate accepts them in a no-slice commit. */
export const SETUP_FILES = ['.gitignore'];
export const SETUP_PREFIXES = ['.githooks/', '.github/'];

export function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Expands "R-01, R-03", "R-11 to R-17" and "R-11..R-17" into unique zero-padded IDs. */
export function expandIds(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/R-(\d+)(?:\s*(?:to|\.\.)\s*R-(\d+))?/g)) {
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

/** A project path relative to the root, slash separated, no leading "./". */
export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function toProjectPath(root, filePath) {
  const p = String(filePath ?? '');
  if (!p) return '';
  const rel = relative(resolve(root), resolve(root, p));
  return normalizePath(rel);
}

/** True when a project path points outside the root ("../x" after normalisation). */
export function escapesRoot(relPath) {
  return relPath === '..' || relPath.startsWith('../') || isAbsolute(relPath);
}

export function isHumanOnly(root, relPath) {
  const lower = relPath.toLowerCase();
  if (escapesRoot(relPath)) return `${relPath} is outside the project`;
  if (HUMAN_ONLY.some((f) => f.toLowerCase() === lower)) return `${relPath} is a human decision file`;
  if (HUMAN_ONLY_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))) return `${relPath} is a human decision file`;
  if (lower === REQUIREMENTS_FILE.toLowerCase() && requirementsApproved(root)) {
    return `${REQUIREMENTS_FILE} is approved, changing a requirement is a human decision`;
  }
  return null;
}

export function isDocsPath(relPath) {
  return relPath.startsWith('docs/');
}

export function isSetupPath(relPath) {
  return SETUP_FILES.includes(relPath) || SETUP_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/**
 * What may change right now: the active slice's files plus docs/MANUAL-CHECKS.md,
 * or docs/** and the setup files /sdlc-kit:init installs when no slice is active. Reports a plan or slice that is missing.
 */
export function allowedScope(root) {
  const slice = activeSlice(root);
  if (!slice) return { slice: null, files: null, docsOnly: true };
  const plan = readPlan(root);
  if (!plan) return { slice, files: null, docsOnly: false, error: `${PLAN_FILE} does not exist` };
  const entry = plan.get(slice);
  if (!entry) return { slice, files: null, docsOnly: false, error: `${PLAN_FILE} has no slice ${slice}` };
  return { slice, files: [...entry.files, ...ALWAYS_ALLOWED_IN_SLICE], covers: entry.covers, docsOnly: false };
}

export function isInScope(relPath, scope) {
  if (scope.error) return false;
  if (scope.docsOnly) return isDocsPath(relPath) || isSetupPath(relPath);
  return scope.files.includes(relPath);
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
