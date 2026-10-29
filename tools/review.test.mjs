import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { recordDecision } from './internal/record-decision.mjs';
import { extractJson, findingProblem, mergeFindings, placeAll, verdictOf, classesFor, start, check, render, decide, readState, readDecisions, verifierProblems, realSurvivors, survivorLines, deriveMaxIds, expandFids, wrap, ruleProblem } from './review.mjs';
import { makeProject, cleanup, write, git, runTool } from './fixtures.mjs';

const finding = (id, extra = {}) => ({
  id,
  class: id.startsWith('COR') ? 'correctness' : id.startsWith('SEC') ? 'security' : id.startsWith('DOM') ? 'domain' : id.startsWith('LEG') ? 'legal' : 'contract',
  ...(id.startsWith('DOM') ? { rule: 'D-01' } : id.startsWith('LEG') ? { rule: 'LD-01' } : {}),
  severity: 'blocking',
  file: 'src/domain/customers.js',
  line: 3,
  what_breaks: `${id} breaks something`,
  requirement: 'R-01',
  evidence: `node -e "..." -> wrong for ${id}`,
  proven: true,
  ...extra,
});

const asFinder = (list, checklist = 'items 1-8 ran; fired: 1; not run: none') => `${JSON.stringify(list)}\nChecklist: ${checklist}\n`;

/** A measured mutation result, injected so the tests do not depend on the fixture's real sites. */
const MEASURED = (survivors = []) => ({ baselineOk: true, planted: 4, caught: 4 - survivors.length, survived: survivors.length, survivors, lines: [`mutations  4 planted, ${4 - survivors.length} caught, ${survivors.length} survived`] });
const SURVIVOR = { file: 'src/domain/customers.js', line: 3, from: '<=', to: '<', operator: '<= -> <' };

/** A committed project with green tests, ready for a review. */
function reviewable() {
  const root = makeProject({ test: 'green' });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'S1: customer rules (R-01, R-02)');
  return root;
}

function saveFinders(root, cycle, { cor = [], sec = [], con = [], leg = [] } = {}) {
  write(root, `docs/review/${cycle}/finder-correctness.json`, asFinder(cor));
  write(root, `docs/review/${cycle}/finder-security.json`, asFinder(sec));
  write(root, `docs/review/${cycle}/finder-contract.json`, asFinder(con));
  write(root, `docs/review/${cycle}/finder-legal.json`, asFinder(leg));
}

const KIT_LEGAL = 'sdlc-kit/skills/legal-data-protection/SKILL.md, sdlc-kit/skills/legal-e-invoicing/SKILL.md, sdlc-kit/skills/legal-licenses/SKILL.md';

function saveVerifier(root, cycle, verdict, lines = 'Model: opus\nGate: GATE PASS, 2 passed, 0 failed\nMutations: 4/4, survived: none\n', captured = true) {
  write(root, `docs/review/${cycle}/verifier.json`, JSON.stringify(verdict));
  write(root, `docs/review/${cycle}/verifier.txt`, lines);
  if (captured) write(root, `docs/review/${cycle}/verifier.captured.txt`, JSON.stringify(verdict) + '\n' + lines);
  else rmSync(join(root, `docs/review/${cycle}/verifier.captured.txt`), { force: true });
}

test('extractJson finds the array or object inside prose and keeps the status lines', () => {
  const r = extractJson('Here you go:\n[{"id":"COR-1"}]\nChecklist: items 1-8 ran');
  assert.deepEqual(r.json, [{ id: 'COR-1' }]);
  assert.match(r.rest, /Checklist: items 1-8 ran/);
  assert.equal(extractJson('no json here').json, null);
  assert.match(extractJson('[{"id": }]').error, /does not parse/);
  assert.deepEqual(extractJson('{"pass":true,"confirmed":[]} Model: opus').json, { pass: true, confirmed: [] });
});

test('finder schema: every field, right types, id prefix, class and severity', () => {
  assert.equal(findingProblem(finding('COR-1'), 0), null);
  const { evidence, ...noEvidence } = finding('COR-1');
  assert.match(findingProblem(noEvidence, 1), /item 2 \(COR-1\) is missing "evidence"/);
  assert.match(findingProblem({ ...finding('COR-1'), evidence: 7 }, 0), /"evidence" must be a string/);
  assert.match(findingProblem({ ...finding('COR-1'), line: '14' }, 0), /"line" must be a number/);
  assert.match(findingProblem(finding('X-1'), 0), /id "X-1" must look like/);
  assert.match(findingProblem(finding('SEC-1', { class: 'perf' }), 0), /class "perf"/);
  assert.match(findingProblem(finding('SEC-1', { severity: 'major' }), 0), /severity "major"/);
  assert.match(verifierProblems({ pass: 'yes', confirmed: [], watchList: [], refuted: [], tradeoffs: [] })[0], /"pass" must be true or false/);
  assert.match(verifierProblems({ pass: false, confirmed: [{ id: 'COR-1', severity: 'blocking', file: 'a', what_breaks: 'b', evidence: 'c', level: 'cosmic' }], watchList: [], refuted: [], tradeoffs: [] })[0], /level "cosmic"/);
  assert.deepEqual(verifierProblems({ pass: true, confirmed: [], watchList: [], refuted: [], tradeoffs: [] }), []);
  const ok = (id) => ({ pass: false, confirmed: [{ id, severity: 'blocking', file: 'a', what_breaks: 'b', evidence: 'c', level: 'code' }], watchList: [], refuted: [], tradeoffs: [] });
  assert.deepEqual(verifierProblems(ok('F-01')), [], 'a carried F-id is accepted');
  assert.deepEqual(verifierProblems(ok('VER-2')), []);
  assert.deepEqual(verifierProblems(ok('cycle1/COR-1')), [], 'a cycle prefix is tolerated and mapped at placement');
  assert.match(verifierProblems(ok('X-1'))[0], /id must be COR-n, SEC-n, CON-n, DOM-n, LEG-n, VER-n or a carried F-nn/);
  const base = { pass: true, confirmed: [], watchList: [], refuted: [], tradeoffs: [] };
  assert.match(verifierProblems({ ...base, survivors: 'none' })[0], /"survivors" must be an array/);
  assert.match(verifierProblems({ ...base, survivors: [{ file: 'a', line: 1, from: 'x', to: 'y' }] })[0], /"equivalent" must be true or false/);
  assert.match(verifierProblems({ ...base, survivors: [{ file: 'a', line: 1, from: 'x', to: 'y', equivalent: true }] })[0], /needs "why"/);
  assert.deepEqual(verifierProblems({ ...base, survivors: [{ file: 'a', line: 1, from: 'x', to: 'y', equivalent: false }] }), []);
});

test('mergeFindings keeps every finding and renumbers a repeated id COR-7 -> COR-7a', () => {
  const merged = mergeFindings({ correctness: [finding('COR-7'), finding('COR-7'), finding('COR-7')], security: [finding('SEC-1')], contract: [] });
  assert.deepEqual(merged.findings.map((f) => f.id), ['COR-7', 'COR-7a', 'COR-7b', 'SEC-1']);
  assert.deepEqual(merged.renumbered, ['COR-7 -> COR-7a', 'COR-7 -> COR-7b']);
});

test('placeAll: every id exactly once; a missing id lands on the watch list, a double placement is kept once', () => {
  const byId = new Map([['COR-1', finding('COR-1')], ['SEC-1', finding('SEC-1')], ['CON-1', finding('CON-1')], ['CON-2', finding('CON-2')]]);
  const verdict = {
    pass: false,
    confirmed: [{ id: 'COR-1', severity: 'blocking', file: 'src/domain/customers.js', what_breaks: 'x', evidence: 'y', level: 'code', merged: ['CON-1'] }],
    watchList: [],
    refuted: [{ id: 'CON-1', evidence: 'placed twice' }],
    tradeoffs: [],
  };
  const placed = placeAll(verdict, ['COR-1', 'SEC-1', 'CON-1', 'CON-2'], byId);
  assert.deepEqual(placed.confirmed.map((c) => c.id), ['COR-1']);
  assert.deepEqual(placed.confirmed[0].merged, ['CON-1']);
  assert.deepEqual(placed.refuted, [], 'CON-1 stays merged into COR-1');
  assert.deepEqual(placed.watchList.map((w) => w.id).sort(), ['CON-2', 'SEC-1']);
  assert.equal(placed.watchList[0].why_unproven, 'verifier did not place it');
  assert.ok(placed.notes.some((n) => /CON-1 placed twice/.test(n)));
  assert.ok(placed.notes.some((n) => /SEC-1 was not placed by the verifier/.test(n)));
});

test('verdictOf: MERGE only with nothing blocking, no trade-off and no survivor; BUDGET at the end of cycle 2', () => {
  const none = { confirmed: [], tradeoffs: [] };
  assert.equal(verdictOf(none, { pass: true }, 1, '199 planted, 199 caught, 0 survived').verdict, 'MERGE');
  assert.equal(verdictOf(none, { pass: false }, 1, '4 planted, 4 caught, 0 survived').verdict, 'FIX FIRST');
  assert.equal(verdictOf(none, { pass: true }, 1, '199 planted, 185 caught, 14 survived').verdict, 'FIX FIRST');
  assert.equal(verdictOf(none, { pass: true }, 1, '4/3, survived: src/a.js:3 "<=" -> "<"').verdict, 'FIX FIRST', 'the old format still reads');
  assert.equal(verdictOf({ confirmed: [], tradeoffs: [{}] }, { pass: true }, 1, '').verdict, 'FIX FIRST');
  const blocking = { confirmed: [{ id: 'COR-1', severity: 'blocking' }], tradeoffs: [] };
  assert.equal(verdictOf(blocking, { pass: true }, 1, '').verdict, 'FIX FIRST');
  assert.equal(verdictOf(blocking, { pass: false }, 2, '').verdict, 'BUDGET');
  assert.equal(verdictOf({ confirmed: [{ id: 'COR-1', severity: 'advisory' }], tradeoffs: [] }, { pass: true }, 2, '4 planted, 4 caught, 0 survived').verdict, 'MERGE');
  assert.equal(verdictOf(none, { pass: true }, 2, '4 planted, 3 caught, 1 survived').verdict, 'BUDGET', 'last cycle: any remaining reason is BUDGET');
  assert.equal(verdictOf({ confirmed: [], tradeoffs: [{}] }, { pass: true }, 2, '').verdict, 'BUDGET');
  assert.equal(verdictOf(none, { pass: false }, 2, '').verdict, 'BUDGET');
  const eq = { pass: true, survivors: [{ file: 'a.js', line: 1, from: 'return null;', to: 'return undefined;', equivalent: true, why: 'same' }, { file: 'a.js', line: 2, from: '<=', to: '<', equivalent: false }] };
  assert.equal(realSurvivors(eq, '9 planted, 7 caught, 2 survived'), 1, 'the JSON wins over the line and counts only real survivors');
  assert.equal(verdictOf(none, eq, 1, '9 planted, 7 caught, 2 survived').verdict, 'FIX FIRST');
  assert.deepEqual(verdictOf(none, eq, 1, '').reasons, ['1 planted defect survived']);
  assert.equal(verdictOf(none, { pass: true, survivors: [eq.survivors[0]] }, 1, '9 planted, 8 caught, 1 survived').verdict, 'MERGE');
  assert.deepEqual(survivorLines(eq, {}), ['  survived (equivalent): a.js:1 "return null;" -> "return undefined;" (same)', '  survived: a.js:2 "<=" -> "<"']);
  assert.deepEqual(survivorLines({}, { survivors: ['a.js:2 "<=" -> "<"'] }), ['  survived: a.js:2 "<=" -> "<"']);
});

test('classesFor: cycle 1 runs all four, cycle 2 only the classes that fired', () => {
  assert.deepEqual(classesFor(1, null), ['correctness', 'security', 'contract', 'legal']);
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'COR-1', class: 'correctness' }], watchList: [{ id: 'SEC-2', class: 'security' }] }), ['correctness', 'security']);
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'VER-1' }], watchList: [] }), ['contract'], 'a verifier finding against the tests sends the contract finder');
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'COR-1', class: 'correctness', merged: ['CON-2'] }], watchList: [] }), ['correctness', 'contract']);
});

test('start: refuses a dirty tree, an active slice and cycle 3; records HEAD, scope and the brief', () => {
  const root = reviewable();
  try {
    write(root, 'docs/notes.md', 'x');
    assert.match(start(root).lines[0], /^Review refused: the working tree has uncommitted changes/);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'notes');
    write(root, '.sdlc/slice', 'S1\n');
    assert.match(start(root).lines[0], /^Review refused: S1 is still active/);
    write(root, '.sdlc/slice', '');
    assert.match(start(root, { cycle: 3 }).lines[0], /^BUDGET: human decision\. Two fix rounds ran/);
    assert.match(start(root, { cycle: 2 }).lines[0], /needs a rendered cycle 1/);
    const r = start(root);
    assert.ok(r.ok, r.lines.join('\n'));
    const head = git(root, 'rev-parse', 'HEAD');
    assert.match(r.lines[0], new RegExp(`^review {3}cycle 1 {3}HEAD ${head.slice(0, 7)} {3}scope all \\(3 commits, 2 files\\)`));
    assert.equal(r.lines[1], 'classes  correctness, security, contract, legal');
    assert.equal(r.lines[3], `legal    ${KIT_LEGAL}`, 'the kit ships the legal skills, so legal always runs');
    const state = readState(root);
    assert.equal(state.head, head);
    assert.deepEqual(state.files, ['src/domain/customers.js', 'tests/customers.test.js']);
    const brief = readFileSync(join(root, 'docs/review/1/brief.txt'), 'utf8');
    assert.match(brief, /^Review cycle 1\. Reviewed commit [0-9a-f]{7}; scope all\./);
    assert.match(brief, /Files in scope: src\/domain\/customers\.js, tests\/customers\.test\.js\./);
  } finally {
    cleanup(root);
  }
});

test('start on a branch: scope main..HEAD with the commit count and the changed files', () => {
  const root = reviewable();
  try {
    git(root, 'checkout', '-q', '-b', 'feature');
    write(root, 'src/domain/lines.js', 'export const total = () => 0;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'S2: lines (R-04)');
    const r = start(root);
    assert.match(r.lines[0], /scope main\.\.HEAD \(1 commit, 1 file\)/);
    assert.deepEqual(readState(root).files, ['src/domain/lines.js']);
  } finally {
    cleanup(root);
  }
});

test('check: a finder answer with a missing field or no Checklist line is a RE-ASK; good answers merge into findings.json', () => {
  const root = reviewable();
  try {
    assert.ok(start(root).ok);
    saveFinders(root, 1, { cor: [finding('COR-1')], con: [finding('CON-1')] });
    write(root, 'docs/review/1/finder-security.json', '[{"id":"SEC-1","class":"security"}]\nChecklist: ran\n');
    let r = check(root, 1);
    assert.equal(r.ok, false);
    assert.deepEqual(r.lines.filter((l) => l.startsWith('RE-ASK')), ['RE-ASK finder-security: item 1 (SEC-1) is missing "severity"']);
    write(root, 'docs/review/1/finder-security.json', '[]\n');
    r = check(root, 1);
    assert.match(r.lines.find((l) => l.startsWith('RE-ASK')), /an empty array needs the Checklist: line/);
    write(root, 'docs/review/1/finder-security.json', 'Nothing found.\n[]\nChecklist: items 1-8 ran; fired: none; not run: none\n');
    r = check(root, 1);
    assert.ok(r.ok, r.lines.join('\n'));
    const merged = JSON.parse(readFileSync(join(root, 'docs/review/1/findings.json'), 'utf8'));
    assert.deepEqual(merged.map((f) => f.id), ['COR-1', 'CON-1']);
    assert.equal(readFileSync(join(root, 'docs/review/1/finder-security.json'), 'utf8'), 'Nothing found.\n[]\nChecklist: items 1-8 ran; fired: none; not run: none\n', 'finder files stay verbatim');
    const cli = runTool('review.mjs', ['check', '--cycle', '1'], root);
    assert.equal(cli.status, 0, cli.stdout);
    assert.match(cli.stdout, /findings {2}2 in docs\/review\/1\/findings\.json/);
  } finally {
    cleanup(root);
  }
});

test('render: REVIEW.md with the Reviewed sha, routes from the plan, exactly-once placement, FIX FIRST', () => {
  const root = reviewable();
  try {
    assert.ok(start(root).ok);
    saveFinders(root, 1, {
      cor: [finding('COR-1', { file: 'src/domain/customers.js', line: 3 }), finding('COR-2', { file: 'src/domain/lines.js', line: 9, requirement: 'R-04' })],
      sec: [finding('SEC-1', { file: 'src/ui/main.js', severity: 'advisory', proven: false })],
      con: [finding('CON-1', { file: 'src/domain/customers.js', line: 12 }), finding('CON-2', { requirement: 'R-06' })],
    });
    saveVerifier(root, 1, {
      pass: false,
      confirmed: [
        { id: 'COR-2', class: 'correctness', severity: 'blocking', file: 'src/domain/lines.js', line: 9, what_breaks: 'total overflows', requirement: 'R-04', evidence: 'node -e -> Infinity', proven: true, rank: 1, level: 'code', merged: ['CON-1'] },
        { id: 'CON-2', class: 'contract', severity: 'blocking', file: 'docs/REQUIREMENTS.md', line: 0, what_breaks: 'R-06 can be read two ways', requirement: 'R-06', evidence: 'both readings quoted', proven: true, rank: 2, level: 'requirement' },
        { id: 'VER-1', class: 'contract', severity: 'blocking', file: 'tests/customers.test.js', line: 4, what_breaks: 'planted "<=" -> "<" in customers.js:3 survived', requirement: 'R-01', evidence: 'mutate.mjs', proven: true, rank: 3, level: 'code' },
      ],
      watchList: [{ id: 'SEC-1', class: 'security', severity: 'advisory', file: 'src/ui/main.js', line: 3, what_breaks: 'x', requirement: 'none', evidence: 'y', proven: false, why_unproven: 'no UI test', how_to_settle: 'probe in the browser' }],
      refuted: [],
      tradeoffs: [],
    }, 'Model: claude-opus-5-5\nGate: GATE PASS, 2 passed, 0 failed\nMutations: 9 planted, 9 caught, 0 survived\n');
    const r = render(root, 1, { date: '2026-10-26', mutation: MEASURED([SURVIVOR]) });
    assert.ok(r.ok, r.lines.join('\n'));
    assert.equal(r.verdict, 'FIX FIRST');
    const text = readFileSync(join(root, 'docs/REVIEW.md'), 'utf8');
    const head = git(root, 'rev-parse', 'HEAD').slice(0, 7);
    assert.match(text, new RegExp(`^# Review, cycle 1\\nReviewed: ${head} \\(all\\)   Date: 2026-10-26\\n`));
    assert.match(text, /Finders: correctness, security, contract, legal \(opus\)   Verifier: opus \(reported\)   Author: sonnet\n/, 'finder model from the agent files, verifier model as reported, normalised');
    assert.match(text, /Gate: GATE (PASS|FAIL), tests 2 passed, 0 failed   Mutations: 4 planted, 3 caught, 1 survived\n {2}survived: src\/domain\/customers\.js:3 "<=" -> "<"\n/, 'Gate and Mutations are measured by the script, not copied from the verifier');
    assert.match(text, /verifier reported "Mutations: 9 planted, 9 caught, 0 survived";\s+measured now: 4 planted, 3 caught,\s+1\s+survived/);
    assert.match(text, /## Confirmed \(3\)/);
    assert.match(text, /F-01  COR-2  blocking  code  src\/domain\/lines\.js:9  R-04  total overflows/);
    assert.match(text, /merged: CON-1\n {6}route: reopen S2, S1/, 'the merged finding lives in S1');
    assert.match(text, /F-02  CON-2  blocking  requirement  docs\/REQUIREMENTS\.md  R-06/);
    assert.match(text, /route: question to the human: Q-01 in docs\/REQUIREMENTS\.md/);
    assert.match(text, /F-03  VER-1 {2}blocking {2}code {2}tests\/customers\.test\.js:4 {2}R-01 [\s\S]*?\n {6}route: reopen S1/);
    assert.match(text, /## Watch list \(2\)/, 'SEC-1 from the verifier plus COR-1 the verifier forgot');
    assert.match(text, /COR-1 [^\n]*\n[^\n]*\n {6}why unproven: verifier did not place it/);
    assert.match(text, /## Verdict: FIX FIRST\n/);
    assert.match(text, /Why: 3 blocking findings confirmed; 1 planted defect survived\./);
    assert.match(text, /Routes: reopen S2, S1 \(F-01\); question to the human: Q-01 in docs\/REQUIREMENTS\.md \(F-02\);\s+reopen S1\s+\(F-03\)\./);
    assert.match(text, /Next: say accept or reject for each F-id, then: node review\.mjs decide --cycle 1 --accept <F-ids>\s+--reject <F-ids> --note "<your words>"\n {6}\/sdlc-kit:implement-slice S1 F-01 F-03\n {6}\/sdlc-kit:implement-slice S2 F-01\n {6}then \/sdlc-kit:review-change --cycle 2\./, 'one line per slice, an F-id under every owning slice');
    assert.match(text, /^correctness: items 1-8 ran; fired: 1; not run: none$/m);
    assert.ok(!text.includes(String.fromCharCode(0x2014)), 'no em dash');
    assert.ok(text.split('\n').every((l) => l.length <= 100 || !/\s/.test(l.slice(100))), 'rows wrap at 100 characters');
    const state = readState(root);
    assert.equal(state.rendered, true);
    assert.deepEqual(state.confirmed.map((c) => c.id), ['COR-2', 'CON-2', 'VER-1']);
    assert.deepEqual(state.confirmed.map((c) => c.fid), ['F-01', 'F-02', 'F-03']);
    assert.equal(state.nextF, 4);
    assert.deepEqual(state.maxIds, { COR: 2, SEC: 1, CON: 2, VER: 1 });
    assert.ok(r.lines.some((l) => l.startsWith('## Verdict: FIX FIRST')));
    assert.ok(r.lines.at(-1).startsWith('Not checked:'), 'render returns the verdict block');
  } finally {
    cleanup(root);
  }
});

test('wrap and expandFids', () => {
  const long = 'F-01  COR-2  blocking  code  src/domain/lines.js:9  R-04  ' + 'word '.repeat(30);
  const lines = wrap(long.trim());
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.length <= 100));
  assert.ok(lines.slice(1).every((l) => l.startsWith('      ')));
  assert.deepEqual(wrap('F-01  COR-2  blocking  code'), ['F-01  COR-2  blocking  code'], 'inner spacing is kept');
  assert.equal(wrap('      evidence: ' + 'x'.repeat(120))[0], '      evidence:', 'a word longer than the width goes on its own line');
  assert.deepEqual(expandFids('F-01,F-02'), ['F-01', 'F-02']);
  assert.deepEqual(expandFids('F-03..F-05, F-9'), ['F-03', 'F-04', 'F-05', 'F-09']);
  assert.deepEqual(expandFids(undefined), []);
});

test('decide: every confirmed F-id in exactly one list, written to decisions.json', () => {
  const root = reviewable();
  try {
    assert.ok(start(root).ok);
    saveFinders(root, 1, { cor: [finding('COR-1'), finding('COR-2', { severity: 'advisory' })], con: [finding('CON-1')] });
    saveVerifier(root, 1, { pass: false, confirmed: [
      { id: 'COR-1', severity: 'blocking', file: 'src/domain/customers.js', line: 3, what_breaks: 'a', evidence: 'e', level: 'code' },
      { id: 'COR-2', severity: 'advisory', file: 'src/domain/customers.js', line: 4, what_breaks: 'b', evidence: 'e', level: 'code' },
      { id: 'CON-1', severity: 'blocking', file: 'src/domain/customers.js', line: 5, what_breaks: 'c', evidence: 'e', level: 'code' },
    ], watchList: [], refuted: [], tradeoffs: [] });
    assert.match(decide(root, 1, { accept: 'F-01' }).lines[0], /^Decision refused: review\.mjs decide records a decision only when the person at the terminal/, 'no terminal, no decision');
    assert.match(recordDecision(root, 1, { accept: 'F-01' }).lines[0], /^Decision refused: cycle 1 is not the rendered cycle/);
    assert.equal(render(root, 1, { mutation: MEASURED() }).verdict, 'FIX FIRST');
    assert.match(recordDecision(root, 1, { accept: 'F-01', reject: 'F-03' }).lines[0], /^Decision refused: F-02 not decided; every confirmed F-id goes in --accept or --reject\./);
    assert.match(recordDecision(root, 1, { accept: 'F-01,F-02', reject: 'F-02,F-03' }).lines[0], /^Decision refused: F-02 in both lists/);
    assert.match(recordDecision(root, 1, { accept: 'F-01,F-09', reject: 'F-02..F-03' }).lines[0], /^Decision refused: F-09 is not confirmed in cycle 1 \(confirmed: F-01, F-02, F-03\)\./);
    const d = recordDecision(root, 1, { accept: 'F-01', reject: 'F-02..F-03', note: 'F-03 is a theoretical limit' });
    assert.ok(d.ok, d.lines.join('\n'));
    assert.equal(d.lines[0], 'decided  cycle 1: 1 accepted (F-01), 2 rejected (F-02, F-03); note: F-03 is a theoretical limit');
    const saved = readDecisions(root, 1);
    assert.deepEqual([saved.cycle, saved.accepted, saved.rejected, saved.note], [1, ['F-01'], ['F-02', 'F-03'], 'F-03 is a theoretical limit']);
    const cli = runTool('review.mjs', ['decide', '--cycle', '1', '--accept', 'F-01..F-03', '--reject', ''], root);
    assert.equal(cli.status, 1, 'no terminal behind the CLI: the decision is refused');
    assert.match(cli.stdout + cli.stderr, /person at the terminal types/);
    const again = recordDecision(root, 1, { accept: 'F-01..F-03', reject: '' });
    assert.ok(again.ok, again.lines.join('\n'));
    assert.match(again.lines[0], /3 accepted/);
  } finally {
    cleanup(root);
  }
});

test('cycle 2: only the classes that fired, only accepted findings carried under stable F-ids, rejected listed, MERGE or BUDGET', () => {
  const root = reviewable();
  try {
    assert.ok(start(root).ok);
    saveFinders(root, 1, { cor: [finding('COR-1')], sec: [finding('SEC-1', { line: 7 })] });
    saveVerifier(root, 1, { pass: false, confirmed: [
      { id: 'COR-1', severity: 'blocking', file: 'src/domain/customers.js', line: 3, what_breaks: 'x', evidence: 'y', level: 'code' },
      { id: 'SEC-1', severity: 'advisory', file: 'src/domain/customers.js', line: 7, what_breaks: 'theoretical', evidence: 'y', level: 'code' },
    ], watchList: [], refuted: [], tradeoffs: [] });
    assert.equal(render(root, 1, { mutation: MEASURED() }).verdict, 'FIX FIRST');
    assert.deepEqual(readState(root).confirmed.map((c) => c.fid), ['F-01', 'F-02']);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: FIX FIRST');

    const undecided = start(root, { cycle: 2 });
    assert.equal(undecided.ok, false);
    assert.match(undecided.lines[0], /^Review refused: cycle 1 confirmed F-01, F-02 and the human has not decided; run node review\.mjs decide --cycle 1/);
    assert.ok(recordDecision(root, 1, { accept: 'F-01', reject: 'F-02', note: 'MAX_SAFE_INTEGER is not a user input' }).ok);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: decisions');

    const two = start(root, { cycle: 2 });
    assert.ok(two.ok, two.lines.join('\n'));
    assert.equal(two.lines[1], 'classes  correctness', 'a rejected finding does not send its finder again');
    assert.match(two.lines.find((l) => l.startsWith('carried')), /^carried {2}F-01 \(COR-1\) \(accepted by the human in cycle 1; rejected: F-02\)/);
    const brief = readFileSync(join(root, 'docs/review/2/brief.txt'), 'utf8');
    assert.match(brief, /Number your findings after cycle 1: start at COR-2, SEC-2, CON-1, LEG-1 \(ids from cycle 1 are taken\)\. Use only your own class prefix, never an F-id\./);
    assert.ok(!brief.includes('F-01'), 'the finders are not told about carried findings');
    const vbrief = readFileSync(join(root, 'docs/review/2/verifier-brief.txt'), 'utf8');
    assert.match(vbrief, /Your own findings start at VER-1\./);
    assert.match(vbrief, /Your agent file says model fable; report the model you actually run on\./);
    assert.match(vbrief, /Rejected by the human in cycle 1, closed, do not raise again: F-02 \(MAX_SAFE_INTEGER is not a user input\)\./);
    assert.match(vbrief, /Confirmed in cycle 1 and accepted by the human, carried under their F-ids\. Place each F-id exactly once/);
    assert.match(vbrief, /F-01 \(was COR-1, blocking, level code\) src\/domain\/customers\.js:3: x/);
    assert.ok(!vbrief.includes('F-02 (was'), 'the rejected finding is not carried');

    write(root, 'docs/review/2/finder-correctness.json', asFinder([finding('SEC-2', { line: 20, what_breaks: 'new one', class: 'security' })]));
    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [], tradeoffs: [] });
    let r = render(root, 2, { date: '2026-10-26', mutation: MEASURED() });
    assert.ok(r.ok, r.lines.join('\n'));
    assert.equal(r.verdict, 'BUDGET', 'F-01 was carried and not placed: not MERGE, and at the last cycle that is BUDGET');
    assert.match(r.text, /F-01 was not placed by the verifier/);
    assert.match(r.text, /Why: carried finding F-01 not shown fixed or still present/);
    assert.match(r.text, /## Rejected by the human \(cycle 1\)\n {6}F-02 {2}note: MAX_SAFE_INTEGER is not a user input\n/);

    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [{ id: 'F-01', evidence: 'fixed in 1a2b3c4, test R-01 boundary added' }], tradeoffs: [] });
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED() });
    assert.equal(r.verdict, 'MERGE');
    assert.match(r.text, /## Refuted \(1\)\n {6}F-01 {2}fixed in 1a2b3c4/, 'a refuted carried finding keeps its F-id');
    assert.match(r.text, /## Verdict: MERGE\nNext: \/sdlc-kit:ship\./);

    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [{ id: 'cycle1/COR-1', evidence: 'fixed' }], tradeoffs: [] });
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED() });
    assert.equal(r.verdict, 'MERGE', 'a stray spelling of a carried id is read as its F-id');
    assert.match(r.text, /cycle1\/COR-1 read as the carried F-01/);

    saveVerifier(root, 2, { pass: false, confirmed: [
      { id: 'F-01', severity: 'blocking', file: 'src/domain/customers.js', line: 3, what_breaks: 'still there', evidence: 'y', level: 'code' },
      { id: 'SEC-2', severity: 'blocking', file: 'src/domain/customers.js', line: 20, what_breaks: 'new one', evidence: 'y', level: 'code' },
      { id: 'F-02', severity: 'advisory', file: 'src/domain/customers.js', line: 7, what_breaks: 'raised again', evidence: 'y', level: 'code' },
    ], watchList: [], refuted: [{ id: 'cycle1/COR-1', evidence: 'contradiction' }], tradeoffs: [] });
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED() });
    assert.equal(r.verdict, 'BUDGET');
    assert.ok(!r.text.includes('read as the carried'), 'no alias when the verifier placed the F-id itself');
    assert.match(r.text, /F-01  F-01  blocking  code  src\/domain\/customers\.js:3/, 'the carried finding keeps F-01 in the first column');
    assert.match(r.text, /F-03  SEC-2  blocking  code  src\/domain\/customers\.js:20/, 'a new finding continues after the last F-id');
    assert.ok(!/F-0\d  F-02/.test(r.text), 'the rejected finding is not listed as confirmed');
    assert.match(r.text, /F-02 rejected by the human in cycle 1; not counted/);
    assert.match(r.text, /cycle1\/COR-1 is not a finding of this cycle/);
    assert.match(r.text, /## Verdict: BUDGET: human decision\nWhy: 2 blocking findings confirmed\.\nRoutes: reopen S1 \(F-01, F-03\)\.\nNext: both fix rounds are used; there is no cycle 3\. You decide:\n {6}ship as it is: \/sdlc-kit:ship/);
    assert.ok(!r.text.includes('--cycle 3'));
    assert.equal(readState(root).nextF, 4);

    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [{ id: 'F-01', evidence: 'fixed' }], tradeoffs: [{ findings: [], options: ['a', 'b'], cost: 'c', recommendation: 'a' }] });
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED() });
    assert.equal(r.verdict, 'BUDGET', 'at the last cycle any remaining reason is BUDGET, never FIX FIRST');
    assert.match(r.text, /Why: 1 trade-off open\./);

    const judged = { file: 'src/domain/customers.js', line: 3, from: '<=', to: '<', equivalent: true, why: 'read through ??, null and undefined behave the same' };
    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [{ id: 'F-01', evidence: 'fixed' }], tradeoffs: [], survivors: [judged] }, 'Model: opus\nGate: x\nMutations: 4 planted, 3 caught, 1 survived\n');
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED([SURVIVOR]) });
    assert.equal(r.verdict, 'MERGE', 'a measured survivor the verifier judged equivalent does not block');
    assert.deepEqual(readState(root).equivalent.map((e) => e.line), [3], 'the equivalence is recorded in the state for the strict gate');
    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [{ id: 'F-01', evidence: 'fixed' }], tradeoffs: [], survivors: [judged] }, 'Model: opus\nGate: x\nMutations: 4 planted, 3 caught, 1 survived\n', false);
    const uncaptured = render(root, 2, { date: '2026-10-26', mutation: MEASURED([SURVIVOR]) });
    assert.equal(uncaptured.verdict, 'BUDGET', 'an equivalence read from the clerk\'s file does not count');
    assert.match(uncaptured.text, /not from the hook's\s+capture/);
    assert.deepEqual(readState(root).equivalent, []);
    saveVerifier(root, 2, { pass: true, confirmed: [], watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }], refuted: [{ id: 'F-01', evidence: 'fixed' }], tradeoffs: [], survivors: [judged] }, 'Model: opus\nGate: x\nMutations: 4 planted, 3 caught, 1 survived\n');
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED([SURVIVOR]) });
    assert.match(r.text, /Mutations: 4 planted, 3 caught, 1 survived\n {2}survived \(equivalent\): src\/domain\/customers\.js:3 "<=" -> "<" \(read through \?\?, null and\s+undefined\s+behave the same\)\n/);
    r = render(root, 2, { date: '2026-10-26', mutation: MEASURED([{ ...SURVIVOR, line: 9 }]) });
    assert.equal(r.verdict, 'BUDGET', 'a survivor the verifier did not judge counts, whatever its Mutations line said');
    assert.match(r.text, /Why: 1 planted defect survived\./);
    assert.deepEqual(readState(root).maxIds, { COR: 1, SEC: 2 });
    assert.ok(r.text.split('\n').every((l) => l.length <= 100 || !l.slice(100).includes(' ')), 'rows wrap at 100 characters');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 2: BUDGET');
    const three = runTool('review.mjs', ['start'], root);
    assert.equal(three.status, 1);
    assert.match(three.stdout, /^BUDGET: human decision/);
  } finally {
    cleanup(root);
  }
});

test('render: a missing or malformed verifier answer is a RE-ASK, nothing is written', () => {
  const root = reviewable();
  try {
    assert.ok(start(root).ok);
    saveFinders(root, 1, { cor: [finding('COR-1')] });
    let r = render(root, 1);
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /RE-ASK verifier: docs\/review\/1\/verifier\.json is missing/);
    write(root, 'docs/review/1/verifier.json', '{"pass": false, "confirmed": "none"}');
    r = render(root, 1);
    assert.equal(r.ok, false);
    assert.ok(r.lines.some((l) => /"confirmed" must be an array/.test(l)));
    assert.ok(!existsSync(join(root, 'docs/REVIEW.md')));
  } finally {
    cleanup(root);
  }
});

test('deriveMaxIds: a missing prefix in state.json is recovered from the lists and the finder files', () => {
  const root = reviewable();
  try {
    assert.ok(start(root).ok);
    saveFinders(root, 1, { cor: [finding('COR-3')], sec: [finding('SEC-2', { severity: 'advisory', proven: false })] });
    saveVerifier(root, 1, {
      pass: false,
      confirmed: [{ id: 'VER-6', class: 'contract', severity: 'blocking', file: 'tests/customers.test.js', line: 1, what_breaks: 'x', requirement: 'R-01', evidence: 'y', level: 'code', merged: ['COR-3'] }],
      watchList: [{ id: 'SEC-2', why_unproven: 'u', how_to_settle: 's' }],
      refuted: [{ id: 'VER-2', evidence: 'z' }],
      tradeoffs: [],
    });
    assert.ok(render(root, 1, { mutation: MEASURED() }).ok);
    const state = readState(root);
    assert.deepEqual(state.maxIds, { COR: 3, SEC: 2, VER: 6 });
    assert.deepEqual(deriveMaxIds(root, state), { COR: 3, SEC: 2, VER: 6 }, 'recorded values are kept as they are');
    const older = { ...state, maxIds: { COR: 9 } };
    assert.deepEqual(deriveMaxIds(root, older), { COR: 9, SEC: 2, VER: 6 }, 'a recorded prefix wins, the missing ones come from the lists');
    const noMax = { ...state };
    delete noMax.maxIds;
    assert.deepEqual(deriveMaxIds(root, noMax), { COR: 3, SEC: 2, VER: 6 });
    const noLists = { cycle: 1, confirmed: [], watchList: [], refuted: [] };
    assert.deepEqual(deriveMaxIds(root, noLists), { COR: 3, SEC: 2 }, 'the finder files alone give the finder prefixes');
    const stateFile = join(root, 'docs/review/state.json');
    assert.ok(recordDecision(root, 1, { accept: 'F-01' }).ok);
    const hand = JSON.parse(readFileSync(stateFile, 'utf8'));
    delete hand.maxIds;
    write(root, 'docs/review/state.json', JSON.stringify(hand));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: FIX FIRST');
    const two = start(root, { cycle: 2 });
    assert.ok(two.ok, two.lines.join('\n'));
    assert.match(readFileSync(join(root, 'docs/review/2/verifier-brief.txt'), 'utf8'), /Your own findings start at VER-7\./);
    assert.match(readFileSync(join(root, 'docs/review/2/brief.txt'), 'utf8'), /start at COR-4, SEC-3, CON-1, LEG-1/);
  } finally {
    cleanup(root);
  }
});

test('domain class: only with a project domain skill; cycle 2 keeps it only when it fired', () => {
  assert.deepEqual(classesFor(1, null, { domain: true }), ['correctness', 'security', 'contract', 'domain', 'legal']);
  assert.deepEqual(classesFor(1, null), ['correctness', 'security', 'contract', 'legal'], 'no domain skill, no domain finder');
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'DOM-1', class: 'domain' }], watchList: [] }, { domain: true }), ['domain']);
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'DOM-1', class: 'domain' }], watchList: [] }), [], 'the skill is gone: the class is not available');
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'COR-1', class: 'correctness', merged: ['DOM-2'] }], watchList: [] }, { domain: true }), ['correctness', 'domain']);
  assert.equal(findingProblem(finding('DOM-1'), 0), null);
  assert.match(findingProblem(finding('DOM-1', { rule: undefined }), 0), /a domain finding needs "rule" like D-03/);
  assert.match(findingProblem(finding('DOM-1', { rule: 'rule 3' }), 0), /needs "rule" like D-03/);
  assert.match(findingProblem(finding('DOM-1', { rule: 'D-09' }), 0, { domain: new Set(['D-01', 'D-02']) }), /rule "D-09" is not defined in the domain skill \(defined: D-01, D-02\)/);
  assert.equal(findingProblem(finding('DOM-1', { rule: 'D-02' }), 0, { domain: new Set(['D-01', 'D-02']) }), null);
  assert.equal(ruleProblem(finding('COR-1'), 0, { domain: new Set(), legal: new Set() }), null, 'other classes carry no rule');
  assert.match(findingProblem(finding('COR-1', { class: 'domain' }), 0), /needs "rule"/, 'the class decides too');
});

test('legal class: always available; a LEG finding needs a rule a legal skill defines; cycle 2 keeps it only when it fired', () => {
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'LEG-1', class: 'legal' }], watchList: [] }), ['legal']);
  assert.deepEqual(classesFor(2, { confirmed: [], watchList: [{ id: 'COR-2', class: 'correctness', merged: ['LEG-3'] }] }), ['correctness', 'legal']);
  assert.deepEqual(classesFor(2, { confirmed: [{ id: 'COR-1', class: 'correctness' }], watchList: [] }), ['correctness'], 'legal did not fire: not sent again');
  assert.equal(findingProblem(finding('LEG-1'), 0), null);
  assert.match(findingProblem(finding('LEG-1', { rule: undefined }), 0), /a legal finding needs "rule" like LD-03/);
  assert.match(findingProblem(finding('LEG-1', { rule: 'D-01' }), 0), /a legal finding needs "rule" like LD-03/, 'a domain id is not a legal rule');
  assert.match(findingProblem(finding('LEG-1', { rule: 'LD-99' }), 0, { legal: new Set(['LD-01', 'LL-02']) }), /rule "LD-99" is not defined in a legal skill \(defined: LD-01, LL-02\)/);
  assert.equal(findingProblem(finding('LEG-1', { rule: 'LL-02' }), 0, { legal: new Set(['LD-01', 'LL-02']) }), null);
  assert.match(findingProblem(finding('COR-1', { class: 'legal' }), 0), /a legal finding needs "rule"/, 'the class decides too');
  assert.match(findingProblem(finding('X-1'), 0), /must look like COR-1, SEC-1, CON-1, DOM-1 or LEG-1/);
  const ok = { pass: false, confirmed: [{ id: 'LEG-2', severity: 'blocking', file: 'a', what_breaks: 'b', evidence: 'c', level: 'code' }], watchList: [], refuted: [], tradeoffs: [] };
  assert.deepEqual(verifierProblems(ok), [], 'the verifier may confirm a LEG id');
});

test('start with a project legal skill: the kit skills and the project one, the briefs name them; a LEG finding is checked, placed, routed and counted', () => {
  const root = makeProject({ test: 'green', legal: true });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'S1: customer rules (R-01, R-02)');
  try {
    const r = start(root);
    assert.ok(r.ok, r.lines.join('\n'));
    assert.equal(r.lines[1], 'classes  correctness, security, contract, legal');
    assert.equal(r.lines[3], `legal    ${KIT_LEGAL}, .claude/skills/legal-health/SKILL.md`);
    assert.deepEqual(readState(root).legalSkills.map((s) => [s.origin, s.rules.length > 0]), [['kit', true], ['kit', true], ['kit', true], ['project', true]]);
    const brief = readFileSync(join(root, 'docs/review/1/brief.txt'), 'utf8');
    const legalLine = brief.split('\n').find((l) => l.startsWith('Legal skills: '));
    assert.ok(legalLine, 'the finder brief names the legal skills');
    assert.match(legalLine, /^Legal skills: \/.*?\/skills\/legal-data-protection\/SKILL\.md \(LD-01, LD-02, /, 'a kit skill by its full path, so the finder can read it');
    assert.match(legalLine, /\.claude\/skills\/legal-health\/SKILL\.md \(LH-01, LH-02\)\. finder-legal reads them first and cites their rules as "rule": "LD-nn" \(or LL-nn, LE-nn, a project prefix\); it is not legal advice\.$/);
    assert.match(readFileSync(join(root, 'docs/review/1/verifier-brief.txt'), 'utf8'), /^Legal skills: .*legal-licenses\/SKILL\.md \(LL-01, .*\. A LEG finding cites one of their rules in "rule"; check the rule text yourself\.$/m);

    saveFinders(root, 1, { leg: [finding('LEG-1', { rule: 'LD-99', what_breaks: 'email in console.log' })] });
    let c = check(root, 1);
    assert.equal(c.ok, false);
    assert.match(c.lines.find((l) => l.startsWith('RE-ASK')), /^RE-ASK finder-legal: item 1 \(LEG-1\): rule "LD-99" is not defined in a legal skill \(defined: LD-01, LD-02, .*LE-08, LL-01, .*LL-11, LH-01, LH-02\)$/);
    saveFinders(root, 1, { leg: [
      finding('LEG-1', { rule: 'LD-09', what_breaks: 'customer email written to console.log', requirement: 'R-01', line: 3 }),
      finding('LEG-2', { rule: 'LH-02', severity: 'advisory', what_breaks: 'medical note shown without a second confirmation', requirement: 'R-01', line: 4 }),
    ] });
    c = check(root, 1);
    assert.ok(c.ok, c.lines.join('\n'));
    assert.match(c.lines.find((l) => l.startsWith('finder-legal')), /^finder-legal {2}2 findings/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'docs/review/1/findings.json'), 'utf8')).map((f) => [f.id, f.finder, f.rule]), [['LEG-1', 'legal', 'LD-09'], ['LEG-2', 'legal', 'LH-02']]);

    saveVerifier(root, 1, {
      pass: false,
      confirmed: [{ id: 'LEG-1', severity: 'blocking', file: 'src/domain/customers.js', line: 3, what_breaks: 'customer email written to console.log', requirement: 'R-01', evidence: 'customers.js:3 console.log(customer); LD-09 says personal data does not leak into logs', proven: true, rank: 1, level: 'code' }],
      watchList: [{ id: 'LEG-2', class: 'legal', severity: 'advisory', file: 'src/domain/customers.js', line: 4, what_breaks: 'medical note shown without a second confirmation', requirement: 'R-01', rule: 'LH-02', evidence: 'y', proven: false, why_unproven: 'the confirmation may live in the UI slice', how_to_settle: 'check S3' }],
      refuted: [],
      tradeoffs: [],
    });
    const rendered = render(root, 1, { date: '2026-10-28', mutation: MEASURED() });
    assert.ok(rendered.ok, rendered.lines.join('\n'));
    assert.equal(rendered.verdict, 'FIX FIRST', 'a blocking LEG finding counts like any other');
    const text = readFileSync(join(root, 'docs/REVIEW.md'), 'utf8');
    assert.match(text, /^Finders: correctness, security, contract, legal \(opus\)/m, 'the header lists the legal finder');
    const flat = text.replace(/\n {6}/g, ' ');
    assert.match(flat, /F-01  LEG-1  blocking  code  src\/domain\/customers\.js:3  R-01  LD-09  customer email written to console\.log evidence: [^\n]* route: reopen S1\n/, 'the rule sits between the requirement and the text');
    assert.match(flat, /## Watch list \(1\) +LEG-2  advisory  src\/domain\/customers\.js:4  R-01  LH-02  medical note shown without a second confirmation evidence: y why unproven: the confirmation may live in the UI slice/, 'a project rule shows the same way');
    assert.match(text, /Why: 1 blocking finding confirmed\./);
    assert.match(text, /^legal: items 1-8 ran; fired: 1; not run: none$/m);
    assert.deepEqual(readState(root).maxIds, { LEG: 2 });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: FIX FIRST');
    assert.ok(recordDecision(root, 1, { accept: 'F-01' }).ok);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: decisions');
    const two = start(root, { cycle: 2 });
    assert.ok(two.ok, two.lines.join('\n'));
    assert.equal(two.lines[1], 'classes  legal', 'cycle 2 runs the legal finder because it fired');
    assert.match(readFileSync(join(root, 'docs/review/2/brief.txt'), 'utf8'), /start at COR-1, SEC-1, CON-1, LEG-3 \(ids from cycle 1 are taken\)/);
  } finally {
    cleanup(root);
  }
});

test('start with a domain skill: five classes, the brief names the skill and its rules; a DOM finding is placed, counted and routed', () => {
  const root = makeProject({ test: 'green', domain: true });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'S1: customer rules (R-01, R-02)');
  try {
    const r = start(root);
    assert.ok(r.ok, r.lines.join('\n'));
    assert.equal(r.lines[1], 'classes  correctness, security, contract, domain, legal');
    assert.equal(r.lines[2], 'domain   .claude/skills/domain-invoicing/SKILL.md');
    assert.deepEqual(readState(root).classes, ['correctness', 'security', 'contract', 'domain', 'legal']);
    const brief = readFileSync(join(root, 'docs/review/1/brief.txt'), 'utf8');
    assert.match(brief, /^Domain skill: \.claude\/skills\/domain-invoicing\/SKILL\.md \(D-01, D-02, D-03\)\. finder-domain reads it first and cites its rules as "rule": "D-nn"\.$/m);
    const vbrief = readFileSync(join(root, 'docs/review/1/verifier-brief.txt'), 'utf8');
    assert.match(vbrief, /Domain skill: \.claude\/skills\/domain-invoicing\/SKILL\.md \(D-01, D-02, D-03\)\. A DOM finding cites one of its rules in "rule"; check the rule text yourself\./);

    saveFinders(root, 1, {});
    write(root, 'docs/review/1/finder-domain.json', asFinder([finding('DOM-1', { rule: 'D-09', what_breaks: 'cents as floats' })]));
    let c = check(root, 1);
    assert.equal(c.ok, false);
    assert.deepEqual(c.lines.filter((l) => l.startsWith('RE-ASK')), ['RE-ASK finder-domain: item 1 (DOM-1): rule "D-09" is not defined in the domain skill (defined: D-01, D-02, D-03)']);
    write(root, 'docs/review/1/finder-domain.json', asFinder([finding('DOM-1', { rule: 'D-02', what_breaks: 'line total rounds half down', requirement: 'R-05' })]));
    c = check(root, 1);
    assert.ok(c.ok, c.lines.join('\n'));
    assert.match(c.lines.find((l) => l.startsWith('finder-domain')), /^finder-domain {2}1 finding/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'docs/review/1/findings.json'), 'utf8')).map((f) => [f.id, f.finder, f.rule]), [['DOM-1', 'domain', 'D-02']]);

    saveVerifier(root, 1, {
      pass: false,
      confirmed: [{ id: 'DOM-1', severity: 'blocking', file: 'src/domain/customers.js', line: 3, what_breaks: 'line total rounds half down', requirement: 'R-05', evidence: 'customers.js:3 uses Math.floor; D-02 says half up; 0.5 -> 0', proven: true, rank: 1, level: 'code' }],
      watchList: [],
      refuted: [],
      tradeoffs: [],
    });
    const rendered = render(root, 1, { date: '2026-10-28', mutation: MEASURED() });
    assert.ok(rendered.ok, rendered.lines.join('\n'));
    assert.equal(rendered.verdict, 'FIX FIRST', 'a blocking DOM finding counts like any other');
    const text = readFileSync(join(root, 'docs/REVIEW.md'), 'utf8');
    assert.match(text, /^Finders: correctness, security, contract, domain, legal \(opus\)/m, 'the header lists the five finders that ran');
    assert.match(text, /F-01  DOM-1  blocking  code  src\/domain\/customers\.js:3  R-05  D-02  line total rounds half down\n[^\n]*\n {6}route: reopen S1/);
    assert.match(text, /Why: 1 blocking finding confirmed\./);
    assert.match(text, /^domain: items 1-8 ran; fired: 1; not run: none$/m);
    assert.deepEqual(readState(root).maxIds, { DOM: 1 });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: FIX FIRST');
    assert.ok(recordDecision(root, 1, { accept: 'F-01' }).ok);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Review cycle 1: decisions');
    const two = start(root, { cycle: 2 });
    assert.ok(two.ok, two.lines.join('\n'));
    assert.equal(two.lines[1], 'classes  domain', 'cycle 2 runs the domain finder because it fired');
    assert.match(readFileSync(join(root, 'docs/review/2/brief.txt'), 'utf8'), /start at COR-1, SEC-1, CON-1, DOM-2, LEG-1 \(ids from cycle 1 are taken\)/);
  } finally {
    cleanup(root);
  }
});
