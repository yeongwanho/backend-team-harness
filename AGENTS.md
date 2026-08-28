# Backend Team Harness contribution guide

This repository is a provider-neutral backend engineering harness. Keep the core free of company-specific policies, credentials, internal URLs, tickets, and source code.

## Working rules

- Preserve the boundary between the generic core, framework adapters, and project-owned packs.
- Prefer deterministic inspection and verification over model claims.
- Every `confirmed` result must carry machine-verifiable evidence.
- Treat missing or conflicting policy as `unknown`; never invent a decision.
- Keep commands read-only by default. Require explicit approval before source edits.
- Never add deploy, production database, or secret-reading behavior to a default workflow.
- Add tests for every state transition, permission boundary, and failure mode.

## Initial commands

- `bth init [path]`: create the shared `.backend-harness` contract without overwriting existing files.
- `bth doctor [path]`: inspect a backend repository and report missing foundations.

