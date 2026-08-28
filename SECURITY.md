# Security policy

## Default trust boundary

The harness must be safe to run against an unfamiliar backend repository.

- Repository inspection is read-only unless a human explicitly approves a write phase.
- Shell execution is allowlisted by workflow and records the exact command and exit code.
- Production databases, deployment systems, credentials, and secret stores are outside the default boundary.
- Model providers receive only the minimum redacted context required for the current decision.
- Generated local context is ignored by Git by default.

Please report security issues privately to the repository owner instead of opening a public issue with exploit details.

