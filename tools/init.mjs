#!/usr/bin/env node
// One-time setup of the kit in a repository, as one command: node <kit>/tools/init.mjs [--root <dir>]
//   .sdlc/kit-path (this kit's root), .sdlc/ and .sdlc-kit/ (the kit checkout in CI) in .gitignore, .githooks/pre-commit and commit-msg (executable),
//   core.hooksPath = .githooks, .github/workflows/gate.yml, AGENTS.md from the template when the repo has none.
// Prints what it did and runs the gate once. Exit 0 on success, 1 when the folder is not a git repository.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMain } from './hook-common.mjs';
import { KIT_ROOT } from './roles.mjs';
import { runGate } from './gate.mjs';

/** Kit state, and the folder the CI workflow checks the kit out into: neither is project code, so the gate's scope check must not see them. */
const IGNORED_FOLDERS = ['.sdlc/', '.sdlc-kit/'];

/** The kit's own commit, so the project's CI runs the same gate the developer ran; null when the kit is not a git checkout. */
export function kitHead(kitRoot = KIT_ROOT) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: kitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** True when a remote branch holds the kit's commit: CI can check it out. A local-only commit makes every CI run fail at checkout. */
export function kitPushed(kitRoot = KIT_ROOT, sha = kitHead(kitRoot)) {
  if (!sha) return false;
  try {
    return execFileSync('git', ['branch', '-r', '--contains', sha], { cwd: kitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Deny rules Claude Code enforces in every permission mode, hooks or no hooks: the hooks explain, these hold even when a
 * hook times out or hooks are disabled. Merged into .claude/settings.json; rules already there are kept.
 */
export const DENY_RULES = [
  'Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)', 'Read(./**/*.pem)', 'Read(./**/*.key)',
  'Bash(git push *)', 'Bash(git push)', 'Bash(git tag *)', 'Bash(git commit --no-verify *)', 'Bash(git commit -n *)',
  'Bash(npm install *)', 'Bash(npm i *)', 'Bash(npm ci)', 'Bash(npm ci *)', 'Bash(npm add *)', 'Bash(npx *)',
  'Bash(gh pr create *)', 'Bash(gh pr merge *)', 'Bash(gh release *)', 'Bash(git branch -D *)', 'Bash(git reset --hard *)',
  'Bash(printenv)', 'Bash(env)',
];
export function writeDenyRules(root) {
  const path = join(root, '.claude/settings.json');
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return 'not written: .claude/settings.json is not valid JSON, add the deny rules by hand';
    }
  }
  settings.permissions ??= {};
  const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
  const missing = DENY_RULES.filter((r) => !deny.includes(r));
  if (!missing.length) return 'already listed';
  settings.permissions.deny = [...deny, ...missing];
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  return `${missing.length} added (push, tag, --no-verify, npm install, npx, secret files)`;
}

export function init(root, kitRoot = KIT_ROOT) {
  const lines = ['sdlc-kit init'];
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
  } catch {
    return { ok: false, lines: ['sdlc-kit init: not a git repository; run git init first.'] };
  }
  mkdirSync(join(root, '.sdlc'), { recursive: true });
  writeFileSync(join(root, '.sdlc/kit-path'), resolve(kitRoot) + '\n');
  lines.push(`  kit path      .sdlc/kit-path -> ${resolve(kitRoot)}`);

  const gitignore = join(root, '.gitignore');
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const listed = new Set(ignored.split('\n').map((l) => l.trim()));
  const missing = IGNORED_FOLDERS.filter((entry) => !listed.has(entry));
  if (missing.length) {
    appendFileSync(gitignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    lines.push(`  gitignore     ${missing.join(', ')} added`);
  } else lines.push(`  gitignore     ${IGNORED_FOLDERS.join(', ')} already listed`);

  mkdirSync(join(root, '.githooks'), { recursive: true });
  for (const hook of ['pre-commit', 'commit-msg']) {
    copyFileSync(join(kitRoot, 'templates/githooks', hook), join(root, '.githooks', hook));
    chmodSync(join(root, '.githooks', hook), 0o755);
  }
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
  lines.push('  git hooks     .githooks/pre-commit, .githooks/commit-msg (core.hooksPath set)');

  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  const kitSha = kitHead(kitRoot);
  const workflow = readFileSync(join(kitRoot, 'templates/github-workflow-gate.yml'), 'utf8').replace('__KIT_SHA__', kitSha ?? 'main');
  writeFileSync(join(root, '.github/workflows/gate.yml'), workflow);
  lines.push(`  CI            .github/workflows/gate.yml (kit pinned to ${kitSha ? kitSha.slice(0, 7) : 'main: the kit checkout is not a git repository, pin it by hand'})`);
  if (kitSha && !kitPushed(kitRoot, kitSha)) lines.push(`  CI            ${kitSha.slice(0, 7)} is not on any remote of the kit yet: push the kit before this workflow can check it out`);

  const settings = writeDenyRules(root);
  lines.push(`  permissions   .claude/settings.json deny rules ${settings}`);

  if (!existsSync(join(root, 'AGENTS.md'))) {
    copyFileSync(join(kitRoot, 'templates/AGENTS.md'), join(root, 'AGENTS.md'));
    lines.push('  AGENTS.md     copied from the template; adapt it');
  } else lines.push('  AGENTS.md     kept');

  const gate = runGate({ root });
  lines.push(`  gate          ${gate.lines.at(-1)}`);
  lines.push('Next: /sdlc-kit:write-requirements docs/BRIEF.md');
  return { ok: true, lines };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const result = init(resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd()));
  console.log(result.lines.join('\n'));
  process.exit(result.ok ? 0 : 1);
}
