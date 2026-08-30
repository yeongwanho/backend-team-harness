# Company-pilot foundations v1.2 QA

## What was tested

- Failing-first regression cases for a contract-free Git repository, Gradle and Maven multi-module report discovery, project-wrapper requirements, generated JUnit ingestion, truthful `doctor`, official Java/Gradle and Java/Maven compatibility boundaries, network-risk CLI language, compatible CRUD fast routing, and no-change retry suppression.
- The complete repository unit/contract suite.
- The Windows launcher contract and adaptive scheduling benchmark.
- Bootstrap-free, no-cache inspection against three private JVM repositories without invoking `init`, build Gates, or implementation providers.
- Package contents, production dependency audit, and diff whitespace.

## What was observed

- Full suite: 291 tests, 289 passed, 0 failed, 2 explicit opt-in tests skipped by the default suite.
- Opt-in real JVM suite: 3/3 passed, including Maven `verify` with real JUnit and an isolated cold-cache Gradle Wrapper run.
- GitHub CI real MySQL/Testcontainers suite passed on Linux with Docker.
- Windows contract: 8/8 passed.
- Adaptive benchmark: all 3 Gates retained; analytical speedup 3.612661318451343x.
- Production dependency audit: 0 vulnerabilities.
- A compatible single-module CRUD claim selected the 2,000-character/low-effort fast profile; migration and incompatible public-API claims still selected deep.
- A successful provider call that produced no source change stopped after one attempt, recorded `implementation_no_source_change`, and executed no Gate.
- A contract-free private multi-module repository completed read-only inspection with `verification.status=missing`, `inferredFromSource=true`, and no false healthy result.
- Module-aware inference produced separate JUnit paths for both detected test modules on each inspected multi-module repository.
- One private repository was correctly blocked for an incompatible active Java/Gradle-wrapper pair; another compatible pair remained ready.
- No private repository was initialized, built, tested, or modified by this QA.

## Why this is enough for this change

The regression cases directly reproduce the pilot's three P0 boundaries: first-run inspection, truthful JVM/multi-module verification discovery, and honest network authority. Private read-only inspection proves the first two on non-fixture repository structures without copying private material into this repository. The full suite covers existing provider, task, evidence, source-binding, and verification behavior.

## What remains unproven

- The real MySQL suite passed in GitHub CI; it was not repeated on the local host whose Docker storage was previously unavailable.
- Windows behavior is contract-tested in CI-compatible code but was not driven on a physical Windows host in this local run.
- BTH still does not provide operating-system egress isolation; the CLI and records now state that explicitly.
- Broad natural-language impact ranking on private work items is not claimed improved by this change; it requires a reproducible, share-safe gold set rather than another synthetic assertion.
- Fast implementation still runs every required Gate after a real change. Safe module-targeted test selection remains unproven and is not enabled by this change.
