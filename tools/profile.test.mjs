import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeProject, cleanup, write, runTool } from './fixtures.mjs';
import { adrTags, disciplineSkills, profileFor, profile, activeRules, readingList, disciplineRuleIds } from './profile.mjs';
import { KIT_ROOT } from './roles.mjs';

/** A throwaway kit root with three discipline skills: one always on, one behind a tag, one for another stack. */
function fakeKit() {
  const kit = mkdtempSync(join(tmpdir(), 'sdlc-kit-fake-'));
  const skill = (name, tags, roles, prefix, n) => {
    mkdirSync(join(kit, 'skills', name), { recursive: true });
    const rules = Array.from({ length: n }, (_, i) => `### ${prefix}-${String(i + 1).padStart(2, '0')} Rule ${i + 1}\nWhy: w\nSource: s\nApplies to: code\n`).join('\n');
    writeFileSync(join(kit, 'skills', name, 'SKILL.md'), `---\nname: ${name}\nuser-invocable: false\ndescription: d\nx-tags: [${tags.join(', ')}]\nx-roles: [${roles.join(', ')}]\n---\n\n# ${name}\n\n## Rules\n${rules}`);
  };
  skill('discipline-coding-principles', [], ['architect', 'builder', 'finder-contract'], 'CP', 3);
  skill('stack-dotnet', ['dotnet', 'csharp'], ['architect', 'builder', 'tester'], 'NET', 2);
  skill('stack-javascript', ['javascript', 'node'], ['builder'], 'JS', 2);
  return kit;
}

test('adrTags reads every Tags: line of the decisions, lower-cased, and skips a superseded ADR', () => {
  const root = makeProject();
  try {
    assert.deepEqual([...adrTags(root)], []);
    write(root, 'docs/decisions/ADR-001-stack.md', '# ADR-001: stack\n\nDate: 2026-10-29. Status: accepted. Author: Ioan.\nTags: dotnet, EF-Core, rest\n\n## Decision\n- .NET 8\n');
    write(root, 'docs/decisions/ADR-002-old.md', '# ADR-002: old\n\nDate: 2026-10-01. Status: superseded by ADR-003. Author: Ioan.\nTags: javascript\n');
    write(root, 'docs/decisions/ADR-003-ui.md', '# ADR-003: ui\n\nStatus: proposed.\nTags: web-ui\n');
    assert.deepEqual([...adrTags(root)].sort(), ['dotnet', 'ef-core', 'rest', 'web-ui']);
  } finally {
    cleanup(root);
  }
});

test('the profile: always-on skills for every role listed, tagged skills only when an ADR carries the tag, per role', () => {
  const kit = fakeKit();
  const root = makeProject();
  try {
    const none = profile(root, kit);
    assert.deepEqual(none.roles.builder, ['discipline-coding-principles']);
    assert.equal(none.inactive.length, 2);
    write(root, 'docs/decisions/ADR-001-stack.md', '# ADR-001\nStatus: accepted.\nTags: dotnet\n');
    const p = profile(root, kit);
    assert.deepEqual(p.tags, ['dotnet']);
    assert.deepEqual(p.roles.builder, ['discipline-coding-principles', 'stack-dotnet']);
    assert.deepEqual(p.roles.tester, ['stack-dotnet']);
    assert.deepEqual(p.roles.architect, ['discipline-coding-principles', 'stack-dotnet']);
    assert.deepEqual(p.roles.devops, []);
    assert.deepEqual(profileFor(root, 'builder', kit).map((s) => s.name), ['discipline-coding-principles', 'stack-dotnet']);
    assert.deepEqual(profileFor(root, 'Builder', kit).map((s) => s.name), ['discipline-coding-principles', 'stack-dotnet'], 'role names are case-insensitive');
    const rules = activeRules(root, kit);
    assert.deepEqual([...rules.keys()], ['CP-01', 'CP-02', 'CP-03', 'NET-01', 'NET-02'], 'the javascript stack is off, its rules cannot be cited');
    assert.equal(rules.get('NET-01').name, 'stack-dotnet');
    assert.deepEqual(readingList(root, 'tester', kit), ['sdlc-kit/skills/stack-dotnet/SKILL.md (NET-01 to NET-02)']);
  } finally {
    cleanup(root);
    rmSync(kit, { recursive: true, force: true });
  }
});

test('a project adds its own discipline skill under .claude/skills/discipline-*, read after the kit\'s', () => {
  const kit = fakeKit();
  const root = makeProject();
  try {
    write(root, '.claude/skills/discipline-house-style/SKILL.md', '---\nname: discipline-house-style\ndescription: d\nx-tags: []\nx-roles: [builder]\n---\n\n## Rules\n### HS-01 Files end with a newline\nWhy: w\nSource: s\nApplies to: code\n');
    const skills = disciplineSkills(root, kit);
    assert.deepEqual(skills.map((s) => `${s.origin}:${s.name}`), ['kit:discipline-coding-principles', 'kit:stack-dotnet', 'kit:stack-javascript', 'project:discipline-house-style']);
    assert.deepEqual(profileFor(root, 'builder', kit).map((s) => s.name), ['discipline-coding-principles', 'discipline-house-style']);
    assert.equal(activeRules(root, kit).get('HS-01').path, '.claude/skills/discipline-house-style/SKILL.md');
  } finally {
    cleanup(root);
    rmSync(kit, { recursive: true, force: true });
  }
});

test('disciplineRuleIds reads two- to four-letter prefixes from headings only', () => {
  assert.deepEqual(disciplineRuleIds('### CP-01 a\n#### NET-12 b\ntext CP-99\n## TS-3 c\n### lower-01 no\n'), ['CP-01', 'NET-12', 'TS-3']);
});

test('the CLI prints the tags and a line per role, or a role\'s reading list', () => {
  const root = makeProject();
  try {
    write(root, 'docs/decisions/ADR-001-stack.md', '# ADR-001\nStatus: accepted.\nTags: dotnet\n');
    const all = runTool('profile.mjs', [], root);
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /^tags\s+dotnet/m);
    const builder = runTool('profile.mjs', ['builder'], root);
    assert.equal(builder.status, 0, builder.stderr);
    const nobody = runTool('profile.mjs', ['nobody'], root);
    assert.match(nobody.stdout, /no discipline skill applies/);
  } finally {
    cleanup(root);
  }
});

test('the kit\'s own discipline skills parse: a name, roles, a prefix, numbered rules in one sequence, no em dash', () => {
  const skills = disciplineSkills(makeProjectDir(), KIT_ROOT).filter((s) => s.origin === 'kit');
  for (const s of skills) {
    assert.ok(s.roles.length > 0, `${s.name}: x-roles`);
    assert.ok(s.prefix, `${s.name}: a rule prefix`);
    assert.ok(s.rules.length >= 8, `${s.name}: at least eight rules (${s.rules.length})`);
    const numbers = s.rules.map((r) => Number(r.split('-')[1]));
    assert.deepEqual(numbers, numbers.map((_, i) => i + 1), `${s.name}: rules numbered 1..n without a gap`);
    assert.ok(s.rules.every((r) => r.startsWith(`${s.prefix}-`)), `${s.name}: one prefix`);
    const text = readFileSync(s.file, 'utf8');
    assert.ok(!text.includes('—'), `${s.name}: no em dash`);
    assert.ok(/## What a reviewer checks/.test(text), `${s.name}: a reviewer section`);
  }
  const prefixes = skills.map((s) => s.prefix);
  assert.equal(new Set(prefixes).size, prefixes.length, `prefixes are unique: ${prefixes.join(', ')}`);
});

function makeProjectDir() {
  return mkdtempSync(join(tmpdir(), 'sdlc-kit-empty-'));
}
