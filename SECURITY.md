# Security policy

## Implemented default trust boundary

The current runtime is deliberately narrow.

- `doctor` is read-only and skips symbolic links while scanning.
- `init` writes only beneath an existing, canonical project directory.
- Filesystem root, user home, missing roots, and symbolic-link write segments are rejected.
- Existing files are preserved unless the caller supplies `--force` with an explicit project path.
- Every forced replacement is copied to `.backend-harness/local/backups/` before replacement.
- Task ids are allowlisted and cannot traverse directories.
- A registered tool is checked by a pre-execution gate; denial happens before its function runs.
- `check` uses an explicit `CHECKING` operation; approved tasks use `VERIFYING`.
- A project-wide lock prevents concurrent BTH runs from sharing mutable build/report directories.
- Verification executes only a project-contained, non-symlinked executable declared as an argv array in `verification.json`.
- Git-ignored outcome inputs can be explicitly content-bound without copying their values into the record.
- Gates that may resolve dependencies or use another network resource require `network: true` and explicit `--allow-network`.
- Child processes use `shell: false` and receive an allowlisted environment instead of the entire parent environment.
- `MAVEN_OPTS`, cloud credentials, database URLs, and unrelated parent variables are not inherited.
- Timeout cleanup terminates the spawned POSIX process group, including ordinary descendants.
- Run records contain exact arguments, exit status, timing, byte counts, output hashes, source binding, executable/toolchain metadata, and structured test counts. Shared, persisted, and JSON CLI records omit output tails; interactive failure output may print only the last 8 KiB for diagnosis.
- Shareable and local evidence is structurally redacted for project/home/temp paths, common credential assignments, token shapes, URL user-info, and private-key bodies.
- Gitleaks Pack conversion never copies Gitleaks `Secret`, `Match`, or source-line bodies into BTH Findings.
- Canonical hashes and append-only run history detect cooperative record changes; they are not digital signatures.
- Production databases, deployment systems, credentials, and secret stores have no built-in adapter.
- Generated evidence, locks, staging files, and overwrite backups are ignored by Git.

These controls reduce accidental damage; they are not a sandbox against a malicious repository. `network: true` plus `--allow-network` is a declaration-and-approval latch, not network enforcement. A repository-owned verification executable can still access the network, files available to the user, or commands on `PATH`. Gate executable content is bound, but arbitrary tools it invokes through `PATH` are identified mainly by captured version metadata rather than full content hashes. Review an unfamiliar repository and its toolchain before running `bth check` or `bth verify`.

## Not implemented

- No model provider is connected.
- No model context is sent anywhere; provider integration does not exist.
- No source-editing tool exists.
- No deployment, infrastructure, production database, or managed ephemeral-DB integration exists.
- No operating-system sandbox isolates the build process.
- No local hash proves that a cooperative run record was produced by an untampered machine; trust comes from rerunning the bound input.
- No generic redactor can guarantee detection of every possible proprietary secret format. A project should add its own secret scanner and keep raw logs out of shared evidence.

Do not claim these planned controls as current behavior.

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue with exploit details.
