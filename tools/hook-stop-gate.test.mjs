import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, cleanup, runHook } from './fixtures.mjs';

const stop = (cwd, extra = {}) => runHook('hook-stop-gate.mjs', { cwd, hook_event_name: 'Stop', stop_hook_active: false, ...extra });

test('slice active and tests red: block with the reason', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  try {
    const r = stop(root);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, {
      decision: 'block',
      reason: 'Tests are red while S1 is active (1 failed: R-02 rejects an empty name); finish the slice or revert, then stop. If you are stuck, say so and ask the human.',
    });
    assert.equal(stop(root).stdout, '', 'blocked once per slice: the second stop passes');
    assert.ok(existsSync(join(root, '.sdlc/stop-warned')));
    writeFileSync(join(root, '.sdlc/slice'), 'S2\n');
    assert.equal(stop(root).json?.decision, 'block', 'a new slice gets its one warning again');
  } finally {
    cleanup(root);
  }
});

test('slice active and tests green: pass', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  try {
    const r = stop(root);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally {
    cleanup(root);
  }
});

test('no slice active: pass even with red tests', () => {
  const root = makeProject({ test: 'red' });
  try {
    assert.equal(stop(root).stdout, '');
  } finally {
    cleanup(root);
  }
});

test('stop_hook_active: pass without running anything', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  try {
    assert.equal(stop(root, { stop_hook_active: true }).stdout, '');
  } finally {
    cleanup(root);
  }
});

test('never blocks when the agent asks the human or reports a denial', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  try {
    for (const message of [
      'The test for R-02 fails for the right reason. Should I keep the empty-name rule as written in R-02, or allow whitespace?',
      'index.html is not in S1. Stop and ask the human: may I add it to the plan?',
      'This needs a decision: NEEDS HUMAN on the storage key.',
      'The hook said: Denied: AGENTS.md is a human decision file; the human edits it, you ask.',
      'Commit refused: tests: 1 failed. I need the human to look at R-02.',
    ]) {
      const r = stop(root, { last_assistant_message: message });
      assert.equal(r.stdout, '', message);
    }
    const r = stop(root, { last_assistant_message: 'Done with the slice.' });
    assert.equal(r.json?.decision, 'block', 'a plain stop on red tests is blocked');
  } finally {
    cleanup(root);
  }
});
