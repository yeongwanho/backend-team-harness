# Backend Team Harness contribution guide

This repository is an evidence-driven backend engineering workflow harness. Model-provider adapters are future work, not a current runtime capability. Keep the core free of company-specific policies, credentials, internal URLs, tickets, and source code.

## Working rules

- Preserve the boundary between the generic core, framework adapters, and project-owned packs.
- Prefer deterministic inspection and verification over model claims.
- Every `confirmed` result must be bound to Git source and fresh machine-readable test results.
- Treat missing or conflicting policy as `unknown`; never invent a decision.
- Keep inspection commands read-only. Every source/config write must be explicit, project-contained, symlink-safe, and recoverable. Detached implementation workspaces are the sole exception: keep them under an ownership-checked per-user state root, bind them to one project/task, and provide an audited removal path.
- Never add deploy, production database, or secret-reading behavior to a default workflow.
- Add tests for every state transition, permission boundary, and failure mode.

## Initial commands

- `bth init [path]`: create the shared `.backend-harness` contract without overwriting existing files.
- `bth doctor [path]`: inspect a backend repository and report missing foundations.
- `bth task ...`: persist and advance a reviewable backend task state.
- `bth check [path]`: run the project-declared gates once and keep a local run record.
- `bth verify <id> [path]`: run the same gates for an approved task and persist a shared, source-bound run record.
