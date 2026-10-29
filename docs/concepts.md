# Concepts: why the kit is built this way

This page is the long form of the "Why" in the README. It states each idea, the alternatives I considered, why they lost, what the kit does not try to do, and what a run costs. Everything named here exists in the repository; the file paths are the proof.

## The problem in five parts

1. **Generated code nobody owns.** The developer prompted, skimmed, accepted. Nobody can say later which requirement a function serves.
2. **The chat ends and the decisions vanish.** The stack, the storage choice, the reason a rule was bent: all of it lived in a context window that is gone.
3. **Reviews that trust the author.** The same model that wrote the code reviews it, reads the author's commit messages first, and agrees.
4. **Rules that are only prompts.** "Never use innerHTML" holds while the context is short and the model is attentive. It is not a rule; it is a wish.
5. **A business, a domain and a law nobody wrote down.** The model fills the gap with what sounds right: a rounding, a numbering, a flow with a step missing, a "GDPR compliant" that cites no article. Nobody can review an assumption that was never a sentence.

## Idea 1: requirements with IDs that follow the work

`docs/REQUIREMENTS.md` holds headings `### R-01 [MUST] Title` with acceptance criteria. The ID is used in four places the tools read:

- test titles: `test('R-07 order total sums its lines', ...)`; `tools/trace.mjs` reads only titles, not comments or helper strings;
- commit messages: `S3: lines and totals (R-11..R-13)`; `gate.mjs` checks that every ID exists and that the slice number matches the active slice;
- manual checks: `- [ ] R-20: ...` in `docs/MANUAL-CHECKS.md` for what a unit test cannot cover;
- review findings: every finding has a `requirement` field, `R-nn` or `none`.

`trace.mjs` joins them and the gate's `trace` line fails when a MUST has neither a test nor a manual check. `trace.mjs --markdown` writes the matrix the pull request carries.

**Alternative considered: a story in a ticket system.** A ticket is outside the repository, so a script in a git hook cannot read it without a token and a network. The ID in a Markdown file is readable by `grep`, by a hook and by a human with no account.

**Alternative considered: let the AI keep requirements in its head.** It does, for one session. The kit is built for the second session, and for the colleague.

## Idea 2: a plan cut into slices, each with the files it may touch

`docs/PLAN.md` has one section per slice: `## S3 <title>`, `**Covers:**`, `**Files:**` (at most six paths), tests first, steps, verify, risks. `tools/scope.mjs` parses it. While `.sdlc/slice` says `S3`, the scope guard allows writes only to those files plus `docs/MANUAL-CHECKS.md`; the commit guard applies the same list to shell writes and to the staged set; the gate's `scope` line fails on anything else.

Why files and not instructions: an instruction ("stay in the domain layer") needs interpretation; a file list needs a string comparison. The human reads the `**Files:**` line before the first edit and knows the worst case of the session.

Why slices and not one big task: a slice ends in something testable, so the gate has something to measure after every step, and the builder can be a cheaper model because its mistakes are caught close to where they are made. The builder stops after two attempts on one red gate and leaves the marker in place; a human sees exactly where it stopped.

Why the plan is approved before the first slice: the plan is the contract three tools parse, so a plan still moving under a builder makes every scope check meaningless. The planner writes `Status: draft`; the human answers the decision package and types `Status: approved`; the agent guard refuses to spawn a builder, and the commit guard refuses the slice marker, until that line exists. The approval itself is a git fact (`tools/contract.mjs` finds the commit that set the line and compares the text), so there is no state file, and CI reaches the same answer as the terminal. No agent may type the approving line, a ticked manual check or a decision on a finding: those three are the human's signatures, and the hooks judge the file as it would read after the edit, not the fragment.

**Alternative considered: let the AI decide the stack and the structure.** It will choose something reasonable and nobody will remember why. The kit puts the stack in `docs/decisions/ADR-001-stack.md`, written by the human, and marks every architectural choice the plan meets as `NEEDS HUMAN`. The guard refuses `npm install` and `npx` for every role with a sentence that names the ADR.

**Alternative considered: a free-form plan.** It cannot be parsed, so it cannot be enforced. The plan format is a contract because three tools read it.

## Idea 3: review by independent agents, with evidence, on another model

Four finders (`agents/finder-correctness.md`, `agents/finder-security.md`, `agents/finder-contract.md`, `agents/finder-legal.md`; a fifth, `agents/finder-domain.md`, with a domain skill) each look for one class of defect. They read in a fixed order: requirements, plan, `AGENTS.md` and decisions, then the diff, then the tests, and the author's commit messages last, so the author's story does not steer them. They return a JSON array of typed findings and one `Checklist:` line that says which items ran. A finding is `proven: true` only with the path through the code and the input that triggers it; otherwise it is `proven: false` with what would settle it.

The verifier (`agents/verifier.md`) runs on a model other than the author's. If its model equals the author's, it must return `pass: false` and `Blocked: verifier on the author's model`. It runs the gate, plants defects with `tools/mutate.mjs` (every site, one operator at a time, in a copy of the project, tests must go red each time), re-checks every finding, merges duplicates, and places every id exactly once: `confirmed` with the broken level (`code`, `plan`, `requirement`), `watchList` with how to settle it, or `refuted` with the evidence. A surviving planted defect is the verifier's own finding, `VER-n`, unless it judges the mutant equivalent and says why.

The verdict is written by `tools/review.mjs`, not by any model. `MERGE` needs no confirmed blocking finding, no open trade-off and no surviving non-equivalent planted defect as measured by the script in that run. The header's `Gate:` and `Mutations:` lines are measured by the script; the model names are what the agent files declare and what the verifier reported.

**Alternative considered: one big review agent.** One agent with one checklist of twenty-five items skips the items that do not fit its first impression, and its prose answer cannot be merged or counted. Three agents with eight or nine items each and a JSON shape give the script something to validate; a missing field is re-asked once with the problem named.

**Alternative considered: the author's model as verifier.** It shares the author's blind spots: the same rounding habit, the same assumption about empty input. Nothing in the kit measures that directly, so the kit makes it structural: the verifier's model is declared in its agent file, reported in its answer, and printed in the header next to the author's.

**Alternative considered: trust the tests.** A test that cannot fail is green forever. The planted defects are the only check in the kit that proves a test can go red. Test-first is the one rule the builder is told rather than measured; the `Mutations:` line shows afterwards whether it was followed.

**Alternative considered: let the verifier pass the review.** It can fail it; it cannot pass it alone. The script decides from numbers, and prints a clerk note when the verifier said `pass: true` and the script disagrees.

## Idea 4: one gate script, enforced three times

`tools/gate.mjs` prints one line per check and `GATE PASS` or `GATE FAIL`, exit 0 or 1. Three callers run it:

- the Claude Code hooks in `hooks/hooks.json`: the commit guard runs `gate.mjs --staged` with the message and the files named by `git add ... &&` before any `git commit`;
- `.githooks/pre-commit` and `.githooks/commit-msg`, installed by `init.mjs`, for any tool or human on the machine;
- `.github/workflows/gate.yml` with `--strict`, where manual checks must be ticked, the review must be bound to `HEAD` with verdict `MERGE`, and every planted defect must be caught.

**Alternative considered: prompts.** A prompt is read once and weighed against everything else in the context. A hook runs before the tool call, returns exit 2, and the tool does not run. The difference shows on the long day: the model may forget, the script does not. The kit's `AGENTS.md` template says which rules are enforced and which one (test-first) is only told.

**Alternative considered: enforce once, in CI.** By then the slice is committed, the context is gone and the fix is a new session. The hook catches the mistake at the write; the git hook catches it at the commit for tools without hooks; CI catches what a human did on purpose. Three places, one script, so they cannot disagree.

## Idea 5: the business, the domain and the law are files, not assumptions

Building software is not only implementation. A team has someone who understands the business flow (a product owner), someone who knows the domain (for an invoice app: how invoicing and accounting work), and someone who knows which law the app must not break. The AI has none of them; what it has is a confident guess. The kit gives each a role and a file:

- `agents/product-owner.md` reads the brief, the decisions and the requirements, in that order, and checks the flow: who uses the app and for what; the main flows end to end (no dead end from the first screen to the outcome); priorities (a MUST not needed for the first use, a LATER that blocks it); acceptance criteria a user can observe; the business's empty, error and edge states; what the brief implies and the requirements dropped. It returns typed items (`PO-n`, a kind, a severity, the requirement, the text to add or change in the file's own format).
- `agents/domain-expert.md` checks each requirement and the data model against the domain rules, and only against rules that exist: `.claude/skills/domain-<area>/SKILL.md`, a project skill with `### D-nn <rule>` headings, each with `Why:` and `Source:` (shape in `templates/domain-skill.md`). Without that file it returns `Blocked: no domain skill under .claude/skills/domain-*/`. Its items (`DOM-n`) name the rule, and `tools/reqreview.mjs` refuses a rule id the skill does not define.
- `agents/finder-domain.md` applies the same rules to the code and the tests in the review, as a finder `tools/review.mjs` runs only when the skill exists; its findings carry `rule: D-nn`.
- `agents/legal.md` checks each requirement and the data model against legal rules, and `agents/finder-legal.md` checks the code and the tests against the same rules, as a finder that always runs. The rules are not in the agents: they are three skills the kit ships, because they apply to most software and not to one project. `skills/legal-data-protection/SKILL.md` (`LD-nn`) turns the GDPR articles that touch an app's design into rules: what personal data is (Article 4(1)), purpose and minimisation (5(1)), the rights the app must make possible (15, 16, 17 with its exceptions, 20), security (32), by design and by default (25). `skills/legal-licenses/SKILL.md` (`LL-nn`) says what each licence asks for when you ship or depend on it, from the SPDX list and the licence texts: notice and text for MIT and BSD, NOTICE and the patent clause for Apache-2.0, file-level copyleft for MPL-2.0, relinking for LGPL, the whole work for GPL, the network for AGPL, fonts under OFL, adapted content keeping its notice, no licence meaning all rights reserved. `skills/legal-e-invoicing/SKILL.md` (`LE-nn`) is the legal frame of an invoice from Directive 2006/112/EC: the details of Article 226, a sequential unique number, integrity after issue (233), storage (244 to 248), and EN 16931 for public buyers (Directive 2014/55/EU). Every rule has `Why:`, `Source:` with the link and `Applies to:`. A project adds what the kit does not cover in `.claude/skills/legal-<area>/SKILL.md` (`templates/legal-skill.md`), human-only once it exists. Items are `LEG-n` with a `rule`; the scripts refuse an id no legal skill defines. None of it is legal advice: the role names the rule and its source, the human decides.

The human writes or validates the domain skill and any project legal skill (the AI may draft them, the human signs them), and once they exist the guards refuse them to every agent, like an ADR. The kit's legal skills are kit files, read-only from a project like the rest of the kit. The review of the requirements is `/sdlc-kit:review-requirements`: the clerk runs `reqreview.mjs`, launches the roles, saves the JSON, and the script writes `docs/REQUIREMENTS-REVIEW.md` as checkboxes. The human ticks what to fold in; an untouched item is rejected; the ids continue across runs so an id names one item forever.

**Alternative considered: ask the model to "think like an accountant".** It will, confidently and wrong, and nobody can check what it assumed, because the assumption lived in the answer. A rule in a file can be read, disputed and corrected by the person who knows the domain, and the same rule then binds the requirements, the builder and the review.

**Alternative considered: ask the model "is this GDPR compliant?".** The same failure with a higher price. The model answers yes or no with no article in front of it, from a memory of the law that may be stale or wrong, and the answer cannot be checked because it cites nothing. The kit refuses that question: the legal role may only cite a rule that exists in a file, with its article and its link, and the script refuses an item whose rule is not there. A reviewer who disagrees reads the article, not the model's opinion. The human still decides, and still asks a lawyer when the stake is real; what the kit adds is that the question reaches the lawyer with the article and the requirement side by side.

**Alternative considered: put the rules in the prompts of the agents.** Then the domain and the law are invisible and unreviewable: they live in `agents/*.md`, in the kit, the same for every project, and a change to them is a change to the kit. A project skill under `.claude/skills/domain-*/` or `.claude/skills/legal-*/` belongs to the project, is versioned with it, and is read by three roles without any of them owning it. The kit's own legal skills are the exception by design: they are generic, they are separate files a reader can open without the agents, and they carry their sources so a reader can check them against EUR-Lex or the licence text.

**Alternative considered: a design discipline the kit invents.** For the UI the kit takes its rules from an open-source skill instead, UI UX Pro Max by nextlevelbuilder (MIT), reduced to what a small plain-JavaScript app needs in `skills/ui-ux/SKILL.md`, and says so. The builder reads it before a UI slice; the six `- [ ] UX: ...` manual checks it prescribes go to `docs/MANUAL-CHECKS.md`; a style or palette choice is an ADR, not the builder's call.

## Idea 6: the way of working is a library of rules the decisions switch on

SOLID, the dependency rule, DDD, test-first, how QA writes a ticket back, how data is stored, what an API owes its callers, OWASP ASVS, how errors and logs behave, how a release goes out, and how a stack (.NET first) is set up: each is a skill under `skills/discipline-*` or `skills/stack-*`, written as numbered rules with a `Why:` and a primary `Source:`, like the legal skills. Each declares the ADR tags that switch it on (`x-tags: [dotnet, ef-core]`; empty means always) and the roles that read it (`x-roles`). An ADR carries a `Tags:` line. `tools/profile.mjs` computes, per role, the exact files to read, the briefs list them, and a finding may cite a rule only from an active skill.

Why this and not a long prompt: the team forms top-down from the documents. The product owner's requirements bound the architect; the architect's decisions (the tags) choose which rules bind the builder, the tester and the reviewers; nobody carries a rule in their head, and a reviewer who disagrees reads the rule, its reason and its source, then argues with the file. Knowledge lives in the skill, judgment in the finder, mechanics in the hook.

**Alternative considered: one big "best practices" prompt per role.** It cannot be cited, cannot be switched per stack, and drifts with every edit. A rule with an id can be cited in a finding, counted, refused when it does not exist, and changed in one place.

## The thread: the human decides in files

Every decision the kit asks of the human has a file:

| Decision | File | Form |
|---|---|---|
| the stack, the AI's boundaries | `docs/decisions/ADR-001-stack.md`, `ADR-002-ai-boundaries.md` | ADR from `templates/ADR.md` |
| the requirements are final | `docs/REQUIREMENTS.md` | third line `Status: approved`; the file becomes read-only for agents |
| a requirements review item stands or not | `docs/REQUIREMENTS-REVIEW.md` | `- [x]` on the item to fold in; an untouched item is rejected |
| the domain rules | `.claude/skills/domain-<area>/SKILL.md` | `### D-nn <rule>` with `Why:` and `Source:`, from `templates/domain-skill.md`; human-only once it exists |
| the project's own legal rules | `.claude/skills/legal-<area>/SKILL.md` | `### L?-nn <rule>` with `Why:`, `Source:` and `Applies to:`, from `templates/legal-skill.md`; human-only once it exists; the kit's `LD`, `LL`, `LE` rules ship with the kit |
| the plan's open questions | an ADR, section `## Answered` | `Q: <question>  A (<date>, <name>): "<exact words>"` |
| a review finding stands or not | `docs/review/<cycle>/decisions.json` | written by `review.mjs decide` from the human's terminal; refused to every agent |
| a manual check passed | `docs/MANUAL-CHECKS.md` | `- [x] R-xx: ...`, ticked by the person who ran it |
| the change ships | the pull request | opened and approved by humans; the kit never pushes |

Nothing said in a chat counts, and the skills say so in their own text. The reason is plain: the chat ends and the file stays. The files are also what makes the guards possible, since a hook can read `Status: approved` and cannot read a conversation.

## What the kit does not try to do

- **It is not a sandbox.** The hooks stop an agent's everyday mistakes and the obvious shortcuts, and say why; the deny rules in the project's settings hold the costliest ones even when a hook is off. A person who wants around them gets around them: they can edit the hook scripts or unset `core.hooksPath` at the terminal, and a program run from a file has the developer's rights. The commit guard refuses the routes an agent would find (`--no-verify`, `GIT_DIR=`, `core.hooksPath`, `git config`, `git -C`, `cd` before a commit, `eval`, `/usr/bin/git`), CI with the pinned kit is the backstop, and [guards.md](guards.md) lists what stays open and why.
- **It does not test the UI.** Every review ends with `Not checked: UI in a real browser (manual checks in docs/MANUAL-CHECKS.md)`. A UI requirement gets a manual check the human ticks.
- **It does not choose the stack.** The kit assumes a plain JavaScript project with `node --test`, tests in `tests/`, code under `src/domain/`, `src/storage/` and `src/ui/`, no dependencies. The finder checklists talk about `localStorage` and the DOM because that is the shape the kit was built on. Another stack runs the flow but loses the parts that read those folders.
- **It does not run a third review cycle.** Two fix rounds, then `BUDGET: human decision`. An endless loop of fix and re-review is a cost without an owner; at `BUDGET` a human chooses to ship with a visible warning or to reopen the finding as a requirement.
- **It does not push, tag, branch or open pull requests.** Those are the human's, and the commit guard says so with the ADR number.

## The cost model

The rule: a strong model where a mistake is expensive to find later, a cheap model where the gate catches the mistake at once.

| Step | Model | Why |
|---|---|---|
| write-requirements | opus | a misread requirement is the costliest defect; everything downstream inherits it |
| review-requirements: product owner, domain expert, legal | opus | a flow with a dead end, a broken domain rule or personal data with no erasure path found here costs a line in a file; found in the review it costs a slice |
| plan-slices | opus | the plan is a contract three tools parse; a wrong `**Files:**` line blocks a whole slice |
| implement-slice, build-slices | sonnet | tests first, a file list, a gate after every edit and before every commit: the mistakes are cheap because they are caught at once |
| review-change: four finders, five with a domain skill | opus | each reads the whole change once; a missed defect here reaches the pull request |
| review-change: the verifier | opus, never the author's model | the only agent that can fail the review on evidence |
| init, review-requirements clerk, review-change clerk, ship | the session's model | they run scripts and copy files; no judgment |

One review cycle costs five strong-model agents (four finders in parallel, then the verifier; six with a domain skill) plus the script's own gate and mutation run, which take under a minute on a small app. A second cycle runs only the finder classes that fired in the first, plus a new verifier. `ship` ends with the reminder `run /cost now for the session total`, so the number is on screen before the pull request is opened.
