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
- Verification executes only a project-contained, non-symlinked executable declared as an argv array in `verification.json`.
- Child processes use `shell: false` and receive an allowlisted environment instead of the entire parent environment.
- `MAVEN_OPTS`, cloud credentials, database URLs, and unrelated parent variables are not inherited.
- Timeout cleanup terminates the spawned POSIX process group, including ordinary descendants.
- Run records contain exact arguments, exit status, timing, byte counts, output hashes, source binding, and structured test counts. Shared and persisted records omit output tails; the active CLI result keeps only the last 8 KiB to diagnose a failure.
- Production databases, deployment systems, credentials, and secret stores have no built-in adapter.
- Generated evidence, locks, staging files, and overwrite backups are ignored by Git.

These controls reduce accidental damage; they are not a sandbox against a malicious repository. A repository-owned verification executable can still access the network, files available to the user, or commands on `PATH`. Review an unfamiliar repository before running `bth check` or `bth verify`.

## Not implemented yet

- No model provider is connected.
- No model-context redaction or minimum-context pipeline exists yet.
- No source-editing tool exists.
- No deployment, infrastructure, production database, or managed ephemeral-DB integration exists.
- No operating-system sandbox isolates the build process.
- No local hash proves that a cooperative run record was produced by an untampered machine; trust comes from rerunning the bound input.

Do not claim these planned controls as current behavior.

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue with exploit details.
