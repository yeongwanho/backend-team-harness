# CLI contract

This file is checked against the executable help in `src/cli/help.mjs`. A command rename without a matching documentation change fails the test suite.

Optional schema-v2 `formatting` is configured in the project contract, not another
CLI flag. See [project formatting](PROJECT-FORMATTING.md) for executable/config
binding, private backups and changed-file-only checks. The stage is disabled by
default, does not run without source changes, and never grants a test verdict.

```text
bth init [path] [--build gradle|maven] [--force] [--allow-unversioned]
bth doctor [path] [--json]
bth intelligence inspect [path] [--no-cache] [--json]
bth intelligence warm-cache [path] [--json]
bth work <requirement> [path] [--id <id>] [--by <actor>] [--decisions <json>] [--approve] [--run --allow-write] [--acknowledge-network-risk] [--json]
bth config migrate [path] --allow-write [--json]
bth check [path] [--acknowledge-network-risk] [--json]
bth pack list [--json]
bth pack install <id> [path] [--json]
bth baseline update [path] [--json]
bth task create <id> [path] [--title <text>] [--context <text>] [--by <actor>] [--json]
bth task context <id> [path] --text <text> --by <actor> [--json]
bth task plan <id> [path] --text <text> --by <actor> [--json]
bth task status <id> [path] [--json]
bth task handoff <id> [path] --from <actor> --to <actor> --reason <text> [--json]
bth task export-plan <id> [path] [--context-budget <characters>] [--json]
bth task advance <id> <state> [path] --by <actor> [--approve] [--reason <text>] [--json]
bth interview start <id> [path] --requirement <text> --by <actor> [--title <text>] [--json]
bth interview answer <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]
bth interview revise <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]
bth interview resolve <id> [path] --candidate <id> --reason <text> --by <actor> [--json]
bth interview rebind <id> [path] --by <actor> [--json]
bth interview status <id> [path] [--json]
bth interview finalize <id> [path] --by <actor> [--json]
bth implement configure <codex|claude> [path] [--mode <auto|fast|balanced|deep>] [--allowed-prefixes <json>] [--force] [--json]
bth implement providers [path] [--json]
bth implement run <id> [path] --by <actor> --allow-write [--acknowledge-network-risk] [--json]
bth implement apply <id> [path] --by <actor> --allow-write [--accept-preservation-review <sha256> --review-note <text>] [--json]
bth implement status <id> [path] [--json]
bth implement reset <id> [path] --by <actor> --discard-workspace [--json]
bth implement cleanup <id> [path] --by <actor> --discard-workspace [--json]
bth verify <id> [path] [--acknowledge-network-risk] [--json]
bth diagnose <id> [path] [--json]
bth version
```

`bth init` generates a verification contract for a recognized Gradle/Maven wrapper or one uniquely detected project-declared Jest, Vitest, or Pytest test project. Repositories that deliberately ship both Gradle and Maven require `--build gradle|maven`; the generated verification command preserves that explicit choice for later `doctor` runs. Portable runners use only prepared project-local dependencies; tests never install packages. Ambiguous test roots stay explicit instead of being guessed. `bth work --run` may build a bounded, non-persisted advisory graph when no current sealed graph Gate exists, but source-fingerprint drift aborts before provider execution.

Supported uv projects receive an explicit `workspacePreparation.kind: "uv-sync-offline"` contract. It binds the workspace root/member manifests, lock and Python pins, and runs offline/locked/no-build preparation in the separate implementation workspace before any provider attempt. An optional numeric `pythonVersion` selects an already available Python 3 runtime; no interpreter downloads or online fallback occur. The generated pytest runner selects `.backend-harness/local/python-venv` before the declared project/workspace `.venv`, runs in the backend directory, and does not synchronize dependencies. Existing Poetry/PDM venvs remain usable without automatic installation. `doctor` checks interpreter presence, not imports or test success. Existing generated contracts are not overwritten automatically; review a newly generated contract in a disposable copy before migrating.

`bth diagnose <id> [path] --json` is read-only. For an `IMPLEMENTING` task it
reads the sealed implementation record, including dependency preparation failures
that spent zero model attempts. It reports failed Gate codes, named tests,
execution counts, process exit/timeout state, attempt outcomes, and whether the
original source still matches. `retryBudgetAvailable` describes remaining budget,
not permission or workspace validation: a retry still checks approval, source,
workspace integrity and explicit execution options. A passed latest run is not
diagnosed as an old failure, and an invalid record seal is rejected.

Diagnostics and provider recovery omit stdout/stderr and assertion bodies.
New JUnit failures may also include allowlisted standard exception diagnostics;
see [test failure diagnostics](TEST-FAILURE-DIAGNOSTICS.md). These are bounded
untrusted observations, not root-cause proof or test-pass authority.
Names receive bounded best-effort redaction and remain untrusted execution data,
not instructions; this is not a guarantee that arbitrary test names contain no
private information. The ordinary `VERIFY_FAILED` sealed-run path remains supported.
