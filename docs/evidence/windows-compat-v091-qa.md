# Windows compatibility hardening QA

Date: 2026-08-30

## What changed

- Shared Gradle and Maven Gate contracts now keep portable logical commands (`./gradlew`, `./mvnw`).
- Windows execution resolves those commands to `gradlew.bat` and `mvnw.cmd` before source binding, hashing, doctor checks, and execution.
- `.bat` and `.cmd` files launch through `cmd.exe`; unsafe quote, newline, NUL, and percent-expansion input is rejected rather than interpolated.
- Windows timeout handling requests descendant-tree termination with `taskkill /T` and escalates to `/F`.
- Isolated implementation worktrees use `%LOCALAPPDATA%\backend-team-harness` on Windows and retain XDG/home behavior on POSIX.
- A Windows hosted-CI job runs the platform contract suite, doctor, and the real Gradle example Gate.

## Local evidence

- `node scripts/check-syntax.mjs`: passed.
- `npm run test:windows-contract`: 8 passed, 0 failed.
- `node --test test/implementation-orchestrator.test.mjs`: 24 passed, 0 failed.
- `npm run check`: syntax passed; 233 tests passed, 0 failed, and 2 environment-gated real E2E tests were intentionally skipped.
- `git diff --check`: passed.

The launch design was also checked against the official Node.js child-process documentation, which requires Windows batch files to be run through a terminal or by spawning `cmd.exe` directly.

## What this proves

- Windows selection, binding, launch construction, state paths, and timeout escalation are deterministic and testable from a non-Windows development machine.
- Existing POSIX implementation, verification, interview, evidence, and Pack behavior did not regress in the full suite.
- The committed example provides a real Windows Gradle wrapper smoke test in hosted CI instead of relying only on mocked platform branches.

## Remaining boundary

- Local macOS execution cannot prove Windows kernel process-tree semantics, ACL behavior, drive-letter casing, UNC paths, or long-path policy.
- Hosted CI status must be green before wrapper execution is claimed as Windows-verified.
- A native Windows leaked-descendant fixture is still required before `taskkill /T` cleanup is considered fully proven.
