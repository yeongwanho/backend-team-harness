# Independent hardening plan — 0.8

## Goal

Turn the 0.7 prototype into a safer team handoff by testing review hypotheses from Claude Opus and Grok 4.6, fixing only defects reproduced from source or a failing test, and recording unsupported claims as rejected rather than silently adopting them.

## Review rule

- Treat every external review as an untrusted hypothesis.
- Accept a finding only when the current source or a failing regression test proves it.
- Preserve the small verdict oracle: no model, graph score, checklist, or historical estimate may create PASS.
- Keep company policy, credentials, deployment, and production database access outside Core.

## Confirmed work

1. **Process lifecycle**
   - Reproduce a successful parent process whose descendant keeps stdout/stderr open.
   - Resolve from process exit after a bounded drain period instead of misclassifying it as a command timeout.
   - Kill the leaked process group, expose the cleanup condition, and fail the Gate with a distinct reason.

2. **Project-scoped Git identity**
   - Bind a nested backend to its `HEAD` subtree rather than the repository-wide commit id.
   - Keep the repository commit as provenance metadata.
   - Bound individual and aggregate hashes for untracked/declared inputs.

3. **Executable Pack isolation**
   - Give architecture, contract, and database Pack recipes unique JUnit report directories.
   - Reject exact report-pattern ownership collisions at configuration load time.
   - Test combined Pack installation, not installation in isolation only.

4. **Portable shared completion evidence**
   - Continue preferring detailed local evidence.
   - When local evidence is intentionally absent on another clone, allow the committed, sealed task run summary to prove the same evidence id and source fingerprint.
   - Never fall back from present-but-tampered local evidence.

5. **Baseline integrity**
   - Verify the latest run seal before trusting it.
   - Use the same allowed command-symlink binding policy as normal verification.

6. **Lock ownership**
   - Record a process-start identity when the host exposes one.
   - Reclaim a crash remnant if its PID has been recycled; retain PID-only conservative behavior where start identity is unavailable.

7. **Optimizer and graph transparency**
   - Evict the least recently observed stale gate signature when bounded history reaches capacity instead of freezing all learning.
   - Report PageRank tolerance and whether the bounded iteration actually converged; do not claim convergence when the cap was reached.

8. **Environment and product language**
   - Pass a narrow, documented set of Docker/Testcontainers/cache routing variables needed by the maintained MySQL path without passing broad credential variables.
   - Label `quality-gates/*.yaml` honestly as human review checklists; executable authority remains only in `verification.json`.
   - Describe the scheduler benchmark as an analytical fixture, not production performance proof.

9. **Post-review evidence hardening**
   - Delete prior matched structured reports before each Gate so changing only timestamps cannot reuse old evidence.
   - Reject potentially overlapping wildcard report trees and require Gate-owned report directories.
   - Scope portable summaries to the final `VERIFIED -> DONE` handoff and require stable source, executed tests, and all required Gates passing.
   - Keep foreign-host locks conservative instead of comparing their PIDs with local processes.
   - Wait for bounded `SIGTERM`/`SIGKILL` cleanup when leaked descendants keep stdio open.
   - Redact underscore-delimited credential names such as `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD`.
   - Supply copyable Gradle architecture-task snippets and render human review checklists in exported plan Markdown.
   - Build plan-localization terms from human plan values and support Unicode identifiers.

10. **Final adversarial-review corrections**
   - Preserve the exact 0.7 source fingerprint as compatibility metadata for unchanged approved and verified tasks.
   - Reject project-root report patterns and refuse to purge tracked or non-ignored files.
   - Count source bytes during streaming, not only before the read.
   - Make stdio-drain cleanup settle in `finally` and detach listeners before digest finalization.
   - Serialize approved-plan/graph export with verification and report regeneration.
   - Prevent duplicate architecture-test execution and inherited Object prototype Pack lookup.
   - Exclude ambient Testcontainers reuse in addition to Ryuk-disable flags.

## Verification

- Failing-first regression tests for every changed invariant.
- `npm run check`.
- Real Gradle/Maven JVM E2E.
- Real pinned MySQL 8.4 Testcontainers E2E when Docker is available.
- Adaptive benchmark and CLI smoke.
- Review the final diff for source/evidence/permission regressions, then commit and push the task branch.

## Explicitly rejected review suggestions

- Do not require verified source to equal the pre-implementation approval fingerprint; implementation is expected to change source. Approval binds the reviewed plan and starting context, while verification binds the resulting source.
- Do not make `IMPLEMENTING` mandatory merely for ceremony; a no-op or already-complete change may legitimately verify after approval.
- Do not hash every Git-ignored file implicitly; projects must declare ignored inputs that affect a verdict.
- Do not replace the bounded hybrid retrieval formula without a gold localization benchmark.
- Do not weaken PageRank accuracy to an arbitrary tolerance merely because some graphs reach the iteration cap.
- Do not accept the claim that query-aware PageRank can never converge. A two-node cycle reaches an exact fixed point in one iteration; path and star fixtures correctly expose iteration-cap non-convergence.
- Do not present cooperative SHA-256 seals as hostile-author attestation. Trusted CI signatures remain a separate future policy.
