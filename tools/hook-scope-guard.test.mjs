import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, cleanup, runHook, editInput, writeInput } from './fixtures.mjs';

const guard = (input) => runHook('hook-scope-guard.mjs', input);

test('allows an edit inside the active slice (absolute path)', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const r = guard(editInput(root, `${root}/src/domain/customers.js`));
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  } finally {
    cleanup(root);
  }
});

test('denies a file outside the slice with the allowed list', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const r = guard(writeInput(root, 'index.html', '<p>logo</p>'));
    assert.equal(r.status, 2);
    assert.equal(
      r.stderr.trim(),
      'S1 allows src/domain/customers.js, tests/customers.test.js, docs/MANUAL-CHECKS.md. index.html is not in the plan. Stop and ask the human.',
    );
  } finally {
    cleanup(root);
  }
});

test('denies innerHTML in Write content and in Edit new_string', () => {
  const root = makeProject({ slice: 'S3' });
  try {
    const w = guard(writeInput(root, 'src/ui/main.js', 'el.innerHTML = name;'));
    assert.equal(w.status, 2);
    assert.equal(w.stderr.trim(), 'Denied: src/ui/main.js would use innerHTML, which AGENTS.md forbids; render user text with textContent or DOM APIs.');
    const e = guard(editInput(root, 'src/ui/main.js', { new_string: 'x.innerHTML = y' }));
    assert.equal(e.status, 2);
  } finally {
    cleanup(root);
  }
});

test('no slice: docs/** allowed, code denied', () => {
  const root = makeProject();
  try {
    assert.equal(guard(writeInput(root, 'docs/PLAN.md')).status, 0);
    assert.equal(guard(writeInput(root, 'docs/REVIEW.md')).status, 0);
    const r = guard(editInput(root, 'src/domain/customers.js'));
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), 'No slice is active: only docs/** may change. src/domain/customers.js needs /sdlc-kit:implement-slice S<n> first.');
  } finally {
    cleanup(root);
  }
});

test('always denied: approved requirements, AGENTS.md, CLAUDE.md, docs/decisions, .sdlc', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const req = guard(editInput(root, 'docs/REQUIREMENTS.md'));
    assert.equal(req.status, 2);
    assert.equal(req.stderr.trim(), 'Denied: docs/REQUIREMENTS.md is approved, changing a requirement is a human decision; the human edits it, you ask.');
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'docs/decisions/ADR-003-new.md', '.sdlc/slice']) {
      const r = guard(writeInput(root, f));
      assert.equal(r.status, 2, f);
      assert.equal(r.stderr.trim(), `Denied: ${f} is a human decision file; the human edits it, you ask.`);
    }
  } finally {
    cleanup(root);
  }
});

test('draft requirements may be written (write-requirements runs with no slice)', () => {
  const root = makeProject({ approved: false });
  try {
    assert.equal(guard(writeInput(root, 'docs/REQUIREMENTS.md', '### R-01 [MUST] x')).status, 0);
  } finally {
    cleanup(root);
  }
});

test('marker for an unknown slice: denied with a fix hint', () => {
  const root = makeProject({ slice: 'S9' });
  try {
    const r = guard(editInput(root, 'src/a.js'));
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), 'Denied: .sdlc/slice says S9 but docs/PLAN.md has no slice S9; run /sdlc-kit:plan-slices or fix the marker before editing src/a.js.');
  } finally {
    cleanup(root);
  }
});

test('other tools and empty input are ignored', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    assert.equal(guard({ cwd: root, tool_name: 'Read', tool_input: { file_path: 'index.html' } }).status, 0);
    assert.equal(guard({}).status, 0);
  } finally {
    cleanup(root);
  }
});
