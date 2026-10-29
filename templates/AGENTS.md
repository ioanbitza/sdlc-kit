# <Project name>: rules for AI agents

## What this is
<Two lines: what the app does, who uses it.>
Brief: `docs/BRIEF.md`. Requirements: `docs/REQUIREMENTS.md`. Plan: `docs/PLAN.md`. Review: `docs/REVIEW.md` (written by a script from the finders' and the verifier's answers). Decisions: `docs/decisions/`, answers under `## Answered`.

## Language
Everything in English: chat replies, documents, code, commit messages.

## Decisions (humans only)
The stack, the dependencies, the data model after approval and the security rules are decided in `docs/decisions/ADR-*.md`. An agent never edits those files, `AGENTS.md`, `CLAUDE.md`, or `docs/REQUIREMENTS.md` once it says `Status: approved`. When something needs a decision, the agent writes `NEEDS HUMAN` and stops.

## Stack
<See `docs/decisions/ADR-001-stack.md`. Repeat here only what an agent needs every time: language, test runner, how to run.>

## Structure
<One line per folder: what goes in, what never goes in.>
- `tests/` one test file per module, named `<module>.test.js`.

## Rules
1. Work only on the slice you were given and touch only the files its `**Files:**` line in `docs/PLAN.md` lists. If you need another file, stop and ask.
2. Domain and storage code is test-first: write the test, run it, see it fail, then write the code. A test must be able to fail: no `test.skip`, no `.only(`, no `assert.ok(true)`, no assertion on a value the test itself set. The verifier plants defects to prove it.
3. Never put user data into `innerHTML`. Use `textContent` or DOM APIs.
4. Every requirement you implement is named in a test title, for example `test('R-07 order total sums its lines', ...)`.
5. No new dependencies and no folders outside the structure above.
6. Errors are visible. No empty `catch`, no silent fallbacks, never lose user data silently; no `console.log` or `debugger` under `src/` (an error is shown or thrown, not logged away). No unfinished work left in code: `TODO`, `FIXME`, `placeholder` and "for now" are banned words; finish it or stop and ask.
7. Small functions, plain names, no speculative abstractions or "utils" dumping grounds.
8. One commit per finished slice: `S<n>: <what changed> (R-xx, R-yy)`.

## How the rules are enforced
Most rules are scripts, not prompts. Rules 1, 3, 5, 6 and 8 are enforced: the kit's hooks deny the action and print why, and the content guard refuses the banned words of rules 2, 3 and 6 on write under `src/` and `tests/`. Test-first (rule 2) is the one the builder is told; the verifier's planted defects show afterwards whether the tests can fail. The same gate (`gate.mjs`: tests, scope, trace, commit message) runs in the Claude hooks, in `.githooks/` for any tool or human, and in CI. The review is bound to the commit it reviewed: `docs/REVIEW.md` says `Reviewed: <sha>`, and the gate's `review` line says when code changed after it. Roles have write scopes: the builder writes only its slice, the finders and the verifier write nothing.

## Definition of done for a slice
- `node --test` passes.
- The slice's requirement IDs are covered by tests (domain, storage) or listed for a manual check (UI) in `docs/MANUAL-CHECKS.md`.
- `git status` shows only the files the plan allowed.
- `gate.mjs` prints `GATE PASS`.
