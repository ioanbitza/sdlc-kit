---
name: init
description: One-time setup of the sdlc-kit in the current repository: installs the git hooks (pre-commit, commit-msg), the CI gate workflow, records the kit path in .sdlc/kit-path and gitignores .sdlc/. Use once per repository, right after installing the plugin.
disable-model-invocation: true
---

# Init the kit in this repository

The kit root is `${CLAUDE_PLUGIN_ROOT}`. If you see that literal text instead of a path, the plugin root was not substituted: use the folder given to `claude --plugin-dir` (ask the human if unsure). Call it `$KIT` below. Everything here is done with shell commands, so run them as written.

## Steps
1. Check this is a git repository (`git rev-parse --is-inside-work-tree`). If not, stop and say so.
2. Record the kit path and gitignore the kit state:
   ```sh
   mkdir -p .sdlc && echo "$KIT" > .sdlc/kit-path
   grep -qx '.sdlc/' .gitignore 2>/dev/null || echo '.sdlc/' >> .gitignore
   ```
3. Install the git hooks, which run the same gate as the Claude hooks:
   ```sh
   mkdir -p .githooks
   cp "$KIT/templates/githooks/pre-commit" "$KIT/templates/githooks/commit-msg" .githooks/
   chmod +x .githooks/pre-commit .githooks/commit-msg
   git config core.hooksPath .githooks
   ```
4. Install the CI gate:
   ```sh
   mkdir -p .github/workflows
   cp "$KIT/templates/github-workflow-gate.yml" .github/workflows/gate.yml
   ```
5. If the repo has no `AGENTS.md`, copy `$KIT/templates/AGENTS.md` to the root and tell the human to adapt it. If it has one, leave it.
6. Run `node "$KIT/tools/gate.mjs"` once to show it works (expect `GATE PASS`, with "no plan yet" and "no requirements yet" in a new repo).
7. Report in this form:
   ```
   sdlc-kit init
     kit path      .sdlc/kit-path -> <path>
     git hooks     .githooks/pre-commit, .githooks/commit-msg (core.hooksPath set)
     CI            .github/workflows/gate.yml
     gitignore     .sdlc/ added
     gate          GATE PASS
   Next: /sdlc-kit:write-requirements docs/BRIEF.md
   ```
8. Offer the commit `git add .githooks .github .gitignore && git commit -m "Kit hooks and CI gate"`; run it only if the human says yes.
