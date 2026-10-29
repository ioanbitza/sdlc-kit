---
name: ship
disable-model-invocation: true
description: Final gate with the review line, trace matrix and PR text (docs/TRACE.md, docs/PR.md), manual checks and session cost. Never pushes. Use when the review is settled.
---

# Ship

The kit root is `${CLAUDE_PLUGIN_ROOT}`; the commands below use it as written. No slice may be active: if `.sdlc/slice` exists, stop and say which slice is still open.

## Steps
1. Run the gate on the working tree with the review line: `node "${CLAUDE_PLUGIN_ROOT}/tools/gate.mjs" --review`. If it fails, stop and report the failing line. Do not fix anything here. The `review` line is a warning, never a failure, here: `none` (no review ran), `<sha> is N commits old (...): re-review needed` (code changed after the review), or `<sha> ok, verdict FIX FIRST` (open findings). A human may ship with a warning, visibly; CI (`--strict`) does not.
2. Write the trace matrix: `node "${CLAUDE_PLUGIN_ROOT}/tools/trace.mjs" --markdown > docs/TRACE.md`. Columns: requirement, title, tests, commits, manual check status (none, listed, passed).
3. Run `node "${CLAUDE_PLUGIN_ROOT}/tools/trace.mjs"` and take its manual-check numbers (requirement IDs with a `- [ ]` or `- [x]` line in `docs/MANUAL-CHECKS.md`), then print this line exactly: `manual checks: <listed> listed, <passed> passed; the unticked ones stay open for QA`. This is a warning, not a failure. `gate.mjs --strict` (the CI workflow) is the one that demands ticks.
4. Write `docs/PR.md` with these sections, short:
   - **What**: one paragraph, then the slice list from `git log --oneline` (first commit of the branch to HEAD).
   - **Why**: the brief in two lines and a link to `docs/REQUIREMENTS.md`.
   - **How it was verified**: the gate output (the table with the `review` line), `node --test` totals, the manual checks line from step 3, the header and verdict of `docs/REVIEW.md` (`Reviewed: <sha>`, `Mutations: ...`, `## Verdict: ...`) if it exists, the human's decisions from `docs/review/<cycle>/decisions.json` (accepted, rejected, the note), and the review warning in plain words if there is one.
   - **Open items**: every `LATER` requirement and every unticked manual check, marked `LATER` or `QA`.
   - **Decisions**: the files in `docs/decisions/` with their one-line titles.
5. Commit the two files: `git add docs/TRACE.md docs/PR.md && git commit -m "Ship: trace matrix and PR description"` (no slice is active, so a docs-only commit takes a plain message).
6. Print: the gate table (with the `review` line), the manual checks line, the review verdict, and the reminder `run /cost now for the session total`.

## Never
- Push, open a pull request, merge, or tag. The human opens the PR and a human approves it (ADR-002).
- Tick a manual check. Only the human who ran it does that.
- Change code or tests.
