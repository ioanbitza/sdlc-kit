---
name: implement-slice
description: Build one slice from docs/PLAN.md test-first, inside the files the plan allows, then commit. Use when the human asks to build a specific slice, for example "implement S1".
argument-hint: S<n>
model: sonnet
---

# Implement slice $ARGUMENTS

The kit path is in `.sdlc/kit-path` (written by `/sdlc-kit:init`). Below, `$KIT` means `$(cat .sdlc/kit-path)`.

## Steps
0. Mark the slice active, so the guards know what you are allowed to touch: `mkdir -p .sdlc && echo $ARGUMENTS > .sdlc/slice`. Then `node "$KIT/tools/scope.mjs" $ARGUMENTS` prints the files you may change.
1. Read the slice in `docs/PLAN.md`, its requirements in `docs/REQUIREMENTS.md`, and `AGENTS.md`.
2. Write a three-line start note in the chat: what you will change, and what you are assuming.
3. Tests first for domain and storage: write them, run `node --test`, confirm they fail for the right reason (a missing module or a wrong value, not a syntax error).
4. Write the smallest code that makes them pass.
5. Run all tests until they pass. For a UI slice, add its manual checks to `docs/MANUAL-CHECKS.md` as `- [ ] R-xx: ...` and leave them unticked: the human ticks what they ran.
6. Run `git status` and check that only the planned files changed. Then run the gate: `node "$KIT/tools/gate.mjs"`.
7. Stage the slice's files by name (no `git add -A`) and commit: `git commit -m "$ARGUMENTS: <what changed> (R-xx, R-yy)"`. The IDs are the ones in the slice's `**Covers:**` line; a range is written `R-11..R-17`. The commit hook runs the same gate and refuses anything red.
8. After the commit: `rm .sdlc/slice`. The slice is closed; the guard goes back to docs-only.
9. Report in five lines: what changed, which tests ran, the commit hash, what you were unsure about.

## When a guard denies something
The denial sentence says which slice is active, which files are allowed and what to do. Do not retry the same action another way, do not edit `docs/PLAN.md` to widen the slice. Stop and tell the human what you need and why.

## Never
- Touch another slice, add a dependency, or create files the plan does not list.
- Skip, weaken or delete a test to make it pass.
- Put user data into `innerHTML`.
- Leave `.sdlc/slice` behind after the commit.
