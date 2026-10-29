---
name: review-requirements
description: One requirements review before any code: a product owner checks the business flow, a domain expert checks the domain rules when the project has a domain skill, and a legal role checks the legal rules of the kit's legal skills; a script writes docs/REQUIREMENTS-REVIEW.md as checkboxes the human ticks. Use after write-requirements, on a draft or an approved file.
argument-hint: [docs/REQUIREMENTS.md]
disable-model-invocation: true
---

# Review the requirements (the clerk)

You are the clerk of this review. You decide nothing about the requirements: you run the script, launch the roles, save what they return, run the script again, commit. The kit root is `${CLAUDE_PLUGIN_ROOT}`; the commands below use it as written. Argument: `$ARGUMENTS`, the requirements file, `docs/REQUIREMENTS.md` when empty. The file may be a draft or approved.

If the agents run in the background (interactive fork mode), wait for every "agent finished" notice before the next step; do nothing else meanwhile.

## Steps
1. `node "${CLAUDE_PLUGIN_ROOT}/tools/reqreview.mjs" start $ARGUMENTS`. It refuses in one sentence when the file does not exist or a slice is active: stop and show that sentence. Otherwise it prints the run number, the file and its `Status:`, the roles to launch (`product-owner` always; `domain-expert` only when a skill exists under `.claude/skills/domain-*/`; `legal` always, because the kit ships its legal skills), the domain skill paths or `none`, the legal skill paths (the kit's three under `skills/legal-*/` plus any project one under `.claude/skills/legal-*/`), and writes `docs/requirements-review/brief.txt`: what to read, the JSON shape and the checklists. Read it.
2. Launch the roles named by step 1 **in parallel, in one message**, with the Agent tool: `subagent_type` `sdlc-kit:product-owner`, `sdlc-kit:legal` and, when named, `sdlc-kit:domain-expert`. Each prompt is the text of `brief.txt`, nothing else. Save each answer as it comes, verbatim, to `docs/requirements-review/product-owner.json`, `docs/requirements-review/legal.json` and `docs/requirements-review/domain-expert.json` with the Write tool (the main session may write under `docs/` when no slice is active). The script never changes these files.
3. `node "${CLAUDE_PLUGIN_ROOT}/tools/reqreview.mjs" check`. For each `RE-ASK <role>: <problem>` line, launch that role once more with the brief plus one line: `Your previous answer was not usable: <problem>. Return the JSON array and the Checklist line, nothing else.` Save it over the old file and run `check` again. A role is re-asked at most once; if it still fails, leave its file as it is and stop with the `RE-ASK` line. The script validates every item: ids unique and in the role's prefix (`PO-n`, `DOM-n`, `LEG-n`), `kind` and `severity` from the list, `requirement` is `none` or an id the file defines, `rule` of a `DOM` item is a `D-nn` the domain skill defines, `rule` of a `LEG` item is an `LD-nn`, `LL-nn`, `LE-nn` or project `L?-nn` a legal skill defines; a run after an earlier one must number its items after the earlier ids.
4. `node "${CLAUDE_PLUGIN_ROOT}/tools/reqreview.mjs" render`. It writes `docs/REQUIREMENTS-REVIEW.md`: a header (`Reviewed: <sha>`, the date, the roles with their model, the domain skill paths or `none`, the legal skill paths), then one checkbox per item, blocking first, `- [ ] PO-1  blocking  missing  R-07  <title>` with `why` and `suggested` indented under it (a `DOM` or `LEG` item also shows its rule), then `## Checklists` and `## Next`.
5. Commit: `git add docs/requirements-review docs/REQUIREMENTS-REVIEW.md && git commit -m "Requirements review"` (docs only, no slice active: a plain message is accepted).
6. Reply with one line: `Requirements review run <n> committed as <hash>: <total> items, <blocking> blocking, <advisory> advisory; tick what you accept in docs/REQUIREMENTS-REVIEW.md.` Nothing else: the human reads the file itself, and a retold item gets the ids wrong.

## What the human does next
- Reads each item and ticks the ones to accept (`- [x]`). An untouched item is rejected; nothing has to be written for a rejection.
- Says: `Fold the ticked items of docs/REQUIREMENTS-REVIEW.md into docs/REQUIREMENTS.md`.
  - On a **draft**, the session folds each ticked item in using its `suggested` text, in the file's own format: a `missing` item becomes a `### R-nn [MUST|LATER] Title` with criteria, a `wrong` or `unclear` item changes the criterion line, a `priority` item moves the scope in the brackets, a `risk` item becomes an assumption `A-nn` or a question `Q-nn`. Then the human sets `Status: approved` on the third line and commits the file.
  - On an **approved** file, the fold-in is the human's own edit: the scope guard refuses the file to every agent (`docs/REQUIREMENTS.md is approved, changing a requirement is a human decision; the human edits it, you ask.`). The session may only show the `suggested` text to paste.
- Then `/sdlc-kit:plan-slices`. A second `/sdlc-kit:review-requirements` later is allowed: its items are numbered after the earlier ones (the brief says where to start), so an id names one item forever.

## Never
- Judge an item, edit `docs/REQUIREMENTS.md` during the review, edit a role's answer, or write `docs/REQUIREMENTS-REVIEW.md` by hand. The script writes it.
- Tick an item. Only the human ticks.
- Invent a domain rule: when no domain skill exists, the domain expert is not launched and the review says `Domain skills: none`.
- Treat a `LEG` item as legal advice: it names a rule in a legal skill, with its source; whether the app must follow it is the human's call, by ticking or not.
