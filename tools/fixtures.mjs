// Test fixtures: a throwaway project with a plan, approved requirements, a git repo and a tiny test suite.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TOOLS = dirname(fileURLToPath(import.meta.url));

export const PLAN = `# Plan

## S1 Customer rules (domain)
**Goal:** add and validate customers. **Covers:** R-01, R-02.
**Files:** \`src/domain/customers.js\`, \`tests/customers.test.js\`

## S2 Lines (domain)
**Goal:** lines and totals. **Covers:** R-04 to R-05.
**Files:** \`src/domain/lines.js\`, \`tests/lines.test.js\`

## S3 Customers screen (UI)
**Goal:** the page. **Covers on screen:** R-01, R-06.
**Files:** \`index.html\`, \`src/ui/main.js\`, \`docs/MANUAL-CHECKS.md\`
`;

export const REQUIREMENTS = `# Requirements
Status: approved.

### R-01 [MUST] Create a customer
### R-02 [MUST] Reject invalid customer data
### R-03 [LATER] Tax
### R-04 [MUST] Add a line
### R-05 [MUST] Line total is exact
### R-06 [MUST] Useful empty states
`;

export const GREEN_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/domain/customers.js';
test('R-01 adds a customer', () => assert.equal(add(), 1));
test('R-02 rejects an empty name', () => assert.equal(add(), 1));
`;

export const RED_TEST = GREEN_TEST.replace("test('R-02 rejects an empty name', () => assert.equal(add(), 1));", "test('R-02 rejects an empty name', () => assert.equal(add(), 2));");

export function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function git(root, ...args) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  return r.stdout.trim();
}

/**
 * options: { plan, requirements, slice, test: 'green'|'red'|null, approved }
 * Returns the project root. The initial commit holds AGENTS.md and the docs.
 */
export function makeProject(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-kit-'));
  write(root, 'AGENTS.md', '# rules\n');
  write(root, 'CLAUDE.md', '@AGENTS.md\n');
  write(root, '.gitignore', '.sdlc/\n');
  write(root, 'docs/decisions/ADR-001-stack.md', '# ADR-001\n');
  if (options.plan !== false) write(root, 'docs/PLAN.md', options.plan ?? PLAN);
  if (options.requirements !== false) {
    const text = options.requirements ?? REQUIREMENTS;
    write(root, 'docs/REQUIREMENTS.md', options.approved === false ? text.replace('Status: approved.', 'Status: draft.') : text);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Kit decisions and brief');
  if (options.slice) write(root, '.sdlc/slice', `${options.slice}\n`);
  if (options.test) {
    write(root, 'src/domain/customers.js', 'export const add = () => 1;\n');
    write(root, 'tests/customers.test.js', options.test === 'red' ? RED_TEST : GREEN_TEST);
  }
  return root;
}

export function cleanup(root) {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

/** Runs a tool with JSON on stdin and returns { status, stdout, stderr, json }. */
export function runHook(script, input) {
  const r = spawnSync(process.execPath, [join(TOOLS, script)], { input: JSON.stringify(input), encoding: 'utf8', timeout: 60_000 });
  let json = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
  } catch {
    json = null;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

export function runTool(script, args, cwd) {
  return spawnSync(process.execPath, [join(TOOLS, script), ...args], { cwd, encoding: 'utf8', timeout: 60_000 });
}

export const editInput = (cwd, file_path, extra = {}) => ({
  session_id: 's',
  cwd,
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path, old_string: 'a', new_string: 'b', ...extra },
});

export const writeInput = (cwd, file_path, content = 'x') => ({
  session_id: 's',
  cwd,
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  tool_input: { file_path, content },
});

export const bashInput = (cwd, command) => ({
  session_id: 's',
  cwd,
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
});
