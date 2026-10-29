#!/usr/bin/env node
// SubagentStop. A judge (x-writes: []) must end with the JSON its brief asked for, not prose: without it the clerk's
// script cannot validate the answer. The builder must not end with red tests or uncommitted slice files. Each is sent
// back once (stop_hook_active guards the second time), never when it is asking the human something.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readHookInput, projectRoot, runTests, isMain, runStopHook } from './hook-common.mjs';
import { loadRoles, roleOf, isJudge } from './roles.mjs';
import { activeSlice, allowedScope } from './scope.mjs';
import { asksTheHuman } from './hook-stop-gate.mjs';

/** True when the message carries a JSON value the clerk can parse: an object or an array, fenced or bare. */
export function carriesJson(message) {
  const text = String(message ?? '');
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start < 0 || end <= start) continue;
    try {
      JSON.parse(text.slice(start, end + 1));
      return true;
    } catch {
      // try the other shape, or the fenced block below
    }
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      JSON.parse(fenced[1]);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** The verifier's answer, written by the hook itself into the open cycle's folder: the file review.mjs render trusts, since no agent and no clerk wrote it. */
export const VERIFIER_CAPTURE = 'verifier.captured.txt';
export function captureVerifier(root, message) {
  const statePath = join(root, 'docs/review/state.json');
  if (!existsSync(statePath)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
  if (!state?.cycle || state.rendered) return null;
  const path = join(root, 'docs/review', String(state.cycle), VERIFIER_CAPTURE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(message ?? ''));
  return path;
}

function uncommitted(root, files) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  } catch {
    return [];
  }
}

export function decide(input, roles = loadRoles()) {
  if (input.stop_hook_active) return null;
  const role = roleOf(input, roles);
  if (!role.known || role.name === 'main') return null;
  const message = input.last_assistant_message;
  if (isJudge(role)) {
    if (carriesJson(message)) {
      if (role.name === 'verifier') captureVerifier(projectRoot(input), message);
      return null;
    }
    if (asksTheHuman(message)) return null;
    return `${role.name}: your answer has no JSON the clerk can read. Return the JSON your brief asked for (the array of findings, or the verdict object), then the lines it names, nothing else.`;
  }
  if (asksTheHuman(message)) return null;
  if (role.writes === 'slice') {
    const root = projectRoot(input);
    const slice = activeSlice(root);
    if (!slice) return null;
    const tests = runTests(root);
    if (!tests.ok) return `${role.name}: ${slice} is still active and tests are red (${tests.summary}); make them pass and commit, or report exactly where you are stuck and what you need.`;
    const left = uncommitted(root, allowedScope(root).files ?? ['src', 'tests', 'index.html', 'styles.css', 'docs/MANUAL-CHECKS.md']);
    if (left.length) return `${role.name}: ${slice} is still active and ${left.length} file${left.length === 1 ? ' is' : 's are'} not committed (${left.slice(0, 3).join(', ')}); commit the slice through the gate and rm .sdlc/slice, or report where you are stuck.`;
  }
  return null;
}

if (isMain(import.meta.url)) runStopHook((input) => decide(input));
