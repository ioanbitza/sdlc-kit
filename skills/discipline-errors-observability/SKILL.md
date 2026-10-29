---
name: discipline-errors-observability
user-invocable: false
description: Rules for errors, logging and operability: errors are surfaced not swallowed, one error hierarchy with a quotable code, validation at the boundary, no silent catch, exceptions versus results per layer, structured logs with a correlation id, no personal data or secrets in logs, log levels with a meaning, the golden signals and health endpoints, timeouts, retries and idempotency at process boundaries, a runbook line per error code. Rules EO-01 to EO-13. Read by the architect, builder, tester, devops, finder-correctness and finder-security.
x-tags: []
x-roles: [architect, builder, tester, devops, finder-correctness, finder-security]
---

# Discipline: errors and observability

## What this covers
A failure the user cannot see and the operator cannot find costs twice: once when it happens and again when someone reconstructs it from guesswork. These rules say what happens to an error at each layer, what a log line and a metric must contain, what they must never contain, and what a call that leaves the process must be prepared for. It is a file and not a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id.

## Rules
Rule ids are `EO-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### EO-01 An error is shown to the user or thrown to the caller; it is never logged and swallowed
Why: a logged-and-swallowed error leaves the user with a wrong result and the belief that the operation succeeded; the log line is read days later, if ever. The layer that cannot handle the error rethrows it; the layer that can (the boundary) shows it with its code (EO-02).
Source: Microsoft Learn, Best practices for exceptions, https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions; OWASP Error Handling Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
Applies to: code

### EO-02 The project has one error type hierarchy, and every error carries a stable code the user can quote
Why: with one hierarchy the boundary maps errors to responses in one place; with ad hoc exceptions every endpoint improvises. A code such as `ORD-017` in the message lets a user report exactly what happened, lets support search for it, and gives the runbook (EO-13) one entry per code. Over HTTP the error is a Problem Details body with `type`, `title`, `status`, `detail` and the code.
Source: RFC 9457, Problem Details for HTTP APIs, https://www.rfc-editor.org/rfc/rfc9457; Microsoft Learn, Framework Design Guidelines, Design guidelines for exceptions, https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exceptions
Applies to: design

### EO-03 Input is validated at the boundary, and a validation error names the field and the rule it broke
Why: invalid input that reaches the domain fails later, deeper and with a message about the wrong thing. A response that says "invalid request" costs the user a guess per field; one that says `customerId: required` and `quantity: must be between 1 and 100` costs none. Domain invariants are still enforced in the domain; the boundary check is the first line, not the only one.
Source: OWASP Input Validation Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html; RFC 9457, section 3.1 and the `errors` extension example, https://www.rfc-editor.org/rfc/rfc9457
Applies to: code

### EO-04 No empty catch, no catch-and-continue, and no default value on failure that hides a data loss
Why: `catch { }` turns a defect into silence; `catch { return []; }` turns a failed read into an empty list that the next step treats as "no records" and acts on, deleting, billing or reporting on nothing. A catch block either handles the error completely (retries, compensates, falls back to something the user is told about) or rethrows it with context.
Source: CWE-390, Detection of Error Condition Without Action, https://cwe.mitre.org/data/definitions/390.html; CWE-391, Unchecked Error Condition, https://cwe.mitre.org/data/definitions/391.html; Microsoft Learn, Best practices for exceptions, https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
Applies to: code

### EO-05 Exceptions are for exceptional paths and results for expected failures; each layer picks one style and the ADR says which
Why: a validation failure, a not-found and an insufficient balance are outcomes the caller must handle, and an exception makes them invisible in the signature and expensive at runtime; a lost database connection is not an outcome the caller can handle, and a result type makes it easy to ignore. Mixing both styles in one layer means every caller handles both or neither.
Source: Microsoft Learn, Framework Design Guidelines, Exceptions and performance (the Tester-Doer and Try-Parse patterns), https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exceptions-and-performance; Exception throwing ("do not use exceptions for the normal flow of control"), https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exception-throwing
Applies to: design

### EO-06 Logs are structured, key-value pairs with a message template, and every line carries the correlation id of the request it belongs to
Why: prose logs (`"Order " + id + " failed for " + user`) cannot be filtered by order id without a regular expression that breaks on the next wording change. Without a correlation id the lines of one request are indistinguishable from the lines of the hundred requests around it; the id is read from the incoming `traceparent` header or created at the edge, and propagated to every outgoing call.
Source: Microsoft Learn, Logging in .NET, log message template, https://learn.microsoft.com/en-us/dotnet/core/extensions/logging; W3C Trace Context, https://www.w3.org/TR/trace-context/; OWASP Logging Cheat Sheet, "Event attributes", https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
Applies to: code

### EO-07 No personal data and no secrets in logs or in error messages: no names, emails, tokens, passwords, card numbers, session ids, full request bodies, and no stack traces to the user
Why: a log store is copied, searched and retained far beyond the application's access controls, so a password logged once is a password leaked. A stack trace in a response tells an attacker the framework, the versions and the file layout. Log the identifier of the record, not its content; log that a token was rejected, not the token.
Source: OWASP Logging Cheat Sheet, "Data to exclude", https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html; CWE-532, Insertion of Sensitive Information into Log File, https://cwe.mitre.org/data/definitions/532.html; CWE-209, Generation of Error Message Containing Sensitive Information, https://cwe.mitre.org/data/definitions/209.html
Applies to: code

### EO-08 Each log level has one meaning: error means someone acts now, warn means watch, info is a business event, debug is off in production
Why: when errors are logged for expected conditions, the error channel fills with noise and the real one is missed; when debug is on in production, the log store is paid for twice and personal data leaks through it. An `error` line is, by definition, something a person is paged or ticketed for; if nobody would act, it is `warn` or `info`.
Source: Microsoft Learn, LogLevel enumeration, https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.logging.loglevel; OWASP Logging Cheat Sheet, "Which events to log", https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
Applies to: code

### EO-09 Every service exposes metrics for latency, traffic and errors (and saturation where a resource is bounded), and a health endpoint that checks its dependencies
Why: without the three signals the first report of an outage is a user; with them a dashboard shows the error rate climbing before the user calls. A health endpoint that returns 200 without touching the database reports a dead service as alive; it checks each dependency and reports which one failed.
Source: Google SRE Book, "Monitoring Distributed Systems", the four golden signals, https://sre.google/sre-book/monitoring-distributed-systems/; Azure Architecture Center, Health Endpoint Monitoring pattern, https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring
Applies to: both

### EO-10 Every call that leaves the process (HTTP, database, queue, file share, external process) has an explicit timeout
Why: a call without a timeout waits forever when the other side hangs, holds its thread and its connection, and the callers of the caller time out instead, so the failure is reported in the wrong place. The timeout is a number in configuration, chosen from the dependency's measured latency, not a library default nobody has read.
Source: Google SRE Book, "Addressing Cascading Failures", "Latency and deadlines", https://sre.google/sre-book/addressing-cascading-failures/; Azure Architecture Center, Transient fault handling, https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults
Applies to: code

### EO-11 A retry is bounded, uses exponential backoff with jitter, and is attempted only for transient failures
Why: a retry loop without a cap turns one slow dependency into a storm that keeps it down; a retry on a 400 or a validation error repeats a call that can never succeed. The policy (attempts, base delay, cap, which errors) lives in one place per dependency and is named in the ADR, so the reviewer reads it rather than infers it.
Source: Azure Architecture Center, Retry pattern, https://learn.microsoft.com/en-us/azure/architecture/patterns/retry; Google SRE Book, "Addressing Cascading Failures", "Retries", https://sre.google/sre-book/addressing-cascading-failures/; Brooker, "Exponential Backoff And Jitter", AWS Architecture Blog, https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
Applies to: code

### EO-12 Any operation that may be retried, by this process or by a client, is idempotent: the same request twice produces one effect
Why: a retried payment that is not idempotent charges twice; a retried "create order" creates two. Reads and full updates are idempotent by HTTP's definition; a create or a non-idempotent command carries an idempotency key the server stores and checks, and a message consumer deduplicates on the message id.
Source: RFC 9110, HTTP Semantics, section 9.2.2, Idempotent Methods, https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2; IETF HTTPAPI Working Group, The Idempotency-Key HTTP Header Field, draft-ietf-httpapi-idempotency-key-header; Azure Architecture Center, Transient fault handling, https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults
Applies to: both

### EO-13 Every error code that reaches a user or an alert has a runbook line in the docs: what it means, what to check, what to do
Why: an alert at three in the morning with no runbook is solved by whoever is awake, from memory, differently each time. A runbook line turns the error code (EO-02) into a procedure; an alert that has no line is either not worth paging for (EO-08) or missing its documentation, and the reviewer flags which.
Source: Google SRE Book, "Being On-Call", playbooks, https://sre.google/sre-book/being-on-call/; "Monitoring Distributed Systems", "Tying these principles together", https://sre.google/sre-book/monitoring-distributed-systems/
Applies to: process

## How these rules connect to the other discipline skills
- Where the error hierarchy lives and which layer throws or returns is a layering question; `discipline-layering` says the domain does not depend on the HTTP or logging framework, so EO-02 types sit in the domain or application layer and the Problem Details mapping sits at the boundary.
- Input validation at the boundary (EO-03) and the ban on secrets in logs (EO-07) are also security rules; a finder-security finding cites the `discipline-security` id, a finder-correctness finding cites the EO id.
- The timeout, retry and idempotency rules (EO-10 to EO-12) are tested as TS-07 integration tests against the real adapter with the dependency stopped or slowed, never with a mock that returns instantly.
- Health endpoints and metrics (EO-09) are consumed by the release checks in `discipline-devops-release`; a service without them cannot pass a rollout gate.

## Terms
- Boundary: the layer where a request enters the process (a controller, a message handler, a CLI command) or leaves it (an HTTP client, a repository, a queue producer).
- Error code: a short stable identifier (`ORD-017`) that names one failure, is written in the response and the log, and has one line in the runbook. It does not change when the message wording changes.
- Correlation id: the identifier shared by every log line, span and outgoing call that belong to one incoming request; carried in the `traceparent` header between processes.
- Transient failure: one that a later identical attempt may not hit: a timeout, a connection reset, a 503, a lock wait. A 400, a 404 or a validation error is not transient.
- Idempotent: an operation whose second identical execution leaves the system exactly as the first did.

## What a log line and an error response look like
```
{"ts":"2026-10-29T14:02:11.480Z","level":"Error","code":"ORD-050","msg":"Order lookup failed for {CustomerId}",
 "CustomerId":"c-17","traceId":"4bf92f3577b34da6a3ce929d0e0e4736","exception":"NpgsqlException: connection refused"}
```
```
HTTP/1.1 503 Service Unavailable
Content-Type: application/problem+json
{"type":"https://docs.example.com/errors/ORD-050","title":"Orders are temporarily unavailable",
 "status":503,"detail":"Quote code ORD-050 to support.","code":"ORD-050","traceId":"4bf92f3577b34da6a3ce929d0e0e4736"}
```
The log line names the customer by id, not by name or email (EO-07); the response carries the code and the trace id, not the exception (EO-02, EO-07); the runbook has a line for ORD-050 (EO-13).

## What a reviewer checks
- Read every `catch`: it rethrows with context, handles completely, or returns a result the caller must inspect; none is empty, none returns a default that could stand for lost data (EO-01, EO-04).
- Trace every new error to the hierarchy and its code, and from the code to a runbook line in the docs (EO-02, EO-13).
- Check the boundary validation: each rejected field is named with its rule, and the domain still enforces its invariants (EO-03).
- Confirm the layer's chosen style (exception or result) in the ADR and flag the other style in that layer (EO-05).
- Grep the diff for string-concatenated log messages, log calls without the correlation id in scope, and logged values that are personal data or secrets (EO-06, EO-07).
- Read each `error` and `warn` call and ask who acts on it; downgrade or flag (EO-08).
- Find every outgoing call and check for a timeout, a bounded retry policy with jitter, and an idempotency key or deduplication where the operation is not idempotent by nature (EO-10, EO-11, EO-12).
- Call the health endpoint with a dependency stopped and confirm it reports the failure (EO-09).

## Scenarios the tester writes
- Given a database that refuses connections, when `POST /orders` is called, then the response is a Problem Details body with a stable code, no stack trace, and the same code appears in a log line with the request's correlation id (EO-01, EO-02, EO-06, EO-07).
- Given a request missing `customerId` and with `quantity: 0`, when it is posted, then the response lists both fields with the rule each broke (EO-03).
- Given a downstream HTTP dependency that never answers, when the service calls it, then the call fails within the configured timeout and the retry count in the logs does not exceed the configured maximum (EO-10, EO-11).
- Given the same create request sent twice with the same idempotency key, when both are processed, then one record exists and both responses carry its id (EO-12).
- Given the database stopped, when the health endpoint is called, then it returns an unhealthy status naming the database check (EO-09).
