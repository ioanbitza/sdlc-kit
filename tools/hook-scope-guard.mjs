#!/usr/bin/env node
// PreToolUse Edit|Write|MultiEdit|NotebookEdit (and any tool whose input names a file). Allows a change only inside the active slice's files (docs/PLAN.md), or docs/** with no slice.
// A judge (x-writes: [] in its agent file) writes nothing. Human-only files, the kit's own files, HTML sinks and the
// words that mark unfinished work are always denied. Denial: exit 2, one sentence on stderr.
import { resolve, sep, join } from 'node:path';
import { readHookInput, projectRoot, deny, isMain, runGuard, isFileWritingTool, writtenFile, writtenFiles, writtenText, comparablePath } from './hook-common.mjs';
import { toProjectPath, isHumanOnly, allowedScope, isInScope, isDocsPath, isProjectSkillPath, isTesterSpec, isScriptOwnedPath, isSymlink, activeSlice, ROOT_DOCS, APPROVED_STATUS, MANUAL_CHECKS_FILE, SETUP_WRITABLE, PLAN_FILE } from './scope.mjs';
import { loadRoles, roleOf, isJudge, isMainSession, hasOwnPaths, KIT_ROOT } from './roles.mjs';
import { isExecutableDoc } from './hook-commit-guard.mjs';
import { realpathSync, existsSync, readFileSync } from 'node:fs';

/** Rendering user text as HTML (AGENTS.md rule 3). Checked in code files anywhere (.js .mjs .cjs .ts .jsx .tsx .html .htm); docs/** and prose are exempt. */
export const CODE_FILE = /\.(?:m?js|cjs|tsx?|jsx|html?)$/i;
export const HTML_SINKS = [
  [/innerHTML/, 'innerHTML', 'which AGENTS.md rule 3 forbids; render user text with textContent or DOM APIs'],
  [/insertAdjacentHTML/, 'insertAdjacentHTML', 'which AGENTS.md rule 3 forbids; render user text with textContent or DOM APIs'],
  [/document\.write\s*\(/, 'document.write', 'which AGENTS.md rule 3 forbids; render user text with textContent or DOM APIs'],
];

/** Words that mark unfinished work (AGENTS.md rule 6). Checked under src/ and tests/. */
export const UNFINISHED_WORDS = [
  [/\bTODO\b/, 'TODO'],
  [/\bFIXME\b/, 'FIXME'],
  [/\bplaceholder\b(?!\s*[=:'"`\]])/i, 'placeholder'],
  [/\bfor now\b/i, 'for now'],
];

/** Debug output left in product code (AGENTS.md rule 6: errors are shown, not logged away). Checked under src/ui/ and src/domain/, where a console line is never the product's output (a CLI under src/ may print). */
export const DEBUG_WORDS = [
  [/\bconsole\.(?:log|debug|trace)\s*\(/, 'console.log'],
  [/\bdebugger\b/, 'debugger'],
];
export const DEBUG_PATHS = /^src\/(?:ui|domain)\//;

/** A ticked manual check is the human's signature that they ran it: no role adds a `- [x]` line to docs/MANUAL-CHECKS.md. */
export function tickProblem(root, file, input) {
  if (file !== MANUAL_CHECKS_FILE) return null;
  const current = existsSync(`${root}/${file}`) ? readFileSync(`${root}/${file}`, 'utf8') : '';
  const after = resultingText(root, file, input);
  if (after === null) return `Denied: this edit of ${file} cannot be checked (its old_string is not in the file); read the file and edit the exact text.`;
  const ticked = (text) => new Set(text.split('\n').filter((l) => /^\s*- \[[xX]\]/.test(l)).map((l) => l.trim()));
  const before = ticked(current);
  const added = [...ticked(after)].filter((l) => !before.has(l));
  if (!added.length) return null;
  return `Denied: ${file} would gain a ticked check (${added[0].slice(0, 60)}); a tick is the human's signature that they ran the check, add checks unticked.`;
}

/**
 * The gate's own installation (.githooks/*, .github/workflows/gate.yml) is written only as the kit's template says, with
 * the kit's sha filled in; any other content turns the gate off and is the human's call.
 */
export function setupProblem(root, file, input, kitRoot = KIT_ROOT) {
  if (!SETUP_WRITABLE.includes(file)) return null;
  const template = file === '.github/workflows/gate.yml' ? join(kitRoot, 'templates/github-workflow-gate.yml') : join(kitRoot, 'templates/githooks', file.split('/').pop());
  if (!existsSync(template)) return `Denied: ${file} is the gate's installation and the kit has no template for it; /sdlc-kit:init writes these files.`;
  const after = resultingText(root, file, input);
  const normal = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/ref: [0-9a-f]{40}\b/g, 'ref: __KIT_SHA__').trim();
  if (after !== null && normal(after) === normal(readFileSync(template, 'utf8'))) return null;
  return `Denied: ${file} is the gate's own installation; it holds the kit's template as /sdlc-kit:init writes it, and any other content (a disabled hook, a changed workflow) is the human's decision.`;
}

/**
 * A whole-file Write that shrinks a document under docs/ (or README.md) by more than this share is refused: a tool
 * that rewrites a 300-line plan with the 16 lines it has in context destroys the rest (GSD issue #973 is the precedent).
 */
export const SHRINK_LIMIT = 0.4;
export const SHRINK_MIN_LINES = 20;
export function shrinkProblem(root, file, input) {
  if (input.tool_name !== 'Write') return null;
  if (!(isDocsPath(file) || ROOT_DOCS.includes(file)) || !/\.md$/i.test(file)) return null;
  const path = `${root}/${file}`;
  if (!existsSync(path)) return null;
  const before = readFileSync(path, 'utf8').split('\n').length;
  const after = String(input.tool_input?.content ?? '').split('\n').length;
  if (before < SHRINK_MIN_LINES || after >= before * (1 - SHRINK_LIMIT)) return null;
  return `Denied: this Write would shrink ${file} from ${before} lines to ${after}; change it with Edit, or rewrite it only after the human agreed to lose the rest.`;
}

/** The file as it would read after the tool ran: Write replaces it, Edit and MultiEdit apply their replacements to the current text. */
export function resultingText(root, file, input) {
  const t = input.tool_input ?? {};
  const current = existsSync(`${root}/${file}`) ? readFileSync(`${root}/${file}`, 'utf8') : '';
  if (input.tool_name === 'Write') return String(t.content ?? '');
  const edits = input.tool_name === 'MultiEdit' && Array.isArray(t.edits) ? t.edits : [{ old_string: t.old_string, new_string: t.new_string, replace_all: t.replace_all }];
  let text = current;
  for (const e of edits) {
    const from = String(e?.old_string ?? '');
    const to = String(e?.new_string ?? '');
    if (!from || !text.includes(from)) return null;
    text = e?.replace_all ? text.split(from).join(to) : text.replace(from, () => to);
  }
  return text;
}

/** No role writes an approval: `Status: approved` or `Status: accepted` in a document is the human's signature, typed by the human. Judged on the file as it would read after the edit, not on the fragment. */
export function approvalProblem(root, file, input) {
  if (!isDocsPath(file) || !/\.md$/i.test(file)) return null;
  const current = existsSync(`${root}/${file}`) ? readFileSync(`${root}/${file}`, 'utf8') : '';
  if (APPROVED_STATUS.test(current)) return null;
  const fragment = writtenText(input);
  const after = current ? resultingText(root, file, input) : fragment;
  if (APPROVED_STATUS.test(fragment)) return `Denied: ${file} would carry "Status: approved" (or accepted), and that line is the human's signature; leave it as proposed or draft, the human approves.`;
  if (after === null) {
    const t = input.tool_input ?? {};
    const touchesStatus = /status\s*:/i.test([fragment, t.old_string, ...(Array.isArray(t.edits) ? t.edits.map((e) => e?.old_string) : [])].filter(Boolean).join('\n'));
    const statusDoc = /^Status:/im.test(current);
    return touchesStatus || statusDoc ? `Denied: this edit of ${file} cannot be checked (its old_string is not in the file) and the document carries a Status line; read the file and edit the exact text.` : null;
  }
  if (!APPROVED_STATUS.test(after)) return null;
  return `Denied: ${file} would carry "Status: approved" (or accepted), and that line is the human's signature; leave it as proposed or draft, the human approves.`;
}

/** A test that cannot fail or does not run (AGENTS.md rule 2). Checked under tests/. */
export const WEAK_TEST_WORDS = [
  [/\b(?:test|it|describe)\.skip\b/, 'test.skip'],
  [/\.only\(/, '.only('],
  [/assert\.ok\(\s*true\s*[,)]/, 'assert.ok(true)'],
];

/** A project skill is steps and a description: frontmatter keys from this list only, no dynamic execution, no reach into the kit or its state. */
export const SKILL_KEYS = new Set(['name', 'description', 'argument-hint']);
export const SKILL_SENTENCE = 'Denied: a project skill may not grant tools or touch the kit; keep it to steps and a description.';

export const SKILL_WRITE_ONLY = 'Denied: rewrite the whole skill file with Write, so it can be checked as one piece.';

/** The kit root as given and as its realpath, lower-cased, for the body check. */
function kitSpellingsLower(kitRoot = KIT_ROOT) {
  const forms = new Set([resolve(kitRoot)]);
  try {
    forms.add(realpathSync(kitRoot));
  } catch {
    // the kit root always exists when the hook runs
  }
  return [...forms].map((f) => f.replace(/\/+$/, '').toLowerCase());
}

export function skillProblem(content, kitRoot = KIT_ROOT) {
  const text = String(content ?? '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return SKILL_SENTENCE;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
    if (!kv || !SKILL_KEYS.has(kv[1])) return SKILL_SENTENCE;
  }
  const body = text.slice(m[0].length);
  if (/!\s*`|^\s*```\s*!|\$\{?CLAUDE_PLUGIN_ROOT\}?|\.sdlc\b/im.test(body)) return SKILL_SENTENCE;
  const lower = body.toLowerCase();
  if (kitSpellingsLower(kitRoot).some((k) => lower.includes(k))) return SKILL_SENTENCE;
  return null;
}

export function contentProblem(file, content) {
  if (isProjectSkillPath(file)) return skillProblem(content);
  if (!isDocsPath(file) && CODE_FILE.test(file)) {
    for (const [pattern, word, why] of HTML_SINKS) {
      if (pattern.test(content)) return `Denied: ${file} would use ${word}, ${why}.`;
    }
  }
  const code = /^(src|tests)\//.test(file);
  if (code) {
    for (const [pattern, word] of UNFINISHED_WORDS) {
      if (pattern.test(content)) return `Denied: ${file} would contain "${word}", which AGENTS.md rule 6 forbids: no unfinished work in code, finish it or stop and ask.`;
    }
  }
  if (DEBUG_PATHS.test(file)) {
    for (const [pattern, word] of DEBUG_WORDS) {
      if (pattern.test(content)) return `Denied: ${file} would contain "${word}"; product code shows errors to the user or throws, it does not log them away (AGENTS.md rule 6).`;
    }
  }
  if (file.startsWith('tests/')) {
    for (const [pattern, word] of WEAK_TEST_WORDS) {
      if (pattern.test(content)) return `Denied: ${file} would contain "${word}", which AGENTS.md rule 2 forbids: a test must run and must be able to fail.`;
    }
  }
  return null;
}

/** True when the target is one of the kit's own files (hooks, tools, agents), wherever the kit sits; realpath and case ignored. */
export function isKitFile(root, filePath, kitRoot = KIT_ROOT) {
  const abs = comparablePath(resolve(root, String(filePath ?? '')));
  const kit = comparablePath(kitRoot);
  return abs === kit || abs.startsWith(kit + sep);
}

export function decide(input, roles = loadRoles()) {
  if (!isFileWritingTool(input.tool_name, input.tool_input)) return null;
  const root = projectRoot(input);
  const role = roleOf(input, roles);
  for (const named of writtenFiles(input)) {
    const problem = decideFile(input, roles, root, role, named);
    if (problem) return problem;
  }
  return null;
}

function decideFile(input, roles, root, role, named) {
  const file = toProjectPath(root, named);
  if (!file) return null;

  if (isJudge(role)) return `${role.name} writes nothing; it reports, the human and the builder change files.`;

  if (isKitFile(root, named)) {
    return `Denied: ${file} is part of the kit (hooks, tools, agents); the kit changes in its own repository, not from a project session.`;
  }

  if (isSymlink(root, file)) return `Denied: ${file} goes through a symbolic link, so the write would land somewhere else than it says; write to a plain path.`;

  const humanOnly = isHumanOnly(root, file, role);
  if (humanOnly) return `Denied: ${humanOnly}; the human edits it, you ask.`;
  const slice = activeSlice(root);
  if (slice && file === PLAN_FILE) return `Denied: ${PLAN_FILE} cannot change while ${slice} is active; a wider slice is a human decision.`;
  if (isExecutableDoc(file)) return `Denied: ${file} is a program under docs/ or .claude/; they hold documents and skills, programs live in the slice's files.`;
  if (isScriptOwnedPath(file)) return `Denied: ${file} is written by the review scripts (review.mjs, reqreview.mjs render) from the agents' answers; the clerk saves only the answer files, nothing writes the verdict by hand.`;
  if (isProjectSkillPath(file) && input.tool_name !== 'Write') return SKILL_WRITE_ONLY;

  const problem = contentProblem(file, writtenText(input)) ?? shrinkProblem(root, file, input) ?? approvalProblem(root, file, input) ?? tickProblem(root, file, input) ?? setupProblem(root, file, input);
  if (problem) return problem;

  if (isTesterSpec(file) && !hasOwnPaths(role)) {
    return `Denied: ${file} is the tester's test (a .spec file); the builder makes it pass and adds its own tests in a .test file, it never changes or removes the tester's.`;
  }

  const scope = allowedScope(root, isMainSession(role) ? 'main' : role.writes === 'main' ? 'other' : role.writes);
  if (scope.error) {
    return `Denied: .sdlc/slice says ${scope.slice} but ${scope.error}; run /sdlc-kit:plan-slices or fix the marker before editing ${file}.`;
  }
  if (isInScope(file, scope)) return null;
  if (scope.patterns) return `${role.name} writes only ${scope.patterns.join(', ')}. ${file} is not among them. Stop and ask the human.`;
  if (!scope.slice) {
    if (isProjectSkillPath(file)) return `${role.name} writes only its slice; project skills under .claude/skills/ are written by the main session.`;
    return `No slice is active: only docs/** may change. ${file} needs /sdlc-kit:implement-slice S<n> first.`;
  }
  return `${scope.slice} allows ${scope.files.join(', ')}. ${file} is not in the plan. Stop and ask the human.`;
}

if (isMain(import.meta.url)) runGuard((input) => decide(input));
