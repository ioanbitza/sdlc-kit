import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { start, check, render, readState, itemProblem, sortItems, statusOf, rolesFor, FOLD_IN } from './reqreview.mjs';
import { makeProject, cleanup, write, git, runTool } from './fixtures.mjs';

const item = (id, extra = {}) => ({
  id,
  kind: 'missing',
  severity: 'blocking',
  requirement: 'R-01',
  title: `${id} title`,
  why: `${id} why`,
  suggested: `### R-07 [MUST] ${id} suggested`,
  proven: true,
  ...(id.startsWith('DOM') ? { rule: 'D-01' } : id.startsWith('LEG') ? { rule: 'LD-01' } : {}),
  ...extra,
});

const answer = (list, checklist = 'items 1-6 ran; fired: 2; not run: none') => `${JSON.stringify(list)}\nChecklist: ${checklist}\n`;
const NO_LEGAL_ITEMS = answer([], 'items 1-6 ran; fired: none; not run: none');

const CONTEXT = { requirements: new Set(['R-01', 'R-02']), rules: new Set(['D-01', 'D-02']), legalRules: new Set(['LD-01', 'LD-02', 'LH-01']), maxIds: {} };
const KIT_LEGAL = 'sdlc-kit/skills/legal-data-protection/SKILL.md, sdlc-kit/skills/legal-e-invoicing/SKILL.md, sdlc-kit/skills/legal-licenses/SKILL.md';

test('itemProblem: every field, kinds and severities from the list, requirement none or existing, rule for DOM items, ids per role', () => {
  assert.equal(itemProblem(item('PO-1'), 0, { ...CONTEXT, role: 'product-owner' }), null);
  assert.equal(itemProblem(item('PO-1', { requirement: 'none' }), 0, { ...CONTEXT, role: 'product-owner' }), null);
  const { why, ...noWhy } = item('PO-1');
  assert.match(itemProblem(noWhy, 1, { ...CONTEXT, role: 'product-owner' }), /item 2 \(PO-1\) is missing "why"/);
  assert.match(itemProblem(item('PO-1', { proven: 'yes' }), 0, { ...CONTEXT, role: 'product-owner' }), /"proven" must be a boolean/);
  assert.match(itemProblem(item('PO-1', { kind: 'bug' }), 0, { ...CONTEXT, role: 'product-owner' }), /kind "bug" must be one of missing, wrong, priority, unclear, risk/);
  assert.match(itemProblem(item('PO-1', { severity: 'major' }), 0, { ...CONTEXT, role: 'product-owner' }), /severity "major" must be blocking or advisory/);
  assert.match(itemProblem(item('PO-1', { requirement: 'R-09' }), 0, { ...CONTEXT, role: 'product-owner' }), /requirement "R-09" is not in docs\/REQUIREMENTS\.md \(use none or one of R-01, R-02\)/);
  assert.match(itemProblem(item('DOM-1'), 0, { ...CONTEXT, role: 'product-owner' }), /id "DOM-1" must look like PO-1/);
  assert.match(itemProblem(item('PO-2'), 0, { ...CONTEXT, role: 'product-owner', seen: new Set(['PO-2']) }), /id "PO-2" is used twice/);
  assert.match(itemProblem(item('PO-2'), 0, { ...CONTEXT, role: 'product-owner', maxIds: { PO: 5 } }), /PO-2 was used in an earlier run; number from PO-6/);
  assert.equal(itemProblem(item('DOM-1', { rule: 'D-02' }), 0, { ...CONTEXT, role: 'domain-expert' }), null);
  assert.match(itemProblem(item('DOM-1', { rule: undefined }), 0, { ...CONTEXT, role: 'domain-expert' }), /a domain item needs "rule" like D-03/);
  assert.match(itemProblem(item('DOM-1', { rule: 'D-07' }), 0, { ...CONTEXT, role: 'domain-expert' }), /rule "D-07" is not defined in the domain skill \(defined: D-01, D-02\)/);
  assert.equal(statusOf('# Requirements\n\nStatus: approved\n'), 'approved');
  assert.equal(statusOf('# Requirements\nStatus: draft.\n'), 'draft');
  assert.equal(statusOf('no status'), 'none');
  assert.equal(itemProblem(item('LEG-1', { rule: 'LD-02' }), 0, { ...CONTEXT, role: 'legal' }), null);
  assert.equal(itemProblem(item('LEG-1', { rule: 'LH-01' }), 0, { ...CONTEXT, role: 'legal' }), null, 'a project legal skill rule');
  assert.match(itemProblem(item('LEG-1', { rule: undefined }), 0, { ...CONTEXT, role: 'legal' }), /a legal item needs "rule" like LD-03/);
  assert.match(itemProblem(item('LEG-1', { rule: 'D-01' }), 0, { ...CONTEXT, role: 'legal' }), /a legal item needs "rule" like LD-03/, 'a domain id is not a legal rule');
  assert.match(itemProblem(item('LEG-1', { rule: 'LX-09' }), 0, { ...CONTEXT, role: 'legal' }), /rule "LX-09" is not defined in a legal skill \(defined: LD-01, LD-02, LH-01\)/);
  assert.match(itemProblem(item('LEG-1'), 0, { ...CONTEXT, role: 'product-owner' }), /id "LEG-1" must look like PO-1/);
  assert.deepEqual(rolesFor([]), ['product-owner', 'legal'], 'legal always runs: the kit ships its skills');
  assert.deepEqual(rolesFor([{ path: 'x' }]), ['product-owner', 'domain-expert', 'legal']);
  assert.deepEqual(sortItems([item('DOM-2', { role: 'domain-expert', severity: 'advisory' }), item('LEG-1', { role: 'legal' }), item('PO-2', { role: 'product-owner', severity: 'advisory' }), item('DOM-1', { role: 'domain-expert' }), item('PO-10', { role: 'product-owner' }), item('PO-3', { role: 'product-owner' })]).map((i) => i.id), ['PO-3', 'PO-10', 'DOM-1', 'LEG-1', 'PO-2', 'DOM-2']);
});

test('no domain skill: product-owner and legal, a Blocked line is accepted, the render names the fold-in and plan-slices', () => {
  const root = makeProject({ approved: false });
  try {
    write(root, '.sdlc/slice', 'S1\n');
    assert.match(start(root).lines[0], /^Requirements review refused: S1 is still active/);
    write(root, '.sdlc/slice', '');
    assert.match(start(root, { file: 'docs/NOPE.md' }).lines[0], /^Requirements review refused: docs\/NOPE\.md does not exist; run \/sdlc-kit:write-requirements first\./);
    write(root, 'docs/REQUIREMENTS.md', readFileSync(join(root, 'docs/REQUIREMENTS.md'), 'utf8') + '\n- a line the draft gained after the commit\n');
    const r = start(root);
    assert.ok(r.ok, r.lines.join('\n'));
    const head = git(root, 'rev-parse', '--short', 'HEAD');
    assert.equal(r.lines[0], `review   run 1   docs/REQUIREMENTS.md (Status: draft, uncommitted, 6 requirements)   HEAD ${head}`);
    assert.equal(r.lines[1], 'roles    product-owner, legal');
    assert.match(r.lines[2], /^domain {3}none \(no skill under \.claude\/skills\/domain-\*\/; domain-expert not run\)/);
    assert.equal(r.lines[3], `legal    ${KIT_LEGAL}`, 'the kit ships the legal skills, so the legal role always runs');
    const brief = readFileSync(join(root, 'docs/requirements-review/brief.txt'), 'utf8');
    assert.match(brief, /^Requirements review, run 1\. File: docs\/REQUIREMENTS\.md \(Status: draft, 6 requirements: R-01\.\.R-06\)\. Reviewed commit [0-9a-f]{7}\.\n/);
    assert.match(brief, /Read first: docs\/BRIEF\.md, AGENTS\.md, docs\/decisions\/\*\.md; then docs\/REQUIREMENTS\.md\./);
    assert.match(brief, /product-owner: ids PO-1, PO-2, \.\.\.; checklist: 1 who uses the app and for what; 2 the main flows end to end/);
    assert.match(brief, /^Legal skills: \/.*?\/skills\/legal-data-protection\/SKILL\.md \(LD-01, LD-02, [^;]*\); \/.*?\/skills\/legal-e-invoicing\/SKILL\.md \(LE-01, [^;]*\); \/.*?\/skills\/legal-licenses\/SKILL\.md \(LL-01, [^)]*\)\. The legal role reads them before the requirements and cites their rules as "rule": "LD-nn"; it is not legal advice, the human decides\.$/m, 'the kit skills by full path, so the role can read them');
    assert.match(brief, /^legal: ids LEG-1, LEG-2, \.\.\. with "rule":"LD-nn" \(or LL-nn, LE-nn, a project prefix\); checklist, each requirement and the data model against every rule: 1 personal data: which fields, with what purpose, nothing beyond it; 2 the rights the app must make possible/m);
    assert.match(brief, /or the app as specified would break a legal obligation \(personal data it cannot erase or export, an invoice it can edit after issue, a dependency whose licence forbids the use\)\./);
    assert.ok(!brief.includes('domain-expert:'), 'no domain role in the brief');
    assert.ok(!brief.includes('Domain skill'));

    let c = check(root);
    assert.equal(c.ok, false);
    assert.deepEqual(c.lines, ['RE-ASK product-owner: docs/requirements-review/product-owner.json is missing', 'RE-ASK legal: docs/requirements-review/legal.json is missing']);
    write(root, 'docs/requirements-review/product-owner.json', '[]\nBlocked: docs/BRIEF.md does not exist\n');
    write(root, 'docs/requirements-review/legal.json', NO_LEGAL_ITEMS);
    c = check(root);
    assert.ok(c.ok, c.lines.join('\n'));
    assert.match(c.lines[0], /^product-owner {2}0 items {3}no Checklist line {3}Blocked: docs\/BRIEF\.md does not exist$/);
    assert.match(c.lines[1], /^legal {2}0 items {3}Checklist: items 1-6 ran; fired: none; not run: none$/);
    write(root, 'docs/requirements-review/domain-expert.json', answer([item('DOM-1')]));
    c = check(root);
    assert.ok(c.ok, 'a file for a role that was not launched is ignored');
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'docs/requirements-review/items.json'), 'utf8')), []);

    write(root, 'docs/requirements-review/product-owner.json', answer([
      item('PO-1', { severity: 'advisory', kind: 'unclear', requirement: 'R-02', title: 'R-02 does not say what invalid means' }),
      item('PO-2', { kind: 'missing', requirement: 'none', title: 'No way to delete a customer', why: 'the brief says "manage customers"; R-01..R-06 only create', suggested: '### R-07 [MUST] Delete a customer\n- a customer with orders cannot be deleted' }),
    ]));
    const rendered = render(root, { date: '2026-10-28' });
    assert.ok(rendered.ok, rendered.lines.join('\n'));
    assert.equal(rendered.lines[0], 'docs/REQUIREMENTS-REVIEW.md written (run 1, 2 items: 1 blocking, 1 advisory)');
    assert.equal(rendered.lines[1], 'commit   git add docs/requirements-review docs/REQUIREMENTS-REVIEW.md && git commit -m "Requirements review"');
    const text = readFileSync(join(root, 'docs/REQUIREMENTS-REVIEW.md'), 'utf8');
    assert.match(text, new RegExp(`^# Requirements review, run 1\\nReviewed: ${head} \\(docs/REQUIREMENTS\\.md, Status: draft, uncommitted\\)   Date: 2026-10-28\\nRoles: product-owner, legal \\(opus\\)   Domain skills: none   Legal skills: ${KIT_LEGAL.replace(/[./]/g, '\\$&')}\\n\\n## Items \\(2: 1 blocking, 1 advisory\\)\\n`));
    assert.match(text, /^- \[ \] PO-2  blocking  missing  none  No way to delete a customer\n {6}why: the brief says "manage customers"; R-01\.\.R-06 only create\n {6}suggested: ### R-07 \[MUST\] Delete a customer\n {6}- a customer with orders cannot be deleted\n- \[ \] PO-1  advisory  unclear  R-02  R-02 does not say what invalid means\n/m, 'blocking first, why and suggested indented');
    assert.match(text, /## Checklists\nproduct-owner: items 1-6 ran; fired: 2; not run: none\nlegal: items 1-6 ran; fired: none; not run: none\n/);
    const flat = text.replace(/\n {6}/g, ' ');
    assert.match(flat, new RegExp(`## Next\\nTick the items you accept \\(- \\[x\\]\\), then tell the session: "${FOLD_IN}"\\. An untouched item is rejected\\.\\n`), 'wrapped rows read as one sentence');
    assert.match(flat, /Then set Status: approved on the third line of docs\/REQUIREMENTS\.md, commit it, and run \/sdlc-kit:plan-slices\.\n$/);
    assert.ok(!text.includes(String.fromCharCode(0x2014)), 'no em dash');
    const state = readState(root);
    assert.equal(state.rendered, true);
    assert.deepEqual(state.maxIds, { PO: 2 });
    assert.deepEqual(state.items, ['PO-2', 'PO-1']);
  } finally {
    cleanup(root);
  }
});

test('with a domain skill: three roles, rules checked, a bad JSON is a RE-ASK, the rule shows on the row; approved file: the human folds in', () => {
  const root = makeProject({ domain: true });
  try {
    write(root, 'docs/BRIEF.md', '# Brief\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Brief');
    const r = start(root);
    assert.ok(r.ok, r.lines.join('\n'));
    assert.match(r.lines[0], /^review {3}run 1 {3}docs\/REQUIREMENTS\.md \(Status: approved, 6 requirements\) {3}HEAD [0-9a-f]{7}$/, 'committed: no "uncommitted" note');
    assert.equal(r.lines[1], 'roles    product-owner, domain-expert, legal');
    assert.equal(r.lines[2], 'domain   .claude/skills/domain-invoicing/SKILL.md');
    const brief = readFileSync(join(root, 'docs/requirements-review/brief.txt'), 'utf8');
    assert.match(brief, /^Domain skill: \.claude\/skills\/domain-invoicing\/SKILL\.md \(D-01, D-02, D-03\)\. The domain expert reads it before the requirements and cites its rules as "rule": "D-nn"\.$/m);
    assert.match(brief, /^domain-expert: ids DOM-1, DOM-2, \.\.\. with "rule":"D-nn"; checklist, each requirement and the data model against every rule: 1 a rule the requirements break; 2 a rule the requirements ignore; 3 a term used wrongly; 4 a rounding or legal element missing\.$/m);

    write(root, 'docs/requirements-review/product-owner.json', answer([item('PO-1', { severity: 'advisory', kind: 'priority', title: 'R-02 could wait' })]));
    write(root, 'docs/requirements-review/legal.json', answer([item('LEG-1', { rule: 'LD-07', kind: 'missing', requirement: 'none', title: 'No way to erase a customer, and no retention that would refuse it', why: 'the data model holds name and email; no requirement erases them; LD-07 "The person can have their personal data erased"', suggested: '### R-08 [MUST] Erase a customer\n- a customer with stored invoices keeps the invoice data and the app says why' })], 'items 1-6 ran; fired: 2; not run: none'));
    write(root, 'docs/requirements-review/domain-expert.json', 'Here is my answer:\n[{"id":"DOM-1","kind":"wrong",\nChecklist: items 1-4 ran\n');
    let c = check(root);
    assert.equal(c.ok, false);
    assert.deepEqual(c.lines.filter((l) => l.startsWith('RE-ASK')), ['RE-ASK domain-expert: JSON is not closed']);
    const cli = runTool('reqreview.mjs', ['check'], root);
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /^RE-ASK domain-expert: /m);
    write(root, 'docs/requirements-review/domain-expert.json', answer([item('DOM-1', { rule: 'D-07' })], 'items 1-4 ran; fired: 1; not run: none'));
    c = check(root);
    assert.match(c.lines.find((l) => l.startsWith('RE-ASK')), /rule "D-07" is not defined in the domain skill \(defined: D-01, D-02, D-03\)/);
    write(root, 'docs/requirements-review/domain-expert.json', answer([item('DOM-1', { rule: 'D-02', kind: 'wrong', requirement: 'R-05', title: 'R-05 rounds per order, D-02 rounds per line', why: 'R-05 says "round the order total"; D-02 says a line total rounds half up', suggested: 'R-05: each line total is rounded half up to the cent; the order total sums the rounded lines' })], 'items 1-4 ran; fired: 1; not run: none'));
    c = check(root);
    assert.ok(c.ok, c.lines.join('\n'));
    assert.match(c.lines[1], /^domain-expert {2}1 item {3}Checklist: items 1-4 ran; fired: 1; not run: none$/);
    const rendered = render(root, { date: '2026-10-28' });
    assert.ok(rendered.ok);
    const text = rendered.text;
    assert.match(text, new RegExp(`^Roles: product-owner, domain-expert, legal \\(opus\\)   Domain skills: \\.claude/skills/domain-invoicing/SKILL\\.md   Legal skills: ${KIT_LEGAL.replace(/[./]/g, '\\$&')}$`, 'm'));
    assert.match(text, /^- \[ \] DOM-1  blocking  wrong  R-05  D-02  R-05 rounds per order, D-02 rounds per line\n/m, 'the rule sits between the requirement and the title');
    assert.match(text.replace(/\n {6}/g, " "), /^- \[ \] LEG-1  blocking  missing  none  LD-07  No way to erase a customer, and no retention that would refuse it why: the data model holds name and email; no requirement erases them; LD-07 "The person can have their personal data erased" suggested: ### R-08 \[MUST\] Erase a customer - a customer with stored invoices keeps the invoice data and the app says why\n/m, 'a LEG item shows its rule the same way, after the DOM items');
    assert.match(text, /^- \[ \] PO-1  advisory  priority  R-01  R-02 could wait\n/m);
    assert.match(text, /## Checklists\nproduct-owner: items 1-6 ran; fired: 2; not run: none\ndomain-expert: items 1-4 ran; fired: 1; not run: none\nlegal: items 1-6 ran; fired: 2; not run: none\n/);
    assert.match(text.replace(/\n {6}/g, ' '), /docs\/REQUIREMENTS\.md is approved, so the fold-in is your own edit: the file is human-only for agents, the session may only show you the text to paste\. Then \/sdlc-kit:plan-slices\.\n$/);
    assert.ok(!text.includes('Set Status: approved'), 'already approved');
  } finally {
    cleanup(root);
  }
});

test('a second run: ids continue after the first run, an id from run 1 is refused, the header says run 2', () => {
  const root = makeProject({ approved: false });
  try {
    assert.ok(start(root).ok);
    write(root, 'docs/requirements-review/product-owner.json', answer([item('PO-1'), item('PO-2', { severity: 'advisory' }), item('PO-3', { severity: 'advisory' })]));
    write(root, 'docs/requirements-review/legal.json', NO_LEGAL_ITEMS);
    assert.ok(render(root, { date: '2026-10-28' }).ok);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'Requirements review');
    const again = start(root);
    assert.ok(again.ok, again.lines.join('\n'));
    assert.match(again.lines[0], /^review {3}run 2 /);
    const brief = readFileSync(join(root, 'docs/requirements-review/brief.txt'), 'utf8');
    assert.match(brief, /^Number your items after run 1: start at PO-4 \(ids from earlier runs are taken\)\.$/m);
    write(root, 'docs/requirements-review/product-owner.json', answer([item('PO-2', { title: 'again' })]));
    let c = check(root);
    assert.deepEqual(c.lines, ['RE-ASK product-owner: item 1 (PO-2): PO-2 was used in an earlier run; number from PO-4', 'legal  0 items   Checklist: items 1-6 ran; fired: none; not run: none'], 'the legal answer from run 1 is still on disk and still valid');
    write(root, 'docs/requirements-review/product-owner.json', answer([item('PO-4', { title: 'new one' })]));
    c = check(root);
    assert.ok(c.ok, c.lines.join('\n'));
    const rendered = render(root, { date: '2026-10-29' });
    assert.match(rendered.text, /^# Requirements review, run 2\n/);
    assert.match(rendered.text, /^- \[ \] PO-4  blocking  missing  R-01  new one$/m);
    assert.ok(!rendered.text.includes('PO-1 '), 'run 1 items are not carried: they were folded in or rejected');
    assert.deepEqual(readState(root).maxIds, { PO: 4 });
    const unrendered = start(root);
    assert.match(unrendered.lines[0], /^review {3}run 3 /);
    assert.ok(start(root).lines[0].startsWith('review   run 3 '), 'start twice without a render keeps the run number');
    assert.equal(runTool('reqreview.mjs', ['start', 'docs/REQUIREMENTS.md'], root).status, 0);
    assert.equal(runTool('reqreview.mjs', ['nope'], root).status, 2);
    assert.ok(existsSync(join(root, 'docs/requirements-review/state.json')));
  } finally {
    cleanup(root);
  }
});

test('with a project legal skill: its rules join the kit rules, the header and the brief name it, a rule outside every legal skill is refused', () => {
  const root = makeProject({ approved: false, legal: true });
  try {
    const r = start(root);
    assert.ok(r.ok, r.lines.join('\n'));
    assert.equal(r.lines[1], 'roles    product-owner, legal');
    assert.equal(r.lines[3], `legal    ${KIT_LEGAL}, .claude/skills/legal-health/SKILL.md`, 'the kit skills first, then the project one');
    const brief = readFileSync(join(root, 'docs/requirements-review/brief.txt'), 'utf8');
    assert.match(brief, /^Legal skills: .*; \.claude\/skills\/legal-health\/SKILL\.md \(LH-01, LH-02\)\. The legal role reads them/m);
    write(root, 'docs/requirements-review/product-owner.json', answer([]));
    write(root, 'docs/requirements-review/legal.json', answer([item('LEG-1', { rule: 'LX-09' })], 'items 1-6 ran; fired: 3; not run: none'));
    let c = check(root);
    assert.equal(c.ok, false);
    assert.match(c.lines.find((l) => l.startsWith('RE-ASK')), /^RE-ASK legal: item 1 \(LEG-1\): rule "LX-09" is not defined in a legal skill \(defined: LD-01, .*LL-11, LH-01, LH-02\)$/);
    write(root, 'docs/requirements-review/legal.json', answer([
      item('LEG-1', { rule: 'LH-01', kind: 'missing', title: 'No retention end date on the medical note' }),
      item('LEG-2', { rule: 'LE-03', severity: 'advisory', kind: 'risk', requirement: 'R-05', title: 'R-05 does not say an issued invoice is read-only' }),
    ], 'items 1-6 ran; fired: 3, 6; not run: none'));
    c = check(root);
    assert.ok(c.ok, c.lines.join('\n'));
    const rendered = render(root, { date: '2026-10-28' });
    assert.ok(rendered.ok, rendered.lines.join('\n'));
    assert.equal(rendered.lines[0], 'docs/REQUIREMENTS-REVIEW.md written (run 1, 2 items: 1 blocking, 1 advisory)');
    assert.match(rendered.text, new RegExp(`^Roles: product-owner, legal \\(opus\\)   Domain skills: none   Legal skills: ${KIT_LEGAL.replace(/[./]/g, '\\$&')}, \\.claude/skills/legal-health/SKILL\\.md$`, 'm'));
    assert.match(rendered.text, /^- \[ \] LEG-1  blocking  missing  R-01  LH-01  No retention end date on the medical note\n/m, 'a project rule shows like a kit rule');
    assert.match(rendered.text, /^- \[ \] LEG-2  advisory  risk  R-05  LE-03  R-05 does not say an issued invoice is read-only\n/m);
    assert.deepEqual(readState(root).maxIds, { LEG: 2 });
    assert.ok(!rendered.text.includes(String.fromCharCode(0x2014)), 'no em dash');
  } finally {
    cleanup(root);
  }
});
