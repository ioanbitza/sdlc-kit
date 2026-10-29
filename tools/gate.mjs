#!/usr/bin/env node
// The one gate: tests + scope + trace + contract + secrets + deps + commit message (+ ci, review, mutations). Exit 0 on pass, 1 on fail.
// Same script, three callers: the Claude commit hook, .githooks/pre-commit and commit-msg, CI.
//   node gate.mjs                 working tree: scope on changed files, trace on all MUSTs
//   node gate.mjs --staged        scope on the staged files (pre-commit)
//   node gate.mjs --review        adds the review line: docs/REVIEW.md bound to HEAD, verdict (ship; warns, never fails)
//   node gate.mjs --strict        manual checks count only when ticked [x]; review line fails when stale or not MERGE;
//                                 mutations line from mutate.mjs --min 1 (merge, CI)
//   node gate.mjs --message "S3: what changed (R-11, R-12)"   also checks the commit message
//   node gate.mjs --only commit --message "..."              only the message (commit-msg hook)
//   node gate.mjs --root <dir>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests, isMain } from './hook-common.mjs';
import { trace } from './trace.mjs';
import { mutate } from './mutate.mjs';
import { checkContract } from './contract.mjs';
import { isSecretPath } from './hook-secret-guard.mjs';
import {
  allowedScope,
  isDocsLikePath,
  isProjectSkillPath,
  isSetupPath,
  readPlan,
  readRequirements,
  expandIds,
  PLAN_FILE,
  REQUIREMENTS_FILE,
} from './scope.mjs';

export const REVIEW_FILE = 'docs/REVIEW.md';

export const COMMIT_MESSAGE_PATTERN = /^S\d+: .+ \((R-\d{2}(\.\.R-\d{2})?(, R-\d{2}(\.\.R-\d{2})?)*)\)$/;
export const COMMIT_MESSAGE_HINT = 'S<n>: what changed (R-xx, R-yy)';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
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
    const outside = files.filter((f) => !isDocsLikePath(f));
    if (outside.length) {
      return {
        label: 'scope',
        ok: false,
        text: `no slice active: ${outside[0]} is outside docs/ (start a slice with /sdlc-kit:implement-slice S<n>)`,
      };
    }
    return { label: 'scope', ok: true, text: `no slice active: ${what}, all in docs/${files.some(isProjectSkillPath) ? ' and .claude/skills/' : ''}` };
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
  if (!slice && staged && files.every(isDocsLikePath)) {
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

/**
 * The commit the review is measured against. On a plain HEAD that is HEAD. On a merge commit (a pull_request run checks
 * out the merge of the branch into its base) it is the parent that descends from the reviewed sha: the branch tip, so
 * commits the base received meanwhile do not count as unreviewed code.
 */
export function reviewTip(root, sha) {
  const parents = (git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']) ?? '').trim().split(/\s+/).slice(1);
  if (parents.length < 2) return 'HEAD';
  const descends = parents.filter((p) => git(root, ['merge-base', '--is-ancestor', sha, p]) !== null);
  if (descends.length === 1) return descends[0];
  return parents[1];
}

/** The commits after `sha` that touch anything outside the docs-like paths (a review, ship, README or CI commit changes no code). */
function codeCommitsAfter(root, sha) {
  const log = git(root, ['log', '--format=%h %s', `${sha}..${reviewTip(root, sha)}`]);
  if (log === null) return null;
  const out = [];
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, ...rest] = line.split(' ');
    const files = (git(root, ['show', '--format=', '--name-only', hash]) ?? '').split('\n').filter(Boolean);
    if (files.some((f) => !isDocsLikePath(f))) out.push(`${hash} ${rest.join(' ')}`);
  }
  return out;
}

/**
 * The review line: docs/REVIEW.md names the commit it reviewed and its verdict. Stale (code commits after it),
 * missing or not MERGE is a warning for ship and a failure in strict mode.
 */
function checkReview(root, strict) {
  const soft = (text) => (strict ? { label: 'review', ok: false, text } : { label: 'review', ok: true, warn: true, text });
  const path = join(root, REVIEW_FILE);
  if (!existsSync(path)) return soft('none (run /sdlc-kit:review-change)');
  const text = readFileSync(path, 'utf8');
  const sha = text.match(/^Reviewed:\s*([0-9a-f]{7,40})\b/m)?.[1];
  const verdict = text.match(/^## Verdict:\s*([A-Z ]+?)(?::.*)?$/m)?.[1]?.trim() ?? 'unknown';
  if (!sha) return soft(`${REVIEW_FILE} has no "Reviewed: <sha>" line: re-review needed`);
  const statePath = join(root, 'docs/review/state.json');
  if (existsSync(statePath)) {
    let state = null;
    try {
      state = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      state = null;
    }
    const sameSha = state?.head && (String(state.head).startsWith(sha) || sha.startsWith(String(state.head)));
    const sameVerdict = state?.verdict && verdict.startsWith(String(state.verdict));
    if (!state || !state.rendered || !sameSha || !sameVerdict) return soft(`${REVIEW_FILE} does not match docs/review/state.json (the script's record: ${state?.rendered ? `${String(state.head ?? '?').slice(0, 7)} ${state.verdict ?? '?'}` : 'not rendered'}); run review.mjs render again`);
  }
  if (!isGitRepo(root)) return { label: 'review', ok: true, text: `${sha} verdict ${verdict}, not a git repo, binding not checked` };
  const after = codeCommitsAfter(root, sha);
  if (after === null) return soft(`${sha} is not in this repository: re-review needed`);
  if (after.length) {
    return soft(`${sha} is ${after.length} commit${after.length === 1 ? '' : 's'} old (${after[0]}${after.length > 1 ? ', ...' : ''}): re-review needed`);
  }
  if (verdict !== 'MERGE') return soft(`${sha} ok, verdict ${verdict}`);
  return { label: 'review', ok: true, text: `${sha} ok, verdict MERGE` };
}

/**
 * The survivors the latest rendered review judged equivalent: read from docs/review/state.json, which review.mjs render
 * writes after measuring the mutants itself and which no agent may write, never from the verifier's answer file the clerk
 * saved. Only a rendered cycle counts.
 */
export function equivalentMutants(root) {
  const path = join(root, 'docs/review/state.json');
  if (!existsSync(path)) return { cycle: null, mutants: [] };
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (!state?.rendered || !Array.isArray(state.equivalent)) return { cycle: state?.cycle ?? null, mutants: [] };
    return { cycle: state.cycle ?? null, mutants: state.equivalent };
  } catch {
    return { cycle: null, mutants: [] };
  }
}

const sameMutant = (a, b) => a.file === b.file && Number(a.line) === Number(b.line) && String(a.from).trim() === String(b.from).trim() && String(a.to).trim() === String(b.to).trim();

/** Strict only: every planted defect must be caught, except the ones the latest review's verifier marked equivalent. */
function checkMutations(root) {
  const m = mutate({ root });
  const judged = equivalentMutants(root);
  const equivalent = m.survivors.filter((s) => judged.mutants.some((e) => sameMutant(s, e)));
  const real = m.survivors.filter((s) => !equivalent.includes(s));
  const shown = real.slice(0, 3).map((s) => `${s.file}:${s.line} ${JSON.stringify(s.from.trim())} -> ${JSON.stringify(s.to.trim())}`).join('; ');
  const text = m.lines[0].replace(/^mutations\s+/, '') + (equivalent.length ? `, ${equivalent.length} equivalent (verifier, cycle ${judged.cycle})` : '') + (real.length ? ` (${shown}${real.length > 3 ? '; ...' : ''})` : '');
  return { label: 'mutations', ok: m.baselineOk && real.length === 0, text };
}

/** The contract row: every approved document unchanged since the commit that approved it (contract.mjs). */
function checkContractRow(root) {
  if (!isGitRepo(root)) return { label: 'contract', ok: true, text: 'not a git repo, not checked' };
  const c = checkContract(root);
  return { label: 'contract', ok: c.ok, text: c.text };
}

/** Shapes of a credential in a diff: private keys, cloud and platform tokens, a password or key given a literal value. The last two are skipped under tests/, where a wrong password and a fake token are fixtures. */
export const SECRET_SHAPES = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'a private key', true],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key', true],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token', true],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token', true],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/, 'an API secret key', true],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'a JWT', false],
  [/\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'a password or key with a literal value', false],
];

/** Documentation placeholders that look like credentials and are not: the values the vendors publish for examples. */
export const KNOWN_PLACEHOLDERS = ['AKIAIOSFODNN7EXAMPLE', 'AKIAI44QH8DHBEXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'];

/** `+` lines of a unified diff, with the file each belongs to. */
function diffAdditions(out) {
  const lines = [];
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && !line.startsWith('+++')) lines.push({ file, text: line.slice(1) });
  }
  return lines;
}

/**
 * The added lines the gate scans: the staged diff (pre-commit), or the working tree against HEAD plus untracked files.
 * In strict mode (CI, a clean checkout) the tree holds no diff, so the commits themselves are read: the range the
 * pull request brings (GITHUB_BASE_REF) or the last commit. Returns null when git could not produce a diff.
 */
export function addedLines(root, staged, strict = false) {
  const out = git(root, staged ? ['diff', '--cached', '-U0', '--no-color'] : ['diff', 'HEAD', '-U0', '--no-color']);
  if (out === null) return null;
  const lines = diffAdditions(out);
  if (!staged) {
    const untracked = (git(root, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n').filter(Boolean);
    for (const f of untracked) {
      const path = join(root, f);
      if (!existsSync(path)) continue;
      for (const text of readFileSync(path, 'utf8').split('\n')) lines.push({ file: f, text });
    }
    if (strict) {
      const base = process.env.GITHUB_BASE_REF;
      const range = base && git(root, ['rev-parse', '--verify', '--quiet', `origin/${base}`]) !== null ? `origin/${base}...HEAD` : null;
      const committed = range ? git(root, ['log', '-p', '-U0', '--no-color', '--format=', range]) : git(root, ['show', '-U0', '--no-color', '--format=', 'HEAD']);
      if (committed === null) return null;
      lines.push(...diffAdditions(committed));
    }
  }
  return lines;
}

/** The secrets row: no secret-named file among the changes, no credential shape in the added lines. */
function checkSecrets(root, files, staged, strict) {
  if (!isGitRepo(root)) return { label: 'secrets', ok: true, text: 'not a git repo, not checked' };
  const named = files.find((f) => isSecretPath(f));
  if (named) return { label: 'secrets', ok: false, text: `${named} is a secret file; it never enters the repository, the human sets secrets in the environment` };
  const added = addedLines(root, staged, strict);
  if (added === null) return { label: 'secrets', ok: false, text: 'the diff could not be read (git failed or the change is too large to scan); make the change smaller' };
  for (const { file, text } of added) {
    let scanned = text;
    for (const p of KNOWN_PLACEHOLDERS) scanned = scanned.split(p).join('');
    const inTests = /^tests\//.test(file ?? '');
    for (const [shape, what, everywhere] of SECRET_SHAPES) {
      if (inTests && !everywhere) continue;
      if (shape.test(scanned)) return { label: 'secrets', ok: false, text: `${file ?? 'a changed file'} adds ${what}; secrets never enter the repository` };
    }
  }
  return { label: 'secrets', ok: true, text: `${files.length} file${files.length === 1 ? '' : 's'} clean` };
}

/** Dependency manifests and lockfiles: a dependency is a human decision (ADR-001), so a change here fails inside a slice and warns outside one. */
export const DEPENDENCY_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'requirements.txt', 'Pipfile.lock', 'poetry.lock', 'go.sum', 'Cargo.lock', 'Gemfile.lock', 'composer.lock'];
function checkDependencies(root, files) {
  const touched = files.filter((f) => DEPENDENCY_FILES.includes(f.split('/').pop()));
  if (!touched.length) return { label: 'deps', ok: true, text: 'no dependency file changed' };
  const slice = allowedScope(root).slice;
  const text = `${touched.join(', ')} changed; a dependency is a human decision (ADR-001)${slice ? `, not a ${slice} change` : ''}`;
  return slice ? { label: 'deps', ok: false, text } : { label: 'deps', ok: true, warn: true, text };
}

/** The CI row: the kit's workflow is installed and pins the kit to a full commit sha, so CI runs the gate everyone else ran. */
export const WORKFLOW_FILE = '.github/workflows/gate.yml';
function checkCi(root, strict) {
  const soft = (text) => (strict ? { label: 'ci', ok: false, text } : { label: 'ci', ok: true, warn: true, text });
  const path = join(root, WORKFLOW_FILE);
  if (!existsSync(path)) return soft(`${WORKFLOW_FILE} missing (run /sdlc-kit:init)`);
  const ref = kitCheckoutRef(readFileSync(path, 'utf8'));
  if (!ref) return soft(`${WORKFLOW_FILE} does not pin the kit (no ref: in the with: block of the sdlc-kit checkout); pin it to a full commit sha`);
  if (!/^[0-9a-f]{40}$/.test(ref)) return soft(`${WORKFLOW_FILE} pins the kit to "${ref}", not a full 40-hex sha`);
  return { label: 'ci', ok: true, text: `${WORKFLOW_FILE} pins the kit to ${ref.slice(0, 7)}` };
}

/**
 * The `ref:` of the step that checks the kit out: read inside that step's own `with:` block (the lines indented deeper
 * than the `repository:` key's parent, up to the next list item), so a `ref:` of another step cannot stand in for it.
 */
export function kitCheckoutRef(yaml) {
  const lines = String(yaml).split('\n');
  const i = lines.findIndex((l) => /^\s*repository:\s*\S+\/sdlc-kit\s*(?:#.*)?$/.test(l));
  if (i < 0) return null;
  const indent = lines[i].match(/^\s*/)[0].length;
  for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
    const m = lines[j].match(/^(\s*)ref:\s*([^\s#]+)/);
    if (m && m[1].length === indent) return m[2];
    if (/^\s*-\s/.test(lines[j])) break;
  }
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim()) continue;
    const ind = line.match(/^\s*/)[0].length;
    if (ind < indent || /^\s*-\s/.test(line)) break;
    const m = line.match(/^\s*ref:\s*([^\s#]+)/);
    if (m && ind === indent) return m[1];
  }
  return null;
}

/** The slice row: a slice names at most six files (plan-slices); more is a warning, the plan is the human's. */
export const MAX_SLICE_FILES = 6;
function checkSliceSize(root) {
  const scope = allowedScope(root);
  if (!scope.slice || scope.error || !scope.files) return null;
  const own = scope.files.filter((f) => f !== 'docs/MANUAL-CHECKS.md');
  if (own.length <= MAX_SLICE_FILES) return null;
  return { label: 'slice', ok: true, warn: true, text: `${scope.slice} names ${own.length} files, more than the ${MAX_SLICE_FILES} the plan format allows; split it next time` };
}

/** The message rule is relaxed for one case: no slice active and only docs/ or setup files staged. */
function checkCommit(root, message, files) {
  if (message == null) return { label: 'commit', ok: true, text: 'no message to check' };
  const subject = message.split('\n')[0].trim();
  const quoted = `"${subject}"`;
  const slice = allowedScope(root).slice;
  const docsOnly = !slice && files.every(isDocsLikePath);
  const match = subject.match(COMMIT_MESSAGE_PATTERN);
  if (!match) {
    if (docsOnly) return { label: 'commit', ok: true, text: `${quoted} ok (docs only, no slice active)` };
    return { label: 'commit', ok: false, text: `${quoted} must look like ${COMMIT_MESSAGE_HINT}` };
  }
  const known = new Set(readRequirements(root).map((r) => r.id));
  if (!known.size) return { label: 'commit', ok: false, text: `${quoted} names requirements but ${REQUIREMENTS_FILE} has none` };
  const ids = expandIds(match[1]);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return { label: 'commit', ok: false, text: `${quoted} uses ${unknown.join(', ')}, not in ${REQUIREMENTS_FILE}` };
  const named = subject.match(/^(S\d+):/)[1];
  if (slice && named !== slice) return { label: 'commit', ok: false, text: `${quoted} names ${named} but ${slice} is active (.sdlc/slice)` };
  const covers = slice ? readPlan(root)?.get(slice)?.covers ?? [] : [];
  const outside = slice && covers.length ? ids.filter((id) => !covers.includes(id)) : [];
  if (outside.length) return { label: 'commit', ok: true, warn: true, text: `${quoted} ok; ${outside.join(', ')} not in ${slice}'s Covers line` };
  return { label: 'commit', ok: true, text: `${quoted} ok` };
}

/**
 * Runs the gate. options: { root, staged, strict, review, message, only, extraStaged (files a `git add` in the same command will stage) }
 * Returns { ok, rows: [{label, ok, warn, text}], lines }. A warn row prints `<- WARN` and does not fail the gate.
 */
export function runGate(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const extra = (options.extraStaged ?? []).map((f) => f.replace(/^\.\//, ''));
  const files = [...new Set([...(options.staged ? stagedFiles(root) : changedFiles(root)), ...(options.staged ? extra : [])])].filter((f) => !f.startsWith('.sdlc/') && !f.startsWith('.sdlc-kit/'));
  const mode = options.staged ? 'staged' : 'changed';
  const only = options.only ? new Set([].concat(options.only)) : null;
  const wanted = (label) => !only || only.has(label);
  const rows = [];
  if (wanted('tests')) rows.push(checkTests(root));
  if (wanted('scope')) rows.push(checkScope(root, files, mode));
  if (wanted('trace')) rows.push(checkTrace(root, options.strict, files, options.staged));
  if (wanted('contract')) rows.push(checkContractRow(root));
  if (wanted('secrets')) rows.push(checkSecrets(root, files, options.staged, options.strict));
  if (wanted('deps')) rows.push(checkDependencies(root, files));
  if (wanted('slice')) {
    const row = checkSliceSize(root);
    if (row) rows.push(row);
  }
  if (wanted('commit')) rows.push(checkCommit(root, options.message, files));
  if ((options.review || options.strict) && wanted('ci')) rows.push(checkCi(root, options.strict));
  if ((options.review || options.strict) && wanted('review')) rows.push(checkReview(root, options.strict));
  if (options.strict && wanted('mutations')) rows.push(checkMutations(root));
  const ok = rows.every((r) => r.ok);
  const lines = [...rows.map((r) => `gate     ${r.label.padEnd(8)} ${r.text}${r.ok ? (r.warn ? '   <- WARN' : '') : '   <- FAIL'}`), ok ? 'GATE PASS' : 'GATE FAIL'];
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
    review: argv.includes('--review'),
    message,
    only: value('--only'),
  });
  console.log(result.lines.join('\n'));
  return result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
