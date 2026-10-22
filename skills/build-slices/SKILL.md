---
name: build-slices
description: Build several plan slices in sequence in a separate builder agent, each test-first and each committed through the gate; stops at the first slice whose gate fails. Use after the first slice was built by hand, for example "build S2 S3 S4".
argument-hint: S<n> S<m> ...
context: fork
agent: builder
model: sonnet
---

# Build slices in sequence

Slices to build, in this order: $ARGUMENTS

You are the builder agent. You run in a fresh context: read the files, do not assume anything from a conversation you did not see. `$KIT` below means `$(cat .sdlc/kit-path)`.

Read `AGENTS.md`, `docs/REQUIREMENTS.md` and `docs/PLAN.md` once, then for **each slice in order** run these steps:

0. `mkdir -p .sdlc && echo S<n> > .sdlc/slice`, then `node "$KIT/tools/scope.mjs" S<n>` to see the allowed files.
1. Read the slice section in the plan and its requirements.
2. Tests first for domain and storage: write them, run `node --test`, confirm they fail for the right reason.
3. Write the smallest code that makes them pass. Run `node --test` until green.
4. For a UI slice add its manual checks to `docs/MANUAL-CHECKS.md` as `- [ ] R-xx: ...`, unticked.
5. `git status`: only the planned files changed. Then `node "$KIT/tools/gate.mjs"`.
6. Stage the slice's files by name and commit: `git commit -m "S<n>: <what changed> (R-xx, R-yy)"` with the IDs from the slice's `**Covers:**` line (ranges as `R-11..R-17`).
7. `rm .sdlc/slice`. Note the commit hash. Go to the next slice.

## Stop rule
If the gate fails and you cannot make it pass inside the slice's files within two attempts, stop. Do not continue to the next slice, do not touch files outside the slice, do not weaken a test. Leave `.sdlc/slice` in place so the state is visible, and report.

## Report (one line per slice)
```
S2  done   a1b2c3d  12 tests green
S3  done   d4e5f6a  21 tests green
S4  FAILED gate: tests 1 failed: R-20 invalid JSON ...  (files left uncommitted, .sdlc/slice = S4)
S5  not started
```
Then two lines: what you were unsure about, and what the human should check in the browser.

## Never
- Add a dependency, create files the plan does not list, use `innerHTML`, skip or weaken a test.
- Edit `docs/PLAN.md`, `docs/REQUIREMENTS.md`, `AGENTS.md` or anything in `docs/decisions/`.
