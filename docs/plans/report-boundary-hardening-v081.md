# Report boundary hardening 0.8.1

## Objective

Close the reproduced high- and medium-severity report-boundary findings without changing BTH's evidence hierarchy or adding a new runtime subsystem.

## Changes

1. Reject symbolic links anywhere under a declared structured-report tree before snapshots or collection.
2. Limit each JUnit/findings report to 16 MiB and the aggregate bytes read in one collection to 64 MiB.
3. Parse reports sequentially so the collector does not retain every matched file body.
4. Bound code-context authority identifiers independently of the ranked-entry character budget.
5. Make Gitleaks and codegraph writers project-contained, compact, bounded, and atomic.
6. Include every new Pack helper in installation inputs so source binding covers the executed writer.

## Verification

- Reproduce and then block final-file and directory symbolic-link attacks.
- Prove outside victim files remain byte-identical when Pack scripts run directly.
- Prove aggregate JUnit and findings limits fail closed.
- Prove oversized graph serialization fails before writing.
- Run the full deterministic suite plus real Maven, Gradle, and MySQL 8.4 suites.
- Verify package contents, dependency audit, CLI version, benchmark invariants, and the pushed CI run.

## Exclusion

PageRank iteration-count tuning is intentionally outside this patch. Existing telemetry accurately reports capped non-convergence, and ranking replacement needs a gold localization benchmark rather than an unmeasured constant change.
