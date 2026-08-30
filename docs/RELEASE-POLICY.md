# Release and compatibility policy

## Versioning

- Releases before 1.0 may change unstable contracts, but every incompatibility must appear in `CHANGELOG.md` with a migration path.
- From 1.0 onward, public CLI commands, JSON output schemas, committed `.backend-harness` contracts, and sealed record readers follow Semantic Versioning.
- A stored schema reader remains available for at least one minor release after its replacement. Writers emit only the newest schema.

## Required release evidence

1. `npm run check`
2. `npm run test:coverage`
3. `npm run test:install`
4. Ubuntu real JVM and MySQL jobs
5. Windows contract job; an authenticated real-provider Windows pilot is reported separately and is never implied by the fixture job
6. `CHANGELOG.md` and migration notes updated

## Backward compatibility

- Removing or renaming a CLI command, JSON field, or committed file requires a deprecation window or a major version after 1.0.
- A migration creates a local backup before rewriting a project contract and is idempotent.
- Evidence seals are never silently reinterpreted. A compatibility fingerprint or explicit re-verification is required.

## Honest limitations

Passing CI does not prove an authenticated Codex or Claude session on every developer machine. Windows provider, cancellation, onboarding, and two-developer handoff pilots must publish the exact host, CLI version, commands, and observed result before being marked complete.

An authenticated developer-machine pilot is opt-in and disposable:

```powershell
$env:BTH_REAL_PROVIDER = "codex" # or claude
$env:BTH_PROVIDER_PILOT = "I_UNDERSTAND"
npm run pilot:provider
```

It copies only the public synthetic Spring fixture to an OS temporary directory, spends at most one provider attempt, never applies the candidate to this repository, prints a redacted report, removes the isolated worktree, and deletes the fixture. Run it once per provider on the real Windows host; a skipped or unauthenticated result is not a pass.
