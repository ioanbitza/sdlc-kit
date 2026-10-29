#!/usr/bin/env node
// The contract: every document under docs/ that the human approved (`Status: approved`, or `Status: accepted` for an
// ADR) stays as it was at the moment of approval. The approval point is the newest commit in which the document's
// Status line changed; any later change to the document's text, committed or not, breaks the contract. To change an
// approved document the human edits it and changes its Status line in the same commit (adding the date is enough):
// that is a new approval. No state file: git history is the record, so CI gives the same answer as the terminal.
// Usage: node contract.mjs [--root <dir>]     exit 0 when every approved document is intact, 1 otherwise
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMain } from './hook-common.mjs';
import { APPROVED_STATUS } from './scope.mjs';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** The Status line of a document, trimmed, or null. */
export function statusLine(text) {
  const m = String(text ?? '').match(/^Status:.*$/im);
  return m ? m[0].trim() : null;
}

/** Every markdown document under docs/ (any depth) that carries an approval, except the review folder (its files quote documents). */
export function approvedDocs(root) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'review') walk(path);
        continue;
      }
      if (!/\.md$/i.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      if (APPROVED_STATUS.test(text)) out.push(path.slice(root.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(join(root, 'docs'));
  return out;
}

/**
 * One document's standing: { file, state, approvedIn, detail }
 *   intact        unchanged since its approval commit
 *   changed       committed or working-tree changes after the approval, with the Status line left as it was
 *   reapproving   the working tree changes the Status line too (a new approval in progress, the human's)
 *   uncommitted   approved in the working tree but never committed yet
 *   no-git        not a repository: nothing to compare against
 */
export function documentStanding(root, file) {
  if (git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return { file, state: 'no-git', approvedIn: null, detail: 'not a git repository' };
  const commits = (git(root, ['log', '--follow', '--format=%H', '--', file]) ?? '').split('\n').filter(Boolean);
  const current = readFileSync(join(root, file), 'utf8');
  if (!commits.length) return { file, state: 'uncommitted', approvedIn: null, detail: 'approved but not committed yet' };
  const at = (sha) => git(root, ['show', `${sha}:${file}`]) ?? '';
  const headText = at(commits[0]);
  if (current !== headText) {
    if (statusLine(current) !== statusLine(headText)) return { file, state: 'reapproving', approvedIn: null, detail: 'the Status line is changing in the working tree: a new approval' };
    return { file, state: 'changed', approvedIn: commits[0].slice(0, 7), detail: 'changed in the working tree after its approval' };
  }
  let approval = commits[commits.length - 1];
  for (let i = 0; i < commits.length - 1; i++) {
    if (statusLine(at(commits[i])) !== statusLine(at(commits[i + 1]))) {
      approval = commits[i];
      break;
    }
  }
  const approvedText = at(approval);
  if (approvedText !== headText) {
    const after = commits.slice(0, commits.indexOf(approval));
    return { file, state: 'changed', approvedIn: approval.slice(0, 7), detail: `changed in ${after.length} commit${after.length === 1 ? '' : 's'} after its approval in ${approval.slice(0, 7)} (${after[0].slice(0, 7)}${after.length > 1 ? ', ...' : ''})` };
  }
  return { file, state: 'intact', approvedIn: approval.slice(0, 7), detail: `approved in ${approval.slice(0, 7)}` };
}

/** Every approved document's standing; ok when none is `changed`. */
export function checkContract(root) {
  const docs = approvedDocs(root).map((file) => documentStanding(root, file));
  const broken = docs.filter((d) => d.state === 'changed');
  const text = !docs.length
    ? 'no approved document yet'
    : broken.length
      ? `${broken[0].file} ${broken[0].detail}; an approved document changes only with a new Status line from the human`
      : `${docs.length} approved document${docs.length === 1 ? '' : 's'} intact (${docs.map((d) => `${d.file.replace(/^docs\//, '')}${d.approvedIn ? '@' + d.approvedIn : d.state === 'uncommitted' ? ' uncommitted' : ''}`).join(', ')})`;
  return { ok: broken.length === 0, docs, broken, text };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const result = checkContract(resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd()));
  for (const d of result.docs) console.log(`${d.state.padEnd(12)} ${d.file}  ${d.detail}`);
  console.log(result.ok ? 'CONTRACT INTACT' : `CONTRACT BROKEN: ${result.text}`);
  process.exit(result.ok ? 0 : 1);
}
