# v36 — source-bound preservation feedback

## Why

The retained v35 Petclinic candidate passed ordinary tests while introducing an
unguarded relationship collection write. A separate controller/JPA probe proved a
foreign owner's row moved. The candidate and original scores must remain intact.
Direct implementations also failed Spring JavaFormat before JUnit, but recovery
received no actionable typed formatter locations.

## Scope and truthfulness

Implement a bounded Java/JPA structural preservation check, not an authorization
analyzer. Recognized relationship collections, direct getters and direct writes
inside `if` branches can expose changed guard structure. A new write lacking a
previous guard requires review/recovery; equivalent but differently expressed
guards may also require review. A clear result only means this narrow check found
no drift. It never replaces behavioral tests or grants test-skipping authority.
No full repository scan, company source upload, project build, database call or
provider invocation is part of the check. Ordinary non-Java changes skip parsing.

## Edit and verification units

1. `test/execution-diagnostics.test.mjs`, `src/core/execution-diagnostics.mjs`:
   failing-first contextual Spring JavaFormat diagnostics; preserve null locations,
   strip messages/commands, validate local paths and bounded reprojection. Replay
   the actual retained formatter failure without changing the candidate.
2. `package.json`, lockfile; `src/adapters/java-preservation.mjs` and its tests:
   inspect the pinned maintained Java CST parser, audit dependencies, lazy-load it
   only for changed Java inputs. Parse structure rather than comments/strings.
   Compare source-hashed bounded inputs, guarded direct relationship writes and
   expose unsupported/capped analysis honestly. Test synthetic non-Petclinic
   collections, altered guards, unchanged writes, strings/comments and limits.
3. `src/core/implementation-preservation.mjs` and tests: source-bound, path-safe
   changed-file loading from immutable Git base and candidate; bounded diagnostics
   without source bodies. Fail safely on inability to inspect selected inputs.
   Measure no-Java and Java cold/warm overhead; do not add full-repository work.
4. `src/runtime/implementation-orchestrator.mjs`, recovery projection and tests:
   compact pre-implementation preservation instruction; check candidate before
   expensive tests, feed review findings into existing bounded retry budget, and
   certify only after restored structure plus normal required gates. Legacy v1
   request fields stay unchanged. Recheck previously passed candidates.
5. `src/runtime/implementation-apply.mjs` and orchestration tests: independently
   recheck old sealed passed candidates before staging or source mutation. Prove
   recovery and no source write when drift is unresolved.
6. `scripts/check-preservation-candidate.mjs`, evidence artifacts/report: read-only
   checks of retained v35 failing candidate and historical legitimate target;
   synthetic isolated workflow recovery, actual formatter replay and overhead.
   Preserve old scores, records, source snapshots and candidate bytes.
7. README, CHANGELOG and evidence: precise limitations; syntax, focused tests,
   complete regression suite, mutation checks and dependency audit. Record every
   omission. Commit/push only this reviewed change. The larger 3-repo/20-task goal
   remains active; neither this check nor mock-provider tests establish success@1.

## Non-goals

No new CLI knobs for arbitrary bypass, no claim of full semantic ownership safety,
no hidden evaluator tests in provider input, no hand-repair of scored candidates,
no test skipping based on lexical analysis, no paid benchmark until the runtime
change has local failure/recovery evidence.

## Parser decision after installation QA

The first `java-parser@3.0.1` experiment found vulnerable lodash dependencies.
Root overrides plus shrinkwrap passed local audit but did **not** protect the
installed consumer (installation smoke observed lodash-es 4.17.21). Rejected that
approach, removed java-parser/overrides/shrinkwrap, restored package-lock, and
selected pinned `web-tree-sitter@0.26.11` plus the unmodified, hash-checked MIT Java
grammar WASM from `tree-sitter-java@0.23.5`. No native addon/install hook is shipped.
Additional files: `vendor/tree-sitter-java/{tree-sitter-java.wasm,LICENSE,README.md}`;
`scripts/install-smoke.mjs` must parse a synthetic guard from the actual installed
tarball and audit its installed dependencies. Runtime and all tests must be rerun
after the parser replacement; earlier CST timing/results are superseded.

`scripts/benchmark-provider-comparison.mjs` advances new-run protocol identity to
`preservation-runtime-v36`, so resuming a benchmark cannot reuse pre-guard runtime
results as this runtime's measurements. Historical artifacts remain untouched.
