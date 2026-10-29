import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, cleanup, runHook } from './fixtures.mjs';

const after = (cwd, file_path, tool_name = 'Edit') =>
  runHook('hook-tests-after-edit.mjs', { cwd, hook_event_name: 'PostToolUse', tool_name, tool_input: { file_path }, tool_response: {} });

test('green suite: summary as additionalContext, exit 0', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  try {
    const r = after(root, `${root}/tests/customers.test.js`);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'node --test: 2 passed, 0 failed' } });
  } finally {
    cleanup(root);
  }
});

test('red suite: names the failing test, still exit 0 (never blocks)', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  try {
    const r = after(root, 'src/domain/customers.js', 'Write');
    assert.equal(r.status, 0);
    assert.equal(r.json.hookSpecificOutput.additionalContext, 'node --test: 1 passed, 1 failed: R-02 rejects an empty name');
  } finally {
    cleanup(root);
  }
});

test('edits outside src/ and tests/ do not run the tests', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  try {
    const r = after(root, 'docs/PLAN.md');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally {
    cleanup(root);
  }
});

test('no tests yet: says so', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    const r = after(root, 'src/domain/customers.js');
    assert.equal(r.json.hookSpecificOutput.additionalContext, 'node --test: no tests found yet');
  } finally {
    cleanup(root);
  }
});
