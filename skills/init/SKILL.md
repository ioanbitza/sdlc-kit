---
name: init
description: One-time setup of the kit in a repository: git hooks, CI gate workflow, .sdlc/kit-path, .gitignore. Use once per repository, right after installing the plugin.
disable-model-invocation: true
---

# Init the kit in this repository

The kit root is `${CLAUDE_PLUGIN_ROOT}`. If you see that literal text instead of a path, the plugin root was not substituted: use the folder given to `claude --plugin-dir` (ask the human if unsure).

## Steps
1. Run the one command that does the setup, exactly in this form (the guard allows the kit's own tools and nothing else on the kit path):
   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/tools/init.mjs"
   ```
   It writes `.sdlc/kit-path` (read by the git hooks only), adds `.sdlc/` and `.sdlc-kit/` to `.gitignore`, installs `.githooks/pre-commit` and `.githooks/commit-msg`, sets `core.hooksPath`, installs `.github/workflows/gate.yml`, copies `AGENTS.md` from the template when the repo has none, and runs the gate once. It prints a report like:
   ```
   sdlc-kit init
     kit path      .sdlc/kit-path -> <path>
     gitignore     .sdlc/, .sdlc-kit/ added
     git hooks     .githooks/pre-commit, .githooks/commit-msg (core.hooksPath set)
     CI            .github/workflows/gate.yml
     AGENTS.md     kept
     gate          GATE PASS
   Next: /sdlc-kit:write-requirements docs/BRIEF.md
   ```
2. If it says "not a git repository", stop and say so.
3. If `AGENTS.md` was copied from the template, tell the human to adapt it before anything else.
4. Show the report to the human as printed.
5. Run `git status --short`. If it lists `.githooks/`, `.github/` or `.gitignore`, offer the commit `git add .githooks .github .gitignore && git commit -m "Kit hooks and CI gate"` and run it only if the human says yes. If it lists nothing, say the setup files are already committed and offer nothing.
