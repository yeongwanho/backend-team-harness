# Built-in provider v1.1 QA evidence

Date: 2026-08-30
Branch: `codex/builtin-provider-v11`
Base commit: `09028a3`

## Claim under test

BTH can use an already signed-in local Codex or Claude Code CLI to implement a human-approved task in a detached worktree, enforce a bounded request and write policy, run every configured verification Gate, and leave the original bound source unchanged. Provider output is evidence, never PASS authority.

## Automated verification

- `npm run check`: 277 tests; 275 passed, 0 failed, 2 opt-in Docker/JVM tests skipped.
- `npm run test:windows-contract`: 8 passed, 0 failed.
- `npm audit --omit=dev --json`: 0 vulnerabilities reported.
- `npm run benchmark:adaptive`: 3/3 Gates preserved; analytical speedup 3.6127 on its fixture.
- `npm pack --dry-run --json --silent`: package assembly succeeded; 135 files, 264,786-byte tarball, 811,484 bytes unpacked.
- `git diff --check`: no whitespace errors.

These commands cover unit, integration, configuration, Windows command-wrapper contracts, package contents, dependency advisories, and the existing analytical benchmark. The two skipped tests require their explicit real Docker/JVM opt-in and are not counted as passes.

## Real provider path

### Codex

- CLI identity: `codex-cli 0.151.0`.
- Disposable synthetic Java repository; one approved source file under `src/`.
- Full orchestration duration: 28.754 seconds.
- Result: `GreetingService.java` created; one configured Gate and one test passed; original source fingerprint unchanged.
- Request evidence: 1,590 bytes, SHA-256 sealed and unchanged after the provider exited.
- Provider-reported usage: input 97,449; cached input 82,688; output 739; reasoning 74.

The first live attempt found a real compatibility bug: this Codex version rejects `--sandbox workspace-write` together with `--approve-for-me`. The invocation now uses the latter documented approval mode without a dangerous bypass flag, and the complete orchestration then passed.

An independent Claude review later found that the original quoted `model_reasoning_effort="low"` value could not pass the harness's safe Windows `.cmd` encoder. The value is now sent as `model_reasoning_effort=low`; a direct call to the installed Codex CLI accepted that form and returned `OK`, and a regression test passes the complete generated argv through the Windows command-shim launcher.

### Claude Code

- CLI identity: `2.1.239 (Claude Code)`.
- Separate disposable synthetic Java repository; one approved source file under `src/`.
- Full orchestration duration: 12.156 seconds.
- Result: `FarewellService.java` created; one configured Gate and one test passed; original source fingerprint unchanged.
- Request evidence: 1,603 bytes, SHA-256 sealed and unchanged after the provider exited.
- Provider-reported usage: input 6; cache creation 13,849; cache read 80,424; output 316; cost $0.0757858 under a configured $0.30 ceiling.

The first live attempt exposed another real boundary bug: filtering `USER` and `LOGNAME` made the installed Claude CLI fail its local login lookup. Those identity-only variables are now retained while credential and API-key values remain excluded; the complete orchestration then passed.

## Failure and boundary checks

Focused tests prove unavailable providers fail before task/workspace mutation, Windows resolves an npm `.cmd` shim before an extensionless POSIX shim, required Windows/XDG login-path variables survive the credential filter, oversized task text fails closed, request modification is detected, provider errors including a real-world `401 Unauthorized` form are reduced to safe diagnostic classes, non-retryable provider failures stop after one attempt, schema-v1 command adapters still receive their original request contract, protected control-plane edits fail, no-source-change cannot become verified, and full configured Gates still run after a valid edit.

The implementation is process isolation plus evidence and policy enforcement, not an OS security sandbox. Project-owned Gate executables remain trusted code. It performs no automatic commit, merge, deployment, production database access, or task transition to `VERIFIED`.

## Honest residuals

- The successful real runs used small synthetic Java repositories, not two independently maintained production backends.
- BTH request size is bounded, but provider-owned system/tool/cache context can dominate total tokens.
- Claude supports a dollar ceiling; the tested Codex CLI exposes no equivalent dollar-budget option.
- Windows provider argv and wrapper behavior are contract-tested, but the real Codex/Claude implementation path has not run on a Windows host in this change.
- Lightweight non-writing question routing and monorepo subdirectory implementation remain roadmap work.

## Independent review disposition

Claude and Grok were asked open-endedly to inspect the uncommitted implementation rather than confirm a proposed verdict. Findings are accepted only when they match code, tests, or live behavior. Claude findings led to Windows shim precedence, task-size bounds, authentication-environment handling, safe failure diagnostics, the real CLI runs above, the Windows Codex quoting regression test, and a real fixture spawn through `runImplementationProvider`. Its warning about truncated single-document usage JSON led to a provider-only 64 KiB capture tail plus a numeric allowlist fallback; raw prose is still discarded.

Grok's deeper pass identified three additional contract defects that were reproduced against the code: the richer provider request had unintentionally replaced the schema-v1 command-adapter request, Windows/XDG config-location variables were absent from the filtered login environment, and `401 Unauthorized` plus other non-retryable provider failures could consume the second attempt without any repair opportunity. The final implementation preserves the old request shape, retains only location/identity variables rather than credentials, recognizes the additional authentication form, and stops authentication/budget/rate/CLI-compatibility failures after one recorded attempt. Its speculation that unquoted `model_reasoning_effort=...` would fail TOML parsing was rejected because the installed Codex 0.151.0 accepted the exact argv in a live invocation; keeping quotes would instead break the safe Windows `.cmd` launcher.

Raw provider transcripts are deliberately not persisted because they may contain source or secrets; bounded numeric fields and output byte/hash evidence are retained instead.
