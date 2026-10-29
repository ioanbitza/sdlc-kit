#!/usr/bin/env node
// UserPromptSubmit. Advisory only: when a prompt asks for something the rules keep out of the AI's hands (push, merge,
// tag, a new branch, skipping tests or the gate, editing a decision file), the rule is put next to the prompt so the
// model answers with the right next step instead of trying and being denied. Never blocks.
import { readHookInput, isMain } from './hook-common.mjs';

export const PROMPT_RULES = [
  [/\bgit\s+push\b|\bforce[- ]push\b|\bpush\s+(?:it\s+|this\s+|the\s+(?:code|commits?|branch|changes?)\s+)?(?:to|up\s+to)\s+(?:the\s+)?(?:remote|origin|github|main|master)\b|\bmerge\s+(?:the\s+)?(?:pr|pull request|branch|to main)\b|\bopen\s+(?:the\s+|a\s+)?(?:pr|pull request)\b|\bcreate\s+(?:a\s+)?(?:new\s+)?(?:git\s+)?(?:branch|tag)\s+(?:for|named|called|from)\b|\bgit\s+tag\b/i,
    'ADR-002: the AI never pushes, merges, tags or creates branches; the human does. Prepare what is needed (docs/PR.md, the trace), then say exactly which command the human runs.'],
  [/\bskip(?:ping)?\s+(?:the\s+)?tests?\b|\bdisable\s+(?:the\s+)?(?:hook|gate|guard)s?\b|--no-verify\b|\bbypass\s+(?:the\s+)?(?:gate|hooks?|guards?|checks?)\b/i,
    'The gate and the hooks are not optional (AGENTS.md): do not skip tests or hooks; fix what is red or stop and report it.'],
  [/\b(?:edit|change|update|rewrite)\s+(?:the\s+)?(?:AGENTS\.md|CLAUDE\.md|ADR-?\d*|decisions?\.json|approved requirements)\b/i,
    'That file is the human\'s decision record; propose the change in the chat (what, why), the human edits it.'],
  [/\bjust\s+(?:make\s+it\s+(?:pass|green)|write\s+the\s+code)\b|\bwithout\s+tests?\b|\bno\s+tests?\s+needed\b/i,
    'Test-first stays (AGENTS.md rule 2): the failing test comes before the code, even on a small change.'],
];

export function advice(prompt) {
  const text = String(prompt ?? '');
  const out = [];
  for (const [pattern, rule] of PROMPT_RULES) if (pattern.test(text)) out.push(rule);
  return out;
}

export function run(input) {
  const lines = advice(input.prompt);
  if (!lines.length) return null;
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `sdlc-kit reminder:\n- ${lines.join('\n- ')}` } };
}

if (isMain(import.meta.url)) {
  const out = run(readHookInput());
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
