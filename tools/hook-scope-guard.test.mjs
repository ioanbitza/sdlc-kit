import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, cleanup, runHook, editInput, writeInput, write, PLAN, DOMAIN_SKILL, LEGAL_SKILL } from './fixtures.mjs';
import { decide, contentProblem, skillProblem } from './hook-scope-guard.mjs';
import { KIT_ROOT } from './roles.mjs';

const guard = (input) => runHook('hook-scope-guard.mjs', input);

const JUDGE = new Map([['finder-security', { name: 'finder-security', writes: [], known: true }], ['builder', { name: 'builder', writes: 'slice', known: true }]]);

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
    assert.equal(w.stderr.trim(), 'Denied: src/ui/main.js would use innerHTML, which AGENTS.md rule 3 forbids; render user text with textContent or DOM APIs.');
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
    assert.equal(guard(writeInput(root, 'docs/NOTES.md')).status, 0);
    assert.match(guard(writeInput(root, 'docs/REVIEW.md')).stderr, /written by the review scripts/, 'the verdict is rendered, never typed');
    assert.match(guard(writeInput(root, 'docs/review/1/findings.json')).stderr, /written by the review scripts/);
    assert.equal(guard(writeInput(root, 'docs/review/1/finder-security.json', '[]')).status, 0, 'the clerk saves an answer file');
    assert.equal(guard(writeInput(root, 'docs/review/1/verifier.json', '{}')).status, 0);
    assert.equal(guard(writeInput(root, '.githooks/pre-commit', readFileSync(join(KIT_ROOT, 'templates/githooks/pre-commit'), 'utf8'))).status, 0, 'init setup files are allowed with no slice when they hold the template');
    assert.match(guard(writeInput(root, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n')).stderr, /gate's own installation/, 'a hook that is not the template turns the gate off');
    assert.match(guard(writeInput(root, '.github/workflows/gate.yml')).stderr, /gate's own installation/, 'the workflow holds the template or is the human\'s');
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

test('a judge (x-writes: []) may not Edit or Write anything, even docs', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const input = { ...writeInput(root, 'docs/REVIEW.md', '# review'), agent_type: 'sdlc-kit:finder-security' };
    assert.equal(decide(input, JUDGE), 'finder-security writes nothing; it reports, the human and the builder change files.');
    const code = { ...editInput(root, 'src/domain/customers.js'), agent_type: 'finder-security' };
    assert.equal(decide(code, JUDGE), 'finder-security writes nothing; it reports, the human and the builder change files.');
    const builder = { ...editInput(root, 'src/domain/customers.js'), agent_type: 'sdlc-kit:builder' };
    assert.equal(decide(builder, JUDGE), null, 'the builder keeps the slice rule');
    const explore = { ...writeInput(root, 'docs/notes.md'), agent_type: 'Explore' };
    assert.match(decide(explore, JUDGE), /^S1 allows /, 'an unknown agent gets the main rules');
  } finally {
    cleanup(root);
  }
});

test('the real kit agents through the hook process: finders and verifier denied, builder allowed', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    for (const agent of ['sdlc-kit:finder-correctness', 'sdlc-kit:finder-security', 'sdlc-kit:finder-contract', 'sdlc-kit:verifier']) {
      const r = guard({ ...writeInput(root, 'docs/REVIEW.md'), agent_type: agent });
      assert.equal(r.status, 2, agent);
      assert.equal(r.stderr.trim(), `${agent.split(':').pop()} writes nothing; it reports, the human and the builder change files.`);
    }
    const ok = guard({ ...editInput(root, 'src/domain/customers.js'), agent_type: 'sdlc-kit:builder' });
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    cleanup(root);
  }
});

test('content guard: unfinished-work words under src/ and tests/, weak tests under tests/, nothing under docs/', () => {
  assert.match(contentProblem('src/domain/money.js', '// TODO fix rounding'), /would contain "TODO", which AGENTS.md rule 6 forbids/);
  assert.match(contentProblem('src/ui/main.js', 'return null; // for now'), /"for now"/);
  assert.match(contentProblem('src/ui/main.js', '// a placeholder until S4'), /"placeholder"/);
  assert.equal(contentProblem('src/ui/main.js', "input.placeholder = 'Customer name';"), null, 'the DOM attribute is fine');
  assert.equal(contentProblem('index.html', '<input placeholder="Name">'), null, 'checked under src/ and tests/ only');
  assert.match(contentProblem('tests/money.test.js', "test.skip('R-15 boundary', () => {})"), /"test.skip", which AGENTS.md rule 2 forbids/);
  assert.match(contentProblem('tests/money.test.js', "test.only('R-15', () => {})"), /"\.only\("/);
  assert.match(contentProblem('tests/money.test.js', 'assert.ok(true)'), /"assert.ok\(true\)"/);
  assert.equal(contentProblem('src/domain/money.js', 'assert.ok(true)'), null, 'weak-test words are checked in tests/ only');
  assert.match(contentProblem('src/ui/main.js', 'el.insertAdjacentHTML("beforeend", x)'), /would use insertAdjacentHTML/);
  assert.match(contentProblem('index.html', '<script>document.write(x)</script>'), /would use document.write/);
  assert.equal(contentProblem('docs/REVIEW.md', 'TODO: innerHTML in main.js, test.skip found'), null);
  assert.equal(contentProblem('docs/PLAN.md', 'placeholder text, for now'), null);
  assert.equal(contentProblem('docs/review/1/finder-security.json', '[{"evidence":"el.innerHTML = name at main.js:12"}]'), null, 'finder answers quote the words');
});

test('content guard through the hook: a TODO in a test is denied with the rule', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const r = guard(writeInput(root, 'tests/customers.test.js', "// TODO\ntest('R-01 x', () => {})"));
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), 'Denied: tests/customers.test.js would contain "TODO", which AGENTS.md rule 6 forbids: no unfinished work in code, finish it or stop and ask.');
  } finally {
    cleanup(root);
  }
});

test("the kit's own files cannot be written from a project session", () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const r = guard(writeInput(root, `${KIT_ROOT}/tools/gate.mjs`, 'x'));
    assert.equal(r.status, 2);
    assert.match(r.stderr.trim(), /is part of the kit \(hooks, tools, agents\); the kit changes in its own repository/);
  } finally {
    cleanup(root);
  }
});

test('MultiEdit, NotebookEdit and any tool naming a file go through the guard; HTML sinks are checked in code files anywhere', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const multi = { cwd: root, tool_name: 'MultiEdit', tool_input: { file_path: 'src/domain/customers.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: '// TODO later' }] } };
    assert.match(decide(multi, JUDGE), /would contain "TODO"/);
    const unknown = { cwd: root, tool_name: 'FutureWriteTool', tool_input: { file_path: 'index.html', content: 'x' } };
    assert.match(decide(unknown, JUDGE), /^S1 allows /, 'an unknown tool with a file_path is judged like Write');
    const unknownEdits = { cwd: root, tool_name: 'BatchEdit', tool_input: { file_path: 'AGENTS.md', edits: [] } };
    assert.match(decide(unknownEdits, JUDGE), /human decision file/);
    const notebook = { cwd: root, tool_name: 'NotebookEdit', tool_input: { notebook_path: 'docs/decisions/x.ipynb', new_source: 'x' } };
    assert.match(decide(notebook, JUDGE), /human decision file/);
    const asJudge = { ...editInput(root, 'src/domain/customers.js'), agent_type: 'sdlc-kit:finder-security' };
    assert.equal(decide(asJudge, JUDGE), 'finder-security writes nothing; it reports, the human and the builder change files.');
    assert.equal(contentProblem('README.md', 'Never use innerHTML here.'), null, 'prose is exempt');
    assert.equal(contentProblem('.github/workflows/gate.yml', 'innerHTML'), null);
    assert.equal(contentProblem('docs/review/1/finder-security.json', 'innerHTML'), null, 'docs/** is exempt');
    assert.match(contentProblem('index.html', '<script>x.innerHTML = y</script>'), /would use innerHTML/);
    assert.match(contentProblem('src/ui/main.js', 'x.innerHTML = y'), /would use innerHTML/);
    assert.match(contentProblem('scripts/Build.MJS', 'x.innerHTML = y'), /would use innerHTML/, 'any code file, case-insensitive extension');
    assert.match(contentProblem('pages/about.HTM', 'document.write(x)'), /would use document.write/);
  } finally {
    cleanup(root);
  }
});

test('kit files are recognised through a different spelling of the path', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const spelled = process.platform === 'darwin' ? KIT_ROOT.toUpperCase() : KIT_ROOT;
    const r = guard(writeInput(root, `${spelled}/agents/verifier.md`, 'x'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is part of the kit/);
    const viaDots = guard(writeInput(root, `${KIT_ROOT}/tools/../tools/gate.mjs`, 'x'));
    assert.equal(viaDots.status, 2);
  } finally {
    cleanup(root);
  }
});

test('project skills: the main session writes .claude/skills/** with no slice; builder, judges, other agents, an active slice and settings.json are refused', () => {
  const idle = makeProject();
  const good = '---\nname: release-notes\ndescription: Write the release notes from the merged PRs.\nargument-hint: <version>\n---\n# Steps\n1. Read docs/PR.md and the tools: section of the README.\n2. Mention TODO items as open, placeholder text is fine here.\n';
  try {
    assert.equal(guard(writeInput(idle, '.claude/skills/release-notes/SKILL.md', good)).status, 0, 'main, no slice: allowed, content words do not apply');
    const builder = guard({ ...writeInput(idle, '.claude/skills/release-notes/SKILL.md', good), agent_type: 'sdlc-kit:builder' });
    assert.equal(builder.status, 2);
    assert.equal(builder.stderr.trim(), 'builder writes only its slice; project skills under .claude/skills/ are written by the main session.');
    const judge = guard({ ...writeInput(idle, '.claude/skills/release-notes/SKILL.md', good), agent_type: 'sdlc-kit:verifier' });
    assert.equal(judge.stderr.trim(), 'verifier writes nothing; it reports, the human and the builder change files.');
    const other = guard({ ...writeInput(idle, '.claude/skills/release-notes/SKILL.md', good), agent_type: 'Explore' });
    assert.equal(other.status, 2, 'an agent the kit does not define is not the main session');
    const settings = guard(writeInput(idle, '.claude/settings.json', '{}'));
    assert.equal(settings.status, 2);
    assert.equal(settings.stderr.trim(), 'Denied: .claude/settings.json is a human decision file; the human edits it, you ask.');
    for (const text of [
      '---\nname: x\ntools: Read, Bash\n---\n# Steps\n',
      '---\nname: x\nallowed-tools: Bash\n---\n# Steps\n',
      '---\nname: x\ndisallowedTools: Edit\n---\n# Steps\n',
      '---\nname: x\nhooks:\n  PreToolUse: []\n---\n# Steps\n',
      '# Steps\nno frontmatter\n',
      '---\nname: x\nthis line does not parse\n---\n',
      '---\nname: x\n---\n# Steps\nToday is !`date`.\n',
      '---\nname: x\n---\n# Steps\nRun node "${CLAUDE_PLUGIN_ROOT}/tools/gate.mjs"\n',
      '---\nname: x\n---\n# Steps\necho S9 > .sdlc/slice\n',
    ]) {
      const r = guard(writeInput(idle, '.claude/skills/release-notes/SKILL.md', text));
      assert.equal(r.status, 2, text);
      assert.equal(r.stderr.trim(), 'Denied: a project skill may not grant tools or touch the kit; keep it to steps and a description.', text);
    }
    assert.equal(skillProblem(good), null);
    assert.equal(guard(writeInput(idle, '.claude/skills/release-notes/helper.js', 'x.innerHTML = y')).status, 2, 'a supporting file without frontmatter is refused too');
    for (const body of ['```!\ndate\n```\n', '! `date`\n', 'The .SDLC folder holds state.\n', `See ${KIT_ROOT.toUpperCase()}/tools for the gate.\n`, 'a .sdlc mention\n']) {
      assert.equal(skillProblem('---\nname: x\n---\n' + body), 'Denied: a project skill may not grant tools or touch the kit; keep it to steps and a description.', body);
    }
    assert.equal(skillProblem('---\nname: x\n---\nAn exclamation! And a `code span` later.\n'), null, 'an exclamation mark far from a backtick is prose');
    const edit = guard(editInput(idle, '.claude/skills/release-notes/SKILL.md', { new_string: 'x' }));
    assert.equal(edit.status, 2);
    assert.equal(edit.stderr.trim(), 'Denied: rewrite the whole skill file with Write, so it can be checked as one piece.');
    const multi = guard({ cwd: idle, tool_name: 'MultiEdit', tool_input: { file_path: '.claude/skills/release-notes/SKILL.md', edits: [{ old_string: 'a', new_string: 'b' }] } });
    assert.equal(multi.stderr.trim(), 'Denied: rewrite the whole skill file with Write, so it can be checked as one piece.');
    const notebook = guard({ cwd: idle, tool_name: 'NotebookEdit', tool_input: { notebook_path: '.claude/skills/release-notes/notes.ipynb', new_source: 'x' } });
    assert.equal(notebook.stderr.trim(), 'Denied: rewrite the whole skill file with Write, so it can be checked as one piece.');
  } finally {
    cleanup(idle);
  }
  const active = makeProject({ slice: 'S1' });
  try {
    const r = guard(writeInput(active, '.claude/skills/release-notes/SKILL.md', good));
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), 'S1 allows src/domain/customers.js, tests/customers.test.js, docs/MANUAL-CHECKS.md. .claude/skills/release-notes/SKILL.md is not in the plan. Stop and ask the human.');
  } finally {
    cleanup(active);
  }
});

test('domain skills: the main session may draft one; once it exists, Write and Edit are refused as human-only', () => {
  const root = makeProject();
  try {
    assert.equal(guard(writeInput(root, '.claude/skills/domain-invoicing/SKILL.md', DOMAIN_SKILL)).status, 0, 'the first draft is a project skill like any other');
    const again = makeProject({ domain: true });
    try {
      const w = guard(writeInput(again, '.claude/skills/domain-invoicing/SKILL.md', DOMAIN_SKILL));
      assert.equal(w.status, 2);
      assert.equal(w.stderr.trim(), "Denied: .claude/skills/domain-invoicing/SKILL.md is the project's domain knowledge, signed by the human; the human edits it, you ask.");
      const e = guard(editInput(again, '.claude/skills/domain-invoicing/SKILL.md', { new_string: 'x' }));
      assert.equal(e.status, 2);
      assert.match(e.stderr, /signed by the human/, 'the human-only sentence, not the whole-file rule');
    } finally {
      cleanup(again);
    }
  } finally {
    cleanup(root);
  }
});

test('legal skills: the main session may draft one; once it exists, Write and Edit are refused as human-only', () => {
  const root = makeProject();
  try {
    assert.equal(guard(writeInput(root, '.claude/skills/legal-health/SKILL.md', LEGAL_SKILL)).status, 0, 'the first draft is a project skill like any other');
    const again = makeProject({ legal: true });
    try {
      const w = guard(writeInput(again, '.claude/skills/legal-health/SKILL.md', LEGAL_SKILL));
      assert.equal(w.status, 2);
      assert.equal(w.stderr.trim(), "Denied: .claude/skills/legal-health/SKILL.md is the project's legal rules, signed by the human; the human edits it, you ask.");
      const e = guard(editInput(again, '.claude/skills/legal-health/SKILL.md', { new_string: 'x' }));
      assert.equal(e.status, 2);
      assert.match(e.stderr, /legal rules, signed by the human/);
    } finally {
      cleanup(again);
    }
  } finally {
    cleanup(root);
  }
});

test('write matrix: a role with its own paths writes those and nothing else, slice or no slice', async () => {
  const { decide } = await import('./hook-scope-guard.mjs');
  const roles = new Map([
    ['tester', { name: 'tester', writes: ['tests/**/*.spec.mjs', 'docs/MANUAL-CHECKS.md'], known: true }],
    ['architect', { name: 'architect', writes: ['docs/ARCHITECTURE.md', 'docs/decisions/ADR-*.md'], known: true }],
    ['builder', { name: 'builder', writes: 'slice', known: true }],
  ]);
  const root = makeProject({ slice: 'S1' });
  try {
    const as = (agent, file, content = 'x') => decide({ ...writeInput(root, file, content), agent_type: `sdlc-kit:${agent}` }, roles);
    assert.equal(as('tester', 'tests/customers.spec.mjs', 'test("R-01 x", () => {});'), null);
    assert.equal(as('tester', 'docs/MANUAL-CHECKS.md'), null);
    assert.match(as('tester', 'src/domain/customers.js'), /tester writes only tests\/\*\*\/\*\.spec\.mjs, docs\/MANUAL-CHECKS\.md/);
    assert.match(as('tester', 'docs/PLAN.md'), /cannot change while S1 is active/, 'the plan is frozen for everyone while a slice runs');
    assert.equal(as('architect', 'docs/ARCHITECTURE.md'), null);
    assert.equal(as('architect', 'docs/decisions/ADR-005-money.md', '# ADR-005\nStatus: proposed\n'), null);
    assert.match(as('architect', 'docs/decisions/ADR-001-stack.md'), /human decision file/);
    assert.match(as('architect', 'AGENTS.md'), /human decision file/, 'human-only beats the matrix');
    assert.match(as('builder', 'tests/customers.spec.mjs'), /tester's test/);
    assert.equal(as('builder', 'tests/customers.test.js', 'test("R-01 x", () => {});'), null);
    assert.match(decide(writeInput(root, 'tests/customers.spec.mjs'), roles), /tester's test/, 'the main session is a builder too');
  } finally {
    cleanup(root);
  }
});

test('contract: an approved plan or UI spec is denied to every role; a draft is not', async () => {
  const { decide } = await import('./hook-scope-guard.mjs');
  const root = makeProject();
  try {
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: draft\n');
    assert.equal(decide(editInput(root, 'docs/UI-SPEC.md')), null);
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: approved\n');
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md')), /approved/);
    write(root, 'docs/PLAN.md', PLAN + '\nStatus: approved\n');
    assert.match(decide(editInput(root, 'docs/PLAN.md')), /approved/);
  } finally {
    cleanup(root);
  }
});

test('write guard: a Write that shrinks a document under docs/ by more than 40% is denied; Edit and small files are not', async () => {
  const { decide, shrinkProblem } = await import('./hook-scope-guard.mjs');
  const root = makeProject();
  try {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    write(root, 'docs/NOTES.md', long);
    assert.match(decide(writeInput(root, 'docs/NOTES.md', 'line 0\nline 1\n')), /would shrink docs\/NOTES\.md from 60 lines to 3/);
    assert.equal(decide(writeInput(root, 'docs/NOTES.md', long + '\nmore')), null);
    assert.equal(decide(writeInput(root, 'docs/NOTES.md', long.split('\n').slice(0, 40).join('\n'))), null, 'a third shorter is still a rewrite, not a wipe');
    assert.equal(decide(editInput(root, 'docs/NOTES.md')), null, 'Edit changes one place');
    write(root, 'docs/SHORT.md', 'a\nb\nc\n');
    assert.equal(decide(writeInput(root, 'docs/SHORT.md', 'a')), null, 'short files are rewritten freely');
    assert.equal(shrinkProblem(root, 'src/x.js', writeInput(root, 'src/x.js', '')), null, 'code is not a document');
  } finally {
    cleanup(root);
  }
});

test('content: console.log and debugger are refused under src/, allowed in tests/ and docs/', async () => {
  const { contentProblem } = await import('./hook-scope-guard.mjs');
  assert.match(contentProblem('src/ui/main.js', 'console.log(x)'), /console\.log/);
  assert.match(contentProblem('src/domain/a.js', 'debugger;'), /debugger/);
  assert.equal(contentProblem('src/cli.js', 'console.log(usage)'), null, 'a CLI under src/ prints; only ui and domain code may not');
  assert.equal(contentProblem('tests/a.test.js', 'console.log(x)'), null);
  assert.equal(contentProblem('docs/x.md', 'console.log(x)'), null);
  assert.equal(contentProblem('src/a.js', 'console.error(e)'), null, 'error output is not debug output');
});

test('no self-approval: a role may not write Status: approved or accepted into a document; the human types that line', async () => {
  const { decide } = await import('./hook-scope-guard.mjs');
  const roles = new Map([['architect', { name: 'architect', writes: ['docs/ARCHITECTURE.md', 'docs/decisions/ADR-*.md'], known: true }]]);
  const root = makeProject();
  try {
    assert.match(decide({ ...writeInput(root, 'docs/decisions/ADR-009.md', '# ADR-009\nStatus: accepted\n'), agent_type: 'sdlc-kit:architect' }, roles), /human's signature/);
    assert.equal(decide({ ...writeInput(root, 'docs/decisions/ADR-009.md', '# ADR-009\nStatus: proposed\n'), agent_type: 'sdlc-kit:architect' }, roles), null);
    assert.match(decide(writeInput(root, 'docs/PLAN.md', PLAN + '\nStatus: approved\n')), /human's signature/);
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'Status: draft', new_string: 'Status: approved' })), /human's signature/);
  } finally {
    cleanup(root);
  }
});

test('no self-approval is judged on the whole file after the edit, not on the fragment', async () => {
  const { decide } = await import('./hook-scope-guard.mjs');
  const root = makeProject();
  try {
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: dra\nft\n');
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'dra\nft', new_string: 'approved' })), /human's signature/);
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: approvedish\n');
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'approvedish', new_string: 'approved' })), /human's signature/);
    const multi = { cwd: root, tool_name: 'MultiEdit', tool_input: { file_path: 'docs/UI-SPEC.md', edits: [{ old_string: 'ish', new_string: '' }] } };
    assert.match(decide(multi), /human's signature/);
    assert.equal(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'approvedish', new_string: 'draft' })), null);
  } finally {
    cleanup(root);
  }
});

test('no self-approval fails closed: an approval in the fragment, or an old_string that is not in the file, is refused', async () => {
  const { decide, resultingText } = await import('./hook-scope-guard.mjs');
  const root = makeProject();
  try {
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: draft\n');
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'not there', new_string: 'Status: approved' })), /human's signature/);
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'Status: xx', new_string: 'Status: appr' })), /old_string is not in the file/);
    assert.equal(resultingText(root, 'docs/UI-SPEC.md', editInput(root, 'docs/UI-SPEC.md', { old_string: 'not there', new_string: 'x' })), null);
    assert.match(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'nothing like it', new_string: 'plain text' })), /cannot be checked/, 'a stale edit of a Status-bearing document fails closed');
    assert.equal(decide(editInput(root, 'docs/UI-SPEC.md', { old_string: 'draft', new_string: 'in review' })), null);
  } finally {
    cleanup(root);
  }
});

test('a write through a symbolic link is refused whatever the path says', async () => {
  const { decide } = await import('./hook-scope-guard.mjs');
  const { symlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = makeProject();
  try {
    symlinkSync('/tmp', join(root, 'docs/linked'));
    assert.match(decide(writeInput(root, 'docs/linked/UI-SPEC.md', '# UI\nStatus: draft\n')), /symbolic link/);
    assert.equal(decide(writeInput(root, 'docs/UI-SPEC.md', '# UI\nStatus: draft\n')), null);
  } finally {
    cleanup(root);
  }
});
