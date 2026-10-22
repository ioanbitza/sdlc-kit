import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, expandIds, allowedScope, isInScope, toProjectPath, isHumanOnly } from './scope.mjs';
import { makeProject, cleanup, runTool, PLAN } from './fixtures.mjs';

test('expandIds handles lists, "to" ranges and ".." ranges', () => {
  assert.deepEqual(expandIds('R-01, R-03'), ['R-01', 'R-03']);
  assert.deepEqual(expandIds('R-11 to R-13'), ['R-11', 'R-12', 'R-13']);
  assert.deepEqual(expandIds('R-11..R-12, R-20'), ['R-11', 'R-12', 'R-20']);
  assert.deepEqual(expandIds('R-04 (data), R-07'), ['R-04', 'R-07']);
  assert.deepEqual(expandIds(''), []);
});

test('parsePlan reads slices, backticked files and covered IDs', () => {
  const plan = parsePlan(PLAN);
  assert.deepEqual([...plan.keys()], ['S1', 'S2', 'S3']);
  assert.deepEqual(plan.get('S1').files, ['src/domain/customers.js', 'tests/customers.test.js']);
  assert.deepEqual(plan.get('S1').covers, ['R-01', 'R-02']);
  assert.deepEqual(plan.get('S2').covers, ['R-04', 'R-05']);
  assert.equal(plan.get('S3').title, 'Customers screen (UI)');
  assert.deepEqual(plan.get('S3').covers, ['R-01', 'R-06']);
});

test('toProjectPath makes absolute and ./ paths relative to the root', () => {
  assert.equal(toProjectPath('/p/app', '/p/app/src/a.js'), 'src/a.js');
  assert.equal(toProjectPath('/p/app', './docs/x.md'), 'docs/x.md');
  assert.equal(toProjectPath('/p/app', 'index.html'), 'index.html');
});

test('allowedScope: active slice gives its files plus docs/MANUAL-CHECKS.md', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const scope = allowedScope(root);
    assert.equal(scope.slice, 'S1');
    assert.deepEqual(scope.files, ['src/domain/customers.js', 'tests/customers.test.js', 'docs/MANUAL-CHECKS.md']);
    assert.ok(isInScope('src/domain/customers.js', scope));
    assert.ok(isInScope('docs/MANUAL-CHECKS.md', scope));
    assert.ok(!isInScope('index.html', scope));
    assert.ok(!isInScope('docs/PLAN.md', scope));
  } finally {
    cleanup(root);
  }
});

test('allowedScope: no slice allows docs/** only', () => {
  const root = makeProject();
  try {
    const scope = allowedScope(root);
    assert.equal(scope.slice, null);
    assert.ok(isInScope('docs/PLAN.md', scope));
    assert.ok(!isInScope('src/a.js', scope));
  } finally {
    cleanup(root);
  }
});

test('allowedScope: a marker for a slice the plan lacks is an error', () => {
  const root = makeProject({ slice: 'S9' });
  try {
    const scope = allowedScope(root);
    assert.match(scope.error, /no slice S9/);
    assert.ok(!isInScope('src/a.js', scope));
  } finally {
    cleanup(root);
  }
});

test('isHumanOnly: AGENTS.md, CLAUDE.md, docs/decisions, .sdlc and approved requirements', () => {
  const root = makeProject();
  try {
    assert.ok(isHumanOnly(root, 'AGENTS.md'));
    assert.ok(isHumanOnly(root, 'CLAUDE.md'));
    assert.ok(isHumanOnly(root, 'docs/decisions/ADR-002.md'));
    assert.ok(isHumanOnly(root, '.sdlc/slice'));
    assert.ok(isHumanOnly(root, 'docs/REQUIREMENTS.md'));
    assert.equal(isHumanOnly(root, 'docs/PLAN.md'), null);
  } finally {
    cleanup(root);
  }
});

test('isHumanOnly: draft requirements may still be edited', () => {
  const root = makeProject({ approved: false });
  try {
    assert.equal(isHumanOnly(root, 'docs/REQUIREMENTS.md'), null);
  } finally {
    cleanup(root);
  }
});

test('CLI prints the slice files, fails on an unknown slice', () => {
  const root = makeProject();
  try {
    const ok = runTool('scope.mjs', ['S2'], root);
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /src\/domain\/lines\.js\ntests\/lines\.test\.js/);
    const bad = runTool('scope.mjs', ['S9', '--root', root], root);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /no slice S9/);
  } finally {
    cleanup(root);
  }
});
