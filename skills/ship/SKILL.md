---
name: ship
description: Final gate, traceability matrix and pull request description for the current branch. Writes docs/TRACE.md and docs/PR.md, reports manual checks listed vs passed and the session cost. Never pushes. Use when every slice is committed and the review is settled.
---

# Ship

`$KIT` below means `$(cat .sdlc/kit-path)`. No slice may be active: if `.sdlc/slice` exists, stop and say which slice is still open.

## Steps
1. Run the gate on the working tree: `node "$KIT/tools/gate.mjs"`. If it fails, stop and report the failing line. Do not fix anything here.
2. Write the trace matrix: `node "$KIT/tools/trace.mjs" --markdown > docs/TRACE.md`. Columns: requirement, title, tests, commits, manual check status (none, listed, passed).
3. Count the manual checks in `docs/MANUAL-CHECKS.md` (`- [ ]` listed, `- [x]` passed) and print this line exactly: `manual checks: <listed> listed, <passed> passed; the unticked ones stay open for QA`. This is a warning, not a failure. `gate.mjs --strict` (the CI workflow) is the one that demands ticks.
4. Write `docs/PR.md` with these sections, short:
   - **What**: one paragraph, then the slice list from `git log --oneline` (first commit of the branch to HEAD).
   - **Why**: the brief in two lines and a link to `docs/REQUIREMENTS.md`.
   - **How it was verified**: the gate output (the 4-line table), `node --test` totals, the manual checks line from step 3, the review verdict from `docs/REVIEW.md` if it exists.
   - **Open items**: every `LATER` requirement and every unticked manual check, marked `LATER` or `QA`.
   - **Decisions**: the files in `docs/decisions/` with their one-line titles.
5. Commit the two files: `git add docs/TRACE.md docs/PR.md && git commit -m "Ship: trace matrix and PR description"` (no slice is active, so a docs-only commit takes a plain message).
6. Print: the gate table, the manual checks line, the review verdict, and the reminder `run /cost now for the session total`. If the review ran in a separate agent and its cost is known, print it too.

## Never
- Push, open a pull request, merge, or tag. The human opens the PR and a human approves it (ADR-002).
- Tick a manual check. Only the human who ran it does that.
- Change code or tests.
