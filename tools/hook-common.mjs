// Shared by the four hooks: read the hook JSON from stdin, find the project root, run the tests.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** True when the module at metaUrl is the script Node was started with, also when the kit is reached through a symlink. */
export function isMain(metaUrl) {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/** Every tool that writes a file, with the field that names the file. */
export const FILE_WRITING_TOOLS = Object.freeze({ Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' });

/** Tools that only read; the hook matcher never sends them, and a direct call is ignored. */
export const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'Bash', 'Agent', 'Skill', 'TodoWrite', 'AskUserQuestion']);

/** A tool name that says it writes (an MCP file server's write_file, edit_file, move_file, create_directory...). */
export const WRITING_TOOL_NAME = /write|edit|create|move|rename|delete|remove|append|patch|mkdir|copy|save|upload/i;

/**
 * A known writing tool, or any tool not known to be read-only whose input carries a file_path or an edits list, or a
 * `path` together with content or a writing verb in its name (fail closed on new and MCP tools that write).
 */
export function isFileWritingTool(toolName, toolInput) {
  const name = String(toolName ?? '');
  if (Object.hasOwn(FILE_WRITING_TOOLS, name)) return true;
  if (READ_ONLY_TOOLS.has(name)) return false;
  if (!toolInput) return false;
  if (typeof toolInput.file_path === 'string' || Array.isArray(toolInput.edits)) return true;
  const named = ['path', 'destination', 'target', 'source'].some((k) => typeof toolInput[k] === 'string');
  return named && (typeof toolInput.content === 'string' || typeof toolInput.new_string === 'string' || WRITING_TOOL_NAME.test(name));
}

/** The file a writing tool targets, as given (file_path, notebook_path, or an MCP tool's path/destination). */
export function writtenFile(input) {
  const field = FILE_WRITING_TOOLS[input?.tool_name] ?? 'file_path';
  const t = input?.tool_input ?? {};
  return t[field] ?? t.file_path ?? t.destination ?? t.target ?? t.path;
}

/** The files an MCP move or copy names besides the main one (its source), so each side is judged. */
export function writtenFiles(input) {
  const t = input?.tool_input ?? {};
  const main = writtenFile(input);
  const extra = [t.source, t.destination, t.target, t.path].filter((p) => typeof p === 'string' && p && p !== main);
  return [main, ...extra].filter((p) => typeof p === 'string' && p);
}

/** All the text a writing tool would put in the file: content, new_string, every edit, a notebook cell. */
export function writtenText(input) {
  const t = input?.tool_input ?? {};
  const parts = [t.content, t.new_string, t.new_source, ...(Array.isArray(t.edits) ? t.edits.map((e) => e?.new_string) : [])];
  return parts.filter((p) => typeof p === 'string').join('\n');
}

/** A path as the file system holds it: the realpath of its deepest existing ancestor plus the rest, case kept. */
export function physicalPath(p) {
  let abs = resolve(String(p ?? ''));
  const rest = [];
  while (!existsSync(abs)) {
    const parent = dirname(abs);
    if (parent === abs) break;
    rest.unshift(abs.slice(parent.length));
    abs = parent;
  }
  try {
    abs = realpathSync(abs);
  } catch {
    // keep the resolved path when realpath fails
  }
  return abs + rest.join('');
}

/** A path for comparison: physicalPath, lower-cased where the file system ignores case. */
export function comparablePath(p) {
  const full = physicalPath(p);
  return process.platform === 'darwin' || process.platform === 'win32' ? full.toLowerCase() : full;
}

/** The hook event from stdin as an object; anything unreadable (empty, not JSON, `null`, an array) is `{}`. */
export function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    const value = raw.trim() ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

/**
 * Runs a PreToolUse guard's decision and denies on any exception: a guard that crashes blocks instead of letting the
 * call through. `decideFn` receives the hook input and returns the denial sentence or null.
 */
export function runGuard(decideFn) {
  let reason;
  try {
    reason = decideFn(readHookInput());
  } catch (e) {
    reason = `Denied: the guard could not judge this call (${e?.message ?? e}); it fails closed, run a plainer command or ask the human.`;
  }
  if (reason) deny(reason);
  process.exit(0);
}

/** Runs a Stop or SubagentStop decision and blocks on any exception, for the same reason. */
export function runStopHook(decideFn) {
  let reason;
  try {
    reason = decideFn(readHookInput());
  } catch (e) {
    reason = `The stop hook could not judge this stop (${e?.message ?? e}); say where you are and what failed, then stop again.`;
  }
  if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.exit(0);
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
