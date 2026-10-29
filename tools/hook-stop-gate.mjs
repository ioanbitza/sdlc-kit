#!/usr/bin/env node
// Stop. While a slice is active (.sdlc/slice) the agent may not stop on red tests, once per slice (the marker
// .sdlc/stop-warned holds the slice id, so a new slice gets its one warning again).
// Never blocks when the agent is asking the human something or reporting a denial (test-first means red tests are
// expected before the code exists, and a question must reach the human). Skips when stop_hook_active is set.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readHookInput, projectRoot, runTests, isMain, runStopHook } from './hook-common.mjs';
import { activeSlice } from './scope.mjs';

export const STOP_WARNED_MARKER = '.sdlc/stop-warned';

/**
 * The agent is talking to the human: its last line is a question, or a line starts with a denial it reports (a `?` or a
 * "Denied" buried in a summary does not count). Not a moment to push it back to work.
 */
export function asksTheHuman(message) {
  const text = String(message ?? '');
  if (!text.trim()) return false;
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (/\?$/.test(lines[lines.length - 1])) return true;
  if (/^(?:[-*>]\s*)?(?:\*\*)?(?:Stop and ask|NEEDS HUMAN|Denied:|Commit refused:)/m.test(lines.join('\n'))) return true;
  return lines.length < 3 && /\b(?:Stop and ask|NEEDS HUMAN)\b|\bDenied:|\bCommit refused:/.test(text);
}

export function decide(input) {
  if (input.stop_hook_active) return null;
  const root = projectRoot(input);
  const slice = activeSlice(root);
  if (!slice) return null;
  if (asksTheHuman(input.last_assistant_message)) return null;
  const marker = join(root, STOP_WARNED_MARKER);
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === slice) return null;
  const tests = runTests(root);
  if (tests.ok) return null;
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${slice}\n`);
  const detail = tests.crashed ? tests.summary : `${tests.failed} failed${tests.failures.length ? ': ' + tests.failures.slice(0, 3).join('; ') : ''}`;
  return `Tests are red while ${slice} is active (${detail}); finish the slice or revert, then stop. If you are stuck, say so and ask the human.`;
}

if (isMain(import.meta.url)) runStopHook((input) => decide(input));
