# Changelog

This project follows Semantic Versioning after 1.0. Before 1.0, every incompatible CLI or stored-contract change is called out explicitly.

## Unreleased

### Added

- Opt-in schema-v2 project formatting between implementation and verification. Declared commands/configs must be source-bound verification inputs; private bounded backups, changed-file-only postchecks, process timeouts and no blind provider retry on formatting failure. See `docs/PROJECT-FORMATTING.md`. This is not an OS sandbox or a whitespace-only semantic guarantee.

- Bounded changed-Java relationship guard review with a pinned, hash-checked portable grammar. Exact-candidate review acknowledgement and a non-secret rationale can be recorded in the apply receipt; incomplete inspection cannot be waived. This is not semantic authorization proof. See `docs/evidence/provider-preservation-v37.md`.
- File-only Spring JavaFormat diagnostics survive bounded recovery without invented line numbers, source excerpts or log-provided commands.

- Explicit, offline/no-build uv workspace preparation for a uniquely selected Python test project, with bounded TOML parsing, declared root/member lock inputs and optional numeric Python selection. See `docs/evidence/python-workspace-v32.md` for real FastAPI execution and remaining baseline failures.
- Independent pinned NestJS file mapping / resolved-observable acceptance controls, with offline no-lifecycle-script dependency installation in disposable evaluator clones. The empty ordinary unit-test baseline is still not provider-ready.
- `bth work` source-bound plan and isolated implementation flow.
- Explicit, sealed, rollback-capable `bth implement apply`.
- Source-cited convention compilation and MySQL/JPA review signals.
- Changed-path feedback Gates followed by conservative full verification.
- Normalized provider token, cost, duration, and turn telemetry.
- Coverage thresholds, mutation smoke, package install smoke, and CLI documentation contract tests.
- Explicit schema v1 to v2 implementation-config migration with backup.

### Changed

- Fixed the v36 regression that treated observed guards as immutable policy and skipped tests on an intended guard change. Required tests now run; a real failure still uses bounded repair, while passed tests with changed conditions produce `implementation-needs-review` without a blind model retry. Historical sealed records are rechecked without rewriting them.
- Added real Codex pet/visit comparisons and a zero-model historical-target replay with 76 JVM tests before and after acknowledged integration. The model comparisons do not demonstrate a speed or token advantage; their first-attempt failures are preserved.
- Public evaluation protocol `behavioral-oracle-v35` accepts implementation-independent localized visit validation and adds a cross-owner JPA regression to the pet-update oracle. A real BTH candidate passed the earlier four cases but changed another owner's row; it is not an acceptable apply candidate. Historical first-attempt records remain unchanged. See `docs/evidence/corpus-expansion-v35.md`.
- Model-free visit controls release each completed temporary variant and preserve partial results after later preparation failures. This reduces peak copied Git history; it does not change implementation-provider runtime or claim a general speed improvement.
- Test pairing recognizes Python prefixes, scopes duplicate names by module/language and package/directory hints, and leaves ambiguous or over-budget buckets unresolved. Test-only annotations and DB signals no longer contaminate production convention observations.
- Provider input removes only exactly duplicated generated context fields after artifact and renderer checks. Approved plans and custom human context remain intact. The v34 real Codex comparison still does not demonstrate a latency advantage; see `docs/evidence/provider-context-correctness-v34.md`.
- Generated pytest verification uses an already-prepared project/workspace environment and the backend working directory; it no longer implicitly runs `uv run`. Python `doctor` lookup recognizes normal interpreter symlink leaves while rejecting linked environment directories, and labels presence checks as unprobed imports/tests.
- Code-context retrieval splits snake_case/acronyms, distinguishes explicitly named identifier ownership, and retains only query matches in memory. The known 20-task comparison improves on average but still has per-task losses; no end-to-end provider speed claim is made. See `docs/evidence/identifier-retrieval-v28.md`.
- Generated Jest verification rejects unknown assertion states, contradictory counts, interrupted/runtime-error suites and stale raw JSON. It preserves skipped/todo results, omits failure-message bodies, bounds conversion and refuses linked report paths. The exact generated runner is exercised by the Nest controls.
- Provider implementation now preserves observed adjacent project conventions even on small CRUD work.
- Shared records redact additional provider tokens, auth/cookie material, email addresses, and raw source-bearing fields.

### Compatibility

- `record.status: passed` continues to describe required verification, not approval to integrate. Status/run results now expose separate `preservationReview` and current `nextAction` fields; `bth work` uses `implementation-needs-review`. CLI `work`, `implement run/status` return exit code 2 for pending/unavailable structural review.
- Applying a reviewed guard change requires `--accept-preservation-review <current-sha256> --review-note <text>` in addition to actor/write approval. Stale candidates, changed source and incomplete inspection remain blocked. Existing seals, legacy schema-v1 request fields and normal apply without a pending review are preserved.
- New paired provider runs use protocol `reviewable-preservation-v37`; v36 and earlier records remain historical and are not reused as new-runtime results. These are controlled one-implementation experiments, not unrestricted native CLI end-to-end benchmarks.

- `workspacePreparation.kind: "uv-sync-offline"` and `pythonVersion` require an updated BTH schema-v2 reader. Existing contracts are not overwritten. Poetry/PDM environments remain reusable without automatic installation. Provider benchmark protocol `python-workspace-v32` has new generated-runner hashes; earlier comparison records are historical, not silently interchangeable.
- Existing project-owned `.backend-harness/bin/verify-portable.mjs` files are not replaced by a package update or ordinary `bth init`. Review regenerated runners in a disposable copy before applying this fix; `init --force` also replaces other shared files and is not a runner-only updater. See `docs/evidence/nest-verification-v25.md`.
- Evaluator acceptance configuration now supports `node <pinned-test-file>` using its own Node runtime, with no flags, extra arguments, or PATH-based executable resolution. Other gate executable rules are unchanged.
- Schema v1 command adapters remain readable.
- `--allow-network` remains a deprecated alias for `--acknowledge-network-risk` during the pre-1.0 compatibility window.
- No command in this release automatically commits, pushes, deploys, or accesses a production database.
