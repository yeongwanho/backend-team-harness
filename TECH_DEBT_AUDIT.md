# Backend Team Harness 0.9 — Technical Debt Audit

**Audit date:** 2026-08-30

**Base revision:** `404de1799fb0c3f84d4f4b5376ab13192aafbaf7`

**Audited working branch:** `codex/project-intelligence-v09`

## Executive summary

The 0.9 branch is no longer only a verification-script wrapper. It has a deterministic project-intelligence layer, a three-valued rule engine, source-bound planning, a bounded semantic graph, dependency-aware Gate scheduling, and isolated implementation/recovery. The safety posture is intentionally conservative: unknown or conflicting evidence cannot become a pass, graph output cannot skip tests, and generated changes are never committed or merged automatically.

The implementation is suitable for a **controlled 0.9 pilot**, not for a claim of universal backend understanding. The largest remaining gaps are measurable rather than cosmetic: company-specific facts require core edits, prose requirements are not semantically cross-checked, graph recall and cache performance have no real-repository benchmark, and only one maintainer's workflow has been exercised. Four quick wins are listed below, while the larger gaps require benchmarks or contract changes rather than cosmetic refactoring.

Audit evidence:

- 14,182 JavaScript/MJS lines; largest production file is `src/cli.mjs` at 722 lines.
- One pinned runtime dependency (`fast-xml-parser` 5.11.1); `npm outdated --json` returned no updates and `npm audit --omit=dev` reported no vulnerabilities.
- No `TODO`, `FIXME`, `HACK`, dynamic `eval`, or hard-coded credential finding in production sources.
- `ast-grep` 0.44.0 was available. CodeGraph CLI was not installed, so graph conclusions were checked from the repository's own generated-graph contracts and tests instead.

All nine audit dimensions were checked. Architectural decay, consistency, contracts, tests, and performance produced findings below. Dependency/config, error/observability, and security scans found no release-blocking issue; documentation matched the implemented 0.9 boundaries, with low API-doc coverage recorded separately.

## Mental model

```text
requirements + project policy Markdown
                 |
                 v
       bounded deterministic facts
                 |
                 v
     three-valued project rules  ---- unknown/conflict ----> block finalization
                 |
                 v
       source-bound interview/plan
                 |
                 v
 semantic graph -> advisory impact context
                 |
                 v
      detached implementation worktree
                 |
                 v
 Gate DAG -> isolated commands -> structured reports -> sealed evidence
                 |
                 +---- no automatic commit / merge / deploy / VERIFIED
```

Trust boundaries are deliberately separated. Markdown supplies human provenance, deterministic scanners supply facts, the graph supplies navigation only, project-owned executables perform work, and structured reports—not model prose—control verification.

## Findings

| ID | Category | File:line:col | Severity | Effort | Description | Recommendation |
|---|---|---|---|---|---|---|
| TD-01 | Architectural decay | `src/cli.mjs:33:1`, `src/cli.mjs:225:1`, `src/cli.mjs:662:1` | Medium | 6–10 h | The CLI is a 722-line routing and presentation monolith and is among the highest-churn files. Adding commands increases parser/help/output coupling. | Move command families into `src/commands/<name>.mjs`; retain one strict argument parser and snapshot the help/exit-code contract. |
| TD-02 | Type and contract debt | `src/adapters/project-intelligence.mjs:109:1`, `src/adapters/project-intelligence.mjs:168:1` | High | 12–20 h | Project-rule facts use a closed vocabulary assembled in core code. A company cannot express a new domain fact without changing BTH itself. | Add a bounded project-owned fact-provider contract for provenance-carrying `confirmed/unknown/conflict` facts. Validate schemas, paths, output size, and duplicate IDs; never accept model assertions as facts. |
| TD-03 | Type and contract debt | `src/core/interview-state.mjs:152:1`, `src/core/interview-state.mjs:268:1`, `src/core/constraint-engine.mjs:140:1` | High | 16–30 h | Interview handling records caller-declared `unknown` or `conflict`, and blocks finalization correctly, but does not detect semantic contradictions across prose requirements, policies, and answers. | Add an **advisory** contradiction-candidate stage with source spans, pairwise claim IDs, explanation, and mandatory human resolution. It must not create facts or approve a plan. Build a gold fixture first. |
| TD-04 | Performance and resource hygiene | `packs/codegraph-advisory/indexer.mjs:201:1`, `packs/codegraph-advisory/indexer.mjs:219:1`, `packs/codegraph-advisory/indexer.mjs:278:1`, `src/core/code-context.mjs:458:1` | Medium | 16–32 h | Indexing performs a full source scan and materializes the complete graph each run, although the consumer rejects reports over 16 MiB. Large repositories can spend CPU and memory constructing unusable output. | Add a content-addressed per-file parse cache keyed by parser version + digest and a graph manifest. Measure cold/warm time and peak RSS before defaulting it on. |
| TD-05 | Test debt | `docs/ROADMAP.md:129:1`, `docs/ROADMAP.md:130:1` | High | 12–20 h | Impact ranking has no versioned gold dataset or measured Recall@20. The algorithms are coherent, but practical accuracy is unproven. | Build change→affected-file gold cases from at least two backends; report Recall@5/20, MRR, false-negative classes, time, and peak memory. |
| TD-06 | Test debt | `docs/ROADMAP.md:131:1` | High | 8–16 h plus pilot time | The workflow has not been validated by a second independently maintained backend team/project, so defaults may overfit one developer's Spring/MySQL workflow. | Pilot one unrelated Spring/MySQL service, then a different build/database shape. Record config edits, false positives, misses, and time-to-first-use. |
| TD-07 | Test debt | `test/process-runner.test.mjs:55:1`, `test/process-runner.test.mjs:96:1`, `test/process-runner.test.mjs:119:1`, `test/process-runner.test.mjs:142:1`, `docs/ROADMAP.md:136:1` | Medium | 8–16 h | Windows process-tree and symlink behavior lacks CI proof. Timeout cleanup can differ materially on Windows. | Add a Windows job and an explicit Job Object/taskkill implementation before claiming cross-platform safety. |
| TD-08 | Consistency rot | `package.json:9:1`, `.github/workflows/ci.yml:10:1` | Medium | 4–8 h | The default quality gate has syntax checks and tests but no static lint or coverage regression threshold. | Add a low-noise lint baseline and Node coverage for deterministic core/config modules; set thresholds from the measured baseline. |
| TD-09 | Documentation drift | `src/config/project-rules.mjs:128:1`, `src/adapters/project-intelligence.mjs:159:1`, `src/core/code-context.mjs:309:1` | Low | 2–4 h | Important exported contracts are described in guides and tests but have no adjacent API comments documenting inputs, trust level, throws, and output authority. | Add concise JSDoc only to public configuration/adapter/core boundaries; do not narrate internal implementation. |

## Top five priorities

1. **Build a gold impact benchmark (TD-05).** Algorithm choice is not proof; false negatives on real changes are the decisive risk.
2. **Add bounded project fact providers (TD-02).** This is the direct path from a generic harness to understanding each company's rules without forking the core.
3. **Add human-resolved contradiction candidates (TD-03).** Planning quality cannot advance much further while contradictions are only manually labeled.
4. **Add measured incremental indexing (TD-04).** Optimize only after cold/warm time and memory measurements establish the bottleneck.
5. **Run an independent backend pilot (TD-06).** It is the fastest way to expose hidden assumptions in configuration, terminology, and recovery.

## Quick wins checklist

- [x] **Resolved during this audit:** CI now runs the real JVM Maven/Gradle fixture as a dedicated job, alongside the existing deterministic and MySQL jobs (`.github/workflows/ci.yml:22-36`).
- [ ] Add a fact-catalog table to the project-rules guide so the current closed vocabulary is visible. (<30 min)
- [ ] Add a package-content assertion that rejects `.backend-harness/local/` and generated run artifacts. (<30 min)
- [ ] Print existing graph source-byte, node, edge, residual, and convergence metrics in the CLI summary. (<30 min)

## Looks bad but is acceptable by design

- **Graph algorithms appear twice.** The installable Pack must stay portable and project-owned, while the core must independently validate and rank untrusted Pack output. Sharing the implementation would weaken that boundary.
- **Default tests skip real JVM and database cases.** They are deliberately environment-gated and have dedicated commands and CI jobs; a skipped default case is not reported as a real integration pass.
- **CLI code uses `console.log`/`console.error`.** This is a small command-line program with explicit JSON modes, not an application service requiring a logging framework.
- **Implementation does not auto-commit or auto-merge.** That is a safety property, not missing automation. The detached worktree is an inspection boundary.
- **Graph analysis cannot create PASS or skip tests.** This intentionally preserves deterministic verification as the authority even when navigation quality improves.

## Open questions

1. Which two independently maintained repositories may be used to build the gold impact fixture without exposing company code?
2. Should custom fact providers run only during inspection, or also before every verification to prevent stale policy facts?
3. Is Windows a supported production target or only a contributor convenience target?
4. What repository size should define the cache acceptance test: source bytes, JVM file count, graph nodes, or all three?
5. Who is authorized to resolve an advisory semantic contradiction: the task requester, a named reviewer, or either with a recorded reason?

## Current capability calibration

These are engineering-readiness estimates, not benchmark scores:

| Capability | 0.9 estimate | Why it is not higher yet |
|---|---:|---|
| Project-rule understanding | 7/10 | Deterministic facts, strict provenance, and fail-closed rules exist; custom domain facts still require core changes. |
| Planning contradiction handling | 6/10 | Explicit unknown/conflict and rule violations block finalization; prose contradictions are not automatically proposed. |
| Code-impact analysis | 6/10 | Structural provenance, directional reachability, SCC, and weighted PPR exist; compiler/runtime edges and gold recall do not. |
| Implementation and bounded recovery | 6/10 | Detached worktree, approvals, budgets, verification, and bounded retries exist; no bundled universal coding adapter or OS sandbox exists. |
| Execution optimization | 7/10 | Dependency-ready scheduling and opt-in bounded parallelism preserve the Gate set; large-repository and real-team latency benchmarks are still missing. |

The correct release claim is therefore: **a safety-oriented, extensible 0.9 backend harness kernel ready for measured pilots**, not “perfect,” “twice as good as OMO,” or a replacement for compiler/runtime analysis.
