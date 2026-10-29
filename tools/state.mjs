#!/usr/bin/env node
// Where the project stands, read from its files: the active slice, the plan, the requirements, the review, the manual
// checks, git. One source for the SessionStart hook, the PreCompact snapshot and `node state.mjs` in a terminal.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMain } from './hook-common.mjs';
import { activeSlice, readPlan, readRequirements, readText, APPROVED_STATUS, PLAN_FILE, REQUIREMENTS_FILE, MANUAL_CHECKS_FILE } from './scope.mjs';

export const STATE_FILE = '.sdlc/state.json';
export const REVIEW_FILE = 'docs/REVIEW.md';
export const ARCHITECTURE_FILE = 'docs/ARCHITECTURE.md';
export const UI_SPEC_FILE = 'docs/UI-SPEC.md';
export const VERIFICATION_FILE = 'docs/VERIFICATION.md';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** A document's Status line as written (approved, accepted, proposed, draft), or null when the file has none or is missing. */
export function docStatus(root, rel) {
  const text = readText(join(root, rel));
  if (!text) return null;
  const m = text.match(/^Status:\s*([a-z]+)/im);
  return m ? m[1].toLowerCase() : null;
}

/** A status for a line of the state: the word, or what its absence means. */
const shown = (status) => status ?? '(no Status line)';

export function projectState(root) {
  const slice = activeSlice(root);
  const plan = readPlan(root);
  const reqs = readRequirements(root);
  const manual = readText(join(root, MANUAL_CHECKS_FILE));
  const review = readText(join(root, REVIEW_FILE));
  return {
    root: resolve(root),
    slice: slice ? { id: slice, files: plan?.get(slice)?.files ?? null, covers: plan?.get(slice)?.covers ?? null } : null,
    plan: plan ? { slices: plan.size, status: docStatus(root, PLAN_FILE), approved: APPROVED_STATUS.test(readText(join(root, PLAN_FILE))) } : null,
    requirements: existsSync(join(root, REQUIREMENTS_FILE))
      ? { total: reqs.length, must: reqs.filter((r) => r.scope === 'MUST').length, status: docStatus(root, REQUIREMENTS_FILE), approved: APPROVED_STATUS.test(readText(join(root, REQUIREMENTS_FILE))) }
      : null,
    architecture: existsSync(join(root, ARCHITECTURE_FILE)) ? { status: docStatus(root, ARCHITECTURE_FILE) } : null,
    uiSpec: existsSync(join(root, UI_SPEC_FILE)) ? { status: docStatus(root, UI_SPEC_FILE) } : null,
    review: review ? { sha: review.match(/^Reviewed:\s*([0-9a-f]{7,40})\b/m)?.[1] ?? null, verdict: review.match(/^## Verdict:\s*([A-Z ]+?)(?::.*)?$/m)?.[1]?.trim() ?? null, cycle: review.match(/^# Review, cycle (\d+)/m)?.[1] ?? null } : null,
    verification: existsSync(join(root, VERIFICATION_FILE)) ? { status: docStatus(root, VERIFICATION_FILE) } : null,
    manualChecks: manual ? { ticked: (manual.match(/^\s*- \[x\]/gim) ?? []).length, total: (manual.match(/^\s*- \[[ x]\]/gim) ?? []).length } : null,
    git: git(root, ['rev-parse', '--is-inside-work-tree']) === 'true'
      ? { branch: git(root, ['branch', '--show-current']) || '(detached)', head: git(root, ['rev-parse', '--short', 'HEAD']), dirty: (git(root, ['status', '--porcelain']) ?? '').split('\n').filter((l) => l && !l.slice(3).startsWith('.sdlc/')).length }
      : null,
  };
}

/** The state as short lines a model reads at session start. */
export function renderState(s) {
  const lines = ['sdlc-kit state'];
  lines.push(s.requirements ? `  requirements  ${s.requirements.total} (${s.requirements.must} MUST), ${shown(s.requirements.status)}${s.requirements.approved ? ' (frozen: changing one is a human decision)' : ''}` : '  requirements  none yet (/sdlc-kit:write-requirements)');
  if (s.architecture) lines.push(`  architecture  ${ARCHITECTURE_FILE}, ${shown(s.architecture.status)}`);
  if (s.uiSpec) lines.push(`  ui spec       ${UI_SPEC_FILE}, ${shown(s.uiSpec.status)}`);
  lines.push(s.plan ? `  plan          ${s.plan.slices} slices, ${shown(s.plan.status)}${s.plan.approved ? ' (frozen)' : ''}` : '  plan          none yet (/sdlc-kit:plan-slices)');
  lines.push(s.slice ? `  slice         ${s.slice.id} active${s.slice.files ? `: ${s.slice.files.join(', ')}` : ' (not in the plan!)'}` : '  slice         none active: only docs/** may change');
  if (s.manualChecks) lines.push(`  manual checks ${s.manualChecks.ticked}/${s.manualChecks.total} ticked`);
  if (s.review) lines.push(`  review        cycle ${s.review.cycle ?? '?'}, verdict ${s.review.verdict ?? '?'}, reviewed ${s.review.sha ?? '?'}`);
  if (s.verification) lines.push(`  verification  ${shown(s.verification.status)}`);
  if (s.git) lines.push(`  git           ${s.git.branch} at ${s.git.head}, ${s.git.dirty} changed file${s.git.dirty === 1 ? '' : 's'}`);
  return lines;
}

export function readSavedState(root) {
  try {
    return JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const state = projectState(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd());
  console.log(argv.includes('--json') ? JSON.stringify(state, null, 2) : renderState(state).join('\n'));
}
