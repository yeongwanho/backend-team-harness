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

## Freshness

Before a result-producing Gate starts, BTH snapshots matching files by path, size, mtime, ctime, and content hash. After the process exits, only new or changed reports are ingested. A matching but unchanged report is stale, and a fresh/stale mixture also fails the Gate rather than ignoring an old sibling report.

JUnit parsing uses a strict XML parser. DTD and ENTITY declarations, malformed XML, summary-only files without testcase elements, zero executed tests, failures, errors, and all-skipped suites fail closed.

## Source binding

A binding contains:

- Git `HEAD` and project path in the worktree
- status and binary-diff digests
- untracked path/content hashes
- hashes for declared `inputs`, even when Git ignores them
- one canonical aggregate fingerprint

Task/local/generated runtime output is excluded so recording a run does not invalidate it. Gate executables, verification config, wrapper files, and declared ignored inputs remain bound.

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

Shareable records omit output tails and redact:

- project, home, and temporary absolute paths
- common password/secret/token/API-key assignments
- GitHub/AWS/JWT token shapes
- URL user-info credentials
- private-key bodies

Raw build output is not copied into evidence or JSON CLI output. Interactive failure output may print only an 8 KiB tail for immediate local diagnosis.

## Reproduction

The authoritative proof remains re-execution. `rerun` in the record contains the CLI argv, including `--allow-network` when a declared Gate needed it. A second machine should compare verdict, source fingerprint, executed counts, Gate outcomes, and tool versions—not timestamps, durations, or output hashes that may legitimately differ.
