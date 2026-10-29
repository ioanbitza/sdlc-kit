---
name: build-slices
description: Build several slices in sequence in a builder agent, test-first, each committed through the gate; stops at the first red gate. Use after S1, for example "build S2 S3 S4".
argument-hint: S<n> S<m> ...
context: fork
agent: builder
model: sonnet
background: false
disable-model-invocation: true
---

# Build slices in sequence

Slices to build, in this order: $ARGUMENTS

You are the builder agent. You run in a fresh context: read the files, do not assume anything from a conversation you did not see. The kit root is `${CLAUDE_PLUGIN_ROOT}`; the commands below use it as written.

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/profile.mjs" builder` and read every skill it lists once (the discipline and stack rules the ADR tags switched on; the review cites them by id). Read `AGENTS.md`, `docs/REQUIREMENTS.md` and `docs/PLAN.md` once, and every `.claude/skills/domain-*/SKILL.md` when one exists (its `D-nn` rules bind the domain and storage slices). Before the first UI slice (files under `src/ui/`, `index.html`, `styles.css`) read the UI rules: `cat "${CLAUDE_PLUGIN_ROOT}/skills/ui-ux/SKILL.md"`. Then for **each slice in order** run these steps:

0. `mkdir -p .sdlc && echo S<n> > .sdlc/slice`, then `node "${CLAUDE_PLUGIN_ROOT}/tools/scope.mjs" S<n>` to see the allowed files.
1. Read the slice section in the plan and its requirements.
2. Tests first for domain and storage: write them, run `node --test`, confirm they fail for the right reason.
3. Write the smallest code that makes them pass. Run `node --test` until green.
4. For a UI slice add its manual checks to `docs/MANUAL-CHECKS.md` as `- [ ] R-xx: ...` plus the six `- [ ] UX: ...` lines from the ui-ux skill, unticked.
5. `git status`: only the planned files changed. Then `node "${CLAUDE_PLUGIN_ROOT}/tools/gate.mjs"`.
6. Stage the slice's files by name and commit in one command: `git add <file> <file> && git commit -m "S<n>: <what changed> (R-xx, R-yy)"` with the IDs from the slice's `**Covers:**` line (ranges as `R-11..R-17`). `git add -A` and `git commit -a` are refused.
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
- Add a dependency, create files the plan does not list, use `innerHTML`, skip or weaken a test, leave `TODO` or `placeholder` in code.
- Edit `docs/PLAN.md`, `docs/REQUIREMENTS.md`, `AGENTS.md` or anything in `docs/decisions/`.
