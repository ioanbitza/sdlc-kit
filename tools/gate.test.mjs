import test from 'node:test';
import assert from 'node:assert/strict';
import { runGate, COMMIT_MESSAGE_PATTERN } from './gate.mjs';
import { makeProject, cleanup, write, git, runTool } from './fixtures.mjs';

const row = (gate, label) => gate.rows.find((r) => r.label === label);

test('commit message pattern: lists, ranges, rejects the rest', () => {
  assert.ok(COMMIT_MESSAGE_PATTERN.test('S1: customer rules (R-01, R-02)'));
  assert.ok(COMMIT_MESSAGE_PATTERN.test('S3: money, lines and totals (R-11..R-17)'));
  assert.ok(COMMIT_MESSAGE_PATTERN.test('S3: mixed (R-04, R-11..R-13, R-20)'));
  assert.ok(!COMMIT_MESSAGE_PATTERN.test('fix stuff'));
  assert.ok(!COMMIT_MESSAGE_PATTERN.test('S1: no ids'));
  assert.ok(!COMMIT_MESSAGE_PATTERN.test('S1: bad id (R-1)'));
});

test('staged, green tests, files in plan, good message: PASS with the 4-line table', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const gate = runGate({ root, staged: true, message: 'S1: customer rules (R-01, R-02)' });
    assert.ok(gate.ok, gate.lines.join('\n'));
    assert.equal(gate.lines.length, 5);
    assert.match(gate.lines[0], /^gate {5}tests {2}2 passed, 0 failed$/);
    assert.match(gate.lines[1], /^gate {5}scope {2}S1: 2 files staged, all in plan$/);
    assert.match(gate.lines[2], /^gate {5}trace {2}S1: 2 MUST, 0 missing, 0 orphan IDs$/);
    assert.match(gate.lines[3], /^gate {5}commit "S1: customer rules \(R-01, R-02\)" ok$/);
    assert.equal(gate.lines[4], 'GATE PASS');
  } finally {
    cleanup(root);
  }
});

test('red tests fail the gate and name the failing test', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  git(root, 'add', '-A');
  try {
    const gate = runGate({ root, staged: true, message: 'S1: customer rules (R-01, R-02)' });
    assert.ok(!gate.ok);
    assert.equal(row(gate, 'tests').ok, false);
    assert.match(row(gate, 'tests').text, /1 passed, 1 failed: R-02 rejects an empty name/);
    assert.equal(gate.lines.at(-1), 'GATE FAIL');
  } finally {
    cleanup(root);
  }
});

test('a staged file outside the slice fails scope and lists the allowed files', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  write(root, 'index.html', '<p>logo</p>\n');
  git(root, 'add', '-A');
  try {
    const gate = runGate({ root, staged: true });
    assert.equal(row(gate, 'scope').ok, false);
    assert.match(row(gate, 'scope').text, /^S1: index\.html is not in the plan \(allowed: src\/domain\/customers\.js, tests\/customers\.test\.js, docs\/MANUAL-CHECKS\.md\)$/);
  } finally {
    cleanup(root);
  }
});

test('trace: a slice MUST without test or listed check is missing; a listed check is enough unless --strict', () => {
  const root = makeProject({ slice: 'S3' });
  write(root, 'index.html', '<p></p>\n');
  git(root, 'add', '-A');
  try {
    let gate = runGate({ root, staged: true });
    assert.equal(row(gate, 'trace').ok, false);
    assert.match(row(gate, 'trace').text, /S3: 2 MUST, 2 missing \(R-01, R-06\)/);
    write(root, 'docs/MANUAL-CHECKS.md', '- [ ] R-01: add Ana\n- [ ] R-06: empty state\n');
    git(root, 'add', '-A');
    gate = runGate({ root, staged: true });
    assert.equal(row(gate, 'trace').ok, true, row(gate, 'trace').text);
    gate = runGate({ root, staged: true, strict: true });
    assert.equal(row(gate, 'trace').ok, false);
    assert.match(row(gate, 'trace').text, /strict: manual checks must be \[x\]/);
  } finally {
    cleanup(root);
  }
});

test('commit message: bad format, unknown ID', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    let gate = runGate({ root, staged: true, only: 'commit', message: 'fix stuff' });
    assert.equal(gate.rows.length, 1);
    assert.match(gate.lines[0], /"fix stuff" must look like S<n>: what changed \(R-xx, R-yy\)/);
    gate = runGate({ root, staged: true, only: 'commit', message: 'S1: x (R-01..R-09)' });
    assert.match(gate.lines[0], /uses R-07, R-08, R-09, not in docs\/REQUIREMENTS\.md/);
  } finally {
    cleanup(root);
  }
});

test('no slice active: docs-only staged commit passes with any message, code outside docs fails', () => {
  const root = makeProject();
  write(root, 'docs/REQUIREMENTS.md', '# Requirements\nStatus: approved.\n\n### R-01 [MUST] Create a customer\n');
  git(root, 'add', '-A');
  try {
    let gate = runGate({ root, staged: true, message: 'Requirements approved' });
    assert.ok(gate.ok, gate.lines.join('\n'));
    assert.match(row(gate, 'trace').text, /docs only, not checked/);
    assert.match(row(gate, 'commit').text, /ok \(docs only, no slice active\)/);
    write(root, 'src/a.js', 'export const a = 1;\n');
    git(root, 'add', '-A');
    gate = runGate({ root, staged: true, message: 'Requirements approved' });
    assert.ok(!gate.ok);
    assert.match(row(gate, 'scope').text, /no slice active: src\/a\.js is outside docs\//);
    assert.match(row(gate, 'commit').text, /must look like/);
  } finally {
    cleanup(root);
  }
});

test('setup files from init are accepted in a no-slice commit', () => {
  const root = makeProject();
  write(root, '.githooks/pre-commit', '#!/bin/sh\n');
  write(root, '.github/workflows/gate.yml', 'name: gate\n');
  git(root, 'add', '-A');
  try {
    const gate = runGate({ root, staged: true, message: 'Kit hooks and CI gate' });
    assert.ok(gate.ok, gate.lines.join('\n'));
  } finally {
    cleanup(root);
  }
});

test('no plan and no requirements yet: tests only, PASS', () => {
  const root = makeProject({ plan: false, requirements: false });
  try {
    const gate = runGate({ root });
    assert.ok(gate.ok);
    assert.match(row(gate, 'tests').text, /no tests yet/);
    assert.match(row(gate, 'scope').text, /no plan yet/);
    assert.match(row(gate, 'trace').text, /no requirements yet/);
  } finally {
    cleanup(root);
  }
});

test('CLI: exit code, --message-file reads the subject, --root works from elsewhere', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  write(root, 'msg.txt', 'S1: customer rules (R-01, R-02)\n\n# comment\n');
  try {
    const pass = runTool('gate.mjs', ['--staged', '--only', 'commit', '--message-file', `${root}/msg.txt`, '--root', root], process.cwd());
    assert.equal(pass.status, 0, pass.stdout);
    assert.match(pass.stdout, /GATE PASS/);
    const fail = runTool('gate.mjs', ['--staged', '--message', 'nope'], root);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /GATE FAIL/);
  } finally {
    cleanup(root);
  }
});
