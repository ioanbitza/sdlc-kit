#!/usr/bin/env node
// PreToolUse Bash. Denies a few commands outright, and runs the gate on the staged state before any `git commit`.
// Denial: exit 2, one sentence on stderr (the gate table follows it for a failed commit).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHookInput, projectRoot, deny, isMain } from './hook-common.mjs';
import { runGate, COMMIT_MESSAGE_HINT } from './gate.mjs';

export const FORBIDDEN = [
  [/\bnpm\s+install\b/, 'Denied: npm install adds a dependency, and this project has none (ADR-001); ask the human.'],
  [/\bnpm\s+i\s/, 'Denied: npm i adds a dependency, and this project has none (ADR-001); ask the human.'],
  [/\bnpx\s/, 'Denied: npx runs code from outside the repo; this project has no dependencies, ask the human.'],
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\b/, 'Denied: rm -rf is not allowed; remove files one by one with git rm, or ask the human.'],
  [/\bgit\s+push\b[^|;&]*(--force\b|-f\b|--force-with-lease\b)/, 'Denied: a forced push rewrites shared history; not allowed.'],
  [/--no-v/, 'Denied: --no-verify skips the gate, and the gate is the point; fix what it reports instead.'],
  [/\bgit\b[^|;&]*\bcommit\b[^|;&]*(\s-n\b|\s-[a-zA-Z]*n[a-zA-Z]*\s)/, 'Denied: -n on git commit skips the gate, and the gate is the point; fix what it reports instead.'],
  [/\bgit\b[^|;&]*(core\.hooksPath|--git-dir\b|--work-tree\b)|\bGIT_(DIR|WORK_TREE|CONFIG\w*)=/i, 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
  [/\bln\s+-[a-zA-Z]*s/, 'Denied: symlinks can point outside the project; copy the file or ask the human.'],
  [/\bgit\b[^|;&]*\bcommit\b[^|;&]*--amend\b/, 'Denied: git commit --amend rewrites a committed slice; make a new commit.'],
];

/** The two hooksPath commands /sdlc-kit:init runs (set to .githooks, read it back); any other hooksPath use stays denied. */
export const INIT_HOOKS_PATH = /^\s*git\s+config\s+core\.hooksPath(\s+\.githooks\/?)?\s*$/;

/** The subject line of the -m / --message argument, including the heredoc form -m "$(cat <<'EOF' ... EOF)". */
export function commitMessage(command) {
  const m = command.match(/(?:^|\s)(?:-m|--message)(?:=|\s+)([\s\S]*)$/);
  if (!m) return null;
  let rest = m[1];
  if (rest.startsWith('"$(cat <<')) {
    const lines = rest.split('\n').slice(1);
    return lines.find((l) => l.trim() && !/^\s*EOF\s*$/.test(l))?.trim() ?? '';
  }
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    for (let i = 1; i < rest.length; i++) {
      const c = rest[i];
      if (c === '\\' && quote === '"' && i + 1 < rest.length) {
        out += rest[++i];
        continue;
      }
      if (c === quote) break;
      out += c;
    }
    return out.split('\n')[0].trim();
  }
  return rest.split(/\s/)[0];
}

export function decide(input) {
  if (input.tool_name !== 'Bash') return null;
  const command = String(input.tool_input?.command ?? '');
  if (!command.trim()) return null;
  const checked = command
    .split(/\|\||&&|[;|\n]/)
    .filter((segment) => !INIT_HOOKS_PATH.test(segment))
    .join(';');
  for (const [pattern, reason] of FORBIDDEN) if (pattern.test(checked)) return reason;
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(command)) return null;

  const root = projectRoot(input);
  const message = commitMessage(command);
  if (message == null) return `Commit refused: pass the message with -m, in the form ${COMMIT_MESSAGE_HINT}.`;
  const gate = runGate({ root, staged: true, message });
  if (gate.ok) return null;
  const failed = gate.rows.filter((r) => !r.ok);
  const why = failed.map((r) => `${r.label}: ${r.text}`).join('; ');
  return `Commit refused: ${why}.\n${gate.lines.join('\n')}`;
}

if (isMain(import.meta.url)) {
  const reason = decide(readHookInput());
  if (reason) deny(reason);
  process.exit(0);
}
