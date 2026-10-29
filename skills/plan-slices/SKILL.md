---
name: plan-slices
disable-model-invocation: true
description: Split approved requirements into small slices and write docs/PLAN.md (files, tests, steps, checks, decisions for the human). Use after the requirements are approved, before any code.
model: opus
---

# Plan slices

Input: `docs/REQUIREMENTS.md` (must say `Status: approved`), `AGENTS.md`, `docs/decisions/*.md`, and the skills `node "${CLAUDE_PLUGIN_ROOT}/tools/profile.mjs" planner` lists (the layering and stack rules decide the folders and the test command a slice names). Output: `docs/PLAN.md`. No code.

If the requirements are not approved, stop and say so. Do not plan a draft.

## The plan format is a contract
The scope guard, the commit gate and `tools/scope.mjs` parse `docs/PLAN.md`. Each slice must be written exactly like this:

```
## S1 Customer rules (domain)
**Goal:** one sentence. **Covers:** R-01, R-02, R-03, R-05.
**Files:** `src/domain/customers.js`, `tests/customers.test.js`
```

- Line 3 of the file is `Status: draft`. The human changes it to `Status: approved` once the decision package is answered; from then on the plan is frozen (the guards refuse every change by an agent, and the builder cannot start without that line). To re-plan later, the human removes the line first, then runs this skill again.
- The heading is `## S<n> <title>`, numbered from S1 with no gaps.
- `**Covers:**` lists the requirement IDs the slice implements or shows on screen. A range is written `R-11..R-17`. A UI slice may say `**Covers on screen:**`.
- `**Files:**` is one line, every path in backticks, separated by commas, relative to the repo root, at most six. While the slice is active the agent may change only these files. `docs/MANUAL-CHECKS.md` is allowed in every slice without being listed; never put it on a `**Files:**` line. A file that is not on this line cannot be created or edited, so think about every file the slice needs, including `index.html` or `styles.css` for UI slices.

## For each slice also write
- **Tests first:** the test titles, each starting with its requirement ID, for example `R-07 order total sums its lines`.
- **Steps:** at most five.
- **Verify:** commands, and for UI requirements that a unit test cannot cover, the manual checks that go into `docs/MANUAL-CHECKS.md` as `- [ ] R-xx: what to do, what you should see`. A UI slice (files under `src/ui/`, `index.html`, `styles.css`) also lists the six `- [ ] UX: ...` checks of `skills/ui-ux/SKILL.md` (keyboard-only path, 200% zoom, contrast, empty states, error next to the field, 320 px width).
- **Risks:** what you are unsure about.

## Rules
- Order the slices so each one ends in something that can be tested. Domain and storage first, UI after.
- Every MUST requirement appears in at least one slice's `**Covers:**`. Check this before you finish.
- Mark any architectural choice (a dependency, a new folder, a change to the stack, a config file the decisions do not mention) as `NEEDS HUMAN` inside the slice and do not decide it.
- End the file with the decision package, a section `## Decisions needed from the human`, mandatory even when it says `none`:
  - at most three decisions; each at most five lines; the recommendation first, then the alternative and what it costs;
  - plain words, written for the person who owns the product, not for the team (what changes for them, not which file changes);
  - more than three open: list the three that block the first slices and say how many more wait, then ask which three to settle now.
  Format of one decision:
  ```
  D1. Where does the app keep its data between sessions?
      Recommended: localStorage, one key per entity (no setup, works offline; limit about 5 MB).
      Alternative: IndexedDB (more room, more code: two more files and a slice of its own).
      Answer in: docs/decisions/ADR-003-storage.md under "## Answered".
  ```
- After writing the file, stop and show the decision package to the human in under ten lines. Nothing said in the chat counts as a decision: the human answers in `docs/decisions/ADR-*.md` under `## Answered` with the line `Q: <question>  A (<date>, <name>): "<exact words>"`. When the answers are there, update the plan to match and remove the decided items from the package, then tell the human the plan is ready for `Status: approved`: the human types that line and commits the file; nothing builds before it.
