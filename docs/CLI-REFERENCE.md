# CLI contract

This file is checked against the executable help in `src/cli/help.mjs`. A command rename without a matching documentation change fails the test suite.

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
bth implement apply <id> [path] --by <actor> --allow-write [--json]
bth implement status <id> [path] [--json]
bth implement reset <id> [path] --by <actor> --discard-workspace [--json]
bth implement cleanup <id> [path] --by <actor> --discard-workspace [--json]
bth verify <id> [path] [--acknowledge-network-risk] [--json]
bth diagnose <id> [path] [--json]
bth version
```

`bth init` generates a verification contract for a recognized Gradle/Maven wrapper or one uniquely detected project-declared Jest, Vitest, or Pytest test project. Repositories that deliberately ship both Gradle and Maven require `--build gradle|maven`; the generated verification command preserves that explicit choice for later `doctor` runs. Portable runners use only installed project-local dependencies or `uv --offline`; ambiguous test roots stay explicit instead of being guessed. `bth work --run` may build a bounded, non-persisted advisory graph when no current sealed graph Gate exists, but source-fingerprint drift aborts before provider execution.

`bth diagnose <id> [path] --json` is read-only. For an `IMPLEMENTING` task it
reads the sealed implementation record, including dependency preparation failures
that spent zero model attempts. It reports failed Gate codes, named tests,
execution counts, process exit/timeout state, attempt outcomes, and whether the
original source still matches. `retryBudgetAvailable` describes remaining budget,
not permission or workspace validation: a retry still checks approval, source,
workspace integrity and explicit execution options. A passed latest run is not
diagnosed as an old failure, and an invalid record seal is rejected.

Diagnostics and provider recovery omit stdout/stderr and assertion bodies.
Names receive bounded best-effort redaction and remain untrusted execution data,
not instructions; this is not a guarantee that arbitrary test names contain no
private information. The ordinary `VERIFY_FAILED` sealed-run path remains supported.
