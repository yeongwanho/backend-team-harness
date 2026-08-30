# Evidence contract

## Why three tiers exist

The harness must distinguish “a process actually exercised behavior” from “a tool reported an interpretation”. Both are useful, but they cannot carry the same authority.

| Tier | Examples | May create PASS? | May block PASS? |
| --- | --- | --- | --- |
| `EXECUTED` | fresh JUnit, compile/migration exit | JUnit only, with all verdict conditions | yes |
| `REPORTED` | Gitleaks, static policy, import graph, coverage summary | no | `findings` may; `observation` may not |
| `CONTROL` | permission denial, unsafe executable, registry/pre-result failure | no | records why execution did not produce evidence |

An empty or clean `REPORTED` result never compensates for missing tests.
`CONTROL` is deliberately separate from `EXECUTED`: a guard working correctly proves the harness stopped an unsafe action, not that the backend behavior ran.

## Scheduling is provenance, not evidence

A sealed run records configured order, selected order, per-Gate signature, observation count, Beta-smoothed failure probability, mean duration, score, segment boundary, and optimizer history status. This explains why an eligible Gate moved.

The local history contains aggregates only: signature, Gate id, sample/failure counts, total duration, and last observation time. It is not an evidence tier. It may select order but may not change a process result, parsed report, evidence authority, source binding, executed-test count, or final verdict. Missing or corrupt history falls back to configured order; a corrupt file is not overwritten implicitly. A run whose source changes during verification is never learned into the optimizer. At the 512-signature bound, the least recently observed obsolete signature is evicted while signatures observed by the current run are retained.

## Freshness

Before a result-producing Gate starts, BTH removes prior files matched by that Gate's declared report patterns, then snapshots the now-empty owned report set. After the process exits, only newly generated reports are ingested. This prevents an old valid XML file from becoming “fresh” through `touch` alone. Configuration rejects project-root patterns, exact collisions, and wildcard trees with the same or nested fixed base. The purge first asks Git to prove every existing match is untracked and ignored; a tracked or merely untracked source file is never deleted. Projects must give every Gate its own ignored report directory.

JUnit parsing uses a strict XML parser. DTD and ENTITY declarations, malformed XML, summary-only files without testcase elements, zero executed tests, failures, errors, and all-skipped suites fail closed.

## Source binding

A binding contains:

- Git `HEAD` as provenance, project path, and a project-scoped HEAD manifest digest as identity
- status and binary-diff digests
- untracked path/content hashes
- hashes for declared `inputs`, even when Git ignores them
- one canonical aggregate fingerprint plus an exact 0.7 compatibility fingerprint during the upgrade window

Task/local/generated runtime output is excluded so recording or committing a shared run does not invalidate it. Gate executables, verification config, wrapper files, and declared ignored inputs remain bound. Untracked/declared hashing fails closed above the documented per-file and aggregate bounds.

## Toolchain binding

Run records include:

- Node, platform, and architecture
- Java availability/version hash when a JVM wrapper is used
- Gradle/Maven wrapper versions when wrapper properties exist
- SHA-256 and byte size of every Gate executable
- source-bound declared profile and database dialect

The declared context is not presented as machine-discovered fact. It tells a reviewer which intended test profile/dialect the executable Gate must enforce.

## Storage and hashing

Every run writes immutable history first and atomically replaces `latest.json` second. Hashes use canonical JSON with recursively sorted object keys. Hashes are cooperative integrity fingerprints, not signatures or remote attestation.

Detailed task evidence stays local and Git-ignored. The redacted task `runs/latest.json` summary is designed only for the final team handoff: when the detailed file is absent on another clone, `VERIFIED -> DONE` may use that summary after validating its seal, task id, evidence id, EXECUTED tier, passed verdict, stable pre/post source fingerprint, positive executed-test count, and every required Gate. `VERIFYING -> VERIFIED` still requires local detailed evidence. A present but altered detailed evidence file never falls back silently. The seal detects accidental or unreviewed content alteration; it is not a trusted-runner signature. A contributor who controls both repository content and execution records can forge local evidence, so hostile-author assurance requires a separate trusted CI signature or attestation policy.

Shareable records omit output tails and redact:

- project, home, and temporary absolute paths
- common password/secret/token/API-key assignments
- GitHub/AWS/JWT token shapes
- URL user-info credentials
- private-key bodies

Raw build output is not copied into evidence or JSON CLI output. Interactive failure output may print only an 8 KiB tail for immediate local diagnosis.

## Reproduction

The authoritative proof remains re-execution. `rerun` in the record contains the CLI argv, including `--allow-network` when a declared Gate needed it. A second machine should compare verdict, source fingerprint, executed counts, Gate outcomes, and tool versions—not timestamps, durations, or output hashes that may legitimately differ.

Adaptive order may also legitimately differ when the two machines have different local aggregate histories. Reviewers should compare the recorded schedule and confirm that Gate identities, segment constraints, and PASS-path completeness are preserved.
