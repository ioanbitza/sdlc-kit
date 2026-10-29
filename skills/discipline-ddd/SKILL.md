---
name: discipline-ddd
user-invocable: false
description: Domain-driven design as rules: ubiquitous language, bounded contexts, entities and value objects, aggregates and their invariants, domain events, repositories per root, application services that orchestrate, factories, scenario-driven design, anti-corruption layers, no anemic model. Rules DD-01 to DD-13, switched on by the ddd ADR tag. Read by the architect, the builder, the tester, finder-contract and the critic.
x-tags: [ddd]
x-roles: [architect, planner, builder, tester, critic, finder-contract, finder-correctness]
---

# Discipline: domain-driven design

## What this covers
The rules that keep the model in the code equal to the model in the experts' heads: one language, explicit context boundaries, objects that carry their own rules, consistency boundaries that match real invariants, and events that record what happened in the business. They apply when the project's ADR carries the `ddd` tag; a CRUD application does not need them and is not held to them.
They live in a file and not in a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id instead of arguing taste. The project's glossary (`docs/glossary.md`, or the terms section of the ADR) is the reference every name is checked against.

## Rules
Rule ids are `DD-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### DD-01 Every name in code, tests and documents is a term from the glossary, and one concept has one term
Why: when the expert says "policy", the ticket says "contract" and the class says `InsuranceAgreement`, every conversation needs a translator and every translation loses a rule. A class, method, event or field named outside the glossary is either renamed or the glossary gains the term, in the same change.
Source: Eric Evans, Domain-Driven Design (2003), chapter 2, "Ubiquitous Language"; Martin Fowler, UbiquitousLanguage, https://martinfowler.com/bliki/UbiquitousLanguage.html
Looks like: `Policy`, `Underwrite`, `PolicyIssued`, each present in `docs/glossary.md`.
Smells like: `Contract`, `Agreement` and `Policy` naming the same thing in three files.
Applies to: both

### DD-02 Each bounded context has an explicit boundary, its own model and translation at the edge; no domain type is shared across contexts
Why: a `Customer` class used by billing, shipping and marketing grows every field each of them needs and satisfies none, and a change for one breaks the others. The context map names each context, its relationship to its neighbours (customer/supplier, conformist, anti-corruption layer, published language) and the place where the translation happens.
Source: Eric Evans, Domain-Driven Design (2003), chapter 14, "Bounded Context" and "Context Map"; Martin Fowler, BoundedContext, https://martinfowler.com/bliki/BoundedContext.html
Looks like: `Billing.Customer` and `Shipping.Recipient`, each with its own fields, linked by one id, with a context map in the ADR.
Smells like: one `Customer` entity in a shared project, referenced by every context.
Applies to: design

### DD-03 An entity has an identity that survives changes of state; a value object has no identity, compares by value, is immutable and validates itself on creation
Why: comparing two addresses by reference, or two orders by their fields, gives wrong answers in both directions; a mutable `Money` shared by two invoices changes both. `Money`, `Address`, `DateRange` and `Email` are value objects with a constructor that refuses an invalid state; `Order`, `Customer` and `Shipment` are entities compared by id.
Source: Eric Evans, Domain-Driven Design (2003), chapter 5, "Entities" and "Value Objects"; Microsoft Learn, Implement value objects, https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/implement-value-objects
Looks like: `record Money(decimal Amount, Currency Currency)` with a guard against negative amounts; `Order` with equality on `OrderId`.
Smells like: `Address` with setters compared by reference, or `Order` compared field by field.
Applies to: both

### DD-04 An aggregate has one root and one invariant boundary; outside code reaches its members only through the root
Why: a service that adds an `OrderLine` straight to the lines collection bypasses the order's total limit, and the invariant then lives nowhere. The root exposes operations (`order.AddLine(product, quantity)`) that keep every invariant true after each call; child entities and collections are not reachable for mutation from outside.
Source: Eric Evans, Domain-Driven Design (2003), chapter 6, "Aggregates"; Vaughn Vernon, Effective Aggregate Design, Part I (2011), https://www.dddcommunity.org/library/vernon_2011/
Looks like: `order.AddLine(product, quantity)` that returns an error when the credit limit would be exceeded.
Smells like: `order.Lines.Add(new OrderLine(...))` in a service, with the limit checked somewhere else or nowhere.
Applies to: both

### DD-05 An aggregate references another aggregate by identity, never by object
Why: an `Order` that holds a `Customer` object loads the customer, its addresses and its history with every order, and two aggregates then change in one memory graph with no clear owner. `Order` holds `CustomerId`; whoever needs the customer loads it through the customer's repository.
Source: Vaughn Vernon, Effective Aggregate Design, Part II (2011), https://www.dddcommunity.org/library/vernon_2011/; Vaughn Vernon, Implementing Domain-Driven Design (2013), chapter 10
Looks like: `Order.CustomerId`.
Smells like: an `Order.Customer` navigation property mutated from the order's side.
Applies to: both

### DD-06 One transaction changes one aggregate; a change that spans aggregates is completed by a domain event
Why: a transaction that locks an order, a customer and a stock item serializes the whole shop on one write and fails for all three when one conflicts. The aggregate whose invariant is at stake is saved in the transaction; the others react to the event afterwards, and the design states where that eventual consistency is acceptable.
Source: Vaughn Vernon, Effective Aggregate Design, Part II (2011), https://www.dddcommunity.org/library/vernon_2011/; Eric Evans, Domain-Driven Design (2003), chapter 6
Looks like: `PlaceOrder` saves the order and raises `OrderPlaced`; a handler reserves stock in its own transaction.
Smells like: one transaction that saves `Order`, `Customer` and `StockItem`.
Applies to: both

### DD-07 A domain event is an immutable record of something that happened, named in the past tense in the glossary's words, raised by the aggregate that decided it
Why: `OrderPlaced` carries what the business can act on (who, what, when, how much); `UpdateOrderMessage` carries a technical intent nobody in the business recognizes. Events are raised inside the aggregate's operation, collected on the root and dispatched after the aggregate is saved; a handler may start a new use case but never reaches into another aggregate's internals.
Source: Eric Evans, Domain-Driven Design Reference (2015), "Domain Events", https://www.domainlanguage.com/ddd/reference/; Martin Fowler, Domain Event, https://martinfowler.com/eaaDev/DomainEvent.html; Microsoft Learn, Domain events: design and implementation, https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation
Looks like: `OrderPlaced(OrderId, CustomerId, Money Total, DateTimeOffset PlacedAt)`, raised in `Order.Place()`.
Smells like: `OrderUpdatedEvent` carrying the whole entity, published from a controller before the save.
Applies to: both

### DD-08 There is one repository per aggregate root, and it returns and saves whole aggregates
Why: a repository for `OrderLine` lets code change lines without the order's invariants; a `GetOrderHeader` method that returns a partial order invites a save that drops the lines. The repository's interface is in the domain and speaks in aggregate terms (`FindById`, `Save`, `NextIdentity`); read models for screens and reports are separate queries, not repository methods.
Source: Eric Evans, Domain-Driven Design (2003), chapter 6, "Repositories"; Vaughn Vernon, Implementing Domain-Driven Design (2013), chapter 12
Looks like: `IOrderRepository` with `FindById(OrderId)` and `Save(Order)`; `OrderSummaryQuery` for the list screen.
Smells like: `IOrderLineRepository`, or `UpdateStatus(orderId, status)` on the repository.
Applies to: both

### DD-09 An application service orchestrates: it loads, calls one aggregate operation, saves and publishes; it decides nothing
Why: an `if (order.Total > customer.CreditLimit)` in the application service is a business rule the aggregate does not know and the next service forgets. The application service owns the transaction, the ports and the mapping; the aggregate owns the decision and refuses an operation that would break an invariant.
Source: Eric Evans, Domain-Driven Design (2003), chapter 4, "Application Layer"; Vaughn Vernon, Implementing Domain-Driven Design (2013), chapter 14
Looks like: load, `order.Approve(approver)`, save, publish, map to the response.
Smells like: a service that checks the status, computes the total and sets fields on the order.
Applies to: both

### DD-10 An aggregate or value object that one constructor cannot create in a valid state gets a factory; no object exists in an invalid state
Why: a public parameterless constructor followed by setters lets an `Order` exist with no customer and no currency, and every method then checks what the constructor should have guaranteed. The factory (a static method on the root, or a separate class when it needs collaborators) takes everything an invariant needs and returns either a valid aggregate or an error.
Source: Eric Evans, Domain-Driven Design (2003), chapter 6, "Factories"; Microsoft Learn, Design a microservice domain model, https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model
Looks like: `Order.Place(customerId, lines, pricing)` returning `Result<Order, PlaceOrderError>`, with a private constructor.
Smells like: `new Order()` followed by six setters in a controller.
Applies to: both

### DD-11 Every invariant has a given/when/then scenario, written before the aggregate, and the scenarios are the aggregate's tests
Why: an invariant that exists only in a developer's head has no name, no example and no test, and the first refactoring loses it. The scenario ("Given an order of 950 EUR for a customer with a 1000 EUR limit, when a 60 EUR line is added, then the order refuses with CreditLimitExceeded") names the aggregate, the operation and the error, and becomes the unit test, with no database.
Source: Dan North, Introducing BDD (2006), https://dannorth.net/introducing-bdd/; Martin Fowler, GivenWhenThen, https://martinfowler.com/bliki/GivenWhenThen.html; Eric Evans, Domain-Driven Design (2003), chapter 1, "Crunching Knowledge"
Looks like: `docs/scenarios/order.md` with one given/when/then per invariant, and a test class with the same names.
Smells like: an invariant mentioned in a comment and nowhere else, or a test for it that needs a database.
Applies to: both

### DD-12 An external system is reached through an anti-corruption layer that owns the external model; no external type enters the domain
Why: a payment provider's `TransactionDto` used inside the domain brings the provider's field names, enums and quirks into the rules, and a provider change becomes a domain change. The anti-corruption layer translates both ways (facade, adapter and translator) and exposes a port in the domain's language.
Source: Eric Evans, Domain-Driven Design (2003), chapter 14, "Anticorruption Layer"; Microsoft Learn, Anti-corruption Layer pattern, https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer
Looks like: `StripePaymentGateway : IPaymentGateway` that maps the provider's charge to `PaymentConfirmed`.
Smells like: the provider's charge type as a field of `Order`, or the provider's status enum in a domain switch.
Applies to: both

### DD-13 Behaviour lives with the data: a domain object exposes operations named from the glossary and no public setter
Why: a class with properties only and a service with all the logic is a data structure plus a procedural script wearing an object's clothes, and invariants get checked in some services and not in others. `order.Cancel(reason)` changes the status, records the event and refuses an already shipped order; `order.Status = Cancelled` does none of that.
Source: Martin Fowler, AnemicDomainModel, https://martinfowler.com/bliki/AnemicDomainModel.html; Eric Evans, Domain-Driven Design (2003), chapter 5
Looks like: `order.Cancel(reason)` and `order.Ship(carrier)`, with private setters or init-only state.
Smells like: `public OrderStatus Status { get; set; }` and an `OrderService.Cancel` that sets it.
Applies to: both

## What a reviewer checks
- Compare every new type, method and event name with the glossary; flag a synonym or a term with no entry (DD-01).
- Open the context map for each change that crosses a context; flag a domain type referenced from two contexts and an external type inside the domain (DD-02, DD-12).
- Check each new value object for immutability, value equality and a guarding constructor, and each entity for id-based equality (DD-03).
- Trace each mutation of a child entity or collection back to a root operation; flag a direct mutation, a public setter and a repository for a non-root (DD-04, DD-08, DD-13).
- Grep aggregates for fields typed as another aggregate; flag them unless they are ids (DD-05).
- Count the aggregates saved per use case; flag two in one transaction without an ADR that accepts it (DD-06).
- Read each application service for a conditional on domain state and each constructor for a state it lets through; move the rule into the aggregate or a factory (DD-09, DD-10).
- Match each invariant in the design to a scenario and a test; flag an invariant without one, a test that needs a database, and an event named as a command (DD-07, DD-11).

## Scenarios the tester writes
- Given an order of 950 EUR for a customer with a 1000 EUR credit limit, when a 60 EUR line is added, then the order refuses with `CreditLimitExceeded` and has the same lines as before (DD-04, DD-11, DD-13).
- Given two `Address` values built from the same fields, when they are compared, then they are equal; when one is "changed", then a new value exists and the first is untouched (DD-03).
- Given an order that is placed, when the operation completes, then the order holds one `OrderPlaced` event with the order id, the customer id and the total, and nothing has been published before the save (DD-07).
- Given the `PlaceOrder` application service with an in-memory order repository, when it runs, then exactly one aggregate is saved, and the stock reservation happens in a handler of `OrderPlaced`, not in the same transaction (DD-06, DD-09).
- Given the provider's payment response in its own format, when it crosses the anti-corruption layer, then the domain receives a `PaymentConfirmed` value with domain types only (DD-12).
