---
name: stack-dotnet
user-invocable: false
description: How a .NET project is built in this kit, as checkable rules with Microsoft Learn sources: pinned LTS SDK, Directory.Build.props and central package management, one solution with a project per layer and the dependency rule, records and sealed classes, async with cancellation, built-in DI and validated options, EF Core conventions, typed results with ProblemDetails, xUnit with WebApplicationFactory and Testcontainers, dotnet format in CI, structured logging, decimal and DateTimeOffset and TimeProvider, secrets outside the repository. Rules NET-01 to NET-17. Read by the architect, the planner, the builder, the tester, the devops role, the finders and the verifier.
x-tags: [dotnet, csharp, aspnet, ef-core]
x-roles: [architect, planner, builder, tester, devops, finder-correctness, finder-security, finder-contract, verifier]
---

# Stack: .NET

## What this covers
The shape of a .NET solution the kit produces: which SDK, which build properties, which projects reference which, how data, time, money, logging, configuration and tests are done, so that two slices built by two agents look like one codebase and a reviewer can point at the line that breaks a rule. The rules below are the kit's choices among the options Microsoft Learn documents; where Microsoft offers two supported ways (minimal APIs or controllers), the ADR picks one and this file says how the pick is checked. A rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id; a convention that lives in a prompt is lost by the next agent. The discipline skills (`discipline-devops-release`, DR-nn) still apply; this file adds the .NET commands and file names.

## Rules
Rule ids are `NET-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### NET-01 `global.json` at the repository root pins the current LTS SDK with `rollForward` set to `latestPatch`
Why: without `global.json` every machine builds with whatever SDK it has, and a preview or a newer major changes analyzers, defaults and warnings between a developer and CI. `latestPatch` keeps security patches while forbidding a feature-band or major jump nobody reviewed. At the time of writing the LTS is .NET 10.
Source: Microsoft Learn, global.json overview, https://learn.microsoft.com/en-us/dotnet/core/tools/global-json; Microsoft Learn, .NET and .NET Core official support policy, https://learn.microsoft.com/en-us/dotnet/core/releases-and-support
Applies to: config

### NET-02 A root `Directory.Build.props` sets `Nullable` enable, `ImplicitUsings` enable, `TreatWarningsAsErrors` true, `AnalysisLevel` latest and `EnforceCodeStyleInBuild` true for every project
Why: set per project these drift: one project allows nulls, another ignores analyzer warnings, and the gate means something different in each. A single props file makes the compiler the first reviewer in every project, including tests. A project may not switch any of them off; a justified exception suppresses one diagnostic id with a comment naming the reason.
Source: Microsoft Learn, Customize the build by folder, https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-by-folder; Microsoft Learn, MSBuild properties for .NET SDK projects, https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props; Microsoft Learn, Code analysis in .NET, https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview
Applies to: config

### NET-03 Package versions live only in `Directory.Packages.props` (central package management) and `packages.lock.json` is committed per project
Why: a version written in a `.csproj` lets two projects reference two versions of the same package and makes an upgrade a hunt through every file. With `ManagePackageVersionsCentrally` a `PackageReference` has no `Version`; the lock file (`RestorePackagesWithLockFile`) makes restore reproducible, which DR-02 requires.
Source: Microsoft Learn, Central Package Management (CPM), https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management; Microsoft Learn, Package references, Locking dependencies, https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files#locking-dependencies
Applies to: config

### NET-04 One solution holds one project per layer (`Domain`, `Application`, `Infrastructure`, `Api` or `Web`, and their tests), and project references point inward only: `Domain` references nothing
Why: when `Domain` can reference EF Core or ASP.NET Core, business rules end up depending on a database or an HTTP framework and cannot be tested or replaced alone. `Application` references `Domain`; `Infrastructure` references `Application` (and `Domain`); `Api` references `Application` and `Infrastructure` only for registration in `Program.cs`. A `ProjectReference` in the wrong direction fails review.
Source: Microsoft Learn, Common web application architectures, "Clean architecture", https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures; Microsoft Learn, dotnet reference add, https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-reference-add
Applies to: design

### NET-05 Value objects are `record` or `readonly record struct`; classes are `sealed` unless a type derives from them; fields are `readonly` where nothing assigns them after construction
Why: a value object as a mutable class compares by reference and gains setters nobody meant; an unsealed class invites inheritance nobody designed and costs devirtualization; a mutable field hides a state change. Records give value equality and `with`; `sealed` states the intent and satisfies CA1852; `readonly` lets the compiler refuse the next accidental write.
Source: Microsoft Learn, Records (C# reference), https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record; Microsoft Learn, sealed (C# reference), https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/sealed; Microsoft Learn, CA1852: Seal internal types, https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1852
Applies to: code

### NET-06 I/O is `async` from the endpoint down, every async method takes and forwards a `CancellationToken`, and `.Result`, `.Wait()` and `.GetAwaiter().GetResult()` do not appear outside `Main`
Why: a blocking call on an async operation ties up a thread-pool thread per request and deadlocks under load; a method that does not forward the token keeps running after the client has gone. Async methods end in `Async`, return `Task` or `ValueTask`, never `async void` outside event handlers.
Source: Microsoft Learn, ASP.NET Core Best Practices, "Avoid blocking calls", https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices; Microsoft Learn, Cancellation in managed threads, https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads; Microsoft Learn, Asynchronous programming scenarios, https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios
Applies to: code

### NET-07 Dependencies are registered in the built-in container with the composition root in `Program.cs` (and one `Add<Layer>()` extension per layer); no service locator, no `static` singletons holding services
Why: `IServiceProvider` injected into a class or a static `ServiceLocator.Get<T>()` hides what a type needs, breaks constructor-level testing and captures scoped services in singletons. Constructor injection makes every dependency visible in the signature, and `ValidateScopes`/`ValidateOnBuild` in development catch a wrong lifetime at start-up.
Source: Microsoft Learn, Dependency injection in .NET, https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection; Microsoft Learn, Dependency injection guidelines, "Recommendations", https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines
Applies to: code

### NET-08 Settings are bound with the options pattern to a `sealed` class with data annotations, registered with `.ValidateDataAnnotations().ValidateOnStart()`, and read through `IOptions<T>` (or `IOptionsMonitor<T>` when reload is needed)
Why: `configuration["Section:Key"]` scattered through the code has no type, no validation and no single place to see what the service needs; a missing value shows up at the first request. `ValidateOnStart` makes the host fail at start-up with the property name, which is how DR-07 is satisfied in .NET.
Source: Microsoft Learn, Options pattern in .NET, "Options validation", https://learn.microsoft.com/en-us/dotnet/core/extensions/options#options-validation; Microsoft Learn, Options pattern in ASP.NET Core, https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options
Applies to: code

### NET-09 EF Core migrations are files in `Infrastructure/Persistence/Migrations`, the `DbContext` is registered scoped (one per request) and applied to a database only by a reviewed script or `migrate` command, never by `EnsureCreated`
Why: a schema that exists only in a developer's database cannot be reviewed or rolled back; `EnsureCreated` creates a schema that no migration can later evolve; a singleton or static `DbContext` is not thread-safe and leaks tracked entities across requests. `AddDbContext` registers scoped by default; migrations are committed with the slice that changes the model.
Source: Microsoft Learn, EF Core, Migrations Overview, https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/; Microsoft Learn, EF Core, DbContext Lifetime, Configuration, and Initialization, https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/
Applies to: both

### NET-10 Lazy loading is off (no proxies package, no `virtual` navigations for that purpose); read queries use `AsNoTracking()` and load related data explicitly with `Include` or a projection
Why: lazy loading turns one query into one per row and fires inside a serializer or after the context is disposed; tracking entities that are only read costs memory and time and lets an accidental `SaveChanges` write them back. A query that returns data to a caller is `AsNoTracking()` or a `Select` into a DTO; a query that will be modified is tracked and says so.
Source: Microsoft Learn, EF Core, Lazy Loading of Related Data, https://learn.microsoft.com/en-us/ef/core/querying/related-data/lazy; Microsoft Learn, EF Core, Tracking vs. No-Tracking Queries, https://learn.microsoft.com/en-us/ef/core/querying/tracking; Microsoft Learn, EF Core, Efficient Querying, https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying
Applies to: code

### NET-11 Value objects are mapped as owned types or complex types, and every aggregate root carries a concurrency token
Why: a value object mapped as its own entity gets an identity and a table it does not need; without a concurrency token two users saving the same aggregate silently overwrite each other. `OwnsOne`/`ComplexProperty` keep the value inline; a `rowversion` (`IsRowVersion()`) or an explicit `IsConcurrencyToken()` property makes the second save throw `DbUpdateConcurrencyException`, which the handler turns into a 409.
Source: Microsoft Learn, EF Core, Owned Entity Types, https://learn.microsoft.com/en-us/ef/core/modeling/owned-entities; Microsoft Learn, What's New in EF Core 8, "Value objects using Complex Types", https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew; Microsoft Learn, EF Core, Handling Concurrency Conflicts, https://learn.microsoft.com/en-us/ef/core/saving/concurrency
Applies to: both

### NET-12 The HTTP layer is minimal APIs or controllers, one choice recorded in an ADR, with typed results (`Results<Ok<T>, NotFound>` or `ActionResult<T>`) and every error body a `ProblemDetails`
Why: mixing both styles gives two routing conventions, two filter pipelines and two ways to document; an untyped `IResult` hides the status codes from OpenAPI; an ad hoc `{ "error": "..." }` body is a contract nobody wrote down. `AddProblemDetails()` plus the exception handler give one error shape, and typed results make the OpenAPI document match the code.
Source: Microsoft Learn, Choose between controller-based APIs and minimal APIs, https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis; Microsoft Learn, Create responses in Minimal API applications, "TypedResults vs Results", https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses; Microsoft Learn, Handle errors in ASP.NET Core, "Problem details", https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling
Applies to: both

### NET-13 Tests are xUnit; API tests use `WebApplicationFactory<Program>` against the real pipeline; database tests use Testcontainers with the production database engine, not the in-memory provider
Why: a unit test of a handler with a mocked repository does not prove the endpoint, the filters, the serializer or the SQL; the EF in-memory provider accepts queries the real provider rejects and skips constraints and transactions. One `IClassFixture` starts the container once per class; the connection string is injected into the factory.
Source: Microsoft Learn, Integration tests in ASP.NET Core, https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests; Microsoft Learn, EF Core, Testing against your production database system, https://learn.microsoft.com/en-us/ef/core/testing/testing-with-the-database; Testcontainers for .NET, https://dotnet.testcontainers.org/; xUnit.net, https://xunit.net/
Applies to: both

### NET-14 `dotnet format --verify-no-changes` and `dotnet build -warnaserror` run in the gate, and a `.editorconfig` at the root carries the style rules
Why: style arguments in review waste the reviewer; an analyzer warning that is allowed to pass once becomes a hundred. The gate fails on a formatting diff or a warning, so a slice arrives clean or not at all; the `.editorconfig` is the single place a rule is turned on, off or given a severity.
Source: Microsoft Learn, dotnet format, https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format; Microsoft Learn, Code analysis configuration, https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/configuration-options; Microsoft Learn, Code-style rule options, https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/code-style-rule-options
Applies to: config

### NET-15 Logging goes through `ILogger<T>` with message templates and named placeholders; no string interpolation or concatenation in a log call; hot paths use the `LoggerMessage` source generator
Why: `_logger.LogInformation($"Order {id} saved")` formats the string even when the level is off and destroys the structured property, so nobody can filter by `OrderId` later. The template `"Order {OrderId} saved"` keeps the value as a field; CA2254 flags the interpolated form and the gate fails on it.
Source: Microsoft Learn, Logging in C# and .NET, "Log message template", https://learn.microsoft.com/en-us/dotnet/core/extensions/logging; Microsoft Learn, CA2254: Template should be a static expression, https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2254; Microsoft Learn, Compile-time logging source generation, https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator
Applies to: code

### NET-16 Money is `decimal` (with its currency), an instant is `DateTimeOffset`, a calendar date is `DateOnly`, and the clock is injected as `TimeProvider`
Why: `double` cannot represent 0.10 exactly and rounds invoices wrong; `DateTime` loses the offset and means a different instant on each server; `DateTime.UtcNow` inside a method makes an expiry rule untestable. `TimeProvider.System` is registered once, tests pass a fake, and no production type calls `DateTime.Now` or `DateTimeOffset.UtcNow` directly.
Source: Microsoft Learn, Floating-point numeric types, "Characteristics of the floating-point types", https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types; Microsoft Learn, Choose between DateTime, DateOnly, DateTimeOffset, TimeSpan, TimeOnly and TimeZoneInfo, https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime; Microsoft Learn, TimeProvider class, https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider
Applies to: code

### NET-17 Secrets come from the Secret Manager (`dotnet user-secrets`) in development and from environment variables or a vault elsewhere; `appsettings*.json` never contains a connection string with a password, a key or a token
Why: a value in `appsettings.Development.json` is committed and shared with every clone; the Secret Manager keeps it in the user profile outside the repository, and the configuration system reads environment variables (`Section__Key`) with no code change in production. This is DR-05 for .NET.
Source: Microsoft Learn, Safe storage of app secrets in development in ASP.NET Core, https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets; Microsoft Learn, Configuration in ASP.NET Core, "Environment variables", https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/
Applies to: config

## The project layout the planner uses
`<App>` is the product name from `docs/REQUIREMENTS.md`, in PascalCase.

```
global.json
Directory.Build.props
Directory.Packages.props
.editorconfig
<App>.sln
src/
  <App>.Domain/           entities, value objects, domain events, repository interfaces; references nothing
  <App>.Application/      use cases (commands, queries, handlers), DTOs, validators; references Domain
  <App>.Infrastructure/   EF Core DbContext, configurations, repositories, external clients; references Application
    Persistence/
      <App>DbContext.cs
      Configurations/
      Migrations/         generated by `dotnet ef migrations add <Name> --project src/<App>.Infrastructure --startup-project src/<App>.Api`
  <App>.Api/              Program.cs (composition root), endpoints or controllers, options classes; references Application and Infrastructure
tests/
  <App>.Domain.Tests/       pure unit tests, no container
  <App>.Application.Tests/  handler tests with fakes, TimeProvider fake
  <App>.Api.Tests/          WebApplicationFactory<Program> + Testcontainers
docs/
  CHANGELOG.md, RUNBOOK.md, RELEASE-CHECKLIST.md, adr/
```

Commands the gate runs, in this order: `dotnet restore --locked-mode`, `dotnet format --verify-no-changes`, `dotnet build -c Release -warnaserror --no-restore`, `dotnet test -c Release --no-build`, `dotnet list package --vulnerable --include-transitive`.

A slice's `**Files:**` line names at most six files, relative to the repository root, every path in backticks. A domain slice and an API slice look like this in `docs/PLAN.md`:

```
**Files:** `src/<App>.Domain/Orders/Order.cs`, `src/<App>.Domain/Orders/Money.cs`, `src/<App>.Domain/Orders/IOrderRepository.cs`, `tests/<App>.Domain.Tests/Orders/OrderTests.cs`

**Files:** `src/<App>.Api/Endpoints/OrdersEndpoints.cs`, `src/<App>.Application/Orders/CreateOrder.cs`, `src/<App>.Infrastructure/Persistence/Configurations/OrderConfiguration.cs`, `src/<App>.Infrastructure/Persistence/Migrations/20261029120000_AddOrders.cs`, `tests/<App>.Api.Tests/Orders/CreateOrderTests.cs`
```

The two root files the init slice writes, so NET-01 and NET-02 hold from the first commit:

```xml
<!-- global.json -->
{ "sdk": { "version": "10.0.100", "rollForward": "latestPatch" } }

<!-- Directory.Build.props -->
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
  </PropertyGroup>
</Project>
```

## What a reviewer checks
- Open `global.json`, `Directory.Build.props` and `Directory.Packages.props`: LTS SDK with `latestPatch`, the five NET-02 properties present and not overridden in any `.csproj`, no `Version` on any `PackageReference`, lock files committed (NET-01, NET-02, NET-03).
- Read every `ProjectReference` in the diff: `Domain` has none, `Application` references only `Domain`, nothing references `Api` (NET-04).
- Search the diff for `class ` without `sealed`, `abstract` or `static`, for mutable value objects, and for `.Result`, `.Wait()`, `GetAwaiter().GetResult()`, `async void`, and methods that take no `CancellationToken` while calling one that does (NET-05, NET-06).
- Search for `IServiceProvider` injected into application types, `GetService` outside `Program.cs`, `configuration[`, and options classes registered without `ValidateOnStart()` (NET-07, NET-08).
- Read the persistence changes: a migration file accompanies every model change, no `EnsureCreated`, no `UseLazyLoadingProxies`, read queries carry `AsNoTracking()` or project to a DTO, value objects are owned or complex, aggregates have a concurrency token (NET-09, NET-10, NET-11).
- Confirm endpoints follow the ADR's style, return typed results, and that error responses are `ProblemDetails`; confirm new endpoints have a `WebApplicationFactory` test and database code has a Testcontainers test (NET-12, NET-13).
- Run the gate commands listed above on the branch; format, warnings and analyzers must be clean (NET-14).
- Search for `$"` or `+` inside `Log*(` calls, for `double`/`float` on amounts, `DateTime.Now`/`UtcNow` outside `Program.cs`, and for passwords or keys in any `appsettings*.json` (NET-15, NET-16, NET-17).

## Scenarios the tester writes
- Given an `Order` with two `Money` values of the same amount and currency, when they are compared, then they are equal and `Money` cannot be mutated after construction (NET-05).
- Given the `Database` options section lacks `ConnectionString`, when the `WebApplicationFactory` host starts, then start-up throws `OptionsValidationException` naming `ConnectionString` (NET-08).
- Given two requests load the same order and both change it, when the second one saves, then the API returns 409 with a `ProblemDetails` body and the first change is kept (NET-11, NET-12).
- Given a `FakeTimeProvider` set to one second before an offer expires, when the handler runs, then the offer is still valid, and after advancing two seconds it is rejected (NET-16).
- Given a Testcontainers PostgreSQL (or SQL Server) instance, when all migrations are applied from an empty database, then `dotnet ef migrations has-pending-model-changes` reports none and the API's readiness endpoint returns healthy (NET-09, NET-13).
