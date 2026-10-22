import test from 'node:test';
import assert from 'node:assert/strict';
import { commitMessage } from './hook-commit-guard.mjs';
import { makeProject, cleanup, runHook, bashInput, git, write } from './fixtures.mjs';

const guard = (cwd, command) => runHook('hook-commit-guard.mjs', bashInput(cwd, command));

test('commitMessage extracts the subject from -m, --message and the heredoc form', () => {
  assert.equal(commitMessage('git commit -m "S1: a (R-01)"'), 'S1: a (R-01)');
  assert.equal(commitMessage("git add -A && git commit -m 'S1: a (R-01)'"), 'S1: a (R-01)');
  assert.equal(commitMessage('git commit --message="S1: a (R-01)"'), 'S1: a (R-01)');
  assert.equal(commitMessage('git commit -m "$(cat <<\'EOF\'\nS1: a (R-01)\n\nbody\nEOF\n)"'), 'S1: a (R-01)');
  assert.equal(commitMessage('git commit -m "line one\nline two"'), 'line one');
  assert.equal(commitMessage('git commit'), null);
});

test('forbidden commands are denied with one sentence', () => {
  const root = makeProject();
  try {
    const cases = [
      ['npm install lodash', 'Denied: npm install adds a dependency, and this project has none (ADR-001); ask the human.'],
      ['npm i lodash', 'Denied: npm i adds a dependency, and this project has none (ADR-001); ask the human.'],
      ['npx prettier --write .', 'Denied: npx runs code from outside the repo; this project has no dependencies, ask the human.'],
      ['rm -rf src', 'Denied: rm -rf is not allowed; remove files one by one with git rm, or ask the human.'],
      ['git push --force origin main', 'Denied: a forced push rewrites shared history; not allowed.'],
      ['git commit --no-verify -m "S1: x (R-01)"', 'Denied: --no-verify skips the gate, and the gate is the point; fix what it reports instead.'],
      ['git commit --amend -m "S1: x (R-01)"', 'Denied: git commit --amend rewrites a committed slice; make a new commit.'],
      ['git -c user.name=x commit --amend -m "S1: x (R-01)"', 'Denied: git commit --amend rewrites a committed slice; make a new commit.'],
      ['git commit -n -m "S1: x (R-01)"', 'Denied: -n on git commit skips the gate, and the gate is the point; fix what it reports instead.'],
      ['GIT_DIR=/tmp/x git commit -m "S1: x (R-01)"', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
      ['ln -s /etc/passwd src/x.js', 'Denied: symlinks can point outside the project; copy the file or ask the human.'],
      ['git -c core.hooksPath=/dev/null commit -m "S1: x (R-01)"', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
      ['git config core.hooksPath /tmp/elsewhere', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
      ['git config --unset core.hooksPath', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
    ];
    for (const [command, sentence] of cases) {
      const r = guard(root, command);
      assert.equal(r.status, 2, command);
      assert.equal(r.stderr.trim(), sentence, command);
    }
  } finally {
    cleanup(root);
  }
});

test('any other command passes silently', () => {
  const root = makeProject();
  try {
    for (const command of ['ls -la', 'node --test', 'git status', 'git add -A', 'rm .sdlc/slice', 'git push origin main', 'git config core.hooksPath .githooks', 'chmod +x .githooks/pre-commit && git config core.hooksPath .githooks && git config core.hooksPath']) {
      const r = guard(root, command);
      assert.equal(r.status, 0, command);
      assert.equal(r.stdout + r.stderr, '', command);
    }
  } finally {
    cleanup(root);
  }
});

test('git commit with red tests: refused, first line names the problem', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 2);
    const [first, ...rest] = r.stderr.trim().split('\n');
    assert.equal(first, 'Commit refused: tests: 1 passed, 1 failed: R-02 rejects an empty name.');
    assert.equal(rest.at(-1), 'GATE FAIL');
  } finally {
    cleanup(root);
  }
});

test('git commit with a bad message: refused', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "fix stuff"');
    assert.equal(r.status, 2);
    assert.equal(r.stderr.split('\n')[0], 'Commit refused: commit: "fix stuff" must look like S<n>: what changed (R-xx, R-yy).');
    const noMsg = guard(root, 'git commit');
    assert.equal(noMsg.stderr.trim(), 'Commit refused: pass the message with -m, in the form S<n>: what changed (R-xx, R-yy).');
  } finally {
    cleanup(root);
  }
});

test('git commit with an unplanned staged file: refused', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  write(root, 'index.html', '<p></p>\n');
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 2);
    assert.match(r.stderr.split('\n')[0], /^Commit refused: scope: S1: index\.html is not in the plan \(allowed: /);
  } finally {
    cleanup(root);
  }
});

test('git commit on a green, in-scope, well-named slice: allowed', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git add -A && git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
  } finally {
    cleanup(root);
  }
});

test('docs-only commit with no slice: allowed with a plain message', () => {
  const root = makeProject();
  write(root, 'docs/PLAN.md', '# Plan\n');
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "Plan written"');
    assert.equal(r.status, 0, r.stderr);
  } finally {
    cleanup(root);
  }
});
