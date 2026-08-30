# Portable bootstrap and on-demand context QA — 2026-08-31

## What was tested

This checkpoint extends the existing JVM path without changing verdict authority:

- unique repository-declared Jest, Vitest, and Pytest discovery;
- generated POSIX and Windows project-owned verification wrappers;
- strict conversion of Jest output and native Vitest/Pytest output into the existing JUnit evidence contract;
- truthful `doctor` readiness when pinned project-local dependencies are absent;
- bounded TypeScript/JavaScript/Python convention observation;
- nested portable-backend scoping so sibling frontend code is not learned as backend policy;
- bounded on-demand advisory code context when no current sealed codegraph Gate exists;
- source-fingerprint stability before provider execution;
- TypeORM object-form table names and honest unpaired e2e-test reporting.

The maintained deterministic commands were:

```text
npm test
npm run test:coverage
npm run test:mutation
npm run test:install
node --test test/code-context.test.mjs
```

Two fresh public repository clones were also initialized and inspected in an OS temporary directory:

```text
https://github.com/brocoders/nestjs-boilerplate.git
https://github.com/fastapi/full-stack-fastapi-template.git
```

No change was pushed to either upstream repository. BTH initialization wrote only inside the disposable clones.

## What was observed

- Final complete deterministic suite: 343 tests, 339 passed, 0 failed, 4 environment-gated skips.
- Coverage Gate: 89.15% statements/lines, 78.19% branches, 98.07% functions; every configured threshold passed.
- Mutation smoke: all three maintained mutants were killed.
- Packed npm installation smoke passed for `backend-team-harness@0.9.0`.
- The direct on-demand-context cases passed 14/14 and are included in the final complete run.

Fresh NestJS clone:

- build detection: `node-jest` at the repository root;
- `doctor`: `healthy=false`, `readiness=unknown` because local Jest was not installed;
- observed backend structure: 9 controllers, 19 services, 23 DTO files, 61 entity-role files, 9 repositories, 21 routes, 13 test files;
- explicit TypeORM table names: `file`, `role`, `session`, `status`, `user`;
- broad e2e files were counted but not falsely paired to production files when no exact pairing evidence existed.

Fresh FastAPI full-stack clone:

- build detection: `python-pytest:backend`;
- `doctor`: `healthy=false`, `readiness=unknown` because `backend/.venv` was absent;
- convention scope: `backend` only; sibling `frontend` was excluded;
- observed backend structure: 11 controller/route files, 3 repository/CRUD-role files, 23 routes, 15 test files, 7 exact production/test pairs.

On-demand context for `Add user lookup endpoint` on the FastAPI clone:

- 45 backend-scoped graph nodes;
- 11 complete ranked entries fit the 2,500-character budget;
- 0 returned paths outside `backend/`;
- relevant model, route, database setup, utility, and test paths were included;
- the graph remained non-persistent and advisory, with `pass-verdict` and `test-skipping` forbidden.

## Why this evidence is sufficient for the checkpoint

The unit and integration tests cover successful portable execution, missing-runtime readiness, nested project scoping, Windows wrapper resolution, unsafe/failed graph fallback, provider-request propagation, and full existing verification invariants. The two public clones prove the detector and convention compiler operate on independently maintained NestJS and FastAPI layouts rather than only synthetic fixtures. The provider implementation test proves the new graph is produced without a prior installed graph Pack and reaches the sealed request before isolated editing.

This evidence proves a bootstrap and navigation checkpoint only. It does not prove the final product goal.

## What remains unproven

- Real Windows execution of the new Jest/Pytest wrappers; only the Windows command contract is deterministic here.
- Actual tests in the two public clones; dependencies were deliberately not installed or downloaded.
- Custom Jest/Vitest shell scripts and multiple competing test roots; these remain a team-owned explicit contract rather than a guessed default.
- Dynamic framework wiring, generated code, runtime SQL ownership, query-plan quality, or production database behavior.
- Direct Codex/Claude implementation success, tokens, cost, time, and retry rate on the 20-task public corpus.
- The requested three-repository/20-task `success@1` completion comparison; until that paired benchmark exists, the active product goal is not complete.
