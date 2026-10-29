---
name: discipline-code-review
user-invocable: false
description: Code review rules: the reading order, comments that cite a rule, blocking versus advisory by the user's loss, evidence and reproduction, small diffs, no self-approval, no approval without running the tests, a verdict computed from findings, the reviewer reports and does not fix, nitpicks, disagreement escalated with both readings. Rules CR-01 to CR-12. Read by the critic, finder-correctness, finder-security, finder-contract, verifier and tester.
x-tags: []
x-roles: [critic, finder-correctness, finder-security, finder-contract, verifier, tester]
---

# Discipline: code review

## What this covers
A review is the point where a change is compared against what was asked, not against what the author says was done. These rules fix what the reviewer reads and in which order, what a comment must contain to count, how a verdict is reached, and what the reviewer may not do. They protect against the two usual failures: approval on impression, and findings nobody can act on. It is a file and not a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id.

## Rules
Rule ids are `CR-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### CR-01 The reviewer reads the requirement first, then the diff, then the tests, and the author's message last
Why: a reviewer who starts from the author's description inherits the author's framing and checks that the code matches the story, not the requirement. Reading the requirement first produces an independent expectation; the message is read last, to see what the author believes, and compared with what the reviewer found.
Source: Google Engineering Practices, "Navigating a CL in review", https://google.github.io/eng-practices/review/reviewer/navigate.html; "What to look for in a code review", https://google.github.io/eng-practices/review/reviewer/looking-for.html
Applies to: process

### CR-02 Every review comment names the rule it rests on: a discipline rule id, a requirement id, or an ADR
Why: a comment with no rule behind it is a preference, and preferences are argued about instead of fixed. Naming the rule makes the comment checkable by the author and by the human, and keeps the reviewer from inventing standards on the spot; a comment that can cite nothing is advisory at most (CR-11).
Source: Google Engineering Practices, "The Standard of Code Review", principles ("Technical facts and data overrule opinions and personal preferences"), https://google.github.io/eng-practices/review/reviewer/standard.html; "How to write code review comments", https://google.github.io/eng-practices/review/reviewer/comments.html
Applies to: process

### CR-03 A finding is blocking or advisory according to the user's loss, and says which
Why: when every comment looks the same, the author fixes the easy ones and the dangerous one is lost in the list. Blocking means a user can lose data, money, access, privacy or the correctness of a result; advisory means the code works and could be better. The label is written on the comment, not implied.
Source: Google Engineering Practices, "How to write code review comments", "Label comment severity", https://google.github.io/eng-practices/review/reviewer/comments.html
Applies to: process

### CR-04 A finding carries evidence: the path through the code and the input that reaches it
Why: "this might be null" is a feeling; "`order.Customer` is null when `POST /orders` arrives without `customerId`, and line 42 dereferences it" is a defect. Evidence lets the author confirm in one minute and lets the human weigh it without re-reading the diff.
Source: Google Engineering Practices, "The Standard of Code Review", principles, https://google.github.io/eng-practices/review/reviewer/standard.html; "What to look for in a code review", "Functionality", https://google.github.io/eng-practices/review/reviewer/looking-for.html
Applies to: process

### CR-05 A diff is one slice and one concern: one requirement or one refactoring, not both, small enough to read in one sitting
Why: review quality falls with size; defects found per line drop sharply past a few hundred changed lines. A diff that mixes a rename with a behaviour change hides the behaviour change inside the noise. The reviewer may return an oversized or mixed diff unread, with that as the single finding.
Source: Google Engineering Practices, "Small CLs", https://google.github.io/eng-practices/review/developer/small-cls.html; Cohen, Best Kept Secrets of Peer Code Review (SmartBear, 2006), the Cisco study on defect density against review size
Applies to: both

### CR-06 The author never approves their own change
Why: the author already believes the change is right; that belief is what the review exists to test. In an agent pipeline this means the builder that produced the diff is not among the roles whose verdict counts, even when it runs under a different name.
Source: SLSA v0.1, Source requirements, "Two-person reviewed", https://slsa.dev/spec/v0.1/requirements; GitHub Docs, About protected branches, "Require pull request reviews before merging", https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
Applies to: process

### CR-07 No approval without running the tests, and without seeing that the new tests fail when the change is reverted
Why: a green badge from CI proves the suite passed somewhere; it does not prove the new tests test the new code. The reviewer runs the suite on the change, then checks that the tests added for the requirement go red against the parent commit or a stubbed implementation (TS-01, TS-05).
Source: Google Engineering Practices, "What to look for in a code review", "Tests", https://google.github.io/eng-practices/review/reviewer/looking-for.html; Fowler, "Continuous Integration", the self-testing build, https://martinfowler.com/articles/continuousIntegration.html
Applies to: process

### CR-08 The verdict is computed from the findings, not from an impression: any open blocking finding means changes requested; none means approve
Why: "looks good overall" next to a blocking finding is a contradiction that the author resolves in their own favour. The verdict follows mechanically from the list: the review scripts derive it, and a reviewer may not approve with an open blocking finding or block without one.
Source: Google Engineering Practices, "The Standard of Code Review", https://google.github.io/eng-practices/review/reviewer/standard.html
Applies to: process

### CR-09 The reviewer reports; the reviewer does not fix
Why: a reviewer who rewrites the code becomes its author, and the change loses its independent reader (CR-06). The reviewer may show a sketch inside the comment; the edit is the author's, and the fixed diff is reviewed again.
Source: Google Engineering Practices, "How to write code review comments", "Pointing out problems versus giving direct guidance" ("it is the developer's responsibility to fix a CL, not the reviewer's"), https://google.github.io/eng-practices/review/reviewer/comments.html; SLSA v0.1, "Two-person reviewed", https://slsa.dev/spec/v0.1/requirements
Applies to: process

### CR-10 A blocking finding carries a reproduction: a failing test, a command with its output, or an exact request and response
Why: a finding the author cannot reproduce is disputed instead of fixed, and a finding the human cannot reproduce cannot be weighed. The reproduction becomes the regression test once the fix lands (TS-11).
Source: ISO/IEC/IEEE 29119-3:2021, Software testing, Part 3: Test documentation, incident report; Google Engineering Practices, "The Standard of Code Review", principles, https://google.github.io/eng-practices/review/reviewer/standard.html
Applies to: process

### CR-11 A nitpick is marked advisory or is not written
Why: naming, spacing and phrasing comments cost the author time and never change what the user gets. If a formatter or a linter can enforce it, the finding is against the missing tool configuration, not against the line. Unmarked nitpicks are removed by the review script before the verdict is computed.
Source: Google Engineering Practices, "How to write code review comments", the "Nit:" label, https://google.github.io/eng-practices/review/reviewer/comments.html; "The Standard of Code Review", https://google.github.io/eng-practices/review/reviewer/standard.html
Applies to: process

### CR-12 When the author and the reviewer disagree, both readings go to the human, side by side, with the rule each one rests on
Why: a disagreement settled by whoever insists longer is settled by stamina, not by the requirement. The reviewer writes the two readings, the rule or requirement each cites, and what the user loses under each; the human decides and the decision is recorded, as an ADR if it changes a rule.
Source: Google Engineering Practices, "Handling pushback in code reviews", https://google.github.io/eng-practices/review/reviewer/pushback.html; "The Standard of Code Review", "Resolving conflicts", https://google.github.io/eng-practices/review/reviewer/standard.html
Applies to: process

## How these rules connect to the other discipline skills
A review comment cites the rule the defect breaks, not a review rule. The review rules say how the comment is written and how the verdict is reached. In practice:
- A missing or tautological test is cited as TS-01 or TS-05 from `discipline-testing`; CR-07 is cited only when the reviewer approved without running them.
- A swallowed exception or a missing timeout is cited as EO-04 or EO-10 from `discipline-errors-observability`; CR-04 governs the evidence the comment must carry.
- A domain rule placed in a controller is cited from `discipline-layering`; a leaked secret from `discipline-security`; a breaking endpoint change from `discipline-api-design`.
- A requirement not met is cited by its requirement id; a design decision contradicted is cited by its ADR number.
- CR-02 to CR-12 are cited against the review itself: a comment with no rule, a verdict that does not match the findings, an approval by the author.
- A finding on a `.spec` file edited by the builder is cited as TS-14; the review returns the diff and the tester decides whether the spec changes.

## Terms
- Finding: one defect or deviation, with its rule, its severity, its evidence and, when blocking, its reproduction. A review is a list of findings and a verdict.
- Blocking: the user can lose data, money, access, privacy or the correctness of a result if the change ships as is. Advisory: the code works; the comment describes a better version.
- Nitpick: a comment about naming, layout or phrasing that a formatter or linter could enforce and that changes nothing the user gets.
- Reproduction: a failing test, a command with its output, or an exact request and response that shows the defect on the reviewed commit.
- Reading: one of two defensible interpretations of a requirement or a rule, written so the human can choose between them.

## What a finding looks like
```
Finding 2 of 3            Rule: EO-04 (discipline-errors-observability)      Severity: blocking
Where:   src/Orders/OrderRepository.cs:88, catch (NpgsqlException) { return new List<Order>(); }
Path:    GET /customers/{id}/orders -> OrdersController.List -> OrderRepository.ListByCustomer
Input:   any request while the database refuses connections
User's loss:   the customer sees "no orders" and the nightly billing job bills nothing for them
Reproduction:  stop the postgres container, curl -s localhost:5000/customers/c-17/orders -> 200 []
Expected:      503 with code ORD-050 (REQ-031, AC 4); the billing job skips the customer and reports it
```
The author fixes; the reviewer reads the fixed diff again from the requirement (CR-01).

## What a reviewer checks
- Open the requirement and write down the expected behaviour before opening the diff; read the author's message only after the findings are drafted (CR-01).
- Attach a rule id, requirement id or ADR to every comment; delete any comment that has none or mark it advisory (CR-02, CR-11).
- Label each finding blocking or advisory by what the user loses, and give the code path and the triggering input (CR-03, CR-04).
- Measure the diff: one concern, readable in one sitting; otherwise return it with CR-05 as the single finding.
- Confirm the approver is not the builder of the diff (CR-06).
- Run the suite, then revert or stub the change and confirm the new tests go red (CR-07).
- Derive the verdict from the finding list and check that it matches what is written (CR-08).
- Attach a reproduction to every blocking finding, write no code into the author's branch, and where the author rejects a finding write both readings for the human (CR-09, CR-10, CR-12).

## Scenarios the tester writes
- Given a review with one open blocking finding, when the verdict is computed, then it is "changes requested", whatever the summary paragraph says (CR-08).
- Given a review comment without a rule id, requirement id or ADR, when the review script runs, then the comment is dropped or downgraded to advisory and the verdict is recomputed (CR-02, CR-11).
- Given a diff authored by the builder role, when the same role submits an approval, then the approval is refused (CR-06).
- Given a change with new tests, when the reviewer reverts the implementation and runs the suite, then at least one new test fails; if none does, the review records a CR-07 finding.
- Given a diff that renames a module and also changes a validation rule, when it reaches review, then it is returned with a single CR-05 finding and no line comments.
