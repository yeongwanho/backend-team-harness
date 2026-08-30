# Project intelligence performance hardening 0.9.1

## Goal

Make repeated inspection useful on large JVM monorepos without weakening BTH's source-bound evidence contract or making read-only inspection write project state.

## Changes

1. Scan the project tree once per inspection and share the bounded manifest between doctor and the JVM index.
2. Add a bounded JVM index cache under `.backend-harness/local/cache/`.
3. Bind every cache record to the exact Git source fingerprint and a sealed record digest.
4. Refuse cache reuse when indexed Java/Kotlin sources are ignored by Git or live inside a submodule, because the root fingerprint cannot prove those contents.
5. Keep `bth intelligence inspect` read-only. Only `bth intelligence warm-cache` may write the cache.
6. Fall back to a fresh index on a missing, stale, malformed, oversized, or unsafe cache.

## Verification

- Doctor and intelligence regression suites remain green.
- An unchanged warmed project reports a cache hit and returns the same deterministic facts.
- A tracked or untracked source change invalidates the cache.
- Malformed, altered, oversized, and symbolic-link cache paths never become fact authority.
- Inspection without an explicit warm command creates no cache file.
- Windows contract tests cover the cache path and CLI surface.
- Before/after timings are captured on a large real backend copy without writing the source checkout.
