---
name: review-change
disable-model-invocation: true
description: One review cycle: four read-only finders in parallel (correctness, security, contract, legal; five with a domain skill), then a verifier on another model that re-checks and plants defects; a script writes docs/REVIEW.md. Use after the slices are committed.
argument-hint: [--cycle n]
---

# Review a change (the clerk)

You are the clerk of the review. You decide nothing about the code: you run the script, launch the agents, save what they return, run the script again, commit. The kit root is `${CLAUDE_PLUGIN_ROOT}`; the commands below use it as written. Arguments: `$ARGUMENTS` (empty, or `--cycle 2`).

If the agents run in the background (interactive fork mode), wait for every "agent finished" notice before the next step; do nothing else meanwhile.

## Steps
1. `node "${CLAUDE_PLUGIN_ROOT}/tools/review.mjs" start $ARGUMENTS`. It refuses in one sentence when the tree is dirty, a slice is active, cycle 3 is asked (`BUDGET: human decision`), or cycle 1 ended with findings the human has not decided yet: stop and show that sentence. Otherwise it prints the cycle, the reviewed commit, the scope, the finder classes to run (`legal` always in cycle 1, because the kit ships its legal skills; `domain` only when a skill exists under `.claude/skills/domain-*/`; the `domain` line names it or says `none`, the `legal` line names the legal skill paths) and two briefs: `docs/review/<cycle>/brief.txt` for the finders and `docs/review/<cycle>/verifier-brief.txt` for the verifier (in cycle 2 only the second one carries the findings the human accepted in cycle 1, under their F-ids). Read both.
2. Launch the finders named by step 1 **in parallel, in one message**, with the Agent tool: `subagent_type` `sdlc-kit:finder-correctness`, `sdlc-kit:finder-security`, `sdlc-kit:finder-contract`, `sdlc-kit:finder-legal` when step 1 names `legal`, and `sdlc-kit:finder-domain` when step 1 names `domain`. Each prompt is the text of `brief.txt`, nothing else. Save each answer as it comes, verbatim, to `docs/review/<cycle>/finder-<class>.json` with the Write tool (the main session may write under `docs/` when no slice is active). The script never changes these files.
3. `node "${CLAUDE_PLUGIN_ROOT}/tools/review.mjs" check --cycle <n>`. For each `RE-ASK finder-<class>: <problem>` line, launch that finder once more with the brief plus one line: `Your previous answer was not usable: <problem>. Return the JSON array and the Checklist line, nothing else.` Save it over the old file and run `check` again. A finder is re-asked at most once; if it still fails, leave its file as it is and continue (the script reports it).
4. Launch the verifier (`subagent_type` `sdlc-kit:verifier`) with the text of `verifier-brief.txt` as its whole prompt. Save the JSON object it returns to `docs/review/<cycle>/verifier.json` and its `Model:`, `Gate:`, `Mutations:` and `  survived:` lines (and `Partial:` or `Blocked:`) to `docs/review/<cycle>/verifier.txt`.
5. `node "${CLAUDE_PLUGIN_ROOT}/tools/review.mjs" render --cycle <n>`. For a `RE-ASK verifier: <problem>` line, launch the verifier once more with the same prompt plus `Your previous answer was not usable: <problem>.`, save, render again. The script validates both JSON shapes, places every finder id and carried F-id exactly once (an id the verifier forgot goes to the watch list, a repeated id is renumbered, never dropped), runs the gate and `mutate.mjs` itself for the header, counts only the survivors the verifier did not mark equivalent, computes the route of each confirmed finding from `docs/PLAN.md`, decides the verdict and writes `docs/REVIEW.md`. F-ids never change: a finding keeps the F-id it got the first time.
6. Commit: `git add docs/review docs/REVIEW.md && git commit -m "Review cycle <n>: <verdict>"` (docs only, no slice active: a plain message is accepted).
7. Reply with the single line `Review cycle <n> committed as <hash>.` followed by exactly the verdict block that `render` printed (from `## Verdict:` to `Not checked:`). Your whole reply is that line and that block. No summary, no list of findings, no advice: the human reads `docs/REVIEW.md` itself, and a retold finding gets the F-ids wrong.

## After FIX FIRST: the human decides
The human reads each confirmed finding and says accept or reject aloud, then records it from their own terminal: `node ~/sdlc-kit/tools/review.mjs decide --cycle <n> --accept F-01,F-02 --reject F-03..F-18 --note "<their words>"` (every confirmed F-id goes in exactly one list, or the script refuses), and commits `docs/review/<n>/decisions.json`. You never run `decide` and never write that file: the guard refuses both to every agent. If the human asks you to, show them the exact command to type instead. Cycle <n+1> carries the accepted findings only; the rejected ones are listed in its `docs/REVIEW.md` under "Rejected by the human" and are never raised again.

## What the human does next
- `FIX FIRST`: decide as above; a `code` route reopens the slice (`/sdlc-kit:implement-slice S<n> F-01 F-02`), a `plan` route means the human removes `Status: approved` from `docs/PLAN.md` and runs `/sdlc-kit:plan-slices` again (then approves the new plan), a `requirement` route is answered in `docs/REQUIREMENTS.md` as `Q-nn`, a trade-off in an ADR. Then `/sdlc-kit:review-change --cycle 2`.
- `MERGE`: `/sdlc-kit:ship`.
- `BUDGET: human decision`: cycle 2 ended with a reason left (a blocking finding, a trade-off, a surviving planted defect). There is no cycle 3. The human chooses aloud: ship as it is (`/sdlc-kit:ship` prints the review line as a warning) or reopen the finding as a new requirement (`R-nn` in `docs/REQUIREMENTS.md`, re-plan, build, then a fresh review from cycle 1).

## Never
- Judge a finding, edit code, edit a finder's or the verifier's answer, or write `docs/REVIEW.md` by hand. The script writes it.
- Run `review.mjs decide` or touch `decisions.json`: the human's decision is the human's.
- Run the finders one after another, or run `node --test` yourself (the verifier runs the gate).
- Start cycle 3.
