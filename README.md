# sdlc-kit

A small, portable AI-SDLC kit for Claude Code, usable in part with any other tool.
It takes a repository from a brief to a pull request in one fixed flow: requirements with IDs, a sliced plan, test-first slices on a cheaper model, an independent review on a strong model, a trace matrix and a PR text.
The rules are not prompts: one gate script checks tests, scope, trace and commit message, and hooks deny what breaks it.
Every requirement can be followed to its test, its commit and its manual check.
The kit lives in its own repository and installs into any project folder; the project keeps only what is specific to it (AGENTS.md, decisions, docs).
Node 22 or newer, no dependencies.

## Install

One session, one flag: `claude --plugin-dir ~/sdlc-kit` (clone https://github.com/ioanbitza/sdlc-kit to `~/sdlc-kit` first).
For a team: put the kit in a marketplace folder, `/plugin marketplace add <folder>`, then `/plugin install sdlc-kit@<marketplace>`.
In the project, add `.claude/settings.json` with `{"includeCoAuthoredBy": false}` if you want commits without AI trailers, then run `/sdlc-kit:init` once. It installs the git hooks and the CI workflow and writes `.sdlc/kit-path`.

## The flow (seven skills, in this order)

| Step | Skill | Model | Writes |
|---|---|---|---|
| 0 | `/sdlc-kit:init` | any | `.githooks/`, `.github/workflows/gate.yml`, `.sdlc/kit-path` |
| 1 | `/sdlc-kit:write-requirements docs/BRIEF.md` | opus | `docs/REQUIREMENTS.md` (`### R-01 [MUST] Title`), questions for the human; the human sets `Status: approved` |
| 2 | `/sdlc-kit:plan-slices` | opus | `docs/PLAN.md`, one `**Files:**` line per slice, ends with "Decisions needed from the human" |
| 3 | `/sdlc-kit:implement-slice S1` | sonnet | the slice's files, test-first, one commit `S1: ... (R-01, R-02)` |
| 4 | `/sdlc-kit:build-slices S2 S3 S4` | builder agent (sonnet, fresh context) | the remaining slices in sequence, stops at the first red gate |
| 5 | `/sdlc-kit:review-change` | reviewer agent (opus, fresh context) | `docs/REVIEW.md`, verdict `MERGE` or `FIX FIRST` |
| 6 | `/sdlc-kit:ship` | any | `docs/TRACE.md`, `docs/PR.md`, manual-check warning, `/cost` reminder; never pushes |

After a `FIX FIRST` review: a finding that needs a product decision goes into a requirement or an ADR by the human; then run `/sdlc-kit:implement-slice S<n>` again for the slice the finding belongs to, with the finding in the prompt. The slice reopens, the fix is test-first, the commit goes through the same gate.

Decisions stay with the human: the stack and the AI boundaries live in `docs/decisions/ADR-*.md`, the plan marks anything else `NEEDS HUMAN`, and the human answers by editing an ADR, not by chatting.

## Enforcement: four hooks, one gate

| Where | When | What it does | What a viewer sees on denial |
|---|---|---|---|
| `tools/hook-scope-guard.mjs` | before every Edit or Write | allows only the active slice's `**Files:**` (plus `docs/MANUAL-CHECKS.md`); with no slice, only `docs/**`; never `AGENTS.md`, `CLAUDE.md`, `docs/decisions/**`, approved `docs/REQUIREMENTS.md`, `.sdlc/**`; never `innerHTML` | `S3 allows src/domain/lines.js, tests/lines.test.js, docs/MANUAL-CHECKS.md. index.html is not in the plan. Stop and ask the human.` |
| `tools/hook-tests-after-edit.mjs` | after every Edit or Write under `src/` or `tests/` | runs `node --test`, hands the summary back to the model, never blocks | `node --test: 11 passed, 2 failed: R-02 rejects an empty name` |
| `tools/hook-commit-guard.mjs` | before every Bash command | on `git commit`: runs `gate.mjs --staged` with the message; denies `npm install`, `npx`, `rm -rf`, forced push, `--no-verify`, `--amend` | `Commit refused: tests: 1 passed, 1 failed: R-02 rejects an empty name.` then the gate table |
| `tools/hook-stop-gate.mjs` | when the agent wants to stop | while `.sdlc/slice` exists and tests are red, the agent may not stop; honours `stop_hook_active` | `Tests are red while S1 is active (1 failed: ...); finish the slice or revert, then stop.` |

The gate is one script, `tools/gate.mjs`, exit 0 or 1, and prints:

```
gate     tests  47 passed, 0 failed
gate     scope  S3: 2 files staged, all in plan
gate     trace  S3: 7 MUST, 0 missing, 0 orphan IDs
gate     commit "S3: money, lines and totals (R-11..R-17)" ok
GATE PASS
```

Flags: `--staged` (scope on the staged files, used by the git hooks), `--strict` (a manual check counts only when ticked `[x]`, used in CI), `--message "..."`, `--only commit`, `--root <dir>`. With an active slice the trace covers that slice's requirements and a listed manual check is enough; at ship time it covers every MUST. Without a plan or requirements it reports "no plan yet" and runs the tests only, so it also guards this kit's own repository.

Same gate, three callers: the Claude hook (fast path while the AI works), `.githooks/pre-commit` and `commit-msg` (any tool, any human), `.github/workflows/gate.yml` (the pipeline, `--strict`).

Helpers: `tools/scope.mjs S3` prints a slice's allowed files; `tools/trace.mjs` prints requirement coverage (`--listed`, `--slice S3`, `--markdown` for `docs/TRACE.md`).

## What works outside Claude Code

- `AGENTS.md` is read by Copilot, Cursor and most agents; `CLAUDE.md` is one line, `@AGENTS.md`; `.github/copilot-instructions.md` points at it too.
- The skills are plain Markdown files with frontmatter: another tool can read them as prompts.
- The git hooks and the CI workflow run the gate with plain Node; no Claude involved.
- Requirement IDs in test titles and commit messages are a convention any tool can follow.

Claude Code specific: the hooks in `hooks/hooks.json` (hard denial before the tool runs), the `model:` per skill, the forked agents (`context: fork`, `agent: builder|reviewer`) with their own tool lists, and the plugin packaging itself.

## Layout

```
.claude-plugin/plugin.json   skills/<name>/SKILL.md   agents/builder.md, reviewer.md
hooks/hooks.json             tools/*.mjs (+ *.test.mjs)   templates/ (AGENTS.md, ADR.md, githooks/, github-workflow-gate.yml)
```

Tests: `node --test` in this folder. Validate: `claude plugin validate .`
