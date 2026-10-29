---
name: discipline-testing
user-invocable: false
description: Testing rules for domain, application and acceptance code: test-first, one behaviour per test, behaviour over implementation, the pyramid, real adapters in integration tests, determinism, builders, mutation testing, given/when/then traced to requirements, who owns the specs, how QA returns a ticket. Rules TS-01 to TS-15. Read by the architect, planner, builder, tester, critic, finder-contract, finder-correctness and verifier.
x-tags: []
x-roles: [architect, planner, builder, tester, critic, finder-contract, finder-correctness, verifier]
---

# Discipline: testing

## What this covers
A test is the only proof the kit accepts that a requirement is met. These rules say when a test is written, what one test may claim, what it may touch, what makes it trustworthy, and how a defect travels back from the tester to the builder. They protect against the two usual failures: a suite that passes while the product is wrong, and a suite that fails for reasons unrelated to the product. It is a file and not a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id.

## Rules
Rule ids are `TS-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### TS-01 For domain and application code, the failing test exists before the code, and it fails for the right reason
Why: a test written after the code passes by construction and proves only that the code does what it does. The red step shows that the test can detect the absence of the behaviour; a test that fails with a compile error or a null reference instead of the expected assertion has not shown that.
Source: Beck, Test-Driven Development: By Example (Addison-Wesley, 2002), part I, the red/green/refactor cycle; Fowler, https://martinfowler.com/bliki/TestDrivenDevelopment.html
Applies to: process

### TS-02 One test checks one behaviour and is named after the requirement id and that behaviour
Why: a test that checks three things reports one failure and hides two. The name `REQ_014_rejects_expired_card` tells the reader which requirement broke without opening the file; `Test1` or `CardTests` tells nothing.
Source: Microsoft Learn, Unit testing best practices, "Naming your tests" and "Avoid multiple acts", https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
Applies to: tests

### TS-03 A test body is arrange, act, assert, in that order, visibly separated
Why: when setup, the call under test and the checks are interleaved, a reader cannot tell what is being tested from what is scaffolding, and a wrong assertion hides among setup lines.
Source: Microsoft Learn, Unit testing best practices, "Arranging your tests", https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
Applies to: tests

### TS-04 A test asserts on observable behaviour, never on implementation details
Why: a test that checks which private method was called, in which order, with which internal state, breaks on every refactoring and passes on every bug that keeps the same call sequence. Behaviour is the return value, the state visible through the public interface, or the message sent across a boundary.
Source: Google Testing Blog, "Test Behavior, Not Implementation", https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html; Software Engineering at Google, chapter 12, https://abseil.io/resources/swe-book/html/ch12.html
Applies to: tests

### TS-05 No test that cannot fail: no `assert true`, no asserting a value the test itself set, no assertion-free test
Why: a test that cannot go red is a line of coverage with no information in it. The usual forms are a tautology, an assertion on the input, a mocked return value asserted back, and a test whose assertions sit inside a branch that never runs.
Source: Beck, Test-Driven Development: By Example, the red step; Fowler, https://martinfowler.com/bliki/SelfTestingCode.html
Applies to: tests

### TS-06 The suite is a pyramid: many unit tests, fewer integration tests, few end-to-end tests
Why: unit tests run in milliseconds and point at a line; end-to-end tests run in minutes, fail for environmental reasons, and point at the whole system. A suite shaped the other way is slow, flaky and uninformative, so people stop running it.
Source: Fowler, https://martinfowler.com/bliki/TestPyramid.html; Vocke, "The Practical Test Pyramid", https://martinfowler.com/articles/practical-test-pyramid.html
Applies to: both

### TS-07 An integration test runs against the real adapter: a real database in a container, a real file, a real queue; never a mock of the adapter
Why: the point of the test is the adapter's contract: SQL that parses, a migration that applies, a file format that round-trips. A mock of the repository tests the mock. In-memory substitutes for a database (an in-memory provider, SQLite in place of PostgreSQL) count as mocks here unless production uses them too.
Source: Fowler, https://martinfowler.com/bliki/IntegrationTest.html; Vocke, "The Practical Test Pyramid", section "Integration Tests", https://martinfowler.com/articles/practical-test-pyramid.html; Testcontainers, https://testcontainers.com/
Applies to: tests

### TS-08 Test doubles replace only process boundaries the project does not own: a third-party HTTP API, a payment provider, the clock, the mail server
Why: mocking a type you own couples the test to today's internals and lets a change in that type pass unseen. The boundary you do not own is slow, costly or non-deterministic, and its contract is fixed by someone else, so a double there is the only option. Record the boundary's real responses once and replay them.
Source: Freeman and Pryce, Growing Object-Oriented Software, Guided by Tests (Addison-Wesley, 2009), chapter 8, "Only Mock Types That You Own"; Fowler, https://martinfowler.com/articles/mocksArentStubs.html
Applies to: tests

### TS-09 A test is deterministic: no wall clock, no unseeded random, no network, no dependence on test order or on leftovers from another test
Why: a test that passes on Tuesday and fails on Friday teaches people to re-run instead of read, and after a few weeks a real failure is re-run too. Time and randomness are injected; the network is behind a double (TS-08) or a container the test starts (TS-07); each test builds and cleans its own state.
Source: Fowler, "Eradicating Non-Determinism in Tests", https://martinfowler.com/articles/nonDeterminism.html; Software Engineering at Google, chapter 11, flaky tests, https://abseil.io/resources/swe-book/html/ch11.html
Applies to: tests

### TS-10 Test data comes from builders with valid defaults, not from shared fixtures
Why: a shared fixture file is edited for one test and breaks twenty, and a reader of any test cannot see which field matters. A builder (`anOrder().withTotal(0)`) shows exactly the one value the test depends on and leaves the rest valid by default.
Source: Pryce, "Test Data Builders: an alternative to the Object Mother pattern", http://www.natpryce.com/articles/000714.html; Freeman and Pryce, Growing Object-Oriented Software, Guided by Tests, chapter 22; Fowler, https://martinfowler.com/bliki/ObjectMother.html
Applies to: tests

### TS-11 A bug fix starts with the test that reproduces the bug, red, in the same change as the fix
Why: without the reproducing test the fix is a guess, and the bug returns with the next refactoring. The test is also the proof in the ticket: red on the parent commit, green on the fix.
Source: Fowler, https://martinfowler.com/bliki/SelfTestingCode.html; Beck, Test-Driven Development: By Example, part I
Applies to: process

### TS-12 The measure of a suite is mutation score, not line coverage: a planted defect in domain or application code must turn at least one test red
Why: line coverage says a line ran, not that anything checked its result; a suite with 95 percent coverage and no assertions scores 95 percent. A mutant that survives (a flipped condition, a dropped call, a changed constant) names the exact behaviour nobody tests. The project sets a threshold in its ADR; a surviving mutant on a changed line is a finding.
Source: DeMillo, Lipton and Sayward, "Hints on Test Data Selection: Help for the Practicing Programmer", IEEE Computer 11(4), 1978; PIT, https://pitest.org/; Stryker, https://stryker-mutator.io/
Applies to: both

### TS-13 An acceptance scenario is written as given/when/then and carries the requirement id it proves
Why: a scenario without a requirement id proves nothing anyone asked for, and a requirement without a scenario is untested by definition. Given is the state, when is the one action, then is the observable outcome; one scenario, one outcome.
Source: Fowler, https://martinfowler.com/bliki/GivenWhenThen.html; Gherkin reference, https://cucumber.io/docs/gherkin/reference/; Adzic, Specification by Example (Manning, 2011)
Applies to: both

### TS-14 The tester owns the acceptance specs (the `.spec` files); the builder may not change them
Why: if the builder can edit the spec, a failing scenario becomes a spec change instead of a fix, and the spec stops being an independent check. The builder proposes a change in the review; the tester decides and edits; a diff from the builder that touches a `.spec` file is rejected by the review script.
Source: Adzic, Specification by Example (Manning, 2011), executable specifications as the shared source of truth; ISO/IEC/IEEE 29119-2, Software testing, Part 2: Test processes, independence of test design from implementation; the kit's role model
Applies to: process

### TS-15 A ticket QA sends back carries: the exact input, the expected result with the requirement id, the observed result, the environment, the smallest reproduction, a severity by the user's loss, and one defect only
Why: a ticket that says "login is broken" costs a round trip before anyone can start; a ticket with two defects gets half fixed and closed. Severity is what the user loses (data, money, access, time), not how ugly the code is. The smallest reproduction is, where possible, a failing test (TS-11).
Source: ISO/IEC/IEEE 29119-3:2021, Software and systems engineering, Software testing, Part 3: Test documentation, incident report; Mozilla, Bug Writing Guidelines, https://bugzilla.mozilla.org/page.cgi?id=bug-writing.html
Applies to: process

## Terms
- Behaviour: what a caller can observe through the public interface: a return value, a state change readable through that interface, or a message sent across a boundary. Not a private call, not an internal field.
- Adapter: the code that talks to a database, a file system, a queue or an external API on behalf of the domain. The real adapter is the production implementation against the real technology.
- Boundary you do not own: a process or service whose contract someone else controls: a third-party API, a payment provider, the operating system clock, a mail server.
- Fixture: a pre-built data set shared by many tests. Builder: a function that constructs one valid object and lets a test override the fields it cares about.
- Mutant: a copy of the code with one deliberate defect. Killed mutant: at least one test fails on it. Surviving mutant: the suite stays green.
- Acceptance spec: a `.spec` file of given/when/then scenarios, each tagged with the requirement id it proves, owned by the tester.

## What a returned ticket looks like
```
Ticket: QA-0042        Requirement: REQ-014        Severity: user loses money
Input:        POST /orders {"customerId":"c-17","card":{"expiry":"2024-01"},"total":120.00}
Expected:     402 with code ORD-017 (expired card), no order created (REQ-014, AC 2)
Observed:     201, order o-9031 created and marked paid
Environment:  staging, build 2026.10.29.3, PostgreSQL 16 container
Reproduction: tests/orders/REQ_014_rejects_expired_card.spec, scenario 2 (red on build 2026.10.29.3)
```
One defect per ticket. A second defect found on the way gets its own ticket with its own reproduction.

## What a reviewer checks
- Find the test for each changed domain or application behaviour; confirm from the commit history or the review notes that it was red before the code made it green (TS-01, TS-11).
- Read each test name: does it carry a requirement id and a behaviour, and does the body check only that behaviour in arrange, act, assert order (TS-02, TS-03, TS-13)?
- Look for assertions on private calls, call order, or mock interactions with owned types; flag each as implementation coupling (TS-04, TS-08).
- Look for `assert true`, assertions on the test's own input, and tests with no assertion (TS-05).
- Check every integration test's dependencies: a real adapter in a container or a file, not an in-memory stand-in or a mocked repository (TS-07).
- Grep the tests for `DateTime.Now`, `Date.now()`, `Random` without a seed, live URLs and shared static state (TS-09, TS-10).
- Run the mutation tool on the changed files; a surviving mutant on a changed line is a finding (TS-06, TS-12).
- Reject a builder diff that touches a `.spec` file, and reject a QA ticket missing any of the seven fields or carrying two defects (TS-14, TS-15).

## Scenarios the tester writes
- Given a changed domain method and its test, when the method body is replaced with a stub that returns the default value, then at least one test in the change goes red (TS-01, TS-05, TS-12).
- Given the suite, when it is run twice in reverse order with the clock frozen at two different dates, then both runs produce the same results (TS-09).
- Given an integration test for the order repository, when the database container is stopped, then the test fails rather than passing against an in-memory substitute (TS-07).
- Given a requirement REQ-021 in the brief, when the tester lists the `.spec` files, then at least one scenario is tagged REQ-021 and reads given/when/then with one outcome (TS-13).
- Given a defect found in acceptance, when the ticket is opened, then it names the input, the expected result with its requirement id, the observed result, the environment, the smallest reproduction and a severity stated as the user's loss (TS-15).
