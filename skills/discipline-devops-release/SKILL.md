---
name: discipline-devops-release
user-invocable: false
description: Build, pipeline and release rules for any stack: reproducible build, pinned and scanned dependencies, no secrets in the repository, build once and promote, fail-fast configuration, health endpoints, rehearsed rollback, expand/contract migrations, versioned release with a human-made tag, observability, least privilege, infrastructure as code, a release checklist file. Rules DR-01 to DR-15. Read by the architect, the planner, the builder, the devops role, the tester, finder-security and finder-contract.
x-tags: []
x-roles: [architect, planner, builder, devops, tester, finder-security, finder-contract]
---

# Discipline: devops and release

## What this covers
How a change gets from a commit to a running system without surprises: the build anyone can repeat, the pipeline that proves what the developer proved, the artifact that is deployed unchanged, the configuration and secrets that stay out of the code, the release that has a version and a way back. The rules apply to every project the kit builds, whatever the stack; the stack skills add the commands and the file names.
The devops role owns the pipeline, the runbook and the checklist; the builder owns start-up validation, health endpoints and migrations; the tester turns the rules into the scenarios at the end of this file. A rule in a file binds the architect, the builder and the review alike, and a reviewer cites it by id; a rule that lives only in a prompt is forgotten by the next agent.

## Rules
Rule ids are `DR-nn`. A finding cites one of them; the review scripts refuse an id that is not here.

### DR-01 A clean checkout builds and tests with one documented command
Why: a build that needs a colleague's machine, an undocumented tool or a manual step cannot be repeated by CI, by a new developer or by the person doing an emergency fix at night. The README names the command (`make check`, `./build.sh`, `dotnet test`); nothing else is required beyond the pinned toolchain.
Source: Reproducible Builds, definition, https://reproducible-builds.org/docs/definition/; The Twelve-Factor App, II. Dependencies, https://12factor.net/dependencies
Applies to: process

### DR-02 Every dependency is pinned by a lockfile or an exact version, and the lockfile is committed
Why: a floating range (`^1.2`, `*`, a latest tag) makes two builds of the same commit differ, so a bug or a compromised package appears without any change in the repository. The lockfile (`package-lock.json`, `packages.lock.json`, `poetry.lock`, `go.sum`) is the record of what was built.
Source: The Twelve-Factor App, II. Dependencies, https://12factor.net/dependencies; NuGet, Package references, "Locking dependencies", https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files#locking-dependencies
Applies to: config

### DR-03 Dependencies are scanned for known vulnerabilities in the gate, and a high or critical finding fails it
Why: most exploited weaknesses in shipped software are in a library nobody looked at after adding it. The scan runs on every pipeline run (`dotnet list package --vulnerable`, `npm audit`, Dependabot or an equivalent), the threshold is written in the pipeline file, and an accepted exception names the advisory id, the reason and an expiry date.
Source: OWASP Vulnerable Dependency Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html; NuGet, Auditing package dependencies for security vulnerabilities, https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages
Applies to: config

### DR-04 CI runs the same gate the developer ran, and every pipeline tool is pinned to a commit or an exact version
Why: a CI step that differs from the local command lets a change pass on one and fail on the other, and a third-party action referenced by a moving tag can be replaced under the project. The pipeline calls the DR-01 command, and actions, images and installers are pinned by digest, commit SHA or exact version.
Source: GitHub Docs, Security hardening for GitHub Actions, "Using third-party actions", https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions; OWASP CI/CD Security Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html
Applies to: config

### DR-05 No secret lives in the repository, in a built image or in a CI log; secrets come from the environment or a vault
Why: a key committed once is in the history forever and in every clone; a key baked into an image travels with it to every registry; a key echoed by a build step is in a log that many people can read. Secrets are injected at run time, the pipeline masks them, and a scanner for committed secrets runs in the gate.
Source: OWASP Secrets Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html; The Twelve-Factor App, III. Config, https://12factor.net/config
Applies to: both

### DR-06 The artifact is built once and promoted through environments unchanged
Why: an artifact rebuilt per environment is a different artifact: what passed in staging is not what runs in production. One build produces one immutable, versioned artifact (image digest, package version), and promotion moves that same artifact, with configuration supplied from outside it.
Source: The Twelve-Factor App, V. Build, release, run, https://12factor.net/build-release-run; Google SRE Book, chapter 8, Release Engineering, https://sre.google/sre-book/release-engineering/
Applies to: process

### DR-07 Configuration comes from environment variables and is validated at start-up; a missing or invalid value stops the process
Why: a service that starts with a missing connection string or a wrong URL fails later, on the first request, often in front of a user. Start-up reads every setting, checks it, and exits with a message naming the setting; no default silently points at a developer database.
Source: The Twelve-Factor App, III. Config, https://12factor.net/config; Microsoft Learn, Options pattern in .NET, "Options validation", https://learn.microsoft.com/en-us/dotnet/core/extensions/options#options-validation
Applies to: code

### DR-08 The service exposes a liveness endpoint and a readiness endpoint that checks its dependencies
Why: without them the orchestrator or the load balancer cannot tell a healthy instance from one that started but cannot reach its database, and sends traffic to the wrong one. Liveness says the process runs; readiness says it can serve; readiness fails when a required dependency is down.
Source: Microsoft Learn, Health checks in ASP.NET Core, https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks; Kubernetes, Liveness, Readiness and Startup Probes, https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/
Applies to: code

### DR-09 Rollback is one documented command, and it was run at least once before the first production release
Why: a rollback invented during an incident is where the second incident starts. The runbook names the command (redeploy the previous artifact version, revert the release), who may run it, and the date it was last rehearsed; a rollback never requires a rebuild.
Source: Google SRE Book, chapter 8, Release Engineering, https://sre.google/sre-book/release-engineering/; The Twelve-Factor App, V. Build, release, run, https://12factor.net/build-release-run
Applies to: process

### DR-10 Database migrations run before the new code and stay backward compatible for one version (expand, migrate, contract)
Why: a migration that renames or drops a column in the same release as the code that stops using it breaks the old version during the rollout and makes DR-09 impossible. Each release only adds (new column, new table, nullable first); the removal ships one release later, after the old code is gone. Migrations are files in source control, generated to a script that is reviewed.
Source: Microsoft Learn, EF Core, Applying Migrations, https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying; Microsoft Learn, EF Core, Managing Migrations, https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/managing
Applies to: both

### DR-11 A release has a semantic version, a changelog line per requirement id, and a tag the human creates
Why: without a version nobody can say what is running; without a changelog tied to requirement ids nobody can say which requirement a release delivered; a tag created by an agent or a script is a release nobody decided. `CHANGELOG.md` gets one line per `R-nn` under the version heading; the human runs `git tag -a vX.Y.Z` and pushes it.
Source: Semantic Versioning 2.0.0, https://semver.org/spec/v2.0.0.html; Keep a Changelog 1.1.0, https://keepachangelog.com/en/1.1.0/; Pro Git, 2.6 Git Basics, Tagging, https://git-scm.com/book/en/v2/Git-Basics-Tagging
Applies to: process

### DR-12 Logs go to stdout as structured events, metrics are exported, and both reach a place a named person looks at
Why: a log that stays in a container is lost with it; a dashboard nobody opens is decoration. The service writes structured logs to standard output, exports metrics and traces, and the runbook names the destination (collector, dashboard, alert channel) and who reads it.
Source: The Twelve-Factor App, XI. Logs, https://12factor.net/logs; Google SRE Book, chapter 6, Monitoring Distributed Systems, https://sre.google/sre-book/monitoring-distributed-systems/; Microsoft Learn, .NET observability with OpenTelemetry, https://learn.microsoft.com/en-us/dotnet/core/diagnostics/observability-with-otel
Applies to: both

### DR-13 The pipeline's identity has the least privilege the job needs, declared in the pipeline file
Why: a build token with write access to every repository, registry and cloud account turns one compromised dependency or pull request into a takeover. Permissions are declared per job (`permissions:` in GitHub Actions, a scoped service principal elsewhere), read-only by default, and deployment credentials exist only in the deployment job.
Source: GitHub Docs, Security hardening for GitHub Actions, "Controlling permissions for GITHUB_TOKEN", https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions; OWASP CI/CD Security Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html
Applies to: config

### DR-14 Infrastructure is code in the repository, reviewed and scanned like application code
Why: a server configured by hand cannot be rebuilt, audited or rolled back, and a click in a console leaves no diff for anyone to review. Infrastructure definitions (Terraform, Bicep, Compose, Kubernetes manifests) live in the repository, go through the same pull request and gate, and are scanned for misconfiguration.
Source: OWASP Infrastructure as Code Security Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Infrastructure_as_Code_Security_Cheat_Sheet.html; Microsoft Learn, What is infrastructure as code (IaC)?, https://learn.microsoft.com/en-us/devops/deliver/what-is-infrastructure-as-code
Applies to: config

### DR-15 Every release has a checklist file with each item ticked by a name and an ISO date
Why: "we checked" is not evidence; a checklist ticked by a bot proves nothing. `docs/RELEASE-CHECKLIST.md` (or a per-release copy) lists the gate result, the vulnerability scan, the migration script review, the rollback rehearsal, the changelog and the tag, and each line carries who ticked it and when (`[x] 2026-10-29 Ioan`). It doubles as the test completion record.
Source: ISO/IEC/IEEE 12207:2017, Systems and software engineering, Software life cycle processes, Transition process and Validation process; ISO/IEC/IEEE 29119-3:2021, Software testing, Part 3: Test documentation, Test completion report
Applies to: process

## Files this discipline expects
- `README.md`: the one build-and-test command (DR-01) and the health endpoint paths (DR-08).
- A lockfile next to the dependency manifest, committed (DR-02).
- The pipeline file under `.github/workflows/`, `.gitlab-ci.yml` or `azure-pipelines.yml`: gate, scan, build once, promote, per-job permissions (DR-03, DR-04, DR-06, DR-13).
- `CHANGELOG.md` with a heading per version and a line per requirement id (DR-11).
- `docs/RUNBOOK.md`: rollback command, who may run it, last rehearsal date, where logs and metrics go and who reads them (DR-09, DR-12).
- `docs/RELEASE-CHECKLIST.md`: the ticks by name and date (DR-15).
- `infra/` or an equivalent folder holding every infrastructure definition (DR-14).

## The release checklist file
One copy per release, or one section per version in the same file. A tick without a name and a date does not count.

```
# Release v1.4.0, 2026-10-29
- [x] 2026-10-29 Ioan   Gate green on the release commit (DR-01, DR-04)
- [x] 2026-10-29 Ioan   Vulnerability scan: no high or critical, exceptions listed below (DR-03)
- [x] 2026-10-28 Dana   Migration script reviewed, additive only (DR-10)
- [x] 2026-10-28 Ioan   Rollback rehearsed on staging, command in docs/RUNBOOK.md (DR-09)
- [x] 2026-10-29 Ioan   CHANGELOG.md has a line per requirement id (DR-11)
- [x] 2026-10-29 Ioan   Tag v1.4.0 created and pushed by me (DR-11)
- [x] 2026-10-29 Dana   Logs and metrics visible on the dashboard after deploy (DR-12)
Exceptions: none
```

## What a reviewer checks
- Clone into an empty directory and run the README command; it must build and test with nothing else installed beyond the pinned toolchain (DR-01).
- Open the dependency manifest and the lockfile: no floating ranges, lockfile committed and in sync, vulnerability scan step present with a failing threshold (DR-02, DR-03).
- Read the pipeline file: the gate step is the DR-01 command, every action or image is pinned by SHA, digest or exact version, `permissions` are declared per job and read-only by default (DR-04, DR-13).
- Search the diff, the Dockerfile and the pipeline for keys, passwords and tokens; confirm secrets arrive from the environment or a vault and that a secret scanner runs in the gate (DR-05).
- Confirm one build step produces one versioned artifact and later stages deploy that identifier, never a rebuild; confirm configuration is read from the environment and validated at start-up (DR-06, DR-07).
- Call the health endpoints: liveness returns healthy with the database down, readiness does not (DR-08).
- Read each migration in the diff: additive only, no drop or rename in the same release as the code change, applied before the application step in the pipeline (DR-10).
- Check `CHANGELOG.md` has a line per requirement id under the version, the tag was created by a human, the rollback runbook names a command and a rehearsal date, and the release checklist has names and dates on every tick (DR-09, DR-11, DR-15).

## Scenarios the tester writes
- Given a fresh container with only the pinned toolchain, when the README command runs, then build and tests pass and the lockfile is unchanged afterwards (DR-01, DR-02).
- Given a dependency with a known critical advisory is added, when the pipeline runs, then the vulnerability step fails and names the advisory (DR-03).
- Given the environment lacks a required setting, when the service starts, then it exits non-zero within the start-up phase and the log names the missing setting (DR-07).
- Given the database is unreachable, when `/health/ready` is called, then it returns an unhealthy status while `/health/live` still returns healthy (DR-08).
- Given release N is deployed and the migration for N+1 has run, when release N is redeployed by the rollback command, then every endpoint of release N passes its smoke test against the N+1 schema (DR-09, DR-10).
