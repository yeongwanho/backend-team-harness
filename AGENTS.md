# Backend Team Harness contribution guide

This repository is an evidence-driven backend engineering workflow harness. Model-provider adapters are future work, not a current runtime capability. Keep the core free of company-specific policies, credentials, internal URLs, tickets, and source code.

## Working rules

- Preserve the boundary between the generic core, framework adapters, and project-owned packs.
- Prefer deterministic inspection and verification over model claims.
- Every `confirmed` result must carry machine-verifiable evidence.
- Treat missing or conflicting policy as `unknown`; never invent a decision.
- Keep inspection commands read-only. Every write command must be explicit, project-contained, symlink-safe, and recoverable.
- Never add deploy, production database, or secret-reading behavior to a default workflow.
- Add tests for every state transition, permission boundary, and failure mode.

## Initial commands

- `bth init [path]`: create the shared `.backend-harness` contract without overwriting existing files.
- `bth doctor [path]`: inspect a backend repository and report missing foundations.
- `bth task ...`: persist and advance a reviewable backend task state.
- `bth verify <id> [path]`: run the project wrapper in offline mode and persist machine evidence.
