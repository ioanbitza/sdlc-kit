#!/usr/bin/env node
// PreToolUse Edit|Write. Allows a change only inside the active slice's files (docs/PLAN.md), or docs/** with no slice.
// Human-only files and any innerHTML are always denied. Denial: exit 2, one sentence on stderr.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHookInput, projectRoot, deny } from './hook-common.mjs';
import { toProjectPath, isHumanOnly, allowedScope, isInScope } from './scope.mjs';

export function decide(input) {
  const tool = input.tool_name;
  if (tool !== 'Edit' && tool !== 'Write') return null;
  const root = projectRoot(input);
  const file = toProjectPath(root, input.tool_input?.file_path);
  if (!file) return null;

  const content = `${input.tool_input?.content ?? ''}\n${input.tool_input?.new_string ?? ''}`;
  if (/innerHTML/.test(content)) {
    return `Denied: ${file} would use innerHTML, which AGENTS.md forbids; render user text with textContent or DOM APIs.`;
  }

  const humanOnly = isHumanOnly(root, file);
  if (humanOnly) return `Denied: ${humanOnly}; the human edits it, you ask.`;

  const scope = allowedScope(root);
  if (scope.error) {
    return `Denied: .sdlc/slice says ${scope.slice} but ${scope.error}; run /sdlc-kit:plan-slices or fix the marker before editing ${file}.`;
  }
  if (isInScope(file, scope)) return null;
  if (!scope.slice) {
    return `No slice is active: only docs/** may change. ${file} needs /sdlc-kit:implement-slice S<n> first.`;
  }
  return `${scope.slice} allows ${scope.files.join(', ')}. ${file} is not in the plan. Stop and ask the human.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reason = decide(readHookInput());
  if (reason) deny(reason);
  process.exit(0);
}
