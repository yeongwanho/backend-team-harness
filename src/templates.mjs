const lines = (...values) => values.join('\n') + '\n'

export const sharedTemplates = [
  {
    path: '.backend-harness/project.md',
    content: lines(
      '---',
      'name: replace-with-project-name',
      'owners: []',
      'framework: unknown',
      'build: unknown',
      '---',
      '',
      '# Project',
      '',
      '## Purpose',
      '',
      'Explain the backend service in language a new teammate can understand.',
      '',
      '## Repository boundaries',
      '',
      '- What this repository owns',
      '- What it calls',
      '- What calls it',
      '',
      '## Completion rule',
      '',
      'A task is complete only when its acceptance criteria and deterministic verification evidence agree.'
    )
  },
  {
    path: '.backend-harness/architecture.md',
    content: lines(
      '# Architecture',
      '',
      '## Modules and dependencies',
      '',
      'Document allowed dependency directions and important runtime boundaries.',
      '',
      '## Data ownership',
      '',
      'List the schemas, tables, events, and external contracts owned by this service.',
      '',
      '## Runtime flow',
      '',
      'Describe the main request, batch, and asynchronous flows.'
    )
  },
  {
    path: '.backend-harness/glossary.md',
    content: lines(
      '# Team glossary',
      '',
      '| Term | Meaning | Source |',
      '| --- | --- | --- |',
      '| Example | Replace this row with a domain term | Product policy |'
    )
  },
  {
    path: '.backend-harness/policies/api.md',
    content: lines(
      '# API policy',
      '',
      '- State compatibility and versioning rules.',
      '- Define validation and error-response conventions.',
      '- Record when contract tests are required.',
      '- Treat an undocumented breaking change as blocked.'
    )
  },
  {
    path: '.backend-harness/policies/database.md',
    content: lines(
      '# Database policy',
      '',
      '- Migrations are append-only after release.',
      '- Record data backfill and rollback expectations.',
      '- Review transaction boundaries, indexes, and locking risk.',
      '- Never connect to production by default.'
    )
  },
  {
    path: '.backend-harness/policies/security.md',
    content: lines(
      '# Security policy',
      '',
      '- Authentication and authorization are explicit acceptance criteria.',
      '- Secrets and personal data must not enter model context or evidence.',
      '- External network, deployment, and database actions require human approval.'
    )
  },
  {
    path: '.backend-harness/policies/error-handling.md',
    content: lines(
      '# Error-handling policy',
      '',
      '- Define domain errors separately from infrastructure failures.',
      '- Record retry, timeout, idempotency, and observability requirements.',
      '- Do not hide partial failure behind a successful task state.'
    )
  },
  {
    path: '.backend-harness/workflows/feature.md',
    content: lines(
      '# Feature workflow',
      '',
      '1. Capture requirements, sources, unknowns, and acceptance criteria.',
      '2. Map affected modules, APIs, data, integrations, and tests.',
      '3. Ask a human to approve the change plan.',
      '4. Implement only the approved scope.',
      '5. Run deterministic quality gates.',
      '6. Record verified, unverified, and blocked outcomes.'
    )
  },
  {
    path: '.backend-harness/workflows/bugfix.md',
    content: lines(
      '# Bug-fix workflow',
      '',
      '1. Capture the observed behavior and reproducible evidence.',
      '2. Add or identify a failing regression test.',
      '3. Trace the smallest supported root cause.',
      '4. Implement and verify the fix.',
      '5. Record residual risk and monitoring needs.'
    )
  },
  {
    path: '.backend-harness/workflows/migration.md',
    content: lines(
      '# Migration workflow',
      '',
      '1. Prove the current schema and migration ordering.',
      '2. Define forward, backfill, compatibility, and rollback phases.',
      '3. Check application rollout order.',
      '4. Verify migrations without production access.',
      '5. Preserve execution evidence.'
    )
  },
  {
    path: '.backend-harness/workflows/external-api.md',
    content: lines(
      '# External API workflow',
      '',
      '1. Snapshot the contract and ownership boundary.',
      '2. Define timeout, retry, idempotency, and partial-failure behavior.',
      '3. Add contract fixtures without real credentials.',
      '4. Verify failure paths and safe logging.'
    )
  },
  {
    path: '.backend-harness/quality-gates/api-contract.yaml',
    content: lines(
      'name: api-contract',
      'required: true',
      'checks:',
      '  - request-validation',
      '  - response-compatibility',
      '  - error-contract'
    )
  },
  {
    path: '.backend-harness/quality-gates/database.yaml',
    content: lines(
      'name: database',
      'required: true',
      'checks:',
      '  - migration-order',
      '  - released-migration-immutability',
      '  - transaction-boundary'
    )
  },
  {
    path: '.backend-harness/quality-gates/test.yaml',
    content: lines(
      'name: test',
      'required: true',
      'checks:',
      '  - compile',
      '  - selected-tests',
      '  - regression-evidence'
    )
  },
  {
    path: '.backend-harness/quality-gates/security.yaml',
    content: lines(
      'name: security',
      'required: true',
      'checks:',
      '  - authentication',
      '  - authorization',
      '  - secret-redaction'
    )
  },
  {
    path: '.backend-harness/decisions/README.md',
    content: lines(
      '# Decisions',
      '',
      'Store short architecture decision records here. Include context, decision, consequences, owner, and date.'
    )
  },
  {
    path: '.backend-harness/tasks/README.md',
    content: lines(
      '# Tasks',
      '',
      'Each `bth task create` command creates a shared task folder with a human-readable task, an event log, and a replayable snapshot.',
      'Use `bth interview start` when a raw requirement still needs source-bound acceptance, scope, data, verification, and constraint decisions before plan approval.',
      '',
      'State, decisions, and the redacted `runs/latest.json` summary may be committed for team handoff.',
      '`evidence/` stays local and is ignored because detailed build metadata can contain machine-specific information.'
    )
  },
  {
    path: '.backend-harness/.gitignore',
    content: lines(
      'local/',
      'generated/',
      'tasks/*/evidence/',
      '!tasks/README.md'
    )
  }
]
