# Project intelligence cache 0.9.1 QA evidence

## Scope

This change removes repeated directory walks from `doctor`, shares one bounded project manifest with JVM inspection, and adds an explicit source-bound incremental JVM cache. Read-only inspection never writes the cache.

## Safety cases exercised

- missing cache falls back to a fresh index and creates no file;
- an unchanged exact source fingerprint produces a cache hit;
- one changed JVM file reparses only that file;
- a non-JVM source change reuses all JVM entries;
- an altered cache seal is rejected and fresh facts are produced;
- Git-ignored JVM sources make caching unsupported;
- assume-unchanged and skip-worktree JVM paths make caching unsupported;
- working-tree and committed changes remain project-relative for a backend nested in a larger monorepo;
- a symbolic-link cache path is neither read nor overwritten;
- source stability is recaptured before an explicitly warmed cache is written;
- the cache is bounded to 128 MiB and stored as one atomically replaced local file.

## Large backend benchmark

Measured 2026-08-30 on Apple M1 Pro, 32 GiB RAM, Node v22.23.1. The input was a temporary local clone of `api-doctorvice-care-server` plus its copied harness contract. The original company checkout was read only. The fixture contained 1,551 Java/Kotlin files and 3,031,509 indexed source bytes. Each timing is 15 independent CLI processes; the table reports the median.

| Operation | Baseline `a26642a` | Current | Reduction | Speedup |
|---|---:|---:|---:|---:|
| `doctor --json` | 220.31 ms | 161.80 ms | 26.6% | 1.362x |
| fresh `intelligence inspect --json` | 454.87 ms | 381.75 ms | 16.1% | 1.192x |
| unchanged warmed inspection | 454.87 ms | 300.44 ms | 34.0% | 1.514x |
| one-JVM-file-changed incremental inspection | 459.08 ms | 342.63 ms | 25.4% | 1.340x |

The one-file-change run reported:

```json
{
  "files": 1551,
  "parsedFiles": 1,
  "reusedFiles": 1550,
  "readBytes": 4901,
  "totalBytes": 3031509
}
```

This proves 99.9% file-entry reuse, not a 99.9% end-to-end latency reduction. Node process startup, exact Git source binding, policy loading, and result serialization remain in the measured CLI path. The measured result is a 1.51x unchanged-run speedup, not a claimed 2x overall harness speedup.

## Verification commands

```text
node scripts/check-syntax.mjs
node --test test/jvm-index-cache.test.mjs test/project-intelligence.test.mjs test/doctor.test.mjs test/cli.test.mjs
npm run check
npm run test:windows-contract
```

Local final result: 245 tests, 243 passed, 2 intentionally skipped, 0 failed. The dedicated Windows contract suite passed 8/8 locally; the hosted Windows result is recorded in the commit/CI history for this change.
