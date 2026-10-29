import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontmatter, parseWrites, loadRoles, roleOf, roleName, isJudge, MAIN, KIT_ROOT } from './roles.mjs';
import { runTool } from './fixtures.mjs';

function kitWith(agents) {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-roles-'));
  mkdirSync(join(root, 'agents'));
  for (const [file, text] of Object.entries(agents)) writeFileSync(join(root, 'agents', file), text);
  return root;
}

test('parseFrontmatter reads keys, quoted values and flow lists', () => {
  const fm = parseFrontmatter('---\nname: verifier\nmodel: opus\ntools: Read, Grep\nx-writes: []\nx-list: [a, "b"]\n---\n# body\nx-writes: slice\n');
  assert.equal(fm.name, 'verifier');
  assert.deepEqual(fm['x-writes'], []);
  assert.deepEqual(fm['x-list'], ['a', 'b']);
  assert.deepEqual(parseFrontmatter('no frontmatter'), {});
});

test('parseWrites: [] and missing are a judge, slice is the builder, anything odd is read as []', () => {
  assert.deepEqual(parseWrites([]), []);
  assert.deepEqual(parseWrites(undefined), []);
  assert.equal(parseWrites('slice'), 'slice');
  assert.deepEqual(parseWrites('everything'), []);
});

test('loadRoles reads every agent file; roleOf matches the suffix after the plugin prefix', () => {
  const root = kitWith({
    'builder.md': '---\nname: builder\nmodel: sonnet\nx-writes: slice\n---\n',
    'finder-security.md': '---\nname: finder-security\nmodel: opus\nx-writes: []\n---\n',
    'verifier.md': '---\nname: verifier\nmodel: opus\n---\n',
  });
  try {
    const roles = loadRoles(root);
    assert.deepEqual([...roles.keys()], ['builder', 'finder-security', 'verifier']);
    assert.equal(roles.get('builder').writes, 'slice');
    assert.ok(isJudge(roles.get('finder-security')));
    assert.ok(isJudge(roles.get('verifier')), 'no x-writes key means []');
    assert.ok(!isJudge(roles.get('builder')));

    assert.equal(roleOf({ agent_type: 'sdlc-kit:finder-security' }, roles).name, 'finder-security');
    assert.equal(roleOf({ agent_type: 'finder-security' }, roles).name, 'finder-security');
    assert.equal(roleOf({ agent_type: 'sdlc-kit:builder' }, roles).writes, 'slice');
    assert.equal(roleOf({}, roles), MAIN, 'no agent_type is the main session');
    const other = roleOf({ agent_type: 'Explore' }, roles);
    assert.equal(other.known, false);
    assert.equal(other.writes, 'main', 'an agent the kit does not define gets the main rules');
    assert.equal(roleName(''), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the kit itself: the builder writes the slice, every other agent is a judge', () => {
  const roles = loadRoles(KIT_ROOT);
  assert.ok(roles.has('builder'));
  assert.equal(roles.get('builder').writes, 'slice');
  for (const [name, role] of roles) if (name !== 'builder') assert.ok(isJudge(role), `${name} should be a judge`);
});

test('CLI prints the table and resolves one agent_type', () => {
  const table = runTool('roles.mjs', [], KIT_ROOT);
  assert.equal(table.status, 0);
  assert.match(table.stdout, /^role\s+model\s+writes/);
  assert.match(table.stdout, /builder\s+sonnet\s+the active slice files/);
  const one = runTool('roles.mjs', ['sdlc-kit:builder'], KIT_ROOT);
  assert.match(one.stdout, /^sdlc-kit:builder -> builder: writes the active slice files/);
});

test('the kit itself: legal and finder-legal are judges and the table lists them', () => {
  const roles = loadRoles(KIT_ROOT);
  for (const name of ['legal', 'finder-legal']) {
    assert.ok(roles.has(name), `${name} is a kit agent`);
    assert.ok(isJudge(roles.get(name)), `${name} writes nothing`);
    assert.equal(roles.get(name).model, 'opus');
  }
  const table = runTool('roles.mjs', [], KIT_ROOT);
  assert.match(table.stdout, /^legal\s+opus\s+nothing$/m);
  assert.match(table.stdout, /^finder-legal\s+opus\s+nothing$/m);
  assert.match(runTool('roles.mjs', ['sdlc-kit:finder-legal'], KIT_ROOT).stdout, /^sdlc-kit:finder-legal -> finder-legal: writes nothing/);
});

test('write matrix: a list of patterns is a role with its own paths; ** spans folders, * stays in one, a folder/ covers it', async () => {
  const { patternToRegExp, matchesOwnPaths, hasOwnPaths } = await import('./roles.mjs');
  assert.deepEqual(parseWrites(['docs/PLAN.md', ' tests/**/*.spec.mjs ']), ['docs/PLAN.md', 'tests/**/*.spec.mjs']);
  const tester = { name: 'tester', writes: ['tests/**/*.spec.mjs', 'docs/MANUAL-CHECKS.md'] };
  assert.ok(hasOwnPaths(tester));
  assert.ok(!hasOwnPaths({ writes: [] }));
  assert.ok(!hasOwnPaths({ writes: 'slice' }));
  assert.ok(matchesOwnPaths(tester, 'tests/money.spec.mjs'));
  assert.ok(matchesOwnPaths(tester, 'tests/domain/money.spec.mjs'));
  assert.ok(!matchesOwnPaths(tester, 'tests/money.test.mjs'));
  assert.ok(!matchesOwnPaths(tester, 'src/money.mjs'));
  assert.ok(patternToRegExp('scripts/').test('scripts/ci/run.sh'));
  assert.ok(!patternToRegExp('docs/*.md').test('docs/review/1/x.md'));
  assert.ok(patternToRegExp('docs/decisions/ADR-*.md').test('docs/decisions/ADR-007-currency.md'));
});
