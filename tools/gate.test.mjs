import test from 'node:test';
import assert from 'node:assert/strict';
import { runGate, COMMIT_MESSAGE_PATTERN } from './gate.mjs';
import { makeProject, cleanup, write, git, runTool } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const row = (gate, label) => gate.rows.find((r) => r.label === label);

test('commit message pattern: lists, ranges, rejects the rest', () => {
  assert.ok(COMMIT_MESSAGE_PATTERN.test('S1: customer rules (R-01, R-02)'));
  assert.ok(COMMIT_MESSAGE_PATTERN.test('S3: money, lines and totals (R-11..R-17)'));
  assert.ok(COMMIT_MESSAGE_PATTERN.test('S3: mixed (R-04, R-11..R-13, R-20)'));
  assert.ok(!COMMIT_MESSAGE_PATTERN.test('fix stuff'));
  assert.ok(!COMMIT_MESSAGE_PATTERN.test('S1: no ids'));
  assert.ok(!COMMIT_MESSAGE_PATTERN.test('S1: bad id (R-1)'));
});

test('staged, green tests, files in plan, good message: PASS with the 8-line table', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const gate = runGate({ root, staged: true, message: 'S1: customer rules (R-01, R-02)' });
    assert.ok(gate.ok, gate.lines.join('\n'));
    assert.equal(gate.lines.length, 8, gate.lines.join('\n'));
    assert.match(gate.lines[0], /^gate {5}tests {4}2 passed, 0 failed$/);
    assert.match(gate.lines[1], /^gate {5}scope {4}S1: 2 files staged, all in plan$/);
    assert.match(gate.lines[2], /^gate {5}trace {4}S1: 2 MUST, 0 missing, 0 orphan IDs$/);
    assert.match(gate.lines[3], /^gate {5}contract 1 approved document intact/);
    assert.match(gate.lines[4], /^gate {5}secrets {2}2 files clean$/);
    assert.match(gate.lines[5], /^gate {5}deps {5}no dependency file changed$/);
    assert.match(gate.lines[6], /^gate {5}commit {3}"S1: customer rules \(R-01, R-02\)" ok$/);
    assert.equal(gate.lines[7], 'GATE PASS');
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
  const root = makeProject({ approved: false });
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

const REVIEW = (sha, verdict) => `# Review, cycle 1\nReviewed: ${sha} (all)   Date: 2026-10-26\n\n## Verdict: ${verdict}\nNext: x\n`;

test('review line: absent by default, a warning with --review, a failure with --strict', () => {
  const root = makeProject({ test: 'green' });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'S1: customers (R-01, R-02)');
  try {
    assert.ok(!runGate({ root }).rows.some((r) => r.label === 'review'));
    let gate = runGate({ root, review: true, only: ['review'] });
    assert.ok(gate.ok);
    assert.equal(row(gate, 'review').warn, true);
    assert.match(gate.lines.find((l) => l.includes('review')), /^gate {5}review {3}none \(run \/sdlc-kit:review-change\) {3}<- WARN$/);
    gate = runGate({ root, strict: true, only: ['review'] });
    assert.ok(!gate.ok);
    assert.match(row(gate, 'review').text, /^none/);

    const head = git(root, 'rev-parse', '--short=7', 'HEAD');
    write(root, 'docs/REVIEW.md', REVIEW(head, 'MERGE'));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: MERGE');
    gate = runGate({ root, review: true, only: ['review'] });
    assert.equal(row(gate, 'review').text, `${head} ok, verdict MERGE`);
    assert.equal(row(gate, 'review').warn, undefined);
    assert.ok(runGate({ root, strict: true, only: ['review'] }).ok, 'a docs-only review commit after the reviewed sha is fine');
    write(root, 'README.md', '# App\n');
    write(root, '.github/workflows/gate.yml', 'name: gate\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'README and CI');
    assert.equal(row(runGate({ root, review: true, only: ['review'] }), 'review').text, `${head} ok, verdict MERGE`);
    assert.ok(runGate({ root, strict: true, only: ['review'] }).ok, 'a README or CI commit after the reviewed sha changes no code');

    write(root, 'docs/REVIEW.md', REVIEW(head, 'FIX FIRST'));
    gate = runGate({ root, review: true, only: ['review'] });
    assert.ok(gate.ok);
    assert.equal(row(gate, 'review').warn, true);
    assert.equal(row(gate, 'review').text, `${head} ok, verdict FIX FIRST`);
    assert.ok(!runGate({ root, strict: true, only: ['review'] }).ok);
    write(root, 'docs/REVIEW.md', REVIEW(head, 'BUDGET: human decision'));
    assert.equal(row(runGate({ root, review: true, only: ['review'] }), 'review').text, `${head} ok, verdict BUDGET`);

    write(root, 'docs/REVIEW.md', REVIEW(head, 'MERGE'));
    write(root, 'src/domain/customers.js', 'export const add = () => 1; // changed\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'S1: fix F-01 (R-01)');
    gate = runGate({ root, review: true, only: ['review'] });
    assert.ok(gate.ok);
    assert.match(row(gate, 'review').text, new RegExp(`^${head} is 1 commit old \\([0-9a-f]+ S1: fix F-01 \\(R-01\\)\\): re-review needed$`));
    assert.ok(!runGate({ root, strict: true, only: ['review'] }).ok);

    write(root, 'docs/REVIEW.md', REVIEW('0000000', 'MERGE'));
    assert.match(row(runGate({ root, review: true, only: ['review'] }), 'review').text, /^0000000 is not in this repository: re-review needed$/);
    write(root, 'docs/REVIEW.md', '# Review\nno sha here\n');
    assert.match(row(runGate({ root, review: true, only: ['review'] }), 'review').text, /has no "Reviewed: <sha>" line/);
    const cli = runTool('gate.mjs', ['--review', '--only', 'review'], root);
    assert.equal(cli.status, 0);
    assert.match(cli.stdout, /gate {5}review {3}.*<- WARN\nGATE PASS/);
  } finally {
    cleanup(root);
  }
});

test('mutations line in strict mode only: a surviving planted defect fails, none planted passes, verifier-judged equivalents are excluded', () => {
  const root = makeProject({ test: 'green' });
  write(root, 'src/domain/money.js', 'export const cheap = (a, b) => a <= b;\n');
  write(root, 'tests/money.test.js', "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { cheap } from '../src/domain/money.js';\ntest('R-04 cheap', () => { assert.equal(cheap(1, 2), true); assert.equal(cheap(3, 2), false); });\n");
  try {
    assert.ok(!runGate({ root }).rows.some((r) => r.label === 'mutations'));
    let gate = runGate({ root, strict: true, only: ['mutations'] });
    assert.ok(!gate.ok);
    assert.match(row(gate, 'mutations').text, /^\d+ planted, \d+ caught, [1-9]\d* survived \(src\/domain\/money\.js:1 "<=" -> "<"/);
    assert.match(gate.lines[0], /^gate {5}mutations \d+ planted/);
    const survivors = runGate({ root, strict: true, only: ['mutations'] });
    const all = [...row(survivors, 'mutations').text.matchAll(/src\/domain\/money\.js:1 ("[^"]*") -> ("[^"]*")/g)].map((m) => ({ file: 'src/domain/money.js', line: 1, from: JSON.parse(m[1]), to: JSON.parse(m[2]), equivalent: true, why: 'judged' }));
    write(root, 'docs/review/2/verifier.json', JSON.stringify({ pass: true, confirmed: [], watchList: [], refuted: [], tradeoffs: [], survivors: all }) + '\nModel: opus\n');
    gate = runGate({ root, strict: true, only: ['mutations'] });
    assert.ok(!gate.ok, 'a verifier.json the clerk saved grants nothing by itself');
    write(root, 'docs/review/state.json', JSON.stringify({ cycle: 2, rendered: false, equivalent: all }));
    assert.ok(!runGate({ root, strict: true, only: ['mutations'] }).ok, 'an unrendered cycle grants nothing');
    write(root, 'docs/review/state.json', JSON.stringify({ cycle: 2, rendered: true, equivalent: all }));
    gate = runGate({ root, strict: true, only: ['mutations'] });
    assert.ok(gate.ok, row(gate, 'mutations').text);
    assert.match(row(gate, 'mutations').text, new RegExp(`${all.length} equivalent \\(verifier, cycle 2\\)$`), 'the equivalences the script recorded at render');
  } finally {
    cleanup(root);
  }
  const plain = makeProject({ plan: false, requirements: false });
  try {
    const gate = runGate({ root: plain, strict: true, only: ['mutations'] });
    assert.ok(gate.ok);
    assert.match(row(gate, 'mutations').text, /^0 planted, 0 caught, 0 survived/);
  } finally {
    cleanup(plain);
  }
});

test('gate rows: contract, secrets, deps, slice size, ci', async () => {
  const { runGate, SECRET_SHAPES } = await import('./gate.mjs');
  const { write, git } = await import('./fixtures.mjs');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = makeProject({ slice: 'S1', test: 'green' });
  try {
    const row = (r, label) => r.rows.find((x) => x.label === label);
    let g = runGate({ root });
    assert.ok(row(g, 'contract').ok);
    assert.match(row(g, 'contract').text, /1 approved document intact/);
    assert.ok(row(g, 'secrets').ok);
    assert.equal(row(g, 'deps').text, 'no dependency file changed');
    assert.equal(row(g, 'slice'), undefined, 'two files is a small slice');
    assert.equal(row(g, 'ci'), undefined, 'ci is a ship and strict row');

    write(root, 'src/domain/customers.js', 'export const add = () => 1;\nconst token = "ghp_' + 'a'.repeat(40) + '";\n');
    g = runGate({ root });
    assert.ok(!row(g, 'secrets').ok);
    assert.match(row(g, 'secrets').text, /adds a GitHub token/);
    write(root, 'src/domain/customers.js', 'export const add = () => 1;\n');
    assert.ok(SECRET_SHAPES.some(([re]) => re.test('password = "hunter2hunter2"')));
    assert.ok(!SECRET_SHAPES.some(([re]) => re.test('password = ""')));

    write(root, 'package.json', '{"dependencies":{"left-pad":"1.0.0"}}');
    g = runGate({ root });
    assert.ok(!row(g, 'deps').ok);
    assert.match(row(g, 'deps').text, /human decision \(ADR-001\), not a S1 change/);

    write(root, 'docs/REQUIREMENTS.md', readFileSync(join(root, 'docs/REQUIREMENTS.md'), 'utf8') + '### R-09 [LATER] Slipped in\n');
    g = runGate({ root });
    assert.ok(!row(g, 'contract').ok);
    assert.match(row(g, 'contract').text, /docs\/REQUIREMENTS\.md changed in the working tree after its approval/);
  } finally {
    cleanup(root);
  }
  const idle = makeProject();
  try {
    const row = (r, label) => r.rows.find((x) => x.label === label);
    let g = runGate({ root: idle, review: true });
    assert.ok(row(g, 'ci').warn);
    assert.match(row(g, 'ci').text, /gate\.yml missing/);
    write(idle, '.github/workflows/gate.yml', '      - uses: actions/checkout@v4\n        with:\n          repository: ioanbitza/sdlc-kit\n          ref: main\n          path: .sdlc-kit\n');
    g = runGate({ root: idle, review: true });
    assert.match(row(g, 'ci').text, /not a full 40-hex sha/);
    assert.ok(!runGate({ root: idle, strict: true }).rows.find((x) => x.label === 'ci').ok, 'strict fails on an unpinned kit');
    write(idle, '.github/workflows/gate.yml', `      - uses: actions/checkout@v4\n        with:\n          repository: ioanbitza/sdlc-kit\n          ref: ${'a'.repeat(40)}\n          path: .sdlc-kit\n`);
    g = runGate({ root: idle, review: true });
    assert.ok(row(g, 'ci').ok && !row(g, 'ci').warn);
    write(idle, 'package.json', '{}');
    g = runGate({ root: idle });
    assert.ok(row(g, 'deps').ok && row(g, 'deps').warn, 'outside a slice a dependency change is a warning');
    write(idle, 'docs/PLAN.md', '# Plan\n\n## S1 Big\n**Goal:** x. **Covers:** R-01.\n**Files:** `a.js`, `b.js`, `c.js`, `d.js`, `e.js`, `f.js`, `g.js`\n');
    write(idle, '.sdlc/slice', 'S1\n');
    g = runGate({ root: idle });
    assert.match(row(g, 'slice').text, /S1 names 7 files, more than the 6/);
  } finally {
    cleanup(idle);
  }
});

test('init pins the kit commit into the CI workflow', async () => {
  const { init, kitHead } = await import('./init.mjs');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = makeProject();
  try {
    const r = init(root);
    assert.ok(r.ok, r.lines.join('\n'));
    const sha = kitHead();
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.match(readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8'), new RegExp(`ref: ${sha}`));
    assert.ok(r.lines.some((l) => l.includes(`kit pinned to ${sha.slice(0, 7)}`)));
  } finally {
    cleanup(root);
  }
});

test('ci pin: the ref is read inside the kit checkout step only; a documented placeholder is not a secret', async () => {
  const { kitCheckoutRef, KNOWN_PLACEHOLDERS, SECRET_SHAPES } = await import('./gate.mjs');
  const sha = 'b'.repeat(40);
  const pinned = `steps:\n  - uses: actions/checkout@v4\n    with:\n      fetch-depth: 0\n  - uses: actions/checkout@v4\n    with:\n      repository: ioanbitza/sdlc-kit\n      ref: ${sha}\n      path: .sdlc-kit\n`;
  assert.equal(kitCheckoutRef(pinned), sha);
  const elsewhere = `steps:\n  - uses: actions/checkout@v4\n    with:\n      ref: ${sha}\n  - uses: actions/checkout@v4\n    with:\n      repository: ioanbitza/sdlc-kit\n      path: .sdlc-kit\n  - name: x\n    with:\n      ref: main\n`;
  assert.equal(kitCheckoutRef(elsewhere), null, 'a ref of another step does not count');
  assert.equal(kitCheckoutRef(`      ref: ${sha}\n      repository: ioanbitza/sdlc-kit\n`), sha, 'ref before repository in the same block');
  assert.ok(KNOWN_PLACEHOLDERS.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(SECRET_SHAPES.some(([re]) => re.test('AKIAIOSFODNN7EXAMPLE')), 'the shape matches, the placeholder list is what exempts it');
});
