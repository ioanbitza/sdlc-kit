---
name: discipline-coding-principles
user-invocable: false
description: Coding principles as rules on code: SOLID, DRY with its limit, YAGNI, KISS, small functions, intent-revealing names, immutability, composition, visible effects, fail fast, pure logic apart from I/O. Rules CP-01 to CP-14. Read by the architect, the builder, the tester, finder-contract and the critic.
x-tags: []
x-roles: [architect, planner, builder, tester, critic, finder-contract, finder-correctness]
---

# Discipline: coding principles

## What this covers
The rules that keep a codebase changeable: each piece of code has one owner of change, each fact has one place, the design carries no more structure than the story needs, names say what they mean, values do not change under a caller's feet, and effects are visible in a signature. They apply to every language in the kit and to every diff, whatever the architecture tags say.
They live in a file and not in a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id instead of arguing taste.

## Rules
Rule ids are `CP-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### CP-01 A module has one reason to change: one actor whose requirements change it
Why: a class that serves two actors (the accountant's rounding rule and the operations team's report layout) gets edited for both, and a change for one breaks the other. The test: name the role who would ask for the next change to this module; if two different roles come to mind, split it.
Source: Robert C. Martin, Agile Software Development: Principles, Patterns, and Practices (2002), chapter 8; Clean Architecture (2017), chapter 7
Looks like: `InvoiceTotalCalculator` and `InvoiceReportFormatter` as two classes, each changed by one role.
Smells like: `InvoiceService` with `Calculate`, `Format`, `Email` and `Save`, touched every sprint for a different reason.
Applies to: both

### CP-02 A new variant of a thing that already varies is added by adding a type, not by editing every consumer
Why: when a second payment method or export format arrives as a new `case` in three switches, the fourth switch is forgotten and the feature ships half done. The axis of variation the design already has (a strategy, a handler, a policy) is extended with a new implementation, and the consumers do not change.
Source: Bertrand Meyer, Object-Oriented Software Construction (1988), section 2.3, the Open-Closed Principle; Robert C. Martin, Agile Software Development (2002), chapter 9
Looks like: a new `IExportFormat` implementation registered in the composition root; no other file changes.
Smells like: a `switch (format)` edited in three places to add CSV.
Applies to: both

### CP-03 A subtype replaces its base type in every caller without the caller checking the concrete type
Why: a subtype that throws `NotSupportedException` from an inherited method, tightens a precondition or weakens a postcondition forces every caller into `if (x is Square)`. The contract of the base type holds for every subtype: same accepted inputs, same promised outputs, same invariants.
Source: Barbara Liskov and Jeannette Wing, A Behavioral Notion of Subtyping, ACM TOPLAS 16(6), 1994, https://doi.org/10.1145/197320.197383
Looks like: a contract test suite that every `IRepository` implementation passes.
Smells like: `ReadOnlyRepository : Repository` whose `Save` throws `NotSupportedException`.
Applies to: both

### CP-04 An interface has only the members every implementer implements and every client calls
Why: a wide interface forces implementers to write empty or throwing members and ties a client to methods it never uses, so a change for one client recompiles and retests all of them. Split by client need; one class may implement several small interfaces.
Source: Robert C. Martin, Agile Software Development (2002), chapter 12; Clean Architecture (2017), chapter 10
Looks like: `IReadOrders` and `IWriteOrders`, implemented by one class, consumed by different clients.
Smells like: a twenty-member `IOrderService` where the report client uses one method.
Applies to: both

### CP-05 Policy depends on abstractions it owns; details (database, HTTP, clock, file system, random) are passed in, never constructed inside
Why: a `new SqlConnection(...)` or a `DateTime.Now` inside a rule makes that rule untestable without the real thing and welds the policy to one technology. The high-level module declares the interface it needs, in its own terms; the low-level module implements it.
Source: Robert C. Martin, The Dependency Inversion Principle, C++ Report, May 1996; Clean Architecture (2017), chapter 11
Looks like: `IClock` and `IOrderRepository` injected through the constructor.
Smells like: `DateTime.UtcNow` or `new HttpClient()` inside a pricing rule.
Applies to: both

### CP-06 One fact has one place; duplication is removed at the third occurrence, not before
Why: a VAT rate, a date format or a validation rule written in two places drifts: one copy gets the fix, the other ships the bug. The limit matters as much as the rule: two pieces of code that look alike but change for different reasons are not the same fact, and an abstraction built on the first repetition guesses wrong. Wait for the third occurrence, then extract.
Source: Andrew Hunt and David Thomas, The Pragmatic Programmer (1999), tip 11, "DRY"; Martin Fowler, Refactoring (2nd ed., 2018), chapter 2, "The Rule of Three" (attributed to Don Roberts)
Looks like: one `VatRate` constant and one `InvoiceNumber` parser, used everywhere.
Smells like: the same regular expression pasted into two validators, or a helper extracted from one caller "for reuse".
Applies to: code

### CP-07 No code exists for a requirement that is not in the current story
Why: an unused parameter, a configuration switch nobody sets, an extension point with one implementation, a "for later" abstraction: each costs reading, testing and carrying, and most turn out wrong when "later" comes. The diff adds what the acceptance criteria need and nothing else.
Source: Kent Beck, Extreme Programming Explained (1999), "You Aren't Gonna Need It"; Martin Fowler, Yagni, https://martinfowler.com/bliki/Yagni.html
Looks like: a diff whose every added member is reached by a test from the story.
Smells like: `bool includeArchived = false` that nothing passes, a feature flag with no consumer, an interface with one implementation and no second planned.
Applies to: both

### CP-08 The simplest construct that passes the tests is the one that ships
Why: a generic, a reflection trick, a pattern or a metaprogramming layer where a plain function would do multiplies the reading cost for every maintainer after the author. A construct the reviewer cannot explain in one sentence is a finding; a function with cyclomatic complexity above 10 is split.
Source: Kent Beck, Extreme Programming Explained (1999), "Simple Design"; Martin Fowler, Refactoring (2nd ed., 2018), "Decompose Conditional", "Replace Conditional with Polymorphism"
Looks like: a plain `if` and a loop that a new colleague reads in a minute.
Smells like: a generic repository with a specification builder for a table read in one place.
Applies to: both

### CP-09 A function does one thing, at one level of abstraction, and its name says all of it
Why: a function that parses, validates, computes and saves has four reasons to change and no name that fits. A function stays short enough to read without scrolling, mixes no low-level detail (string slicing) with high-level steps (approve the order), and is extracted the moment a comment is needed to label a block inside it.
Source: Robert C. Martin, Clean Code (2008), chapter 3, "Functions"; Martin Fowler, Refactoring (2nd ed., 2018), "Extract Function"
Looks like: `ApproveOrder` that calls `Validate`, `Reserve` and `Notify`, each three to ten lines.
Smells like: a 120-line method with `// step 1`, `// step 2` comments and five levels of nesting.
Applies to: code

### CP-10 A name states intent in the domain's words; a literal with meaning gets a name
Why: `d`, `tmp`, `data`, `Manager`, `Helper`, `flag` and `ProcessData()` say nothing, so the reader opens the body to learn what the name should have said. `86400`, `"ACTIVE"` and `0.19` scattered through the code cannot be searched, explained or changed in one place. Booleans read as predicates (`isOverdue`), methods as verbs, classes as nouns from the glossary; every meaningful literal is a named constant, an enum member or a value type, defined once.
Source: Robert C. Martin, Clean Code (2008), chapter 2, "Meaningful Names", and chapter 17, G25 "Replace Magic Numbers with Named Constants"; Martin Fowler, Refactoring (2nd ed., 2018), "Replace Magic Literal"
Looks like: `IsOverdue`, `DaysUntilDue`, `MaxRetries = 3`, `OrderStatus.Shipped`.
Smells like: `Check()`, `var x`, `if (status == 2)`, `Thread.Sleep(86400000)`.
Applies to: code

### CP-11 A value is immutable unless mutation is a stated requirement
Why: an object that any holder can change at any time makes every caller a suspect when the state is wrong, and breaks under concurrency. Value types are records or readonly structs, collections are exposed read-only, fields are set in the constructor, and a change produces a new value (`with`) instead of editing the old one.
Source: Joshua Bloch, Effective Java (3rd ed., 2018), Item 17, "Minimize mutability"; Microsoft Learn, Records in C#, https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/records
Looks like: `record Money(decimal Amount, Currency Currency)` and `IReadOnlyList<OrderLine> Lines`.
Smells like: `public List<OrderLine> Lines { get; set; }` and a `Total` recomputed by whoever last touched the list.
Applies to: code

### CP-12 Behaviour is reused by composition; inheritance is used only for a true subtype that satisfies CP-03
Why: a base class made to share code (`BaseService`, an `EntityBase` full of helpers) couples every subclass to every change in it and to each other, and the hierarchy cannot be refactored without touching all of them. A collaborator passed in can be swapped, tested alone and combined.
Source: Erich Gamma, Richard Helm, Ralph Johnson and John Vlissides, Design Patterns (1994), chapter 1, "Favor object composition over class inheritance"
Looks like: `OrderPricing` receives an `IDiscountPolicy`; a test passes a fake.
Smells like: `OrderService : BaseService : LoggingBase`, where the base holds helpers for five unrelated subclasses.
Applies to: both

### CP-13 Effects are visible in the signature: a query does not write, and nothing changes state at a distance
Why: a getter that writes to the database, a method that reads a static `Current` context or a global, a setter that sends an email: each hides a dependency the reader and the test cannot see. Inputs arrive as parameters, outputs leave as return values, a method that changes state is named as a command, and no code depends on mutable static or ambient state.
Source: Bertrand Meyer, Object-Oriented Software Construction (1988), Command-Query Separation; Martin Fowler, CommandQuerySeparation, https://martinfowler.com/bliki/CommandQuerySeparation.html
Looks like: `Quote GetQuote(Order order)` reads only its argument; `void Approve(ApprovalRequest request)` is the only writer.
Smells like: a `Customer.Balance` getter that refreshes from the database, or a rule reading `HttpContext.Current`.
Applies to: code

### CP-14 Inputs are checked at the boundary and refused loudly; inside it, logic is pure and trusts its inputs
Why: a null or malformed value that travels five calls deep before it explodes costs an hour to trace; a swallowed exception or a silent default turns a defect into wrong data. The entry point (handler, constructor, parser) validates once and throws or returns an error; domain calculations and decisions are functions of their arguments with no I/O, so they are tested with values alone, and the I/O sits in a thin shell around them.
Source: Jim Shore, Fail Fast, IEEE Software 21(5), 2004, https://martinfowler.com/ieeeSoftware/failFast.pdf; Gary Bernhardt, Functional Core, Imperative Shell (2012), https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell
Looks like: the handler parses and validates the request, then calls `PriceCalculator.Calculate(lines, rates)`, a pure function.
Smells like: `if (order == null) return;` five calls deep, or `catch (Exception) { }` in a service.
Applies to: both

## What a reviewer checks
- Name, for each changed class, the one role who would ask for its next change; flag a class with two (CP-01).
- Search the diff for a new `case`, `else if` or type check on a thing that already varies elsewhere; flag the edit instead of a new implementation (CP-02, CP-03).
- Look at each new interface for members an implementer leaves empty or throws from, and at each rule for a `new` of a detail inside it (CP-04, CP-05).
- Grep for the same literal, rule or format in more than one place, and for an abstraction with a single use (CP-06, CP-07, CP-10).
- Read each function longer than a screen or with conditionals nested three deep; flag mixed abstraction levels and names that need a comment (CP-08, CP-09).
- Check every public setter, mutable collection return and static mutable field, and every method whose name promises a read but writes (CP-11, CP-13).
- Find each base class added for code sharing and ask what collaborator would do the same job (CP-12).
- Trace each input from its entry point to its first validation; flag validation deeper than the boundary, swallowed exceptions and I/O inside a calculation (CP-14).

## Scenarios the tester writes
- Given a new discount type, when it is registered, then every existing consumer of discounts applies it without a code change in the consumer (fails if CP-02 is broken).
- Given any implementation of `IPaymentGateway`, when the shared contract test suite runs against it, then every test passes, including the ones the implementation would rather skip (fails if CP-03 or CP-04 is broken).
- Given a price calculation, when it runs with a fixed clock, in-memory inputs and no network, then it produces the expected amount (fails if CP-05 or CP-14 is broken).
- Given a `Money` value held by two callers, when one caller tries to change it, then the compiler refuses or the other caller's value is unchanged (fails if CP-11 is broken).
- Given a malformed request, when it reaches the handler, then it is rejected there with a named error and no domain method is called (fails if CP-14 is broken).
