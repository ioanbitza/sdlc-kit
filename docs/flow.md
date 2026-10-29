# The flow: eight steps, one section each

Each section says what the step takes as input, what the skill does (from its `SKILL.md`), what it writes, what the human does next, and the exact next command. The skills live in `skills/<name>/SKILL.md`; the kit root inside a skill is `${CLAUDE_PLUGIN_ROOT}`.

## Step 0: `/sdlc-kit:init`

**Input.** A git repository (the skill stops with "not a git repository" otherwise). Any model; the skill has `disable-model-invocation: true`, so only the human starts it.

**What it does.** Runs `node "${CLAUDE_PLUGIN_ROOT}/tools/init.mjs"`, the one command the commit guard allows on the kit path. The script writes `.sdlc/kit-path` (read by the git hooks only), adds `.sdlc/` and `.sdlc-kit/` (the folder the CI workflow checks the kit out into) to `.gitignore`, copies `templates/githooks/pre-commit` and `commit-msg` to `.githooks/` and makes them executable, sets `git config core.hooksPath .githooks`, copies `templates/github-workflow-gate.yml` to `.github/workflows/gate.yml` with the kit's own commit sha in the `ref:` line (so CI runs the gate the developer ran; it says when that sha is not pushed yet), merges the deny rules into `.claude/settings.json` (`permissions.deny`: no reading `.env` or keys, no `git push`, `git tag`, `--no-verify`, `npm install`, `npx`, `gh pr merge`; Claude Code enforces them in every mode, hooks or no hooks), copies `templates/AGENTS.md` when the repository has no `AGENTS.md`, and runs the gate once. Why these files are then frozen: the guards let an agent rewrite `.githooks/*` or the workflow only with the kit's template; any other content turns the gate off and is the human's decision.

**Writes.** `.sdlc/kit-path`, `.gitignore`, `.githooks/pre-commit`, `.githooks/commit-msg`, `.github/workflows/gate.yml`, `.claude/settings.json`, `AGENTS.md` (only if missing).

**The human.** Reads the report as printed. If `AGENTS.md` was copied, adapts it before anything else. Says yes to the offered commit `git add .githooks .github .gitignore && git commit -m "Kit hooks and CI gate"` when `git status --short` lists those files. `core.hooksPath` is local configuration: every fresh clone runs init once.

**Next.** `/sdlc-kit:write-requirements docs/BRIEF.md`

## Step 1: `/sdlc-kit:write-requirements <brief>`

**Input.** A brief, as a file path or pasted text; `AGENTS.md`; every file in `docs/decisions/`. Decisions already taken there are not open questions. Model: opus.

**What it does.** Separates what the brief says, implies and leaves open (three bullets at the top). Writes requirements as `### R-01 [MUST] Short title`, one behaviour each, one to three acceptance criteria, IDs `R-01` to `R-99` in one sequence; `[LATER]` for what is out of scope now. Lists assumptions `A-01`... for every choice the brief did not state. Lists open questions `Q-01`..., at most three open at a time, only the ones that change the design, each with the recommended answer first; more than three real questions: the three that block the first slices stay questions, the rest become assumptions marked `(to confirm)`. Sketches the data model (entities, fields, types, relations, how IDs are made). Puts `Status: draft` on the third line. Does not create `docs/MANUAL-CHECKS.md`; that appears with the first UI slice. Then stops and lists the open questions, one line each. No plan, no code. The whole file must be readable in three minutes.

**Writes.** `docs/REQUIREMENTS.md`; a brief pasted in the chat is saved first as `docs/BRIEF.md`, so the reviewers of step 1b read the same words.

**The human.** Answers the `Q-nn` in the chat; the skill folds each answer into the file (an answered question becomes a requirement or an assumption) and says the file is ready. The human changes the third line to `Status: approved` and commits the file. From then on the scope guard refuses every agent edit to it: `docs/REQUIREMENTS.md is approved, changing a requirement is a human decision; the human edits it, you ask.`

**Next.** `/sdlc-kit:review-requirements` (optional, recommended), then `/sdlc-kit:plan-slices`.

## Step 1b: `/sdlc-kit:review-requirements [docs/REQUIREMENTS.md]`

**Input.** The requirements file, draft or approved (`docs/REQUIREMENTS.md` by default); `docs/BRIEF.md`, `AGENTS.md`, `docs/decisions/*.md`; every `.claude/skills/domain-*/SKILL.md` when one exists; the kit's legal skills under `skills/legal-*/SKILL.md` and every project `.claude/skills/legal-*/SKILL.md`. No slice may be active. The main session is the clerk; the roles are `agents/product-owner.md`, `agents/domain-expert.md` and `agents/legal.md` (opus, read-only, `x-writes: []`). The skill has `disable-model-invocation: true`, so only the human starts it.

**What it does.** The six steps of the skill:

1. `node "${CLAUDE_PLUGIN_ROOT}/tools/reqreview.mjs" start $ARGUMENTS`. Refused in one sentence when the file does not exist (`run /sdlc-kit:write-requirements first`) or a slice is active. Otherwise prints the run number, the file with its `Status:` (and `uncommitted` when the file has changes git does not know), the roles to launch (`product-owner` always; `domain-expert` only when a domain skill exists; `legal` always, because the kit ships its legal skills), the domain skill paths or `none`, the legal skill paths (`sdlc-kit/skills/legal-data-protection/SKILL.md`, `sdlc-kit/skills/legal-e-invoicing/SKILL.md`, `sdlc-kit/skills/legal-licenses/SKILL.md`, then any project one), and writes `docs/requirements-review/brief.txt`: what to read and in what order, the legal skills by full path with their rule ids, the JSON shape, the checklists, and on a later run where to start numbering.
2. Launches the roles in parallel, in one message, with the Agent tool: `sdlc-kit:product-owner`, `sdlc-kit:domain-expert`, `sdlc-kit:legal`; each prompt is the text of `brief.txt`. Saves each answer verbatim to `docs/requirements-review/<role>.json`.
3. `reqreview.mjs check`. Validates every item: `id` in the role's prefix and unique (`PO-n`, `DOM-n`, `LEG-n`; a later run numbers after the earlier ones), `kind` one of `missing`, `wrong`, `priority`, `unclear`, `risk`, `severity` `blocking` or `advisory`, `requirement` `none` or an id the file defines, `title`, `why`, `suggested` strings, `proven` boolean, for a `DOM` item a `rule` the domain skill defines, and for a `LEG` item a `rule` one of the legal skills defines (`LD-nn`, `LL-nn`, `LE-nn`, or a project skill's `L?-nn`). `[]` needs the `Checklist:` line or a `Blocked:` line. One `RE-ASK <role>: <problem>` line per unusable answer; the clerk re-asks once with the problem named. Writes `items.json`.
4. `reqreview.mjs render`. Writes `docs/REQUIREMENTS-REVIEW.md`: `# Requirements review, run <n>`, `Reviewed: <sha> (<file>, Status: <status>)   Date: <date>`, `Roles: <roles> (<model>)   Domain skills: <paths or none>   Legal skills: <paths>`, then `## Items (<total>: <blocking> blocking, <advisory> advisory)` with one checkbox per item, blocking first, `- [ ] PO-1  blocking  missing  R-07  <title>` (a `DOM` or `LEG` item shows its rule after the requirement) with `why:` and `suggested:` indented under it, `## Checklists` (one line per role, `Blocked:` when the role said so) and `## Next`.
5. `git add docs/requirements-review docs/REQUIREMENTS-REVIEW.md && git commit -m "Requirements review"`.
6. Replies with one line: the run, the hash and the counts.

**Writes.** `docs/requirements-review/state.json`, `brief.txt`, `product-owner.json`, `domain-expert.json`, `legal.json`, `items.json`, and `docs/REQUIREMENTS-REVIEW.md`.

**The human.** Ticks the items to accept (`- [x]`); an untouched item is rejected. Says `Fold the ticked items of docs/REQUIREMENTS-REVIEW.md into docs/REQUIREMENTS.md`. On a draft the session folds each ticked item in with its `suggested` text (a `missing` item becomes a `### R-nn` heading with criteria, a `wrong` or `unclear` item changes a criterion, a `priority` item moves the scope, a `risk` item becomes an `A-nn` or a `Q-nn`); then the human sets `Status: approved` and commits. On an approved file the fold-in is the human's own edit: the scope guard refuses the file to every agent, and the session may only show the text to paste. A second run later numbers its items after the first (`PO-6`, `DOM-3`, `LEG-2`), so an id names one item forever. A `LEG` item is not legal advice: it names a rule and its source; the human decides by ticking, and asks a lawyer when the stake is real.

**Next.** `/sdlc-kit:plan-slices`

## Step 2: `/sdlc-kit:plan-slices`

**Input.** `docs/REQUIREMENTS.md` with `Status: approved` (the skill refuses a draft), `AGENTS.md`, `docs/decisions/*.md`. Model: opus.

**What it does.** Writes `docs/PLAN.md`, no code. The format is a contract parsed by the scope guard, the commit gate and `tools/scope.mjs`:

```
## S1 Customer rules (domain)
**Goal:** one sentence. **Covers:** R-01, R-02, R-03, R-05.
**Files:** `src/domain/customers.js`, `tests/customers.test.js`
```

Headings `## S<n> <title>` numbered from S1 with no gaps. `**Covers:**` lists the IDs the slice implements or shows on screen (ranges as `R-11..R-17`; a UI slice may say `**Covers on screen:**`). `**Files:**` is one line, every path in backticks, comma separated, relative to the repository root, at most six; `docs/MANUAL-CHECKS.md` is allowed in every slice and never listed. Each slice also has **Tests first** (titles starting with the requirement ID), **Steps** (at most five), **Verify** (commands, the manual checks for UI requirements, and for a UI slice the six `- [ ] UX: ...` checks of `skills/ui-ux/SKILL.md`), **Risks**. Rules: domain and storage first, UI after; every MUST in at least one `**Covers:**`; any architectural choice the decisions do not mention is marked `NEEDS HUMAN` and not decided. The file ends with `## Decisions needed from the human`, mandatory even when it says `none`: at most three decisions, each at most five lines, the recommendation first, then the alternative and its cost, in plain words for the person who owns the product, each naming the ADR to answer in. The skill stops and shows the package in under ten lines.

**Writes.** `docs/PLAN.md`, with `Status: draft` on its third line.

**The human.** Answers each decision in `docs/decisions/ADR-*.md` under `## Answered` with the line `Q: <question>  A (<date>, <name>): "<exact words>"`. Nothing said in the chat counts. Then tells the session; it updates the plan to match and removes the decided items from the package. Then the human changes the third line to `Status: approved` and commits: from that commit on the plan is the baseline. The guards refuse every agent edit to it, the gate's `contract` line fails when its text differs from the approving commit, and nothing builds before that line exists (the agent guard refuses to spawn the builder, the commit guard refuses the slice marker). To re-plan later the human removes the line first, runs the skill again, and approves the new plan; the re-approval is the commit that changes the Status line again. Why a git fact and not a state file: CI computes the same answer as the terminal, and there is nothing to lose or to edit by hand.

**Next.** `/sdlc-kit:implement-slice S1`

## Step 3: `/sdlc-kit:implement-slice S<n> [F-xx ...]`

**Input.** The slice id, and on a reopen the review findings to fix. `docs/PLAN.md`, `docs/REQUIREMENTS.md`, `AGENTS.md`. Model: sonnet, in the main session.

**What it does.** Checks that `docs/PLAN.md` carries `Status: approved` and stops if not (the human approves the plan before anyone builds it). Then `mkdir -p .sdlc && echo S<n> > .sdlc/slice` (the commit guard refuses the marker on an unapproved plan or while another slice is active), then `node "${CLAUDE_PLUGIN_ROOT}/tools/scope.mjs" S<n>` to print the allowed files. Reads the slice and its requirements; before a UI slice (files under `src/ui/`, `index.html`, `styles.css`) reads `${CLAUDE_PLUGIN_ROOT}/skills/ui-ux/SKILL.md` with `cat`, and before a domain or storage slice the project's `.claude/skills/domain-*/SKILL.md` when one exists. Writes a three-line start note (what will change, what it assumes). Tests first for domain and storage: write them, run `node --test`, confirm they fail for the right reason (a missing module or a wrong value, not a syntax error). Writes the smallest code that passes. For a UI slice adds `- [ ] R-xx: ...` lines and the six `- [ ] UX: ...` lines to `docs/MANUAL-CHECKS.md`, unticked (a `UX:` line carries no requirement id; `trace.mjs` counts it neither as a requirement nor as an orphan). `git status` must show only planned files. Runs `node "${CLAUDE_PLUGIN_ROOT}/tools/gate.mjs"`. Stages by name and commits in one command: `git add src/domain/lines.js tests/lines.test.js && git commit -m "S3: lines and totals (R-11..R-13)"`; the subject starts with `S<n>`, the IDs are the slice's `**Covers:**`. `git add -A`, `git add .` and `git commit -a` are refused: the hook must see the files. Then `rm .sdlc/slice`, which the guard allows only once the tests are green and the slice's files are committed; otherwise the marker stays and the human closes the slice. Reports in five lines: what changed, which tests ran, the commit hash, what it was unsure about.

On a reopen (`S3 F-01 F-02`): reads the findings in `docs/REVIEW.md`, only the ones the human accepted in `docs/review/<cycle>/decisions.json`; for each, first the test that would have caught it (it must fail now), then the smallest fix inside the slice's files; the commit names them: `S3: fix F-01, F-02 (R-12, R-15)`. Findings routed elsewhere (plan, requirement, ADR) are not touched.

When a guard denies something, the sentence says which slice is active, which files are allowed and what to do. The skill does not retry another way and does not widen the slice in `docs/PLAN.md`; it stops and tells the human.

**Writes.** The slice's files, `docs/MANUAL-CHECKS.md` for a UI slice, one commit.

**The human.** Reads the report. Checks the browser for a UI slice.

**Next.** `/sdlc-kit:build-slices S2 S3 S4` (or `implement-slice` again, one at a time).

## Step 4: `/sdlc-kit:build-slices S<n> S<m> ...`

**Input.** The slice ids in order. Model: sonnet, in the `builder` agent (`agents/builder.md`, `context: fork`, `x-writes: slice`), which starts with no memory of any conversation.

**What it does.** Reads `AGENTS.md`, `docs/REQUIREMENTS.md`, `docs/PLAN.md` and the domain skill once, the UI rules before the first UI slice, then runs the step 3 loop for each slice in order: marker, scope, tests first, smallest code, manual checks for UI (`R-xx:` and `UX:` lines), `git status`, gate, `git add <file> <file> && git commit -m "S<n>: <what changed> (R-xx, R-yy)"`, `rm .sdlc/slice`. **Stop rule:** if the gate fails and cannot be made to pass inside the slice's files within two attempts, the builder stops, does not continue to the next slice, does not touch files outside the slice, does not weaken a test, leaves `.sdlc/slice` in place so the state is visible, and reports.

**Writes.** One commit per slice. The report is one line per slice:

```
S2  done   a1b2c3d  12 tests green
S3  done   d4e5f6a  21 tests green
S4  FAILED gate: tests 1 failed: R-20 invalid JSON ...  (files left uncommitted, .sdlc/slice = S4)
S5  not started
```

followed by two lines: what it was unsure about, and what the human should check in the browser.

**The human.** On a failure: reads the gate reason, fixes the cause (often a plan or requirement question), removes or keeps the marker, and restarts from the failed slice. Ticks nothing yet.

**Next.** `/sdlc-kit:review-change`

## Step 5: `/sdlc-kit:review-change [--cycle n]`

**Input.** A clean tree, no active slice, every slice committed. The main session is the clerk: it decides nothing about the code. The finders and the verifier are `agents/finder-*.md` and `agents/verifier.md` (opus, read-only, `x-writes: []`); `finder-legal` always runs in cycle 1 with the kit's legal skills (and any project `.claude/skills/legal-*/`); `finder-domain` runs only when a domain skill exists under `.claude/skills/domain-*/`.

**What it does.** The seven steps of the skill:

1. `node "${CLAUDE_PLUGIN_ROOT}/tools/review.mjs" start $ARGUMENTS`. Refused in one sentence on a dirty tree, an active slice, a cycle 3 (`BUDGET: human decision`), or a cycle 2 before the human decided on cycle 1. Otherwise prints the cycle, the reviewed commit, the scope (`main..HEAD` on a branch ahead of `main`, else `all`), the finder classes to run (`correctness, security, contract, legal`, plus `domain` with a domain skill), the domain skill path or `none`, the legal skill paths, and writes two briefs: `docs/review/<cycle>/brief.txt` for the finders and `verifier-brief.txt` for the verifier; both name the legal skills by full path with their rule ids.
2. Launches the finders named in step 1 in parallel, in one message, with the Agent tool: `sdlc-kit:finder-correctness`, `sdlc-kit:finder-security`, `sdlc-kit:finder-contract`, `sdlc-kit:finder-legal`, and `sdlc-kit:finder-domain` when named; each prompt is the text of `brief.txt`. Saves each answer verbatim to `docs/review/<cycle>/finder-<class>.json`.
3. `review.mjs check --cycle <n>`. For each `RE-ASK finder-<class>: <problem>` line, launches that finder once more with the brief plus `Your previous answer was not usable: <problem>. Return the JSON array and the Checklist line, nothing else.` A finder is re-asked at most once.
4. Launches the verifier (`sdlc-kit:verifier`) with `verifier-brief.txt` as its whole prompt. Saves its JSON to `verifier.json` and its `Model:`, `Gate:`, `Mutations:` and `  survived:` lines (and `Partial:` or `Blocked:`) to `verifier.txt`.
5. `review.mjs render --cycle <n>`. On `RE-ASK verifier: <problem>`, re-asks once. The script validates both JSON shapes, places every id exactly once, runs the gate and `mutate.mjs` itself for the header, computes each route from `docs/PLAN.md`, decides the verdict and writes `docs/REVIEW.md`.
6. `git add docs/review docs/REVIEW.md && git commit -m "Review cycle <n>: <verdict>"` (docs only, no slice active, so a plain message is accepted).
7. Replies with `Review cycle <n> committed as <hash>.` and exactly the verdict block `render` printed, nothing else: the human reads `docs/REVIEW.md` itself.

**Writes.** `docs/review/state.json`, `docs/review/<cycle>/brief.txt`, `verifier-brief.txt`, `finder-*.json`, `findings.json`, `verifier.json`, `verifier.txt`, and `docs/REVIEW.md`.

**The human.**

- `MERGE`: go to ship.
- `FIX FIRST`: read each confirmed finding, say accept or reject, and record it from your own terminal: `node ~/sdlc-kit/tools/review.mjs decide --cycle 1 --accept F-01,F-02 --reject F-03..F-18 --note "<your words>"`. Every confirmed F-id goes in exactly one list or the script refuses. Commit `docs/review/1/decisions.json`. Then follow the routes: a `code` route reopens the slice (`/sdlc-kit:implement-slice S3 F-01 F-02`), a `plan` route means the human removes `Status: approved` from `docs/PLAN.md`, runs `/sdlc-kit:plan-slices` again and approves the new plan, a `requirement` route is a `Q-nn` answered in `docs/REQUIREMENTS.md` (the human edits the approved file and re-approves it in the same commit), a trade-off is an ADR.
- `BUDGET: human decision`: cycle 2 ended with a reason left. Ship as it is (`/sdlc-kit:ship` prints the review line as a warning) or reopen the finding as a new requirement (`R-nn`, re-plan, build, then a fresh review from cycle 1).

**Next.** `/sdlc-kit:review-change --cycle 2` after the fixes, or `/sdlc-kit:ship`.

## Step 6: `/sdlc-kit:ship`

**Input.** No active slice (the skill stops and names the open slice otherwise). The manual checks ticked by the human who ran them.

**What it does.** Runs `node "${CLAUDE_PLUGIN_ROOT}/tools/gate.mjs" --review`; on failure it stops and reports the failing line, fixing nothing. The `review` line is a warning here, never a failure: `none (run /sdlc-kit:review-change)`, `<sha> is N commits old (...): re-review needed`, or `<sha> ok, verdict FIX FIRST`. Writes `docs/TRACE.md` with `node "${CLAUDE_PLUGIN_ROOT}/tools/trace.mjs" --markdown > docs/TRACE.md`. Runs `trace.mjs` and prints exactly `manual checks: <listed> listed, <passed> passed; the unticked ones stay open for QA`. Writes `docs/PR.md` with five short sections: **What** (a paragraph and the slice list from `git log --oneline`), **Why** (the brief in two lines, a link to `docs/REQUIREMENTS.md`), **How it was verified** (the gate table with the `review` line, `node --test` totals, the manual checks line, the header and verdict of `docs/REVIEW.md`, the human's decisions from `decisions.json`, the review warning in plain words if any), **Open items** (every `LATER` requirement and every unticked manual check, marked `LATER` or `QA`), **Decisions** (the files in `docs/decisions/` with their titles). Commits `git add docs/TRACE.md docs/PR.md && git commit -m "Ship: trace matrix and PR description"`. Prints the gate table, the manual checks line, the review verdict, and `run /cost now for the session total`.

**Never.** Push, open a pull request, merge, tag (ADR-002). Tick a manual check. Change code or tests.

**Writes.** `docs/TRACE.md`, `docs/PR.md`.

**The human.** Pushes, opens the pull request with `docs/PR.md`, and has it approved by a human. CI runs `gate.mjs --strict`: an unticked manual check, a stale or non-`MERGE` review, or a surviving planted defect fails the build.

## Files only humans write

The scope guard and the commit guard refuse these to every agent, by Edit, Write or shell:

| File | Why |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | the rules the agents run under |
| `.claude/settings.json`, `.claude/settings.local.json` | the session's own configuration |
| `docs/decisions/**` | the ADRs and every answered question |
| any document under `docs/` once it says `Status: approved` or `accepted` (`docs/REQUIREMENTS.md`, `docs/PLAN.md`, a UI spec, an ADR) | it is the baseline from the commit that approved it; the gate's `contract` line checks the history, and no agent may write the approving line itself |
| `- [x]` in `docs/MANUAL-CHECKS.md` | a tick is the signature of the person who ran the check; agents append checks unticked |
| `.githooks/*`, `.github/**` unless the content is the kit's template | a changed hook or workflow turns the gate off |
| `.claude/skills/domain-*/SKILL.md` once it exists | the domain rules `D-nn` the human signed; the AI may draft the file once, as a project skill |
| `.claude/skills/legal-*/SKILL.md` once it exists | the project's own legal rules (`L?-nn`, from `templates/legal-skill.md`) the human signed; the kit's three legal skills live in the kit and are read-only from a project like every kit file |
| `docs/review/<cycle>/decisions.json` | the human's accept or reject on each finding, written by `review.mjs decide` |
| `.sdlc/**` | kit state; by shell only `mkdir`, `echo S<n> > .sdlc/slice` and `rm` are allowed |
| the kit's own folder | the kit changes in its own repository; a project session may only `cat`, `head`, `tail`, `grep`, `ls` it and run `node <kit>/tools/<name>.mjs` |

Project skills under `.claude/skills/<name>/SKILL.md` are the one thing the main session may write when no slice is active, so a step you repeat becomes a skill written with the AI and reviewed like code. A domain skill (`domain-<area>`) or a project legal skill (`legal-<area>`) is written the same way once; after that it is human-only. They are written with the Write tool as a whole file; their frontmatter may hold only `name`, `description` and `argument-hint`; they may not mention `${CLAUDE_PLUGIN_ROOT}`, `.sdlc` or the kit path.

## Cycle rules

- Two fix rounds at most: cycle 1, fixes, cycle 2. Cycle 2 ends in `MERGE` or `BUDGET: human decision`, never `FIX FIRST`; a third `review-change` is refused with `BUDGET: human decision. Two fix rounds ran (cycles 1 and 2); a third review is not allowed, the human decides what ships.`
- Cycle 2 starts only after the human decided on every confirmed finding of cycle 1 (`review.mjs decide`). It carries the accepted findings under their F-ids, lists the rejected ones in `docs/REVIEW.md` under "Rejected by the human", and never raises them again: a rejected id the verifier confirms anyway is dropped from the count with the clerk note `<id> rejected by the human in cycle 1; not counted`.
- Cycle 2 runs only the finder classes that produced a confirmed or watch-listed finding in cycle 1. A `VER` finding against the tests counts as contract. The finders are not told about carried findings; a re-found defect is merged under its F-id. A new verifier re-checks each carried finding and marks it fixed (`refuted`, with the fix as evidence) or still present (`confirmed`). New findings number after cycle 1's last id per class (`COR-9`, `SEC-5`, `CON-4`, `LEG-2`, `VER-7`); new confirmed findings get the next free F-ids. F-ids never change.
- A finder whose answer is not valid JSON, or misses a field, is re-asked once with the problem named. The second answer is used as it is.
- The builder stops after two attempts on one gate failure, leaves `.sdlc/slice` in place and reports.
- The stop hook blocks a stop on red tests once per slice, and never when the agent is asking the human a question or reporting a denial.
