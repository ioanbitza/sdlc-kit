---
name: discipline-security
user-invocable: false
description: Security rules drawn from OWASP ASVS 5.0 Level 1 and the Level 2 items a small team must have: injection and output encoding, password storage and throttling, sessions and cookies, deny-by-default access control, cryptography, logging, secrets and TLS, file handling, dependencies, configuration, business logic limits and the threat register. Rules SE-01 to SE-16. Read by every role; always on.
x-tags: []
x-roles: [analyst, architect, planner, builder, tester, critic, devops, finder-security, verifier]
---

# Discipline: security

## What this covers
These rules protect the user's data, the user's account and the team's reputation against the attacks that actually happen to small applications: injected input, stolen sessions, a changed id in a URL, a secret in a repository, a library with a known hole, a debug page left on in production. Each rule is an ASVS 5.0 requirement turned into something a reviewer can check on a design document or on a diff, with the chapter and section it comes from.
It is a file and not a prompt because a rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id.
Sources are the OWASP Application Security Verification Standard 5.0 (https://owasp.org/www-project-application-security-verification-standard/), the OWASP Cheat Sheet Series (https://cheatsheetseries.owasp.org/), the OWASP API Security Top 10 2023 and Microsoft Learn for ASP.NET Core. Where a requirement number is not certain, the rule cites the chapter and section rather than guessing a number.

## Rules
Rule ids are `SE-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### SE-01 Every value that enters a query, a command, a template or a URL is passed as a parameter or encoded for the exact context it lands in; no string building from input
Why: concatenating input into SQL, a shell command, an LDAP filter or an HTML page is the whole family of injection and cross-site scripting; context-specific encoding and parameters remove it, input filtering alone does not.
Source: OWASP ASVS 5.0, chapter V1 Encoding and Sanitization, section V1.2 Injection Prevention (parameterised queries, output encoding per context); OWASP Injection Prevention Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html; OWASP Cross Site Scripting Prevention Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
Applies to: code

### SE-02 Input is validated at the boundary against a positive schema (type, length, range, allowed values) and rejected with a field-level error; validation never replaces encoding (SE-01)
Why: a field that accepts any length and any character is the entry point for every other attack and for plain data corruption; a schema written once at the boundary protects every layer behind it.
Source: OWASP ASVS 5.0, chapter V2 Validation and Business Logic, section V2.2 Input Validation; OWASP Input Validation Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
Applies to: code

### SE-03 Passwords are stored only as a salted hash from an approved memory-hard or iterated function (Argon2id, scrypt, bcrypt, or PBKDF2 with the current OWASP parameters); never plaintext, never reversible encryption, never a plain SHA
Why: a password table leaks sooner or later; with a modern hash the attacker gets nothing usable, with MD5 or SHA-256 the attacker gets most of the passwords, and the users reuse them elsewhere.
Source: OWASP ASVS 5.0, chapter V6 Authentication, the password storage requirements (section V6.6 Authenticator Cryptography in the published 5.0 numbering; if in doubt, chapter V6); OWASP Password Storage Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
Applies to: both

### SE-04 Login, password reset and verification code entry are throttled per account and per source, with a lockout or an increasing delay, and the response never says whether the account exists
Why: without throttling a login form is a free password-guessing service; an "unknown user" message lets the attacker build a list of valid accounts first.
Source: OWASP ASVS 5.0, chapter V6 Authentication, section V6.3 General Authentication Security (anti-automation and uniform responses); OWASP Authentication Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
Applies to: both

### SE-05 A session has an idle timeout and an absolute timeout written in the ADR, is invalidated on logout and on password change, and the session token is regenerated on login
Why: a session that never expires is a stolen laptop or a shared computer away from account takeover; a token that survives login lets an attacker fix a session before the user authenticates.
Source: OWASP ASVS 5.0, chapter V7 Session Management, sections V7.2 Fundamental Session Management Security, V7.3 Session Timeout and V7.4 Session Termination; OWASP Session Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
Applies to: both

### SE-06 Every cookie that carries a session or a token has the `Secure`, `HttpOnly` and `SameSite` attributes set, and uses the `__Host-` prefix where the deployment allows it
Why: without `Secure` the cookie goes over plain HTTP once; without `HttpOnly` one XSS reads it; without `SameSite` another site can send it (cross-site request forgery).
Source: OWASP ASVS 5.0, chapter V3 Web Frontend Security, section V3.3 Cookie Setup; Microsoft Learn, ASP.NET Core cookie authentication and `CookieOptions`, https://learn.microsoft.com/aspnet/core/security/authentication/cookie
Applies to: code

### SE-07 Access is denied unless a rule allows it: every endpoint, page and background command requires an authenticated principal by default, and each permission is granted explicitly in code and listed in the design
Why: an endpoint that nobody remembered to protect is public; a fallback policy that requires authentication turns the forgotten attribute into a 401 instead of a leak.
Source: OWASP ASVS 5.0, chapter V8 Authorization, section V8.2 General Authorization Design (function-level access restricted to explicit permissions); Microsoft Learn, Require authenticated users, fallback policy, https://learn.microsoft.com/aspnet/core/security/authorization/secure-data
Applies to: both

### SE-08 Every read, update or delete of a record checks that the caller may act on that record, in the query or in the handler, not only that the caller has the role
Why: checking the role but not the object lets any logged-in user read any invoice by changing the id in the URL (insecure direct object reference), the most common and most damaging flaw in APIs.
Source: OWASP ASVS 5.0, chapter V8 Authorization, section V8.2 General Authorization Design (data-specific access restricted to explicit permissions); OWASP API Security Top 10 2023, API1 Broken Object Level Authorization, https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/; OWASP Authorization Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
Applies to: code

### SE-09 Cryptography uses the platform's or a maintained library's implementation of an approved algorithm (AES-GCM or ChaCha20-Poly1305 for encryption, SHA-256 or stronger for hashing, a cryptographically secure generator for random values); no custom algorithm, no ECB, no MD5 or SHA-1 for security, and keys live outside the code and the repository with a rotation rule
Why: home-made or outdated cryptography fails silently and is discovered by the attacker, not by the team; a key in the repository is a key in every clone, every fork and every backup forever.
Source: OWASP ASVS 5.0, chapter V11 Cryptography, sections V11.2 Secure Cryptography Implementation, V11.3 Encryption Algorithms, V11.4 Hashing and Hash-based Functions and V11.5 Random Values; OWASP Cryptographic Storage Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html; OWASP Key Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
Applies to: both

### SE-10 Logs record security events (login success and failure, access denied, validation failure, privilege change) with time, principal and correlation id, and never contain a password, a token, a session id, a card number or personal data beyond the identifier needed to investigate
Why: without the events an incident cannot be reconstructed; with a secret in the log the log becomes the breach, and personal data in logs is retained longer than the law allows.
Source: OWASP ASVS 5.0, chapter V16 Security Logging and Error Handling, sections V16.2 General Logging and V16.3 Security Events; OWASP Logging Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html; the kit's `skills/legal-data-protection/SKILL.md`
Applies to: both

### SE-11 An unhandled error answers a generic message with a correlation id; stack traces, queries, file paths and framework versions never reach the response, and the application fails closed (access denied, operation not done)
Why: an error page is a map of the system for an attacker; an exception that leaves a half-done operation or an open access check is worse than the error itself.
Source: OWASP ASVS 5.0, chapter V16 Security Logging and Error Handling, section V16.5 Error Handling; OWASP Error Handling Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
Applies to: code

### SE-12 Secrets (connection strings, API keys, signing keys, certificates) come from the environment or a vault at runtime, never from a file in the repository, and every connection, including service to service, uses TLS 1.2 or later with certificate validation on
Why: a secret committed once is in the history forever and is scraped within minutes on a public host; an internal call over plain HTTP is read by whoever is on the network, and disabled certificate validation makes TLS decorative.
Source: OWASP ASVS 5.0, chapter V13 Configuration, section V13.3 Secret Management; chapter V12 Secure Communication, sections V12.1 General TLS Security Guidance, V12.2 HTTPS Communication with External Facing Services and V12.3 General Service to Service Communication Security; OWASP Secrets Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html; Microsoft Learn, Safe storage of app secrets in development, https://learn.microsoft.com/aspnet/core/security/app-secrets
Applies to: both

### SE-13 A file name or path from the user never reaches the file system directly: uploads get a server-generated name and are stored outside the web root, the path is canonicalised and checked against the allowed directory, and uploads have a size limit, an allowed type list checked by content and a scan rule stated in the design
Why: `../../etc/passwd` or a web shell named `report.pdf.aspx` are the two oldest tricks in file handling and both still work on applications that trust the file name.
Source: OWASP ASVS 5.0, chapter V5 File Handling, sections V5.2 File Upload and Content, V5.3 File Storage and V5.4 File Download; OWASP File Upload Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
Applies to: both

### SE-14 Every dependency is pinned to an exact version through a lock file, scanned for known vulnerabilities in the build with a failing threshold, kept within the update window the ADR states, and has a known licence (LL-01)
Why: most breaches of small applications come through a library with a published hole and a fix nobody applied; a floating version pulls an unreviewed change into production, and an unknown licence is a legal problem shipped with the binary.
Source: OWASP ASVS 5.0, chapter V15 Secure Coding and Architecture, section V15.2 Security Architecture and Dependencies; OWASP Vulnerable Dependency Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html; Microsoft Learn, Auditing package dependencies for security vulnerabilities, https://learn.microsoft.com/nuget/concepts/auditing-packages; the kit's `skills/legal-licenses/SKILL.md`
Applies to: both

### SE-15 Production configuration sends the security headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, frame protection), runs with debug and detailed errors off, exposes no default or sample credentials, and serves no framework version banner
Why: the headers are the browser's only instructions for what the page may load and where it may be framed; a debug page, a default admin password or a version banner are the first three things an automated scanner tries.
Source: OWASP ASVS 5.0, chapter V3 Web Frontend Security, section V3.4 Browser Security Mechanism Headers; chapter V13 Configuration, section V13.4 Unintended Information Leakage; OWASP HTTP Headers Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html; Microsoft Learn, Enforce HTTPS in ASP.NET Core (HSTS), https://learn.microsoft.com/aspnet/core/security/enforcing-ssl
Applies to: both

### SE-16 The design holds a threat register in `docs/` with one `T-nn` entry per threat (asset, actor, path, impact, mitigation, the SE rule or test that covers it), and every flow that creates value or costs money has an anti-automation measure and a business limit written in the register
Why: a threat nobody wrote down has no owner and no test; a sign-up, a coupon or a payment flow without a limit is automated by a script within days of going live, and the loss is counted in money, not in findings.
Source: OWASP Threat Modeling Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html; OWASP ASVS 5.0, chapter V2 Validation and Business Logic, sections V2.3 Business Logic Security and V2.4 Anti-automation; OWASP ASVS 5.0, chapter V15 Secure Coding and Architecture, the documentation requirements of section V15.1
Applies to: design

## What a reviewer checks
Questions to the design:
- Open `docs/` and find the `T-nn` register; confirm every entry names a mitigation and the SE rule or test that covers it, and that sign-up, payment and coupon flows carry a limit (SE-16).
- Read the ADR for session timeouts, the cookie attributes, the key storage and rotation rule, the dependency update window and the upload limits (SE-05, SE-06, SE-09, SE-13, SE-14).
- Confirm the permission list exists and that authentication is the default with anonymous access as the exception (SE-07).
Questions to the diff:
- Search for string concatenation or interpolation that reaches SQL, a process start, a shell, a file path or raw HTML, and for `Html.Raw`, `innerHTML` or `MarkupString` on user data (SE-01, SE-13).
- Look at every new handler or page for a missing authorization requirement and at every lookup by id for a filter on the caller (SE-07, SE-08).
- Grep the diff for password, secret, key, token and connection string literals, for MD5, SHA1, ECB and `ServerCertificateCustomValidationCallback` returning true, and for log statements that write a request body or a token (SE-03, SE-09, SE-10, SE-12).
- Check the lock file changed with every package change, the vulnerability scan ran in CI, and the production settings keep detailed errors off and the headers on (SE-14, SE-15, SE-11).
- Verify a validation schema exists for each new input and that a rejected input answers a field-level error without echoing the raw value unencoded (SE-02, SE-04).

## Scenarios the tester writes
### Script tag in a display name
Given a profile form
When the display name `<script>document.title='x'</script>` is saved and the profile page is rendered
Then the page source contains the text encoded as `&lt;script&gt;` and no script executes (SE-01, SE-02)

### Path traversal in a download
Given a download endpoint `GET /files/{name}`
When `name` is `..%2F..%2Fappsettings.json`
Then the response is 400 or 404 and the server log shows a rejected path, not the file content (SE-13)

### Changed id in the URL
Given user A logged in and document 318 owned by user B
When user A requests `GET /documents/318` and `DELETE /documents/318`
Then both answer 403 or 404 and document 318 is unchanged (SE-08)

### Password guessing stops
Given a valid account and a list of 50 wrong passwords
When 50 login attempts are sent within one minute
Then after the configured threshold the responses slow down or lock, every failure message is identical, and the attempts appear in the security log without the passwords (SE-04, SE-10)

### Secret in the repository
Given the repository history
When a secret scanner runs over every commit
Then it reports no connection string, API key or private key, and the application starts with its secrets taken from the environment (SE-12)
