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
- The only default executable tool selects a project-owned Gradle/Maven Wrapper and passes a fixed offline argument array.
- Child processes use `shell: false` and receive an allowlisted environment instead of the entire parent environment.
- Evidence records exact arguments, exit status, timing, byte counts, and output hashes. Raw build output is not persisted.
- Production databases, deployment systems, network-capable tools, arbitrary shell commands, credentials, and secret stores have no default tool registration.
- Generated evidence, locks, staging files, and overwrite backups are ignored by Git.

These controls reduce accidental damage; they are not a sandbox against a malicious repository. A repository-owned build wrapper and build scripts are executable code. Review an unfamiliar repository before running `bth verify`.

## Not implemented yet

- No model provider is connected.
- No model-context redaction or minimum-context pipeline exists yet.
- No source-editing tool exists.
- No deployment, infrastructure, or database integration exists.
- No operating-system sandbox isolates the build process.

Do not claim these planned controls as current behavior.

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue with exploit details.
