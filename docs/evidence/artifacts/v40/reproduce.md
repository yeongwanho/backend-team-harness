# Reproducing this observation

Use the checked-in corpus/config from the commit containing this directory.
Do not run against company repositories. These commands create disposable public
clones and invoke billable/authenticated model CLIs; they do not apply a candidate.
Prerequisites: Node 22, Git, the pinned uv/Python dependencies already cached,
Docker with the exact Postgres image declared by the existing FastAPI fixtures,
and the selected provider CLI. Do not silently substitute database images or
change the test minimum to make an environment pass.

Create unique output directories. Reusing an existing result without the matching
corpus/config/model/profile is deliberately rejected. The local cache used for
this observation was `/tmp/bth-provider-comparison-cache-v2`; another complete
mirror cache is permitted but changes environment/warm-cache measurements.

```sh
node scripts/benchmark-provider-comparison.mjs --preflight \
  --task fastapi-04-constant-time-login --provider codex \
  --cache /tmp/bth-provider-comparison-cache-v2 \
  --output /tmp/bth-v40-auth-preflight-new --timeout-ms 240000 \
  --allow-network --keep-workspace

BTH_PROVIDER_BENCHMARK=I_UNDERSTAND_PROVIDER_COSTS \
node scripts/benchmark-provider-comparison.mjs --execute \
  --task fastapi-04-constant-time-login --provider codex --lane both \
  --mode deep --model gpt-5.6-sol --timeout-ms 240000 \
  --cache /tmp/bth-provider-comparison-cache-v2 \
  --output /tmp/bth-v40-auth-codex-new --allow-network --keep-workspace
```

For the Claude pair, use `--provider claude --model claude-sonnet-5 --mode deep
--max-budget-usd 3` in a separate output directory. Execute `--lane direct` and
then `--lane bth` sequentially; do not overlap pairs or benchmark QA workloads.
The actual order, CLI versions, source hashes and observed failures belong in
the recorded artifact. Model availability/limits can change; failures stay failures.

Each lane gets one provider invocation. The runner performs dependency preparation,
the ordinary baseline, independent base/target controls, implementation, fresh
ordinary verification, and candidate acceptance when eligible. Do not manually
repair a generated candidate before recording its result. Kept workspaces and
raw local logs remain private audit inputs; publish only reviewed redacted records.

`--allow-network` acknowledges the execution policy; it is not OS egress isolation.
The prepared fixture uses synthetic accounts, an owned temporary database and
in-memory SMTP transport. It does not validate MySQL or Alembic migration safety.
Both implementation lanes forbid model-run build/tests in this controlled protocol;
a native provider doing its own full workflow is a separate outstanding baseline.

Once both lanes are terminal, `record-pair.mjs` can check the unchanged core,
fixture hashes, protected inputs, final source and executed test identities before
writing a redacted pair. Preserve the original observed scores and the one-call
budget, including provider refusals or timeouts.
