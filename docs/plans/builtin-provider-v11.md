# Built-in provider implementation v1.1 plan

## Outcome

Make `bth implement run` usable without a project-authored wrapper by adding explicit, bounded Codex and Claude Code CLI providers. Preserve the existing detached-worktree, human approval, write-policy, full-Gate verification, and no-commit/no-merge boundaries.

## Contract changes

1. Extend `implementation.json` without breaking schema-v1 command adapters. A schema-v2 adapter is either `command` or `provider`; provider ids are limited to `codex` and `claude`.
2. Add an explicit `bth implement configure <codex|claude>` command. It may write only `.backend-harness/implementation.json`, refuses overwrite without `--force`, and records a recoverable local backup.
3. Add a read-only provider status command that resolves the CLI through `PATH`, executes only `--version`, and records no credentials or environment values.
4. Provider execution uses `shell: false`, the existing bounded process runner, the detached task worktree, filtered environment, and no dangerous sandbox-bypass flag.

## Context and cost control

1. `auto` chooses only among `fast`, `balanced`, and `deep`; explicit mode overrides remain available.
2. Structured interview claims can raise the mode. Unknown/manual plans default to `balanced`, never `fast` by optimistic inference.
3. Each profile has a bounded code-context character budget and provider effort. The request contains the approved plan, allowed write prefixes, bounded graph context, authority limits, and only the previous compact failure summary.
4. The agent is told that BTH owns the full Gate run, to start from ranked paths, avoid broad repository reads, never commit, and never alter verification control files.
5. Record selected profile, context size, provider CLI identity/version, process bytes/duration, and numeric usage fields when a provider emits them. Do not turn token/cost telemetry into PASS authority.

## Files

- `src/config/implementation.mjs`, `src/config/implementation-setup.mjs`: dual command/provider schema and guarded configure writer.
- `src/providers/model-cli.mjs`: provider discovery, safe argv, prompt, profile, and usage parsing.
- `src/runtime/implementation-orchestrator.mjs`: bounded request/context and provider execution.
- `src/cli.mjs`, `src/templates.mjs`: configure/status UX and safe defaults.
- focused tests for configuration, provider argv, orchestration, CLI, permissions, and failure paths.
- `README.md`, architecture/roadmap/evidence documents.

## Verification

- failing-first focused tests for schema, CLI argv, explicit approval, missing provider, no-bypass flags, context caps, auto-mode escalation, and mock provider edits;
- `npm run check`, Windows contract, package dry-run, audit, and analytical benchmark;
- local version probes plus user-authorized real Codex and Claude model runs on disposable synthetic Java repositories;
- independent open-ended Claude and Grok review, followed by evidence-backed fixes rather than automatic acceptance.

## Non-goals

- no deployment, production DB, commit, merge, PR, secret ingestion, hosted provider API implementation, autonomous plan approval, or partial-test result presented as full verification;
- no claim that bounded context equals minimal tokens or that one provider is universally best.
