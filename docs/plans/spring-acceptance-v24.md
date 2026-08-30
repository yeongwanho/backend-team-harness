# Two more independent Spring task controls v24

The product goal remains active. v23 (41b5e63) fixed twenty-task planning, not
implementation success. No paid provider is needed to prepare these controls.

## Observed source

- Spring 05: f1e0e22 -> c7ee170 changes owner, pet and visit MVC binders to
  reject nested IDs; the pet binder previously rejected neither direct nor nested
  IDs. The pet validator must remain active and mutable fields must still bind.
- Spring 06: 6328d2c -> 2aa53f9 updates an existing pet's name, date and type before
  saving its owner. The base calls addPet, which ignores an existing ID. The
  fallback for a new associated pet, duplicate-name and future-date checks remain.

## Edit and verification units

1. Add evaluator-owned Java fixtures under
   `benchmarks/public-backend-v1/fixtures/spring/` only. Binder controls drive real
   standalone MockMvc requests through the actual controllers, mock repositories,
   poison direct/nested IDs, check allowed fields and preserve validation. Pet
   update controls use explicit in-memory H2 and rollback transactions, flush and
   clear JPA before reloading state. No MySQL claim is made for this H2 behavior.
2. Bind fixtures by SHA-256 in the Spring 05/06 entries of
   `benchmarks/public-backend-v1/provider-comparison.json` after establishing exact
   report/case names. Keep requirements, task pins and provider scope unchanged.
3. Run `evaluateTaskAcceptance` in its separate temporary base/target clones with
   the public mirror and offline Maven. Require named cases to execute, base
   regression, target pass, fresh reports and unchanged source snapshots. If
   dependencies are missing, prepare only the owned public clone with explicit
   network permission; never count a compiler/dependency failure as a control.
4. Keep failed attempts in the final evidence description. Confirm the exact
   fixtures through the public `--preflight` path when practical. No provider
   `successAt1` is inferred from a passing target or unrelated existing tests.
5. Add a config regression test pinning the new task-oracle names/hashes, run
   affected Node tests and full suite, record compact machine evidence under
   `docs/evidence/artifacts/v24/`, update README's current count only after both
   controls pass, and push a checkpoint. Historical v23 evidence stays immutable.
