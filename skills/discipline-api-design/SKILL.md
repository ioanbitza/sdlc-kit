---
name: discipline-api-design
user-invocable: false
description: API design rules for resources and verbs, the contract before the handler, boundary validation with problem details, idempotency, pagination, versioning, default-deny authentication, limits, error shape, timeouts, DTOs, correlation ids and contract tests. Rules AP-01 to AP-14. Read by the architect, the planner, the builder, the tester and the security and contract finders when an ADR carries an api, rest or http tag.
x-tags: [api, rest, http]
x-roles: [architect, planner, builder, tester, finder-security, finder-contract]
---

# Discipline: API design

## What this covers
An API is a promise made to code the team does not control: a client, a partner, a mobile app shipped months ago. Every endpoint that bends the protocol, changes shape without a version, accepts an unbounded body or answers errors in three different formats breaks a caller the team will never see. These rules say what an endpoint must look like before it is written, how it validates, how it fails, how it protects itself and how its shape is proven stable.
The rules apply to HTTP APIs the team publishes to a browser, a mobile app or another service; internal messaging contracts follow the same ids where a rule fits (AP-03, AP-07, AP-12, AP-13, AP-14).
A rule written here is also the list the contract test asserts on, so a change that violates one fails the build before it reaches a client.
It is a file and not a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id.
Sources are RFC 9110 and RFC 9457 on rfc-editor.org, the OpenAPI Specification, the OWASP API Security Top 10 and ASVS 5.0, Microsoft Learn (ASP.NET Core, Azure API design guidance), the Microsoft REST API Guidelines and martinfowler.com.

## Rules
Rule ids are `AP-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### AP-01 A REST endpoint names a resource with a noun and uses the HTTP method with the semantics RFC 9110 gives it: GET and HEAD are safe, PUT and DELETE are idempotent, POST is neither
Why: a `GET /orders/cancel` is cached, prefetched and retried by intermediaries that trust the method's meaning; a `POST /getOrders` cannot be cached at all. Clients, proxies and tooling all rely on the method saying what it does.
Source: RFC 9110, HTTP Semantics, section 9 Methods, 9.2.1 Safe Methods and 9.2.2 Idempotent Methods, https://www.rfc-editor.org/rfc/rfc9110#section-9; Microsoft Learn, Web API design best practices, https://learn.microsoft.com/azure/architecture/best-practices/api-design
Applies to: both

### AP-02 Every response uses the status code with the meaning RFC 9110 defines: 201 with a Location for a created resource, 204 for no body, 400 for a malformed request, 404 for an unknown resource, 409 for a state conflict, 422 for a well-formed request the rules reject
Why: a 200 that carries `{"error": "not found"}` defeats every generic client, monitor and retry policy; a 500 for a validation error pages the on-call engineer for a typo in a form.
Source: RFC 9110, section 15 Status Codes, https://www.rfc-editor.org/rfc/rfc9110#section-15; RFC 9110, section 10.2.2 Location, https://www.rfc-editor.org/rfc/rfc9110#section-10.2.2
Applies to: code

### AP-03 The OpenAPI document is written and reviewed before the handler, is committed next to the code, and the running service serves a document identical to it
Why: a contract written after the code documents whatever happened to be built, and a contract that drifts from the server is worse than none. Writing it first lets the client, the tests and the review start from the same file.
Source: OpenAPI Specification 3.1, https://spec.openapis.org/oas/v3.1.1.html; Microsoft Learn, OpenAPI support in ASP.NET Core, https://learn.microsoft.com/aspnet/core/fundamentals/openapi/overview
Applies to: both

### AP-04 Input is validated at the boundary, and a rejected request answers with an RFC 9457 problem details body that names each invalid field and the reason
Why: a single "bad request" string makes the client guess which of twelve fields failed; validation that happens deep in the domain reaches the database with garbage first. A problem details body is machine-readable and the same for every endpoint.
Source: RFC 9457, Problem Details for HTTP APIs, https://www.rfc-editor.org/rfc/rfc9457; Microsoft Learn, Handle errors in ASP.NET Core web APIs, https://learn.microsoft.com/aspnet/core/web-api/handle-errors; OWASP ASVS 5.0, chapter V2 Validation and Business Logic, section V2.2 Input Validation
Applies to: code

### AP-05 Any request that creates a resource, sends a message or moves money accepts an idempotency key, and a repeat with the same key returns the first result without acting again
Why: networks time out after the server has acted; without a key the client's retry creates a second order or charges the card twice, and the client has no safe way to recover.
Source: IETF HTTPAPI Working Group, The Idempotency-Key HTTP Header Field, draft-ietf-httpapi-idempotency-key-header, https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/; RFC 9110, section 9.2.2 Idempotent Methods, https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2; Stripe API reference, Idempotent requests, https://docs.stripe.com/api/idempotent_requests
Applies to: both

### AP-06 Every collection endpoint paginates with a documented page size limit and a stable order, and its filter and sort parameters are named in the contract with the fields they accept
Why: an unbounded list is a denial of service waiting for the first large customer; pagination without a stable order returns the same row on two pages and skips another; an undocumented filter is one the client cannot rely on and the server cannot remove.
Source: Microsoft Learn, Web API design best practices, filter and paginate data, https://learn.microsoft.com/azure/architecture/best-practices/api-design; Microsoft REST API Guidelines, collections, https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md
Applies to: both

### AP-07 A change that removes a field, renames one, changes a type, tightens validation or changes a status code ships only under a new API version; the old version keeps working for the period the ADR states
Why: a client compiled against last month's shape cannot be updated on the server's schedule. Additive changes are safe; everything else is a new version or a broken client.
Source: Microsoft Learn, Web API design best practices, versioning, https://learn.microsoft.com/azure/architecture/best-practices/api-design; Microsoft REST API Guidelines, versioning and breaking changes, https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md
Applies to: both

### AP-08 Every endpoint requires authentication and an authorization check by default; anonymous access and each permission are opted into explicitly in code and listed in the contract; an object is returned only after the caller's right to that object is checked
Why: an endpoint that forgets the attribute is public; an endpoint that checks the role but not the object id lets any logged-in user read any other user's record by changing a number in the URL. Deny by default turns both mistakes into a 401 or 403 instead of a leak.
Source: OWASP API Security Top 10 2023, API1 Broken Object Level Authorization and API5 Broken Function Level Authorization, https://owasp.org/API-Security/editions/2023/en/0x11-t10/; OWASP ASVS 5.0, chapter V8 Authorization, section V8.2 General Authorization Design; Microsoft Learn, Require authenticated users with a fallback policy, https://learn.microsoft.com/aspnet/core/security/authorization/secure-data
Applies to: both

### AP-09 Every endpoint has a request body size limit, a limit on collection parameters, and a rate limit per caller; an exceeded limit answers 413 or 429 with a Retry-After header
Why: one caller with a 2 GB body or a loop of requests takes the service down for everyone else; limits that exist only at the proxy are forgotten when the proxy changes.
Source: OWASP API Security Top 10 2023, API4 Unrestricted Resource Consumption, https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/; RFC 6585, 429 Too Many Requests, https://www.rfc-editor.org/rfc/rfc6585#section-4; Microsoft Learn, Rate limiting middleware in ASP.NET Core, https://learn.microsoft.com/aspnet/core/performance/rate-limit
Applies to: both

### AP-10 Every error, from validation to an unhandled exception, has the same body shape (RFC 9457 problem details) with a stable `type`, and a server error never exposes a stack trace, a query or an internal path
Why: a client can handle one error shape; it cannot handle a different one per endpoint, per framework layer and per exception type. A stack trace in a response is a map of the system for an attacker.
Source: RFC 9457, Problem Details for HTTP APIs, https://www.rfc-editor.org/rfc/rfc9457; OWASP ASVS 5.0, chapter V16 Security Logging and Error Handling, section V16.5 Error Handling
Applies to: code

### AP-11 Every outbound call and every endpoint has a timeout written in configuration and in the contract; an upstream timeout answers 504, never hangs the caller
Why: a call without a timeout waits forever when the dependency hangs, holds its thread and connection, and turns one slow service into an outage of every service that calls it.
Source: Microsoft Learn, Build resilient HTTP apps, https://learn.microsoft.com/dotnet/core/resilience/http-resilience; RFC 9110, section 15.6.5 504 Gateway Timeout, https://www.rfc-editor.org/rfc/rfc9110#section-15.6.5; Microsoft Learn, Azure Architecture Center, Retry pattern, https://learn.microsoft.com/azure/architecture/patterns/retry
Applies to: both

### AP-12 Each boundary has its own request and response types; a domain entity or a persistence entity never appears in a handler signature or in the OpenAPI document
Why: binding a request straight to the entity lets a caller set any property the entity has (mass assignment); returning the entity leaks fields the contract never promised and couples the wire shape to the database shape, so a schema change becomes a breaking API change.
Source: Fowler, Data Transfer Object, https://martinfowler.com/eaaCatalog/dataTransferObject.html; Microsoft Learn, Create a web API with ASP.NET Core, prevent over-posting, https://learn.microsoft.com/aspnet/core/tutorials/first-web-api#prevent-over-posting; OWASP API Security Top 10 2023, API3 Broken Object Property Level Authorization, https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/
Applies to: both

### AP-13 Every request carries a correlation id in (accepted from a W3C `traceparent` header or generated at the edge), the id is written to every log line of the request and to every outbound call, and it is returned in the response and in every problem details body
Why: without one id across services, a user's "it failed at 14:32" cannot be matched to a log line in any service; with it, the failing hop is found in one search.
Source: W3C Trace Context, https://www.w3.org/TR/trace-context/; Microsoft Learn, Logging in .NET and ASP.NET Core, scopes and `HttpContext.TraceIdentifier`, https://learn.microsoft.com/aspnet/core/fundamentals/logging/; RFC 9457, section 3.1.3 instance member, https://www.rfc-editor.org/rfc/rfc9457#section-3.1.3
Applies to: both

### AP-14 Every endpoint has a contract test that calls it through the HTTP stack, compares the status and the response body against the OpenAPI document, and fails when a field, a type or a status code changes
Why: a unit test on the handler passes while the serialiser renames a property; a contract test is the only test that sees what the client sees, and the only one that turns a silent breaking change into a red build.
Source: Fowler, Contract Test, https://martinfowler.com/bliki/ContractTest.html; Microsoft Learn, Integration tests in ASP.NET Core, https://learn.microsoft.com/aspnet/core/test/integration-tests; Pact documentation, consumer-driven contracts, https://docs.pact.io
Applies to: code

## What a reviewer checks
Questions to the design:
- Open the OpenAPI document first and confirm it exists in the same change as the handler, with the version in the path or header and the pagination, filter and sort parameters named (AP-03, AP-06, AP-07).
- Read each path and method against RFC 9110: nouns, safe GET, idempotent PUT and DELETE, 201 with Location, 204 without body (AP-01, AP-02).
- Confirm every create, send or charge operation declares an idempotency key and every endpoint declares its auth requirement, limits and timeout (AP-05, AP-08, AP-09, AP-11).
Questions to the diff:
- Search the handlers for an entity type in a parameter or a return and for a missing authorization attribute or policy, then check that an object lookup filters by the caller (AP-12, AP-08).
- Verify that every error path produces problem details with field errors and a stable `type`, that no exception detail reaches the body, and that the correlation id is logged and returned (AP-04, AP-10, AP-13).
- Compare the diff against the previous OpenAPI document: a removed or renamed field, a changed type or a changed status code without a new version is a finding (AP-07).
- Check that a contract test was added or updated for each touched endpoint and that it asserts on the body shape, not only the status (AP-14).
- Run the served OpenAPI document against the committed one and treat any difference as a finding (AP-03).

## Scenarios the tester writes
### Retry does not double the order
Given a `POST /orders` with `Idempotency-Key: 7f3a` that returned 201 with order 1001
When the same request with the same key is sent again
Then the response is the same 201 with order 1001 and no second order exists (AP-05)
And a request with the same key but a different body answers 422 with a problem details body (AP-05, AP-10)

### Field errors, not a string
Given a `POST /customers` body with an empty `email` and a 300-character `name`
When the request is sent
Then the response is 422 with `application/problem+json` and an `errors` member listing `email` and `name` each with a reason (AP-04, AP-10)

### Another user's record
Given user A authenticated and an invoice 42 owned by user B
When user A calls `GET /invoices/42`
Then the response is 404 or 403, never the invoice (AP-08)
And the same call without a bearer token answers 401 (AP-08)

### Page two does not repeat page one
Given 25 products created in the same second
When `GET /products?page=1&size=10` and `GET /products?page=2&size=10` are called
Then the two pages share no product id and the order is the documented one (AP-06)

### The contract catches a rename
Given the OpenAPI document declares `customerId` on `GET /orders/{id}`
When the response property is renamed to `customer_id` without a new version
Then the contract test for the endpoint fails (AP-14, AP-07)
And the same rename under `/v2/orders/{id}` with `/v1` unchanged passes (AP-07)
