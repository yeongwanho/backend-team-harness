# v38 — project-owned formatting before verification

The goal remains the three-independent-backend / twenty-task comparison. This
iteration addresses an observed product failure: both v37 visit candidates failed
the project's Java format gate before any tests ran. It is not a claim of general
model superiority, and the failed first-attempt records remain immutable.

## Implementation and verification units

- [x] Add failing config/setup tests for optional schema-v2 `formatting`:
  project-owned argv, explicit network declaration, bounded timeout and declared
  config inputs; null/absent opt-out; preserve settings across provider changes.
- [x] Add failing end-to-end tests: one implementation invocation, deterministic
  formatting, then fresh tests; no-change skips formatting and tests; no default
  formatting; protected inputs/network refuse before execution; formatting errors
  stop without consuming model retries; added/deleted/out-of-scope files or Git
  tampering cannot be certified or applied.
- [x] Implement `src/core/workspace-formatting.mjs` and config validation. All
  formatter executable/config inputs must already be source-bound verification
  inputs, including ignored files. No guessed commands or automatic dependency
  installation. Use existing Windows launcher mapping and process-tree runner.
- [x] Integrate into `implementation-orchestrator.mjs` after the provider's write
  and integrity checks, before snapshots and verification. Reuse a factored
  boundary check. Snapshot bounded pre-format files into private local backups.
  Only paths already changed by the provider may change; file kinds/modes must
  remain unchanged. Recheck control inputs, requests, Git refs/HEAD/index and write
  budgets afterward. Failed formatting stops; integrity failures require reset.
- [x] Document explicit JSON setup, backup/privacy limits and `network: false`
  as a declaration, not OS-enforced egress isolation. Do not add more CLI flags.
- [x] In a fresh public-project copy replay the preserved v37 visit candidate,
  not historical target code. Execute its declared pinned Maven formatter, fresh
  ordinary tests and the independent acceptance oracle. Record time, tests, changed
  paths and zero model calls. Keep replay distinct from success@1/provider pairs.
- [x] Run full coverage, curated mutation, install, documentation and Windows
  contract checks; inspect the final diff and record evidence for publication.
  Actual Windows/Claude/MySQL and missing corpus tasks remain unverified.

Publication is verified separately against the remote Git SHA in the task handoff,
not inferred from these checkboxes. This iteration is progress, not overall goal
completion. The actual replay reached 62 tests with two HTML/XML assertion errors;
six independent cases passed but do not override the ordinary suite failure.

## Limits

Formatting is opt-in and runs once per source-changing provider attempt, even if
the candidate already has correct style. It can add local-tool latency; measure
that explicitly. A trusted project command is not a whitespace-only theorem or an
OS sandbox. Postchecks refuse certification on detected source/control changes;
they cannot prevent arbitrary process effects. The original source is not applied
automatically. Private backups contain source and must not be published.

No company changes, deploys, production DB, shared cache deletion, hidden test
input to models or retroactive first-attempt score changes. No new heavy Java run
below 2 GiB free disk. Preserve v37 candidates and evidence byte-for-byte.
