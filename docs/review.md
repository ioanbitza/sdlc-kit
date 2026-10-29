# The review stage

One cycle is: four finders in parallel (five when the project has a domain skill), a verifier on another model, and a script that writes the verdict. The main session is the clerk: it runs the script, launches the agents, saves what they return, and commits. It judges nothing. The agent files are `agents/finder-correctness.md`, `agents/finder-security.md`, `agents/finder-contract.md`, `agents/finder-legal.md`, `agents/finder-domain.md`, `agents/verifier.md`; the script is `tools/review.mjs`; the skill is `skills/review-change/SKILL.md`. The review of the requirements, before any code, is a separate stage with its own roles and script: step 1b in [flow.md](flow.md).

## The finders

Four finders, one class of defect each, opus, read-only (`tools: Read, Bash`, `x-writes: []`): correctness, security, contract, and legal, which always runs because its rules ship with the kit (`skills/legal-*/SKILL.md`, plus any project `.claude/skills/legal-*/SKILL.md`); plus a fifth, `finder-domain`, that `review.mjs start` names only when a file matches `.claude/skills/domain-*/SKILL.md`. Each reads in a fixed order so the author's story does not steer it: `docs/REQUIREMENTS.md`, `docs/PLAN.md`, `AGENTS.md` and `docs/decisions/*.md` (the domain finder reads the domain skill first, the legal finder the legal skills), then the diff (`git diff <scope>` from the brief, or every file under `src/`, `tests/`, `index.html` when the scope is `all`), then the tests under `tests/`, and the author's commit messages last. Each runs its whole checklist and reports every suspicion, marked `proven: false` when it cannot show it. A defect of another class still goes in, with that class; the verifier routes it. A finder does not run `node --test` (the verifier does), never changes a file or git state, and never fixes anything.

The checklists themselves live in one place, the agent files, so this page does not repeat them; each finder runs every item of its list and names in its `Checklist:` line which ones fired. What each one is for, and what `blocking` means to it:

| Finder | Looks for | `blocking` means |
|---|---|---|
| `finder-correctness` (ids `COR-n`) | inputs the happy path ignores, money and rounding, swallowed errors and silent fallbacks, state the requirements do not allow, storage that loses or corrupts data, relations, IDs, and whether each rule's test would fail on a wrong implementation | a MUST fails for an input a user can produce, money is wrong, or data is lost or corrupted |
| `finder-security` (ids `SEC-n`) | user text rendered as HTML (what got past the scope guard), validation at the boundary and validation that lives only in the UI, data from an older version, swallowed storage errors, trusted IDs from storage, anything that leaves the page, error messages that echo input or leak internals | user text can run as markup or script, invalid data a user can type can be stored, or a storage error that loses data is swallowed |
| `finder-contract` (ids `CON-n`) | each MUST against its code and criteria, behaviour nobody asked for, files outside the plan, the layer rules of `AGENTS.md`, test titles and coverage against the plan's test list, tests that cannot fail, commit messages against their slices, silent decisions, a UI slice without its UX checks | a MUST has no code or no test, a requirement is misread so a user sees the wrong behaviour, a test was weakened or cannot fail, a file is outside the plan, or a layer rule is crossed |
| `finder-domain` (ids `DOM-n`, field `rule`) | every `D-nn` rule of `.claude/skills/domain-*/SKILL.md` against the code and the tests: rounding, immutability, numbering, mandatory fields, terms, units, a test per rule, data from storage that breaks a rule. Returns `[]` and `Blocked: no domain skill` when no skill exists | a document, an amount or a sequence a user produces breaks a rule |
| `finder-legal` (ids `LEG-n`, field `rule`) | every `L?-nn` rule of the legal skills against the code and the tests: personal data in logs, errors or URLs, data kept past its purpose, erasure and export, correction, licences and notices, invoice numbering and integrity, a test per rule | the app as built breaks a legal obligation for a user who uses it as intended |

A theoretical limit, a message-only difference, or input a user cannot reach through the app is `advisory`. Naming, wording and style are `advisory` or nothing.

### The handover shape

A JSON array, one object per finding, then one line:

```json
[{"id":"COR-1","class":"correctness","severity":"blocking","file":"src/domain/money.js","line":14,
  "what_breaks":"...","requirement":"R-15","evidence":"...","proven":true}]
Checklist: items 1-8 ran; fired: 2, 5; not run: none
```

`review.mjs check` validates every field by type (`id`, `class`, `severity`, `file`, `what_breaks`, `requirement`, `evidence` strings; `line` a number; `proven` a boolean), the id shape (`COR-1`, `SEC-1`, `CON-1`, `DOM-1`, `LEG-1`), the class and the severity; a `domain` finding also needs `rule` (`D-nn`), and the id must be one the domain skill defines (`RE-ASK finder-domain: item 1 (DOM-1): rule "D-09" is not defined in the domain skill (defined: D-01, D-02, D-03)`); a `legal` finding needs `rule` (`LD-nn`, `LL-nn`, `LE-nn` or a project prefix) and the id must be one a legal skill defines (`RE-ASK finder-legal: item 1 (LEG-1): rule "LD-99" is not defined in a legal skill (defined: LD-01, ..., LL-11)`). `[]` is valid only with the `Checklist:` line that says every item ran. A finder that cannot read the diff returns `[]` and `Blocked: <what>`; one that runs out of turns returns what it has and `Partial: <what was not checked>`. `proven: true` needs the exact path through the code with the input that triggers it (correctness), the path from the input to the harm with the exact input such as the customer name `<img src=x onerror=alert(1)>` (security), or both sides quoted, the code line and the requirement or plan line it contradicts (contract).

## The verifier

Opus, read-only, and never the author's model: the brief tells it the author's model (`sonnet` unless `start --author` said otherwise), and if its own model equals it, it returns `pass: false` with every id on the watch list and `Blocked: verifier on the author's model`. It did not write the code and did not find the defects. It never saw the finders' or the author's conversation; everything it knows is in the brief and the files.

Its steps, from `agents/verifier.md`:

1. `git status --short -- . ':!docs/review'` must be empty and `.sdlc/slice` must not exist; otherwise `pass: false` and `Blocked: <what>`.
2. Run the gate with the command the brief gives (`node "<kit>/tools/gate.mjs"`); keep its last line and the `node --test` totals for the `Gate:` line.
3. Plant defects with `node "<kit>/tools/mutate.mjs"`, no `--max`, so every site runs and cycle 2 sees the same survivors as cycle 1. Judge every survivor and list it in `survivors` with `equivalent: true` (the program behaves the same for every input; say why) or `equivalent: false`. Each non-equivalent survivor is also the verifier's own finding, `VER-n`, `blocking`, level `code`, against the test file that should have caught it. An equivalent one is not a finding: the script prints it in the header as the verifier's judged call, and the strict gate in CI excludes the same mutant, so the review and CI agree.
4. Reproduce or refute each finder finding by following the code path with the triggering input. Proven means it can be shown now. Severity follows the finders' bar, whatever the finder said. What can be neither proven nor refuted goes to the watch list with `why_unproven` and `how_to_settle`.
5. Merge findings with the same root cause: keep the id with the best evidence, list the others in `merged`.
6. Contradictions (fixing one breaks another) are decided on evidence, citing the rule: visible errors beat convenience, exact money beats speed, no lost data beats everything. When both sides hold and someone must weigh a cost, it is a `tradeoffs` entry for the human, not a verdict.
7. Name the broken level of each confirmed finding: `code` (the builder fixes it in its slice), `plan` (the rule is in the wrong slice or file, or a test is missing from the plan), `requirement` (missing, ambiguous or contradicted; the human answers).
8. Rank confirmed findings: blocking before advisory, then by what the user loses.
9. Tests that cannot fail are the verifier's own `VER-n` findings, blocking, level `code`.

Placement rule: every finder id, and every carried F-id, appears exactly once, in `confirmed` (directly or inside a `merged` list), in `watchList`, or in `refuted` with the evidence. `pass: true` only when no confirmed blocking finding remains, `tradeoffs` is empty, the gate printed `GATE PASS` in this session, and no non-equivalent planted defect survived.

The handover is one JSON object and three lines:

```json
{"pass":false,
 "confirmed":[{"id":"COR-1","class":"correctness","severity":"blocking","file":"src/domain/lines.js","line":31,"what_breaks":"...","requirement":"R-12","evidence":"...","proven":true,"rank":1,"level":"code","merged":["CON-3"]}],
 "watchList":[{"id":"SEC-2","class":"security","severity":"advisory","file":"src/ui/main.js","line":7,"what_breaks":"...","requirement":"none","evidence":"...","proven":false,"why_unproven":"...","how_to_settle":"..."}],
 "refuted":[{"id":"CON-1","evidence":"..."}],
 "tradeoffs":[{"findings":["SEC-4","COR-2"],"options":["...","..."],"cost":"...","recommendation":"..."}],
 "survivors":[{"file":"src/domain/state.js","line":45,"from":"0","to":"1","equivalent":true,"why":"the index is clamped to 0 one line later; same value for every input"}]}
Model: opus
Gate: GATE PASS, 44 passed, 0 failed
Mutations: 196 planted, 195 caught, 1 survived
  survived: src/domain/state.js:45 "0" -> "1"
```

`review.mjs render` validates the object: `pass` boolean; `confirmed`, `watchList`, `refuted`, `tradeoffs` arrays; each confirmed item with string `id`, `severity`, `file`, `what_breaks`, `evidence`, `level` (`code`, `plan` or `requirement`), id `COR-n`, `SEC-n`, `CON-n`, `DOM-n`, `LEG-n`, `VER-n` or a carried `F-nn`, `merged` an array when present (a confirmed `DOM-n` or `LEG-n` keeps the finder's `rule` when the verifier left it out); each refuted item with `id` and `evidence`; each survivor with `file`, `from`, `to`, an integer `line`, a boolean `equivalent` and a `why` when equivalent. The `Model:` line is normalised to `opus`, `sonnet`, `haiku` or `fable`; anything else is printed as written, or `not reported`.

## `tools/review.mjs`, the clerk's script

| Subcommand | Does | Refuses |
|---|---|---|
| `start [--cycle n] [--scope <range>\|all] [--author sonnet]` | records `HEAD`, the scope (`main..HEAD` on a branch ahead of `main`, else `all`: every file under `src/`, `tests/`, plus `index.html` and `styles.css`), the files, the finder classes to run (`legal` always in cycle 1; `domain` only when `.claude/skills/domain-*/SKILL.md` exists), the domain skills and the legal skills with their rule ids, and the author's model in `docs/review/state.json`; writes `docs/review/<cycle>/brief.txt` and `verifier-brief.txt` (both name the domain skill and its rules when there is one, and the legal skills by full path with their rules); prints `review   cycle 1   HEAD 3f9c2d1   scope main..HEAD (5 commits, 9 files)`, `classes  correctness, security, contract, legal`, `domain   none (no skill under .claude/skills/domain-*/; finder-domain not run)` or the skill path, `legal    sdlc-kit/skills/legal-data-protection/SKILL.md, ...`, the brief paths and the next command | `Review refused: the working tree has uncommitted changes; commit or revert them first.`; `Review refused: S3 is still active (.sdlc/slice); finish the slice or remove the marker first.`; `BUDGET: human decision. Two fix rounds ran (cycles 1 and 2); a third review is not allowed, the human decides what ships.`; `Review refused: cycle 2 needs a rendered cycle 1 in docs/review/state.json; run cycle 1 first.`; `Review refused: cycle 1 confirmed F-01, F-02 and the human has not decided; run node review.mjs decide --cycle 1 --accept <F-ids> --reject <F-ids> first.` |
| `check --cycle n` | reads each `finder-<class>.json`, validates it, merges the lists into `findings.json` in class order (a repeated id becomes `COR-7a`, `COR-7b`, never dropped; the finder files stay as saved); prints one line per finder with its count and `Checklist:` line, then `findings  7 in docs/review/1/findings.json (finder files untouched); launch the verifier, ...` | exit 1 with one `RE-ASK finder-<class>: <problem>` line per unusable answer (`no JSON found`, `JSON is not closed`, `the answer is not a JSON array`, `item 2 (COR-2) is missing "evidence"`, `an empty array needs the Checklist: line that says every item ran`, ...) |
| `render --cycle n` | validates `verifier.json`; places every finder id and carried F-id exactly once (an id the verifier forgot goes to the watch list with `why_unproven: verifier did not place it`; an id placed twice keeps its first placement; a carried F-id the verifier wrote under its old finder id is read as the F-id); drops a confirmed id the human rejected in the previous cycle, with a note; runs the gate and `mutate.mjs` itself for the `Gate:` and `Mutations:` header lines and marks each measured survivor with the verifier's `equivalent` judgment; assigns F-ids (`F-01`, `F-02`, ... from `state.nextF`; a carried finding keeps its F-id); computes each route from `docs/PLAN.md`; decides the verdict; writes `docs/REVIEW.md`; prints `docs/REVIEW.md written (cycle 1, 2 confirmed, 1 on the watch list, 4 refuted)` and the verdict block | `RE-ASK verifier: <problem>` per shape problem; the clerk re-asks once |
| `decide --cycle n --accept F-01,F-02 --reject F-03..F-18 [--note "..."]` | writes `docs/review/<n>/decisions.json` (`cycle`, `accepted`, `rejected`, `note`, `decidedAt`) and prints `decided  cycle 1: 2 accepted (F-01, F-02), 1 rejected (F-03); note: ...` and the next command; the commit guard refuses it to every agent | `Decision refused: F-09 is not confirmed in cycle 1 (confirmed: F-01, F-02, F-03).`; `Decision refused: F-02 in both lists; each F-id goes in exactly one.`; `Decision refused: F-03 not decided; every confirmed F-id goes in --accept or --reject.`; `Decision refused: cycle 1 is not the rendered cycle in docs/review/state.json.` |

F-ids never change: a finding keeps the F-id it got the first time, in every later cycle, whether it is confirmed again or refuted. Rows in `docs/REVIEW.md` wrap at 100 characters.

### Routes

Computed by the script from the verifier's `level` and the plan's `**Files:**` lines:

| Level | Route printed |
|---|---|
| `code` | `reopen S3` (the slices whose `**Files:**` own the finding's file and its merged findings' files); `reopen: no slice in docs/PLAN.md owns <file>; re-plan` when none does |
| `plan` | `re-plan: /sdlc-kit:plan-slices with the finding` |
| `requirement` | `question to the human: Q-04 in docs/REQUIREMENTS.md` (the next free `Q` number) |
| a trade-off | `ADR by the human` |

## A sample `docs/REVIEW.md`

```
# Review, cycle 1
Reviewed: 3f9c2d1 (main..HEAD, 5 commits)   Date: 2026-10-26
Finders: correctness, security, contract, domain, legal (opus)   Verifier: opus (reported)   Author: sonnet
Gate: GATE PASS, tests 44 passed, 0 failed   Mutations: 196 planted, 194 caught, 2 survived
  survived: src/domain/money.js:14 "<=" -> "<"
  survived (equivalent): src/domain/state.js:45 "0" -> "1" (the index is clamped to 0 one line later)

## Confirmed (4)
F-01  COR-1  blocking  code  src/domain/lines.js:31  R-12  Unit price has no upper bound; 1e308 * qty gives Infinity cents
      evidence: lines.js:31 multiplies without a bound; input unitPrice=1e308, qty=2 -> Infinity
      merged: CON-3
      route: reopen S3
F-02  VER-1  blocking  code  tests/money.test.js:9  R-15  Planted "<=" -> "<" in money.js:14 survived: no test covers the boundary
      evidence: mutate.mjs
      route: reopen S2
F-03  DOM-1  blocking  code  src/domain/money.js:22  R-15  D-02  Line total uses Math.floor; D-02 says half up
      evidence: money.js:22 Math.floor(cents); D-02 "A line total rounds half up to the cent"; 12.5 -> 12
      route: reopen S2
F-04  LEG-1  blocking  code  src/storage/customers.js:22  R-07  LD-09  Customer email written to console.log on every save
      evidence: customers.js:22 console.log("saved", customer); LD-09 "Personal data does not leak into logs"
      route: reopen S4

## Watch list (1)
      SEC-2  advisory  src/ui/main.js:7  none  Error text is built from the input before it reaches textContent
      why unproven: the string never meets the DOM as HTML in the diff        how to settle: probe with <img src=x onerror=alert(1)> in the name field

## Refuted (4)
      CON-1  docs/MANUAL-CHECKS.md belongs to every slice; the scope guard allows it everywhere
      ...

## Trade-offs (0)

## Checklists
correctness: items 1-8 ran; fired: 1, 2; not run: none
security: items 1-8 ran; fired: 8; not run: none
contract: items 1-10 ran; fired: 1, 3; not run: none
domain: items 1-8 ran; fired: 1; not run: none
legal: items 1-8 ran; fired: 1; not run: none

## Verdict: FIX FIRST
Why: 4 blocking findings confirmed; 1 planted defect survived.
Routes: reopen S3 (F-01); reopen S2 (F-02, F-03); reopen S4 (F-04).
Next: say accept or reject for each F-id, then: node review.mjs decide --cycle 1 --accept <F-ids> --reject <F-ids> --note "<your words>"
      /sdlc-kit:implement-slice S2 F-02 F-03
      /sdlc-kit:implement-slice S3 F-01
      /sdlc-kit:implement-slice S4 F-04
      then /sdlc-kit:review-change --cycle 2.
Not checked: UI in a real browser (manual checks in docs/MANUAL-CHECKS.md).
```

A `DOM` or `LEG` row shows the rule between the requirement and the text. The `Finders:` line lists the classes that ran: four, or five with a domain skill.

In cycle 2 the file also has `## Rejected by the human (cycle 1)` with the rejected F-ids and the note, and `## Clerk notes` whenever the script renumbered or placed something itself (`COR-3 was not placed by the verifier; put on the watch list`, `renumbered: COR-7 -> COR-7a`, `the verifier said pass: true, the script says FIX FIRST: ...`, `verifier reported "Mutations: ..."; measured now: ...`).

## The verdict rules

The verdict is the script's, not the verifier's.

- `MERGE`: no confirmed blocking finding, no open trade-off, no surviving planted defect as measured by the script in this run (equivalents excluded), and the verifier said `pass: true`. `Next: /sdlc-kit:ship.`
- `FIX FIRST`: any of those reasons remains, in cycle 1. The `Why:` line lists them; the `Next:` lines give the `decide` command and one `implement-slice` line per slice to reopen, lowest slice first.
- `BUDGET: human decision`: any reason remains at the end of cycle 2. There is no cycle 3. `Next:` offers two choices: ship as it is (`/sdlc-kit:ship` prints the review line as a warning, visibly) or reopen as a new requirement (`R-nn` in `docs/REQUIREMENTS.md`, re-plan, build, a fresh review from cycle 1).
- A carried blocking finding the verifier neither refuted nor confirmed adds the reason `carried finding F-01 not shown fixed or still present`.

The `Gate:` and `Mutations:` header lines are measured by the script; the model names are what the finder agent files declare and what the verifier reported (`(reported)`). The last line is always `Not checked: UI in a real browser (manual checks in docs/MANUAL-CHECKS.md)`.

## Blind-spot matrix: who makes the mistake, who catches it

| Mistake generated code usually makes | Made by | Caught by | Evidence on screen |
|---|---|---|---|
| Money as floats, rounding drift | builder | `finder-correctness` item 2; the verifier re-running the path with the input | `COR-n` with the input and the wrong value |
| User text rendered as HTML | builder | the scope guard refuses `innerHTML`, `insertAdjacentHTML`, `document.write` on write in any code file; `finder-security` item 1 for what got around it | the denial sentence; `SEC-n` with the probe string |
| Swallowed errors, silent fallbacks | builder | `finder-correctness` item 3, `finder-security` item 5 (storage errors) | `COR-n` or `SEC-n` quoting the `catch` |
| A test that cannot fail, a skipped test | builder | the scope guard refuses `test.skip`, `.only(`, `assert.ok(true)`; `finder-contract` item 7; the verifier's planted defects (`Mutations:` line, `VER-n` per survivor) | the denial; `Mutations: 196 planted, 194 caught, 2 survived` |
| A file outside the plan | builder | the scope guard before the write; the commit guard reads `git add <files> &&` and the paths on `git commit` into the staged set, so the gate's `scope` line fails before the commit; `finder-contract` item 3 | `S3 allows ... index.html is not in the plan.` or `Commit refused: scope: S3: index.html is not in the plan (allowed: ...)` |
| A loosened assertion against the plan's test list | builder | `finder-contract` item 6; the verifier's planted defects | `CON-n` quoting the plan line and the test |
| A decision taken silently (a dependency, a folder, a config) | planner, builder | the commit guard refuses `npm install`, `npx`; `plan-slices` must mark it `NEEDS HUMAN`; `finder-contract` item 9 | the denial; the decision package; `CON-n` |
| A requirement misread, or read two ways | planner, builder | `finder-contract` item 1 with both readings; the verifier routes it to level `requirement` | `route: question to the human: Q-nn in docs/REQUIREMENTS.md` |
| A domain rule broken in code (rounding, an issued document that changes, a gap in a sequence) | builder | `finder-domain` against the `D-nn` rules of `.claude/skills/domain-*/SKILL.md`; the verifier judges the finding against the rule text | `DOM-n` with `rule: D-nn`, the rule quoted in the evidence |
| A requirement that breaks a domain rule, or a flow with a dead end, before any code | the requirements | `/sdlc-kit:review-requirements`: `product-owner` and `domain-expert`, `reqreview.mjs` validates the items | `docs/REQUIREMENTS-REVIEW.md`: `- [ ] DOM-1  blocking  wrong  R-05  D-02  ...` |
| Personal data the app cannot erase or export, an invoice that can be edited after issue, a dependency whose licence forbids the use, before any code | the requirements | `/sdlc-kit:review-requirements`: `legal` against the `L?-nn` rules of the kit's legal skills, `reqreview.mjs` refuses a rule no skill defines | `docs/REQUIREMENTS-REVIEW.md`: `- [ ] LEG-1  blocking  missing  none  LD-07  ...` |
| A legal rule broken in code (personal data in a log or an error, an export that is not machine-readable, a licence notice dropped, data kept past its purpose) | builder | `finder-legal` against the legal skills; the verifier judges the finding against the rule text and its `Source:` | `LEG-n` with `rule: LD-nn`, the rule quoted in the evidence |
| A UI slice without its UX checks | builder | `finder-contract` item 10 | `CON-n`, advisory, `docs/MANUAL-CHECKS.md` |
| Unfinished work left behind | builder | the scope guard refuses `TODO`, `FIXME`, `placeholder`, "for now" under `src/` and `tests/` | `would contain "TODO", which AGENTS.md rule 6 forbids` |
| The reviewer believes the author | finders, verifier | reading order (commit messages last); a finding needs evidence; the verifier never saw the finders' or the author's conversation | the `Checklist:` line; `proven: true` only with the path through the code |
| The verifier shares the author's blind spots | verifier | the verifier never runs on the author's model (`Model:` line, printed as reported); fresh context per agent | `Verifier: opus (reported)   Author: sonnet` in the header |
| Code changed after the review | anyone | the gate's `review` line: `Reviewed: <sha>` against `HEAD`, code commits after it make it stale | `review 3f9c2d1 is 2 commits old (...): re-review needed` |
| A finding dropped on the way | verifier | `review.mjs` places every id exactly once; a forgotten id goes to the watch list, a repeated one is renumbered | `COR-3 was not placed by the verifier; put on the watch list` |
| A finding the human rejected comes back | verifier | `decisions.json`: rejected findings are not carried and are listed under "Rejected by the human" | `F-07 rejected by the human in cycle 1; not counted` |
| A finder that edits code | finders, verifier | `x-writes: []` in their agent files; the scope guard refuses Edit and Write, the commit guard refuses `git add`, `rm`, `>` and the other write commands | `verifier writes nothing; it reports, the human and the builder change files.` or `verifier may not change files or git state; it reads and runs tests (refused: git add).` |
