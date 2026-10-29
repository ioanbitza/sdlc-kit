import test from 'node:test';
import assert from 'node:assert/strict';
import { trace, markdown, titleIds } from './trace.mjs';
import { expandIds } from './scope.mjs';
import { makeProject, cleanup, write, runTool, git, PLAN } from './fixtures.mjs';
import { runGate } from './gate.mjs';

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

test('commits column: only S<n>: commits count, and ADR-003 is not R-03', () => {
  const root = makeProject({ test: 'green' });
  try {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'S1: customer rules (R-01, R-02)');
    write(root, 'docs/PLAN.md', PLAN + '\nmore\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Plan: decisions answered (ADR-003 to ADR-005)');
    write(root, 'docs/notes.md', 'x');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: FIX FIRST (COR-1 on R-05)');
    write(root, 'src/domain/customers.js', 'export const add = () => 1; // fix\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'S1: fix F-01 (R-02)');
    const md = markdown(root);
    const rowOf = (id) => md.split('\n').find((l) => l.startsWith(`| ${id}`));
    assert.match(rowOf('R-01'), /\| [0-9a-f]{7} \| /);
    assert.match(rowOf('R-02'), /\| [0-9a-f]{7}, [0-9a-f]{7} \| /, 'the slice commit and its fix');
    assert.match(rowOf('R-03'), /\| R-03 \(LATER\) \| Tax \|  \|  \| /, 'ADR-003 is not R-03');
    assert.match(rowOf('R-05'), /\| R-05 \| Line total is exact \|  \|  \| /, 'a review commit does not count');
    assert.deepEqual(expandIds('ADR-003 to ADR-005'), []);
    assert.deepEqual(expandIds('R-03, ADR-004'), ['R-03']);
  } finally {
    cleanup(root);
  }
});

test('an id counts only in a test title, not in a comment, a describe label or a helper string', () => {
  const source = `// covers R-01 R-02 R-04 R-05 R-06
import test from 'node:test';
const label = 'R-04 helper';
describe('R-05 group', () => {});
test('R-01 adds a customer', () => {});
it("R-02 rejects an empty name", () => {});
test(\`R-06 empty state\`, () => {});
`;
  assert.deepEqual([...titleIds(source)].sort(), ['R-01', 'R-02', 'R-06']);
  const root = makeProject();
  write(root, 'tests/all.test.js', '// R-01 R-02 R-04 R-05 R-06\nimport test from "node:test";\ntest("something else", () => {});\n');
  try {
    const result = trace({ root, listed: true });
    assert.equal(result.missing, 5, 'comments do not cover anything');
  } finally {
    cleanup(root);
  }
});

test('a manual check line without a requirement id (- [ ] UX: ...) is neither a row nor an orphan, in the trace and in the strict gate', () => {
  const root = makeProject({ test: 'green' });
  write(root, 'docs/MANUAL-CHECKS.md', '- [ ] R-04: a line is added\n- [ ] UX: keyboard-only path through the form\n- [x] UX: 320 px width, no horizontal scroll\n- [ ] R-05: the total updates\n- [x] R-06: empty state shows\n');
  try {
    const listed = trace({ root, listed: true });
    assert.deepEqual(listed.orphans, []);
    assert.equal(listed.manualListed, 3, 'ids only: R-04, R-05, R-06');
    assert.equal(listed.manualPassed, 1);
    assert.equal(listed.rows.find((x) => x.id === 'R-04').how, 'manual check listed');
    const strict = trace({ root });
    assert.deepEqual(strict.orphans, []);
    assert.equal(strict.rows.find((x) => x.id === 'R-06').how, 'manual check passed');
    assert.equal(strict.rows.find((x) => x.id === 'R-04').how, 'MISSING', 'strict wants [x] on the R- lines; a UX line changes nothing');
    const md = markdown(root);
    assert.match(md, /Manual checks: 3 listed, 1 passed/);
    assert.ok(!md.includes('UX'), 'the matrix has a row per requirement, not per UX line');
    const gate = runGate({ root, strict: true, only: ['trace'] });
    assert.equal(gate.rows[0].text, '5 MUST, 2 missing (R-04, R-05, strict: manual checks must be [x]), 0 orphan IDs');
  } finally {
    cleanup(root);
  }
});
