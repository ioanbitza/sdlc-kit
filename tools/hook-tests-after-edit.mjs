#!/usr/bin/env node
// PostToolUse Edit|Write. When a file under src/ or tests/ changed, runs `node --test` and hands the
// summary back to the model as additional context. Never blocks.
import { readHookInput, projectRoot, runTests } from './hook-common.mjs';
import { toProjectPath } from './scope.mjs';

const input = readHookInput();
const root = projectRoot(input);
const file = toProjectPath(root, input.tool_input?.file_path);

if ((input.tool_name === 'Edit' || input.tool_name === 'Write') && /^(src|tests)\//.test(file)) {
  const result = runTests(root);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: result.summary },
    }) + '\n',
  );
}
process.exit(0);
