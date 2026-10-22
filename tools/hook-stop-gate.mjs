#!/usr/bin/env node
// Stop. While a slice is active (.sdlc/slice) the agent may not stop on red tests.
// Skips when stop_hook_active is set, so it never loops. Nothing else is blocked.
import { readHookInput, projectRoot, runTests } from './hook-common.mjs';
import { activeSlice } from './scope.mjs';

const input = readHookInput();
if (input.stop_hook_active) process.exit(0);

const root = projectRoot(input);
const slice = activeSlice(root);
if (!slice) process.exit(0);

const tests = runTests(root);
if (tests.ok) process.exit(0);

const detail = tests.crashed ? tests.summary : `${tests.failed} failed${tests.failures.length ? ': ' + tests.failures.slice(0, 3).join('; ') : ''}`;
process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason: `Tests are red while ${slice} is active (${detail}); finish the slice or revert, then stop.`,
  }) + '\n',
);
process.exit(0);
