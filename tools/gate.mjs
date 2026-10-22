#!/usr/bin/env node
// The one gate: tests + scope + trace + commit message. Exit 0 on pass, 1 on fail.
// Same script, three callers: the Claude commit hook, .githooks/pre-commit and commit-msg, CI.
//   node gate.mjs                 working tree: scope on changed files, trace on all MUSTs
//   node gate.mjs --staged        scope on the staged files (pre-commit)
//   node gate.mjs --strict        manual checks count only when ticked [x] (merge, CI)
//   node gate.mjs --message "S3: what changed (R-11, R-12)"   also checks the commit message
//   node gate.mjs --only commit --message "..."              only the message (commit-msg hook)
//   node gate.mjs --root <dir>
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests, isMain } from './hook-common.mjs';
import { trace } from './trace.mjs';
import {
  allowedScope,
  isDocsPath,
  isSetupPath,
  readPlan,
  readRequirements,
  expandIds,
  PLAN_FILE,
  REQUIREMENTS_FILE,
} from './scope.mjs';

export const COMMIT_MESSAGE_PATTERN = /^S\d+: .+ \((R-\d{2}(\.\.R-\d{2})?(, R-\d{2}(\.\.R-\d{2})?)*)\)$/;
export const COMMIT_MESSAGE_HINT = 'S<n>: what changed (R-xx, R-yy)';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function isGitRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

export function stagedFiles(root) {
  const out = git(root, ['diff', '--cached', '--name-only']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function changedFiles(root) {
  const out = git(root, ['status', '--porcelain', '--untracked-files=all']);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').pop().trim())
    .filter(Boolean);
}

function checkTests(root) {
  const t = runTests(root);
  if (t.crashed) return { label: 'tests', ok: false, text: t.summary };
  if (t.total === 0) return { label: 'tests', ok: true, text: 'no tests yet' };
  const names = t.failures.length ? `: ${t.failures.slice(0, 3).join('; ')}` : '';
  return { label: 'tests', ok: t.failed === 0, text: `${t.passed} passed, ${t.failed} failed${names}`, failed: t.failed };
}

function checkScope(root, files, mode) {
  if (!isGitRepo(root)) return { label: 'scope', ok: true, text: 'not a git repo, not checked' };
  const scope = allowedScope(root);
  const what = `${files.length} file${files.length === 1 ? '' : 's'} ${mode}`;
  if (!scope.slice) {
    if (!readPlan(root)) return { label: 'scope', ok: true, text: `no plan yet, ${what}` };
    const outside = files.filter((f) => !isDocsPath(f) && !isSetupPath(f));
    if (outside.length) {
      return {
        label: 'scope',
        ok: false,
        text: `no slice active: ${outside[0]} is outside docs/ (start a slice with /sdlc-kit:implement-slice S<n>)`,
      };
    }
    return { label: 'scope', ok: true, text: `no slice active: ${what}, all in docs/` };
  }
  if (scope.error) return { label: 'scope', ok: false, text: `${scope.slice}: ${scope.error}` };
  const outside = files.filter((f) => !scope.files.includes(f));
  if (outside.length) {
    return {
      label: 'scope',
      ok: false,
      text: `${scope.slice}: ${outside[0]} is not in the plan (allowed: ${scope.files.join(', ')})`,
    };
  }
  return { label: 'scope', ok: true, text: `${scope.slice}: ${what}, all in plan` };
}

function checkTrace(root, strict, files, staged) {
  if (!existsSync(join(root, REQUIREMENTS_FILE))) return { label: 'trace', ok: true, text: 'no requirements yet' };
  const slice = allowedScope(root).slice;
  if (!slice && staged && files.length && files.every((f) => isDocsPath(f) || isSetupPath(f))) {
    return { label: 'trace', ok: true, text: 'docs only, not checked' };
  }
  const result = trace({ root, listed: !strict, slice: slice ?? undefined });
  if (result.sliceError) return { label: 'trace', ok: false, text: result.sliceError };
  if (!result.requirements.length) {
    return { label: 'trace', ok: false, text: `${REQUIREMENTS_FILE} has no "### R-xx [MUST] Title" headings` };
  }
  const prefix = slice ? `${slice}: ` : '';
  const missing = result.rows.filter((r) => r.missing).map((r) => r.id);
  const detail = missing.length ? ` (${missing.slice(0, 5).join(', ')}${strict ? ', strict: manual checks must be [x]' : ''})` : '';
  const orphans = result.orphans.length ? ` (not defined: ${result.orphans.join(', ')})` : '';
  return {
    label: 'trace',
    ok: result.ok,
    text: `${prefix}${result.must} MUST, ${result.missing} missing${detail}, ${result.orphans.length} orphan IDs${orphans}`,
  };
}

/** The message rule is relaxed for one case: no slice active and only docs/ or setup files staged. */
function checkCommit(root, message, files) {
  if (message == null) return { label: 'commit', ok: true, text: 'no message to check' };
  const subject = message.split('\n')[0].trim();
  const quoted = `"${subject}"`;
  const slice = allowedScope(root).slice;
  const docsOnly = !slice && files.length > 0 && files.every((f) => isDocsPath(f) || isSetupPath(f));
  const match = subject.match(COMMIT_MESSAGE_PATTERN);
  if (!match) {
    if (docsOnly) return { label: 'commit', ok: true, text: `${quoted} ok (docs only, no slice active)` };
    return { label: 'commit', ok: false, text: `${quoted} must look like ${COMMIT_MESSAGE_HINT}` };
  }
  const known = new Set(readRequirements(root).map((r) => r.id));
  if (!known.size) return { label: 'commit', ok: false, text: `${quoted} names requirements but ${REQUIREMENTS_FILE} has none` };
  const unknown = expandIds(match[1]).filter((id) => !known.has(id));
  if (unknown.length) return { label: 'commit', ok: false, text: `${quoted} uses ${unknown.join(', ')}, not in ${REQUIREMENTS_FILE}` };
  return { label: 'commit', ok: true, text: `${quoted} ok` };
}

/**
 * Runs the gate. options: { root, staged, strict, message, only }
 * Returns { ok, rows: [{label, ok, text}], lines }.
 */
export function runGate(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const files = (options.staged ? stagedFiles(root) : changedFiles(root)).filter((f) => !f.startsWith('.sdlc/'));
  const mode = options.staged ? 'staged' : 'changed';
  const only = options.only ? new Set([].concat(options.only)) : null;
  const wanted = (label) => !only || only.has(label);
  const rows = [];
  if (wanted('tests')) rows.push(checkTests(root));
  if (wanted('scope')) rows.push(checkScope(root, files, mode));
  if (wanted('trace')) rows.push(checkTrace(root, options.strict, files, options.staged));
  if (wanted('commit')) rows.push(checkCommit(root, options.message, files));
  const ok = rows.every((r) => r.ok);
  const lines = [...rows.map((r) => `gate     ${r.label.padEnd(6)} ${r.text}${r.ok ? '' : '   <- FAIL'}`), ok ? 'GATE PASS' : 'GATE FAIL'];
  return { ok, rows, lines, files };
}

function cli(argv) {
  const value = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  let message = value('--message');
  const messageFile = value('--message-file');
  if (messageFile && existsSync(messageFile)) {
    message = readFileSync(messageFile, 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
  }
  const result = runGate({
    root: value('--root') ?? process.cwd(),
    staged: argv.includes('--staged'),
    strict: argv.includes('--strict'),
    message,
    only: value('--only'),
  });
  console.log(result.lines.join('\n'));
  return result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
