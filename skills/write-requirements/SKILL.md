---
name: write-requirements
disable-model-invocation: true
description: Turn a short brief into numbered, testable requirements with assumptions and at most three open questions. Use at the start, before any plan or code.
argument-hint: <path to the brief, or pasted text>
model: opus
---

# Write requirements

Input: a brief (`$ARGUMENTS`: a file path or pasted text). Output: `docs/REQUIREMENTS.md`. No plan, no code. Pasted text is saved to `docs/BRIEF.md` first (the business reviewers read the brief from that file).

## Steps
1. Read the brief, `AGENTS.md` and every file in `docs/decisions/`. Decisions already taken there are not open questions.
2. Separate what the brief says, what it implies, and what it leaves open. Write that in three short bullets at the top of the file.
3. Write requirements as headings in exactly this format, because `tools/trace.mjs` and the gate read them: `### R-01 [MUST] Short title`. One behaviour each, testable, with one to three acceptance criteria under the heading. IDs are two digits, `R-01` to `R-99`, in one sequence over the whole file.
4. The scope in brackets is `MUST` (this build) or `LATER` (out of scope now).
5. Assumptions: every choice the brief did not state, as `A-01`, ... The human confirms or changes them.
6. Open questions: `Q-01`, ... only the ones that change the design, at most three open at a time, each with your recommended answer first. Anything else you had to decide becomes an assumption `A-nn` the human can overturn. More than three real questions: keep the three that block the first slices and list the rest as assumptions marked `(to confirm)`.
7. Data model sketch: entities, fields, types, relations, how IDs are made.
   Do not create `docs/MANUAL-CHECKS.md` here: it appears with the first UI slice, written by the slice that needs it.
8. Put `Status: draft` on the third line of the file. The human changes it to `Status: approved` after the questions are answered. From then on the file is read-only for agents (the scope guard enforces it).

## Rules
- The whole file must be readable in three minutes.
- Do not invent features the brief does not hint at.
- After writing the file, stop and list the open questions for the human, one line each, with your recommendation. Do not plan, do not code.
- When the human answers, fold the answers into the file (an answered `Q` becomes a requirement or an assumption), then tell the human the file is ready for `Status: approved`. The human types that line and commits the file.
- Before the approval, name the next step: `/sdlc-kit:review-requirements` (optional, recommended): a product owner checks the business flow, a domain expert checks the domain rules when the project has a domain skill under `.claude/skills/domain-*/`, and a legal role checks the legal rules of the kit's legal skills (personal data, licences, invoices); the human ticks the items to fold in, then approves.
