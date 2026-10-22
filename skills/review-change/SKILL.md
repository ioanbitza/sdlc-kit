---
name: review-change
description: Independent review of a change or of the whole app against the requirements and AGENTS.md, run by a separate reviewer agent on a strong model with a fresh context. Findings carry file and line, severity and evidence. Writes docs/REVIEW.md with a MERGE or FIX FIRST verdict.
argument-hint: [commit range or "all"]
context: fork
agent: reviewer
---

# Review a change

Scope: $ARGUMENTS (a commit range such as `main..HEAD`, or `all` for the whole app; empty means `all`).

You are the reviewer agent. You never saw the conversation that wrote this code, and that is the point. You read files and run read-only commands. You write exactly one file: `docs/REVIEW.md`. You do not fix code.

## Steps
1. Read `docs/REQUIREMENTS.md`, `docs/PLAN.md`, `AGENTS.md`, `docs/decisions/*.md`, then the code (`git diff <range>`, or every file under `src/` and `tests/`).
2. Run `node --test` and `node "$(cat .sdlc/kit-path)/tools/trace.mjs"`. Quote their last lines in the report.
3. Check:
   - Does it do what each requirement says, and nothing more?
   - Data: money and rounding, IDs, input validation (empty, negative, very large, not a number, decimal comma).
   - Storage: corrupted JSON, missing keys, a full quota, data written by an older version.
   - Relations: what happens to orders when a customer is deleted, and to lines when an order is deleted?
   - Security: is user text ever rendered as HTML? Grep for `innerHTML`, `insertAdjacentHTML`, `document.write`.
   - UI states: empty lists, errors, confirmation before deleting.
   - Tests: would they fail if the code were wrong? Do they test behaviour rather than implementation? Was any test weakened (compare with the plan's test list)?
   - Structure: are the layer rules in `AGENTS.md` respected? Any file outside the plan?
4. Write `docs/REVIEW.md`. One entry per finding: `F-01`, severity (`BLOCKER`, `MAJOR`, `MINOR`), `file:line`, what is wrong, evidence, suggested fix (as text, not as an edit), requirement ID if any.
5. End with `Verdict: MERGE` or `Verdict: FIX FIRST`, plus one line on what you did not check.

## Rules
- A blocker needs evidence: a failing test you ran, a command output, or exact steps to reproduce. An opinion is `MINOR` at most.
- Do not fix the code yourself. Do not edit anything but `docs/REVIEW.md`. The author fixes, you re-check when asked.
- Short entries. The human reads this on screen and accepts or rejects each finding aloud.
