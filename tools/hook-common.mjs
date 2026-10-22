// Shared by the four hooks: read the hook JSON from stdin, find the project root, run the tests.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** The project root: the hook's cwd, or the closest parent that holds .git or AGENTS.md. */
export function projectRoot(input) {
  const start = resolve(input?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let dir = start;
  while (true) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'AGENTS.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Denies a PreToolUse call: one sentence on stderr, exit code 2. */
export function deny(reason) {
  process.stderr.write(reason.trim() + '\n');
  process.exit(2);
}

/** Runs `node --test` in the project and returns the summary. Never throws. */
export function runTests(root, timeoutMs = 90_000) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    env,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const count = (label) => Number((output.match(new RegExp(`^# ${label} (\\d+)`, 'm')) ?? [])[1] ?? 0);
  const total = count('tests');
  const passed = count('pass');
  const failed = count('fail') + count('cancelled');
  const failures = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((name) => !/\.(m|c)?js$/.test(name));
  const crashed = result.error != null || (result.status !== 0 && total === 0);
  const summary = crashed
    ? `node --test could not run: ${(result.error?.message ?? result.stderr ?? '').trim().split('\n')[0] || 'unknown error'}`
    : total === 0
      ? 'node --test: no tests found yet'
      : `node --test: ${passed} passed, ${failed} failed${failures.length ? ': ' + failures.slice(0, 3).join('; ') : ''}`;
  return { total, passed, failed, failures, crashed, ok: !crashed && failed === 0, summary, output };
}
