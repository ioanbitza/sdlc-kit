---
name: discipline-layering
user-invocable: false
description: Clean and hexagonal architecture as rules: the dependency rule, a framework-free domain, ports owned by the inner layer, use cases with explicit inputs and outputs, no business rule in the UI, persistence only in storage, cross-cutting concerns at the edges, DTOs at boundaries, one composition root, tests per layer. Rules LY-01 to LY-12. Read by the architect, the builder, the tester, finder-contract and the critic.
x-tags: []
x-roles: [architect, planner, builder, tester, critic, finder-contract, finder-correctness]
---

# Discipline: layering

## What this covers
The rules that keep business logic independent of the delivery mechanism and the storage technology, so that a web framework, a database or a message broker can be replaced without touching a rule, and a rule can be tested without starting any of them. The vocabulary is Clean Architecture (Martin) and Ports and Adapters (Cockburn): domain inside, application around it, adapters outside, every dependency pointing inward.
They live in a file and not in a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id instead of arguing taste. The project's ADR names its layers; this file says what each layer may and may not do.

## The layers
- Domain: entities, value objects, domain services, domain events, port interfaces. Depends on nothing.
- Application: use cases (application services), their request and response types, the unit of work port. Depends on the domain.
- Adapters: web (controllers, pages, endpoints), storage (repositories, ORM mappings), messaging, external clients. Depend on application and domain.
- Composition root: the host's startup, the one place that knows which adapter serves which port.

## Rules
Rule ids are `LY-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### LY-01 Dependencies point inward: domain references nothing, application references domain, adapters reference application and domain, and only the composition root references an adapter
Why: one reference from the domain to a web or data package and the whole rule set is compiled, deployed and tested with that package forever. The rule is enforced at compile time: each layer is its own project or package, and the build fails on a reference in the wrong direction.
Source: Robert C. Martin, The Clean Architecture (2012), https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html; Clean Architecture (2017), chapter 22
Looks like: `Shop.Domain` has no package references; `Shop.Application` references only `Shop.Domain`; `Shop.Web` references both and the adapters.
Smells like: `Shop.Domain` with a reference to `Microsoft.EntityFrameworkCore`.
Applies to: both

### LY-02 The domain contains no framework, no I/O and no persistence, serialization or validation attributes
Why: an entity decorated with ORM, JSON or validation attributes, or calling a logger or `DateTime.Now`, carries the framework's assumptions into the rules and cannot be loaded in a test without it. Domain types are plain classes, records and interfaces in the project's language; the mapping to tables and JSON lives in the adapter (LY-09).
Source: Robert C. Martin, Clean Architecture (2017), chapters 20 and 32; Microsoft Learn, Design a DDD-oriented microservice, https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice
Looks like: `public sealed class Order` with a constructor, methods and read-only properties, importing nothing beyond the language.
Smells like: `[Table("Orders")]`, `[JsonPropertyName]`, `[Required]` or `ILogger<Order>` on an entity.
Applies to: both

### LY-03 A port is an interface defined by the inner layer in its own terms; an adapter in the outer layer implements it
Why: an interface defined next to its implementation (`IEmailSender` in the SMTP project) is the detail's interface, not the policy's, and the policy still depends on the detail. The inner layer writes `INotifyCustomer` with the methods and types it needs; the SMTP adapter, the test fake and the console adapter all implement that.
Source: Alistair Cockburn, Hexagonal Architecture (2005), https://alistair.cockburn.us/hexagonal-architecture/; Robert C. Martin, Clean Architecture (2017), chapter 11
Looks like: `IOrderRepository` in `Shop.Domain`, `EfOrderRepository` in `Shop.Infrastructure`.
Smells like: `ISmtpClientWrapper` in the infrastructure project, injected into a use case.
Applies to: both

### LY-04 A use case is an application service with one named input type and one named output type, and no protocol type in either
Why: a use case that takes an `HttpRequest` or returns an `IActionResult` cannot be called from a job, a CLI or a test without the web stack, and a use case that returns an entity leaks the domain to the UI. One class or function per operation (`PlaceOrder`, `CancelOrder`), each with a request and a response of its own.
Source: Robert C. Martin, Clean Architecture (2017), chapter 20, "Use Cases"; Ivar Jacobson, Object-Oriented Software Engineering: A Use Case Driven Approach (1992)
Looks like: `PlaceOrderResponse Handle(PlaceOrderRequest request)`.
Smells like: `IActionResult PlaceOrder(HttpContext context)`, or a use case that returns the `Order` entity.
Applies to: both

### LY-05 The UI holds no business rule: a controller, page, view model or handler translates and delegates
Why: a discount computed in a controller, a status check in a Razor page or a validation that exists only in a JavaScript form is a rule the API, the job and the tests do not know about, and the next UI loses it. The UI maps input to a use case request, calls the use case and maps the response to the view; a conditional on domain state in the UI is a finding.
Source: Martin Fowler, Patterns of Enterprise Application Architecture (2002), chapter 1, "Layering"; Martin Fowler, PresentationDomainDataLayering, https://martinfowler.com/bliki/PresentationDomainDataLayering.html
Looks like: a controller of ten lines: bind, call, map, return.
Smells like: `if (order.Total > 1000 && customer.IsVip)` in a controller or a Blazor component.
Applies to: both

### LY-06 Persistence is touched only by the storage adapter: no SQL, ORM context, query or connection string outside it
Why: a `DbContext` injected into a use case or a query in a controller makes the schema a public API of the whole application, and a storage change touches every layer. The use case asks a repository port (LY-03) in domain terms; the storage adapter translates to tables, documents or files.
Source: Martin Fowler, Patterns of Enterprise Application Architecture (2002), "Repository", https://martinfowler.com/eaaCatalog/repository.html; Microsoft Learn, Design the infrastructure persistence layer, https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design
Looks like: `EfOrderRepository` as the only type that knows `ShopDbContext`.
Smells like: `_db.Orders.Where(...)` in a use case, or a connection string in a controller.
Applies to: both

### LY-07 Cross-cutting concerns (logging, authentication, authorization, transactions, caching, retries, metrics) sit at the edges, in middleware, decorators or pipeline behaviours
Why: a `_logger.LogInformation` in an entity, an authorization check reimplemented in a use case or a `BeginTransaction` in a domain service spreads one concern over a hundred files and makes the rule depend on the infrastructure that serves it. The use case states what it needs (the current user id as an input, a unit of work as a port); the edge supplies it once for every use case.
Source: Robert C. Martin, Clean Architecture (2017), chapter 22, "Crossing boundaries"; Microsoft Learn, ASP.NET Core Middleware, https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/
Looks like: a logging pipeline behaviour, an authorization middleware, a `TransactionDecorator<TUseCase>`.
Smells like: `using var tx = _db.BeginTransaction()` and `_logger.LogInformation(...)` inside a domain service.
Applies to: both

### LY-08 Data flows in one direction per request: in through an adapter, through one use case, out through its output; an inner layer never calls an outer one except through a port
Why: a use case that calls a controller helper, a domain object that calls the application layer, or two use cases that call each other in a cycle make the call graph unreadable and the behaviour untestable in isolation. Anything the inner layer needs from outside arrives as an input or through a port it owns; anything it has to tell the outside leaves as a return value or a domain event.
Source: Robert C. Martin, The Clean Architecture (2012), "Crossing boundaries", https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
Looks like: adapter, then use case, then domain, then back out through the response and an event.
Smells like: a domain object calling `OrderNotifier.Send(...)` directly, or two use cases that call each other.
Applies to: both

### LY-09 DTOs cross the boundaries; domain objects stay inside; mapping lives in the adapter that owns the boundary
Why: an entity serialized straight to JSON makes every private field a public contract and every schema change an API break; a request model used as an entity drags input quirks into the rules. The API contract, the persistence model and the domain model are three sets of types, each free to change for its own reason, with the mapping in the adapter next to the boundary it serves.
Source: Martin Fowler, Patterns of Enterprise Application Architecture (2002), "Data Transfer Object", https://martinfowler.com/eaaCatalog/dataTransferObject.html; Robert C. Martin, Clean Architecture (2017), chapter 22
Looks like: `OrderDto` on the API, `OrderRow` in storage, `Order` in the domain, with a mapper in each adapter.
Smells like: `return Ok(order)` with the entity, or an API request class saved as the entity.
Applies to: both

### LY-10 All wiring happens in one composition root at the entry point; no inner layer constructs an adapter or asks a container for one
Why: a `new SqlOrderRepository()` in a use case, or a `ServiceLocator.Get<T>()` anywhere, hides the dependency from the signature and from the test, and scatters the configuration over the codebase. Dependencies are declared in constructors, and the one place that knows the concrete types is the host's startup.
Source: Mark Seemann, Dependency Injection in .NET (2011), chapter 3, "Composition Root", https://blog.ploeh.dk/2011/07/28/CompositionRoot/; Microsoft Learn, Dependency injection in .NET, https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection
Looks like: `Program.cs` registering every port with its adapter; every other class has constructor parameters only.
Smells like: `new EfOrderRepository(connectionString)` inside a handler, or `IServiceProvider` injected into a use case.
Applies to: both

### LY-11 Errors cross a boundary as a typed result or a domain exception and are translated to the protocol at the edge
Why: a use case that returns HTTP 404 or lets a database exception reach the UI ties the inner layer to the outer protocol, and a UI that catches `Exception` and shows "something went wrong" loses the reason. The domain says what failed in its own words (`InsufficientStock`); the adapter maps it to a status code, a message or a retry.
Source: Robert C. Martin, Clean Architecture (2017), chapter 22; Microsoft Learn, Handle errors in ASP.NET Core web APIs, https://learn.microsoft.com/en-us/aspnet/core/web-api/handle-errors
Looks like: `Result<OrderId, PlaceOrderError>` from the use case, mapped to 409 or 422 in the API adapter.
Smells like: `throw new HttpResponseException(404)` in the application layer, or `catch (SqlException)` in a controller.
Applies to: both

### LY-12 Tests follow the layers: domain tests run with values only, use case tests run with fake ports, adapter tests run against the real technology
Why: a domain test that needs a database is a sign that the domain has I/O (LY-02); a use case test that mocks a domain object is a sign that the use case does the domain's job; an adapter with no test against the real technology is where the production bug hides. Each layer is tested at the boundary it owns, with the tools that boundary allows.
Source: Martin Fowler, TestPyramid, https://martinfowler.com/bliki/TestPyramid.html; Alistair Cockburn, Hexagonal Architecture (2005), the section on test adapters, https://alistair.cockburn.us/hexagonal-architecture/
Looks like: `Shop.Domain.Tests` with no package beyond the test framework; `Shop.Infrastructure.Tests` with a database container.
Smells like: a domain test that starts a web host, or a use case test that mocks `Order`.
Applies to: both

## What a reviewer checks
- Open each project or package file and list its references; flag any reference from domain outward or from application to an adapter (LY-01).
- Grep the domain for imports of web, ORM, serialization, logging or DI namespaces, and for attributes on entity members (LY-02).
- Locate each interface the use cases depend on and confirm it is declared in the inner layer, in domain terms (LY-03).
- Read each use case signature: one request type, one response type, no HTTP, ORM or entity type in either (LY-04, LY-09).
- Search controllers, pages and view models for conditionals on domain state and for arithmetic on domain values (LY-05).
- Grep outside the storage adapter for `DbContext`, `SqlConnection`, raw SQL strings and query builders (LY-06).
- Find each logger, transaction, cache and auth check and ask whether it belongs in a middleware or decorator; find each HTTP status or `catch (Exception)` and ask whether it sits at the edge (LY-07, LY-08, LY-11).
- Grep for `new` of an adapter type and for service locator calls outside the composition root (LY-10); check that domain tests reference no test container or database (LY-12).

## Scenarios the tester writes
- Given the domain project, when its test suite runs with the network and the file system unavailable, then every test passes (LY-02, LY-12).
- Given the `PlaceOrder` use case with an in-memory repository and a fixed clock, when a valid request is handled, then the response carries the order id and the fake repository holds the order (LY-03, LY-04, LY-10).
- Given a request with insufficient stock, when the use case runs, then it returns an `InsufficientStock` result, and the HTTP adapter maps that result to 409 with the reason (LY-11).
- Given the architecture tests, when a domain type references an adapter namespace, then the build fails (LY-01).
- Given the storage adapter, when it is tested against a real database in a container, then saving and loading an aggregate yields an equal aggregate (LY-06, LY-12).
