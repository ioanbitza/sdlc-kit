import test from 'node:test';
import assert from 'node:assert/strict';
import { trace, markdown } from './trace.mjs';
import { makeProject, cleanup, write, runTool, git } from './fixtures.mjs';

test('strict: a MUST with a test passes, one with only a listed manual check is missing', () => {
  const root = makeProject({ test: 'green' });
  write(root, 'docs/MANUAL-CHECKS.md', '- [ ] R-06: empty state shows\n- [x] R-04: a line is added\n');
  try {
    const r = trace({ root });
    assert.equal(r.must, 5);
    assert.equal(r.rows.find((x) => x.id === 'R-01').how, 'test: customers.test.js');
    assert.equal(r.rows.find((x) => x.id === 'R-04').how, 'manual check passed');
    assert.equal(r.rows.find((x) => x.id === 'R-06').how, 'MISSING');
    assert.equal(r.missing, 2);
    assert.ok(!r.ok);
  } finally {
    cleanup(root);
  }
});

test('--listed: a listed manual check counts', () => {
  const root = makeProject({ test: 'green' });
  write(root, 'docs/MANUAL-CHECKS.md', '- [ ] R-06: empty state shows\n');
  try {
    const r = trace({ root, listed: true });
    assert.equal(r.rows.find((x) => x.id === 'R-06').how, 'manual check listed');
  } finally {
    cleanup(root);
  }
});

test('--slice limits the rows to the slice, orphan IDs are still reported', () => {
  const root = makeProject({ test: 'green' });
  write(root, 'tests/other.test.js', "test('R-99 ghost', () => {});\n");
  try {
    const r = trace({ root, slice: 'S1' });
    assert.deepEqual(r.rows.map((x) => x.id), ['R-01', 'R-02']);
    assert.equal(r.missing, 0);
    assert.deepEqual(r.orphans, ['R-99']);
    assert.ok(!r.ok);
    assert.match(trace({ root, slice: 'S9' }).sliceError, /S9/);
  } finally {
    cleanup(root);
  }
});

test('CLI keeps the v1 output and exit codes', () => {
  const root = makeProject({ test: 'green' });
  try {
    const r = runTool('trace.mjs', ['--slice', 'S1'], root);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /R-01\s+test: customers\.test\.js\s+Create a customer/);
    assert.match(r.stdout, /2 MUST, 0 missing, 0 orphan IDs/);
    const all = runTool('trace.mjs', [], root);
    assert.equal(all.status, 1);
    assert.match(all.stdout, /5 MUST, 3 missing/);
  } finally {
    cleanup(root);
  }
});

test('no requirements file: exit 1 with a clear line', () => {
  const root = makeProject({ requirements: false });
  try {
    const r = runTool('trace.mjs', [], root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /No requirements found/);
  } finally {
    cleanup(root);
  }
});

test('--markdown: a matrix with tests, commits and manual check status', () => {
  const root = makeProject({ test: 'green' });
  write(root, 'docs/MANUAL-CHECKS.md', '- [x] R-06: empty state shows\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'S1: customers (R-01, R-02)');
  try {
    const md = markdown(root);
    assert.match(md, /\| Requirement \| Title \| Tests \| Commits \| Manual check \|/);
    assert.match(md, /\| R-01 \| Create a customer \| customers\.test\.js \| [0-9a-f]{7,} \| none \|/);
    assert.match(md, /\| R-06 \| Useful empty states \|  \|  \| passed \|/);
    assert.match(md, /\| R-03 \(LATER\) \| Tax \|/);
    assert.match(md, /Manual checks: 1 listed, 1 passed/);
  } finally {
    cleanup(root);
  }
});
