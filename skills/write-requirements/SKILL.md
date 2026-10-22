---
name: write-requirements
description: Turn a short or incomplete product brief into numbered, testable requirements with assumptions and open questions. Use when starting a feature or a project from a brief, before any plan or code.
argument-hint: <path to the brief, or pasted text>
model: opus
---

# Write requirements

Input: a brief (`$ARGUMENTS`: a file path or pasted text). Output: `docs/REQUIREMENTS.md`. No plan, no code.

## Steps
1. Read the brief, `AGENTS.md` and every file in `docs/decisions/`. Decisions already taken there are not open questions.
2. Separate what the brief says, what it implies, and what it leaves open. Write that in three short bullets at the top of the file.
3. Write requirements as headings in exactly this format, because `tools/trace.mjs` and the gate read them: `### R-01 [MUST] Short title`. One behaviour each, testable, with one to three acceptance criteria under the heading. IDs are two digits, `R-01` to `R-99`, in one sequence over the whole file.
4. The scope in brackets is `MUST` (this build) or `LATER` (out of scope now).
5. Assumptions: every choice the brief did not state, as `A-01`, ... The human confirms or changes them.
6. Open questions: `Q-01`, ... only the ones that change the design. Give your recommended answer for each.
7. Data model sketch: entities, fields, types, relations, how IDs are made.
8. Put `Status: draft` on the third line of the file. The human changes it to `Status: approved` after the questions are answered. From then on the file is read-only for agents (the scope guard enforces it).

## Rules
- The whole file must be readable in three minutes.
- Do not invent features the brief does not hint at.
- After writing the file, stop and list the open questions for the human, one line each, with your recommendation. Do not plan, do not code.
- When the human answers, fold the answers into the file (an answered `Q` becomes a requirement or an assumption), then tell the human the file is ready for `Status: approved`. The human types that line and commits the file.
