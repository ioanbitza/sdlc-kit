#!/usr/bin/env node
// PostToolUse Edit|Write|MultiEdit|NotebookEdit. When a file under src/ or tests/ changed, runs `node --test` and hands the
// summary back to the model as additional context. Never blocks.
import { readHookInput, projectRoot, runTests, isFileWritingTool, writtenFile } from './hook-common.mjs';
import { toProjectPath } from './scope.mjs';

const input = readHookInput();
const root = projectRoot(input);
const file = toProjectPath(root, writtenFile(input));

if (isFileWritingTool(input.tool_name, input.tool_input) && /^(src|tests)\//.test(file)) {
  const result = runTests(root);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: result.summary },
    }) + '\n',
  );
}
process.exit(0);
