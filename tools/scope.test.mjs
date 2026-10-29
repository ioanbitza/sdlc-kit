import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, expandIds, allowedScope, isInScope, toProjectPath, isHumanOnly, isSetupPath, isDocsLikePath, domainSkills, domainRuleIds, isDomainSkillPath, legalSkills, legalRuleIds, isLegalSkillPath } from './scope.mjs';
import { makeProject, cleanup, runTool, write, PLAN, DOMAIN_SKILL } from './fixtures.mjs';

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
    assert.ok(isInScope('.githooks/pre-commit', scope), 'setup files the gate accepts in a no-slice commit');
    assert.ok(!isInScope('src/a.js', scope));
    assert.ok(!isInScope('index.html', scope));
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

test('paths outside the root and case variants of human-only files are refused', () => {
  assert.equal(toProjectPath('/p/app', '../other/x.js'), '../other/x.js');
  assert.equal(toProjectPath('/p/app', '/etc/passwd'), '../../etc/passwd');
  assert.match(isHumanOnly('/p/app', '../other/x.js'), /outside the project/);
  assert.match(isHumanOnly('/p/app', 'Docs/Decisions/ADR-001.md'), /human decision file/);
  assert.match(isHumanOnly('/p/app', 'agents.md'), /human decision file/);
});

test('with no slice, only the init files may be written under .githooks and .github', () => {
  const scope = { docsOnly: true, files: [] };
  assert.equal(isInScope('.githooks/pre-commit', scope), true);
  assert.equal(isInScope('.github/workflows/gate.yml', scope), true);
  assert.equal(isInScope('.githooks/evil', scope), false);
  assert.equal(isInScope('.github/workflows/other.yml', scope), false);
});

test('setup directories named without a slash and the root documentation files count as docs-like', () => {
  assert.equal(isSetupPath('.githooks'), true);
  assert.equal(isSetupPath('.github'), true);
  assert.equal(isSetupPath('.githooksx'), false);
  assert.equal(isDocsLikePath('README.md'), true);
  assert.equal(isDocsLikePath('LICENSE'), true);
  assert.equal(isDocsLikePath('index.html'), false);
});

test('domain skills: found under .claude/skills/domain-*/SKILL.md with their D-nn rules; none is an empty list', () => {
  const none = makeProject();
  const some = makeProject({ domain: true });
  try {
    assert.deepEqual(domainSkills(none), []);
    const skills = domainSkills(some);
    assert.deepEqual(skills.map((s) => s.path), ['.claude/skills/domain-invoicing/SKILL.md']);
    assert.deepEqual(skills[0].rules, ['D-01', 'D-02', 'D-03']);
    write(some, '.claude/skills/domain-tax/SKILL.md', '---\nname: domain-tax\n---\n## Rules\n### D-01 VAT is 21%\n');
    write(some, '.claude/skills/release-notes/SKILL.md', '---\nname: release-notes\n---\n### D-09 not a domain skill\n');
    assert.deepEqual(domainSkills(some).map((s) => s.name), ['domain-invoicing', 'domain-tax']);
    assert.deepEqual(domainRuleIds('# x\n### D-01 a\ntext D-07 in prose\n## D-12 b\n'), ['D-01', 'D-12']);
    assert.equal(isDomainSkillPath('.claude/skills/domain-invoicing/SKILL.md'), true);
    assert.equal(isDomainSkillPath('.claude/skills/release-notes/SKILL.md'), false);
  } finally {
    cleanup(none);
    cleanup(some);
  }
});

test('an existing domain skill is human-only; a new one may still be drafted', () => {
  const root = makeProject({ domain: true });
  try {
    assert.match(isHumanOnly(root, '.claude/skills/domain-invoicing/SKILL.md'), /domain knowledge, signed by the human/);
    assert.equal(isHumanOnly(root, '.claude/skills/domain-tax/SKILL.md'), null, 'a draft that does not exist yet');
    assert.equal(isHumanOnly(root, '.claude/skills/release-notes/SKILL.md'), null);
  } finally {
    cleanup(root);
  }
});

test('legal skills: the kit ships three, a project adds its own under .claude/skills/legal-*/; an existing project legal skill is human-only', () => {
  const none = makeProject();
  const some = makeProject({ legal: true });
  try {
    const kit = legalSkills(none);
    assert.deepEqual(kit.map((s) => s.path), ['sdlc-kit/skills/legal-data-protection/SKILL.md', 'sdlc-kit/skills/legal-e-invoicing/SKILL.md', 'sdlc-kit/skills/legal-licenses/SKILL.md'], 'the kit skills are always there, so legal never lacks rules');
    assert.ok(kit.every((s) => s.origin === 'kit' && s.file.endsWith(`/skills/${s.name}/SKILL.md`) && s.rules.length >= 8), 'each kit skill is read by its full path and defines its rules');
    assert.deepEqual(kit.map((s) => s.rules[0]), ['LD-01', 'LE-01', 'LL-01'], 'one prefix per kit skill');
    const all = legalSkills(some);
    assert.deepEqual(all.slice(3).map((s) => [s.path, s.file, s.name, s.rules, s.origin]), [['.claude/skills/legal-health/SKILL.md', '.claude/skills/legal-health/SKILL.md', 'legal-health', ['LH-01', 'LH-02'], 'project']]);
    write(some, '.claude/skills/release-notes/SKILL.md', '---\nname: release-notes\n---\n### LX-09 not a legal skill\n');
    assert.equal(legalSkills(some).length, 4);
    assert.deepEqual(legalRuleIds('# x\n### LD-01 a\ntext LD-07 in prose\n## LH-12 b\n### D-03 a domain rule\n'), ['LD-01', 'LH-12']);
    assert.equal(isLegalSkillPath('.claude/skills/legal-health/SKILL.md'), true);
    assert.equal(isLegalSkillPath('.claude/skills/domain-invoicing/SKILL.md'), false);
    assert.equal(isLegalSkillPath('skills/legal-licenses/SKILL.md'), false, 'the kit skill is kit, not project');
    assert.match(isHumanOnly(some, '.claude/skills/legal-health/SKILL.md'), /is the project's legal rules, signed by the human/);
    assert.equal(isHumanOnly(some, '.claude/skills/legal-tax/SKILL.md'), null, 'a draft that does not exist yet');
    assert.equal(isHumanOnly(none, '.claude/skills/legal-health/SKILL.md'), null);
  } finally {
    cleanup(none);
    cleanup(some);
  }
});

test('contract: a docs document with Status: approved or accepted is human-only; a draft is not', async () => {
  const { isApprovedDoc } = await import('./scope.mjs');
  const root = makeProject();
  try {
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: draft\n');
    assert.equal(isHumanOnly(root, 'docs/UI-SPEC.md'), null);
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: approved\n');
    assert.ok(isApprovedDoc(root, 'docs/UI-SPEC.md'));
    assert.match(isHumanOnly(root, 'docs/UI-SPEC.md'), /approved/);
    write(root, 'docs/PLAN.md', PLAN + '\nStatus: approved\n');
    assert.match(isHumanOnly(root, 'docs/PLAN.md'), /approved/);
    assert.equal(isHumanOnly(root, 'docs/NOTES.md'), null, 'a file that does not exist is not frozen');
  } finally {
    cleanup(root);
  }
});

test('decisions: human-only, except a proposed or new ADR for a role whose own paths name docs/decisions/', () => {
  const root = makeProject();
  const architect = { name: 'architect', writes: ['docs/ARCHITECTURE.md', 'docs/decisions/ADR-*.md'] };
  const builder = { name: 'builder', writes: 'slice' };
  try {
    assert.match(isHumanOnly(root, 'docs/decisions/ADR-001-stack.md'), /human decision file/, 'no Status line: written by the human');
    assert.match(isHumanOnly(root, 'docs/decisions/ADR-001-stack.md', architect), /human decision file/);
    assert.equal(isHumanOnly(root, 'docs/decisions/ADR-005-money.md', architect), null, 'a new ADR the architect proposes');
    assert.match(isHumanOnly(root, 'docs/decisions/ADR-005-money.md', builder), /human decision file/);
    write(root, 'docs/decisions/ADR-005-money.md', '# ADR-005\nStatus: proposed\n');
    assert.equal(isHumanOnly(root, 'docs/decisions/ADR-005-money.md', architect), null, 'still proposed: the architect may revise it');
    write(root, 'docs/decisions/ADR-005-money.md', '# ADR-005\nStatus: accepted\n');
    assert.match(isHumanOnly(root, 'docs/decisions/ADR-005-money.md', architect), /human decision file/, 'accepted: frozen');
  } finally {
    cleanup(root);
  }
});

test('own paths: allowedScope with a pattern list ignores the slice and matches only those paths', async () => {
  const { isTesterSpec } = await import('./scope.mjs');
  const root = makeProject({ slice: 'S1' });
  try {
    const scope = allowedScope(root, ['tests/**/*.spec.mjs', 'docs/MANUAL-CHECKS.md']);
    assert.deepEqual(scope.patterns, ['tests/**/*.spec.mjs', 'docs/MANUAL-CHECKS.md']);
    assert.ok(isInScope('tests/customers.spec.mjs', scope));
    assert.ok(isInScope('docs/MANUAL-CHECKS.md', scope));
    assert.ok(!isInScope('src/domain/customers.js', scope), 'in the slice, not in the tester\'s paths');
    assert.ok(isTesterSpec('tests/a/b.spec.js'));
    assert.ok(!isTesterSpec('tests/a.test.mjs'));
    assert.ok(!isTesterSpec('src/a.spec.mjs'));
  } finally {
    cleanup(root);
  }
});
