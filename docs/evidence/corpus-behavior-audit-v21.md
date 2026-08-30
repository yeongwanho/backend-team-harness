# Public task semantics and remaining acceptance coverage

Audited 2026-08-31 against the full base/target SHAs in
[`corpus.json`](../../benchmarks/public-backend-v1/corpus.json). Each base is the
target's direct parent and every gold path matches its Git diff. This is an audit
of historical tasks, not a claim that those upstream changes are flawless.

Only public mirrors and temporary evaluator clones were used. No company source,
production DB, mail account, credentials or external application server was used.

## Corrections

- Nest 06 was described as adding conflict rejection. Its actual defect is the
  opposite: an **unused** email incorrectly triggers `emailExists` because
  `undefined !== id`. The task now asks to allow unused/same-account emails while
  preserving rejection of another account's email.
- Nest 04 needs two `.hygen/generate/` templates; this previously prohibited path
  is now explicitly included for both lanes. `.env` remains prohibited.
- Nest 02 needs observable flattening as well as persistence-to-domain mapping.
- Nest 03 uses a configurable language-header name, not just a hardcoded name.
- Nest 07's target rotates a hash with separate read/update operations. It supports
  a sequential-reuse regression, **not a concurrency safety claim**. It replaces
  an initial schema migration, so it also does not establish safe upgrades of an
  already-deployed DB. Those limitations are explicit in the task.
- FastAPI 02 intentionally removes extra CORS origins and uses `FRONTEND_HOST`.
  It does not preserve the old additional-origin setting.
- FastAPI 03 also sorts user/item lists newest first; migration keeps old rows
  nullable, not backfilled with fictional creation times.
- FastAPI 04 changes login, password recovery and reset responses. A dummy password
  verification does not prove identical end-to-end timing or complete prevention
  of enumeration. Requirements now describe the actual observable behaviors.
- FastAPI 05 preserves ordinary-user authorization rejection; its new 404 is for
  an authorized superuser, not every authenticated caller.
- FastAPI 06 includes item cleanup, superuser self-delete rejection and restricted
  deletion by arbitrary ID, rather than an unspecified "dependency safeguard".

## Acceptance inventory

"Needed" means not yet implemented/validated, not an already passing test.

| Task | Required observable checks / remaining conditions |
|---|---|
| Spring 01 association | Target tests: persisted pet added once; duplicate prevented; valid name accepted; 31-character name rejected. Real base/target controls confirmed. This is not exhaustive null/boundary fuzzing. |
| Spring 02 whitespace | Existing target controller tests: trimmed surname and whitespace-only search. Earlier paired Codex implementations passed. |
| Spring 03 uniqueness | Needed: controller/service and concurrent insertion checks. H2 alone cannot prove MySQL/PostgreSQL behavior. In particular inspect actual duplicate-constraint error naming before claiming cross-DB handling. |
| Spring 04 visit date | Evaluator-owned HTTP/controller tests: reject today/past; accept tomorrow/later; tomorrow default and rendered minimum; nonempty messages in all eight changed locale resources; description still required. This checks message presence, not translation quality. |
| Spring 05 binding | Needed: bind direct/nested IDs on all three controllers and prove mutable fields/validation still work. In-memory WebDataBinder/MVC checks are suitable. |
| Spring 06 pet update | Needed: save changed name/date/type on the existing owned pet; preserve collection size and fallback for an unassociated pet. Test with an owned repository fake first. |
| Spring 07 MySQL user | Needed: disposable MySQL 8 instance, repeated bootstrap, account authentication and grant behavior. Never execute the script against an existing DB. |
| Nest 01 conditional rotation | Needed: matching/stale conditions through service and both repositories; no tokens on failed rotation. Mock contract tests do not establish real DB concurrency. |
| Nest 02 file mapping | Needed: real mapper with fake persistence and RxJS subscription observing resolved values, not Promise objects. No application server required. |
| Nest 03 Swagger header | Needed: generated OpenAPI optional header with default/custom names. Bootstrap must be stubbed without starting DB/mail/server connections. |
| Nest 04 document update | Needed: returned updated/null domain values and generated-template behavior, not merely a search for `new: true`. |
| Nest 05 email confirmation | Needed: DTO normalization, uniqueness, unchanged email before confirmation, confirmation activation, password guard, mail template and localized content; app E2E requires ephemeral services. |
| Nest 06 unused email | Needed: unused/same-account/different-account cases through actual service with fake repository. No server required. |
| Nest 07 refresh reuse | Needed: sequential old-token rejection across adapters and fresh schema. Concurrent replay and upgrade migration remain separate production-hardening tests. |
| FastAPI 01 DB URL | Needed: accepted URI forms, app/Alembic consistency, default-secret policy and Compose wiring. Its historical diff includes `.env`, which cannot silently become an approved provider edit. Resolve that scope mismatch before a paid run. |
| FastAPI 02 CORS | Needed: real middleware preflight for allowed/disallowed origins and settings/Compose cleanup. Use dependency overrides, not a live DB. |
| FastAPI 03 timestamps | Needed: UTC values and API/client schema plus isolated upgrade/downgrade with preexisting rows, ordering/filter/pagination checks. |
| FastAPI 04 enumeration | Needed: verify missing-user password work, equal recovery responses with fake mail, missing-user reset error. Do not label unit checks a constant-time guarantee. |
| FastAPI 05 user 404 | Needed: superuser missing target 404, ordinary unauthorized 403 and existing-user success. |
| FastAPI 06 self-delete | Needed: owned-item/account deletion, protected superuser, authorized arbitrary-ID deletion and missing-target 404 in an isolated transactional DB. |

## Execution hazards found before running other frameworks

Nest's default Jest configuration selects `src/**/*.spec.ts`; five of the seven
pinned bases have no matching unit test, while their actual HTTP E2E tests live in
`test/`. A successful dependency install is not readiness or application coverage.
Those HTTP tests expect running services; do not point them at an existing local
or company server. Two bases have one utility spec, which is not coverage of the
requested auth/email behavior.

FastAPI's session-autouse DB fixture initializes the configured engine, then
deletes all Item/User rows at teardown. Do not run it with an inherited DB URL.
The oldest selected task uses `backend/poetry.lock`, unlike the later uv-based
tasks; the current shared `uv sync --frozen --project backend` setup is insufficient
for that task. Task-specific setup and owned ephemeral dependencies are still
needed. None of these cases has been marked as task success.

## Corrected-corpus static localization

Command: `node scripts/evaluate-public-corpus.mjs --allow-network --output
/tmp/bth-public-corpus-v21.json`. Corpus SHA-256:
`90b49adc9a06c1b7b2a13f427131f929e5e71ec9441ed334de36fe93ae85e516`.

| Corpus | Recall@5 | Recall@20 | nDCG@20 |
|---|---:|---:|---:|
| All 20 tasks | 0.368214 | 0.619048 | 0.446668 |
| Spring (7) | 0.727891 | 0.775510 | 0.568229 |
| Nest (7) | 0.133673 | 0.588435 | 0.381225 |
| FastAPI (6) | 0.222222 | 0.472222 | 0.381197 |

The Swagger task ranks `src/main.ts` at 39, outside its top 20. This is a concrete
retrieval weakness. These are filename-gold historical-change proxies, including
new files absent at the base; they are not semantic impact recall or implementation
success. Requirements changed, so differences from older scores are not isolated
algorithm regressions or improvements. No new general performance advantage is
established by this audit.
