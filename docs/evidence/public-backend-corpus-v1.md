# Public backend corpus v1 evidence

Date: 2026-08-31

## What was tested

`benchmarks/public-backend-v1/corpus.json` pins twenty historical one-commit tasks across three independently maintained public repositories:

- Spring Petclinic: seven Java/Spring tasks;
- NestJS Boilerplate: seven TypeScript/Nest tasks;
- Full Stack FastAPI Template: six Python/FastAPI tasks in a monorepo.

For every task, `npm run benchmark:public -- --allow-network` cloned the public repository into an OS temporary directory, proved that the declared base is the direct parent of the target, proved that the declared gold paths exactly equal `git diff --no-renames`, checked out the base, built the production advisory graph, and ranked paths from the requirement text. Temporary clones were removed after the run.

## What was observed

The complete machine-readable report is `public-backend-localization-v4.json`.

- tasks: 20;
- mean Recall@5: 0.3682142857142857;
- mean Recall@20: 0.7074999999999999;
- mean nDCG@20: 0.49081081911941504;
- tasks with zero Recall@20: 0;
- local evaluation duration: 14,554 ms, excluding no provider execution.

The graph now recognizes Java/Kotlin, TypeScript/JavaScript, and Python source. SQL, configuration, template, Markdown, and `.env` files become path-only artifact nodes. Artifact bodies are not read; a regression test proves a marker inside `.env` is absent from the graph.

## Regression gates

- `npm run check`: 332 tests, 328 passed, 4 environment-gated skips, 0 failures; three mutation smoke targets killed.
- `npm run test:coverage`: statements/lines 88.98%, branches 78.08%, functions 98.17%; configured thresholds passed.
- `npm run test:install`: packed installation smoke passed.
- focused corpus, graph, and ranking tests: 27 passed, 0 failed.

## Why this is enough for this checkpoint

The checked-in corpus prevents a ranking change from being justified only by a synthetic fixture. Its repository commits and gold file sets are independently reproducible from Git history, and the report includes the top twenty paths and each gold path's rank. The result proves only source-bound file localization over these historical tasks.

## What remains unproven

This checkpoint does not prove implementation success, convention compliance, time or token savings, MySQL runtime behavior, or superiority over direct Codex/Claude. Those require paired real-provider execution of BTH and direct baselines on the same tasks. A historical changed-file set is also an imperfect proxy for every file that a different valid implementation could change.
