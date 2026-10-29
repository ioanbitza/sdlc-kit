#!/usr/bin/env node
// SessionStart and PreCompact. At session start (startup, resume, clear, compact) the project's state goes into the
// context as a few lines, so no step starts blind after a reset. Before a compaction the same state is written to
// .sdlc/state.json, and the next start says when it was saved. Never blocks.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readHookInput, projectRoot, isMain } from './hook-common.mjs';
import { projectState, renderState, readSavedState, STATE_FILE } from './state.mjs';

/** A folder the kit works in: it has the kit's files or its docs. Any other folder (the plugin is global) is left alone. */
export function isKitProject(root, state) {
  return Boolean(state.requirements || state.plan || existsSync(join(root, 'AGENTS.md')) || existsSync(join(root, '.sdlc')));
}

export function run(input) {
  const root = projectRoot(input);
  const state = projectState(root);
  if (!isKitProject(root, state)) return null;
  if (input.hook_event_name === 'PreCompact') {
    const path = join(root, STATE_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ savedAt: new Date().toISOString(), trigger: input.trigger ?? null, state }, null, 2) + '\n');
    return null;
  }
  const lines = renderState(state);
  const saved = readSavedState(root);
  if (input.source === 'compact' && saved?.savedAt) lines.push(`  (state snapshot saved ${saved.savedAt} before compaction)`);
  lines.push('  Rules: the human decides in files (Status: approved, ADR Status: accepted, decisions.json); you never push, tag or branch; a denial means stop and ask.');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
}

if (isMain(import.meta.url)) {
  const out = run(readHookInput());
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
