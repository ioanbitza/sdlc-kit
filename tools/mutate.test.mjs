import test from 'node:test';
import assert from 'node:assert/strict';
import { codeMask, findSites, applySite, chooseSites, targetFiles, mutate, survivorLine } from './mutate.mjs';
import { makeProject, cleanup, write, runTool } from './fixtures.mjs';

const MONEY = `// Money in cents. A "<=" in a comment and a 'string with && and 1 + 1' are never mutated.
import { assertInteger } from './check.js';

export function addCents(a, b) {
  assertInteger(a);
  return a + b;
}

export function isAffordable(priceCents, budgetCents) {
  return priceCents <= budgetCents;
}

export const label = \`total: \${1 + 1} <= limit\`;
`;

const CHECK = `export function assertInteger(n) {
  if (!Number.isInteger(n)) throw new TypeError('not an integer');
}
`;

const MONEY_TEST_MISSING_BOUNDARY = `import test from 'node:test';
import assert from 'node:assert/strict';
import { addCents, isAffordable } from '../src/domain/money.js';
test('R-01 adds cents', () => assert.equal(addCents(2, 3), 5));
test('R-02 cheaper is affordable', () => assert.equal(isAffordable(1, 2), true));
test('R-02 dearer is not affordable', () => assert.equal(isAffordable(3, 2), false));
`;

const MONEY_TEST_FULL = MONEY_TEST_MISSING_BOUNDARY + `test('R-02 equal is affordable', () => assert.equal(isAffordable(2, 2), true));
`;

test('codeMask blanks comments, strings and template literals and keeps line numbers', () => {
  const masked = codeMask(MONEY);
  assert.equal(masked.split('\n').length, MONEY.split('\n').length);
  assert.ok(!masked.includes('comment'));
  assert.ok(!masked.includes('string with'));
  assert.ok(!masked.includes('total:'));
  assert.ok(masked.includes('return a + b;'));
  assert.ok(masked.includes('priceCents <= budgetCents'));
});

test('findSites: operators in code only, import lines skipped, template contents skipped', () => {
  const sites = findSites(MONEY);
  const names = sites.map((s) => `${s.line}:${s.operator}`);
  assert.ok(names.includes('6:+ -> -'), names.join(', '));
  assert.ok(names.includes('10:<= -> <'), names.join(', '));
  assert.ok(names.includes('6:return x -> return undefined'));
  assert.ok(names.includes('10:return x -> return undefined'));
  assert.ok(!names.some((n) => n.startsWith('1:')), 'comment line');
  assert.ok(!names.some((n) => n.startsWith('2:')), 'import line');
  assert.ok(!names.some((n) => n.startsWith('13:')), 'template literal line');
  const boundary = sites.find((s) => s.line === 10 && s.operator === '<= -> <');
  assert.equal(applySite(MONEY, boundary).split('\n')[9], '  return priceCents < budgetCents;');
});

test('findSites: each operator fires on its shape and not on look-alikes', () => {
  const ops = (src) => findSites(src).map((s) => s.operator);
  assert.deepEqual(ops('const f = (a) => a;'), [], 'arrow is not >');
  assert.deepEqual(ops('x++; y += 1; z--;'), ['n -> n + 1'], 'increments and compound assignments are not binary + or -');
  assert.deepEqual(ops('if (a === b && c !== d) {}'), ['=== -> !==', '&& -> ||', '!== -> ===']);
  assert.deepEqual(ops('const ok = true;'), ['true -> false']);
  assert.deepEqual(ops('const v = 0.5 + 10;'), ['+ -> -', 'n -> n + 1'], 'a float is not an integer literal');
  assert.deepEqual(ops('return undefined;'), [], 'already undefined');
  assert.deepEqual(ops('return null;'), [], 'null and undefined are equivalent for the callers that matter');
  assert.deepEqual(ops('return a < b ? -1 : 1;'), ['return x -> return undefined', '< -> <='], 'the 1 and -1 of a comparator are equivalent mutants');
  assert.deepEqual(ops('return a.name < b.name ? 1 : -1;'), ['return x -> return undefined', '< -> <=']);
  assert.deepEqual(ops('const x = flag ? 1 : 2;'), ['n -> n + 1', 'n -> n + 1'], 'other ternary literals are mutated');
  assert.deepEqual(ops('if (a > b || a >= c) {}'), ['> -> >=', '|| -> &&', '>= -> >']);
});

test('chooseSites spreads the budget evenly over files and over each file', () => {
  const perFile = [
    { file: 'a.js', sites: Array.from({ length: 8 }, (_, i) => ({ line: i + 1, column: 0, from: 'x', to: 'y', operator: 'o' })) },
    { file: 'b.js', sites: Array.from({ length: 2 }, (_, i) => ({ line: i + 1, column: 0, from: 'x', to: 'y', operator: 'o' })) },
    { file: 'c.js', sites: [] },
  ];
  const chosen = chooseSites(perFile, 5);
  assert.equal(chosen.length, 5);
  const a = chosen.filter((s) => s.file === 'a.js');
  const b = chosen.filter((s) => s.file === 'b.js');
  assert.equal(a.length, 4);
  assert.equal(b.length, 1);
  assert.deepEqual(a.map((s) => s.line), [1, 3, 5, 7]);
  assert.equal(chooseSites(perFile, 100).length, 10, 'never more than the sites that exist');
});

test('a test suite that misses one boundary: the survivor is found and the counts add up', () => {
  const root = makeProject({ plan: false, requirements: false });
  write(root, 'src/domain/money.js', MONEY);
  write(root, 'src/domain/check.js', CHECK);
  write(root, 'tests/money.test.js', MONEY_TEST_MISSING_BOUNDARY);
  try {
    assert.deepEqual(targetFiles(root), ['src/domain/check.js', 'src/domain/money.js']);
    const result = mutate({ root, files: ['src/domain/money.js'] });
    assert.ok(result.baselineOk);
    assert.equal(result.planted, findSites(MONEY).length, 'every site runs by default');
    assert.equal(result.planted, result.caught + result.survived);
    assert.ok(result.planted >= 4, `planted ${result.planted}`);
    const boundary = result.survivors.find((s) => s.line === 10 && s.from === '<=' && s.to === '<');
    assert.ok(boundary, `survivors: ${JSON.stringify(result.survivors)}`);
    assert.equal(result.lines[0], `mutations  ${result.planted} planted, ${result.caught} caught, ${result.survived} survived`);
    assert.ok(result.lines.includes('  survived: src/domain/money.js:10 "<=" -> "<"'), result.lines.join('\n'));
    assert.equal(survivorLine({ file: 'src/a.js', line: 3, from: '  return x;', to: '  return undefined;' }), '  survived: src/a.js:3 "return x;" -> "return undefined;"');

    write(root, 'tests/money.test.js', MONEY_TEST_FULL);
    const full = mutate({ root, files: ['src/domain/money.js'], max: 20 });
    assert.ok(!full.survivors.some((s) => s.line === 10 && s.from === '<='), 'the boundary test catches it now');
  } finally {
    cleanup(root);
  }
});

test('CLI: --min fails below the ratio, exit 0 otherwise; no src/domain means 0 planted', () => {
  const root = makeProject({ plan: false, requirements: false });
  write(root, 'src/domain/money.js', MONEY);
  write(root, 'src/domain/check.js', CHECK);
  write(root, 'tests/money.test.js', MONEY_TEST_MISSING_BOUNDARY);
  try {
    const loose = runTool('mutate.mjs', ['--files', 'src/domain/money.js', '--min', '1'], root);
    assert.equal(loose.status, 1, loose.stdout);
    assert.match(loose.stdout, /^mutations {2}\d+ planted, \d+ caught, [1-9]\d* survived/);
    const noMin = runTool('mutate.mjs', ['--files', 'src/domain/money.js', '--max', '3'], root);
    assert.equal(noMin.status, 0);
    assert.match(noMin.stdout, /^mutations {2}3 planted, /);
  } finally {
    cleanup(root);
  }
  const empty = makeProject({ plan: false, requirements: false });
  write(empty, 'src/ui/main.js', 'export const render = (el) => { el.textContent = "x"; };\n');
  write(empty, 'tests/ui.test.js', "import test from 'node:test';\ntest('R-01 ok', () => {});\n");
  try {
    const r = runTool('mutate.mjs', ['--min', '1'], empty);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^mutations {2}0 planted, 0 caught, 0 survived \(no files under src\/domain\/ or src\/storage\/\)/);
  } finally {
    cleanup(empty);
  }
});

test('red baseline: nothing planted, --min fails', () => {
  const root = makeProject({ plan: false, requirements: false });
  write(root, 'src/domain/money.js', MONEY);
  write(root, 'src/domain/check.js', CHECK);
  write(root, 'tests/money.test.js', MONEY_TEST_FULL.replace('addCents(2, 3), 5', 'addCents(2, 3), 6'));
  try {
    const result = mutate({ root, max: 5 });
    assert.equal(result.baselineOk, false);
    assert.equal(result.planted, 0);
    assert.match(result.lines[0], /baseline tests fail before any mutation; nothing planted/);
    assert.equal(runTool('mutate.mjs', ['--min', '1'], root).status, 1);
  } finally {
    cleanup(root);
  }
});
