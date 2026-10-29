import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { approvedDocs, documentStanding, checkContract, statusLine } from './contract.mjs';
import { makeProject, cleanup, write, git, runTool } from './fixtures.mjs';

test('contract: an approved document is intact until its text changes; a changed Status line is a new approval', () => {
  const root = makeProject();
  try {
    assert.deepEqual(approvedDocs(root), ['docs/REQUIREMENTS.md']);
    let c = checkContract(root);
    assert.ok(c.ok);
    assert.match(c.text, /1 approved document intact \(REQUIREMENTS\.md@[0-9a-f]{7}\)/);

    write(root, 'docs/REQUIREMENTS.md', readFileSync(join(root, 'docs/REQUIREMENTS.md'), 'utf8') + '### R-07 [MUST] Sneaked in\n');
    let d = documentStanding(root, 'docs/REQUIREMENTS.md');
    assert.equal(d.state, 'changed');
    assert.match(d.detail, /working tree/);
    assert.ok(!checkContract(root).ok);
    assert.equal(runTool('contract.mjs', ['--root', root]).status, 1);

    git(root, 'add', 'docs/REQUIREMENTS.md');
    git(root, 'commit', '-q', '-m', 'R-07 added without approval');
    d = documentStanding(root, 'docs/REQUIREMENTS.md');
    assert.equal(d.state, 'changed');
    assert.match(d.detail, /changed in 1 commit after its approval in [0-9a-f]{7}/);

    write(root, 'docs/REQUIREMENTS.md', readFileSync(join(root, 'docs/REQUIREMENTS.md'), 'utf8').replace('Status: approved.', 'Status: approved 2026-10-29.'));
    d = documentStanding(root, 'docs/REQUIREMENTS.md');
    assert.equal(d.state, 'reapproving');
    assert.ok(checkContract(root).ok, 'a new approval in progress is the human\'s business');
    git(root, 'add', 'docs/REQUIREMENTS.md');
    git(root, 'commit', '-q', '-m', 'Requirements re-approved with R-07');
    d = documentStanding(root, 'docs/REQUIREMENTS.md');
    assert.equal(d.state, 'intact');
    assert.equal(runTool('contract.mjs', ['--root', root]).status, 0);
  } finally {
    cleanup(root);
  }
});

test('contract: ADRs accepted, a plan approved, drafts and the review folder', () => {
  const root = makeProject();
  try {
    write(root, 'docs/decisions/ADR-005-money.md', '# ADR-005\nStatus: accepted\n');
    write(root, 'docs/UI-SPEC.md', '# UI\nStatus: draft\n');
    write(root, 'docs/review/1/quote.md', 'Status: approved\n');
    assert.deepEqual(approvedDocs(root), ['docs/REQUIREMENTS.md', 'docs/decisions/ADR-005-money.md']);
    assert.equal(documentStanding(root, 'docs/decisions/ADR-005-money.md').state, 'uncommitted');
    assert.ok(checkContract(root).ok);
    assert.equal(statusLine('# x\nStatus:  approved (v2) \n'), 'Status:  approved (v2)');
    assert.equal(statusLine('no status'), null);
  } finally {
    cleanup(root);
  }
});
