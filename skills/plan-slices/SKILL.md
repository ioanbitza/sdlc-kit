---
name: plan-slices
description: Split approved requirements into small vertical slices and write a plan for each one (files, tests, steps, checks). Use after the requirements are approved and before writing any code.
model: opus
---

# Plan slices

Input: `docs/REQUIREMENTS.md` (must say `Status: approved`), `AGENTS.md`, `docs/decisions/*.md`. Output: `docs/PLAN.md`. No code.

If the requirements are not approved, stop and say so. Do not plan a draft.

## The plan format is a contract
The scope guard, the commit gate and `tools/scope.mjs` parse `docs/PLAN.md`. Each slice must be written exactly like this:

```
## S1 Customer rules (domain)
**Goal:** one sentence. **Covers:** R-01, R-02, R-03, R-05.
**Files:** `src/domain/customers.js`, `tests/customers.test.js`
```

- The heading is `## S<n> <title>`, numbered from S1 with no gaps.
- `**Covers:**` lists the requirement IDs the slice implements or shows on screen. Ranges are allowed: `R-11 to R-17`. A UI slice may say `**Covers on screen:**`.
- `**Files:**` is one line, every path in backticks, separated by commas, relative to the repo root, at most six. While the slice is active the agent may change only these files (plus `docs/MANUAL-CHECKS.md`). A file that is not on this line cannot be created or edited, so think about every file the slice needs, including `index.html` or `styles.css` for UI slices.

## For each slice also write
- **Tests first:** the test titles, each starting with its requirement ID, for example `R-07 order total sums its lines`.
- **Steps:** at most five.
- **Verify:** commands, and for UI requirements that a unit test cannot cover, the manual checks that go into `docs/MANUAL-CHECKS.md` as `- [ ] R-xx: what to do, what you should see`.
- **Risks:** what you are unsure about.

## Rules
- Order the slices so each one ends in something that can be tested. Domain and storage first, UI after.
- Every MUST requirement appears in at least one slice's `**Covers:**`. Check this before you finish.
- Mark any architectural choice (a dependency, a new folder, a change to the stack, a config file the decisions do not mention) as `NEEDS HUMAN` inside the slice and do not decide it.
- End the file with a section `## Decisions needed from the human`. List every `NEEDS HUMAN` item with your recommended answer, or write `none`. This section is mandatory even when empty.
- After writing the file, stop and summarise the slices and the open decisions for the human in under ten lines. The human answers a decision by adding a line to a file in `docs/decisions/`, not in the chat. Then update the plan to match.
