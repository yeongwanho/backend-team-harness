# v32 — execute the Python backend through the product

Previous goal turn: verified progress, committed/pushed `000b17e`. Full goal is
unchanged: three independent backends, twenty paired BTH/direct provider tasks.
Ten model-free controls are not ten successful implementations.

## Observed before editing

On public FastAPI base `fe3bafc6f6732698ed2c58424f64065a4209ad47`, `bth init`
binds only `backend/pyproject.toml`; root `pyproject.toml` and `uv.lock` are absent
from verification inputs, and implementation workspace preparation is null.
The generated runner starts `uv run` from the repository root when no member
venv exists, mixing test execution with implicit environment synchronization.
The original test conftest connects to its configured DB and deletes test rows:
never run it until a task-owned disposable DB and synthetic settings are explicit.

## Implementation / verification units

1. Add pinned, zero-runtime-dependency `smol-toml` parser to package/lock, review its
   API/limits/license and audit dependency output. Never report parser exception
   text containing source. Bound file bytes and collection sizes.
2. New `src/core/python-project.mjs`: parse actual project/test dependencies,
   resolve repository-contained uv workspace membership and root lock, return
   source-bound metadata and declared input paths. Do not treat comments as
   pytest declarations or guess ambiguous/unsafe workspace layouts. Bind every
   member manifest read by uv. Preserve standalone pre-existing venv use.
3. Update `portable-test-discovery.mjs` to use that metadata and the correct
   workspace/member venv. A verifier must not implicitly install or synchronize
   packages. Set the Python source paths for the selected project, not frontend.
4. New `src/core/python-workspace-preparation.mjs`: validate uv lock sources and
   hashed registry artifacts; reject Git/arbitrary local sources. Execute a fixed
   offline, locked, no-build/no-workspace-install/no-Python-download command only
   in the separately owned implementation workspace. Keep output as hashes and
   structured failure codes. No automatic online fallback; no OS egress claim.
5. Extend implementation schema and generic preparation dispatch with
   `uv-sync-offline`, optional numeric Python version, project path, timeout.
   `init-project.mjs` supplies new defaults only for supported uv layouts, never
   overwrites existing configs. Existing npm preparation behavior stays intact.
6. Failing-first tests for root lock membership, commented pytest, ambiguous or
   malformed/path-escaping metadata, undeclared inputs, symlinks, lock sources,
   preparation flags/failure/no-provider behavior, correct test cwd/environment,
   and refusal to auto-install during verification. Add a selected mutant.
7. Exercise actual uv offline preparation on a fresh public clone using already
   cached Python 3.12 wheels. Prove source/lock unchanged and imports available in
   the isolated environment. Run product-generated verification with explicitly
   isolated public test settings/temporary PostgreSQL before any paid provider.
8. If ready, perform source-bound actual provider comparison on one FastAPI task;
   retain failures and exact usage. If a genuine runtime gap remains, fix it or
   record it as unfinished, not a successful provider sample. Do not substitute
   the independent oracle for the product's complete verification.
9. Run scoped/full regression, coverage, mutation, syntax/install/doc checks.
   Record source/command/output hashes and omitted evidence, update readable
   docs, and push this checkpoint. No company source, production DB, global auth
   changes, Docker pruning, or unrequested external reviewers.

References: Astral uv workspace/sync documentation; smol-toml package and source.
The MySQL-first product direction is unchanged; PostgreSQL is the public
FastAPI fixture's own engine, not a new production default.

## Product test environment for the public FastAPI pilot

Add evaluator-owned `fixtures/fastapi/full-test-bootstrap.py` and
`full-test-run.mjs`. The project-owned wrapper runs the *generated product
verifier*, not the independent acceptance suite. It supplies synthetic settings,
loads a pytest bootstrap before the original conftest to disable dotenv and
provision the temporary DB schema, and retains the original complete test suite.
Both files must be declared verification inputs in the temporary pilot contract;
neither may be modified by a provider. PostgreSQL resources follow the v31
bounded, owned cleanup policy and its explicitly unenforced OS egress limit.
This fixture proves the ordinary tests on a prepared public project, not Alembic
upgrade correctness or native generic DB provisioning. Do not count it as a
provider success or replace the separate task oracle with it.

## Adjacent regression found during verification

`src/doctor.mjs` still searches only member `.venv` and rejects normal virtualenv
interpreter symlinks. Align its read-only runtime lookup with the generated
runner's prepared-environment/root-workspace locations, OS-specific executable,
and directory-link rejection. Add doctor tests for all three states. A runtime
presence check must not claim pytest imports or the full suite passed.

The shared generated portable runner also changes the byte-pinned Nest oracle
runner. Regenerate that exact fixture, update its hashes in provider comparison,
and advance the protocol version (old samples remain historical). Revalidate the
affected Nest controls before reporting those controls under the new bytes.

## Checkpoint outcome

- Implemented source-bound uv discovery/preparation, verifier/doctor alignment,
  compatibility handling and failure-before-provider tests.
- Actual FastAPI dependencies prepared offline; original full suite executed:
  52 passed / 3 failed. No paid provider comparison started from that baseline.
- Three previously confirmed Nest controls revalidated with updated runner bytes;
  the additional session-update control remains blocked by its public lockfile.
- Full regression: 504 tests / 500 passed / 0 failed / 4 skipped; 25 selected
  mutations killed. Evidence: `docs/evidence/python-workspace-v32.md`.
- Whole goal remains active. Next: explicitly provision safe test email transport
  and address the pinned upstream test-baseline defects without weakening task
  acceptance or ordinary test verdicts; then attempt the same FastAPI requirement
  with BTH and direct provider under identical, source-bound conditions.
