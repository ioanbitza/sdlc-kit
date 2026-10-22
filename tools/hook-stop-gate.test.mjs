import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, cleanup, runHook } from './fixtures.mjs';

const stop = (cwd, extra = {}) => runHook('hook-stop-gate.mjs', { cwd, hook_event_name: 'Stop', stop_hook_active: false, ...extra });

test('slice active and tests red: block with the reason', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  try {
    const r = stop(root);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, {
      decision: 'block',
      reason: 'Tests are red while S1 is active (1 failed: R-02 rejects an empty name); finish the slice or revert, then stop.',
    });
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
